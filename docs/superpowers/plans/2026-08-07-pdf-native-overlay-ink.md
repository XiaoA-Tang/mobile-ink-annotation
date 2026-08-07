# PDF 鍘熺敓瑙嗗浘灏卞湴涔﹀啓妯″紡 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 鍦?Obsidian 鍘熺敓 PDF 瑙嗗浘涓婂彔鍔犲氨鍦版墜鍐欏眰鈥斺€旂偣鍑绘偓娴?绗?鎸夐挳鐩存帴杩涘叆缁樼敾妯″紡锛屾墜鍐?鑽у厜绗?姗＄毊鑷敱涔﹀啓锛岄€€鍑哄悗鍥炲埌鍘熺敓瑙嗗浘缁х画闃呰缂╂斁锛屽叏绋嬩笉鍙﹀紑鏍囩椤碉紝绗旇抗涓庣幇鏈夊畬鏁存爣娉ㄨ鍥句簰閫氥€?
**Architecture:** 鎻掍欢绾у崟渚?`NativePdfOverlayManager` 鐩戝惉宸ヤ綔鍖?leaf锛屾娴嬪師鐢?PDF 瑙嗗浘骞舵寕鎮诞绗旀寜閽€傝繘鍏ョ粯鐢绘ā寮忓悗锛屽湪 leaf 瀹瑰櫒涓婂彔鍔?fixed 瑕嗙洊灞傦紝瀵规瘡涓彲瑙侀〉鍒涘缓涓€涓榻愬叾灞忓箷鐭╁舰鐨?`InkEngine`锛堝紩鎿庡伐浣滃湪"椤靛睆骞曞儚绱?绌洪棿锛夛紱绗旇抗鍦ㄦ寔涔呭寲杈圭晫澶勭敤绾嚱鏁版崲绠楀埌鍏ㄥ眬閫昏緫鍧愭爣锛堜笌鐜版湁 `.ink.json` 鍚屾瀯锛夈€傜粯鐢绘ā寮忛攣瀹氱缉鏀?婊氬姩锛岃閬垮悓姝ュ師鐢熺缉鏀剧殑閿欎綅椋庨櫓銆?*Task 1 鏄湡鏈?SPIKE锛堝彲琛屾€ч椄闂級**锛屾娴嬪師鐢?PDF 椤靛厓绱犳槸鍚﹀彲璁块棶銆侀潪 iframe/embed 闅旂銆?
**Tech Stack:** TypeScript銆丱bsidian API锛坄loadPdfJs`銆乣setIcon`銆乣workspace` 浜嬩欢锛夈€乸dfjs-dist锛堜粎鍙栬鍙ｅ嚑浣曪級銆佺幇鏈?`InkEngine`/`StrokeStore`/`SaveQueue`/`resolveInkCanvasBudget`銆?
## Global Constraints

- 鍧愭爣绾﹀畾锛氬瓨鍌ㄧ瑪杩逛负**鍏ㄥ眬閫昏緫鍧愭爣**锛涚 N 椤?`y 鈭?[offsetY, offsetY + pageHeight]`锛宍offsetY = (N-1) * (pageHeight + PDF_BACKGROUND_PAGE_GAP)`锛宍PDF_BACKGROUND_PAGE_GAP = 12`锛岄€昏緫椤靛楂樺彇鑷?`views/annotationConstants.ts`銆傛墍鏈夎浆鎹㈠嚱鏁颁笌鐜版湁 `AnnotationView.preparePdfInkStrokesForCurrentLayout` 绾﹀畾涓€鑷淬€?- 澧ㄨ抗娓叉煋锛歝ommitted canvas **蹇呴』 `desynchronized:false`**锛坴1.1.15 淇锛孉ndroid WebView 鍛堢幇缂洪櫡锛夛紱backing 鍙?`resolveInkCanvasBudget` 涓婇檺绾︽潫锛坴1.1.14 淇锛夈€?- 宸ュ叿鐘舵€侀粯璁ゅ€硷細`tool:"pen"`, `color:"#111111"`, `width:2`, `highlighterColor:"#ffd54a"`, `highlighterWidth:14`, `eraserRadius:18`, `acceptTouchInput:false`锛堜笌 `AnnotationView.createInitialInkToolState` 涓€鑷达級銆?- 缁樼敾妯″紡閿佸畾缂╂斁/婊氬姩锛堢敤鎴峰凡纭锛夛紝杩欐槸涓诲姩鍙栬垗锛屼笉绠楃己闄枫€?- 鍙戝竷娴佺▼锛堟瘡娆″彂甯冨浐瀹氭楠わ級锛歚npm run build` 鈫?`git commit` 鈫?tag 鈫?`git push "https://x-access-token:<TOKEN>@github.com/XiaoA-Tang/mobile-ink-annotation.git" main <tag>` 鈫?POST release锛坆ody 鐢?node 鍐?UTF8 鏂囦欢 + `curl.exe --data-binary`锛夆啋 涓婁紶 3 涓?assets銆?- 鍗曞厓娴嬭瘯杩愯鏂瑰紡锛歚node --experimental-strip-types scripts/test-native-pdf-geometry.mjs`锛堟部鐢?`test-canvas-budget.mjs` 鐨?TS strip 妯″紡锛夈€?
---

### Task 1: SPIKE 鈥?鍘熺敓 PDF 缁撴瀯鎺㈡祴锛堝彂甯?1.1.16-beta锛?
**Files:**
- Create: `src/pdf/nativePdfProbe.ts`
- Modify: `src/main.ts`
- Modify: `package.json`銆乣manifest.json`锛堢増鏈?1.1.15 鈫?1.1.16锛?
**Interfaces:**
- Produces: `probeNativePdfStructure(leaf: WorkspaceLeaf): NativePdfProbeResult`锛圱ask 4 澶嶇敤鍏朵腑椤靛厓绱犳娴嬫€濊矾锛夈€?- Consumes: 鏃犮€?
- [ ] **Step 1: 鍒涘缓 `src/pdf/nativePdfProbe.ts`**

```ts
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
```

- [ ] **Step 2: 鍦?`src/main.ts` 鎺ュ叆鎺㈡祴鍛戒护 + 姣忔浼氳瘽鑷姩鎺㈡祴涓€娆?*

鍦ㄦ枃浠堕《閮?import 澶勫姞鍏ワ細

```ts
import { probeNativePdfStructure } from "./pdf/nativePdfProbe";
```

