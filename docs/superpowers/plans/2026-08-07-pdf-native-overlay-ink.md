# PDF 原生视图就地书写模式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Obsidian 原生 PDF 视图上叠加就地手写层——点击悬浮"笔"按钮直接进入绘画模式，手写/荧光笔/橡皮自由书写，退出后回到原生视图继续阅读缩放，全程不另开标签页，笔迹与现有完整标注视图互通。

**Architecture:** 插件级单例 `NativePdfOverlayManager` 监听工作区 leaf，检测原生 PDF 视图并挂悬浮笔按钮。进入绘画模式后，在 leaf 容器上叠加 fixed 覆盖层，对每个可见页创建一个对齐其屏幕矩形的 `InkEngine`（引擎工作在"页屏幕像素"空间）；笔迹在持久化边界处用纯函数换算到全局逻辑坐标（与现有 `.ink.json` 同构）。绘画模式锁定缩放/滚动，规避同步原生缩放的错位风险。**Task 1 是真机 SPIKE（可行性闸门）**，检测原生 PDF 页元素是否可访问、非 iframe/embed 隔离。

**Tech Stack:** TypeScript、Obsidian API（`loadPdfJs`、`setIcon`、`workspace` 事件）、pdfjs-dist（仅取视口几何）、现有 `InkEngine`/`StrokeStore`/`SaveQueue`/`resolveInkCanvasBudget`。

## Global Constraints

- 坐标约定：存储笔迹为**全局逻辑坐标**；第 N 页 `y ∈ [offsetY, offsetY + pageHeight]`，`offsetY = (N-1) * (pageHeight + PDF_BACKGROUND_PAGE_GAP)`，`PDF_BACKGROUND_PAGE_GAP = 12`，逻辑页宽高取自 `views/annotationConstants.ts`。所有转换函数与现有 `AnnotationView.preparePdfInkStrokesForCurrentLayout` 约定一致。
- 墨迹渲染：committed canvas **必须 `desynchronized:false`**（v1.1.15 修复，Android WebView 呈现缺陷）；backing 受 `resolveInkCanvasBudget` 上限约束（v1.1.14 修复）。
- 工具状态默认值：`tool:"pen"`, `color:"#111111"`, `width:2`, `highlighterColor:"#ffd54a"`, `highlighterWidth:14`, `eraserRadius:18`, `acceptTouchInput:false`（与 `AnnotationView.createInitialInkToolState` 一致）。
- 绘画模式锁定缩放/滚动（用户已确认），这是主动取舍，不算缺陷。
- 发布流程（每次发布固定步骤）：`npm run build` → `git commit` → tag → `git push "https://x-access-token:<TOKEN>@github.com/XiaoA-Tang/mobile-ink-annotation.git" main <tag>` → POST release（body 用 node 写 UTF8 文件 + `curl.exe --data-binary`）→ 上传 3 个 assets。
- 单元测试运行方式：`node --experimental-strip-types scripts/test-native-pdf-geometry.mjs`（沿用 `test-canvas-budget.mjs` 的 TS strip 模式）。

---

### Task 1: SPIKE — 原生 PDF 结构探测（发布 1.1.16-beta）

**Files:**
- Create: `src/pdf/nativePdfProbe.ts`
- Modify: `src/main.ts`
- Modify: `package.json`、`manifest.json`（版本 1.1.15 → 1.1.16）

**Interfaces:**
- Produces: `probeNativePdfStructure(leaf: WorkspaceLeaf): NativePdfProbeResult`（Task 4 复用其中页元素检测思路）。
- Consumes: 无。

- [ ] **Step 1: 创建 `src/pdf/nativePdfProbe.ts`**

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

- [ ] **Step 2: 在 `src/main.ts` 接入探测命令 + 每次会话自动探测一次**

在文件顶部 import 处加入：

```ts
import { probeNativePdfStructure } from "./pdf/nativePdfProbe";
```

在 `onload()` 内、`this.registerEvent(...)` 之后加入自动探测逻辑（每次会话只自动跑一次，打开 PDF 后延迟等页渲染完再探测）：

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
    new Notice(`探测完成: 页候选=${result.candidatePageCount}, iframe=${result.iframeCount}, embed=${result.embeds.length}, pdfView=${result.pdfViewFound}。结果写入 ${pluginDir}/native-pdf-probe.json`);
  }, 2000);
}));

