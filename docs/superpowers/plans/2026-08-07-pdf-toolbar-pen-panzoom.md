# PDF 顶栏笔按钮 + 绘制模式双指平移/捏合缩放 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 PDF 绘制入口从右上角悬浮笔按钮移到 PDF 顶栏「⋮ 三个点」所在工具栏（⋮ 旁加图标钮），并让绘制模式下支持双指自由平移 + 捏合缩放（0.5x–8x），单指/触控笔仍作画、桌面滚轮平移。

**Architecture:** 顶栏按钮挂在 `leaf.view.containerEl` 的 `.pdf-toolbar` 里（类 `clickable-icon mobile-ink-pdf-toolbar-pen`，Obsidian 主题原生外观，零 CSS）。手势路由改为 **window 捕获级 touch 事件**（与 InkEngine 同在 window 捕获阶段；同节点同阶段按注册序触发，InkEngine 先注册先触发、我们的后触发）管理多指，overlay 上 `wheel` 管桌面平移：1 指交给 InkEngine 作画；2 指进入捏合（平移=中点位移→滚动容器；缩放=距离比→rAF 节流设 `viewer.currentScale`），**捏合期间对每个引擎 `setInputEnabled(false)`**（InkEngine 会 `finishInterruptedInput` 优雅收尾活动笔划、清空自身 pan 状态），松手后 `relayout()`：`replaceStrokes` 兜底结束任何活动笔划 → 各引擎 `replacePageStrokes` 固化逻辑笔迹 → 销毁引擎/画布 → 按当前 `.page` 矩形重建（undo 历史随之重置，为已知取舍）。

> **设计偏离说明（相对 spec）**：spec 提的是 captureLayer 上 pointer 事件跟踪。计划改用在 window 上捕获 touch 事件并禁用引擎输入，原因（已读源码核实）：
> 1. InkEngine 以 document capture 监听 pointer 事件（bindEvents InkEngine.ts:235-238），在活动笔划移动、触摸压笔、`beginPan` 等路径调用 `event.stopPropagation()`，overlay 上的冒泡 pointer 监听会漏事件；
> 2. 触摸指针（非笔、acceptTouchInput=false）落在画布内会触发 InkEngine 自身 `beginPan`（onPointerDown InkEngine.ts:291-294），与我们的平移叠加造成双倍位移；
> 3. InkEngine 无公开取消笔划 API，但 `setInputEnabled(false)` 内部调 `finishInterruptedInput`（提交活动笔划、重置全部指针状态），是干净的"进入捏合"方式。
> window touch 监听与 InkEngine 同在 window 捕获阶段（DOM 同节点同阶段按注册序触发，InkEngine 先注册→先触发、我们后注册→后触发）。**功能正确性不依赖监听顺序**：捏合期各引擎已 `setInputEnabled(false)`（InkEngine 全部处理因 `inputEnabled` 提前返回），且 InkEngine 自身 `onTouchStart` 的 `touches.length > 1` 分支会中断触摸笔划；`stopPropagation` 不会阻断同节点同阶段的后注册监听。**单指事件绝不 preventDefault/stopPropagation**（否则破坏 InkEngine 压笔拒绝与作画）。

**Tech Stack:** TypeScript / Obsidian plugin API（`WorkspaceLeaf.view`、`setIcon`）/ pdf.js 内嵌 viewer（`leaf.view.viewer`，降级回退 `.pdf-container`）/ InkEngine（**本功能不改动**，仅调用既有公开方法 `setInputEnabled`/`replaceStrokes`）。

## Global Constraints

