import type { PdfJsDocument } from "../views/annotationTypes.ts";
import { PDF_BACKGROUND_PAGE_GAP, PDF_BACKGROUND_MOBILE_MAX_WIDTH } from "../views/annotationConstants.ts";

export type LogicalPage = {
  pageNumber: number;
  offsetY: number;
  width: number;
  height: number;
};

export type LogicalPageLayout = {
  pageWidth: number;
  pageHeight: number;
  pages: LogicalPage[];
};

export type ScreenRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export async function computePageSizeFromPdf(
  pdf: Pick<PdfJsDocument, "getPage">,
  scrollClientWidth: number,
  maxWidth = PDF_BACKGROUND_MOBILE_MAX_WIDTH
): Promise<{ width: number; height: number }> {
  const availableWidth = Math.max(320, scrollClientWidth - 24);
  const targetWidth = Math.min(Math.max(availableWidth, 320), maxWidth);
  const firstPage = await pdf.getPage(1);
  const base = firstPage.getViewport({ scale: 1 });
  const scale = targetWidth / Math.max(1, base.width);
  const viewport = firstPage.getViewport({ scale });
  return {
    width: Math.max(1, Math.ceil(viewport.width)),
    height: Math.max(1, Math.ceil(viewport.height))
  };
}

export function buildUniformPageLayout(pageWidth: number, pageHeight: number, numPages: number): LogicalPageLayout {
  const pages: LogicalPage[] = [];
  let offsetY = 0;
  for (let n = 1; n <= numPages; n++) {
    pages.push({ pageNumber: n, offsetY, width: pageWidth, height: pageHeight });
    offsetY += pageHeight;
    if (n < numPages) offsetY += PDF_BACKGROUND_PAGE_GAP;
  }
  return { pageWidth, pageHeight, pages };
}

export function screenToLogical(page: LogicalPage, rect: ScreenRect, x: number, y: number): { x: number; y: number } {
  const rx = rect.width > 0 ? (x - rect.left) / rect.width : 0;
  const ry = rect.height > 0 ? (y - rect.top) / rect.height : 0;
  return { x: rx * page.width, y: page.offsetY + ry * page.height };
}

export function logicalToScreen(page: LogicalPage, rect: ScreenRect, x: number, y: number): { x: number; y: number } {
  const localY = y - page.offsetY;
  return {
    x: rect.left + (x / Math.max(1, page.width)) * rect.width,
    y: rect.top + (localY / Math.max(1, page.height)) * rect.height
  };
}