this.addCommand({
  id: "probe-native-pdf-structure",
  name: "探测原生 PDF 视图结构 (SPIKE)",
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
    new Notice(`探测完成: 页候选=${result.candidatePageCount}, iframe=${result.iframeCount}, embed=${result.embeds.length}。结果写入 ${pluginDir}/native-pdf-probe.json`);
    return true;
  }
});
```

- [ ] **Step 3: 版本升到 1.1.16**

`package.json` 与 `manifest.json` 的 `version` 字段改为 `"1.1.16"`。

- [ ] **Step 4: 构建**

Run: `npm run build`
Expected: 无输出错误，退出码 0（`tsc -noEmit` 通过 + esbuild 产出 main.js）。

- [ ] **Step 5: 提交并打 tag**

```bash
git add src/pdf/nativePdfProbe.ts src/main.ts package.json manifest.json main.js
git commit -m "feat(spike): probe native PDF view DOM structure on device"
git tag v1.1.16-beta
```

- [ ] **Step 6: 推送并发布**

```bash
git push "https://x-access-token:<PUSH_TOKEN>@github.com/XiaoA-Tang/mobile-ink-annotation.git" main v1.1.16-beta
```

用 node 写 UTF8 body 文件后 POST release（tag 名 `v1.1.16-beta`、prerelease、中文 body：说明这是 SPIKE 探测版，装好后打开任意 PDF，会自动生成 `native-pdf-probe.json`，把该文件内容反馈回来），再上传 main.js/manifest.json/styles.css 三个 assets（流程见 Global Constraints）。

- [ ] **Step 7: 用户真机验证（可行性闸门）**

用户装 1.1.16-beta，打开一个多页 PDF，等 2 秒，把插件目录下的 `native-pdf-probe.json` 内容反馈。
**通过判据**：`candidatePageCount >= 1` 且每个页候选 `canvases.length >= 1`，`iframeCount === 0`，`embeds.length === 0`。若通过 → 继续 Task 2-6；若页候选为 0 或 iframe/embed 隔离 → 停下来与用户重新评估（覆盖层不可行，降级为方案 B 就地切换）。

### SPIKE 探测结论（Task 1 真机反馈 2026-08-07，华为平板 / 209 页 PDF）

- **闸门判定：通过（可行）。** `iframeCount=0`、`embeds.length=0` → 页元素与 leaf 同 DOM，无隔离障碍。`candidatePageCount=209` 中 207 个为真 `.page` 元素。
- **修正 1 — 页选择器**：`[class*='pdf-page']` 会误配工具栏（`.pdf-page-input`、`.pdf-page-numbers`）。页元素一律用精确 `.page` 类 + `data-page-number` 属性（Task 4 起生效；Task 1 探测代码保留原样，仅作为已消费的一次性探测）。
- **修正 2 — 原生布局无 gap**：所有 `.page` rect top 递增恰好 = 页高（无 12px 间隙）。不影响存储坐标系——`buildUniformPageLayout` 的 gap 定义的是全局逻辑存储空间（与现有视图一致），换算按页锚定到 DOM rect。几何模块不得假定原生空间含 gap，一律从 DOM 实测 rect 推导。
- **修正 3 — canvas 懒渲染**：仅可见页有 canvas（209 页中仅 4 页）。"每页 canvases>=1" 判据无效。覆盖层自建 canvas 锚定 `.page` rect，不依赖原生 canvas 存在。
- **修正 4 — viewer 类名**：`.pdf-view` 不存在；检测用 `.pdf-viewer`/`.pdf-container`/`.pdf-scroll-container`（Task 4 检测）。
- **修正 5 — 页 div 动态窗口**：远离视口的 `.page` 会被 pdf.js 移除/重建（探测时第 1、2 页 div 不在 DOM）。Task 4/5 需在滚动时 re-scan/MutationObserver 挂载覆盖 canvas，不能假定全部页常驻。
- **原生 canvas 内嵌**：页 rect 674×935，原生 canvas 666×927（约 4px 内边距）。覆盖对齐以 `.page` rect（border-box）为锚，不用 canvas。
- **发布流程教训**：release body 必须用 node 写 UTF8 文件（PowerShell here-string 会被控制台 GBK 编码损坏中文）；`<PUSH_TOKEN>` 占位符不得被回填进提交。

---

### Task 2: 纯几何模块 + 单元测试

**Files:**
- Create: `src/pdf/nativePdfGeometry.ts`
- Create: `scripts/test-native-pdf-geometry.mjs`
- Modify: `tsconfig.json`（加 `"allowImportingTsExtensions": true`）

**Interfaces:**
- Consumes: `PdfJsDocument`（来自 `src/views/annotationTypes.ts`）、`PDF_BACKGROUND_PAGE_GAP`/`PDF_BACKGROUND_MOBILE_MAX_WIDTH`（来自 `src/views/annotationConstants.ts`）。
- Produces（Task 3、5、6 依赖）:
  - `type LogicalPage = { pageNumber: number; offsetY: number; width: number; height: number }`
  - `type LogicalPageLayout = { pageWidth: number; pageHeight: number; pages: LogicalPage[] }`
  - `type ScreenRect = { left: number; top: number; width: number; height: number }`
  - `computePageSizeFromPdf(pdf, scrollClientWidth, maxWidth?): Promise<{ width: number; height: number }>`（用第 1 页视口在 scale=1 下按目标宽度换算）
  - `buildUniformPageLayout(pageWidth, pageHeight, numPages): LogicalPageLayout`（页间 offsetY 含 gap）
  - `screenToLogical(page, rect, x, y): { x: number; y: number }`
  - `logicalToScreen(page, rect, x, y): { x: number; y: number }`

- [ ] **Step 1: 写失败测试 `scripts/test-native-pdf-geometry.mjs`**

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

// 1. computePageSizeFromPdf: scroll 宽度 984 → available=960 → target=960, scale=960/612≈1.5686
const size = await computePageSizeFromPdf(fakePdf, 984);
assert("page width from pdf", size.width, 960);
assert("page height from pdf", size.height, Math.ceil(792 * (960 / 612)));

// 2. uniform layout: offsetY 含 gap，页内高度一致
const layout = buildUniformPageLayout(960, 1242, 3);
assert("page count", layout.pages.length, 3);
assert("page1 offsetY", layout.pages[0].offsetY, 0);
assert("page2 offsetY", layout.pages[1].offsetY, 1242 + PDF_BACKGROUND_PAGE_GAP);
assert("page3 offsetY", layout.pages[2].offsetY, (1242 + PDF_BACKGROUND_PAGE_GAP) * 2);

// 3. screenToLogical / logicalToScreen 往返一致（page2，含 gap 偏移）
const rect = { left: 10, top: 20, width: 480, height: 621 };
const logical = screenToLogical(layout.pages[1], rect, 10 + 240, 20 + 310.5);
assert("logical x", logical.x, 480);
assert("logical y", logical.y, 1242 + PDF_BACKGROUND_PAGE_GAP + 621);
const screen = logicalToScreen(layout.pages[1], rect, logical.x, logical.y);
assert("roundtrip x", Math.round(screen.x), 250);
assert("roundtrip y", Math.abs(screen.y - 330.5) < 0.001, true);

// 4. 非零保护：width/height 为 0 时返回原坐标不 NaN
const zero = screenToLogical(layout.pages[0], { left: 0, top: 0, width: 0, height: 0 }, 5, 5);
assert("zero rect finite", [zero.x, zero.y].every(Number.isFinite), true);

if (failed > 0) {
  console.error(`FAILED: ${failed} assertion(s)`);
  process.exit(1);
}
console.log("OK: all native-pdf-geometry assertions passed");
```

