// Hard budget for ink canvas backing stores (device pixels), per canvas.
//
// The backing store grows quadratically with zoom: canvas backing =
// pageWidth * pageHeight * dpr^2 where dpr = deviceDpr * displayScale and
// displayScale tracks the zoom level (up to 4). Without a hard cap the
// committed+live canvases of a single PDF page reach hundreds of MB at
// high zoom and OOM the WebView renderer on mobile (annotations vanish,
// then the app freezes and crashes).
//
// 9M device pixels (~36MB/canvas) keeps ink crisp at zoom 1 on all common
// tablet devicePixelRatios (dpr<=3), then gracefully softens instead of
// crashing at high zoom. Real device probing showed zoom 319% at 16M
// produced 3388x4724 canvases (128MB for both canvases) which caused UI
// jank and a WebView crash; 9M halves memory and draw cost while the
// loss in sharpness at high zoom is acceptable for handwriting.
// Desktop gets a larger but still bounded budget.

export function resolveInkCanvasBudget(isMobile: boolean): number {
  return isMobile ? 9_000_000 : 48_000_000;
}