- **禁止改动 `src/ink/InkEngine.ts`。** 只可调用其公开方法：`resize`、`setDisplayScale`、`destroy`、`loadStrokes`、`getStrokes`、`setToolState`、`undo`、`redo`、`setInputEnabled`、`replaceStrokes`。
- 缩放钳制**硬编码** `Math.min(8, Math.max(0.5, …))`，不读取 pdf.js 内部 `minScale`/`maxScale`。
- 缩放/平移后必须 `relayout()`（固化逻辑笔迹→重建引擎），**撤销历史重置是已知取舍**，接受。
- `viewer` 不可访问时降级为「仅平移」：回退容器 `.pdf-container` 存在就用它 `scrollBy`，并 `console.warn` 一次；都拿不到则手势为空操作，不抛错。
- `NATIVE_PEN_BUTTON_CLS` 常量**保留导出**，值改为 `"mobile-ink-pdf-toolbar-pen"`。
- 删除 styles.css 中全部 `.mobile-ink-native-pen-button` 规则（4 处）；`mobile-ink-floating-button` 相关只删 native 块里的引用，不动 `.mobile-ink-root` 作用域的原版规则与 `AnnotationView.ts` 的使用。
- 每步验证：`npm run build`（exit 0）→ `node --experimental-strip-types scripts/test-canvas-budget.mjs`（24 断言 OK）→ `node --experimental-strip-types scripts/test-native-pdf-geometry.mjs`（22 断言 OK）→ 静态 grep 检查 → 提交。
- 提交信息用中文、遵循仓库风格（`feat:`/`fix:` 前缀）。
- 终审修复（评审强制，已并入上述步骤）：`relayout()` 先对每引擎 `setInputEnabled(false)`（内部 `finishInterruptedInput`+`flushPendingCommits` 先提交活动笔划，避免滚轮路径丢笔划）；`endPinchRaf` 存储并在 `_gestureCleanup` 取消；工具栏触点一律不入 `pinchTouches`；`viewerWarned` 使降级 warn 每绘制会话仅一次。

---

### Task 1: 顶栏笔按钮（替换右上角悬浮按钮）

**Files:**
- Modify: `src/pdf/NativePdfOverlayManager.ts:10`（常量值）
- Modify: `src/pdf/NativePdfOverlayManager.ts:81-90`（`attachPenButton`，改为挂载进 `.pdf-toolbar`，并新增 `getPdfToolbar` 辅助方法）
- Modify: `styles.css:2472-2474`、`styles.css:2538-2543`、`styles.css:2558-2570`、`styles.css:2572-2580`（删除 native 笔按钮规则）

**Interfaces:**
- Consumes: `NATIVE_PEN_BUTTON_CLS`（已有导出，值改为新类名）；`setIcon`（obsidian 导入，已有）；`leaf.view.containerEl`。
- Produces: 无对外接口变化；`attachPenButton` 行为变化（按钮挂到顶栏、找不到工具栏则静默跳过）。

- [ ] **Step 1: 改常量值**

在 `src/pdf/NativePdfOverlayManager.ts:10`，把：

```ts
export const NATIVE_PEN_BUTTON_CLS = "mobile-ink-native-pen-button";
```

改为：

```ts
export const NATIVE_PEN_BUTTON_CLS = "mobile-ink-pdf-toolbar-pen";
```

- [ ] **Step 2: 重写 `attachPenButton` 并新增 `getPdfToolbar`**

在 `src/pdf/NativePdfOverlayManager.ts`，把第 81-90 行的 `attachPenButton` 整体替换为：

```ts
  private getPdfToolbar(containerEl: HTMLElement): HTMLElement | null {
    return containerEl.querySelector<HTMLElement>(".pdf-toolbar");
  }

  private attachPenButton(leaf: WorkspaceLeaf): void {
    const toolbar = this.getPdfToolbar(leaf.view.containerEl);
    if (!toolbar) return;
    const button = toolbar.createEl("button", {
      cls: `clickable-icon ${NATIVE_PEN_BUTTON_CLS}`,
      attr: { "aria-label": "就地手写批注" }
    });
    setIcon(button, "pencil");
    button.addEventListener("click", () => void this.enterDrawMode(leaf));
    this.penButton = button;
  }
```

注意：不再注入 `--mobile-ink-tool-color`（`clickable-icon` 走主题默认外观）；按钮类不再含 `mobile-ink-floating-button`。

- [ ] **Step 3: 删除 styles.css 中 4 处 native 笔按钮规则**

