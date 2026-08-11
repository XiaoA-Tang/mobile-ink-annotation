# md 工具条浮现 + 全篇书写 + PDF 缩放平移锁 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 md 铅笔按钮浮现/收起底部悬浮工具条并以 annotating 状态机工作；将 md 画布改为铺满预览内容随滚动自然跟随，修复"滚动后下半屏不可写"；为 PDF 加缩放/平移手势锁（工具条 lock 按钮 toggle）。

**Architecture:** 三处改动相互独立：`OverlayToolbar` 增加附加按钮注册位（shared 层不耦合 PDF 特性）；`MarkdownOverlayAdapter` 重构为 annotating 状态机 + 画布 `position:absolute` 铺满 `.markdown-preview-view`（scrollWidth×scrollHeight），笔迹直接以内容/逻辑坐标存取；新增 `PdfGestureLock` 控制器处理双指/单指横向/Ctrl+滚轮/deltaX 拦截，`PdfOverlayAdapter` 注入 lock 按钮与手势锁。

**Tech Stack:** TypeScript + Obsidian API + InkEngine / OverlayToolkit（既有共享层）；`scripts/test-*.mjs` 为纯函数回归脚本（Node 24 type-stripping 直接 import `.ts`）。

## Global Constraints

- `npm run build`（tsc -noEmit -skipLibCheck && esbuild production）必须 exit 0。
- 回归脚本必须全绿：`node scripts/test-canvas-budget.mjs`、`node scripts/test-native-pdf-geometry.mjs`、`node scripts/test-markdown-overlay-geometry.mjs`、`node scripts/test-smoothing.mjs`。
- 遵循仓库惯例：feature 提交与 `main.js` 构建提交分离；发布提交 `release: bump version`。
- 笔迹数据模型（`AnnotationFile` pageWidth/pageHeight/strokes）不变；`markdownGeometry` 已导出纯函数(`mdLoadScale`/`reprojectStrokesToWidth`/`convertStrokesFromAnnotation`/`toViewport*`/`fromViewport*`)保持导出，回归脚本不得改动其断言。
- 手势锁只拦非书写手势；书写单指笔事件由 canvas 层处理，互不干扰。
- 锁状态不跨覆盖层生命周期记忆：重新打开 PDF 恢复解锁。

---
### Task 1: OverlayToolbar 附加按钮注册位

**Files:**
- Modify: `src/overlay/shared/OverlayToolbar.ts`
- Test: `scripts/test-smoothing.mjs`（不改，仅回归）

**Interfaces:**
- Consumes: 现有 `ToolbarHost`（`types.ts`）。
- Produces: `OverlayToolbar.registerExtraButton(spec: { icon: string; label: string; isActive(): boolean; onClick(): void }): void`。错误场景：`build()` 未调用时调用 register 需安全（记录待办，build 时补建）。

- [ ] **Step 1: 在 OverlayToolbar 增加字段与注册方法**

在 `OverlayToolbar` 类内、`teardown()` 之前加入:

```ts
  private extraButtons: Array<{ spec: { icon: string; label: string; isActive(): boolean; onClick(): void }; el: HTMLElement | null }> = [];
  private extraGroup: HTMLElement | null = null;

  registerExtraButton(spec: { icon: string; label: string; isActive(): boolean; onClick(): void }): void {
    this.extraButtons.push({ spec, el: null });
    if (this.toolbarEl) this.mountExtraButton(this.extraButtons[this.extraButtons.length - 1]);
    this.refresh();
  }
```

在类内 `build()` 方法末尾（`this.refresh();` 之前）追加挂载逻辑；新增私有方法:

```ts
  private mountExtraButton(entry: { spec: { icon: string; label: string; isActive(): boolean; onClick(): void }; el: HTMLElement | null }): void {
    if (!this.toolbarEl) return;
    if (!this.extraGroup) {
      this.extraGroup = this.toolbarEl.querySelector<HTMLElement>(".mobile-ink-toolbar-dock")?.createDiv({ cls: "mobile-ink-toolbar-group" }) ?? null;
    }
    if (!this.extraGroup) return;
    const btn = this.extraGroup.createEl("button", {
      cls: "mobile-ink-icon-button",
      attr: { "aria-label": entry.spec.label }
    });
    setIcon(btn, entry.spec.icon);
    btn.addEventListener("click", () => {
      entry.spec.onClick();
      this.refresh();
    });
    entry.el = btn;
  }
```

修改 `refresh()`，在现有高亮循环之后追加:

```ts
    for (const entry of this.extraButtons) {
      if (entry.el) entry.el.classList.toggle("mobile-ink-active", entry.spec.isActive());
    }
```

修改 `teardown()`，置空新增字段:

```ts
    this.extraButtons = [];
    this.extraGroup = null;
```

- [ ] **Step 2: 构建验证**

Run: `npm run build`
Expected: exit 0（tsc 无类型错误、esbuild 出包）

- [ ] **Step 3: 回归**

Run: `node scripts/test-smoothing.mjs`
Expected: `OK: all smoothing assertions passed`

- [ ] **Step 4: Commit**

```bash
git add src/overlay/shared/OverlayToolbar.ts
git commit -m "feat: add extra-button registration slot to shared overlay toolbar"
```

---
### Task 2: PdfGestureLock 手势锁控制器 + 方向判定纯函数

**Files:**
- Create: `src/overlay/pdf/gestureAxis.ts`
- Create: `src/overlay/pdf/PdfGestureLock.ts`
- Test: `scripts/test-gesture-axis.mjs`

**Interfaces:**
- Consumes: 无（纯 DOM，不 import obsidian，便于 node 测试）。
- Produces:
  - `export function dominantAxis(dx: number, dy: number, threshold: number): "horizontal" | "vertical" | "none"`（`gestureAxis.ts`）
  - `export class PdfGestureLock { constructor(scrollEl: HTMLElement); setLocked(locked: boolean): void; destroy(): void }`（`PdfGestureLock.ts`）

- [ ] **Step 1: 写失败测试**

Create `scripts/test-gesture-axis.mjs`:

```js
import { dominantAxis } from "../src/overlay/pdf/gestureAxis.ts";

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

assert("horizontal dominant", dominantAxis(30, 4, 8), "horizontal");
assert("vertical dominant", dominantAxis(3, 40, 8), "vertical");
assert("below threshold none", dominantAxis(3, 4, 8), "none");
assert("equal treated vertical", dominantAxis(5, 5, 4), "vertical");
assert("zero zero none", dominantAxis(0, 0, 1), "none");

if (failed > 0) {
  console.error(`FAILED: ${failed} assertion(s)`);
  process.exit(1);
}
console.log("OK: all gesture-axis assertions passed");
```

- [ ] **Step 2: 运行确认失败**

Run: `node scripts/test-gesture-axis.mjs`
Expected: FAIL（Cannot find module `../src/overlay/pdf/gestureAxis.ts`）

- [ ] **Step 3: 实现 gestureAxis.ts**

Create `src/overlay/pdf/gestureAxis.ts`:

```ts
export type GestureAxis = "horizontal" | "vertical" | "none";

export function dominantAxis(dx: number, dy: number, threshold: number): GestureAxis {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax <= threshold && ay <= threshold) return "none";
  if (ax > ay) return "horizontal";
  return "vertical";
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node scripts/test-gesture-axis.mjs`
Expected: `OK: all gesture-axis assertions passed`

- [ ] **Step 5: 实现 PdfGestureLock.ts**

Create `src/overlay/pdf/PdfGestureLock.ts`:

