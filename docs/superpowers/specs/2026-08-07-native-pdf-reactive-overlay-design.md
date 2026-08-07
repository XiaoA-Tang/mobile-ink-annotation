# Spec: 原生 PDF 覆盖层重构——响应式跟随 + 笔手分离 + 永远就绪

日期：2026-08-07
目标版本：v1.2.3-beta
状态：已获用户设计认可

## 1. 背景与问题

当前原生 PDF 覆盖层（`NativePdfOverlayManager`，v1.2.2-beta）在真机（安卓平板/手机）上存在以下问题：

1. **平移/缩放失效**：窗口捕获级 touch 手势对双指触摸 `preventDefault`，尝试用 pdf.js 内部对象（`leaf.view.viewer.currentScale` / `container.scrollBy`）复刻原生缩放/滚动，但安卓移动端这些内部结构解析失败 → 页面不跟随、笔迹还被 `.panning` 规则隐藏，松手才恢复。
2. **手指触控被全屏拦截**：`.mobile-ink-native-capture` 为全屏 `position:absolute; inset:0; touch-action:none` 透明层，且覆盖层 `pointer-events` 默认 auto → 手指滚动/捏合无法到达下方原生 PDF 视图。
3. **笔迹非默认可见**：笔迹只在点击顶栏笔按钮进入绘制模式后显示，打开 PDF 不显示。
4. **模式切换摩擦**：用户希望「打开 PDF 即可写」的手写为核心体验，无需点按钮。
5. **SPIKE 调试残留**：`main.ts` 在 PDF 激活时自动跑结构探测并弹 Notice（「探测完成: 页候选数…数据已写入…」）。

用户已确认的事实：

- 设备为安卓平板/手机，**原生 PDF 视图本身支持滚动与双指捏合缩放**。
- 用户有**主动式触控笔**（系统可区分笔/手指）。
- 期望交互：**笔手分离、永远就绪**——打开 PDF 即显示笔迹并可书写；触控笔=作画，手指=滚动/缩放；工具条常显、顶栏笔按钮作显隐开关。
- 不需要 PDF 文字编辑/框选功能，以手写为核心。

## 2. 目标

在保留 Obsidian 原生 PDF 视图的基础上：

1. 打开 PDF 即显示已保存手写笔迹，且可直接用触控笔书写（无需进入/退出模式）。
2. 手指触控恢复原生滚动与捏合缩放；缩放/滚动期间笔迹始终贴合页面、不消失；缩放稳定后笔迹变清晰。
3. 顶栏笔按钮变为「显隐底部工具条」开关；底部工具条常显。
4. 移除 SPIKE 自动探测弹窗（保留手动命令）。
5. 禁用原生 PDF 文本选择（用户不需要文字框选）。
6. 保持自动保存（防抖 800ms）。

## 3. 非目标

- 不修复/保留 v1.2.2 的手势劫持路径（删除之）。
- 不改动 `src/ink/InkEngine.ts`（只使用其公开 API）。
- 不做 PDF 文字编辑/框选/摘录功能。
- 不引入模式切换（浏览/绘制）概念。

## 4. 架构

单一状态：PDF 叶签激活 → 覆盖层挂载（永远就绪）；叶签切换 → 卸载。原生视图全权负责滚动/缩放；覆盖层只做两件事：**跟随页面矩形**、**接收笔事件作画**。

```
+----------------------------------------------------------+
| Obsidian 原生 PDF 视图（pdf.js）——滚动/缩放/翻页 由它负责   |
|   .page 元素（getBoundingClientRect 视口坐标）             |
+----------------------------------------------------------+
| .mobile-ink-native-overlay（fixed inset:0, pointer-events:none）
|   ├── per-page canvases（pointer-events:none）跟随页矩形    |
|   └── .mobile-ink-native-toolbar（pointer-events:auto）    |
+----------------------------------------------------------+
   笔事件：InkEngine 的 window/document 捕获级监听 + 画布矩形命中测试 → 作画
   手指触控：直通原生 PDF 视图（覆盖层 pointer-events:none 放行）
```

关键不变量：