(a) 删除 2472-2474 行：

```css
.mobile-ink-native-pen-button:hover {
  filter: brightness(1.05);
}
```

(b) 在 2538-2543 行的 svg 字形列表里，删除 `.mobile-ink-floating-button` 与 `.mobile-ink-native-pen-button` 共 4 行选择器，使该块开头变为：

```css
.mobile-ink-native-overlay button.mobile-ink-icon-button svg,
.mobile-ink-native-overlay button.mobile-ink-icon-button .svg-icon {
```

(c) 删除 2558-2570 行整块（含注释）：

```css
/* 悬浮按钮/笔按钮：仅 pin 盒几何与圆角，外观继承原版 floating-button 本体（玻璃+笔色），并恢复笔色图标前景 */
.mobile-ink-native-overlay button.mobile-ink-floating-button,
button.mobile-ink-native-pen-button {
  appearance: none;
  -webkit-appearance: none;
  border-radius: 999px;
  box-sizing: border-box;
  min-width: 0;
  min-height: 0;
  border: 0;
  padding: 0;
  --mobile-ink-icon-foreground: var(--mobile-ink-tool-color, var(--interactive-accent));
}
```

(d) 删除 2572-2580 行整块（含注释）：

```css
/* 笔按钮定位：与 button.mobile-ink-floating-button 同特异性 (0,1,1) 且位于文件末尾，
   故 display/position/top/right/z-index 必须写在此处（基础规则 (0,1,0) 会被盖掉） */
button.mobile-ink-native-pen-button {
  position: fixed;
  display: inline-flex;
  top: max(14px, env(safe-area-inset-top));
  right: max(14px, env(safe-area-inset-right));
  z-index: 400;
}
```

- [ ] **Step 4: 构建**

Run: `npm run build`
Expected: 无 TypeScript 报错（exit 0），生成 `main.js`，末尾输出 esbuild bundle 摘要。

- [ ] **Step 5: 回归 + 静态检查**

Run:
```
node --experimental-strip-types scripts/test-canvas-budget.mjs
node --experimental-strip-types scripts/test-native-pdf-geometry.mjs
git grep -n "mobile-ink-native-pen-button" styles.css
git grep -n "NATIVE_PEN_BUTTON_CLS" src/pdf/NativePdfOverlayManager.ts
```
Expected:
- 两测试脚本均 `OK: all … assertions passed`（canvas-budget 24 断言、geometry 22 断言），退出码 0。
- 第一个 grep 无输出（styles.css 已无 pen-button 规则）。
- 第二个 grep 恰好两行：`:10`（定义）与 `:83` 附近（`attachPenButton` 中类名使用）。

- [ ] **Step 6: 提交**

```bash
git add src/pdf/NativePdfOverlayManager.ts styles.css
git commit -m "feat: move native PDF pen entry to top toolbar (.pdf-toolbar), drop floating button + its CSS"
```

---

### Task 2: 绘制模式双指平移 + 捏合缩放

**Files:**
- Modify: `src/pdf/NativePdfOverlayManager.ts`（字段声明区，`private colorDot` 之后）
- Modify: `src/pdf/NativePdfOverlayManager.ts:158-171`（setupDrawMode 手势块替换）
- Modify: `src/pdf/NativePdfOverlayManager.ts:325-330`（`replacePageStrokes` 后新增手势/重排方法）
- Modify: `src/pdf/NativePdfOverlayManager.ts:368-385`（teardown 清理）
- Modify: `styles.css`（文件末尾追加 panning 隐藏画布规则）

**Interfaces:**
- Consumes: `InkEngine`（既有公开方法：`getStrokes`/`replaceStrokes`/`setInputEnabled`/`destroy`/`resize`/`setDisplayScale`）；`replacePageStrokes`、`getVisiblePages`、`createPageEngine`（既有，Task 1 未动）。
- Produces: 私有方法 `resolveViewer(leaf, containerEl)`、`beginPinch()`、`handlePinchMove()`、`endPinch()`、`scheduleRelayout()`、`relayout()`；字段 `viewer`、`pinchTouches`、`pinchActive`、`pinchStartDist`、`pinchStartScale`、`pinchLastMid`、`zoomFrame`、`relayoutTimer`。