```ts
import { dominantAxis } from "./gestureAxis";

export class PdfGestureLock {
  private locked = false;
  private singleTouchStart: { x: number; y: number } | null = null;
  private readonly scrollEl: HTMLElement;

  constructor(scrollEl: HTMLElement) {
    this.scrollEl = scrollEl;
  }

  setLocked(locked: boolean): void {
    if (this.locked === locked) return;
    this.locked = locked;
    if (locked) this.attach();
    else this.detach();
  }

  destroy(): void {
    this.locked = false;
    this.detach();
  }

  private attach(): void {
    this.scrollEl.addEventListener("wheel", this.onWheel, { passive: false });
    this.scrollEl.addEventListener("touchstart", this.onTouchStart, { passive: false });
    this.scrollEl.addEventListener("touchmove", this.onTouchMove, { passive: false, capture: true });
  }

  private detach(): void {
    this.scrollEl.removeEventListener("wheel", this.onWheel);
    this.scrollEl.removeEventListener("touchstart", this.onTouchStart);
    this.scrollEl.removeEventListener("touchmove", this.onTouchMove, { capture: true });
    this.singleTouchStart = null;
  }

  private onWheel = (event: WheelEvent): void => {
    if (!this.locked) return;
    if (event.ctrlKey) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.deltaX !== 0 && Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  private onTouchStart = (event: TouchEvent): void => {
    if (!this.locked) return;
    if (event.touches.length >= 2) {
      event.preventDefault();
      event.stopPropagation();
      this.singleTouchStart = null;
      return;
    }
    const t = event.touches.item(0);
    this.singleTouchStart = t ? { x: t.clientX, y: t.clientY } : null;
  };

  private onTouchMove = (event: TouchEvent): void => {
    if (!this.locked) return;
    if (event.touches.length >= 2) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const t = event.touches.item(0);
    if (!t || !this.singleTouchStart) {
      this.singleTouchStart = t ? { x: t.clientX, y: t.clientY } : null;
      return;
    }
    const dx = t.clientX - this.singleTouchStart.x;
    const dy = t.clientY - this.singleTouchStart.y;
    this.singleTouchStart = { x: t.clientX, y: t.clientY };
    if (dominantAxis(dx, dy, 8) === "horizontal") {
      event.preventDefault();
      event.stopPropagation();
    }
  };
}
```

- [ ] **Step 6: 构建 + 回归**

Run: `npm run build` → exit 0；`node scripts/test-gesture-axis.mjs` → OK

- [ ] **Step 7: Commit**

```bash
git add src/overlay/pdf/gestureAxis.ts src/overlay/pdf/PdfGestureLock.ts scripts/test-gesture-axis.mjs
git commit -m "feat: add pdf pan/zoom gesture lock controller with axis helper"
```

---
### Task 3: md 交互重构为 annotating 状态机

**Files:**
- Modify: `src/overlay/markdown/MarkdownOverlayAdapter.ts`（`toggle`/`activate`/`setAnnotating`/铅笔按钮 click）

**Interfaces:**
- Consumes: Task 1 无；现有 InkEngine/OverlayToolbar/OverlayToolkit。
- Produces: 铅笔按钮行为：首点 activate，再次点 `setAnnotating(!this.annotating)`；按钮 `is-active` 反映 annotating。

- [ ] **Step 1: 重写 toggle 与铅笔按钮联动**

`toggle(leaf)` 当前（约 170-177 行）改为:

```ts
  private toggle(leaf: WorkspaceLeaf): void {
    if (this.isActive && this.activeLeaf === leaf) {
      this.setAnnotating(!this.annotating);
      return;
    }
    void this.activate(leaf);
  }
```

铅笔按钮 click（当前 `button.addEventListener("click", () => void this.toggle(leaf));`）改为不 `void`（toggle 非 async）:

```ts
    button.addEventListener("click", () => this.toggle(leaf));
```

- [ ] **Step 2: activate 末尾进入书写态**

