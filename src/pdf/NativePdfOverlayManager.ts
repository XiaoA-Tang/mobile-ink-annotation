import { App, loadPdfJs, Notice, Platform, setIcon, TFile, Workspace, WorkspaceLeaf } from "obsidian";
import { StrokeStore } from "../ink/StrokeStore";
import { InkEngine } from "../ink/InkEngine";
import { InkStroke, InkToolState } from "../ink/types";
import { resolveInkCanvasBudget } from "../ink/inkBudget";
import { PdfJsDocument, PdfJsLib } from "../views/annotationTypes";
import { buildUniformPageLayout, computePageSizeFromPdf, LogicalPage, LogicalPageLayout, ScreenRect } from "./nativePdfGeometry";
import { assignStrokeToPage, convertStrokesToLogical, convertStrokesToScreen, splitStrokesByPage } from "./overlayInkData";

export const NATIVE_PEN_BUTTON_CLS = "mobile-ink-native-pen-button";
export const NATIVE_OVERLAY_CLS = "mobile-ink-native-overlay";
export const NATIVE_OVERLAY_CAPTURE_CLS = "mobile-ink-native-capture";
export const NATIVE_OVERLAY_PAGE_CANVAS_CLS = "mobile-ink-native-page-canvas";

export class NativePdfOverlayManager {
  private penButton: HTMLElement | null = null;
  private currentLeaf: WorkspaceLeaf | null = null;
  private drawModeLeaf: WorkspaceLeaf | null = null;
  private eventRefs: ReturnType<Workspace["on"]>[] = [];

  private overlay: HTMLElement | null = null;
  private captureLayer: HTMLElement | null = null;
  private drawFile: TFile | null = null;
  private layout: LogicalPageLayout | null = null;
  private pageStrokes: Map<number, InkStroke[]> = new Map();
  private engines: Array<{ engine: InkEngine; page: LogicalPage; rect: ScreenRect; live: HTMLCanvasElement; committed: HTMLCanvasElement }> = [];
  private toolState: InkToolState = {
    tool: "pen", color: "#111111", width: 2,
    highlighterColor: "#ffd54a", highlighterWidth: 14,
    eraserRadius: 18, acceptTouchInput: false
  };
  private saveTimer: number | null = null;
  private dirty = false;
  private _gestureCleanup: (() => void) | null = null;
  private toolbar: HTMLElement | null = null;
  private toolbarButtons: Record<string, HTMLElement> = {};
  private colorDot: HTMLElement | null = null;

  constructor(
    private readonly app: App,
    private readonly store: StrokeStore
  ) {}

  onload(): void {
    this.eventRefs.push(
      this.app.workspace.on("layout-change", () => this.update()),
      this.app.workspace.on("active-leaf-change", () => this.update())
    );
  }

  onunload(): void {
    for (const ref of this.eventRefs) this.app.workspace.offref(ref);
    this.eventRefs = [];
    this.removePenButton();
    this.teardownDrawMode();
  }

  private get activeDrawMode(): boolean {
    return this.drawModeLeaf !== null;
  }

