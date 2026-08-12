import { App, loadPdfJs, Notice, Platform, setIcon, TFile, Workspace, WorkspaceLeaf } from "obsidian";
import { StrokeStore } from "../../ink/StrokeStore";
import { InkEngine } from "../../ink/InkEngine";
import { InkStroke, InkToolState } from "../../ink/types";
import { resolveInkCanvasBudget } from "../../ink/inkBudget";
import { PdfJsDocument, PdfJsLib } from "../../views/annotationTypes";
import { buildUniformPageLayout, computePageSizeFromPdf, LogicalPage, LogicalPageLayout, ScreenRect } from "../../pdf/nativePdfGeometry";
import { assignStrokeToPage, convertStrokesToLogical, convertStrokesToScreen, splitStrokesByPage } from "../../pdf/overlayInkData";
import { OverlayToolbar } from "../shared/OverlayToolbar";
import { OverlayToolkit } from "../shared/OverlayToolkit";
import { OverlayEngineEntry } from "../shared/types";
import { PdfGestureLock } from "./PdfGestureLock";

export const NATIVE_PEN_BUTTON_CLS = "mobile-ink-pdf-toolbar-pen";
export const NATIVE_OVERLAY_CLS = "mobile-ink-native-overlay";
export const NATIVE_OVERLAY_PAGE_CANVAS_CLS = "mobile-ink-native-page-canvas";
export const NATIVE_ANNOTATING_CLS = "mobile-ink-native-annotating";
const SETTLE_MS = 200;

export class PdfOverlayAdapter {
  private penButton: HTMLElement | null = null;
  private currentLeaf: WorkspaceLeaf | null = null;
  private activeLeaf: WorkspaceLeaf | null = null;
  private eventRefs: ReturnType<Workspace["on"]>[] = [];

  private overlay: HTMLElement | null = null;
  private drawFile: TFile | null = null;
  private layout: LogicalPageLayout | null = null;
  private pageStrokes: Map<number, InkStroke[]> = new Map();
  private engines: OverlayEngineEntry[] = [];
  private toolbar: OverlayToolbar | null = null;
  private toolkit: OverlayToolkit | null = null;
  private zoomReadout: HTMLElement | null = null;
  private panZoomLocked = false;
  private gestureLock: PdfGestureLock | null = null;
  private blockZoomButtons: ((block: boolean) => void) | null = null;

  private followFrame: number | null = null;
  private sizeChangedAt: number | null = null;
  private teardownToken = 0;
  private retryBlockedUntil = 0;
  private unloaded = false;

  private trackScrollEl: HTMLElement | null = null;
  private trackResizeObserver: ResizeObserver | null = null;
  private lastScrollLeft = 0;
  private lastScrollTop = 0;
  private lastWinWidth = window.innerWidth;
  private lastWinHeight = window.innerHeight;
  private trackingDirty = true;
  private confirmRescanTimer: number | null = null;

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
    this.clearPenButtonRetry();
    this.gestureLock?.destroy();
    this.gestureLock = null;
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
    if (!this.penButton) this.schedulePenButtonRetry(leaf);
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

