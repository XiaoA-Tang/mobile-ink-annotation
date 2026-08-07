import type { InkStroke } from "../ink/types.ts";
import type {
  LogicalPage,
  LogicalPageLayout,
  ScreenRect
} from "./nativePdfGeometry.ts";
import {
  logicalToScreen,
  screenToLogical
} from "./nativePdfGeometry.ts";

export function assignStrokeToPage(stroke: InkStroke, layout: LogicalPageLayout): LogicalPage | null {
  const bounds = getStrokeBounds(stroke);
  const y = bounds ? bounds.y + bounds.height / 2 : (stroke.points[0]?.y ?? 0);
  let nearest: LogicalPage | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const page of layout.pages) {
    if (y >= page.offsetY && y <= page.offsetY + page.height) return page;
    const distance = y < page.offsetY ? page.offsetY - y : y - (page.offsetY + page.height);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = page;
    }
  }
  return nearest;
}

export function splitStrokesByPage(strokes: InkStroke[], layout: LogicalPageLayout): Map<number, InkStroke[]> {
  const map = new Map<number, InkStroke[]>();
  for (const stroke of strokes) {
    const page = assignStrokeToPage(stroke, layout);
    if (!page) continue;
    const list = map.get(page.pageNumber) ?? [];
    list.push(stroke);
    map.set(page.pageNumber, list);
  }
  return map;
}

export function convertStrokesToScreen(strokes: InkStroke[], page: LogicalPage, rect: ScreenRect): InkStroke[] {
  const scaleX = rect.width / Math.max(1, page.width);
  const scaleY = rect.height / Math.max(1, page.height);
  const widthScale = Math.sqrt(scaleX * scaleY);
  return strokes.map((stroke) => ({
    ...stroke,
    width: Math.max(0.5, stroke.width * widthScale),
    points: stroke.points.map((point) => {
      const pt = logicalToScreen(page, rect, point.x, point.y);
      return { ...point, x: pt.x, y: pt.y };
    })
  }));
}

export function convertStrokesToLogical(strokes: InkStroke[], page: LogicalPage, rect: ScreenRect): InkStroke[] {
  const scaleX = rect.width / Math.max(1, page.width);
  const scaleY = rect.height / Math.max(1, page.height);
  const widthScale = Math.sqrt(scaleX * scaleY);
  return strokes.map((stroke) => ({
    ...stroke,
    width: Math.max(0.5, stroke.width / widthScale),
    points: stroke.points.map((point) => {
      const pt = screenToLogical(page, rect, point.x, point.y);
      return { ...point, x: pt.x, y: pt.y };
    })
  }));
}

function getStrokeBounds(stroke: InkStroke): { y: number; height: number } | null {
  if (stroke.points.length === 0) return null;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of stroke.points) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { y: minY, height: maxY - minY };
}