  private update(): void {
    const leaf = this.app.workspace.activeLeaf;
    if (this.activeDrawMode) {
      if (!leaf || leaf !== this.drawModeLeaf) {
        void this.exitDrawMode();
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
  }

  private attachPenButton(leaf: WorkspaceLeaf): void {
    const button = leaf.view.containerEl.createEl("button", {
      cls: `${NATIVE_PEN_BUTTON_CLS} mobile-ink-floating-button`,
      attr: { "aria-label": "就地手写批注" }
    });
    button.style.setProperty("--mobile-ink-tool-color", this.currentInkColor());
    setIcon(button, "pencil");
    button.addEventListener("click", () => void this.enterDrawMode(leaf));
    this.penButton = button;
  }

  private removePenButton(): void {
    this.penButton?.remove();
    this.penButton = null;
    this.currentLeaf = null;
  }

  private async enterDrawMode(leaf: WorkspaceLeaf): Promise<void> {
    if (this.activeDrawMode) return;
    const file = (leaf.view as unknown as { file?: TFile }).file;
    if (!(file instanceof TFile) || file.extension !== "pdf") return;
    if (!this.overlay) {
      try {
        await this.setupDrawMode(leaf, file);
      } catch (error) {
        console.error("Mobile Ink Annotation: failed to enter draw mode", error);
        new Notice("就地书写模式启动失败: " + String(error));
        this.drawModeLeaf = null;
        this.teardownDrawMode();
        this.update();
      }
    }
  }

  private async setupDrawMode(leaf: WorkspaceLeaf, file: TFile): Promise<void> {
    const containerEl = leaf.view.containerEl;
    // 修正：进入绘画模式即记录 leaf（activeDrawMode 依赖）并移除笔按钮，否则绘画期间按钮残留、activeDrawMode 恒 false
    this.drawModeLeaf = leaf;
    this.removePenButton();
    this.drawFile = file;
    const scrollClientWidth = Math.max(320, containerEl.clientWidth || window.innerWidth);

    // 1. 逻辑布局：优先用已存 annotation 的 pageWidth/pageHeight，否则从 pdfjs 第 1 页视口推算
    let layout: LogicalPageLayout | null = null;
    const pdfjsLib = (await loadPdfJs()) as PdfJsLib;
    const data = new Uint8Array(await this.app.vault.readBinary(file));
    const pdf = (await pdfjsLib.getDocument({ data }).promise) as PdfJsDocument;
    const computed = await computePageSizeFromPdf(pdf, scrollClientWidth);
    const annotation = await this.store.load(file.path, computed.width, computed.height);
    const useSaved = Number.isFinite(annotation.pageWidth) && annotation.pageWidth > 0
      && Number.isFinite(annotation.pageHeight) && annotation.pageHeight > 0;
    const pageWidth = useSaved ? annotation.pageWidth : computed.width;
    const pageHeight = useSaved ? annotation.pageHeight : computed.height;
    layout = buildUniformPageLayout(pageWidth, pageHeight, pdf.numPages);
    this.layout = layout;

    // 2. 全部笔迹按页拆分（未分到页的兜底保留在 page1）
    this.pageStrokes = splitStrokesByPage(annotation.strokes, layout);
    const orphanStrokes = annotation.strokes.filter((s) => !assignStrokeToPage(s, layout));
    if (orphanStrokes.length > 0) {
      const p1 = this.pageStrokes.get(1) ?? [];
      this.pageStrokes.set(1, [...orphanStrokes, ...p1]);
    }

    // 3. 覆盖层 + 捕获层
    this.overlay = containerEl.createDiv({ cls: NATIVE_OVERLAY_CLS, attr: { "aria-hidden": "true" } });
    this.captureLayer = this.overlay.createDiv({ cls: NATIVE_OVERLAY_CAPTURE_CLS });
    this.buildToolbar(this.overlay);

    // 4. 可见页引擎
    const pages = this.getVisiblePages(containerEl);
    for (const { pageNumber, rect } of pages) {
      const page = layout.pages[pageNumber - 1];
      if (!page) continue;
      this.createPageEngine(containerEl, page, rect);
    }

    const blockGesture = (event: Event): void => {
      event.preventDefault();
      event.stopPropagation();
    };
    const onTouchMove = (event: TouchEvent): void => {
      if (event.touches.length >= 2) blockGesture(event);
    };
    const onWheel = (event: WheelEvent): void => blockGesture(event);
    this.captureLayer!.addEventListener("touchmove", onTouchMove, { passive: false });
    this.captureLayer!.addEventListener("wheel", onWheel, { passive: false });
    this._gestureCleanup = () => {
      this.captureLayer?.removeEventListener("touchmove", onTouchMove);
      this.captureLayer?.removeEventListener("wheel", onWheel);
    };

    this.markDirty();
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

    const actionGroup = dock.createDiv({ cls: "mobile-ink-toolbar-group" });
    addIconButton("save", "checkmark", "保存", () => void this.flushSave(), actionGroup);
    addIconButton("exit", "x", "退出", () => void this.exitDrawMode(), actionGroup);

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

  private getVisiblePages(containerEl: HTMLElement): Array<{ pageNumber: number; rect: ScreenRect }> {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // SPIKE 结论：仅用精确 .page 类，避免误配 .pdf-page-input/.pdf-page-numbers 工具栏元素
    const candidates = containerEl.querySelectorAll<HTMLElement>(".page");
    const pages: Array<{ pageNumber: number; rect: ScreenRect }> = [];
    candidates.forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > vh || rect.right < 0 || rect.left > vw) return;
      const fromAttr = Number(el.getAttribute("data-page-number")) || Number(el.dataset.pageNumber);
      const pageNumber = Number.isFinite(fromAttr) && fromAttr > 0 ? fromAttr : pages.length + 1;
      pages.push({
        pageNumber,
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
      });
    });
    return pages;
  }

  private createPageEngine(containerEl: HTMLElement, page: LogicalPage, rect: ScreenRect): void {
    const width = Math.max(1, Math.ceil(rect.width));
    const height = Math.max(1, Math.ceil(rect.height));

    const live = document.createElement("canvas");
    live.className = NATIVE_OVERLAY_PAGE_CANVAS_CLS;
    const committed = document.createElement("canvas");
    committed.className = NATIVE_OVERLAY_PAGE_CANVAS_CLS;
    for (const c of [live, committed]) {
      c.style.position = "absolute";
      c.style.left = `${rect.left}px`;
      c.style.top = `${rect.top}px`;
      c.style.width = `${width}px`;
      c.style.height = `${height}px`;
      c.style.touchAction = "none";
    }
    this.overlay!.append(live, committed);

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

    const logicalStrokes = this.pageStrokes.get(page.pageNumber) ?? [];
    engine.loadStrokes(convertStrokesToScreen(logicalStrokes, page, rect));

    this.engines.push({ engine, page, rect, live, committed });
  }

  private replacePageStrokes(pageNumber: number): void {
    const entry = this.engines.find((e) => e.page.pageNumber === pageNumber);
    if (!entry) return;
    const logical = convertStrokesToLogical(entry.engine.getStrokes(), entry.page, entry.rect);
    this.pageStrokes.set(pageNumber, logical);
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

  private async exitDrawMode(): Promise<void> {
    const leaf = this.drawModeLeaf;
    this.drawModeLeaf = null;
    await this.flushSave();
    this.teardownDrawMode();
    if (leaf) {
      this.currentLeaf = null;
      this.update();
    }
  }

  private teardownDrawMode(): void {
    if (this.saveTimer !== null) { window.clearTimeout(this.saveTimer); this.saveTimer = null; }
    this._gestureCleanup?.();
    this._gestureCleanup = null;
    for (const entry of this.engines) {
      entry.engine.destroy();
    }
    this.engines = [];
    this.pageStrokes = new Map();
    this.layout = null;
    this.drawFile = null;
    this.overlay?.remove();
    this.overlay = null;
    this.captureLayer = null;
    this.toolbar = null;
    this.toolbarButtons = {};
    this.colorDot = null;
  }
}
