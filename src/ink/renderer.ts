import { InkPoint, InkStroke } from "./types";

export type CanvasSetupOptions = {
  maxDpr?: number;
  maxPixels?: number;
  displayScale?: number;
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
  
  const ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
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

// Per-stroke cached widths, keyed by the stroke object identity.
// The stroke is mutated in place while it is being drawn (points appended),
// so we track the computed length and only recompute newly appended points.
const strokeWidthCache = new WeakMap<InkStroke, Float32Array>();
const strokeSpeedCache = new WeakMap<InkStroke, number>();

function computeWidths(stroke: InkStroke, base: number, startIndex: number): Float32Array {
  const points = stroke.points;
  const n = points.length;
  const cached = strokeWidthCache.get(stroke);

  // Only recompute from startIndex (inclusive). Points before startIndex keep
  // their previously computed widths, which is safe because the width formula
  // is strictly causal (point i depends only on points 0..i).
  if (cached && cached.length >= n && startIndex >= cached.length) {
    return cached;
  }

  // The stroke is still being appended to, so the cached buffer may be shorter
  // than the current point count. NEVER reuse it as-is in that case: writes past
  // the buffer end are silently dropped and lineWidth becomes NaN. Grow it and
  // copy existing widths forward instead.
  let widths: Float32Array;
  if (cached && cached.length >= startIndex && cached.length >= n) {
    widths = cached;
  } else if (cached) {
    widths = new Float32Array(n);
    widths.set(cached);
  } else {
    widths = new Float32Array(n);
  }
  let prevW = startIndex > 0 ? widths[startIndex - 1] : base * 0.5;
  let prevSpeed = startIndex > 0 ? (strokeSpeedCache.get(stroke) ?? 0) : 0;

  for (let i = startIndex; i < n; i++) {
    const p = points[i];
    const next = i < n - 1 ? points[i + 1] : null;

    const pr = Math.max(0, Math.min(1.0, p.pressure));
    const pFactor = 0.4 + pr * 0.8;

    // Velocity mapping with EMA smoothing: jittery event timestamps on some
    // Android devices cause raw speed to spike and the stroke width to pulse.
    let vFactor = 1.0;
    if (next) {
      const dx = next.x - p.x;
      const dy = next.y - p.y;
      const dt = Math.max(1, next.t - p.t);
      const speed = Math.hypot(dx, dy) / dt;
      const smoothedSpeed = prevSpeed === 0 ? speed : prevSpeed * 0.65 + speed * 0.35;
      prevSpeed = smoothedSpeed;
      vFactor = Math.max(0.8, 1.0 - smoothedSpeed * 0.015);
    }
    strokeSpeedCache.set(stroke, prevSpeed);

    let rawW = base * pFactor * vFactor;

    // Immediate start taper to avoid "blob" at the very first touch.
    // This is fixed and causal, so it never shifts visually.
    if (i < 3) {
      rawW *= 0.6 + 0.4 * (i / 2);
    }

    // Causal Forward EMA: width at point `i` ONLY depends on points `0..i`.
    // This guarantees ZERO visual snapping/optimization when the stroke finishes.
    widths[i] = i === 0 ? rawW : 0.6 * rawW + 0.4 * prevW;
    prevW = widths[i];
  }

  strokeWidthCache.set(stroke, widths);
  return widths;
}

export function clearStrokeWidthCache(stroke: InkStroke): void {
  strokeWidthCache.delete(stroke);
  strokeSpeedCache.delete(stroke);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawPen(ctx: CanvasRenderingContext2D, stroke: InkStroke, previousPointCount: number): void {
  const points = stroke.points;
  const n = points.length;
  if (n === 0 || n <= previousPointCount) return;

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.globalAlpha = 1;
  
  // lineCap = "round" is the secret to gapless, robust ink. 
  // It effectively draws a perfect capsule between points.
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Widths are strictly deterministic and causal. Incremental recompute avoids
  // O(n^2) work for long strokes (this was the main source of lag).
  const widths = computeWidths(stroke, stroke.width, Math.max(0, previousPointCount - 1));

  if (n === 1) {
    if (previousPointCount === 0) {
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, widths[0] / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return;
  }

  // Draw new segments individually.
  // Overlapping opaque round-capped strokes perfectly merge without gaps.
  const startIndex = Math.max(0, previousPointCount - 1);
  for (let i = startIndex; i < n - 1; i++) {
    ctx.beginPath();
    ctx.moveTo(points[i].x, points[i].y);
    ctx.lineTo(points[i + 1].x, points[i + 1].y);
    ctx.lineWidth = (widths[i] + widths[i + 1]) / 2;
    ctx.stroke();
  }

  ctx.restore();
}

function drawHighlighter(ctx: CanvasRenderingContext2D, stroke: InkStroke, previousPointCount: number): void {
  const pts = stroke.points;
  if (pts.length === 0 || pts.length <= previousPointCount) return;

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
  const startIndex = Math.max(0, previousPointCount - 1);
  ctx.moveTo(pts[startIndex].x, pts[startIndex].y);
  
  for (let i = startIndex + 1; i < pts.length; i++) {
    ctx.lineTo(pts[i].x, pts[i].y);
  }
  
  ctx.stroke();
  ctx.restore();
}

export function drawStroke(ctx: CanvasRenderingContext2D, stroke: InkStroke): void {
  if (stroke.tool === "highlighter") {
    drawHighlighter(ctx, stroke, 0);
  } else {
    drawPen(ctx, stroke, 0);
  }
}

export function drawStrokeSegment(
  ctx: CanvasRenderingContext2D,
  stroke: InkStroke,
  previousPointCount: number
): void {
  if (stroke.tool === "highlighter") {
    drawHighlighter(ctx, stroke, previousPointCount);
  } else {
    drawPen(ctx, stroke, previousPointCount);
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