鍦?`onload()` 鍐呫€乣this.registerEvent(...)` 涔嬪悗鍔犲叆鑷姩鎺㈡祴閫昏緫锛堟瘡娆′細璇濆彧鑷姩璺戜竴娆★紝鎵撳紑 PDF 鍚庡欢杩熺瓑椤垫覆鏌撳畬鍐嶆帰娴嬶級锛?
```ts
let nativePdfProbeDone = false;
this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
  if (nativePdfProbeDone) return;
  const leaf = this.app.workspace.activeLeaf;
  if (!leaf || leaf.getViewState().type !== "pdf") return;
  nativePdfProbeDone = true;
  window.setTimeout(() => {
    const result = probeNativePdfStructure(leaf);
    const text = JSON.stringify(result, null, 2);
    console.log("[MobileInkProbe]", text);
    const pluginDir = this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`;
    void this.app.vault.adapter.write(`${pluginDir}/native-pdf-probe.json`, text);
    new Notice(`鎺㈡祴瀹屾垚: 椤靛€欓€?${result.candidatePageCount}, iframe=${result.iframeCount}, embed=${result.embeds.length}, pdfView=${result.pdfViewFound}銆傜粨鏋滃啓鍏?${pluginDir}/native-pdf-probe.json`);
  }, 2000);
}));

this.addCommand({
  id: "probe-native-pdf-structure",
  name: "鎺㈡祴鍘熺敓 PDF 瑙嗗浘缁撴瀯 (SPIKE)",
  checkCallback: (checking) => {
    const leaf = this.app.workspace.activeLeaf;
    const ok = !!leaf && leaf.getViewState().type === "pdf";
    if (checking) return ok;
    if (!ok || !leaf) return false;
    const result = probeNativePdfStructure(leaf);
    const text = JSON.stringify(result, null, 2);
    console.log("[MobileInkProbe]", text);
    const pluginDir = this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`;
    void this.app.vault.adapter.write(`${pluginDir}/native-pdf-probe.json`, text);
    new Notice(`鎺㈡祴瀹屾垚: 椤靛€欓€?${result.candidatePageCount}, iframe=${result.iframeCount}, embed=${result.embeds.length}銆傜粨鏋滃啓鍏?${pluginDir}/native-pdf-probe.json`);
    return true;
  }
});
```

- [ ] **Step 3: 鐗堟湰鍗囧埌 1.1.16**

`package.json` 涓?`manifest.json` 鐨?`version` 瀛楁鏀逛负 `"1.1.16"`銆?
- [ ] **Step 4: 鏋勫缓**

Run: `npm run build`
Expected: 鏃犺緭鍑洪敊璇紝閫€鍑虹爜 0锛坄tsc -noEmit` 閫氳繃 + esbuild 浜у嚭 main.js锛夈€?
- [ ] **Step 5: 鎻愪氦骞舵墦 tag**

```bash
git add src/pdf/nativePdfProbe.ts src/main.ts package.json manifest.json main.js
git commit -m "feat(spike): probe native PDF view DOM structure on device"
git tag v1.1.16-beta
```

- [ ] **Step 6: 鎺ㄩ€佸苟鍙戝竷**

```bash
git push "https://x-access-token:<PUSH_TOKEN>@github.com/XiaoA-Tang/mobile-ink-annotation.git" main v1.1.16-beta
```

鐢?node 鍐?UTF8 body 鏂囦欢鍚?POST release锛坱ag 鍚?`v1.1.16-beta`銆乸rerelease銆佷腑鏂?body锛氳鏄庤繖鏄?SPIKE 鎺㈡祴鐗堬紝瑁呭ソ鍚庢墦寮€浠绘剰 PDF锛屼細鑷姩鐢熸垚 `native-pdf-probe.json`锛屾妸璇ユ枃浠跺唴瀹瑰弽棣堝洖鏉ワ級锛屽啀涓婁紶 main.js/manifest.json/styles.css 涓変釜 assets锛堟祦绋嬭 Global Constraints锛夈€?
- [ ] **Step 7: 鐢ㄦ埛鐪熸満楠岃瘉锛堝彲琛屾€ч椄闂級**

鐢ㄦ埛瑁?1.1.16-beta锛屾墦寮€涓€涓椤?PDF锛岀瓑 2 绉掞紝鎶婃彃浠剁洰褰曚笅鐨?`native-pdf-probe.json` 鍐呭鍙嶉銆?**閫氳繃鍒ゆ嵁**锛歚candidatePageCount >= 1` 涓旀瘡涓〉鍊欓€?`canvases.length >= 1`锛宍iframeCount === 0`锛宍embeds.length === 0`銆傝嫢閫氳繃 鈫?缁х画 Task 2-6锛涜嫢椤靛€欓€変负 0 鎴?iframe/embed 闅旂 鈫?鍋滀笅鏉ヤ笌鐢ㄦ埛閲嶆柊璇勪及锛堣鐩栧眰涓嶅彲琛岋紝闄嶇骇涓烘柟妗?B 灏卞湴鍒囨崲锛夈€?
---

### Task 2: 绾嚑浣曟ā鍧?+ 鍗曞厓娴嬭瘯

**Files:**
- Create: `src/pdf/nativePdfGeometry.ts`
- Create: `scripts/test-native-pdf-geometry.mjs`

**Interfaces:**
- Consumes: `PdfJsDocument`锛堟潵鑷?`src/views/annotationTypes.ts`锛夈€乣PDF_BACKGROUND_PAGE_GAP`/`PDF_BACKGROUND_MOBILE_MAX_WIDTH`锛堟潵鑷?`src/views/annotationConstants.ts`锛夈€?- Produces锛圱ask 3銆?銆? 渚濊禆锛?
  - `type LogicalPage = { pageNumber: number; offsetY: number; width: number; height: number }`
  - `type LogicalPageLayout = { pageWidth: number; pageHeight: number; pages: LogicalPage[] }`
  - `type ScreenRect = { left: number; top: number; width: number; height: number }`
  - `computePageSizeFromPdf(pdf, scrollClientWidth, maxWidth?): Promise<{ width: number; height: number }>`锛堢敤绗?1 椤佃鍙ｅ湪 scale=1 涓嬫寜鐩爣瀹藉害鎹㈢畻锛?  - `buildUniformPageLayout(pageWidth, pageHeight, numPages): LogicalPageLayout`锛堥〉闂?offsetY 鍚?gap锛?  - `screenToLogical(page, rect, x, y): { x: number; y: number }`
  - `logicalToScreen(page, rect, x, y): { x: number; y: number }`

- [ ] **Step 1: 鍐欏け璐ユ祴璇?`scripts/test-native-pdf-geometry.mjs`**

