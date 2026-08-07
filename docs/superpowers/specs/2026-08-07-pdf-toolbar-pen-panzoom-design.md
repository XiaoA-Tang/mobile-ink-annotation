# PDF 顶栏笔按钮 + 绘制模式双指平移缩放

Date: 2026-08-07
Repo: mobile-ink-annotation
Parent plan: `docs/superpowers/plans/2026-08-07-native-toolbar-mimic.md` (v1.2.1-beta)

## 背景

v1.2.1-beta 已把悬浮笔按钮改为右上角 40px 玻璃胶囊、工具栏改为底部胶囊。用户反馈两个问题：
1. 悬浮笔按钮仍覆盖在 PDF 内容上，希望放进 PDF 顶栏"⋮ 三个点"按钮所在的工具栏，成为顶栏图标按钮。
2. 进入绘制模式后 PDF 无法滚动（capture 层 `touch-action:none` + 手势锁定屏蔽了双指与滚轮），多页 PDF 在绘制时无法翻页。用户希望像绘画软件一样：**单指作画、双指自由平移缩放**。

## 目标（成功标准）

- 非绘制状态下，PDF 顶栏（⋮ 所在工具栏）出现一个笔图标按钮；点击进入绘制模式；退出后按钮恢复。
- 绘制模式下：单指/触控笔在页面上作画（行为不变）；**双指拖动平移 PDF**；**双指捏合缩放 PDF**；滚轮平移（桌面端）。
- 缩放后笔迹与 PDF 页面对齐（逻辑坐标天然支持任意缩放，缩放后重排 overlay 画布即可）。
- 构建通过、两个回归测试通过；真机手测清单通过。

## 非目标

- 不改动笔迹存储格式与逻辑坐标系。
- 不实现"三指"/单指空白滚动等附加手势。
- 不实现滚动条/吸附式缩放动画。
- 缩放时保留引擎 undo 栈不是必须项（缩放即重建引擎，undo 历史重置，写入规格明示）。
- 不进入完整标注视图（AnnotationView）改动。

## 现状（关键事实）

- `NativePdfOverlayManager`（src/pdf/NativePdfOverlayManager.ts）：
  - `update()` 在活动 leaf 为 pdf 时调 `attachPenButton(leaf)`，把 `NATIVE_PEN_BUTTON_CLS` 按钮 append 到 `leaf.view.containerEl`（`position:fixed; top/right` 由 styles.css 末尾规则提供）。
  - `setupDrawMode`（行 113-172）：设 `drawModeLeaf`、移除笔按钮、建 layout、`splitStrokesByPage`、建 overlay + captureLayer、`buildToolbar`、`getVisiblePages` + `createPageEngine`（每页一个 InkEngine）、`blockGesture`（touchmove 2+ 指 preventDefault + wheel preventDefault）、`markDirty`。
  - `exitDrawMode`/`teardownDrawMode`：flushSave → 清引擎/overlay → `update()` 重挂笔按钮。
  - `getVisiblePages`（行 228-245）：`containerEl.querySelectorAll(".page")` + 视口裁剪，返回视口坐标 rect。
  - `createPageEngine`（行 247-280）：canvas `position:absolute; left/top = rect`，`InkEngine(live, committed, containerEl, {...})`，`engine.loadStrokes(convertStrokesToScreen(logical, page, rect))`。
  - `replacePageStrokes`（行 282-287）：`convertStrokesToLogical(engine.getStrokes(), page, rect)` 写回 `pageStrokes`。
  - 逻辑坐标与屏幕 rect 无关（nativePdfGeometry/overlayInkData），缩放后页面 rect 变化只影响屏幕转换。
- 手势锁定现状（行 156-169）：captureLayer 上 `touchmove`（2+ 指）与 `wheel` 一律 preventDefault+stopPropagation，即**双指与滚轮完全被屏蔽**。
- InkEngine 以 document 级 capture 监听指针事件（bindEvents InkEngine.ts:229-244），单指笔划在 canvas 上；第二个手指落在 captureLayer 时 InkEngine 的 document 监听也会收到 pointerdown（是否继续/取消活动笔划需核实）。

## 设计

### A. 笔按钮移入 PDF 顶栏

**定位顶栏**：`leaf.view.containerEl.querySelector(".pdf-toolbar")`（Obsidian PDF 视图顶栏），若不存在则按已知类名探测（`.pdf-toolbar`、`.pdf-container` 前缀；真机确认）。⋮ 按钮为顶栏内 `aria-label` 含"更多选项"或类名含 `more` 的图标钮；笔按钮追加在其旁（同容器、同 `order`/flex 环境）。

**按钮创建**（替换 `attachPenButton`）：在顶栏内创建 `<button class="clickable-icon mobile-ink-pdf-toolbar-pen" aria-label="就地手写批注">` + `setIcon(button, "pencil")`。`clickable-icon` 是 Obsidian 图标钮标准类，自动获得主题样式（尺寸/配色/内边距），无需自定义 40px 胶囊；`.mobile-ink-pdf-toolbar-pen` 仅用于钩子/隐藏。点击仍调 `enterDrawMode(leaf)`。

**增删生命周期**：
- `update()` 的 PDF 分支改为挂顶栏按钮（移除 `NATIVE_PEN_BUTTON_CLS` 悬浮按钮逻辑）。
- `setupDrawMode` 移除笔按钮；`exitDrawMode` 后 `update()` 重挂。
- 删除 styles.css 中 `.mobile-ink-native-pen-button` 固定定位规则与末尾专用规则（不再需要）；新增 `.mobile-ink-pdf-toolbar-pen` 类（如只需主题默认则仅保留钩子选择器，无规则也可）。
- `NATIVE_PEN_BUTTON_CLS` 常量保留导出（类名改为 `mobile-ink-pdf-toolbar-pen`，供外部引用兼容）。