- [ ] **Step 2: 运行确认失败**

Run: `node --experimental-strip-types scripts/test-native-pdf-geometry.mjs`
Expected: FAIL，报 `Cannot find module ... nativePdfGeometry.ts` 或 `computePageSizeFromPdf is not a function`。

- [ ] **Step 2.5: tsconfig 启用 `.ts` 扩展名导入**

在 `tsconfig.json` 的 `compilerOptions` 中加入 `"allowImportingTsExtensions": true`（构建命令为 `tsc -noEmit -skipLibCheck`，满足该选项"需 noEmit"的前提）。原因：`nativePdfGeometry.ts` 运行时导入 `annotationConstants`，Node `--experimental-strip-types` 不做扩展名解析，必须写成 `../views/annotationConstants.ts` 才能被测试脚本加载。esbuild 与 tsc（noEmit）均可处理 `.ts` 扩展名导入，不影响现有文件。

- [ ] **Step 3: 实现 `src/pdf/nativePdfGeometry.ts`**

```ts
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
```

- [ ] **Step 4: 运行确认通过**

Run: `node --experimental-strip-types scripts/test-native-pdf-geometry.mjs`
Expected: 全部 ok + `OK: all native-pdf-geometry assertions passed`，退出码 0。

- [ ] **Step 5: 提交**

