import { App, Platform, TFile, Workspace, WorkspaceLeaf } from "obsidian";
import { StrokeStore } from "../../ink/StrokeStore";
import { InkEngine } from "../../ink/InkEngine";
import { InkStroke, InkToolState } from "../../ink/types";
import { resolveInkCanvasBudget } from "../../ink/inkBudget";
import { waitForImages } from "../../utils/dom";
import { OverlayToolbar } from "../shared/OverlayToolbar";
import { OverlayToolkit } from "../shared/OverlayToolkit";
import {
  convertStrokesFromAnnotation,
  mdLoadScale,
  reprojectStrokesToWidth
} from "./markdownGeometry";

export const MARKDOWN_OVERLAY_CLS = "mobile-ink-markdown-overlay";
export const MARKDOWN_ANNOTATING_CLS = "mobile-ink-markdown-annotating";

const RESIZE_DEBOUNCE_MS = 200;

export class MarkdownOverlayAdapter {
  private unloaded = false;
  private teardownToken = 0;
  private eventRefs: ReturnType<Workspace["on"]>[] = [];

  private activeLeaf: WorkspaceLeaf | null = null;
  private containerEl: HTMLElement | null = null;
  private drawFile: TFile | null = null;

  private overlay: HTMLElement | null = null;
  private liveCanvas: HTMLCanvasElement | null = null;
  private committedCanvas: HTMLCanvasElement | null = null;
  private engine: InkEngine | null = null;
  private toolbar: OverlayToolbar | null = null;
  private toolkit: OverlayToolkit | null = null;

  private preview: HTMLElement | null = null;
  private pageWidth = 1;
  private pageHeight = 1;
  private strokes: InkStroke[] = [];
  private annotating = false;

  private followFrame: number | null = null;
  private resizeTimer: number | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor(
    private readonly app: App,
    private readonly store: StrokeStore
  ) {}

  onload(): void {
    this.eventRefs.push(
      this.app.workspace.on("layout-change", () => this.update()),
      this.app.workspace.on("active-leaf-change", () => this.update()),
      this.app.workspace.on("file-open", () => this.update())
    );
  }

  onunload(): void {
    this.unloaded = true;
    for (const ref of this.eventRefs) this.app.workspace.offref(ref);
    this.eventRefs = [];
    void this.deactivate();
  }

  private get isActive(): boolean {
    return this.activeLeaf !== null;
  }

  private ensureBuilt(leaf: WorkspaceLeaf): boolean {
    if (this.overlay && this.toolbar && this.toolkit) return true;
    const preview = leaf.view.containerEl.querySelector<HTMLElement>(".markdown-preview-view");
    if (!preview) return false;
    this.containerEl = leaf.view.containerEl;
    this.overlay = this.containerEl.createDiv({ cls: `${MARKDOWN_OVERLAY_CLS} mobile-ink-native-overlay`, attr: { "aria-hidden": "true" } });
    this.toolkit = new OverlayToolkit(
      { app: this.app, store: this.store },
      () => this.saveAnnotation()
    );
    this.toolbar = new OverlayToolbar({
      getToolState: () => this.toolkit!.toolState,
      applyToolState: (patch) => this.applyToolState(patch),
      onUndo: () => { this.engine?.undo(); this.toolbar?.refresh(); this.toolkit?.markDirty(); },
      onRedo: () => { this.engine?.redo(); this.toolbar?.refresh(); this.toolkit?.markDirty(); },
      getOverlay: () => this.overlay,
      getWidthAnchor: () => this.toolbar?.buttons.width ?? null,
      onPenExpand: () => {
        if (this.isActive) {
          this.setAnnotating(true);
          return;
        }
        const leaf = this.app.workspace.activeLeaf;
        if (leaf) void this.activate(leaf);
      },
      onCollapse: () => this.setAnnotating(false)
    });
    this.toolbar.build(this.overlay);
    this.toolbar.setCollapsed(true);
    return true;
  }