```js
import { computePageSizeFromPdf, buildUniformPageLayout, screenToLogical, logicalToScreen } from "../src/pdf/nativePdfGeometry.ts";
import { PDF_BACKGROUND_PAGE_GAP } from "../src/views/annotationConstants.ts";

let failed = 0;
function assert(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log("  ok:", name);
  } else {
    failed++;
    console.error("  FAIL:", name, "expected", e, "got", a);
  }
}

const fakeViewport = { width: 612, height: 792 };
const fakePdf = {
  numPages: 3,
  async getPage(n) {
    return { getViewport: (o) => (o.scale === 1 ? fakeViewport : { width: fakeViewport.width * o.scale, height: fakeViewport.height * o.scale }) };
  }
};

// 1. computePageSizeFromPdf: scroll 瀹藉害 984 鈫?available=960 鈫?target=960, scale=960/612鈮?.5686
const size = await computePageSizeFromPdf(fakePdf, 984);
assert("page width from pdf", size.width, 960);
assert("page height from pdf", size.height, Math.ceil(792 * (960 / 612)));

// 2. uniform layout: offsetY 鍚?gap锛岄〉鍐呴珮搴︿竴鑷?const layout = buildUniformPageLayout(960, 1242, 3);
assert("page count", layout.pages.length, 3);
assert("page1 offsetY", layout.pages[0].offsetY, 0);
assert("page2 offsetY", layout.pages[1].offsetY, 1242 + PDF_BACKGROUND_PAGE_GAP);
assert("page3 offsetY", layout.pages[2].offsetY, (1242 + PDF_BACKGROUND_PAGE_GAP) * 2);

// 3. screenToLogical / logicalToScreen 寰€杩斾竴鑷达紙page2锛屽惈 gap 鍋忕Щ锛?const rect = { left: 10, top: 20, width: 480, height: 621 };
const logical = screenToLogical(layout.pages[1], rect, 10 + 240, 20 + 310.5);
assert("logical x", logical.x, 480);
assert("logical y", logical.y, 1242 + PDF_BACKGROUND_PAGE_GAP + 621);
const screen = logicalToScreen(layout.pages[1], rect, logical.x, logical.y);
assert("roundtrip x", Math.round(screen.x), 250);
assert("roundtrip y", Math.abs(screen.y - 330.5) < 0.001, true);

// 4. 闈為浂淇濇姢锛歸idth/height 涓?0 鏃惰繑鍥炲師鍧愭爣涓?NaN
const zero = screenToLogical(layout.pages[0], { left: 0, top: 0, width: 0, height: 0 }, 5, 5);
assert("zero rect finite", [zero.x, zero.y].every(Number.isFinite), true);

if (failed > 0) {
  console.error(`FAILED: ${failed} assertion(s)`);
  process.exit(1);
}
console.log("OK: all native-pdf-geometry assertions passed");
```

- [ ] **Step 2: 杩愯纭澶辫触**

Run: `node --experimental-strip-types scripts/test-native-pdf-geometry.mjs`
Expected: FAIL锛屾姤 `Cannot find module ... nativePdfGeometry.ts` 鎴?`computePageSizeFromPdf is not a function`銆?
- [ ] **Step 3: 瀹炵幇 `src/pdf/nativePdfGeometry.ts`**

```ts
import type { PdfJsDocument } from "../views/annotationTypes";
import { PDF_BACKGROUND_PAGE_GAP, PDF_BACKGROUND_MOBILE_MAX_WIDTH } from "../views/annotationConstants";

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
```

- [ ] **Step 4: 杩愯纭閫氳繃**

Run: `node --experimental-strip-types scripts/test-native-pdf-geometry.mjs`
Expected: 鍏ㄩ儴 ok + `OK: all native-pdf-geometry assertions passed`锛岄€€鍑虹爜 0銆?
- [ ] **Step 5: 鎻愪氦**

```bash
git add src/pdf/nativePdfGeometry.ts scripts/test-native-pdf-geometry.mjs
git commit -m "feat: native PDF overlay geometry (logical layout + screen mapping) with tests"
```

---

### Task 3: 绗旇抗鏁版嵁灞傦紙鎸夐〉鎷嗗垎 + 鍧愭爣鎹㈢畻锛? 鍗曞厓娴嬭瘯

**Files:**
- Create: `src/pdf/overlayInkData.ts`
- Modify: `scripts/test-native-pdf-geometry.mjs`锛堣拷鍔犳柇瑷€锛?
**Interfaces:**
- Consumes: `InkStroke`锛坄src/ink/types.ts`锛夈€乀ask 2 鐨?`LogicalPageLayout`/`LogicalPage`/`ScreenRect`/`screenToLogical`/`logicalToScreen`銆?- Produces锛圱ask 5銆? 渚濊禆锛?
  - `assignStrokeToPage(stroke, layout): LogicalPage | null`锛堟寜绗旇抗涓偣 y 钀藉叆椤佃寖鍥达紝鏈€杩戦〉鍏滃簳锛?  - `splitStrokesByPage(strokes, layout): Map<number, InkStroke[]>`
  - `convertStrokesToScreen(strokes, page, rect): InkStroke[]`锛堝潗鏍囦笌绾垮 `sqrt(scaleX*scaleY)` 缂╂斁锛?  - `convertStrokesToLogical(strokes, page, rect): InkStroke[]`

- [ ] **Step 1: 鍏堝啓澶辫触娴嬭瘯锛堣拷鍔犲埌 `scripts/test-native-pdf-geometry.mjs` 鏈熬銆乣if (failed > 0)` 涔嬪墠锛?*

```js
import { assignStrokeToPage, splitStrokesByPage, convertStrokesToScreen, convertStrokesToLogical } from "../src/pdf/overlayInkData.ts";

const layout2 = buildUniformPageLayout(960, 1242, 2);
const mk = (id, y) => ({ id, tool: "pen", color: "#111111", width: 2, points: [{ x: 100, y, t: 0, pressure: 0.5 }] });
const strokeP1 = mk("s1", 500);
const strokeP2 = mk("s2", 1242 + PDF_BACKGROUND_PAGE_GAP + 100);
assert("assign page1", assignStrokeToPage(strokeP1, layout2)?.pageNumber, 1);
assert("assign page2", assignStrokeToPage(strokeP2, layout2)?.pageNumber, 2);

const byPage = splitStrokesByPage([strokeP1, strokeP2], layout2);
assert("split count", byPage.size, 2);
assert("page1 strokes", byPage.get(1)?.length, 1);
assert("page2 strokes", byPage.get(2)?.length, 1);

const rect2 = { left: 0, top: 0, width: 480, height: 621 };
const screen = convertStrokesToScreen([strokeP1], layout2.pages[0], rect2);
const screenX = (screen[0].points[0].x);
const screenY = (screen[0].points[0].y);
assert("toScreen x scale", Math.round(screenX * 100) / 100, 50);
assert("toScreen y scale", Math.round(screenY * 100) / 100, 250);
assert("toScreen width scale", Math.round(screen[0].width * 100) / 100, 1);

const back = convertStrokesToLogical(screen, layout2.pages[0], rect2);
assert("toLogical x", Math.round(back[0].points[0].x), 100);
assert("toLogical y", Math.round(back[0].points[0].y), 500);
assert("toLogical width", Math.round(back[0].width), 2);
```

- [ ] **Step 2: 杩愯纭澶辫触**

