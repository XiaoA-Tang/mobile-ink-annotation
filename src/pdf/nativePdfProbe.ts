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
