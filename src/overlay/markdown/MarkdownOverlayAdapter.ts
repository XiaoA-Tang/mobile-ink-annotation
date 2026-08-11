import { App, Platform, setIcon, TFile, Workspace, WorkspaceLeaf } from "obsidian";
import { StrokeStore } from "../../ink/StrokeStore";
import { InkEngine } from "../../ink/InkEngine";
import { InkStroke, InkToolState } from "../../ink/types";
import { resolveInkCanvasBudget } from "../../ink/inkBudget";
import { waitForImages } from "../../utils/dom";
import { OverlayToolbar } from "../shared/OverlayToolbar";
import { OverlayToolkit } from "../shared/OverlayToolkit";
import {
  convertStrokesFromAnnotation,
  fromViewportStrokeWithScroll,
  mdLoadScale,
  reprojectStrokesToWidth,
  toViewportStrokeWithScroll
} from "./markdownGeometry";

export const MARKDOWN_TITLE_BUTTON_CLS = "mobile-ink-markdown-pen";
export const MARKDOWN_OVERLAY_CLS = "mobile-ink-markdown-overlay";
export const MARKDOWN_ANNOTATING_CLS = "mobile-ink-markdown-annotating";

const RESIZE_DEBOUNCE_MS = 200;

export class MarkdownOverlayAdapter {
  private unloaded = false;
  private teardownToken = 0;
  private eventRefs: ReturnType<Workspace["on"]>[] = [];

  private currentLeaf: WorkspaceLeaf | null = null;
  private activeLeaf: WorkspaceLeaf | null = null;
  private containerEl: HTMLElement | null = null;
  private drawFile: TFile | null = null;

  private penButton: HTMLElement | null = null;
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