```bash
git add src/pdf/nativePdfGeometry.ts scripts/test-native-pdf-geometry.mjs tsconfig.json
git commit -m "feat: native PDF overlay geometry (logical layout + screen mapping) with tests"
```

---

### Task 3: 笔迹数据层（按页拆分 + 坐标换算）+ 单元测试

**Files:**
- Create: `src/pdf/overlayInkData.ts`
- Modify: `scripts/test-native-pdf-geometry.mjs`（追加断言）

**Interfaces:**
- Consumes: `InkStroke`（`src/ink/types.ts`）、Task 2 的 `LogicalPageLayout`/`LogicalPage`/`ScreenRect`/`screenToLogical`/`logicalToScreen`。
- Produces（Task 5、6 依赖）:
  - `assignStrokeToPage(stroke, layout): LogicalPage | null`（按笔迹中点 y 落入页范围，最近页兜底）
  - `splitStrokesByPage(strokes, layout): Map<number, InkStroke[]>`
  - `convertStrokesToScreen(strokes, page, rect): InkStroke[]`（坐标与线宽 `sqrt(scaleX*scaleY)` 缩放）
  - `convertStrokesToLogical(strokes, page, rect): InkStroke[]`

- [ ] **Step 1: 先写失败测试（追加到 `scripts/test-native-pdf-geometry.mjs` 末尾、`if (failed > 0)` 之前）**

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

- [ ] **Step 2: 运行确认失败**

Run: `node --experimental-strip-types scripts/test-native-pdf-geometry.mjs`
Expected: FAIL，`Cannot find module ... overlayInkData.ts`。

- [ ] **Step 3: 实现 `src/pdf/overlayInkData.ts`**

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

- [ ] **Step 4: 运行确认通过**

Run: `node --experimental-strip-types scripts/test-native-pdf-geometry.mjs`
Expected: 全部 ok + `OK: all native-pdf-geometry assertions passed`。

- [ ] **Step 5: 提交**

```bash
git add src/pdf/overlayInkData.ts scripts/test-native-pdf-geometry.mjs
git commit -m "feat: overlay ink data layer (per-page split + screen/logical conversion) with tests"
```

---

### Task 4: NativePdfOverlayManager 骨架 — 检测原生 PDF leaf + 悬浮笔按钮

**Files:**
- Create: `src/pdf/NativePdfOverlayManager.ts`
- Modify: `src/main.ts`
- Modify: `styles.css`

**Interfaces:**
- Consumes: `StrokeStore`（`src/ink/StrokeStore.ts`）、`probeNativePdfStructure`（Task 1，仅参考检测思路，不直接调用）。
- Produces（Task 5、6 依赖）:
  - `class NativePdfOverlayManager { constructor(app: App, store: StrokeStore); onload(): void; onunload(): void; }`
  - 私有方法 `update()`, `attachPenButton(leaf)`, `removePenButton()`, `enterDrawMode(leaf)`（Task 5 实现体）。