  private update(): void {
    if (this.unloaded) return;
    const leaf = this.app.workspace.activeLeaf;
    if (this.isActive) {
      const file = leaf ? (leaf.view as unknown as { file?: TFile }).file : undefined;
      const fileChanged = !!file && this.drawFile !== file;
      if (!leaf || leaf !== this.activeLeaf || leaf.getViewState().type !== "markdown" || fileChanged) {
        void this.deactivate();
      }
      return;
    }
    const isMd = !!leaf && leaf.getViewState().type === "markdown";
    if (!isMd || !leaf) {
      if (this.toolbar) void this.deactivate();
      return;
    }
    if (!this.isReadingView(leaf)) {
      if (this.toolbar) void this.deactivate();
      return;
    }
    this.ensureBuilt(leaf);
  }

  private isReadingView(leaf: WorkspaceLeaf): boolean {
    return !!leaf.view.containerEl.querySelector<HTMLElement>(".markdown-preview-view");
  }

  private async activate(leaf: WorkspaceLeaf): Promise<void> {
    if (this.isActive) return;
    const token = ++this.teardownToken;
    const file = (leaf.view as unknown as { file?: TFile }).file;
    if (!(file instanceof TFile) || file.extension !== "md") return;

    this.activeLeaf = leaf;
    this.drawFile = file;
    this.containerEl = leaf.view.containerEl;
    const preview = this.containerEl.querySelector<HTMLElement>(".markdown-preview-view");
    if (!preview) {
      this.activeLeaf = null;
      this.drawFile = null;
      return;
    }
    if (!this.ensureBuilt(leaf)) {
      this.activeLeaf = null;
      this.drawFile = null;
      return;
    }
    this.preview = preview;
    await waitForImages(preview);
    if (token !== this.teardownToken || this.unloaded) return;

    this.pageWidth = Math.max(1, Math.round(preview.clientWidth));
    this.pageHeight = Math.max(1, Math.round(preview.scrollHeight));

    const annotation = await this.store.load(file.path, this.pageWidth, this.pageHeight);
    if (token !== this.teardownToken || this.unloaded) return;
    const scale = mdLoadScale(annotation, this.pageWidth);
    this.strokes = convertStrokesFromAnnotation(annotation.strokes, scale);

    if (getComputedStyle(preview).position === "static") preview.style.position = "relative";
    this.liveCanvas = document.createElement("canvas");
    this.committedCanvas = document.createElement("canvas");
    for (const c of [this.liveCanvas, this.committedCanvas]) {
      c.className = "mobile-ink-native-page-canvas";
      c.style.position = "absolute";
      c.style.top = "0";
      c.style.left = "0";
      c.style.touchAction = "none";
      c.style.zIndex = "3";
      preview.append(c);
    }

    // 关键：InkEngine 的“注解根”必须包含 canvas（isNodeInsideAnnotation/手势拦截都基于它），
    // 必须传 containerEl 而非滚动容器，否则所有指针事件会被判定为“注解区域外”而忽略。
    this.engine = new InkEngine(this.liveCanvas, this.committedCanvas, this.containerEl, {
      initialToolState: { ...this.toolkit!.toolState },
      canvasMaxDpr: 3,
      canvasMaxPixels: resolveInkCanvasBudget(Platform.isMobile),
      panOutsideCanvas: false,
      onInputStart: () => this.toolkit!.markDirty(),
      onChange: () => this.toolkit!.markDirty()
    });
    this.toolkit!.setActiveEngines([this.engine]);

    this.measure();
    this.refreshStrokesForViewport();
    this.setAnnotating(true);

    this.resizeObserver = new ResizeObserver(() => this.scheduleMeasure());
    this.resizeObserver.observe(preview);
  }

  private measure(): void {
    if (!this.preview) return;
    const w = Math.max(1, Math.round(this.preview.scrollWidth));
    const h = Math.max(1, Math.round(this.preview.scrollHeight));
    for (const c of [this.liveCanvas, this.committedCanvas]) {
      if (!c) continue;
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
    }
    this.engine?.resize(w, h);
    this.engine?.setDisplayScale(1);
  }

  private refreshStrokesForViewport(): void {
    if (!this.engine) return;
    this.engine.loadStrokes(this.strokes);
  }

