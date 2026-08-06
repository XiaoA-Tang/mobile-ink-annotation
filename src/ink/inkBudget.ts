// Hard budget for ink canvas backing stores (device pixels), per canvas.
//
// The backing store grows quadratically with zoom: canvas backing =
// pageWidth * pageHeight * dpr^2 where dpr = deviceDpr * displayScale and
// displayScale tracks the zoom level (up to 4). Without a hard cap the
// committed+live canvases of a single PDF page reach hundreds of MB at
// high zoom and OOM the WebView renderer on mobile (annotations vanish,
// then the app freezes and crashes).
//
// 16M device pixels (~64MB/canvas) keeps ink crisp at zoom 1 on all common
// tablet devicePixelRatios (dpr<=3), then gracefully softens instead of
// crashing. Desktop gets a larger but still bounded budget.

export function resolveInkCanvasBudget(isMobile: boolean): number {
  return isMobile ? 16_000_000 : 48_000_000;
}