- [ ] **Step 1: 新增字段**

在 `src/pdf/NativePdfOverlayManager.ts`（`private colorDot: HTMLElement | null = null;` 之后、构造函数之前）追加：

```ts
  private viewer: { currentScale: number; container: HTMLElement } | null = null;
  private pinchTouches = new Map<number, { x: number; y: number }>();
  private pinchActive = false;
  private pinchStartDist = 1;
  private pinchStartScale = 1;
  private pinchLastMid = { x: 0, y: 0 };
  private zoomFrame: number | null = null;
  private relayoutTimer: number | null = null;
  private endPinchRaf: number | null = null;
  private viewerWarned = false;
```

- [ ] **Step 2: 新增 `resolveViewer`、`beginPinch`、`handlePinchMove`、`endPinch`、`scheduleRelayout`、`relayout`**

在 `src/pdf/NativePdfOverlayManager.ts`（`replacePageStrokes` 方法结束 `}` 之后、`markDirty` 之前）插入：

```ts
  private resolveViewer(leaf: WorkspaceLeaf, containerEl: HTMLElement): { currentScale: number; container: HTMLElement } | null {
    const v = (leaf.view as unknown as { viewer?: { currentScale?: number; container?: unknown } }).viewer;
    if (v && typeof v.currentScale === "number" && v.container instanceof HTMLElement) {
      return { currentScale: v.currentScale, container: v.container };
    }
    const fallback = containerEl.querySelector<HTMLElement>(".pdf-container");
    if (fallback) {
      if (!this.viewerWarned) {
        this.viewerWarned = true;
        console.warn("Mobile Ink Annotation: pdf.js viewer unavailable; pinch zoom disabled, two-finger pan only");
      }
      return { currentScale: 1, container: fallback };
    }
    return null;
  }

  private beginPinch(): void {
    if (this.pinchActive) return;
    const pts = Array.from(this.pinchTouches.values());
    if (pts.length < 2) return;
    this.pinchActive = true;
    for (const entry of this.engines) entry.engine.setInputEnabled(false);
    this.pinchStartDist = Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y));
    this.pinchStartScale = this.viewer?.currentScale ?? 1;
    this.pinchLastMid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    this.overlay?.classList.add("mobile-ink-native-panning");
  }

  private handlePinchMove(): void {
    const viewer = this.viewer;
    if (!viewer) return;
    const pts = Array.from(this.pinchTouches.values());
    if (pts.length < 2) return;
    const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    viewer.container.scrollBy(-(mid.x - this.pinchLastMid.x), -(mid.y - this.pinchLastMid.y));
    this.pinchLastMid = mid;
    const dist = Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y));
    const scale = Math.min(8, Math.max(0.5, this.pinchStartScale * (dist / this.pinchStartDist)));
    if (this.zoomFrame !== null) return;
    this.zoomFrame = window.requestAnimationFrame(() => {
      this.zoomFrame = null;
      if (!this.pinchActive || !viewer) return;
      if (Math.abs(viewer.currentScale - scale) > 0.001) {
        viewer.currentScale = scale;
      }
    });
  }

  private endPinch(): void {
    this.pinchActive = false;
    // 双 rAF：给 pdf.js 当前帧 + 下一帧完成缩放后的页面布局，再读最新 .page 矩形重建；
    // 期间保留 .panning 隐藏画布，重建完成后统一移除；rAF id 存入 endPinchRaf 供 cleanup 取消。
    this.endPinchRaf = window.requestAnimationFrame(() => {
      this.endPinchRaf = window.requestAnimationFrame(() => {
        this.endPinchRaf = null;
        try {
          this.relayout();
        } finally {
          this.overlay?.classList.remove("mobile-ink-native-panning");
        }
      });
    });
  }

  private scheduleRelayout(): void {
    if (this.relayoutTimer !== null) window.clearTimeout(this.relayoutTimer);
    this.relayoutTimer = window.setTimeout(() => {
      this.relayoutTimer = null;
      this.relayout();
    }, 120);
  }

  private relayout(): void {
    const leaf = this.drawModeLeaf;
    const containerEl = leaf?.view.containerEl;
    if (!leaf || !containerEl || !this.layout || !this.overlay) return;
    // setInputEnabled(false) 触发 InkEngine 内部 finishInterruptedInput + flushPendingCommits，
    // 先提交任何进行中的笔划到引擎已提交集合，再读 getStrokes——避免滚轮路径丢笔划
    // （评审修复：原 replaceStrokes(getStrokes(),false) 在提交前克隆旧集合导致活动笔划丢失）。
    // 重建出的新引擎默认 inputEnabled=true，无需重新启用。
    for (const entry of this.engines) entry.engine.setInputEnabled(false);
    for (const entry of this.engines) this.replacePageStrokes(entry.page.pageNumber);
    for (const entry of this.engines) {
      entry.engine.destroy();
      entry.live.remove();
      entry.committed.remove();
    }
    this.engines = [];
    const pages = this.getVisiblePages(containerEl);
    for (const { pageNumber, rect } of pages) {
      const page = this.layout.pages[pageNumber - 1];
      if (!page) continue;
      this.createPageEngine(containerEl, page, rect);
    }
  }
```