  private scheduleMeasure(): void {
    if (this.resizeTimer !== null) return;
    this.resizeTimer = window.setTimeout(() => this.handleResize(), RESIZE_DEBOUNCE_MS);
  }

  private async handleResize(): Promise<void> {
    const preview = this.preview;
    if (this.resizeTimer !== null) { window.clearTimeout(this.resizeTimer); this.resizeTimer = null; }
    if (!this.isActive || !preview) return;
    if (this.annotating) {
      // 书写进行中重排：先收起当前笔画回逻辑坐标，重新映射后再重绘。
      this.engine?.flushPendingStrokes();
      await this.saveAnnotation();
    }
    const newWidth = Math.max(1, Math.round(preview.clientWidth));
    const newHeight = Math.max(1, Math.round(preview.scrollHeight));
    if (newWidth !== this.pageWidth) {
      this.strokes = reprojectStrokesToWidth(this.strokes, this.pageWidth, newWidth);
      this.pageWidth = newWidth;
    }
    this.pageHeight = newHeight;
    this.measure();
    if (!this.annotating) this.refreshStrokesForViewport();
  }

  private setAnnotating(value: boolean): void {
    this.annotating = value;
    for (const c of [this.liveCanvas, this.committedCanvas]) {
      if (c) c.style.pointerEvents = value ? "auto" : "none";
    }
    this.overlay?.classList.toggle(MARKDOWN_ANNOTATING_CLS, value);
    this.toolbar?.setCollapsed(!value);
    if (value && this.engine) this.engine.setInputEnabled(true);
  }

  private applyToolState(patch: Partial<InkToolState>): void {
    this.toolkit!.applyToolState(patch);
    this.toolbar?.refresh();
  }

  private async saveAnnotation(): Promise<void> {
    const file = this.drawFile;
    if (!(file instanceof TFile) || !this.engine || !this.preview) return;
    this.engine.flushPendingStrokes();
    const engineStrokes = this.engine.getStrokes();
    const logical = this.strokes.map((s) => s);
    const written = new Set<string>();
    for (const s of engineStrokes) {
      const idx = logical.findIndex((st) => st.id === s.id);
      if (idx >= 0) {
        logical[idx] = s;
        written.add(s.id);
      } else {
        logical.push(s);
        written.add(s.id);
      }
    }
    this.strokes = logical.filter((s) => written.has(s.id));
    const annotation = await this.store.load(file.path, this.pageWidth, this.pageHeight);
    annotation.pageWidth = this.pageWidth;
    annotation.pageHeight = this.pageHeight;
    annotation.strokes = this.strokes.filter((s) => s.points.length > 0);
    await this.store.save(annotation);
  }

  private async deactivate(): Promise<void> {
    const token = ++this.teardownToken;
    const leaf = this.activeLeaf;
    const containerEl = this.containerEl;
    this.activeLeaf = null;
    this.containerEl = null;
    if (this.engine) {
      this.engine.setInputEnabled(false);
      await this.toolkit?.flush();
      if (token !== this.teardownToken) return;
    }
    this.teardown(containerEl);
    this.update();
  }

  private teardown(_containerEl?: HTMLElement | null): void {
    if (this.followFrame !== null) { window.cancelAnimationFrame(this.followFrame); this.followFrame = null; }
    if (this.resizeTimer !== null) { window.clearTimeout(this.resizeTimer); this.resizeTimer = null; }
    this.preview = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.engine?.destroy();
    this.engine = null;
    this.toolkit?.setActiveEngines([]);
    this.toolbar?.teardown();
    this.toolbar = null;
    this.toolkit = null;
    this.liveCanvas = null;
    this.committedCanvas = null;
    this.overlay?.remove();
    this.overlay = null;
    this.strokes = [];
    this.annotating = false;
    this.drawFile = null;
  }

  collectDiagnostics(): Record<string, unknown> {
    return {
      active: this.isActive,
      drawFile: this.drawFile?.path ?? null,
      pageWidth: Math.round(this.pageWidth),
      pageHeight: Math.round(this.pageHeight),
      annotating: this.annotating,
      strokeCount: this.engine?.getStrokes().length ?? null,
      scrollTop: this.preview?.scrollTop ?? null
    };
  }
}