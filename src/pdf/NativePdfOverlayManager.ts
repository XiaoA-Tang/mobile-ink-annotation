import { App, loadPdfJs, Notice, Platform, setIcon, TFile, Workspace, WorkspaceLeaf } from "obsidian";
import { StrokeStore } from "../ink/StrokeStore";
import { InkEngine } from "../ink/InkEngine";
import { InkStroke, InkToolState } from "../ink/types";
import { resolveInkCanvasBudget } from "../ink/inkBudget";
import { PdfJsDocument, PdfJsLib } from "../views/annotationTypes";
import { buildUniformPageLayout, computePageSizeFromPdf, LogicalPage, LogicalPageLayout, ScreenRect } from "./nativePdfGeometry";
import { assignStrokeToPage, convertStrokesToLogical, convertStrokesToScreen, splitStrokesByPage } from "./overlayInkData";

export const NATIVE_PEN_BUTTON_CLS = "mobile-ink-pdf-toolbar-pen";
export const NATIVE_OVERLAY_CLS = "mobile-ink-native-overlay";
export const NATIVE_OVERLAY_PAGE_CANVAS_CLS = "mobile-ink-native-page-canvas";
export const NATIVE_ANNOTATING_CLS = "mobile-ink-native-annotating";

const SETTLE_MS = 200;

export class NativePdfOverlayManager {
  private penButton: HTMLElement | null = null;
  private currentLeaf: WorkspaceLeaf | null = null;
  private activeLeaf: WorkspaceLeaf | null = null;
  private eventRefs: ReturnType<Workspace["on"]>[] = [];

  private overlay: HTMLElement | null = null;
  private drawFile: TFile | null = null;
  private layout: LogicalPageLayout | null = null;
  private pageStrokes: Map<number, InkStroke[]> = new Map();
  private engines: Array<{
    engine: InkEngine;
    page: LogicalPage;
    rect: ScreenRect;
    basisRect: ScreenRect;
    live: HTMLCanvasElement;
    committed: HTMLCanvasElement;
    pageEl: HTMLElement;
  }> = [];
  private toolState: InkToolState = {
    tool: "pen", color: "#111111", width: 2,
    highlighterColor: "#ffd54a", highlighterWidth: 14,
    eraserRadius: 18, acceptTouchInput: false
  };
  private saveTimer: number | null = null;
  private dirty = false;
  private toolbar: HTMLElement | null = null;
  private toolbarButtons: Record<string, HTMLElement> = {};
  private colorDot: HTMLElement | null = null;
  private zoomReadout: HTMLElement | null = null;

