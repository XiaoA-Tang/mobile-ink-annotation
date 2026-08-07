import { distancePointToSegmentSquared, distanceSquared, drawStroke, drawStrokeFromSmooth, drawStrokeSegment, drawStrokes, setupCanvas } from "./renderer";
import { smoothStroke } from "./smoothing";
import { InkEngineOptions, InkPoint, InkStroke, InkToolState } from "./types";

const DEFAULT_TOOL_STATE: InkToolState = {
  tool: "pen",
  color: "#111111",
  width: 2,
  highlighterColor: "#ffd54a",
  highlighterWidth: 14,
  eraserRadius: 18,
  acceptTouchInput: false
};

const MIN_POINT_DISTANCE_SQ = 0.35 * 0.35;
const MAX_POINT_GAP_MS = 120;
const COMMIT_IDLE_MS = 300;
const CANCEL_GRACE_MS = 400;
const TOUCH_POINTER_SUPPRESSION_MS = 700;
const PEN_TOUCH_REJECTION_MS = 1200;
const MAX_PREDICTED_POINTS = 6;
const MAX_PREDICTED_EVENT_TIME_AHEAD_MS = 90;
const HISTORY_STACK_LIMIT = 40;

type CanvasPointMapping = {
  left: number;
  top: number;
  scaleX: number;
  scaleY: number;
};

export class InkEngine {
  private committedCtx: CanvasRenderingContext2D;
  private liveCtx: CanvasRenderingContext2D;
  private width = 1;
  private height = 1;
  private strokes: InkStroke[] = [];
  private undoStack: InkStroke[][] = [];
  private redoStack: InkStroke[][] = [];
  private activeStroke: InkStroke | null = null;
  private activePointerId: number | null = null;
  private activeTouchId: number | null = null;
  private panPointerId: number | null = null;
  private lastPanClientX = 0;
  private lastPanClientY = 0;
  private liveRenderRaf: number | null = null;
  private committedRenderRaf: number | null = null;
  private pendingCommitTimer: number | null = null;
  private cancelGraceTimer: number | null = null;
  private liveCanvasDirty = false;
  private predictedStrokeRendered = false;
  private pendingCommittedStrokes: InkStroke[] = [];
  private directlyRenderedStrokeIds = new Set<string>();
  private suppressTouchPointerUntil = 0;
  private suppressTouchPanUntil = 0;
  private stylusDetected = false;
  private debugMoveCounter = 0;
  private sampleTime = 0;
  private eraserChanged = false;
  private inputEnabled = true;
  private displayScale = 1;
  private toolState: InkToolState = { ...DEFAULT_TOOL_STATE };
  private activeSmoothCount = 0;