`activate()` 末尾目前 `this.setAnnotating(false);` 改为 `this.setAnnotating(true);`。同时移除 `this.toolbar.setCollapsed(true);`（约 221 行），由 `setAnnotating(true)` 展开。

- [ ] **Step 3: setAnnotating 同步按钮高亮**

`setAnnotating` 现实现（约 325-336 行）改为:

```ts
  private setAnnotating(value: boolean): void {
    this.annotating = value;
    for (const c of [this.liveCanvas, this.committedCanvas]) {
      if (c) c.style.pointerEvents = value ? "auto" : "none";
    }
    this.overlay?.classList.toggle(MARKDOWN_ANNOTATING_CLS, value);
    this.toolbar?.setCollapsed(!value);
    if (this.penButton) this.penButton.classList.toggle("is-active", value);
    if (value && this.engine) this.engine.setInputEnabled(true);
  }
```

- [ ] **Step 4: 构建验证**

Run: `npm run build`
Expected: exit 0

- [ ] **Step 5: Commit**

```bash
git add src/overlay/markdown/MarkdownOverlayAdapter.ts
git commit -m "feat: make md pen button toggle annotating state with floating toolbar"
```

---
### Task 4: md 画布铺满内容随滚动跟随（修复下半屏不可写）

**Files:**
- Modify: `src/overlay/markdown/MarkdownOverlayAdapter.ts`（canvas 创建/`measure`/`armCanvasPosition`/`refreshStrokesForViewport`/`onScroll`/`saveAnnotation`/`handleResize`）

**Interfaces:**
- Consumes: Task 3 修改后的 adapter；既有 `markdownGeometry`。
- Produces: canvas `position:absolute` 铺在 `.markdown-preview-view` 内覆盖 `scrollWidth×scrollHeight`；笔迹以内容/逻辑坐标存取（engine 坐标 == 内容坐标，scale 恒 1）；滚动不触发重绘。

- [ ] **Step 1: canvas 改为预览子级 absolute**

`activate()` 中 canvas 创建（约 223-231 行）改为（将 canvas append 到 preview 而非 overlay; 需要 preview `position:relative`）:

```ts
    if (getComputedStyle(preview).position === "static") preview.style.position = "relative";
    this.liveCanvas = document.createElement("canvas");
    this.committedCanvas = document.createElement("canvas");
    for (const c of [this.liveCanvas, this.committedCanvas]) {
      c.className = "mobile-ink-native-page-canvas";
      c.style.position = "absolute";
      c.style.top = "0";
      c.style.left = "0";
      c.style.touchAction = "none";
      c.style.zIndex = "3";
      preview.append(c);
    }
```

- [ ] **Step 2: 重写 measure（scrollWidth/scrollHeight）**

`measure()`（约 278-290 行）改为（删除 canvas.style.left/top 赋值，删 `armCanvasPosition` 调用）:

```ts
  private measure(): void {
    if (!this.preview) return;
    const w = Math.max(1, Math.round(this.preview.scrollWidth));
    const h = Math.max(1, Math.round(this.preview.scrollHeight));
    for (const c of [this.liveCanvas, this.committedCanvas]) {
      if (!c) continue;
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
    }
    this.engine?.resize(w, h);
    this.engine?.setDisplayScale(1);
  }
```

删除 `armCanvasPosition()` 方法（scroll 偏移方案不再需要）。

- [ ] **Step 3: 笔迹直接以内容坐标存取**

`refreshStrokesForViewport()`（约 292-298 行）改为直接加载内容坐标（不再 scroll 偏移）:

```ts
  private refreshStrokesForViewport(): void {
    if (!this.engine) return;
    this.engine.loadStrokes(this.strokes);
  }
```

`saveAnnotation()` 中取消 scroll 偏移（约 347-363 行）。`fromViewportStrokeWithScroll`/`toViewportStrokeWithScroll` 不再使用。改为:

