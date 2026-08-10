import type { InkStroke } from "../../ink/types";

export function mdLoadScale(stored: { pageWidth: number }, currentWidth: number): number {
  const old = stored.pageWidth;
  if (!Number.isFinite(old) || old <= 0) return 1;
  const next = Number.isFinite(currentWidth) && currentWidth > 0 ? currentWidth : old;
  return next / Math.max(1, old);
}

function clonePoints(stroke: InkStroke, map: (x: number, y: number) => { x: number; y: number }): InkStroke {
  return {
    ...stroke,
    points: stroke.points.map((p) => {
      const mapped = map(p.x, p.y);
      return { ...p, x: mapped.x, y: mapped.y };
    })
  };
}

export function reprojectStrokesToWidth(strokes: InkStroke[], oldWidth: number, newWidth: number): InkStroke[] {
  const old = Number.isFinite(oldWidth) && oldWidth > 0 ? oldWidth : 1;
  const next = Number.isFinite(newWidth) && newWidth > 0 ? newWidth : old;
  const ratio = next / Math.max(1, old);
  return strokes.map((stroke) => clonePoints(stroke, (x, y) => ({ x: x * ratio, y: y * ratio })));
}

export function convertStrokesFromAnnotation(strokes: InkStroke[], scale: number): InkStroke[] {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return strokes.map((stroke) => clonePoints(stroke, (x, y) => ({ x: x * s, y: y * s })));
}

export function toViewportStroke(stroke: InkStroke, scrollTop: number): InkStroke {
  return clonePoints(stroke, (x, y) => ({ x, y: y - scrollTop }));
}

export function fromViewportStroke(stroke: InkStroke, scrollTop: number): InkStroke {
  return clonePoints(stroke, (x, y) => ({ x, y: y + scrollTop }));
}

export function toViewportStrokeWithScroll(stroke: InkStroke, scrollTop: number, scrollLeft: number): InkStroke {
  return clonePoints(stroke, (x, y) => ({ x: x - scrollLeft, y: y - scrollTop }));
}

export function fromViewportStrokeWithScroll(stroke: InkStroke, scrollTop: number, scrollLeft: number): InkStroke {
  return clonePoints(stroke, (x, y) => ({ x: x + scrollLeft, y: y + scrollTop }));
}