Run: `node --experimental-strip-types scripts/test-native-pdf-geometry.mjs`
Expected: FAIL锛宍Cannot find module ... overlayInkData.ts`銆?
- [ ] **Step 3: 瀹炵幇 `src/pdf/overlayInkData.ts`**

```ts
import { InkStroke } from "../ink/types";
import {
  LogicalPage,
  LogicalPageLayout,
  ScreenRect,
  logicalToScreen,
  screenToLogical
} from "./nativePdfGeometry";

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
```

- [ ] **Step 4: 杩愯纭閫氳繃**

Run: `node --experimental-strip-types scripts/test-native-pdf-geometry.mjs`
Expected: 鍏ㄩ儴 ok + `OK: all native-pdf-geometry assertions passed`銆?
- [ ] **Step 5: 鎻愪氦**

```bash
git add src/pdf/overlayInkData.ts scripts/test-native-pdf-geometry.mjs
git commit -m "feat: overlay ink data layer (per-page split + screen/logical conversion) with tests"
```

---

### Task 4: NativePdfOverlayManager 楠ㄦ灦 鈥?妫€娴嬪師鐢?PDF leaf + 鎮诞绗旀寜閽?
**Files:**
- Create: `src/pdf/NativePdfOverlayManager.ts`
- Modify: `src/main.ts`
- Modify: `styles.css`

**Interfaces:**
- Consumes: `StrokeStore`锛坄src/ink/StrokeStore.ts`锛夈€乣probeNativePdfStructure`锛圱ask 1锛屼粎鍙傝€冩娴嬫€濊矾锛屼笉鐩存帴璋冪敤锛夈€?- Produces锛圱ask 5銆? 渚濊禆锛?
  - `class NativePdfOverlayManager { constructor(app: App, store: StrokeStore); onload(): void; onunload(): void; }`
  - 绉佹湁鏂规硶 `update()`, `attachPenButton(leaf)`, `removePenButton()`, `enterDrawMode(leaf)`锛圱ask 5 瀹炵幇浣擄級銆?
- [ ] **Step 1: 瀹炵幇 `src/pdf/NativePdfOverlayManager.ts`锛堥鏋?+ 绗旀寜閽級**

```ts
import { App, Platform, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import { StrokeStore } from "../ink/StrokeStore";

export const NATIVE_PEN_BUTTON_CLS = "mobile-ink-native-pen-button";

export class NativePdfOverlayManager {
  private penButton: HTMLElement | null = null;
  private currentLeaf: WorkspaceLeaf | null = null;
  private drawModeLeaf: WorkspaceLeaf | null = null;

  constructor(
    private readonly app: App,
    private readonly store: StrokeStore
  ) {}

  onload(): void {
    this.app.workspace.on("layout-change", () => this.update());
    this.app.workspace.on("active-leaf-change", () => this.update());
  }

  onunload(): void {
    this.removePenButton();
  }

  private get activeDrawMode(): boolean {
    return this.drawModeLeaf !== null;
  }

  private update(): void {
    const leaf = this.app.workspace.activeLeaf;
    if (this.activeDrawMode) {
      if (!leaf || leaf !== this.drawModeLeaf) {
        void this.exitDrawMode();
      }
      return;
    }
    const isPdf = !!leaf && leaf.getViewState().type === "pdf";
    if (!isPdf || !leaf) {
      this.removePenButton();
      return;
    }
    if (leaf === this.currentLeaf && this.penButton) return;
    this.removePenButton();
    this.currentLeaf = leaf;
    this.attachPenButton(leaf);
  }

  private attachPenButton(leaf: WorkspaceLeaf): void {
    const button = leaf.view.containerEl.createEl("button", {
      cls: NATIVE_PEN_BUTTON_CLS,
      attr: { "aria-label": "灏卞湴鎵嬪啓鎵规敞" }
    });
    setIcon(button, "pencil");
    button.addEventListener("click", () => void this.enterDrawMode(leaf));
    this.penButton = button;
  }

  private removePenButton(): void {
    this.penButton?.remove();
    this.penButton = null;
    this.currentLeaf = null;
  }

  private async enterDrawMode(leaf: WorkspaceLeaf): Promise<void> {
    if (this.activeDrawMode) return;
    const file = (leaf.view as unknown as { file?: TFile }).file;
    if (!(file instanceof TFile) || file.extension !== "pdf") return;
    this.drawModeLeaf = leaf;
    this.removePenButton();
    // Task 5 濉厖锛氬姞杞芥爣娉?鈫?璁＄畻甯冨眬 鈫?寤鸿鐩栧眰涓庨€愰〉澧ㄨ抗寮曟搸
    // Task 6 濉厖锛氬伐鍏锋爮銆佷繚瀛樸€侀€€鍑?  }

  private async exitDrawMode(): Promise<void> {
    const leaf = this.drawModeLeaf;
    this.drawModeLeaf = null;
    // Task 6 濉厖锛歠lush 淇濆瓨 + 鍗歌浇瑕嗙洊灞?    if (leaf) {
      this.currentLeaf = null;
      this.update();
    }
  }
}
```

娉細`Platform` 鍦?Task 5 鐢ㄤ簬 `resolveInkCanvasBudget(Platform.isMobile)`锛宨mport 淇濈暀锛圱ask 5 鐢ㄥ埌锛夈€?
- [ ] **Step 2: 鍦?`src/main.ts` 瀹炰緥鍖?Manager**

鍦?import 澶勫姞鍏ワ細

```ts
import { NativePdfOverlayManager } from "./pdf/NativePdfOverlayManager";
```

鍦?`onload()` 鍐呫€乣this.store = new StrokeStore(...)` 涔嬪悗锛?
```ts
this.nativePdfOverlay = new NativePdfOverlayManager(this.app, this.store);
this.nativePdfOverlay.onload();
```

鍦ㄧ被涓婂０鏄庡瓧娈碉細`private nativePdfOverlay!: NativePdfOverlayManager;`

鍦?`onunload()` 鍐呫€乣detachLeavesOfType` 涔嬪墠锛?
```ts
this.nativePdfOverlay?.onunload();
```

- [ ] **Step 3: 鍦?`styles.css` 杩藉姞鏍峰紡**

杩藉姞鍒版枃浠舵湯灏撅細

```css
.mobile-ink-native-pen-button {
  position: fixed;
  right: 16px;
  bottom: 16px;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--interactive-accent);
  color: var(--text-on-accent);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
  z-index: 400;
  border: none;
  cursor: pointer;
}
.mobile-ink-native-pen-button:hover {
  filter: brightness(1.1);
}
```

- [ ] **Step 4: 鏋勫缓**

Run: `npm run build`
Expected: 閫€鍑虹爜 0锛屾棤绫诲瀷閿欒銆?
- [ ] **Step 5: 鎻愪氦**

```bash
git add src/pdf/NativePdfOverlayManager.ts src/main.ts styles.css main.js
git commit -m "feat: native PDF overlay manager skeleton with floating pen button"
```

- [ ] **Step 6: 璁惧楠岃瘉锛堜笉鍙戝竷锛岀洿鎺ヨ鏈湴鏋勫缓楠岃瘉锛?*

鍦ㄥ钩鏉夸笂鍚敤鎻掍欢锛屾墦寮€鍘熺敓 PDF锛氬彸涓嬭鍑虹幇绗旀寜閽紱鐐规寜閽笉鎶ラ敊锛堢洰鍓嶆棤瑕嗙洊灞傦紝琛屼负涓虹┖锛夛紱鍒囨崲/鍏抽棴 PDF锛屾寜閽纭秷澶便€傝嫢鏈鏈湴鐗堬紝鍙烦杩囨姝ワ紝闅?Task 6 涓€骞堕獙璇併€?
---

### Task 5: 缁樼敾妯″紡 鈥?瑕嗙洊灞?+ 閫愰〉澧ㄨ抗寮曟搸 + 鎸囬拡/鎵嬪娍閿佸畾

**Files:**
- Modify: `src/pdf/NativePdfOverlayManager.ts`
- Modify: `styles.css`

**Interfaces:**
- Consumes: Task 2 `computePageSizeFromPdf`/`buildUniformPageLayout`/`LogicalPageLayout`/`ScreenRect`锛汿ask 3 `splitStrokesByPage`/`convertStrokesToScreen`/`convertStrokesToLogical`锛沗InkEngine`锛坄src/ink/InkEngine.ts`锛屾瀯閫?`(liveCanvas, committedCanvas, scrollEl, options)`锛屾柟娉?`resize`/`setDisplayScale`/`loadStrokes`/`getStrokes`/`setToolState`/`undo`/`redo`/`destroy`/`setInputEnabled`锛夛紱`resolveInkCanvasBudget`锛坄src/ink/inkBudget.ts`锛夛紱`loadPdfJs`锛圤bsidian API锛夛紱`PdfJsLib`/`PdfJsDocument`锛坄src/views/annotationTypes.ts`锛夈€?- Produces锛圱ask 6 渚濊禆锛? 绉佹湁瀛楁 `this.engines: Array<{ engine: InkEngine; page: LogicalPage; rect: ScreenRect; live: HTMLCanvasElement; committed: HTMLCanvasElement }>`锛涚鏈夊瓧娈?`this.toolState: InkToolState`锛涙柟娉?`getVisiblePages(containerEl): Array<{ pageNumber: number; rect: ScreenRect }>`锛沗enterDrawMode`/`exitDrawMode` 瀹屾暣瀹炵幇锛堝惈澧ㄨ抗灞傦紝涓嶅惈宸ュ叿鏍忥級銆?
- [ ] **Step 1: 閲嶅啓 `enterDrawMode` / `exitDrawMode`锛屽姞鍏ヨ鐩栧眰涓庨€愰〉寮曟搸**

