import { getStrokePoints } from "perfect-freehand";
import type { StrokePoint } from "perfect-freehand";
import type { InkStroke } from "./types";

export type SmoothPoint = {
  x: number;
  y: number;
  pressure: number;
  distance: number;
};

export const SMOOTH_STREAMLINE = 0.5;

type SmoothCacheEntry = {
  rawCount: number;
  isComplete: boolean;
  points: SmoothPoint[];
};

const smoothCache = new WeakMap<InkStroke, SmoothCacheEntry>();

export function getSmoothSize(width: number): number {
  return Math.max(1, Math.min(width * 2, 8));
}

export function smoothStroke(stroke: InkStroke, isComplete: boolean): SmoothPoint[] {
  const cached = smoothCache.get(stroke);
  const rawCount = stroke.points.length;
  if (cached && cached.rawCount === rawCount && cached.isComplete === isComplete) {
    return cached.points;
  }

  const input: number[][] = new Array(rawCount);
  for (let i = 0; i < rawCount; i++) {
    const p = stroke.points[i];
    input[i] = [p.x, p.y, p.pressure];
  }

  const strokePoints: StrokePoint[] = getStrokePoints(input, {
    size: getSmoothSize(stroke.width),
    streamline: SMOOTH_STREAMLINE,
    last: isComplete,
  });

  const points: SmoothPoint[] = new Array(strokePoints.length);
  for (let i = 0; i < strokePoints.length; i++) {
    const sp = strokePoints[i];
    points[i] = {
      x: sp.point[0],
      y: sp.point[1],
      pressure: sp.pressure,
      distance: sp.distance,
    };
  }

  smoothCache.set(stroke, { rawCount, isComplete, points });
  return points;
}
