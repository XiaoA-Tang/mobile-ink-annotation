import { WorkspaceLeaf } from "obsidian";

export type NativePdfProbeResult = {
  file: string;
  leafViewType: string;
  containerClasses: string[];
  pdfViewFound: boolean;
  iframeCount: number;
  embeds: Array<{ tag: string; cls: string; src: string }>;
  candidatePageCount: number;
  pages: Array<{
    pageNumber: number;
    classes: string[];
    rect: { left: number; top: number; width: number; height: number };
    canvases: Array<{ width: number; height: number }>;
  }>;
};

export function probeNativePdfStructure(leaf: WorkspaceLeaf): NativePdfProbeResult {
  const containerEl = leaf.view.containerEl;
  const result: NativePdfProbeResult = {
    file: (leaf.view as unknown as { file?: { path?: string } }).file?.path ?? "",
    leafViewType: leaf.getViewState().type,
    containerClasses: Array.from(containerEl.classList),
    pdfViewFound: !!containerEl.querySelector(".pdf-view"),
    iframeCount: 0,
    embeds: [],
    candidatePageCount: 0,
    pages: []
  };

  containerEl.querySelectorAll("iframe").forEach(() => {
    result.iframeCount += 1;
  });
  containerEl.querySelectorAll("embed, object").forEach((el) => {
    result.embeds.push({
      tag: el.tagName.toLowerCase(),
      cls: typeof el.className === "string" ? el.className : "",
      src: el.getAttribute("data") ?? el.getAttribute("src") ?? ""
    });
  });

  containerEl.querySelectorAll<HTMLElement>("[class*='pdf-page'], [class*='page-container'], .page").forEach((el, index) => {
    const rect = el.getBoundingClientRect();
    result.pages.push({
      pageNumber: index + 1,
      classes: Array.from(el.classList),
      rect: {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      },
      canvases: Array.from(el.querySelectorAll("canvas")).map((c) => ({ width: c.width, height: c.height }))
    });
  });
  result.candidatePageCount = result.pages.length;
  return result;
}

type ZoomMechanism = {
  scrollContainer: {
    classes: string[];
    tag: string;
    clientWidth: number;
    clientHeight: number;
    scrollWidth: number;
    scrollHeight: number;
    scrollLeft: number;
    scrollTop: number;
    overflowX: string;
    overflowY: string;
  } | null;
  windowScaleFactorVar: string | null;
  pages: Array<{
    pageNumber: number;
    classes: string[];
    offsetWidth: number;
    offsetHeight: number;
    rect: { left: number; top: number; width: number; height: number };
    computedTransform: string;
    computedScale: string;
    cssWidth: string;
    cssHeight: string;
    inlineWidth: string;
    inlineHeight: string;
    styleWidth: string;
    styleHeight: string;
    parentTag: string;
    parentClasses: string[];
    parentTransform: string;
  }>;
};

export function probeZoomMechanism(leaf: WorkspaceLeaf): ZoomMechanism {
  const containerEl = leaf.view.containerEl;

  const scrollCandidates = Array.from(
    containerEl.querySelectorAll<HTMLElement>("*")
  ).filter((el) => {
    const s = getComputedStyle(el);
    return (s.overflowX === "auto" || s.overflowX === "scroll" || s.overflowY === "auto" || s.overflowY === "scroll")
      && (el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight);
  }).slice(0, 4);

  const firstScroller = scrollCandidates[0] ?? null;
  const root = getComputedStyle(document.documentElement);
  const rootVars = Array.from(document.documentElement.style)
    .filter((p) => p.includes("scale") || p.includes("zoom") || p.includes("factor"));
  const windowScaleFactorVar = rootVars.length > 0 ? rootVars.join(",") : null;

  const pages = Array.from(containerEl.querySelectorAll<HTMLElement>(".page")).map((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const parent = el.parentElement;
    const parentCs = parent ? getComputedStyle(parent) : null;
    return {
      pageNumber: Number(el.getAttribute("data-page-number")) || Number(el.dataset.pageNumber) || 0,
      classes: Array.from(el.classList),
      offsetWidth: el.offsetWidth,
      offsetHeight: el.offsetHeight,
      rect: { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) },
      computedTransform: cs.transform,
      computedScale: cs.scale,
      cssWidth: cs.width,
      cssHeight: cs.height,
      inlineWidth: el.style.width,
      inlineHeight: el.style.height,
      styleWidth: el.getAttribute("style") ?? "",
      styleHeight: el.getAttribute("style") ?? "",
      parentTag: parent?.tagName ?? "",
      parentClasses: parent ? Array.from(parent.classList) : [],
      parentTransform: parentCs?.transform ?? ""
    };
  });

  return {
    scrollContainer: firstScroller
      ? {
          classes: Array.from(firstScroller.classList),
          tag: firstScroller.tagName,
          clientWidth: firstScroller.clientWidth,
          clientHeight: firstScroller.clientHeight,
          scrollWidth: firstScroller.scrollWidth,
          scrollHeight: firstScroller.scrollHeight,
          scrollLeft: firstScroller.scrollLeft,
          scrollTop: firstScroller.scrollTop,
          overflowX: getComputedStyle(firstScroller).overflowX,
          overflowY: getComputedStyle(firstScroller).overflowY
        }
      : null,
    windowScaleFactorVar: windowScaleFactorVar,
    pages
  };
}