鍦?`NativePdfOverlayManager.ts` 椤堕儴 import 琛ュ叏锛?
```ts
import { App, loadPdfJs, Platform, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import { StrokeStore } from "../ink/StrokeStore";
import { InkEngine } from "../ink/InkEngine";
import { InkToolState } from "../ink/types";
import { resolveInkCanvasBudget } from "../ink/inkBudget";
import { PdfJsDocument, PdfJsLib } from "../views/annotationTypes";
import {
  buildUniformPageLayout,
  computePageSizeFromPdf,
  LogicalPage,
  LogicalPageLayout,
  ScreenRect
} from "./nativePdfGeometry";
import {
  convertStrokesToLogical,
  convertStrokesToScreen,
  splitStrokesByPage
} from "./overlayInkData";

export const NATIVE_OVERLAY_CLS = "mobile-ink-native-overlay";
export const NATIVE_OVERLAY_CAPTURE_CLS = "mobile-ink-native-capture";
export const NATIVE_OVERLAY_PAGE_CANVAS_CLS = "mobile-ink-native-page-canvas";
```

鍦ㄧ被鍐呮柊澧炲瓧娈典笌甯搁噺锛?
```ts
private overlay: HTMLElement | null = null;
private captureLayer: HTMLElement | null = null;
private drawFile: TFile | null = null;
private layout: LogicalPageLayout | null = null;
private pageStrokes: Map<number, InkStroke[]> = new Map();
private engines: Array<{ engine: InkEngine; page: LogicalPage; rect: ScreenRect; live: HTMLCanvasElement; committed: HTMLCanvasElement }> = [];
private toolState: InkToolState = {
  tool: "pen", color: "#111111", width: 2,
  highlighterColor: "#ffd54a", highlighterWidth: 14,
  eraserRadius: 18, acceptTouchInput: false
};
private saveTimer: number | null = null;
private dirty = false;
```

鏇挎崲 `enterDrawMode` 瀹炵幇涓猴細