  constructor(
    private readonly liveCanvas: HTMLCanvasElement,
    private readonly committedCanvas: HTMLCanvasElement,
    private readonly scrollEl: HTMLElement,
    private readonly options: InkEngineOptions
  ) {
    this.toolState = { ...DEFAULT_TOOL_STATE, ...options.initialToolState };
    this.committedCtx = this.setupInkCanvas(committedCanvas, this.displayScale, false);
    this.liveCtx = this.setupInkCanvas(liveCanvas, this.displayScale, true);
    this.bindEvents();
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, Math.ceil(width));
    this.height = Math.max(1, Math.ceil(height));
    this.committedCtx = this.setupInkCanvas(this.committedCanvas, this.displayScale, false);
    this.liveCtx = this.setupInkCanvas(this.liveCanvas, this.displayScale, true);
    this.predictedStrokeRendered = false;
    this.renderCommittedNow();
  }

  setDisplayScale(scale: number): void {
    const next = Math.max(1, Math.min(4, Number.isFinite(scale) ? scale : 1));
    if (Math.abs(next - this.displayScale) < 0.05) return;

    this.displayScale = next;
    this.committedCtx = this.setupInkCanvas(this.committedCanvas, this.displayScale, false);
    this.liveCtx = this.setupInkCanvas(this.liveCanvas, this.displayScale, true);
    this.liveCanvasDirty = true;
    this.renderCommittedNow();
    this.renderLiveNow();
  }

  destroy(): void {
    this.liveCanvas.removeEventListener("pointermove", this.onPointerMove);
    this.liveCanvas.removeEventListener("pointerup", this.onPointerUp);
    this.liveCanvas.removeEventListener("pointercancel", this.onPointerCancel);
    this.liveCanvas.removeEventListener("lostpointercapture", this.onLostPointerCapture);
    window.removeEventListener("touchstart", this.onTouchStart, true);
    window.removeEventListener("touchmove", this.onTouchMove, true);
    window.removeEventListener("touchend", this.onTouchEnd, true);
    window.removeEventListener("touchcancel", this.onTouchCancel, true);
    window.removeEventListener("pointerdown", this.onPointerDown, true);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerCancel);
    document.removeEventListener("pointerdown", this.onPointerDown, true);
    document.removeEventListener("pointermove", this.onPointerMove, true);
    document.removeEventListener("pointerup", this.onPointerUp, true);
    document.removeEventListener("pointercancel", this.onPointerCancel, true);
    document.removeEventListener("selectstart", this.onDocumentBlockedGesture, true);
    document.removeEventListener("dragstart", this.onDocumentBlockedGesture, true);
    document.removeEventListener("contextmenu", this.onDocumentBlockedGesture, true);
    document.removeEventListener("selectionchange", this.onDocumentSelectionChange);
    document.removeEventListener("pointerdown", this.onDocumentPointerProbe, true);
    document.removeEventListener("pointermove", this.onDocumentPointerProbe, true);

    if (this.liveRenderRaf !== null) cancelAnimationFrame(this.liveRenderRaf);
    if (this.committedRenderRaf !== null) cancelAnimationFrame(this.committedRenderRaf);
    this.clearCancelGraceTimer();
    this.flushPendingCommits();
  }

  loadStrokes(strokes: InkStroke[]): void {
    this.strokes = cloneStrokes(strokes);
    this.undoStack = [];
    this.redoStack = [];
    this.renderCommittedNow();
  }

  replaceStrokes(strokes: InkStroke[], notify = true, undoSnapshot?: InkStroke[]): void {
    this.clearCancelGraceTimer();
    this.finishInterruptedInput();
    this.flushPendingCommits();
    const nextStrokes = cloneStrokes(strokes);
    if (notify) {
      this.recordUndoSnapshot(undoSnapshot ?? this.strokes, nextStrokes);
    }
    this.strokes = nextStrokes;
    this.pendingCommittedStrokes = [];
    this.directlyRenderedStrokeIds.clear();
    this.activeStroke = null;
    this.renderCommittedNow();
    this.renderLiveNow();
    if (notify) {
      this.options.onChange();
    }
  }

  getStrokes(): InkStroke[] {
    return cloneStrokes(this.strokes);
  }

  flushPendingStrokes(): void {
    this.flushPendingCommits();
  }

  setToolState(patch: Partial<InkToolState>): void {
    this.toolState = { ...this.toolState, ...patch };
  }

  getToolState(): InkToolState {
    return { ...this.toolState };
  }

  setInputEnabled(enabled: boolean): void {
    if (this.inputEnabled === enabled) return;

    if (!enabled) {
      this.clearCancelGraceTimer();
      this.finishInterruptedInput();
      this.flushPendingCommits();
    }

    this.inputEnabled = enabled;
  }

  undo(): void {
    this.flushPendingCommits();

    const previous = this.undoStack.pop();
    if (!previous) return;

    this.redoStack.push(cloneStrokes(this.strokes));
    this.trimHistoryStacks();
    this.strokes = cloneStrokes(previous);
    this.pendingCommittedStrokes = [];
    this.directlyRenderedStrokeIds.clear();
    this.activeStroke = null;
    this.renderCommittedNow();
    this.renderLiveNow();
    this.options.onChange();
  }

  redo(): void {
    this.flushPendingCommits();

    const next = this.redoStack.pop();
    if (!next) return;

    this.undoStack.push(cloneStrokes(this.strokes));
    this.trimHistoryStacks();
    this.strokes = cloneStrokes(next);
    this.pendingCommittedStrokes = [];
    this.directlyRenderedStrokeIds.clear();
    this.activeStroke = null;
    this.renderCommittedNow();
    this.renderLiveNow();
    this.options.onChange();
  }

  clear(): void {
    this.clearPredictedStroke();
    if (this.strokes.length > 0) {
      this.recordUndoSnapshot(this.strokes, []);
    }
    this.strokes = [];
    this.pendingCommittedStrokes = [];
    this.directlyRenderedStrokeIds.clear();
    this.activeStroke = null;
    this.renderCommittedSoon();
    this.options.onChange();
  }

  private bindEvents(): void {
    this.liveCanvas.addEventListener("lostpointercapture", this.onLostPointerCapture, { passive: false });
    window.addEventListener("touchstart", this.onTouchStart, { passive: false, capture: true });
    window.addEventListener("touchmove", this.onTouchMove, { passive: false, capture: true });
    window.addEventListener("touchend", this.onTouchEnd, { passive: false, capture: true });
    window.addEventListener("touchcancel", this.onTouchCancel, { passive: false, capture: true });
    document.addEventListener("pointerdown", this.onPointerDown, { passive: false, capture: true });
    document.addEventListener("pointermove", this.onPointerMove, { passive: false, capture: true });
    document.addEventListener("pointerup", this.onPointerUp, { passive: false, capture: true });
    document.addEventListener("pointercancel", this.onPointerCancel, { passive: false, capture: true });
    document.addEventListener("selectstart", this.onDocumentBlockedGesture, { capture: true });
    document.addEventListener("dragstart", this.onDocumentBlockedGesture, { capture: true });
    document.addEventListener("contextmenu", this.onDocumentBlockedGesture, { capture: true });
    document.addEventListener("selectionchange", this.onDocumentSelectionChange);
    document.addEventListener("pointerdown", this.onDocumentPointerProbe, { capture: true });
    document.addEventListener("pointermove", this.onDocumentPointerProbe, { capture: true });
  }

  private setupInkCanvas(canvas: HTMLCanvasElement, displayScale: number, desynchronized: boolean): CanvasRenderingContext2D {
    return setupCanvas(canvas, this.width, this.height, {
      maxDpr: this.options.canvasMaxDpr,
      maxPixels: this.options.canvasMaxPixels,
      displayScale,
      desynchronized
    });
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (this.isEventFromToolbar(event)) return;
    if (!this.inputEnabled) return;
    if (!this.isEventInsideAnnotation(event)) return;

    if (this.shouldIgnoreSuppressedTouchPointer(event)) {
      this.debugIgnoredPointerEvent("ignore-pointerdown", event, "suppressed-touch");
      return;
    }
    if (this.shouldRejectTouchDuringPen(event)) {
      event.preventDefault();
      event.stopPropagation();
      this.debugIgnoredPointerEvent("ignore-pointerdown", event, "pen-palm-reject");
      return;
    }
    if (!this.isClientInsideInputRegion(event.clientX, event.clientY)) {
      this.debugIgnoredPointerEvent("ignore-pointerdown", event, "outside-canvas");
      if (this.shouldPanOutsideCanvas(event)) {
        this.beginPan(event);
      }
      return;
    }

    const wantsWrite = this.shouldWrite(event);
    if (!wantsWrite) {
      this.debugIgnoredPointerEvent("ignore-pointerdown", event, "pan-mode");
    }

    if (wantsWrite && this.tryResumePointerStroke(event)) return;

    if (this.activePointerId !== null || this.activeTouchId !== null || this.panPointerId !== null) {
      if (!wantsWrite) return;
      this.finishInterruptedInput();
    }

    if (!wantsWrite) {
      this.beginPan(event);
      return;
    }

    this.startPointerStroke(event, "pointerdown");
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (this.isEventFromToolbar(event) && this.activePointerId !== event.pointerId && this.panPointerId !== event.pointerId) return;
    if (!this.inputEnabled) return;
    if (!this.isEventInsideAnnotation(event) && this.activePointerId !== event.pointerId && this.panPointerId !== event.pointerId) return;

    if (this.shouldIgnoreSuppressedTouchPointer(event)) {
      this.debugIgnoredPointerEvent("ignore-pointermove", event, "suppressed-touch");
      return;
    }
    if (this.shouldRejectTouchDuringPen(event)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (this.panPointerId === event.pointerId) {
      this.updatePan(event);
      return;
    }

    if (this.activePointerId !== event.pointerId) {
      if (this.shouldRecoverPointerStroke(event)) {
        this.startPointerStroke(event, "recover-move");
      } else if (this.shouldDebugStrayPointer(event)) {
        this.debugIgnoredPointerEvent("stray-pointermove", event, this.isClientInsideInputRegion(event.clientX, event.clientY) ? "no-active" : "outside-canvas");
      }
      return;
    }
    this.clearCancelGraceTimer();

    event.preventDefault();
    event.stopPropagation();

    if (this.toolState.tool === "eraser") {
      this.eraseAtEvent(event);
      return;
    }

    if (!this.activeStroke) return;
    this.clearPredictedStroke();
    const previousPointCount = this.activeStroke.points.length;
    this.appendEventPoints(this.activeStroke, event);
    if (event.pointerType === "pen") {
      this.notePenActivity();
    }
    this.renderLiveIncrement(this.activeStroke, previousPointCount);
    this.renderPredictedStroke(this.activeStroke, event);
    this.debugMoveCounter++;
    if (this.debugMoveCounter % 8 === 0) {
      this.debugPointerEvent("pointermove", event, this.activeStroke.points.length);
    }
    this.renderLiveSoon();
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (!this.inputEnabled) return;
    if (!this.isEventInsideAnnotation(event) && this.activePointerId !== event.pointerId && this.panPointerId !== event.pointerId) return;

    if (this.shouldIgnoreSuppressedTouchPointer(event)) return;
    if (this.shouldRejectTouchDuringPen(event)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (this.panPointerId === event.pointerId) {
      this.endPan(event);
      return;
    }

    if (this.activePointerId !== event.pointerId) return;
    this.clearCancelGraceTimer();

    event.preventDefault();
    event.stopPropagation();

    if (this.toolState.tool === "eraser") {
      this.finishEraser(event);
      return;
    }

    const stroke = this.activeStroke;
    this.clearPredictedStroke();
    if (stroke) {
      const previousPointCount = stroke.points.length;
      this.appendEventPoints(stroke, event);
      this.renderLiveIncrement(stroke, previousPointCount);
    }
    this.debugPointerEvent("pointerup", event, stroke?.points.length);
    if (event.pointerType === "pen") {
      this.notePenActivity();
    }

    this.activeStroke = null;
    this.activePointerId = null;
    this.safeReleasePointer(event.pointerId);

    if (stroke) {
      this.commitStrokeSoon(stroke);
      this.renderLiveSoon();
    }
    this.options.onInputEnd?.();
  };

  private onPointerCancel = (event: PointerEvent): void => {
    if (!this.inputEnabled) return;
    if (!this.isEventInsideAnnotation(event) && this.activePointerId !== event.pointerId && this.panPointerId !== event.pointerId) return;

    if (this.shouldIgnoreSuppressedTouchPointer(event)) return;

    if (this.panPointerId === event.pointerId) {
      this.endPan(event);
      return;
    }

    if (this.activePointerId !== event.pointerId) return;

    event.preventDefault();
    event.stopPropagation();
    this.debugPointerEvent("pointercancel", event, this.activeStroke?.points.length, "grace");
    this.clearPredictedStroke();

    if (this.toolState.tool === "eraser") {
      this.scheduleCancelFinish(() => this.finishEraserAfterCancel(event.pointerId));
      return;
    }

    this.scheduleCancelFinish(() => this.finishPointerStrokeAfterCancel(event.pointerId));
  };

  private onLostPointerCapture = (event: PointerEvent): void => {
    if (this.activePointerId !== event.pointerId && this.panPointerId !== event.pointerId) return;

    event.preventDefault();
    event.stopPropagation();
    this.debugPointerEvent("lostcapture", event, this.activeStroke?.points.length);
    this.clearPredictedStroke();
  };

  private onTouchStart = (event: TouchEvent): void => {
    if (this.isEventFromToolbar(event)) return;
    if (!this.inputEnabled) return;
    if (!this.isEventInsideAnnotation(event)) return;
    if (event.touches.length > 1) {
      if (this.activeTouchId !== null) {
        this.finishInterruptedInput();
      }
      return;
    }

    const touch = event.changedTouches.item(0);
    if (!touch) return;
    if (!this.isClientInsideInputRegion(touch.clientX, touch.clientY)) return;

    const canWrite = this.toolState.acceptTouchInput || this.shouldTreatTouchAsPen(touch);
    if (!canWrite) {
      if (performance.now() < this.suppressTouchPanUntil) {
        event.preventDefault();
        event.stopPropagation();
        this.debugTouchEvent("reject-touch-palm", touch, event);
      }
      return;
    }

    this.suppressTouchPointerUntil = performance.now() + TOUCH_POINTER_SUPPRESSION_MS;
    event.preventDefault();
    event.stopPropagation();
    this.clearTextSelection();
    this.debugTouchEvent("touchstart", touch, event);

    if (this.tryResumeTouchStroke(touch, event)) return;

    if (this.activePointerId !== null || this.activeTouchId !== null || this.panPointerId !== null) {
      this.finishInterruptedInput();
    }

    this.options.onInputStart?.();
    this.activeTouchId = touch.identifier;

    if (this.toolState.tool === "eraser") {
      this.flushPendingCommits();
      this.eraserChanged = false;
      this.eraseAtTouch(touch, event);
      return;
    }

    const stroke = this.createStroke();
    this.activeStroke = stroke;
    this.activeSmoothCount = 0;
    const previousPointCount = stroke.points.length;
    this.appendTouchPoint(stroke, touch, event);
    this.notePenActivity();
    this.renderLiveIncrement(stroke, previousPointCount);
    this.renderLiveSoon();
  };

  private onTouchMove = (event: TouchEvent): void => {
    if (!this.inputEnabled) return;
    if (this.activeTouchId === null) return;

    const touch = this.findChangedTouch(event, this.activeTouchId);
    if (!touch) return;
    this.clearCancelGraceTimer();

    this.suppressTouchPointerUntil = performance.now() + TOUCH_POINTER_SUPPRESSION_MS;
    event.preventDefault();
    event.stopPropagation();

    if (this.toolState.tool === "eraser") {
      this.eraseAtTouch(touch, event);
      return;
    }

    if (!this.activeStroke) return;
    const previousPointCount = this.activeStroke.points.length;
    this.appendTouchPoint(this.activeStroke, touch, event);
    this.notePenActivity();
    this.renderLiveIncrement(this.activeStroke, previousPointCount);
    this.debugMoveCounter++;
    if (this.debugMoveCounter % 8 === 0) {
      this.debugTouchEvent("touchmove", touch, event, this.activeStroke.points.length);
    }
    this.renderLiveSoon();
  };

  private onTouchEnd = (event: TouchEvent): void => {
    if (!this.inputEnabled) return;
    if (this.activeTouchId === null) return;

    const touch = this.findChangedTouch(event, this.activeTouchId);
    if (!touch) return;
    this.clearCancelGraceTimer();

    this.suppressTouchPointerUntil = performance.now() + TOUCH_POINTER_SUPPRESSION_MS;
    event.preventDefault();
    event.stopPropagation();

    if (this.toolState.tool === "eraser") {
      this.finishTouchEraser();
      return;
    }

    const stroke = this.activeStroke;
    if (stroke) {
      const previousPointCount = stroke.points.length;
      this.appendTouchPoint(stroke, touch, event);
      this.notePenActivity();
      this.renderLiveIncrement(stroke, previousPointCount);
    }
    this.debugTouchEvent("touchend", touch, event, stroke?.points.length);

    this.activeStroke = null;
    this.activeTouchId = null;

    if (stroke) {
      this.commitStrokeSoon(stroke);
      this.renderLiveSoon();
    }
    this.options.onInputEnd?.();
  };

  private onTouchCancel = (event: TouchEvent): void => {
    if (!this.inputEnabled) return;
    if (this.activeTouchId === null) return;

    const touch = this.findChangedTouch(event, this.activeTouchId);
    if (!touch) return;

    this.suppressTouchPointerUntil = performance.now() + TOUCH_POINTER_SUPPRESSION_MS;
    event.preventDefault();
    event.stopPropagation();
    this.debugTouchEvent("touchcancel", touch, event, this.activeStroke?.points.length, "grace");

    if (this.toolState.tool === "eraser") {
      this.scheduleCancelFinish(() => this.finishTouchEraserAfterCancel());
      return;
    }

    this.scheduleCancelFinish(() => this.finishTouchStrokeAfterCancel());
  };

  private onDocumentBlockedGesture = (event: Event): void => {
    if (this.isEventFromToolbar(event)) return;
    if (!this.inputEnabled) return;
    if (!this.isEventInsideAnnotation(event)) return;

    event.preventDefault();
    event.stopPropagation();
  };

  private onDocumentSelectionChange = (): void => {
    if (!this.inputEnabled) return;

    const selection = document.getSelection();
    if (!selection || selection.isCollapsed) return;

    const anchorNode = selection.anchorNode;
    const focusNode = selection.focusNode;
    if (this.isNodeInsideAnnotation(anchorNode) || this.isNodeInsideAnnotation(focusNode)) {
      selection.removeAllRanges();
    }
  };

  private onDocumentPointerProbe = (event: PointerEvent): void => {
    if (!this.inputEnabled) return;

    if (event.pointerType !== "pen") return;
    if (!this.isPointerInContact(event)) return;
    if (!this.isNearCanvas(event.clientX, event.clientY, 48)) return;

    if (event.type === "pointerdown") {
      this.debugIgnoredPointerEvent("probe-pointerdown", event, this.isClientInsideInputRegion(event.clientX, event.clientY) ? "inside" : "near-outside");
      return;
    }

    this.debugMoveCounter++;
    if (this.debugMoveCounter % 16 === 0 && this.activePointerId !== event.pointerId) {
      this.debugIgnoredPointerEvent("probe-pointermove", event, this.isClientInsideInputRegion(event.clientX, event.clientY) ? "inside-no-active" : "near-outside");
    }
  };

  private startPointerStroke(event: PointerEvent, name: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.clearPredictedStroke();
    this.clearTextSelection();
    this.debugPointerEvent(name, event);
    this.options.onInputStart?.();
    if (event.pointerType === "pen") {
      this.notePenActivity();
    }
    this.capturePointerIfUseful(event);
    this.activePointerId = event.pointerId;

    if (this.toolState.tool === "eraser") {
      this.flushPendingCommits();
      this.eraserChanged = false;
      this.eraseAtEvent(event);
      return;
    }

    const stroke = this.createStroke();
    this.activeStroke = stroke;
    this.activeSmoothCount = 0;
    const previousPointCount = stroke.points.length;
    this.appendEventPoints(stroke, event);
    this.renderLiveIncrement(stroke, previousPointCount);
    this.renderLiveSoon();
  }

  private shouldRecoverPointerStroke(event: PointerEvent): boolean {
    if (this.options.recoverPointerOnMove === false) return false;
    if (this.activePointerId !== null || this.activeTouchId !== null || this.panPointerId !== null) return false;
    if (!this.shouldWrite(event)) return false;
    if (!this.isPointerInContact(event)) return false;
    return this.isClientInsideInputRegion(event.clientX, event.clientY);
  }

  private isPointerInContact(event: PointerEvent): boolean {
    if (event.pointerType === "pen") return event.pressure > 0 || event.buttons !== 0;
    if (event.pointerType === "mouse") return event.buttons !== 0;
    if (event.pointerType === "touch") return event.pressure > 0 || event.buttons !== 0;
    return false;
  }

  private shouldDebugStrayPointer(event: PointerEvent): boolean {
    if (event.pointerType !== "pen") return false;
    if (!this.isPointerInContact(event)) return false;
    return this.debugMoveCounter % 8 === 0;
  }

  private tryResumePointerStroke(event: PointerEvent): boolean {
    if (this.cancelGraceTimer === null || !this.activeStroke || this.toolState.tool === "eraser") return false;

    event.preventDefault();
    event.stopPropagation();
    this.options.onInputStart?.();
    this.clearCancelGraceTimer();
    this.activeTouchId = null;
    this.activePointerId = event.pointerId;
    this.capturePointerIfUseful(event);
    const previousPointCount = this.activeStroke.points.length;
    this.appendEventPoints(this.activeStroke, event);
    if (event.pointerType === "pen") {
      this.notePenActivity();
    }
    this.renderLiveIncrement(this.activeStroke, previousPointCount);
    this.debugPointerEvent("resume-pointer", event, this.activeStroke.points.length);
    this.renderLiveSoon();
    return true;
  }

  private tryResumeTouchStroke(touch: Touch, event: TouchEvent): boolean {
    if (this.cancelGraceTimer === null || !this.activeStroke || this.toolState.tool === "eraser") return false;

    this.options.onInputStart?.();
    this.clearCancelGraceTimer();
    this.activePointerId = null;
    this.activeTouchId = touch.identifier;
    const previousPointCount = this.activeStroke.points.length;
    this.appendTouchPoint(this.activeStroke, touch, event);
    this.renderLiveIncrement(this.activeStroke, previousPointCount);
    this.debugTouchEvent("resume-touch", touch, event, this.activeStroke.points.length);
    this.renderLiveSoon();
    return true;
  }

  private scheduleCancelFinish(finish: () => void): void {
    this.clearCancelGraceTimer();
    this.cancelGraceTimer = window.setTimeout(() => {
      this.cancelGraceTimer = null;
      this.debugRaw("cancel-timeout", this.activeStroke?.points.length);
      finish();
    }, CANCEL_GRACE_MS);
  }

  private clearCancelGraceTimer(): void {
    if (this.cancelGraceTimer === null) return;

    window.clearTimeout(this.cancelGraceTimer);
    this.cancelGraceTimer = null;
  }

  private shouldWrite(event: PointerEvent): boolean {
    if (event.pointerType === "pen") {
      this.stylusDetected = true;
      return true;
    }
    if (event.pointerType === "mouse") return true;
    if (this.shouldTreatTouchPointerAsPen(event)) return true;
    if (event.pointerType === "touch" && this.toolState.acceptTouchInput) return true;
    return false;
  }

  private shouldPanOutsideCanvas(event: PointerEvent): boolean {
    return this.options.panOutsideCanvas !== false
      && event.pointerType === "mouse"
      && event.button === 0
      && event.buttons === 1;
  }

  private shouldIgnoreSuppressedTouchPointer(event: PointerEvent): boolean {
    return event.pointerType === "touch" && performance.now() < this.suppressTouchPointerUntil;
  }

  private shouldRejectTouchDuringPen(event: PointerEvent): boolean {
    return event.pointerType === "touch"
      && performance.now() < this.suppressTouchPanUntil
      && !this.shouldTreatTouchPointerAsPen(event);
  }

  private notePenActivity(): void {
    this.suppressTouchPanUntil = performance.now() + PEN_TOUCH_REJECTION_MS;
  }

  private shouldTreatTouchPointerAsPen(event: PointerEvent): boolean {
    if (event.pointerType !== "touch") return false;
    if (this.toolState.acceptTouchInput) return true;
    if (this.stylusDetected) return false;
    if (performance.now() >= this.suppressTouchPanUntil) return false;

    return this.hasFineContact(event.width, event.height, event.pressure);
  }

  private shouldTreatTouchAsPen(touch: Touch): boolean {
    if (this.toolState.acceptTouchInput) return true;

    const candidate = touch as Touch & {
      touchType?: string;
      radiusX?: number;
      radiusY?: number;
      force?: number;
    };

    if (candidate.touchType === "stylus") {
      this.stylusDetected = true;
      return true;
    }
    if (this.stylusDetected) return false;
    if (performance.now() >= this.suppressTouchPanUntil) return false;
    return this.hasFineContact(candidate.radiusX, candidate.radiusY, candidate.force);
  }

  private hasFineContact(width?: number, height?: number, pressure?: number): boolean {
    const maxSize = Math.max(width ?? 0, height ?? 0);
    const hasSmallContact = maxSize > 0 && maxSize <= 18;
    const hasPressure = pressure === undefined || pressure >= 0.02;

    return hasSmallContact && hasPressure;
  }

  private createStroke(): InkStroke {
    return {
      id: crypto.randomUUID(),
      tool: this.toolState.tool === "highlighter" ? "highlighter" : "pen",
      color: this.toolState.tool === "highlighter" ? this.toolState.highlighterColor : this.toolState.color,
      width: this.toolState.tool === "highlighter" ? this.toolState.highlighterWidth : this.toolState.width,
      points: []
    };
  }

  private beginPan(event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.panPointerId = event.pointerId;
    this.lastPanClientX = event.clientX;
    this.lastPanClientY = event.clientY;
    try {
      this.liveCanvas.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can fail when pan starts from scroll whitespace.
    }
  }

  private updatePan(event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const dx = event.clientX - this.lastPanClientX;
    const dy = event.clientY - this.lastPanClientY;
    this.scrollEl.scrollLeft -= dx;
    this.scrollEl.scrollTop -= dy;
    this.lastPanClientX = event.clientX;
    this.lastPanClientY = event.clientY;
  }

  private endPan(event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.panPointerId = null;
    this.safeReleasePointer(event.pointerId);
  }

  private appendEventPoints(stroke: InkStroke, event: PointerEvent): void {
    const coalescedEvents = typeof event.getCoalescedEvents === "function"
      ? event.getCoalescedEvents()
      : [event];
    const events = coalescedEvents.length > 0 ? coalescedEvents : [event];
    const mapping = this.getCanvasPointMapping();

    for (let i = 0; i < events.length; i++) {
      const coalesced = events[i];
      const point = this.eventToPoint(coalesced, this.nextSampleTime(), mapping);
      this.appendPoint(stroke, point);
    }

    const lastEvent = events[events.length - 1];
    if (lastEvent && (lastEvent.clientX !== event.clientX || lastEvent.clientY !== event.clientY)) {
      this.appendPoint(stroke, this.eventToPoint(event, this.nextSampleTime(), mapping));
    }
  }

  private renderPredictedStroke(stroke: InkStroke, event: PointerEvent): void {
    if (event.pointerType !== "pen") return;
    if (stroke.points.length === 0) return;

    const eventWithPrediction = event as PointerEvent & {
      getPredictedEvents?: () => PointerEvent[];
    };
    const predictedEvents = typeof eventWithPrediction.getPredictedEvents === "function"
      ? eventWithPrediction.getPredictedEvents()
      : [];
    if (!predictedEvents || predictedEvents.length === 0) return;

    const mapping = this.getCanvasPointMapping();
    const lastRealPoint = stroke.points[stroke.points.length - 1];

    // Direction baseline from the last two real points. Predicted events that
    // diverge wildly from the current motion (noisy on some Android styli) are
    // dropped to avoid the "twitching tail" ahead of the nib.
    const realBefore = stroke.points[stroke.points.length - 2];
    let baseDx = 0;
    let baseDy = 0;
    let baseDirValid = false;
    if (realBefore && lastRealPoint) {
      baseDx = lastRealPoint.x - realBefore.x;
      baseDy = lastRealPoint.y - realBefore.y;
      const baseLen = Math.hypot(baseDx, baseDy);
      baseDirValid = baseLen > 0.01;
      if (baseDirValid) {
        baseDx /= baseLen;
        baseDy /= baseLen;
      }
    }

    const predictedPoints: InkPoint[] = [];
    let lastPoint = lastRealPoint;

    for (const predicted of predictedEvents) {
      if (predicted.pointerType !== "pen") continue;
      if (!this.isClientInsideCanvas(predicted.clientX, predicted.clientY)) continue;
      if (Number.isFinite(predicted.timeStamp)
        && Number.isFinite(event.timeStamp)
        && predicted.timeStamp - event.timeStamp > MAX_PREDICTED_EVENT_TIME_AHEAD_MS) {
        continue;
      }

      const point = this.eventToPoint(predicted, Math.max(lastPoint.t + 0.001, performance.now()), mapping);
      if (distanceSquared(lastPoint, point) < MIN_POINT_DISTANCE_SQ) continue;

      // Direction check: reject predictions that change heading too sharply.
      if (baseDirValid) {
        const dx = point.x - lastRealPoint.x;
        const dy = point.y - lastRealPoint.y;
        const len = Math.hypot(dx, dy);
        if (len > 0.5) {
          const dot = (dx / len) * baseDx + (dy / len) * baseDy;
          if (dot < 0.45) continue;
        }
      }

      predictedPoints.push(point);
      lastPoint = point;
      if (predictedPoints.length >= MAX_PREDICTED_POINTS) break;
    }

    if (predictedPoints.length === 0) return;

    const predictedStroke: InkStroke = {
      ...stroke,
      points: [lastRealPoint, ...predictedPoints]
    };
    drawStrokeSegment(this.liveCtx, predictedStroke, 1);
    this.predictedStrokeRendered = true;
  }

  private clearPredictedStroke(): void {
    if (!this.predictedStrokeRendered) return;

    this.clearLiveCanvas();
  }

  private appendTouchPoint(stroke: InkStroke, touch: Touch, event: TouchEvent): void {
    const candidate = touch as Touch & { force?: number };
    const mapping = this.getCanvasPointMapping();
    this.appendPoint(stroke, this.clientToPoint(
      touch.clientX,
      touch.clientY,
      this.nextSampleTime(),
      Number.isFinite(candidate.force) && candidate.force !== undefined && candidate.force > 0 ? candidate.force : 0.5,
      mapping
    ));
  }

  private appendPoint(stroke: InkStroke, point: InkPoint): void {
    const last = stroke.points[stroke.points.length - 1];
    if (last) {
      const gap = point.t - last.t;
      if (distanceSquared(last, point) < MIN_POINT_DISTANCE_SQ && gap < MAX_POINT_GAP_MS) {
        return;
      }
    }
    stroke.points.push(point);
  }

  private eventToPoint(event: PointerEvent, timeStamp = this.nextSampleTime(), mapping = this.getCanvasPointMapping()): InkPoint {
    return this.clientToPoint(
      event.clientX,
      event.clientY,
      timeStamp,
      Number.isFinite(event.pressure) && event.pressure > 0 ? event.pressure : 0.5,
      mapping,
      event.tiltX,
      event.tiltY
    );
  }

  private clientToPoint(clientX: number, clientY: number, timeStamp: number, pressure: number, mapping = this.getCanvasPointMapping(), tiltX?: number, tiltY?: number): InkPoint {
    return {
      x: (clientX - mapping.left) * mapping.scaleX,
      y: (clientY - mapping.top) * mapping.scaleY,
      t: timeStamp,
      pressure,
      tiltX,
      tiltY
    };
  }

  private getCanvasPointMapping(): CanvasPointMapping {
    const rect = this.liveCanvas.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      scaleX: this.width / Math.max(1, rect.width),
      scaleY: this.height / Math.max(1, rect.height)
    };
  }

  private isClientInsideCanvas(clientX: number, clientY: number): boolean {
    const rect = this.liveCanvas.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  }

  private isClientInsideInputRegion(clientX: number, clientY: number): boolean {
    if (!this.isClientInsideCanvas(clientX, clientY)) return false;
    if (this.toolState.tool === "eraser") return true;

    const bounds = this.options.inputBounds;
    if (!bounds) return true;

    const rect = this.liveCanvas.getBoundingClientRect();
    const scaleY = this.height / Math.max(1, rect.height);
    const localY = (clientY - rect.top) * scaleY;
    const top = Math.max(0, Math.min(this.height, bounds.top));
    const bottom = Math.max(top, Math.min(this.height, bounds.bottom));
    return localY >= top && localY < bottom;
  }

  private isNearCanvas(clientX: number, clientY: number, margin: number): boolean {
    const rect = this.liveCanvas.getBoundingClientRect();
    return clientX >= rect.left - margin
      && clientX <= rect.right + margin
      && clientY >= rect.top - margin
      && clientY <= rect.bottom + margin;
  }

  private isEventInsideAnnotation(event: Event): boolean {
    const target = event.target;
    return target instanceof Node && this.isNodeInsideAnnotation(target);
  }

  private isEventFromToolbar(event: Event): boolean {
    const target = event.target;
    if (!(target instanceof Element)) return false;

    if (target.closest(".mobile-ink-toolbar, .mobile-ink-pdf-page-nav, .mobile-ink-native-toolbar")) return true;

    if (target.closest(".mobile-ink-object-control, .mobile-ink-object-resize-handle, .mobile-ink-object-delete")) {
      return true;
    }

    return false;
  }

  private isNodeInsideAnnotation(node: Node | null): boolean {
    if (!node) return false;

    const root = this.scrollEl.closest(".mobile-ink-root");
    return !!root
      ? root.contains(node)
      : this.scrollEl.contains(node) || this.liveCanvas.contains(node) || this.committedCanvas.contains(node);
  }

  private clearTextSelection(): void {
    document.getSelection()?.removeAllRanges();
  }

  private nextSampleTime(): number {
    const now = performance.now();
    this.sampleTime = Math.max(now, this.sampleTime + 0.001);
    return this.sampleTime;
  }

  private debugPointerEvent(name: string, event: PointerEvent, points?: number, detail?: string): void {
    this.options.onDebug?.({
      time: performance.now(),
      name,
      pointerType: event.pointerType,
      pointerId: event.pointerId,
      points,
      x: event.clientX,
      y: event.clientY,
      detail
    });
  }

  private debugIgnoredPointerEvent(name: string, event: PointerEvent, reason: string): void {
    if (event.pointerType !== "pen" && event.pointerType !== "touch") return;

    this.options.onDebug?.({
      time: performance.now(),
      name,
      pointerType: event.pointerType,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      detail: `${reason} ${this.describeEventTarget(event)}`
    });
  }

  private debugTouchEvent(name: string, touch: Touch, event: TouchEvent, points?: number, detail?: string): void {
    this.options.onDebug?.({
      time: performance.now(),
      name,
      touchId: touch.identifier,
      points,
      x: touch.clientX,
      y: touch.clientY,
      detail: detail ?? `touches=${event.touches.length}`
    });
  }

  private debugStroke(name: string, stroke: InkStroke): void {
    const last = stroke.points[stroke.points.length - 1];
    this.options.onDebug?.({
      time: performance.now(),
      name,
      points: stroke.points.length,
      x: last?.x,
      y: last?.y,
      detail: stroke.tool
    });
  }

  private debugRaw(name: string, points?: number, detail?: string): void {
    this.options.onDebug?.({
      time: performance.now(),
      name,
      points,
      detail
    });
  }

  private recordUndoSnapshot(previous: InkStroke[], next?: InkStroke[]): void {
    if (next && strokesEqual(previous, next)) return;

    this.undoStack.push(cloneStrokes(previous));
    this.redoStack = [];
    this.trimHistoryStacks();
  }

  private trimHistoryStacks(): void {
    if (this.undoStack.length > HISTORY_STACK_LIMIT) {
      this.undoStack.splice(0, this.undoStack.length - HISTORY_STACK_LIMIT);
    }
    if (this.redoStack.length > HISTORY_STACK_LIMIT) {
      this.redoStack.splice(0, this.redoStack.length - HISTORY_STACK_LIMIT);
    }
  }

  private describeEventTarget(event: Event): string {
    const target = event.target;
    if (!(target instanceof Element)) return "target=?";

    const className = typeof target.className === "string" ? target.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
    const id = target.id ? `#${target.id}` : "";
    return `target=${target.tagName.toLowerCase()}${id}${className ? `.${className}` : ""}`;
  }

  private commitStroke(stroke: InkStroke): void {
    if (stroke.points.length === 0) return;

    if (stroke.points.length === 1) {
      const p = stroke.points[0];
      stroke.points.push({ ...p, x: p.x + 0.1, y: p.y + 0.1 });
    }

    this.recordUndoSnapshot(this.strokes);
    this.strokes.push({ ...stroke, points: stroke.points.map((point) => ({ ...point })) });
    this.directlyRenderedStrokeIds.delete(stroke.id);
    this.options.onStrokeCommit?.(stroke);
    this.debugStroke("commit", stroke);
    this.options.onChange();
  }

  private renderLiveSoon(): void {
    if (!this.liveCanvasDirty) return;
    if (this.liveRenderRaf !== null) return;
    this.liveRenderRaf = requestAnimationFrame(() => {
      this.liveRenderRaf = null;
      this.renderLiveNow();
    });
  }

  private renderLiveNow(): void {
    if (!this.liveCanvasDirty) return;
    this.clearLiveCanvas();
    this.liveCanvasDirty = false;
  }

  private renderLiveIncrement(stroke: InkStroke, _previousRawCount: number): void {
    this.directlyRenderedStrokeIds.add(stroke.id);
    const points = smoothStroke(stroke, false);
    const start = Math.max(0, this.activeSmoothCount - 1);
    if (points.length > start) {
      drawStrokeFromSmooth(this.committedCtx, stroke, points, start);
    }
    this.activeSmoothCount = points.length;
  }

  private renderCommittedSoon(): void {
    if (this.committedRenderRaf !== null) return;
    this.committedRenderRaf = requestAnimationFrame(() => {
      this.committedRenderRaf = null;
      this.renderCommittedNow();
    });
  }

  private renderCommittedNow(): void {
    this.clearPredictedStroke();
    this.clearCommittedCanvas();
    drawStrokes(this.committedCtx, this.strokes);
    drawStrokes(this.committedCtx, this.pendingCommittedStrokes);
    for (const stroke of this.pendingCommittedStrokes) {
      this.directlyRenderedStrokeIds.add(stroke.id);
    }
    if (this.activeStroke) {
      drawStroke(this.committedCtx, this.activeStroke);
      this.directlyRenderedStrokeIds.add(this.activeStroke.id);
    }
  }

  private clearLiveCanvas(): void {
    this.liveCtx.clearRect(0, 0, this.width, this.height);
    this.predictedStrokeRendered = false;
  }

  private clearCommittedCanvas(): void {
    this.committedCtx.clearRect(0, 0, this.width, this.height);
  }

  private eraseAtEvent(event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const coalescedEvents = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [event];
    const mapping = this.getCanvasPointMapping();
    let changed = false;
    for (const coalesced of coalescedEvents) {
      const point = this.eventToPoint(coalesced, this.nextSampleTime(), mapping);
      changed = this.eraseAtPoint(point) || changed;
    }

    if (changed) {
      this.eraserChanged = true;
      this.renderCommittedSoon();
    }
  }

  private eraseAtTouch(touch: Touch, event: TouchEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const point = this.clientToPoint(
      touch.clientX,
      touch.clientY,
      Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now(),
      0.5,
      this.getCanvasPointMapping()
    );

    if (this.eraseAtPoint(point)) {
      this.eraserChanged = true;
      this.renderCommittedSoon();
    }
  }

  private eraseAtPoint(point: InkPoint): boolean {
    const radiusSq = this.toolState.eraserRadius * this.toolState.eraserRadius;
    const before = this.strokes.length;

    this.strokes = this.strokes.filter((stroke) => !strokeIntersectsCircle(stroke, point.x, point.y, radiusSq));
    return this.strokes.length !== before;
  }

  private finishEraser(event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();

    this.activePointerId = null;
    this.safeReleasePointer(event.pointerId);

    if (this.eraserChanged) {
      this.redoStack = [];
      this.options.onChange();
    }

    this.eraserChanged = false;
    this.options.onInputEnd?.();
  }

  private finishEraserAfterCancel(pointerId: number): void {
    this.activePointerId = null;
    this.safeReleasePointer(pointerId);

    if (this.eraserChanged) {
      this.redoStack = [];
      this.options.onChange();
    }

    this.eraserChanged = false;
    this.options.onInputEnd?.();
  }

  private finishTouchEraser(): void {
    this.activeTouchId = null;

    if (this.eraserChanged) {
      this.redoStack = [];
      this.options.onChange();
    }

    this.eraserChanged = false;
    this.options.onInputEnd?.();
  }

  private finishPointerStrokeAfterCancel(pointerId: number): void {
    const stroke = this.activeStroke;

    this.activeStroke = null;
    this.activePointerId = null;
    this.safeReleasePointer(pointerId);

    if (stroke && stroke.points.length > 1) {
      this.commitStrokeSoon(stroke);
      this.renderLiveSoon();
    }
    this.options.onInputEnd?.();
  }

  private finishTouchStrokeAfterCancel(): void {
    const stroke = this.activeStroke;

    this.activeStroke = null;
    this.activeTouchId = null;

    if (stroke && stroke.points.length > 1) {
      this.commitStrokeSoon(stroke);
      this.renderLiveSoon();
    }
    this.options.onInputEnd?.();
  }

  private finishTouchEraserAfterCancel(): void {
    this.activeTouchId = null;

    if (this.eraserChanged) {
      this.redoStack = [];
      this.options.onChange();
    }

    this.eraserChanged = false;
    this.options.onInputEnd?.();
  }

  private finishInterruptedInput(): void {
    this.clearCancelGraceTimer();
    this.clearPredictedStroke();
    const activePointerId = this.activePointerId;
    const activeTouchId = this.activeTouchId;
    const panPointerId = this.panPointerId;
    const stroke = this.activeStroke;
    const eraserChanged = this.eraserChanged;

    this.activeStroke = null;
    this.activePointerId = null;
    this.activeTouchId = null;
    this.panPointerId = null;
    this.eraserChanged = false;

    if (activePointerId !== null) {
      this.safeReleasePointer(activePointerId);
    }

    if (panPointerId !== null) {
      this.safeReleasePointer(panPointerId);
    }

    if (stroke && stroke.points.length > 0) {
      this.commitStrokeSoon(stroke);
      this.renderLiveSoon();
    } else if (eraserChanged) {
      this.redoStack = [];
      this.options.onChange();
    }
    if (activePointerId !== null || activeTouchId !== null || stroke || eraserChanged) {
      this.options.onInputEnd?.();
    }
  }

  private safeReleasePointer(pointerId: number): void {
    try {
      if (this.liveCanvas.hasPointerCapture(pointerId)) {
        this.liveCanvas.releasePointerCapture(pointerId);
      }
    } catch {
      // Ignore browser-specific pointer capture release errors.
    }
  }

  private capturePointerIfUseful(event: PointerEvent): void {
    if (event.pointerType !== "mouse") return;

    try {
      this.liveCanvas.setPointerCapture(event.pointerId);
    } catch {
      // Ignore browser-specific pointer capture errors.
    }
  }

  private commitStrokeSoon(stroke: InkStroke): void {
    this.pendingCommittedStrokes.push(stroke);
    if (this.pendingCommitTimer !== null) return;
    this.schedulePendingCommitFlush();
  }

  private flushPendingCommits(): void {
    if (this.activeStroke) {
      this.schedulePendingCommitFlush();
      return;
    }

    if (this.pendingCommitTimer !== null) {
      window.clearTimeout(this.pendingCommitTimer);
      this.pendingCommitTimer = null;
    }

    const strokes = this.pendingCommittedStrokes.splice(0);
    for (const stroke of strokes) {
      this.commitStroke(stroke);
    }

    // Full redraw snaps each committed stroke's end to the exact lift point
    // (live drawing smooths the last point with last:false).
    this.renderCommittedNow();
  }

  private schedulePendingCommitFlush(): void {
    if (this.pendingCommitTimer !== null) {
      window.clearTimeout(this.pendingCommitTimer);
    }

    this.pendingCommitTimer = window.setTimeout(() => {
      this.flushPendingCommits();
    }, COMMIT_IDLE_MS);
  }

  private findChangedTouch(event: TouchEvent, identifier: number): Touch | null {
    for (let i = 0; i < event.changedTouches.length; i++) {
      const touch = event.changedTouches.item(i);
      if (touch?.identifier === identifier) return touch;
    }

    return null;
  }
}

function cloneStrokes(strokes: InkStroke[]): InkStroke[] {
  return strokes.map((stroke) => ({
    ...stroke,
    points: stroke.points.map((point) => ({ ...point }))
  }));
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

function strokeIntersectsCircle(stroke: InkStroke, cx: number, cy: number, radiusSq: number): boolean {
  const points = stroke.points;
  if (points.length === 0) return false;

  if (points.length === 1) {
    const p = points[0];
    const dx = p.x - cx;
    const dy = p.y - cy;
    return dx * dx + dy * dy <= radiusSq;
  }

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (distancePointToSegmentSquared(cx, cy, a.x, a.y, b.x, b.y) <= radiusSq) {
      return true;
    }
  }

  return false;
}
