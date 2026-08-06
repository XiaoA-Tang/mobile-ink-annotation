import { InkEngine } from "./InkEngine";
import { resolveInkCanvasBudget } from "./inkBudget";
import type { InkController } from "./InkController";
import type { InkStroke, InkToolState } from "./types";

const DEFAULT_TOOL_STATE: InkToolState = {
  tool: "pen",
  color: "#111111",
  width: 2,
  highlighterColor: "#ffd54a",
  highlighterWidth: 14,
  eraserRadius: 18,
  acceptTouchInput: false
};
const HISTORY_STACK_LIMIT = 40;

export type PageInkDescriptor = {
  pageNumber: number;
  pageEl: HTMLElement;
  width: number;
  height: number;
  offsetY: number;
  inputTop?: number;
  inputBottom?: number;
};

type PageInkRuntime = PageInkDescriptor & {
  committedCanvas: HTMLCanvasElement | null;
  liveCanvas: HTMLCanvasElement | null;
  engine: InkEngine | null;
};

export type PageInkControllerOptions = {
  scrollEl: HTMLElement;
  initialToolState?: Partial<InkToolState>;
  onChange: () => void;
  onInputStart?: () => void;
  onInputEnd?: () => void;
  recoverPointerOnMove?: boolean;
  panOutsideCanvas?: boolean;
  keepMarginPx?: number;
  releaseMarginPx?: number;
  getVisibleRange?: () => { top: number; bottom: number };
};

export class PageInkController implements InkController {
  private pages: PageInkRuntime[];
  private readonly pageStrokes = new Map<number, InkStroke[]>();
  private toolState: InkToolState;
  private inputEnabled = true;
  private undoStack: InkStroke[][] = [];
  private redoStack: InkStroke[][] = [];
  private lastKnownStrokes: InkStroke[] = [];
  private pendingUndoSnapshot: InkStroke[] | null = null;
  private pendingSnapshotTimer: number | null = null;
  private applying = false;
  private visibleRaf: number | null = null;
  private displayScale = 1;
  private pageObserver: IntersectionObserver | null = null;
  private observedNearPages = new Set<number>();

  constructor(
    pages: PageInkDescriptor[],
    private readonly options: PageInkControllerOptions
  ) {
    this.pages = pages.map((page) => ({
      ...page,
      committedCanvas: null,
      liveCanvas: null,
      engine: null
    }));
    this.toolState = { ...DEFAULT_TOOL_STATE, ...options.initialToolState };

    this.options.scrollEl.addEventListener("scroll", this.onScroll, { passive: true });
    this.attachPageObserver();
    this.queueVisibleRefresh();
  }

  destroy(): void {
    this.options.scrollEl.removeEventListener("scroll", this.onScroll);
    this.detachPageObserver();
    if (this.visibleRaf !== null) {
      cancelAnimationFrame(this.visibleRaf);
      this.visibleRaf = null;
    }
    this.flushPendingChangeSnapshot();

    for (const page of this.pages) {
      this.releasePageEngine(page);
    }
  }

  resize(_width: number, _height: number): void {
    this.queueVisibleRefresh();
  }

  /** Dynamically add new page tile descriptors (used when adding a new page in standalone multi-page notes) */
  addPageDescriptors(descriptors: PageInkDescriptor[]): void {
    for (const desc of descriptors) {
      const runtime: PageInkRuntime = { ...desc, committedCanvas: null, liveCanvas: null, engine: null };
      this.pages.push(runtime);
    }
    this.attachPageObserver();
    this.queueVisibleRefresh();
  }

  setDisplayScale(scale: number): void {
    const next = Math.max(1, Math.min(4, Number.isFinite(scale) ? scale : 1));
    if (Math.abs(next - this.displayScale) < 0.05) return;

    this.displayScale = next;
    for (const page of this.pages) {
      page.engine?.setDisplayScale(next);
    }
    this.queueVisibleRefresh();
  }

  loadStrokes(strokes: InkStroke[]): void {
    this.applyGlobalStrokes(strokes);
    this.undoStack = [];
    this.redoStack = [];
    this.lastKnownStrokes = cloneStrokes(strokes);
    this.queueVisibleRefresh();
  }

  replaceStrokes(strokes: InkStroke[], notify = true, undoSnapshot?: InkStroke[]): void {
    this.flushPendingChangeSnapshot();
    this.flushPendingStrokes();
    const previous = undoSnapshot ? cloneStrokes(undoSnapshot) : this.getStrokesFromPages();
    const next = cloneStrokes(strokes);

    if (notify && !strokesEqual(previous, next)) {
      this.undoStack.push(previous);
      this.redoStack = [];
      this.trimHistoryStacks();
    }

    this.applyGlobalStrokes(next);
    this.lastKnownStrokes = cloneStrokes(next);

    if (notify) {
      this.options.onChange();
    }
  }