- 覆盖层与画布 `pointer-events: none`（手指触控不被拦截）。
- 画布矩形每帧对齐页面矩形（滚动/缩放期间笔迹贴页）。
- 页面尺寸稳定 ~200ms 后重建引擎，渲染清晰笔迹。
- 笔作画完全依赖 InkEngine 现有捕获级监听与命中测试，不依赖覆盖层拦截。

## 5. 组件变更

### 5.1 `src/pdf/NativePdfOverlayManager.ts`（主要改动）

**删除**：

- window `touchstart/touchmove/touchend/touchcancel` 捕获级监听（`onTouchStart/onTouchMove/onTouchEnd`）。
- pinch 状态机字段：`pinchTouches`、`pinchActive`、`pinchStartDist`、`pinchStartScale`、`pinchLastMid`、`zoomFrame`、`endPinchRaf`。
- `beginPinch`、`handlePinchMove`、`endPinch`、`scheduleRelayout`、`resolveViewer`、`viewer`、`viewerWarned` 字段。
- 覆盖层上的 `wheel` 劫持监听。
- `.panning` 类的使用（`overlay.classList.add/remove("mobile-ink-native-panning")`）。
- `.mobile-ink-native-capture` 层创建（`captureLayer` 字段）。

**新增/调整**：

- 常量：`NATIVE_ANNOTATING_CLS = "mobile-ink-native-annotating"`（加到 PDF 叶签容器，供 CSS 禁用文本选择）、`SETTLE_MS = 200`。
- 字段：`followFrame: number | null`（rAF id）、`settleTimer: number | null`、`lastRectCache: Map<HTMLElement, { left: number; top: number; width: number; height: number }>`、`sizeChangedAt: number | null`、`overlayActive: boolean`。
- `update()` 语义改为：PDF 激活且覆盖层未挂载 → `activateOverlay(leaf)`；叶签变化/非 PDF → `deactivateOverlay()`。
- `activateOverlay(leaf)`（原 `enterDrawMode`+`setupDrawMode` 改造）：
  - 记录 activeLeaf、移除顶栏按钮的「进入绘制」点击行为（改为切换工具条显隐）。
  - 读 PDF → `loadPdfJs` → 布局（沿用 `computePageSizeFromPdf` / annotation 的 pageWidth/pageHeight）→ `splitStrokesByPage`。
  - 创建覆盖层（不建 capture 层）；创建底部工具条；给 PDF 叶签容器加 `NATIVE_ANNOTATING_CLS`。
  - 对可见页创建引擎（沿用 `createPageEngine`）。
  - 启动 `followFrame` rAF 循环。
- `followFrame()` rAF 循环（核心）：
  1. 查询可见 `.page` 元素（沿用 `.page` 类 + 视口相交过滤）。
  2. reconcile：新页 → `createPageEngine`；引擎页不再可见 → 先 `replacePageStrokes(pageNumber)` 提交该页笔划再 `engine.destroy()` + 移除画布（防止丢笔迹）。
  3. 对每个引擎：`rect = page.getBoundingClientRect()`；与缓存不同 → 更新画布 `left/top/width/height` 样式并写缓存；若尺寸（width/height）相对缓存变化 → 记 `sizeChangedAt = performance.now()`。若页面元素在 pdf.js 缩放/渲染期间被临时隐藏（如 `el.style.visibility === "hidden"` 或 `el.offsetParent === null`）→ 画布同步隐藏，页面恢复可见时同步恢复。
  4. 若 `sizeChangedAt !== null && performance.now() - sizeChangedAt > SETTLE_MS` → `relayout()` 重建全部引擎（逻辑笔迹→当前矩形），清 `sizeChangedAt`。
  5. 未卸载则继续调度下一帧。
- `relayout()`：沿用现有实现（先 `setInputEnabled(false)` 提交活动笔划、逐页 `replacePageStrokes`、destroy、按可见页重建）。不再隐藏画布。
- 统一提笔划辅助：`flushPageStrokes(entry)`（`replacePageStrokes` 封装），reconcile 销毁路径与 `relayout` 共用，避免漏提交。
- 顶栏笔按钮：`attachPenButton` 的 click 改为 `() => this.toggleToolbar()`。
- `toggleToolbar()`：切换 `.mobile-ink-native-toolbar` 的显隐（CSS `is-collapsed` 类或 `display`）。
- 底部工具条：移除「退出」按钮；保留画笔/高亮/橡皮/颜色/粗细/撤销/重做/保存。
- 保存流程不变：`markDirty` → `flushSave`（`replacePageStrokes` 汇总 → `store.save`）。
- `teardownDrawMode` → `deactivateOverlay()`：停 `followFrame`（cancelAnimationFrame）、清 `settleTimer`、毁引擎、flushSave、移除覆盖层/工具条、移除 `NATIVE_ANNOTATING_CLS`、清字段。