```ts
private async enterDrawMode(leaf: WorkspaceLeaf): Promise<void> {
  if (this.activeDrawMode) return;
  const file = (leaf.view as unknown as { file?: TFile }).file;
  if (!(file instanceof TFile) || file.extension !== "pdf") return;
  if (!this.overlay) {
    try {
      await this.setupDrawMode(leaf, file);
    } catch (error) {
      console.error("Mobile Ink Annotation: failed to enter draw mode", error);
      new Notice("灏卞湴涔﹀啓妯″紡鍚姩澶辫触: " + String(error));
      this.drawModeLeaf = null;
      this.teardownDrawMode();
      this.update();
    }
  }
}

private async setupDrawMode(leaf: WorkspaceLeaf, file: TFile): Promise<void> {
  const containerEl = leaf.view.containerEl;
  this.drawFile = file;
  const scrollClientWidth = Math.max(320, containerEl.clientWidth || window.innerWidth);

  // 1. 閫昏緫甯冨眬锛氫紭鍏堢敤宸插瓨 annotation 鐨?pageWidth/pageHeight锛屽惁鍒欎粠 pdfjs 绗?1 椤佃鍙ｆ帹绠?  let layout: LogicalPageLayout | null = null;
  const pdfjsLib = (await loadPdfJs()) as PdfJsLib;
  const data = new Uint8Array(await this.app.vault.readBinary(file));
  const pdf = (await pdfjsLib.getDocument({ data }).promise) as PdfJsDocument;
  const computed = await computePageSizeFromPdf(pdf, scrollClientWidth);
  const annotation = await this.store.load(file.path, computed.width, computed.height);
  const useSaved = Number.isFinite(annotation.pageWidth) && annotation.pageWidth > 0
    && Number.isFinite(annotation.pageHeight) && annotation.pageHeight > 0;
  const pageWidth = useSaved ? annotation.pageWidth : computed.width;
  const pageHeight = useSaved ? annotation.pageHeight : computed.height;
  layout = buildUniformPageLayout(pageWidth, pageHeight, pdf.numPages);
  this.layout = layout;

  // 2. 鍏ㄩ儴绗旇抗鎸夐〉鎷嗗垎锛堟湭鍒嗗埌椤电殑鍏滃簳淇濈暀鍦?page1锛?  this.pageStrokes = splitStrokesByPage(annotation.strokes, layout);
  const orphanStrokes = annotation.strokes.filter((s) => !assignStrokeToPage(s, layout));
  if (orphanStrokes.length > 0) {
    const p1 = this.pageStrokes.get(1) ?? [];
    this.pageStrokes.set(1, [...orphanStrokes, ...p1]);
  }

  // 3. 瑕嗙洊灞?+ 鎹曡幏灞?  this.overlay = containerEl.createDiv({ cls: NATIVE_OVERLAY_CLS, attr: { "aria-hidden": "true" } });
  this.captureLayer = this.overlay.createDiv({ cls: NATIVE_OVERLAY_CAPTURE_CLS });

  // 4. 鍙椤靛紩鎿?  const pages = this.getVisiblePages(containerEl);
  for (const { pageNumber, rect } of pages) {
    const page = layout.pages[pageNumber - 1];
    if (!page) continue;
    this.createPageEngine(containerEl, page, rect);
  }

  this.markDirty();
}

private getVisiblePages(containerEl: HTMLElement): Array<{ pageNumber: number; rect: ScreenRect }> {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const candidates = containerEl.querySelectorAll<HTMLElement>(
    "[class*='pdf-page'], [class*='page-container'], .page"
  );
  const pages: Array<{ pageNumber: number; rect: ScreenRect }> = [];
  candidates.forEach((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > vh || rect.right < 0 || rect.left > vw) return;
    const fromAttr = Number(el.getAttribute("data-page-number")) || Number(el.dataset.pageNumber);
    const pageNumber = Number.isFinite(fromAttr) && fromAttr > 0 ? fromAttr : pages.length + 1;
    pages.push({
      pageNumber,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    });
  });
  return pages;
}

private createPageEngine(containerEl: HTMLElement, page: LogicalPage, rect: ScreenRect): void {
  const width = Math.max(1, Math.ceil(rect.width));
  const height = Math.max(1, Math.ceil(rect.height));

  const live = document.createElement("canvas");
  live.className = NATIVE_OVERLAY_PAGE_CANVAS_CLS;
  const committed = document.createElement("canvas");
  committed.className = NATIVE_OVERLAY_PAGE_CANVAS_CLS;
  for (const c of [live, committed]) {
    c.style.position = "absolute";
    c.style.left = `${rect.left}px`;
    c.style.top = `${rect.top}px`;
    c.style.width = `${width}px`;
    c.style.height = `${height}px`;
    c.style.touchAction = "none";
  }
  this.overlay!.append(live, committed);

  const engine = new InkEngine(live, committed, containerEl, {
    initialToolState: { ...this.toolState },
    canvasMaxDpr: 3,
    canvasMaxPixels: resolveInkCanvasBudget(Platform.isMobile),
    panOutsideCanvas: false,
    onInputStart: () => this.markDirty(),
    onChange: () => this.markDirty()
  });
  engine.resize(width, height);
  engine.setDisplayScale(1);

  const logicalStrokes = this.pageStrokes.get(page.pageNumber) ?? [];
  engine.loadStrokes(convertStrokesToScreen(logicalStrokes, page, rect));

  this.engines.push({ engine, page, rect, live, committed });
}

private replacePageStrokes(pageNumber: number): void {
  const entry = this.engines.find((e) => e.page.pageNumber === pageNumber);
  if (!entry) return;
  const logical = convertStrokesToLogical(entry.engine.getStrokes(), entry.page, entry.rect);
  this.pageStrokes.set(pageNumber, logical);
}

private markDirty(): void {
  this.dirty = true;
  if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
  this.saveTimer = window.setTimeout(() => void this.flushSave(), 800);
}

private async flushSave(): Promise<void> {
  if (!this.dirty || !this.layout) return;
  this.dirty = false;
  if (this.saveTimer !== null) { window.clearTimeout(this.saveTimer); this.saveTimer = null; }
  const file = this.drawFile;
  if (!(file instanceof TFile)) return;
  for (const entry of this.engines) {
    this.replacePageStrokes(entry.page.pageNumber);
  }
  const rebuilt: InkStroke[] = [];
  const pageNumbers = Array.from(this.pageStrokes.keys()).sort((a, b) => a - b);
  for (const pn of pageNumbers) {
    rebuilt.push(...(this.pageStrokes.get(pn) ?? []));
  }
  const annotation = await this.store.load(file.path, this.layout.pageWidth, this.layout.pageHeight);
  annotation.strokes = rebuilt;
  await this.store.save(annotation);
}
```

鏇挎崲 `exitDrawMode` 瀹炵幇涓猴細

```ts
private async exitDrawMode(): Promise<void> {
  const leaf = this.drawModeLeaf;
  this.drawModeLeaf = null;
  await this.flushSave();
  this.teardownDrawMode();
  if (leaf) {
    this.currentLeaf = null;
    this.update();
  }
}

private teardownDrawMode(): void {
  if (this.saveTimer !== null) { window.clearTimeout(this.saveTimer); this.saveTimer = null; }
  for (const entry of this.engines) {
    entry.engine.destroy();
  }
  this.engines = [];
  this.pageStrokes = new Map();
  this.layout = null;
  this.drawFile = null;
  this.overlay?.remove();
  this.overlay = null;
  this.captureLayer = null;
}
```