  private schedulePenButtonRetry(leaf: WorkspaceLeaf): void {
    if (this.unloaded) return;
    if (this.penButtonRetryTimer !== null) return;
    this.penButtonRetryTimer = window.setTimeout(() => {
      this.penButtonRetryTimer = null;
      if (this.unloaded) return;
      if (this.app.workspace.activeLeaf !== leaf) return;
      if (this.penButton) return;
      if (leaf !== this.currentLeaf) {
        this.currentLeaf = leaf;
      }
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

  private toggleToolbar(): void {
    if (!this.toolbar) return;
    this.toolbar.setCollapsed(!this.toolbar.isCollapsed());
  }

  private resolveScrollContainer(containerEl: HTMLElement): HTMLElement {
    const viewer = containerEl.querySelector<HTMLElement>(".pdf-viewer-container")
      ?? containerEl.querySelector<HTMLElement>(".pdf-container");
    if (viewer) return viewer;
    const scrollable: HTMLElement | null = Array.from(containerEl.querySelectorAll<HTMLElement>("*")).find((el) => {
      const s = getComputedStyle(el);
      return (s.overflowY === "auto" || s.overflowY === "scroll")
        && el.scrollHeight > el.clientHeight;
    }) ?? null;
    return scrollable ?? containerEl;
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

      this.toolkit = new OverlayToolkit(
        { app: this.app, store: this.store },
        () => this.flushSave()
      );
      this.toolbar = new OverlayToolbar({
        getToolState: () => this.toolkit!.toolState,
        applyToolState: (patch) => this.applyToolState(patch),
        onUndo: () => { for (const e of this.engines) e.engine.undo(); this.toolbar?.refresh(); this.toolkit?.markDirty(); },
        onRedo: () => { for (const e of this.engines) e.engine.redo(); this.toolbar?.refresh(); this.toolkit?.markDirty(); },
        getOverlay: () => this.overlay,
        getWidthAnchor: () => this.toolbar?.buttons.width ?? null
      });
      this.toolbar.build(this.overlay);
      const scrollEl = this.resolveScrollContainer(containerEl);
      this.trackScrollEl = scrollEl;
      this.lastScrollLeft = scrollEl.scrollLeft;
      this.lastScrollTop = scrollEl.scrollTop;
      if (typeof ResizeObserver !== "undefined") {
        this.trackResizeObserver = new ResizeObserver(() => {
          this.trackingDirty = true;
        });
        this.trackResizeObserver.observe(scrollEl);
      }
      this.gestureLock = new PdfGestureLock(scrollEl);
      this.toolbar.registerExtraButton({
        icon: "lock",
        label: "锁定缩放/平移（仅上下滚动）",
        isActive: () => this.panZoomLocked,
        onClick: () => {
          this.panZoomLocked = !this.panZoomLocked;
          this.gestureLock?.setLocked(this.panZoomLocked);
          this.blockZoomButtons?.(this.panZoomLocked);
        }
      });
      const blockZoomButtons = (block: boolean): void => {
        const toolbar = containerEl.querySelector<HTMLElement>(".pdf-toolbar");
        if (!toolbar) return;
        toolbar.querySelectorAll<HTMLElement>("button").forEach((btn) => {
          const label = (btn.getAttribute("aria-label") ?? btn.title ?? "").toLowerCase();
          const isZoom = label.includes("zoom") || label.includes("缩放") || label.includes("放大") || label.includes("缩小");
          btn.style.pointerEvents = block && isZoom ? "none" : "";
        });
      };
      this.blockZoomButtons = blockZoomButtons;
      this.blockZoomButtons(this.panZoomLocked);
      this.zoomReadout = this.overlay.createDiv({ cls: "mobile-ink-native-zoom-readout", text: "100%" });

      const pages = this.getVisiblePages(containerEl);
      for (const { el, pageNumber, rect } of pages) {
        const page = layout.pages[pageNumber - 1];
        if (!page) continue;
        this.createPageEngine(containerEl, el, page, rect);
      }
      this.linkEnginesToToolkit();

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

  private linkEnginesToToolkit(): void {
    this.toolkit?.setActiveEngines(this.engines.map((e) => e.engine));
  }

  private followTick = (): void => {
    this.followFrame = null;
    if (this.unloaded || !this.isActive) return;
    const containerEl = this.activeLeaf?.view.containerEl;
    if (!containerEl) return;

    const scrollEl = this.trackScrollEl;
    const scrollLeft = scrollEl?.scrollLeft ?? 0;
    const scrollTop = scrollEl?.scrollTop ?? 0;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const moved = scrollLeft !== this.lastScrollLeft
      || scrollTop !== this.lastScrollTop
      || width !== this.lastWinWidth
      || height !== this.lastWinHeight;
    this.lastScrollLeft = scrollLeft;
    this.lastScrollTop = scrollTop;
    this.lastWinWidth = width;
    this.lastWinHeight = height;
    if (!this.trackingDirty && !moved) {
      this.followFrame = window.requestAnimationFrame(this.followTick);
      return;
    }
    this.trackingDirty = false;

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
      entry.pageResizeObserver?.disconnect();
      entry.live.remove();
      entry.committed.remove();
      this.engines.splice(this.engines.indexOf(entry), 1);
    }
    this.linkEnginesToToolkit();

    for (const p of pages) {
      if (this.engines.some((e) => e.pageEl === p.el)) continue;
      const page = this.layout?.pages[p.pageNumber - 1];
      if (!page) continue;
      this.createPageEngine(containerEl, p.el, page, p.rect);
    }
    this.linkEnginesToToolkit();

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
    if (sizeChanged) {
      this.sizeChangedAt = performance.now();
      if (this.confirmRescanTimer === null) {
        this.confirmRescanTimer = window.setTimeout(() => {
          this.confirmRescanTimer = null;
          if (this.unloaded || !this.isActive) return;
          this.trackingDirty = true;
        }, SETTLE_MS + 50);
      }
    }

    if (this.sizeChangedAt !== null && performance.now() - this.sizeChangedAt > SETTLE_MS) {
      this.sizeChangedAt = null;
      this.relayout(containerEl);
      this.linkEnginesToToolkit();
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
      initialToolState: { ...this.toolkit!.toolState },
      canvasMaxDpr: 3,
      canvasMaxPixels: resolveInkCanvasBudget(Platform.isMobile),
      panOutsideCanvas: false,
      onInputStart: () => this.toolkit!.markDirty(),
      onChange: () => this.toolkit!.markDirty()
    });
    engine.resize(width, height);
    engine.setDisplayScale(1);
    for (const c of [live, committed]) {
      c.style.width = "100%";
      c.style.height = "100%";
    }

    const logicalStrokes = this.pageStrokes.get(page.pageNumber) ?? [];
    engine.loadStrokes(convertStrokesToScreen(logicalStrokes, page, rect));

    let pageResizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      pageResizeObserver = new ResizeObserver(() => {
        this.trackingDirty = true;
        this.sizeChangedAt = performance.now();
      });
      pageResizeObserver.observe(pageEl);
    }

    this.engines.push({ engine, page, rect, basisRect: { ...rect }, live, committed, pageEl, pageResizeObserver });
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

    const pages = this.getVisiblePages(containerEl);
    const byPage = new Map<HTMLElement, { pageNumber: number; rect: ScreenRect }>();
    for (const p of pages) byPage.set(p.el, { pageNumber: p.pageNumber, rect: p.rect });

    for (const entry of Array.from(this.engines)) {
      const match = byPage.get(entry.pageEl);
      if (!match) {
        entry.engine.destroy();
        entry.pageResizeObserver?.disconnect();
        entry.live.remove();
        entry.committed.remove();
        this.engines.splice(this.engines.indexOf(entry), 1);
        continue;
      }
      this.resizePageEngine(entry, match.rect);
    }

    for (const p of pages) {
      if (this.engines.some((e) => e.pageEl === p.el)) continue;
      const page = this.layout?.pages[p.pageNumber - 1];
      if (!page) continue;
      this.createPageEngine(containerEl, p.el, page, p.rect);
    }
  }

  private resizePageEngine(entry: OverlayEngineEntry, rect: ScreenRect): void {
    const width = Math.max(1, Math.ceil(rect.width));
    const height = Math.max(1, Math.ceil(rect.height));
    const logical = this.pageStrokes.get(entry.page.pageNumber) ?? [];
    entry.engine.resize(width, height);
    entry.engine.setDisplayScale(1);
    entry.engine.loadStrokes(convertStrokesToScreen(logical, entry.page, rect));
    for (const c of [entry.live, entry.committed]) {
      c.style.width = "100%";
      c.style.height = "100%";
    }
    entry.rect = { ...rect };
    entry.basisRect = { ...rect };
    entry.engine.setInputEnabled(true);
  }

  private applyToolState(patch: Partial<InkToolState>): void {
    this.toolkit!.applyToolState(patch);
    this.toolbar?.refresh();
  }

  private async flushSave(): Promise<void> {
    if (!this.toolkit || !this.layout) return;
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
    await this.toolkit?.flush();
    if (token !== this.teardownToken) return;
    this.teardownOverlay(containerEl);
    if (leaf) {
      this.currentLeaf = null;
    }
    this.update();
  }

  private teardownOverlay(containerEl?: HTMLElement): void {
    this.gestureLock?.destroy();
    this.gestureLock = null;
    this.panZoomLocked = false;
    this.blockZoomButtons?.(false);
    this.blockZoomButtons = null;
    this.trackResizeObserver?.disconnect();
    this.trackResizeObserver = null;
    this.trackScrollEl = null;
    if (this.confirmRescanTimer !== null) {
      window.clearTimeout(this.confirmRescanTimer);
      this.confirmRescanTimer = null;
    }
    if (this.followFrame !== null) { window.cancelAnimationFrame(this.followFrame); this.followFrame = null; }
    this.sizeChangedAt = null;
    for (const entry of this.engines) {
      entry.engine.setInputEnabled(false);
      entry.pageResizeObserver?.disconnect();
      entry.engine.destroy();
    }
    this.engines = [];
    this.pageStrokes = new Map();
    this.layout = null;
    this.drawFile = null;
    this.toolbar?.teardown();
    this.toolbar = null;
    this.toolkit = null;
    this.zoomReadout = null;
    this.overlay?.remove();
    this.overlay = null;
    if (containerEl) containerEl.classList.remove(NATIVE_ANNOTATING_CLS);
  }

  collectDiagnostics(): Record<string, unknown> {
    const leaf = this.activeLeaf;
    const containerEl = leaf?.view.containerEl;
    const layout = this.layout;
    const pages: Array<Record<string, unknown>> = [];
    containerEl?.querySelectorAll<HTMLElement>(".page").forEach((el) => {
      const r = el.getBoundingClientRect();
      const fromAttr = Number(el.getAttribute("data-page-number")) || Number(el.dataset.pageNumber);
      const pageNumber = Number.isFinite(fromAttr) && fromAttr > 0 ? fromAttr : 0;
      const entry = this.engines.find((e) => e.pageEl === el);
      pages.push({
        pageNumber,
        rect: { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) },
        canvasLocal: entry ? { width: entry.live.width, height: entry.live.height } : null,
        logical: entry
          ? { width: Math.round(entry.page.width), height: Math.round(entry.page.height), offsetY: Math.round(entry.page.offsetY) }
          : null,
        strokeCount: entry ? entry.engine.getStrokes().length : null
      });
    });
    return {
      active: this.isActive,
      drawFile: this.drawFile?.path ?? null,
      layout: layout
        ? { pageWidth: Math.round(layout.pageWidth), pageHeight: Math.round(layout.pageHeight), pages: layout.pages.length }
        : null,
      zoomReadout: this.zoomReadout?.textContent ?? null,
      trackScrollEl: this.trackScrollEl
        ? {
            tag: this.trackScrollEl.tagName.toLowerCase(),
            className: this.trackScrollEl.className ?? "",
            scrollWidth: this.trackScrollEl.scrollWidth,
            scrollHeight: this.trackScrollEl.scrollHeight,
            clientWidth: this.trackScrollEl.clientWidth,
            clientHeight: this.trackScrollEl.clientHeight,
            scrollLeft: this.trackScrollEl.scrollLeft,
            scrollTop: this.trackScrollEl.scrollTop
          }
        : null,
      engineCount: this.engines.length,
      pages
    };
  }
}