  private followFrame: number | null = null;
  private sizeChangedAt: number | null = null;
  private teardownToken = 0;
  private retryBlockedUntil = 0;
  private unloaded = false;

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
    void this.deactivateOverlay();
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
      if (!leaf || leaf !== this.activeLeaf || leaf.getViewState().type !== "pdf" || fileChanged) {
        void this.deactivateOverlay();
      }
      return;
    }
    const isPdf = !!leaf && leaf.getViewState().type === "pdf";
    if (!isPdf || !leaf) {
      this.removePenButton();
      return;
    }
    if (leaf === this.currentLeaf && this.penButton) return;
    this.removePenButton();
    this.currentLeaf = leaf;
    this.attachPenButton(leaf);
    void this.activateOverlay(leaf);
  }

  private getPdfToolbar(containerEl: HTMLElement): HTMLElement | null {
    return containerEl.querySelector<HTMLElement>(".pdf-toolbar");
  }

  private attachPenButton(leaf: WorkspaceLeaf): void {
    const toolbar = this.getPdfToolbar(leaf.view.containerEl);
    if (!toolbar) return;
    const button = toolbar.createEl("button", {
      cls: `clickable-icon ${NATIVE_PEN_BUTTON_CLS}`,
      attr: { "aria-label": "显示/隐藏批注工具条" }
    });
    setIcon(button, "pencil");
    button.addEventListener("click", () => this.toggleToolbar());
    this.penButton = button;
  }

  private removePenButton(): void {
    this.penButton?.remove();
    this.penButton = null;
    this.currentLeaf = null;
  }

  private toggleToolbar(): void {
    this.toolbar?.classList.toggle("is-collapsed");
  }

  private async activateOverlay(leaf: WorkspaceLeaf): Promise<void> {
    if (this.isActive) return;
    if (performance.now() < this.retryBlockedUntil) return;
    const file = (leaf.view as unknown as { file?: TFile }).file;
    if (!(file instanceof TFile) || file.extension !== "pdf") return;

    const token = ++this.teardownToken;
    this.activeLeaf = leaf;
    this.drawFile = file;
    const containerEl = leaf.view.containerEl;
    try {
      const scrollClientWidth = Math.max(320, containerEl.clientWidth || window.innerWidth);
      const pdfjsLib = (await loadPdfJs()) as PdfJsLib;
      if (token !== this.teardownToken) return;
      const data = new Uint8Array(await this.app.vault.readBinary(file));
      if (token !== this.teardownToken) return;
      const pdf = (await pdfjsLib.getDocument({ data }).promise) as PdfJsDocument;
      if (token !== this.teardownToken) return;
      const computed = await computePageSizeFromPdf(pdf, scrollClientWidth);
      if (token !== this.teardownToken) return;
      const annotation = await this.store.load(file.path, computed.width, computed.height);
      if (token !== this.teardownToken) return;

      const useSaved = Number.isFinite(annotation.pageWidth) && annotation.pageWidth > 0
        && Number.isFinite(annotation.pageHeight) && annotation.pageHeight > 0;
      const pageWidth = useSaved ? annotation.pageWidth : computed.width;
      const pageHeight = useSaved ? annotation.pageHeight : computed.height;
      const layout = buildUniformPageLayout(pageWidth, pageHeight, pdf.numPages);
      this.layout = layout;

      this.pageStrokes = splitStrokesByPage(annotation.strokes, layout);
      const orphanStrokes = annotation.strokes.filter((s) => !assignStrokeToPage(s, layout));
      if (orphanStrokes.length > 0) {
        const p1 = this.pageStrokes.get(1) ?? [];
        this.pageStrokes.set(1, [...orphanStrokes, ...p1]);
      }

      this.overlay = containerEl.createDiv({ cls: NATIVE_OVERLAY_CLS, attr: { "aria-hidden": "true" } });
      containerEl.classList.add(NATIVE_ANNOTATING_CLS);
      this.buildToolbar(this.overlay);
      this.zoomReadout = this.overlay.createDiv({ cls: "mobile-ink-native-zoom-readout", text: "100%" });

      const pages = this.getVisiblePages(containerEl);
      for (const { el, pageNumber, rect } of pages) {
        const page = layout.pages[pageNumber - 1];
        if (!page) continue;
        this.createPageEngine(containerEl, el, page, rect);
      }

      this.followFrame = window.requestAnimationFrame(this.followTick);
      this.retryBlockedUntil = 0;
    } catch (error) {
      console.error("Mobile Ink Annotation: failed to activate overlay", error);
      new Notice("就地批注启动失败: " + String(error));
      if (token === this.teardownToken) {
        this.activeLeaf = null;
        this.teardownOverlay(containerEl);
        this.retryBlockedUntil = performance.now() + 3000;
        this.removePenButton();
        this.update();
      }
    }
  }

  private followTick = (): void => {
    this.followFrame = null;
    if (this.unloaded || !this.isActive) return;
    const containerEl = this.activeLeaf?.view.containerEl;
    if (!containerEl) return;
    try {
      this.syncPageTracking(containerEl);
    } catch (error) {
      console.error("Mobile Ink Annotation: overlay tracking error", error);
    }
    if (this.isActive) {
      this.followFrame = window.requestAnimationFrame(this.followTick);
    }
  };

  private syncPageTracking(containerEl: HTMLElement): void {
    const pages = this.getVisiblePages(containerEl);

    this.updateZoomReadout(pages);

    for (const entry of Array.from(this.engines)) {
      const stillVisible = pages.some((p) => p.el === entry.pageEl);
      const connected = entry.pageEl.isConnected && entry.live.isConnected;
      if (stillVisible && connected) continue;
      entry.engine.setInputEnabled(false);
      this.replacePageStrokes(entry.page.pageNumber);
      entry.engine.destroy();
      entry.live.remove();
      entry.committed.remove();
      this.engines.splice(this.engines.indexOf(entry), 1);
    }

    for (const p of pages) {
      if (this.engines.some((e) => e.pageEl === p.el)) continue;
      const page = this.layout?.pages[p.pageNumber - 1];
      if (!page) continue;
      this.createPageEngine(containerEl, p.el, page, p.rect);
    }

    let sizeChanged = false;
    for (const p of pages) {
      const entry = this.engines.find((e) => e.pageEl === p.el);
      if (!entry) continue;
      const r = p.rect;
      if (Math.abs(entry.rect.width - r.width) > 0.5 || Math.abs(entry.rect.height - r.height) > 0.5) {
        sizeChanged = true;
      }
      entry.rect = r;
    }
    if (sizeChanged) this.sizeChangedAt = performance.now();

    if (this.sizeChangedAt !== null && performance.now() - this.sizeChangedAt > SETTLE_MS) {
      this.sizeChangedAt = null;
      this.relayout(containerEl);
    }
  }

  private updateZoomReadout(pages: Array<{ el: HTMLElement; pageNumber: number; rect: ScreenRect }>): void {
    if (!this.zoomReadout) return;
    let scale = 1;
    for (const p of pages) {
      const page = this.layout?.pages[p.pageNumber - 1];
      if (!page || page.width <= 0 || p.rect.width <= 0) continue;
      scale = p.rect.width / page.width;
      break;
    }
    const percent = Math.round(scale * 100);
    const text = `${percent}%`;
    if (this.zoomReadout.textContent !== text) {
      this.zoomReadout.textContent = text;
    }
  }

  private getVisiblePages(containerEl: HTMLElement): Array<{ el: HTMLElement; pageNumber: number; rect: ScreenRect }> {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const candidates = containerEl.querySelectorAll<HTMLElement>(".page");
    const pages: Array<{ el: HTMLElement; pageNumber: number; rect: ScreenRect }> = [];
    candidates.forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > vh || rect.right < 0 || rect.left > vw) return;
      const fromAttr = Number(el.getAttribute("data-page-number")) || Number(el.dataset.pageNumber);
      const pageNumber = Number.isFinite(fromAttr) && fromAttr > 0 ? fromAttr : 0;
      if (pageNumber < 1) return;
      pages.push({ el, pageNumber, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } });
    });
    return pages;
  }

  private createPageEngine(containerEl: HTMLElement, pageEl: HTMLElement, page: LogicalPage, rect: ScreenRect): void {
    const width = Math.max(1, Math.ceil(rect.width));
    const height = Math.max(1, Math.ceil(rect.height));

    if (getComputedStyle(pageEl).position === "static") pageEl.style.position = "relative";

    const live = document.createElement("canvas");
    live.className = NATIVE_OVERLAY_PAGE_CANVAS_CLS;
    const committed = document.createElement("canvas");
    committed.className = NATIVE_OVERLAY_PAGE_CANVAS_CLS;
    for (const c of [live, committed]) {
      c.style.position = "absolute";
      c.style.top = "0";
      c.style.left = "0";
      c.style.touchAction = "none";
      c.style.zIndex = "3";
    }
    pageEl.append(live, committed);

    const engine = new InkEngine(live, committed, containerEl, {
      initialToolState: { ...this.toolState },
      canvasMaxDpr: 3,
      canvasMaxPixels: resolveInkCanvasBudget(Platform.isMobile),
      panOutsideCanvas: false,
      onInputStart: () => this.markDirty(),
      onChange: () => this.markDirty()
    });
    engine.resize(width, height);
    engine.setDisplayScale(1);
    for (const c of [live, committed]) {
      c.style.width = "100%";
      c.style.height = "100%";
    }

    const logicalStrokes = this.pageStrokes.get(page.pageNumber) ?? [];
    engine.loadStrokes(convertStrokesToScreen(logicalStrokes, page, rect));

    this.engines.push({ engine, page, rect, basisRect: { ...rect }, live, committed, pageEl });
  }

  private replacePageStrokes(pageNumber: number): void {
    const entry = this.engines.find((e) => e.page.pageNumber === pageNumber);
    if (!entry) return;
    const logical = convertStrokesToLogical(entry.engine.getStrokes(), entry.page, entry.basisRect);
    this.pageStrokes.set(pageNumber, logical);
  }

  private relayout(containerEl: HTMLElement): void {
    for (const entry of this.engines) entry.engine.setInputEnabled(false);
    for (const entry of this.engines) this.replacePageStrokes(entry.page.pageNumber);
    for (const entry of this.engines) {
      entry.engine.destroy();
      entry.live.remove();
      entry.committed.remove();
    }
    this.engines = [];
    const pages = this.getVisiblePages(containerEl);
    for (const { el, pageNumber, rect } of pages) {
      const page = this.layout?.pages[pageNumber - 1];
      if (!page) continue;
      this.createPageEngine(containerEl, el, page, rect);
    }
  }

  private buildToolbar(containerEl: HTMLElement): void {
    const bar = containerEl.createDiv({ cls: "mobile-ink-native-toolbar" });
    this.toolbar = bar;
    const dock = bar.createDiv({ cls: "mobile-ink-toolbar-dock" });

    const addToolButton = (key: string, icon: string, label: string, action: () => void, group: HTMLElement): void => {
      const btn = group.createEl("button", {
        cls: "mobile-ink-icon-button mobile-ink-tool-button",
        attr: { "aria-label": label }
      });
      setIcon(btn, icon);
      btn.addEventListener("click", action);
      this.toolbarButtons[key] = btn;
    };
    const addIconButton = (key: string, icon: string, label: string, action: () => void, group: HTMLElement): void => {
      const btn = group.createEl("button", {
        cls: "mobile-ink-icon-button",
        attr: { "aria-label": label }
      });
      setIcon(btn, icon);
      btn.addEventListener("click", action);
      this.toolbarButtons[key] = btn;
    };

    const toolGroup = dock.createDiv({ cls: "mobile-ink-toolbar-group" });
    addToolButton("pen", "pencil", "画笔", () => this.applyToolState({ tool: "pen" }), toolGroup);
    addToolButton("highlighter", "highlighter", "记号笔", () => this.applyToolState({ tool: "highlighter" }), toolGroup);
    addToolButton("eraser", "eraser", "橡皮擦", () => this.applyToolState({ tool: "eraser" }), toolGroup);

    const styleGroup = dock.createDiv({ cls: "mobile-ink-toolbar-group" });
    const colorBtn = styleGroup.createEl("button", {
      cls: "mobile-ink-current-color-button",
      attr: { "aria-label": "颜色" }
    });
    const colorDot = colorBtn.createDiv({ cls: "mobile-ink-current-color-dot" });
    colorBtn.addEventListener("click", () => this.cycleColor());
    this.toolbarButtons.color = colorBtn;
    this.colorDot = colorDot;
    addIconButton("width", "sliders-horizontal", "线条粗细", () => this.cycleWidth(), styleGroup);

    const historyGroup = dock.createDiv({ cls: "mobile-ink-toolbar-group" });
    addIconButton("undo", "undo-2", "撤销", () => {
      for (const e of this.engines) e.engine.undo();
      this.refreshToolbar();
    }, historyGroup);
    addIconButton("redo", "redo-2", "重做", () => {
      for (const e of this.engines) e.engine.redo();
      this.refreshToolbar();
    }, historyGroup);

    this.refreshToolbar();
  }

  private currentInkColor(): string {
    return this.toolState.tool === "highlighter" ? this.toolState.highlighterColor : this.toolState.color;
  }

  private refreshToolbar(): void {
    if (!this.toolbar) return;
    this.toolbar.style.setProperty("--mobile-ink-tool-color", this.currentInkColor());
    for (const key of ["pen", "highlighter", "eraser"]) {
      const el = this.toolbarButtons[key];
      if (el) el.classList.toggle("mobile-ink-active", this.toolState.tool === key);
    }
    if (this.colorDot) {
      this.colorDot.style.background = this.currentInkColor();
    }
  }

  private applyToolState(patch: Partial<InkToolState>): void {
    Object.assign(this.toolState, patch);
    for (const e of this.engines) e.engine.setToolState({ ...patch });
    this.refreshToolbar();
  }

  private cycleColor(): void {
    const palette = ["#111111", "#e53935", "#1e88e5", "#43a047", "#ffb300", "#8e24aa"];
    const current = this.toolState.tool === "highlighter" ? this.toolState.highlighterColor : this.toolState.color;
    const next = palette[(palette.indexOf(current) + 1 + palette.length) % palette.length];
    if (this.toolState.tool === "highlighter") this.applyToolState({ highlighterColor: next });
    else this.applyToolState({ color: next });
  }

  private cycleWidth(): void {
    const widths = [2, 3, 5, 8];
    const current = this.toolState.tool === "highlighter" ? this.toolState.highlighterWidth : this.toolState.width;
    const next = widths[(widths.indexOf(current) + 1) % widths.length];
    if (this.toolState.tool === "highlighter") this.applyToolState({ highlighterWidth: next });
    else this.applyToolState({ width: next });
  }

  private markDirty(): void {
    this.dirty = true;
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.flushSave(), 800);
  }

  private async flushSave(): Promise<void> {
    if (!this.dirty || !this.layout) return;
    this.dirty = false;
    if (this.saveTimer !== null) { window.clearTimeout(this.saveTimer); this.saveTimer = null; }
    const file = this.drawFile;
    if (!(file instanceof TFile)) return;
    for (const entry of this.engines) {
      this.replacePageStrokes(entry.page.pageNumber);
    }
    const rebuilt: InkStroke[] = [];
    const pageNumbers = Array.from(this.pageStrokes.keys()).sort((a, b) => a - b);
    for (const pn of pageNumbers) {
      rebuilt.push(...(this.pageStrokes.get(pn) ?? []));
    }
    const annotation = await this.store.load(file.path, this.layout.pageWidth, this.layout.pageHeight);
    annotation.strokes = rebuilt;
    await this.store.save(annotation);
  }

  private async deactivateOverlay(): Promise<void> {
    const token = ++this.teardownToken;
    const leaf = this.activeLeaf;
    const containerEl = leaf?.view.containerEl;
    this.activeLeaf = null;
    for (const entry of this.engines) entry.engine.setInputEnabled(false);
    await this.flushSave();
    if (token !== this.teardownToken) return;
    this.teardownOverlay(containerEl);
    if (leaf) {
      this.currentLeaf = null;
    }
    this.update();
  }

  private teardownOverlay(containerEl?: HTMLElement): void {
    if (this.saveTimer !== null) { window.clearTimeout(this.saveTimer); this.saveTimer = null; }
    if (this.followFrame !== null) { window.cancelAnimationFrame(this.followFrame); this.followFrame = null; }
    this.sizeChangedAt = null;
    for (const entry of this.engines) {
      entry.engine.setInputEnabled(false);
      entry.engine.destroy();
    }
    this.engines = [];
    this.pageStrokes = new Map();
    this.layout = null;
    this.drawFile = null;
    this.overlay?.remove();
    this.overlay = null;
    if (containerEl) containerEl.classList.remove(NATIVE_ANNOTATING_CLS);
    this.toolbar = null;
    this.toolbarButtons = {};
    this.colorDot = null;
    this.zoomReadout = null;
  }
}