  getStrokes(): InkStroke[] {
    this.flushPendingChangeSnapshot();
    return this.getStrokesFromPages();
  }

  flushPendingStrokes(): void {
    for (const page of this.pages) {
      if (!page.engine) continue;
      page.engine.flushPendingStrokes();
      this.syncPageFromEngine(page);
    }
    this.flushPendingChangeSnapshot();
  }

  setToolState(patch: Partial<InkToolState>): void {
    this.toolState = { ...this.toolState, ...patch };
    for (const page of this.pages) {
      page.engine?.setToolState(patch);
    }
  }

  getToolState(): InkToolState {
    return { ...this.toolState };
  }

  setInputEnabled(enabled: boolean): void {
    this.inputEnabled = enabled;
    for (const page of this.pages) {
      page.engine?.setInputEnabled(enabled);
    }
  }

  undo(): void {
    this.flushPendingChangeSnapshot();
    this.flushPendingStrokes();
    const previous = this.undoStack.pop();
    if (!previous) return;

    const current = this.getStrokesFromPages();
    this.redoStack.push(cloneStrokes(current));
    this.trimHistoryStacks();
    this.applyGlobalStrokes(previous);
    this.lastKnownStrokes = cloneStrokes(previous);
    this.options.onChange();
  }

  redo(): void {
    this.flushPendingChangeSnapshot();
    this.flushPendingStrokes();
    const next = this.redoStack.pop();
    if (!next) return;

    const current = this.getStrokesFromPages();
    this.undoStack.push(cloneStrokes(current));
    this.trimHistoryStacks();
    this.applyGlobalStrokes(next);
    this.lastKnownStrokes = cloneStrokes(next);
    this.options.onChange();
  }

  clear(): void {
    this.flushPendingChangeSnapshot();
    this.flushPendingStrokes();
    const current = this.getStrokesFromPages();
    if (current.length > 0) {
      this.undoStack.push(cloneStrokes(current));
      this.redoStack = [];
      this.trimHistoryStacks();
    }
    this.applyGlobalStrokes([]);
    this.lastKnownStrokes = [];
    this.options.onChange();
  }

  private onScroll = (): void => {
    this.queueVisibleRefresh();
  };

  private queueVisibleRefresh(): void {
    if (this.visibleRaf !== null) return;
    this.visibleRaf = requestAnimationFrame(() => {
      this.visibleRaf = null;
      this.refreshVisiblePages();
    });
  }

  private refreshVisiblePages(): void {
    if (this.pages.length === 0) return;

    const mobile = window.innerWidth <= 820 || window.matchMedia?.("(pointer: coarse)").matches === true;
    const keepMargin = this.options.keepMarginPx ?? (mobile
      ? Math.max(this.options.scrollEl.clientHeight * 0.85, 420)
      : Math.max(this.options.scrollEl.clientHeight * 1.8, 820));
    const releaseMargin = this.options.releaseMarginPx ?? keepMargin * (mobile ? 1.45 : 1.65);
    const visibleRange = this.options.getVisibleRange?.();
    const useObservedPages = this.observedNearPages.size > 0;

    for (const page of this.pages) {
      const near = useObservedPages
        ? this.observedNearPages.has(page.pageNumber)
        : visibleRange
        ? page.offsetY + page.height >= visibleRange.top - keepMargin && page.offsetY <= visibleRange.bottom + keepMargin
        : this.isPageNearViewport(page, keepMargin);
      const far = useObservedPages
        ? !this.observedNearPages.has(page.pageNumber)
        : visibleRange
        ? page.offsetY + page.height < visibleRange.top - releaseMargin || page.offsetY > visibleRange.bottom + releaseMargin
        : this.isPageFarFromViewport(page, releaseMargin);

      if (near) {
        this.ensurePageEngine(page);
      } else if (far) {
        this.releasePageEngine(page);
      }
    }
  }

  private attachPageObserver(): void {
    if (typeof IntersectionObserver === "undefined" || this.pages.length === 0) return;

    const mobile = window.innerWidth <= 820 || window.matchMedia?.("(pointer: coarse)").matches === true;
    const margin = Math.round(this.options.releaseMarginPx ?? (mobile
      ? Math.max(this.options.scrollEl.clientHeight * 0.9, 520)
      : Math.max(this.options.scrollEl.clientHeight * 1.7, 900)));
    this.pageObserver = new IntersectionObserver(this.onPageIntersection, {
      root: this.options.scrollEl,
      rootMargin: `${margin}px 0px ${margin}px 0px`,
      threshold: 0
    });

    for (const page of this.pages) {
      this.pageObserver.observe(page.pageEl);
    }
  }

  private detachPageObserver(): void {
    this.pageObserver?.disconnect();
    this.pageObserver = null;
    this.observedNearPages.clear();
  }