```ts
  private async saveAnnotation(): Promise<void> {
    const file = this.drawFile;
    if (!(file instanceof TFile) || !this.engine || !this.preview) return;
    this.engine.flushPendingStrokes();
    const engineStrokes = this.engine.getStrokes();
    const logical = this.strokes.map((s) => s);
    const written = new Set<string>();
    for (const s of engineStrokes) {
      const idx = logical.findIndex((st) => st.id === s.id);
      if (idx >= 0) {
        logical[idx] = s;
        written.add(s.id);
      } else {
        logical.push(s);
        written.add(s.id);
      }
    }
    this.strokes = logical.filter((s) => written.has(s.id));
    const annotation = await this.store.load(file.path, this.pageWidth, this.pageHeight);
    annotation.pageWidth = this.pageWidth;
    annotation.pageHeight = this.pageHeight;
    annotation.strokes = this.strokes.filter((s) => s.points.length > 0);
    await this.store.save(annotation);
  }
```

注意：书写时 engine 坐标 = canvas-local = 内容坐标（scaleX=scaleY=1，因 canvas CSS 尺寸==engine resize 尺寸===scrollWidth/scrollHeight，`getCanvasPointMapping` 中 `rect.width===this.width`）。故保存无需换算。

- [ ] **Step 4: 移除滚动重绘跟随**

`onScroll` 与 `activate` 中滚动监听（约 251、257-265 行）：删除 `onScroll` 方法、`preview.addEventListener("scroll", ...)`、`refreshStrokesForViewport()` 的 rAF（约 253 行 `this.followFrame = window.requestAnimationFrame(...)` 与 `onScroll` 内 rAF）。`teardown` 中 `this.preview?.removeEventListener("scroll", this.onScroll)` 一并删除。`followFrame` 字段保留（teardown 取消帧仍需要）。

保留 `ResizeObserver` 重测（宽/图片变化仍触发 `scheduleMeasure`）。

`handleResize()` 中宽重投影逻辑不变；高度只更新 pageHeight。

- [ ] **Step 5: 回归 + 构建**

Run: `npm run build`（exit 0）; `node scripts/test-markdown-overlay-geometry.mjs`（OK，未改 markdownGeometry）; `node scripts/test-canvas-budget.mjs`; `node scripts/test-smoothing.mjs`

- [ ] **Step 6: Commit**

```bash
git add src/overlay/markdown/MarkdownOverlayAdapter.ts
git commit -m "fix: size md ink canvas to full content so all of the page is writable while scrolling"
```

---
### Task 5: PDF 适配器接入手势锁与 lock 按钮

**Files:**
- Modify: `src/overlay/pdf/PdfOverlayAdapter.ts`
- Modify: `styles.css`（px 选择器不需要新 CSS；如缩放按钮需禁用可加一条）

**Interfaces:**
- Consumes: Task 1 `registerExtraButton`；Task 2 `PdfGestureLock`。
- Produces: `panZoomLocked` 状态字段；lock 按钮 toggle；`teardownOverlay`/`onunload` 时 `gestureLock?.destroy()`。

- [ ] **Step 1: 字段与 onload 清理**

`PdfOverlayAdapter` 字段区新增:

```ts
  private panZoomLocked = false;
  private gestureLock: PdfGestureLock | null = null;
```

顶部 import 区新增（与现有 `import { ... } from "obsidian";` 并列）:

```ts
import { PdfGestureLock } from "./PdfGestureLock";
```

`onunload()` 中 `this.clearPenButtonRetry();` 之后新增一行:

```ts
    this.gestureLock?.destroy();
    this.gestureLock = null;
```

- [ ] **Step 2: activateOverlay 创建手势锁与 lock 按钮**

`activateOverlay()` 中 `this.toolbar.build(this.overlay);`（约 206 行）之后新增:

```ts
      const scrollEl = containerEl.querySelector<HTMLElement>(".pdf-container") ?? containerEl;
      this.gestureLock = new PdfGestureLock(scrollEl);
      this.toolbar.registerExtraButton({
        icon: "lock",
        label: "锁定缩放/平移（仅上下滚动）",
        isActive: () => this.panZoomLocked,
        onClick: () => {
          this.panZoomLocked = !this.panZoomLocked;
          this.gestureLock?.setLocked(this.panZoomLocked);
        }
      });
```

- [ ] **Step 3: 锁定期间禁用顶部缩放按钮**

`activateOverlay()` 中注册 lock 按钮之后，新增对 Obsidian `pdf-toolbar` 内缩放按钮的点击拦截（随 lock toggle 挂载/卸载）:

```ts
      const blockZoomButtons = (block: boolean): void => {
        const toolbar = containerEl.querySelector<HTMLElement>(".pdf-toolbar");
        if (!toolbar) return;
        toolbar.querySelectorAll<HTMLElement>("button").forEach((btn) => {
          const label = (btn.getAttribute("aria-label") ?? btn.title ?? "").toLowerCase();
          const isZoom = label.includes("zoom") || label.includes("缩放") || label.includes("放大") || label.includes("缩小");
          btn.style.pointerEvents = block && isZoom ? "none" : "";
        });
      };
      this.blockZoomButtons = blockZoomButtons;
      this.blockZoomButtons(this.panZoomLocked);
```

`onClick` 中 `this.gestureLock?.setLocked(...)` 之后补调 `this.blockZoomButtons?.(this.panZoomLocked)`。

字段区追加:

```ts
  private blockZoomButtons: ((block: boolean) => void) | null = null;
```

- [ ] **Step 4: teardownOverlay 释放**

`teardownOverlay(containerEl?)` 开头新增:

```ts
    this.gestureLock?.destroy();
    this.gestureLock = null;
    this.panZoomLocked = false;
    this.blockZoomButtons?.(false);
    this.blockZoomButtons = null;
```

- [ ] **Step 5: 构建验证**

Run: `npm run build`
Expected: exit 0

- [ ] **Step 6: Commit**

```bash
git add src/overlay/pdf/PdfOverlayAdapter.ts
git commit -m "feat: wire pdf pan/zoom lock button and gesture lock into overlay"
```

---
### Task 6: 全量回归 + main.js 构建提交

**Files:**
- 无新增；构建产物 `main.js`

- [ ] **Step 1: 全量回归**

Run:
```
node scripts/test-canvas-budget.mjs
node scripts/test-native-pdf-geometry.mjs
node scripts/test-markdown-overlay-geometry.mjs
node scripts/test-smoothing.mjs
node scripts/test-gesture-axis.mjs
```
Expected: 全部 `OK: all ... assertions passed`

- [ ] **Step 2: 构建**

Run: `npm run build`
Expected: exit 0

- [ ] **Step 3: 提交 main.js**

```bash
git add main.js
git commit -m "构建: 提交 md 工具条/全篇书写/PDF 缩放锁后的 main.js（仓库惯例）"
```

---
## 真机验证清单（非脚本，供执行者参考）

1. md 笔记 → 点铅笔按钮 → 底部悬浮工具条浮现、可书写；再点 → 工具条收起、笔迹常显、可滚动可选中。
2. 长笔记滚动到任意位置 → 整屏可书写，笔迹随内容滚动跟随。
3. md 书写时单指不触发页面滚动/选中；展示态恢复。
4. PDF 打开 → 工具条出现锁按钮；锁定后双指捏合/双指平移/单指横向/Ctrl+滚轮/滚轮横向均被禁，上下滚动正常；再点解锁后恢复正常。
5. PDF 关闭后重开 → 恢复解锁。
6. md/PDF 笔迹保存与切走切回归正常。
7. 顶部缩放按钮（Obsidian `pdf-toolbar` 内）锁定期间被禁用（`pointer-events:none`），解锁后恢复。