**InkEngine 用法**（只调用公开方法）：`setToolState`、`getStrokes`、`loadStrokes`、`undo`、`redo`、`resize`、`setDisplayScale`、`setInputEnabled`、`destroy`。不改 `InkEngine.ts`。

### 5.2 `styles.css`

- `.mobile-ink-native-overlay`：新增 `pointer-events: none`。
- 删除 `.mobile-ink-native-capture` 规则（`2479-2484`）。
- `.mobile-ink-native-page-canvas`：`pointer-events: auto` → `none`。
- 删除 `.mobile-ink-native-overlay.mobile-ink-native-panning .mobile-ink-native-page-canvas { visibility: hidden }`（`2551`）。
- 新增：
  - `.mobile-ink-native-annotating .textLayer { user-select: none; -webkit-user-select: none; }`
  - `.mobile-ink-native-toolbar.is-collapsed { display: none; }`
- 工具条保持 `pointer-events: auto`、`z-index` 高于页面。

### 5.3 `src/main.ts`

- 删除 `active-leaf-change` 里自动探测块（`nativePdfProbeDone` 逻辑 + 自动 `new Notice(...)` + 自动写 `native-pdf-probe.json`）。
- 保留手动命令 `probe-native-pdf-structure`（用户主动触发，仍可弹结果 Notice）。

## 6. 数据流

1. PDF 叶签激活 → `activateOverlay`：读二进制 → `loadPdfJs` → 布局 → 按页拆笔迹 → 建覆盖层/工具条 → 建可见页引擎 → 起 rAF。
2. rAF 每帧：查询可见页 → reconcile 引擎 → 对齐画布矩形 → 尺寸稳定后重建。
3. 笔：InkEngine 捕获级监听命中画布矩形 → 作画 → `onChange` → `markDirty`。
4. 保存：`flushSave`（防抖 800ms）→ 引擎笔迹转逻辑坐标 → `store.save`。
5. 叶签切走/卸载 → `deactivateOverlay`：停 rAF、flushSave、清 DOM 与状态。

## 7. 错误处理

- `loadPdfJs`/PDF 解析/布局失败 → `new Notice` + 卸载覆盖层，保持原生视图可用。
- 无 `.page` 元素 / 矩形为零 → 不建引擎，工具条仍显示，warn 一次。
- 覆盖层已挂载时重复 `activateOverlay` → 直接返回（幂等）。
- 连续快速缩放 → settle 防抖（200ms）避免重建风暴。
- 叶签切换导致旧 `activateOverlay` 的异步（readBinary/loadPdfJs）在 teardown 后完成 → teardown 置 `overlayActive=false` 并在 async 完成后检查，若已停用则直接丢弃不建 DOM。

## 8. 测试与验证

- `npm run build`（tsc + esbuild）exit 0。
- `node scripts/test-canvas-budget.mjs`（24 断言）、`node scripts/test-native-pdf-geometry.mjs`（22 断言）全绿。
- 终局 whole-branch 代码评审（基线 `951260f` release v1.2.2）。
- 真机验证清单：
  1. 打开 PDF 即显示已保存笔迹，无需点按钮。
  2. 触控笔直接书写（含橡皮/高亮/颜色/粗细/撤销/重做）。
  3. 手指上下滚动翻页正常。
  4. 双指捏合缩放正常，缩放期间笔迹贴合页面不消失，松手后 ~200ms 变清晰。
  5. 缩放后笔迹与页面几何对齐；保存后重开仍对齐。
  6. 顶栏笔按钮可显隐底部工具条。
  7. 不再弹出「探测到…数据已写入」Notice。
  8. 原生 PDF 文本不可被选中。

## 9. 发布

按用户约定：每轮完成即直接发布 `v1.2.3-beta`（bump package.json+manifest.json → build → 提交 release → push → tag → GitHub release + assets）。