### B. 绘制模式双指平移缩放

**访问 pdf.js viewer**：`(leaf.view as unknown as { viewer?: { currentScale: number; container: HTMLElement } }).viewer`。Obsidian pdf leaf 暴露 `.viewer`（pdf.js PDFViewer）。真机探测确认；若不可访问则**优雅降级**：平移仍可用（容器经 DOM 选择器 `.pdf-container` 或 `viewer.container` 兜底），捏合缩放禁用并 console.warn，其余功能不受影响。

**滚动容器**：`viewer.container`（pdf.js 的滚动元素）；无 viewer 时回退 `containerEl.querySelector(".pdf-container")`。

**手势路由**（替换现有 `blockGesture`/`onTouchMove`/`onWheel`，captureLayer 保持 `touch-action:none`）：
- 指针跟踪：captureLayer 上 `pointerdown/pointermove/pointerup/pointercancel`（`capture:true`），维护活动指针表。
- **1 指**：交给 InkEngine 作画（captureLayer 不 preventDefault 单指移动；InkEngine document 级监听自行处理笔划）。作画起始在页 canvas 上。
- **2 指进入（平移缩放模式）**：
  - 若当前有活动单指笔划 → 取消它：优先 `engine.cancelActiveStroke?.()`，否则对 live canvas 派发 `PointerEvent("pointercancel")`。
  - 记录 `startMid`（两指中点）、`startDist`、`startScale = viewer.currentScale`、`startScrollLeft/Top`。
  - `pointermove`：`Δ = 当前中点 - 上一中点`；`container.scrollBy(-Δ.x, -Δ.y)`（内容跟随手指）。`ratio = 当前距离/startDist`；`newScale = clamp(startScale * ratio, 0.5, 8)`（硬编码上下限，不依赖 pdf.js 内部 `minScale/maxScale`），以 `requestAnimationFrame` 节流设置 `viewer.currentScale = newScale`。
  - 每次 scale 提交后触发 overlay 重排（见下）。
- **滚轮**（桌面端）：`container.scrollBy(0, e.deltaY)`（preventDefault）；`ctrl+wheel`（捏合仿真）按 `newScale *= Math.exp(-e.deltaY * 0.01)` 缩放，属增强项（可后置）。
- 手势结束（≤1 指）：复位跟踪状态。

**缩放后 overlay 重排** `relayoutAfterZoom()`：
1. 对当前引擎逐一 `replacePageStrokes(pn)`（同步写回 `pageStrokes`，缩放前固化笔迹）。
2. `teardownDrawMode` 的引擎/画布清理部分 + 重新 `getVisiblePages` + 重建每页引擎（复用 `createPageEngine`）。**undo 历史因此重置**（写入规格明示）。页面 DOM（`.page`）经 pdf.js 重渲染后由 `getVisiblePages` 重新查询，无需手动同步。
3. 手势期间用户不处于作画，重建安全。
4. 在 `markDirty`/保存链不变的前提下，缩放不触发自动保存（`pageStrokes` 已在第 1 步固化）。

**缩放/平移与 overlay 覆盖关系**：overlay `position:fixed; inset:0; z-index:350` 仍盖住顶栏，绘制模式内顶栏不可点（底部胶囊工具栏承担全部操作）。`viewer.currentScale` 变化后 pdf.js 重渲染页面，顶栏照常，退出绘制模式后缩放保持。

## 数据流 / 错误处理

- 无新数据流；笔迹始终以逻辑坐标存储与转换。
- `viewer` 不可访问：仅平移 + warn，捏合缩放禁用。
- `relayoutAfterZoom` 重建引擎若抛错：捕获并 `console.error`，尝试恢复到旧 rect（不做，直接提示"缩放后需退出重进"为兜底；写入实现时以 try/catch 保护避免拖垮绘制会话）。
- 双指手势期间的指针事件全部由 captureLayer 管理，不与 InkEngine 冲突（进入双指即取消活动笔划）。

## 测试

- `npm run build` exit 0；`scripts/test-canvas-budget.mjs`、`scripts/test-native-pdf-geometry.mjs` 回归通过。
- 静态检查：styles.css 无 `.mobile-ink-native-pen-button` 固定定位规则；`NativePdfOverlayManager.ts` 无 `blockGesture` 残留。
- 真机手测清单：
  - 顶栏出现笔按钮（⋮ 旁、主题一致）；非 PDF 视图不显示。
  - 点击进入绘制模式 → 底部胶囊工具栏出现；单指/触控笔作画正常。
  - 双指拖动翻页、双指捏合缩放；缩放后笔迹与页面仍对齐。
  - 缩放后再画一笔、退出重进验证保存。
  - 桌面端滚轮平移（如可测）。

## 文件清单

- `src/pdf/NativePdfOverlayManager.ts`：顶栏按钮挂载/移除；指针手势路由（平移缩放 + 活动笔划取消）；`relayoutAfterZoom`；`viewer` 访问与兜底。
- `styles.css`：删除 `.mobile-ink-native-pen-button` 定位/专用规则；新增 `.mobile-ink-pdf-toolbar-pen`（如需要）；capture 层 `touch-action:none` 保持不变。
- 探测项（真机）：顶栏选择器与 ⋮ 按钮类名；`leaf.view.viewer` 可用性；`cancelActiveStroke` 是否存在（不存在则用 pointercancel）。