- [ ] **Step 1: 实现 `src/pdf/NativePdfOverlayManager.ts`（骨架 + 笔按钮）**

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
      attr: { "aria-label": "就地手写批注" }
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
    // Task 5 填充：加载标注 → 计算布局 → 建覆盖层与逐页墨迹引擎
    // Task 6 填充：工具栏、保存、退出
  }

  private async exitDrawMode(): Promise<void> {
    const leaf = this.drawModeLeaf;
    this.drawModeLeaf = null;
    // Task 6 填充：flush 保存 + 卸载覆盖层
    if (leaf) {
      this.currentLeaf = null;
      this.update();
    }
  }
}
```

注：`Platform` 在 Task 5 用于 `resolveInkCanvasBudget(Platform.isMobile)`，import 保留（Task 5 用到）。

- [ ] **Step 2: 在 `src/main.ts` 实例化 Manager**

在 import 处加入：

```ts
import { NativePdfOverlayManager } from "./pdf/NativePdfOverlayManager";
```

在 `onload()` 内、`this.store = new StrokeStore(...)` 之后：

```ts
this.nativePdfOverlay = new NativePdfOverlayManager(this.app, this.store);
this.nativePdfOverlay.onload();
```

在类上声明字段：`private nativePdfOverlay!: NativePdfOverlayManager;`

在 `onunload()` 内、`detachLeavesOfType` 之前：

```ts
this.nativePdfOverlay?.onunload();
```

- [ ] **Step 3: 在 `styles.css` 追加样式**

追加到文件末尾：

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

- [ ] **Step 4: 构建**

Run: `npm run build`
Expected: 退出码 0，无类型错误。

- [ ] **Step 5: 提交**

```bash
git add src/pdf/NativePdfOverlayManager.ts src/main.ts styles.css main.js
git commit -m "feat: native PDF overlay manager skeleton with floating pen button"
```

- [ ] **Step 6: 设备验证（不发布，直接装本地构建验证）**

在平板上启用插件，打开原生 PDF：右下角出现笔按钮；点按钮不报错（目前无覆盖层，行为为空）；切换/关闭 PDF，按钮正确消失。若未装本地版，可跳过此步，随 Task 6 一并验证。

---

### Task 5: 绘画模式 — 覆盖层 + 逐页墨迹引擎 + 指针/手势锁定

**Files:**
- Modify: `src/pdf/NativePdfOverlayManager.ts`
- Modify: `styles.css`

**Interfaces:**
- Consumes: Task 2 `computePageSizeFromPdf`/`buildUniformPageLayout`/`LogicalPageLayout`/`ScreenRect`；Task 3 `splitStrokesByPage`/`convertStrokesToScreen`/`convertStrokesToLogical`；`InkEngine`（`src/ink/InkEngine.ts`，构造 `(liveCanvas, committedCanvas, scrollEl, options)`，方法 `resize`/`setDisplayScale`/`loadStrokes`/`getStrokes`/`setToolState`/`undo`/`redo`/`destroy`/`setInputEnabled`）；`resolveInkCanvasBudget`（`src/ink/inkBudget.ts`）；`loadPdfJs`（Obsidian API）；`PdfJsLib`/`PdfJsDocument`（`src/views/annotationTypes.ts`）。
- Produces（Task 6 依赖）: 私有字段 `this.engines: Array<{ engine: InkEngine; page: LogicalPage; rect: ScreenRect; live: HTMLCanvasElement; committed: HTMLCanvasElement }>`；私有字段 `this.toolState: InkToolState`；方法 `getVisiblePages(containerEl): Array<{ pageNumber: number; rect: ScreenRect }>`；`enterDrawMode`/`exitDrawMode` 完整实现（含墨迹层，不含工具栏）。

- [ ] **Step 1: 重写 `enterDrawMode` / `exitDrawMode`，加入覆盖层与逐页引擎**

在 `NativePdfOverlayManager.ts` 顶部 import 补全：

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

在类内新增字段与常量：

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

替换 `enterDrawMode` 实现为：

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
      new Notice("就地书写模式启动失败: " + String(error));
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

  // 1. 逻辑布局：优先用已存 annotation 的 pageWidth/pageHeight，否则从 pdfjs 第 1 页视口推算
  let layout: LogicalPageLayout | null = null;
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

  // 2. 全部笔迹按页拆分（未分到页的兜底保留在 page1）
  this.pageStrokes = splitStrokesByPage(annotation.strokes, layout);
  const orphanStrokes = annotation.strokes.filter((s) => !assignStrokeToPage(s, layout));
  if (orphanStrokes.length > 0) {
    const p1 = this.pageStrokes.get(1) ?? [];
    this.pageStrokes.set(1, [...orphanStrokes, ...p1]);
  }

  // 3. 覆盖层 + 捕获层
  this.overlay = containerEl.createDiv({ cls: NATIVE_OVERLAY_CLS, attr: { "aria-hidden": "true" } });
  this.captureLayer = this.overlay.createDiv({ cls: NATIVE_OVERLAY_CAPTURE_CLS });

  // 4. 可见页引擎
  const pages = this.getVisiblePages(containerEl);
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

替换 `exitDrawMode` 实现为：

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

修正 import：`overlayInkData` 的 import 需要加上 `assignStrokeToPage`；`InkStroke` 从 `../ink/types` import；`new Notice` 从 `obsidian` import。将 `NATIVE_PEN_BUTTON_CLS` 改为从本文件导出（它已定义，去掉 import 行）。最终头部 import 应为：

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

- [ ] **Step 2: 手势锁定（在 `setupDrawMode` 末尾追加）**

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

并新增字段 `private _gestureCleanup: (() => void) | null = null;`，在 `teardownDrawMode` 里 `this._gestureCleanup?.(); this._gestureCleanup = null;`。

- [ ] **Step 3: 在 `styles.css` 追加覆盖层样式**

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

- [ ] **Step 4: 构建**

Run: `npm run build`
Expected: 退出码 0，无类型错误（若 `InkEngine` 某字段类型不匹配，以实际签名为准微调，例如 `initialToolState` 类型）。

- [ ] **Step 5: 提交**

```bash
git add src/pdf/NativePdfOverlayManager.ts styles.css main.js
git commit -m "feat: in-place draw mode with per-page ink engines and gesture lock on native PDF view"
```

- [ ] **Step 6: 设备验证（临时跳过工具栏，用默认笔工具）**

在平板上：装本地构建 → 打开 PDF → 点笔按钮 → 在页面上用笔/手指（`acceptTouchInput` 默认 false，仅手写笔；如需手指先临时置 true 验证）画线 → 退出按钮暂无，用"返回/关闭 PDF"触发 `layout-change` 退出并保存 → 检查 `.ink.json` 是否写入、坐标是否合理。此项与 Task 6 工具栏完成后一并回归即可。

---

### Task 6: 工具栏 + 保存/退出 + 发布 1.2.0-beta

**Files:**
- Modify: `src/pdf/NativePdfOverlayManager.ts`
- Modify: `styles.css`
- Modify: `package.json`、`manifest.json`（版本 → 1.2.0）

**Interfaces:**
- Consumes: Task 5 全部字段与 `markDirty`/`flushSave`/`teardownDrawMode`；`setIcon`（obsidian）；`refreshToolbar()`（本任务新增）。
- Produces: 本任务新增私有方法 `buildToolbar(containerEl)`、`refreshToolbar()`、`applyToolState(patch)`、`exitButton` 回调。

- [ ] **Step 1: 在类内新增工具栏方法与状态刷新**

```ts
private toolbar: HTMLElement | null = null;
private toolbarButtons: Record<string, HTMLElement> = {};