淇 import锛歚overlayInkData` 鐨?import 闇€瑕佸姞涓?`assignStrokeToPage`锛沗InkStroke` 浠?`../ink/types` import锛沗new Notice` 浠?`obsidian` import銆傚皢 `NATIVE_PEN_BUTTON_CLS` 鏀逛负浠庢湰鏂囦欢瀵煎嚭锛堝畠宸插畾涔夛紝鍘绘帀 import 琛岋級銆傛渶缁堝ご閮?import 搴斾负锛?
```ts
import { App, loadPdfJs, Notice, Platform, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import { StrokeStore } from "../ink/StrokeStore";
import { InkEngine } from "../ink/InkEngine";
import { InkStroke, InkToolState } from "../ink/types";
import { resolveInkCanvasBudget } from "../ink/inkBudget";
import { PdfJsDocument, PdfJsLib } from "../views/annotationTypes";
import { buildUniformPageLayout, computePageSizeFromPdf, LogicalPage, LogicalPageLayout, ScreenRect } from "./nativePdfGeometry";
import { assignStrokeToPage, convertStrokesToLogical, convertStrokesToScreen, splitStrokesByPage } from "./overlayInkData";
```

- [ ] **Step 2: 鎵嬪娍閿佸畾锛堝湪 `setupDrawMode` 鏈熬杩藉姞锛?*

```ts
const blockGesture = (event: Event): void => {
  event.preventDefault();
  event.stopPropagation();
};
const onTouchMove = (event: TouchEvent): void => {
  if (event.touches.length >= 2) blockGesture(event);
};
const onWheel = (event: WheelEvent): void => blockGesture(event);
this.captureLayer!.addEventListener("touchmove", onTouchMove, { passive: false });
this.captureLayer!.addEventListener("wheel", onWheel, { passive: false });
this._gestureCleanup = () => {
  this.captureLayer?.removeEventListener("touchmove", onTouchMove);
  this.captureLayer?.removeEventListener("wheel", onWheel);
};
```

骞舵柊澧炲瓧娈?`private _gestureCleanup: (() => void) | null = null;`锛屽湪 `teardownDrawMode` 閲?`this._gestureCleanup?.(); this._gestureCleanup = null;`銆?
- [ ] **Step 3: 鍦?`styles.css` 杩藉姞瑕嗙洊灞傛牱寮?*

```css
.mobile-ink-native-overlay {
  position: fixed;
  inset: 0;
  z-index: 350;
  overflow: hidden;
}
.mobile-ink-native-capture {
  position: absolute;
  inset: 0;
  background: transparent;
  touch-action: none;
}
.mobile-ink-native-page-canvas {
  pointer-events: auto;
}
```

- [ ] **Step 4: 鏋勫缓**

Run: `npm run build`
Expected: 閫€鍑虹爜 0锛屾棤绫诲瀷閿欒锛堣嫢 `InkEngine` 鏌愬瓧娈电被鍨嬩笉鍖归厤锛屼互瀹為檯绛惧悕涓哄噯寰皟锛屼緥濡?`initialToolState` 绫诲瀷锛夈€?
- [ ] **Step 5: 鎻愪氦**

```bash
git add src/pdf/NativePdfOverlayManager.ts styles.css main.js
git commit -m "feat: in-place draw mode with per-page ink engines and gesture lock on native PDF view"
```

- [ ] **Step 6: 璁惧楠岃瘉锛堜复鏃惰烦杩囧伐鍏锋爮锛岀敤榛樿绗斿伐鍏凤級**

鍦ㄥ钩鏉夸笂锛氳鏈湴鏋勫缓 鈫?鎵撳紑 PDF 鈫?鐐圭瑪鎸夐挳 鈫?鍦ㄩ〉闈笂鐢ㄧ瑪/鎵嬫寚锛坄acceptTouchInput` 榛樿 false锛屼粎鎵嬪啓绗旓紱濡傞渶鎵嬫寚鍏堜复鏃剁疆 true 楠岃瘉锛夌敾绾?鈫?閫€鍑烘寜閽殏鏃狅紝鐢?杩斿洖/鍏抽棴 PDF"瑙﹀彂 `layout-change` 閫€鍑哄苟淇濆瓨 鈫?妫€鏌?`.ink.json` 鏄惁鍐欏叆銆佸潗鏍囨槸鍚﹀悎鐞嗐€傛椤逛笌 Task 6 宸ュ叿鏍忓畬鎴愬悗涓€骞跺洖褰掑嵆鍙€?
---

### Task 6: 宸ュ叿鏍?+ 淇濆瓨/閫€鍑?+ 鍙戝竷 1.2.0-beta

**Files:**
- Modify: `src/pdf/NativePdfOverlayManager.ts`
- Modify: `styles.css`
- Modify: `package.json`銆乣manifest.json`锛堢増鏈?鈫?1.2.0锛?
**Interfaces:**
- Consumes: Task 5 鍏ㄩ儴瀛楁涓?`markDirty`/`flushSave`/`teardownDrawMode`锛沗setIcon`锛坥bsidian锛夛紱`refreshToolbar()`锛堟湰浠诲姟鏂板锛夈€?- Produces: 鏈换鍔℃柊澧炵鏈夋柟娉?`buildToolbar(containerEl)`銆乣refreshToolbar()`銆乣applyToolState(patch)`銆乣exitButton` 鍥炶皟銆?
- [ ] **Step 1: 鍦ㄧ被鍐呮柊澧炲伐鍏锋爮鏂规硶涓庣姸鎬佸埛鏂?*

```ts
private toolbar: HTMLElement | null = null;
private toolbarButtons: Record<string, HTMLElement> = {};

private buildToolbar(containerEl: HTMLElement): void {
  const bar = containerEl.createDiv({ cls: "mobile-ink-native-toolbar" });
  this.toolbar = bar;
  const tools: Array<{ key: string; icon: string; label: string; action: () => void }> = [
    { key: "pen", icon: "pen-tool", label: "绗?, action: () => this.applyToolState({ tool: "pen" }) },
    { key: "highlighter", icon: "highlighter", label: "鑽у厜绗?, action: () => this.applyToolState({ tool: "highlighter" }) },
    { key: "eraser", icon: "eraser", label: "姗＄毊", action: () => this.applyToolState({ tool: "eraser" }) },
    { key: "undo", icon: "undo-2", label: "鎾ら攢", action: () => { for (const e of this.engines) e.engine.undo(); this.refreshToolbar(); } },
    { key: "redo", icon: "redo-2", label: "閲嶅仛", action: () => { for (const e of this.engines) e.engine.redo(); this.refreshToolbar(); } },
    { key: "color", icon: "palette", label: "棰滆壊", action: () => this.cycleColor() },
    { key: "width", icon: "sliders-horizontal", label: "绾垮", action: () => this.cycleWidth() },
    { key: "save", icon: "checkmark", label: "淇濆瓨", action: () => void this.flushSave() },
    { key: "exit", icon: "x", label: "閫€鍑?, action: () => void this.exitDrawMode() }
  ];
  for (const t of tools) {
    const btn = bar.createEl("button", { cls: "mobile-ink-native-tool", attr: { "aria-label": t.label } });
    setIcon(btn, t.icon);
    btn.addEventListener("click", t.action);
    this.toolbarButtons[t.key] = btn;
  }
  this.refreshToolbar();
}

private refreshToolbar(): void {
  if (!this.toolbar) return;
  const t = this.toolState;
  for (const key of ["pen", "highlighter", "eraser"]) {
    const el = this.toolbarButtons[key];
    if (el) el.classList.toggle("mobile-ink-native-tool-active", t.tool === key);
  }
}

private applyToolState(patch: Partial<InkToolState>): void {
  Object.assign(this.toolState, patch);
  for (const e of this.engines) e.engine.setToolState({ ...patch });
  this.refreshToolbar();
}

private cycleColor(): void {
  const palette = ["#111111", "#e53935", "#1e88e5", "#43a047", "#ffb300", "#8e24aa"];
  const current = this.toolState.tool === "highlighter" ? this.toolState.highlighterColor : this.toolState.color;
  const next = palette[(palette.indexOf(current) + 1 + palette.length) % palette.length];
  if (this.toolState.tool === "highlighter") this.applyToolState({ highlighterColor: next });
  else this.applyToolState({ color: next });
}

private cycleWidth(): void {
  const widths = [2, 3, 5, 8];
  const current = this.toolState.tool === "highlighter" ? this.toolState.highlighterWidth : this.toolState.width;
  const next = widths[(widths.indexOf(current) + 1) % widths.length];
  if (this.toolState.tool === "highlighter") this.applyToolState({ highlighterWidth: next });
  else this.applyToolState({ width: next });
}
```

- [ ] **Step 2: 鍦?`setupDrawMode` 鐨勮鐩栧眰鍒涘缓鍚庤皟鐢ㄥ伐鍏锋爮**

鍦?`this.captureLayer = this.overlay.createDiv(...)` 涔嬪悗銆乣getVisiblePages` 涔嬪墠鎻掑叆锛?
```ts
this.buildToolbar(this.overlay);
```

- [ ] **Step 3: 宸ュ叿鏍忔牱寮忚拷鍔犲埌 `styles.css`**

```css
.mobile-ink-native-toolbar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  gap: 6px;
  align-items: center;
  justify-content: center;
  padding: 8px;
  background: var(--background-primary);
  border-bottom: 1px solid var(--background-modifier-border);
  z-index: 360;
}
.mobile-ink-native-tool {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: transparent;
  color: var(--text-normal);
  border: none;
  cursor: pointer;
}
.mobile-ink-native-tool-active {
  background: var(--interactive-accent);
  color: var(--text-on-accent);
}
```

- [ ] **Step 4: 鏋勫缓 + 鍗曞厓娴嬭瘯鍥炲綊**

Run: `npm run build`
Expected: 閫€鍑虹爜 0銆?Run: `node --experimental-strip-types scripts/test-canvas-budget.mjs`
Expected: `OK: all canvas budget assertions passed`銆?Run: `node --experimental-strip-types scripts/test-native-pdf-geometry.mjs`
Expected: `OK: all native-pdf-geometry assertions passed`銆?
- [ ] **Step 5: 鐪熸満瀹屾暣楠岃瘉娓呭崟**

鍦ㄥ钩鏉夸笂瑁呮湰鍦版瀯寤猴紝閫愰」楠岃瘉锛?1. 鎵撳紑澶氶〉 PDF 鈫?鍙充笅瑙掔瑪鎸夐挳鍑虹幇銆?2. 鐐圭瑪鎸夐挳 鈫?杩涘叆缁樼敾妯″紡锛岄《閮ㄥ伐鍏锋爮鍑虹幇锛岄〉闈粛鍙銆?3. 鐢ㄦ墜鍐欑瑪鍦ㄩ〉闈功鍐?鈫?绗旇抗鍗虫椂鏄剧ず锛涙崲鑽у厜绗?棰滆壊/绾垮鐢熸晥锛涙鐨摝闄ょ敓鏁堬紱鎾ら攢/閲嶅仛鐢熸晥銆?4. 鍙屾寚鎹忓悎/婊氬姩鍦ㄧ粯鐢绘ā寮忎笅涓嶇Щ鍔ㄩ〉闈紙閿佸畾鐢熸晥锛夈€?5. 鐐?淇濆瓨" 鈫?`.ink.json` 鏇存柊锛涚偣"閫€鍑? 鈫?瑕嗙洊灞傛秷澶憋紝鍘熺敓瑙嗗浘鍙甯哥缉鏀剧炕椤点€?6. 閲嶆柊杩涘叆缁樼敾妯″紡 鈫?涔嬪墠鍐欑殑绗旇抗鏄剧ず鍦ㄦ纭綅缃€?7. 鎵撳紑鐜版湁瀹屾暣鏍囨敞瑙嗗浘锛坮ibbon/鍛戒护锛夆啋 瑕嗙洊灞傚啓鐨勭瑪杩瑰湪閭ｉ噷涔熸樉绀哄湪鍚屼竴浣嶇疆銆?8. 鍦ㄥ畬鏁存爣娉ㄨ鍥鹃噷鍐欑殑绗旇抗锛屽洖鍒拌鐩栧眰鍚屾牱鏄剧ず銆?
- [ ] **Step 6: 鐗堟湰鍗囧埌 1.2.0 骞跺彂甯?*

`package.json` 涓?`manifest.json` 鐨?`version` 鏀逛负 `"1.2.0"`銆傛瀯寤哄悗锛?
```bash
git add src/pdf/NativePdfOverlayManager.ts styles.css package.json manifest.json main.js
git commit -m "feat: in-place native PDF handwriting mode with toolbar (pen/highlighter/eraser/undo/redo/color/width/save/exit)"
git tag v1.2.0-beta
git push "https://x-access-token:<PUSH_TOKEN>@github.com/XiaoA-Tang/mobile-ink-annotation.git" main v1.2.0-beta
```

鐢?node 鍐?UTF8 body 鍚?POST release锛坱ag `v1.2.0-beta`銆乸rerelease銆佷腑鏂?body 璇存槑鍔熻兘涓庨獙璇佺偣锛夛紝涓婁紶 main.js/manifest.json/styles.css 涓変釜 assets銆?
- [ ] **Step 7: 鐢ㄦ埛鍥炲綊 + 鏀跺熬**

鐢ㄦ埛瀹夎 v1.2.0-beta 鐪熸満鍥炲綊锛涘鏈夐棶棰樻寜鍙嶉杩唬銆傜‘璁ょǔ瀹氬悗锛屽皢 `src/pdf/nativePdfProbe.ts` 鐨勮嚜鍔ㄦ帰娴嬩笌鍛戒护淇濈暀锛堜綆椋庨櫓锛屼究浜庢棩鍚庤瘖鏂級锛屾棤闇€鍒犻櫎銆?
---

## Self-Review

**Spec 瑕嗙洊瀵圭収锛?*
- 鍏ュ彛/鍑哄彛锛堢瑪鎸夐挳銆佽繘鍏?閫€鍑恒€佸懡浠わ級鈫?Task 4銆?銆?- 鍑犱綍瀵归綈锛堥〉鍏冪礌 rect + 鑷湁 pdfjs 閫昏緫灏哄 + 鍧愭爣鎹㈢畻锛夆啋 Task 2銆?銆?- 澧ㄨ抗灞傦紙澶嶇敤 InkEngine銆侀绠椼€佹棤 desync 浜?committed锛夆啋 Task 5锛圛nkEngine 鏋勯€犳部鐢?renderer 榛樿锛歝ommitted 宸茬敱 v1.1.15 鍥哄畾涓?`desynchronized:false`锛屾澶勬棤闇€閲嶅澶勭悊锛沚acking 棰勭畻鐢?`resolveInkCanvasBudget` 浼犲叆锛夈€?- 鎵嬪娍閿佸畾锛堢粯鐢绘ā寮忛攣瀹氱缉鏀?婊氬姩锛夆啋 Task 5 Step 2銆?- 宸ュ叿闆嗭紙鍚崸鍏夌瑪锛夆啋 Task 6銆?- 鏁版嵁浜掗€氾紙鍚?Store/鍚屽潗鏍囷級鈫?Task 3銆?銆?- SPIKE 闂搁棬 鈫?Task 1銆?- 闄嶇骇璺緞锛堟娴嬪け璐ユ椂鎻愮ず鐢ㄥ畬鏁存爣娉ㄨ鍥撅級鈫?瑕嗙洊鍦?`setupDrawMode` 鐨?try/catch锛圱ask 5锛夛紝澶辫触鍗?Notice 鎻愮ず骞堕€€鍑恒€?
**Type 涓€鑷存€ф牳鏌ワ細**
- `LogicalPageLayout`/`LogicalPage`/`ScreenRect` 鍦?Task 2 瀹氫箟锛孴ask 3/5/6 涓€鑷村紩鐢ㄣ€?- `convertStrokesToScreen/ToLogical` 绛惧悕 Task 3 瀹氫箟锛孴ask 5 璋冪敤涓€鑷淬€?- `NATIVE_PEN_BUTTON_CLS` 鍦?Task 4 瀹氫箟骞跺鍑猴紝Task 5 import 淇鍚庣敱鏈枃浠舵彁渚涖€?- `assignStrokeToPage` Task 3 瀹氫箟锛孴ask 5 浣跨敤銆?- `InkEngine` 鏋勯€犲弬鏁颁笌鐪熷疄绛惧悕涓€鑷达紙`(liveCanvas, committedCanvas, scrollEl, options)`锛宍resize(w,h)`銆乣setDisplayScale(scale)`銆乣loadStrokes/strokes[]`銆乣getStrokes()`銆乣setToolState(patch)`銆乣undo/redo/destroy`锛夈€?