  private onPageIntersection = (entries: IntersectionObserverEntry[]): void => {
    let changed = false;

    for (const entry of entries) {
      const page = this.pages.find((candidate) => candidate.pageEl === entry.target);
      if (!page) continue;

      if (entry.isIntersecting) {
        if (!this.observedNearPages.has(page.pageNumber)) {
          this.observedNearPages.add(page.pageNumber);
          changed = true;
        }
        continue;
      }

      if (this.observedNearPages.delete(page.pageNumber)) {
        changed = true;
      }
      this.releasePageEngine(page);
    }

    if (changed) {
      this.queueVisibleRefresh();
    }
  };

  private isPageNearViewport(page: PageInkRuntime, margin: number): boolean {
    const scrollRect = this.options.scrollEl.getBoundingClientRect();
    const rect = page.pageEl.getBoundingClientRect();
    return rect.bottom >= scrollRect.top - margin && rect.top <= scrollRect.bottom + margin;
  }

  private isPageFarFromViewport(page: PageInkRuntime, margin: number): boolean {
    const scrollRect = this.options.scrollEl.getBoundingClientRect();
    const rect = page.pageEl.getBoundingClientRect();
    return rect.bottom < scrollRect.top - margin || rect.top > scrollRect.bottom + margin;
  }

  private ensurePageEngine(page: PageInkRuntime): void {
    if (page.engine) return;

    const committedCanvas = document.createElement("canvas");
    committedCanvas.className = "mobile-ink-committed-canvas mobile-ink-pdf-ink-canvas";
    committedCanvas.setAttribute("aria-hidden", "true");
    const liveCanvas = document.createElement("canvas");
    liveCanvas.className = "mobile-ink-live-canvas mobile-ink-pdf-ink-canvas";
    liveCanvas.setAttribute("aria-label", `PDF page ${page.pageNumber} handwriting layer`);

    page.pageEl.appendChild(committedCanvas);
    page.pageEl.appendChild(liveCanvas);

    const engine = new InkEngine(liveCanvas, committedCanvas, this.options.scrollEl, {
      initialToolState: this.toolState,
      canvasMaxDpr: this.getInkCanvasMaxDpr(),
      canvasMaxPixels: this.getInkCanvasMaxPixels(),
      inputBounds: Number.isFinite(page.inputTop) && Number.isFinite(page.inputBottom)
        ? { top: page.inputTop ?? 0, bottom: page.inputBottom ?? page.height }
        : undefined,
      recoverPointerOnMove: this.options.recoverPointerOnMove,
      panOutsideCanvas: this.options.panOutsideCanvas,
      onInputStart: this.options.onInputStart,
      onInputEnd: () => this.handlePageInputEnd(page),
      onChange: () => this.handlePageChange(page)
    });
    engine.resize(page.width, page.height);
    engine.setDisplayScale(this.displayScale);
    engine.setInputEnabled(this.inputEnabled);
    engine.loadStrokes(this.pageStrokes.get(page.pageNumber) ?? []);

    page.committedCanvas = committedCanvas;
    page.liveCanvas = liveCanvas;
    page.engine = engine;
  }

  private releasePageEngine(page: PageInkRuntime): void {
    if (!page.engine) return;

    page.engine.flushPendingStrokes();
    this.syncPageFromEngine(page);
    page.engine.destroy();
    page.engine = null;
    page.committedCanvas?.remove();
    page.liveCanvas?.remove();
    page.committedCanvas = null;
    page.liveCanvas = null;
  }

  private handlePageChange(page: PageInkRuntime): void {
    if (this.applying) return;

    if (!this.pendingUndoSnapshot) {
      this.pendingUndoSnapshot = this.lastKnownStrokes;
    }
    this.syncPageFromEngine(page);
    this.scheduleChangeSnapshot();
    this.options.onChange();
  }

  private handlePageInputEnd(page: PageInkRuntime): void {
    page.engine?.flushPendingStrokes();
    this.syncPageFromEngine(page);
    const strokes = this.getStrokesFromPages();
    this.applyGlobalStrokes(strokes);
    this.options.onInputEnd?.();
  }

  private scheduleChangeSnapshot(): void {
    if (this.pendingSnapshotTimer !== null) return;

    this.pendingSnapshotTimer = window.setTimeout(() => {
      this.pendingSnapshotTimer = null;
      this.flushPendingChangeSnapshot();
    }, 140);
  }

  private flushPendingChangeSnapshot(): void {
    if (!this.pendingUndoSnapshot) return;

    if (this.pendingSnapshotTimer !== null) {
      window.clearTimeout(this.pendingSnapshotTimer);
      this.pendingSnapshotTimer = null;
    }

    const previous = this.pendingUndoSnapshot;
    this.pendingUndoSnapshot = null;
    const current = this.getStrokesFromPages();
    if (!strokesEqual(previous, current)) {
      this.undoStack.push(cloneStrokes(previous));
      this.redoStack = [];
      this.trimHistoryStacks();
      this.lastKnownStrokes = cloneStrokes(current);
    }
  }

