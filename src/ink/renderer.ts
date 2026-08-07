import { InkPoint, InkStroke } from "./types";
import { smoothStroke } from "./smoothing";
import type { SmoothPoint } from "./smoothing";

export type CanvasSetupOptions = {
  maxDpr?: number;
  maxPixels?: number;
  displayScale?: number;
  desynchronized?: boolean;
};

export function setupCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  options: CanvasSetupOptions = {}
): CanvasRenderingContext2D {
  const deviceDpr = Math.max(1, window.devicePixelRatio || 1);
  const baseDpr = Number.isFinite(options.maxDpr) && options.maxDpr && options.maxDpr > 0
    ? Math.min(deviceDpr, options.maxDpr) : deviceDpr;
  const displayScale = Number.isFinite(options.displayScale) && options.displayScale && options.displayScale > 0
    ? options.displayScale : 1;
  
  const targetDpr = baseDpr * displayScale;
  const pixelCap = Number.isFinite(options.maxPixels) && options.maxPixels && options.maxPixels > 0
    ? options.maxPixels : Number.POSITIVE_INFINITY;
    
  const maxByPixels = Math.sqrt(pixelCap / Math.max(1, width * height));
  const dpr = Math.max(1, Math.min(targetDpr, maxByPixels));
  
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = Math.max(1, Math.ceil(width * dpr));
  canvas.height = Math.max(1, Math.ceil(height * dpr));
  
  const ctx = canvas.getContext("2d", { alpha: true, desynchronized: options.desynchronized !== false });
  if (!ctx) throw new Error("Unable to create 2D canvas context");
  
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return ctx;
}

export function clearCanvas(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
  ctx.clearRect(0, 0, width, height);
}
// ---------------------------------------------------------------------------
// Width Computation (Causal & Stable)
// ---------------------------------------------------------------------------

// Per-stroke widths cached by the (stable) smoothed point array identity.
const smoothWidthCache = new WeakMap<SmoothPoint[], Float32Array>();

function computeWidths(points: SmoothPoint[], base: number): Float32Array {
  const cached = smoothWidthCache.get(points);
  const n = points.length;
  if (cached && cached.length === n) return cached;

  const widths = new Float32Array(n);
  let prevW = base * 0.5;

  for (let i = 0; i < n; i++) {
    const p = points[i];

    const pr = Math.max(0, Math.min(1.0, p.pressure));
    const pFactor = 0.4 + pr * 0.8;

    // Geometric velocity: gap between consecutive smoothed points.
    // Larger gap = faster = thinner. No timestamps involved, so jittery
    // event clocks cannot pulse the stroke width.
    let vFactor = 1.0;
    if (p.distance > 0) {
      vFactor = Math.max(0.7, 1.0 - p.distance * 0.025);
    }

    let rawW = base * pFactor * vFactor;

    // Immediate start taper to avoid a "blob" at the very first touch.
    if (i < 3) {
      rawW *= 0.6 + 0.4 * (i / 2);
    }

    // Causal Forward EMA: width at point `i` ONLY depends on points `0..i`.
    widths[i] = i === 0 ? rawW : 0.6 * rawW + 0.4 * prevW;
    prevW = widths[i];
  }

  smoothWidthCache.set(points, widths);
  return widths;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawPenFromSmooth(
  ctx: CanvasRenderingContext2D,
  stroke: InkStroke,
  points: SmoothPoint[],
  startIndex: number
): void {
  const n = points.length;
  if (n === 0 || n <= startIndex) return;

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.globalAlpha = 1;

  // lineCap = "round" is the secret to gapless, robust ink.
  // It effectively draws a perfect capsule between points.
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const widths = computeWidths(points, stroke.width);

  if (n === 1) {
    if (startIndex === 0) {
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, widths[0] / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return;
  }

  // Draw new segments individually.
  // Overlapping opaque round-capped strokes perfectly merge without gaps.
  for (let i = startIndex; i < n - 1; i++) {
    ctx.beginPath();
    ctx.moveTo(points[i].x, points[i].y);
    ctx.lineTo(points[i + 1].x, points[i + 1].y);
    ctx.lineWidth = (widths[i] + widths[i + 1]) / 2;
    ctx.stroke();
  }

  ctx.restore();
}

function drawHighlighterFromSmooth(
  ctx: CanvasRenderingContext2D,
  stroke: InkStroke,
  points: SmoothPoint[],
  startIndex: number
): void {
  const n = points.length;
  if (n === 0 || n <= startIndex) return;

  ctx.save();
  // Multiply blending mimics real highlighters
  ctx.globalCompositeOperation = "multiply";
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = 0.35;

  // Highlighter uses a single continuous path to prevent opacity compounding at joints
  ctx.beginPath();
  ctx.moveTo(points[startIndex].x, points[startIndex].y);

  for (let i = startIndex + 1; i < n; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }

  ctx.stroke();
  ctx.restore();
}

export function drawStroke(ctx: CanvasRenderingContext2D, stroke: InkStroke): void {
  const points = smoothStroke(stroke, true);
  if (stroke.tool === "highlighter") {
    drawHighlighterFromSmooth(ctx, stroke, points, 0);
  } else {
    drawPenFromSmooth(ctx, stroke, points, 0);
  }
}

export function drawStrokeSegment(
  ctx: CanvasRenderingContext2D,
  stroke: InkStroke,
  previousPointCount: number
): void {
  const points = smoothStroke(stroke, false);
  const start = Math.max(0, previousPointCount - 1);
  if (stroke.tool === "highlighter") {
    drawHighlighterFromSmooth(ctx, stroke, points, start);
  } else {
    drawPenFromSmooth(ctx, stroke, points, start);
  }
}

export function drawStrokeFromSmooth(
  ctx: CanvasRenderingContext2D,
  stroke: InkStroke,
  points: SmoothPoint[],
  startIndex: number
): void {
  if (stroke.tool === "highlighter") {
    drawHighlighterFromSmooth(ctx, stroke, points, startIndex);
  } else {
    drawPenFromSmooth(ctx, stroke, points, startIndex);
  }
}

export function drawStrokes(ctx: CanvasRenderingContext2D, strokes: InkStroke[]): void {
  for (const stroke of strokes) {
    drawStroke(ctx, stroke);
  }
}

// ---------------------------------------------------------------------------
// Hit Testing Utilities
// ---------------------------------------------------------------------------

export function distanceSquared(a: InkPoint, b: InkPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function distancePointToSegmentSquared(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number
): number {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const lenSq = vx * vx + vy * vy;
  
  if (lenSq === 0) {
    return (px - ax) ** 2 + (py - ay) ** 2;
  }
  
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / lenSq));
  return (px - ax - t * vx) ** 2 + (py - ay - t * vy) ** 2;
}