- [ ] **Step 3: 替换 setupDrawMode 中的手势块**

在 `src/pdf/NativePdfOverlayManager.ts`，把第 158-171 行（`const blockGesture = …` 至 `_gestureCleanup` 赋值结束的 `};`）整体替换为：

```ts
    this.viewer = this.resolveViewer(leaf, containerEl);
    const overlayEl = this.overlay!;
    const onTouchStart = (event: TouchEvent): void => {
      for (const t of Array.from(event.changedTouches)) {
        const onToolbar = t.target instanceof Element && t.target.closest(".mobile-ink-native-toolbar") !== null;
        if (!onToolbar) {
          this.pinchTouches.set(t.identifier, { x: t.clientX, y: t.clientY });
        }
      }
      if (this.pinchTouches.size >= 2) {
        event.preventDefault();
        event.stopPropagation();
        this.beginPinch();
      }
    };
    const onTouchMove = (event: TouchEvent): void => {
      if (!this.pinchActive) return;
      for (const t of Array.from(event.changedTouches)) {
        if (this.pinchTouches.has(t.identifier)) {
          this.pinchTouches.set(t.identifier, { x: t.clientX, y: t.clientY });
        }
      }
      event.preventDefault();
      event.stopPropagation();
      this.handlePinchMove();
    };
    const onTouchEnd = (event: TouchEvent): void => {
      for (const t of Array.from(event.changedTouches)) {
        this.pinchTouches.delete(t.identifier);
      }
      if (this.pinchActive && this.pinchTouches.size < 2) {
        event.preventDefault();
        event.stopPropagation();
        this.endPinch();
      }
    };
    const onWheel = (event: WheelEvent): void => {
      const viewer = this.viewer;
      if (!viewer) return;
      event.preventDefault();
      viewer.container.scrollBy(0, event.deltaY);
      this.scheduleRelayout();
    };
    window.addEventListener("touchstart", onTouchStart, { passive: false, capture: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false, capture: true });
    window.addEventListener("touchend", onTouchEnd, { passive: false, capture: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: false, capture: true });
    overlayEl.addEventListener("wheel", onWheel, { passive: false });
    this._gestureCleanup = () => {
      window.removeEventListener("touchstart", onTouchStart, true);
      window.removeEventListener("touchmove", onTouchMove, true);
      window.removeEventListener("touchend", onTouchEnd, true);
      window.removeEventListener("touchcancel", onTouchEnd, true);
      overlayEl.removeEventListener("wheel", onWheel);
      if (this.zoomFrame !== null) window.cancelAnimationFrame(this.zoomFrame);
      if (this.relayoutTimer !== null) window.clearTimeout(this.relayoutTimer);
      if (this.endPinchRaf !== null) window.cancelAnimationFrame(this.endPinchRaf);
      this.zoomFrame = null;
      this.relayoutTimer = null;
      this.endPinchRaf = null;
      this.pinchActive = false;
      this.pinchTouches.clear();
      this.viewer = null;
    };
```