  private trimHistoryStacks(): void {
    if (this.undoStack.length > HISTORY_STACK_LIMIT) {
      this.undoStack.splice(0, this.undoStack.length - HISTORY_STACK_LIMIT);
    }
    if (this.redoStack.length > HISTORY_STACK_LIMIT) {
      this.redoStack.splice(0, this.redoStack.length - HISTORY_STACK_LIMIT);
    }
  }

  private syncPageFromEngine(page: PageInkRuntime): void {
    if (!page.engine) return;
    this.pageStrokes.set(page.pageNumber, page.engine.getStrokes());
  }

  private applyGlobalStrokes(strokes: InkStroke[]): void {
    const grouped = this.splitStrokesByPage(strokes);

    this.applying = true;
    try {
      for (const page of this.pages) {
        const localStrokes = grouped.get(page.pageNumber) ?? [];
        this.pageStrokes.set(page.pageNumber, cloneStrokes(localStrokes));
        page.engine?.replaceStrokes(localStrokes, false);
      }
    } finally {
      this.applying = false;
    }
  }

  private splitStrokesByPage(strokes: InkStroke[]): Map<number, InkStroke[]> {
    const grouped = new Map<number, InkStroke[]>();

    for (const stroke of strokes) {
      const page = this.findPageForStroke(stroke);
      if (!page) continue;
      const localStroke = {
        ...stroke,
        points: stroke.points.map((point) => ({
          ...point,
          y: point.y - page.offsetY
        }))
      };
      const pageStrokes = grouped.get(page.pageNumber) ?? [];
      pageStrokes.push(localStroke);
      grouped.set(page.pageNumber, pageStrokes);
    }

    return grouped;
  }

  private findPageForStroke(stroke: InkStroke): PageInkRuntime | null {
    const bounds = getStrokeBounds(stroke);
    const y = bounds ? bounds.y + bounds.height / 2 : stroke.points[0]?.y ?? 0;
    let nearest: PageInkRuntime | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const page of this.pages) {
      const primaryTop = page.offsetY + (page.inputTop ?? 0);
      const primaryBottom = page.offsetY + (page.inputBottom ?? page.height);
      if (y >= primaryTop && y < primaryBottom) {
        return page;
      }

      const distance = y < primaryTop
        ? primaryTop - y
        : y - primaryBottom;
      if (distance < nearestDistance) {
        nearest = page;
        nearestDistance = distance;
      }
    }

    return nearest;
  }

  private getStrokesFromPages(): InkStroke[] {
    const result: InkStroke[] = [];

    for (const page of this.pages) {
      if (page.engine) {
        this.syncPageFromEngine(page);
      }

      const localStrokes = this.pageStrokes.get(page.pageNumber) ?? [];
      for (const stroke of localStrokes) {
        result.push({
          ...stroke,
          points: stroke.points.map((point) => ({
            ...point,
            y: point.y + page.offsetY
          }))
        });
      }
    }

    return result;
  }

  private getInkCanvasMaxDpr(): number {
    return window.innerWidth <= 820 || window.matchMedia?.("(pointer: coarse)").matches === true ? 3 : 3.75;
  }

  private getInkCanvasMaxPixels(): number {
    return resolveInkCanvasBudget(window.innerWidth <= 820 || window.matchMedia?.("(pointer: coarse)").matches === true);
  }
}

function cloneStrokes(strokes: InkStroke[]): InkStroke[] {
  return strokes.map((stroke) => ({
    ...stroke,
    points: stroke.points.map((point) => ({ ...point }))
  }));
}

function getStrokeBounds(stroke: InkStroke): { y: number; height: number } | null {
  if (stroke.points.length === 0) return null;

  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const point of stroke.points) {
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  return {
    y: minY,
    height: Math.max(0, maxY - minY)
  };
}

function strokesEqual(a: InkStroke[], b: InkStroke[]): boolean {
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    const left = a[i];
    const right = b[i];
    if (left.id !== right.id
      || left.tool !== right.tool
      || left.color !== right.color
      || left.width !== right.width
      || left.points.length !== right.points.length) {
      return false;
    }

    for (let j = 0; j < left.points.length; j++) {
      const lp = left.points[j];
      const rp = right.points[j];
      if (lp.x !== rp.x
        || lp.y !== rp.y
        || lp.t !== rp.t
        || lp.pressure !== rp.pressure
        || lp.tiltX !== rp.tiltX
        || lp.tiltY !== rp.tiltY) {
        return false;
      }
    }
  }

  return true;
}