private buildToolbar(containerEl: HTMLElement): void {
  const bar = containerEl.createDiv({ cls: "mobile-ink-native-toolbar" });
  this.toolbar = bar;
  const tools: Array<{ key: string; icon: string; label: string; action: () => void }> = [
    { key: "pen", icon: "pen-tool", label: "笔", action: () => this.applyToolState({ tool: "pen" }) },
    { key: "highlighter", icon: "highlighter", label: "荧光笔", action: () => this.applyToolState({ tool: "highlighter" }) },
    { key: "eraser", icon: "eraser", label: "橡皮", action: () => this.applyToolState({ tool: "eraser" }) },
    { key: "undo", icon: "undo-2", label: "撤销", action: () => { for (const e of this.engines) e.engine.undo(); this.refreshToolbar(); } },
    { key: "redo", icon: "redo-2", label: "重做", action: () => { for (const e of this.engines) e.engine.redo(); this.refreshToolbar(); } },
    { key: "color", icon: "palette", label: "颜色", action: () => this.cycleColor() },
    { key: "width", icon: "sliders-horizontal", label: "线宽", action: () => this.cycleWidth() },
    { key: "save", icon: "checkmark", label: "保存", action: () => void this.flushSave() },
    { key: "exit", icon: "x", label: "退出", action: () => void this.exitDrawMode() }
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

- [ ] **Step 2: 在 `setupDrawMode` 的覆盖层创建后调用工具栏**

在 `this.captureLayer = this.overlay.createDiv(...)` 之后、`getVisiblePages` 之前插入：

```ts
this.buildToolbar(this.overlay);
```

- [ ] **Step 3: 工具栏样式追加到 `styles.css`**

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

- [ ] **Step 4: 构建 + 单元测试回归**

Run: `npm run build`
Expected: 退出码 0。
Run: `node --experimental-strip-types scripts/test-canvas-budget.mjs`
Expected: `OK: all canvas budget assertions passed`。
Run: `node --experimental-strip-types scripts/test-native-pdf-geometry.mjs`
Expected: `OK: all native-pdf-geometry assertions passed`。

- [ ] **Step 5: 真机完整验证清单**

在平板上装本地构建，逐项验证：
1. 打开多页 PDF → 右下角笔按钮出现。
2. 点笔按钮 → 进入绘画模式，顶部工具栏出现，页面仍可见。
3. 用手写笔在页面书写 → 笔迹即时显示；换荧光笔/颜色/线宽生效；橡皮擦除生效；撤销/重做生效。
4. 双指捏合/滚动在绘画模式下不移动页面（锁定生效）。
5. 点"保存" → `.ink.json` 更新；点"退出" → 覆盖层消失，原生视图可正常缩放翻页。
6. 重新进入绘画模式 → 之前写的笔迹显示在正确位置。
7. 打开现有完整标注视图（ribbon/命令）→ 覆盖层写的笔迹在那里也显示在同一位置。
8. 在完整标注视图里写的笔迹，回到覆盖层同样显示。

- [ ] **Step 6: 版本升到 1.2.0 并发布**

`package.json` 与 `manifest.json` 的 `version` 改为 `"1.2.0"`。构建后：

```bash
git add src/pdf/NativePdfOverlayManager.ts styles.css package.json manifest.json main.js
git commit -m "feat: in-place native PDF handwriting mode with toolbar (pen/highlighter/eraser/undo/redo/color/width/save/exit)"
git tag v1.2.0-beta
git push "https://x-access-token:<PUSH_TOKEN>@github.com/XiaoA-Tang/mobile-ink-annotation.git" main v1.2.0-beta
```

用 node 写 UTF8 body 后 POST release（tag `v1.2.0-beta`、prerelease、中文 body 说明功能与验证点），上传 main.js/manifest.json/styles.css 三个 assets。

- [ ] **Step 7: 用户回归 + 收尾**

用户安装 v1.2.0-beta 真机回归；如有问题按反馈迭代。确认稳定后，将 `src/pdf/nativePdfProbe.ts` 的自动探测与命令保留（低风险，便于日后诊断），无需删除。

---

## Self-Review

**Spec 覆盖对照：**
- 入口/出口（笔按钮、进入/退出、命令）→ Task 4、6。
- 几何对齐（页元素 rect + 自有 pdfjs 逻辑尺寸 + 坐标换算）→ Task 2、5。
- 墨迹层（复用 InkEngine、预算、无 desync 于 committed）→ Task 5（InkEngine 构造沿用 renderer 默认：committed 已由 v1.1.15 固定为 `desynchronized:false`，此处无需重复处理；backing 预算由 `resolveInkCanvasBudget` 传入）。
- 手势锁定（绘画模式锁定缩放/滚动）→ Task 5 Step 2。
- 工具集（含荧光笔）→ Task 6。
- 数据互通（同 Store/同坐标）→ Task 3、5。
- SPIKE 闸门 → Task 1。
- 降级路径（检测失败时提示用完整标注视图）→ 覆盖在 `setupDrawMode` 的 try/catch（Task 5），失败即 Notice 提示并退出。

**Type 一致性核查：**
- `LogicalPageLayout`/`LogicalPage`/`ScreenRect` 在 Task 2 定义，Task 3/5/6 一致引用。
- `convertStrokesToScreen/ToLogical` 签名 Task 3 定义，Task 5 调用一致。
- `NATIVE_PEN_BUTTON_CLS` 在 Task 4 定义并导出，Task 5 import 修正后由本文件提供。
- `assignStrokeToPage` Task 3 定义，Task 5 使用。
- `InkEngine` 构造参数与真实签名一致（`(liveCanvas, committedCanvas, scrollEl, options)`，`resize(w,h)`、`setDisplayScale(scale)`、`loadStrokes/strokes[]`、`getStrokes()`、`setToolState(patch)`、`undo/redo/destroy`）。