- [ ] **Step 4: teardown 兜底清理**

在 `src/pdf/NativePdfOverlayManager.ts`（`this.colorDot = null;` 之后、方法结束 `}` 之前）追加两行：

```ts
    this.viewer = null;
    this.viewerWarned = false;
```

（`_gestureCleanup` 已清理手势态与定时器；此处兜底，防 teardown 被直接调用时手势态残留。）

- [ ] **Step 5: styles.css 追加 panning 规则**

在 `styles.css` 文件末尾追加：

```css
/* 缩放/平移进行中隐藏画布，避免旧矩形下笔迹错位闪烁（relayout 后恢复） */
.mobile-ink-native-overlay.mobile-ink-native-panning .mobile-ink-native-page-canvas {
  visibility: hidden;
}
```

- [ ] **Step 6: 构建**

Run: `npm run build`
Expected: 无 TypeScript 报错（exit 0），生成 `main.js`。

- [ ] **Step 7: 回归 + 静态检查**

Run:
```
node --experimental-strip-types scripts/test-canvas-budget.mjs
node --experimental-strip-types scripts/test-native-pdf-geometry.mjs
git grep -n "blockGesture" src/
git grep -n "mobile-ink-native-panning" styles.css
```
Expected:
- 两测试脚本均 `OK: all … assertions passed`，退出码 0。
- 第一个 grep 无输出（旧的 touchmove/wheel 拦截已删除）。
- 第二个 grep 至少一行（panning 隐藏画布规则存在）。

- [ ] **Step 8: 提交**

```bash
git add src/pdf/NativePdfOverlayManager.ts styles.css
git commit -m "feat: two-finger pan + pinch zoom in native PDF draw mode with per-view relayout"
```

---

## 设备真机验证清单（发布前由用户执行）

1. **顶栏笔按钮**：打开 PDF，右上角「⋮ 三个点」所在工具栏中出现铅笔图标按钮（`clickable-icon` 外观，Obsidian 主题原生样式），点击即进入绘制模式；退出绘制模式后按钮恢复。
2. **探针：工具栏/容器**：若按钮未出现，检查 PDF 视图工具栏类名是否为 `.pdf-toolbar`、按钮是否被渲染进该工具栏；若 `resolveViewer` 未命中 `leaf.view.viewer`，确认回退容器 `.pdf-container` 存在（控制台应有 warn）。
3. **单指作画**：进入绘制模式后，单指/触控笔仍可画线、换工具、保存、退出，与 1.2.1 行为一致。
4. **双指平移**：双指滑动页面随之滚动（内容跟随手指方向）；过程中画布隐藏（无错位闪烁），松手后笔迹与页面重新对齐。
5. **双指捏合缩放**：向内/向外缩放 0.5x–8x，松手后笔迹与缩放后的页面重新对齐；继续作画笔迹位置正确。
6. **缩放后保存/重载**：保存并重开，笔迹仍与页面对齐（逻辑坐标不随缩放漂移）。
7. **已知取舍确认**：缩放/平移后撤销栈被重置（无法撤销到缩放前的笔迹状态）——符合预期。
8. **桌面滚轮**（如可测）：绘制模式下滚轮平移页面，松手后笔迹与页面重新对齐。
9. **绘制中退出**：退出绘制模式恢复原工具栏（笔按钮再次出现在顶栏），无残留覆盖层。

## 验证命令速查

- 构建：`npm run build`
- 回归：`node --experimental-strip-types scripts/test-canvas-budget.mjs`
- 回归：`node --experimental-strip-types scripts/test-native-pdf-geometry.mjs`