  private penButtonRetryTimer: number | null = null;
  private penButtonRetryCount = 0;
  private readonly penButtonRetryMs = 250;
  private readonly penButtonRetryMax = 20;

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
    this.removePenButton();
    void this.deactivate();
  }

  private get isActive(): boolean {
    return this.activeLeaf !== null;
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
      this.removePenButton();
      return;
    }
    if (!this.isReadingView(leaf)) {
      this.removePenButton();
      this.schedulePenButtonRetry(leaf);
      return;
    }
    if (leaf === this.currentLeaf && this.penButton) return;
    this.removePenButton();
    this.currentLeaf = leaf;
    this.attachPenButton(leaf);
    if (!this.penButton) this.schedulePenButtonRetry(leaf);
  }

  private isReadingView(leaf: WorkspaceLeaf): boolean {
    return !!leaf.view.containerEl.querySelector<HTMLElement>(".markdown-preview-view");
  }

  private attachPenButton(leaf: WorkspaceLeaf): void {
    if (!this.isReadingView(leaf)) return;
    const headerEl = leaf.view.containerEl.querySelector<HTMLElement>(".view-header-actions")
      ?? leaf.view.containerEl.querySelector<HTMLElement>(".view-header");
    if (!headerEl) return;
    const button = headerEl.createEl("button", {
      cls: `clickable-icon ${MARKDOWN_TITLE_BUTTON_CLS}`,
      attr: { "aria-label": "手写批注" }
    });
    setIcon(button, "pencil");
    button.addEventListener("click", () => void this.toggle(leaf));
    this.penButton = button;
  }

  private schedulePenButtonRetry(leaf: WorkspaceLeaf): void {
    if (this.unloaded) return;
    if (this.penButtonRetryTimer !== null) return;
    this.penButtonRetryTimer = window.setTimeout(() => {
      this.penButtonRetryTimer = null;
      if (this.unloaded || this.isActive) return;
      if (this.app.workspace.activeLeaf !== leaf) return;
      if (this.penButton) return;
      if (!this.isReadingView(leaf)) {
        this.penButtonRetryCount += 1;
        if (this.penButtonRetryCount < this.penButtonRetryMax) {
          this.schedulePenButtonRetry(leaf);
        }
        return;
      }
      if (leaf !== this.currentLeaf) this.currentLeaf = leaf;
      this.attachPenButton(leaf);
      if (!this.penButton) {
        this.penButtonRetryCount += 1;
        if (this.penButtonRetryCount < this.penButtonRetryMax) {
          this.schedulePenButtonRetry(leaf);
        }
      } else {
        this.penButtonRetryCount = 0;
      }
    }, this.penButtonRetryMs);
  }

  private clearPenButtonRetry(): void {
    if (this.penButtonRetryTimer !== null) {
      window.clearTimeout(this.penButtonRetryTimer);
      this.penButtonRetryTimer = null;
    }
    this.penButtonRetryCount = 0;
  }

  private removePenButton(): void {
    this.clearPenButtonRetry();
    this.penButton?.remove();
    this.penButton = null;
    this.currentLeaf = null;
  }

  private async toggle(leaf: WorkspaceLeaf): Promise<void> {
    if (this.isActive && this.activeLeaf === leaf) {
      await this.deactivate();
      this.update();
      return;
    }
    await this.activate(leaf);
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
    this.preview = preview;
    await waitForImages(preview);
    if (token !== this.teardownToken || this.unloaded) return;

    this.pageWidth = Math.max(1, Math.round(preview.clientWidth));
    this.pageHeight = Math.max(1, Math.round(preview.scrollHeight));

    const annotation = await this.store.load(file.path, this.pageWidth, this.pageHeight);
    if (token !== this.teardownToken || this.unloaded) return;
    const scale = mdLoadScale(annotation, this.pageWidth);
    this.strokes = convertStrokesFromAnnotation(annotation.strokes, scale);

    this.overlay = this.containerEl.createDiv({ cls: MARKDOWN_OVERLAY_CLS, attr: { "aria-hidden": "true" } });

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
      getWidthAnchor: () => this.toolbar?.buttons.width ?? null
    });
    this.toolbar.build(this.overlay);
    this.toolbar.setCollapsed(true);

    this.liveCanvas = document.createElement("canvas");
    this.committedCanvas = document.createElement("canvas");
    for (const c of [this.liveCanvas, this.committedCanvas]) {
      c.className = "mobile-ink-native-page-canvas";
      c.style.position = "fixed";
      c.style.zIndex = "3";
      c.style.touchAction = "none";
      this.overlay.append(c);
    }

    // 关键：InkEngine 的“注解根”必须包含 canvas（isNodeInsideAnnotation/手势拦截都基于它），
    // 必须传 containerEl 而非滚动容器，否则所有指针事件会被判定为“注解区域外”而忽略。
    this.engine = new InkEngine(this.liveCanvas, this.committedCanvas, this.containerEl, {
      initialToolState: { ...this.toolkit.toolState },
      canvasMaxDpr: 3,
      canvasMaxPixels: resolveInkCanvasBudget(Platform.isMobile),
      panOutsideCanvas: false,
      onInputStart: () => this.toolkit!.markDirty(),
      onChange: () => this.toolkit!.markDirty()
    });
    this.toolkit.setActiveEngines([this.engine]);

    this.measure();
    this.refreshStrokesForViewport();
    this.setAnnotating(false);

    this.resizeObserver = new ResizeObserver(() => this.scheduleMeasure());
    this.resizeObserver.observe(preview);
    preview.addEventListener("scroll", this.onScroll, { passive: true });

    this.followFrame = window.requestAnimationFrame(() => this.refreshStrokesForViewport());
    if (this.penButton) this.penButton.classList.add("is-active");
  }

  private onScroll = (): void => {
    if (this.followFrame !== null) return;
    this.followFrame = window.requestAnimationFrame(() => {
      this.followFrame = null;
      if (!this.isActive || !this.engine) return;
      this.armCanvasPosition();
      if (!this.annotating) this.refreshStrokesForViewport();
    });
  };

  private armCanvasPosition(): void {
    if (!this.preview || !this.liveCanvas || !this.committedCanvas) return;
    const r = this.preview.getBoundingClientRect();
    const left = Math.round(r.left - (this.preview.scrollLeft || 0));
    const top = Math.round(r.top - (this.preview.scrollTop || 0));
    for (const c of [this.liveCanvas, this.committedCanvas]) {
      c.style.left = `${left}px`;
      c.style.top = `${top}px`;
    }
  }

  private measure(): void {
    if (!this.preview) return;
    const w = Math.max(1, Math.round(this.preview.clientWidth));
    const h = Math.max(1, Math.round(this.preview.clientHeight || window.innerHeight));
    for (const c of [this.liveCanvas, this.committedCanvas]) {
      if (!c) continue;
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
    }
    this.armCanvasPosition();
    this.engine?.resize(w, h);
    this.engine?.setDisplayScale(1);
  }

  private refreshStrokesForViewport(): void {
    if (!this.engine || !this.preview) return;
    const scrollTop = Math.max(0, this.preview.scrollTop || 0);
    const scrollLeft = Math.max(0, this.preview.scrollLeft || 0);
    const cropped = this.strokes.map((s) => toViewportStrokeWithScroll(s, scrollTop, scrollLeft));
    this.engine.loadStrokes(cropped);
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
    if (!value) {
      this.refreshStrokesForViewport();
    }
  }

  private applyToolState(patch: Partial<InkToolState>): void {
    this.toolkit!.applyToolState(patch);
    this.toolbar?.refresh();
  }

  private async saveAnnotation(): Promise<void> {
    const file = this.drawFile;
    if (!(file instanceof TFile) || !this.engine || !this.preview) return;
    this.engine.flushPendingStrokes();
    const scrollTop = Math.max(0, this.preview.scrollTop || 0);
    const scrollLeft = Math.max(0, this.preview.scrollLeft || 0);
    const viewportStrokes = this.engine.getStrokes();
    const logical: InkStroke[] = this.strokes.map((s) => s);
    const written = new Set<string>();
    for (const s of viewportStrokes) {
      const page = fromViewportStrokeWithScroll(s, scrollTop, scrollLeft);
      const idx = logical.findIndex((st) => st.id === s.id);
      if (idx >= 0) {
        logical[idx] = page;
        written.add(s.id);
      } else {
        logical.push(page);
        written.add(s.id);
      }
    }
    this.strokes = logical.filter((s) => written.has(s.id));

    const annotation = await this.store.load(file.path, this.pageWidth, this.pageHeight);
    annotation.pageWidth = this.pageWidth;
    annotation.pageHeight = this.pageHeight;
    annotation.strokes = this.strokes.filter((s) => s.points.length > 0);
    await this.store.save(annotation);
    this.updateAnnotationPageSize(annotation.pageHeight);
  }

  private updateAnnotationPageSize(_pageHeight: number): void {
    // 保留钩子：后续如需把 pageHeight 写回本类字段可在此扩展。
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
    this.preview?.removeEventListener("scroll", this.onScroll);
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
    if (this.penButton) this.penButton.classList.remove("is-active");
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