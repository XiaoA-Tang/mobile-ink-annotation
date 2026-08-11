# Spec: md 铅笔按钮浮现工具条 + md 全篇书写修复 + PDF 缩放/平移锁定

日期：2026-08-11
状态：已确认（分节逐节获批）

## 1. 背景与动机

三个用户报告的问题：

1. **md 铅笔按钮点击后无悬浮工具条**：`MarkdownOverlayAdapter` 的 `activate()` 里 `setAnnotating(false)`，工具条 `setCollapsed(true)`，且全代码无一处将 annotating 置真——点按钮"看似无反应"。期望与 PDF 一致：点按钮浮现底部悬浮工具条并进入书写，再点收起、笔迹常显。
2. **md 书写范围：屏幕下半部分不能书写**：canvas 为 `position:fixed`，`armCanvasPosition` 写 `top = rect.top - scrollTop`，向上滚动后 canvas 上移脱离可视区下半段，`isClientInsideInputRegion` 拒绝下方笔触。期望全篇笔记任意位置可书写、画布随内容滚动跟随。
3. **PDF 缩放/平移需可锁定**：原生 PDF 视图支持双指捏合缩放、双指平移、滚轮横向滚动、顶部缩放按钮。期望一个开关，锁定后仅允许上下滚动，禁止缩放与左右平移。

## 2. 目标

- md 铅笔按钮：点击 → 浮现底部浮动工具条 + 进入书写；再点 → 收起工具条、笔迹常显、页面恢复原生滚动/选择。工具条仅在书写态可用。
- md 书写：画布铺满预览元素整个内容高度（`scrollHeight`），随内容滚动自然跟随（复刻 PDF 的 per-page canvas 模型），全篇任意位置可写。
- PDF 手势锁：浮动工具条新增锁按钮（toggle 高亮），锁定后禁缩放（双指捏合 / Ctrl+滚轮 / 缩放按钮）+ 禁左右平移（单指横向 / 双指平移 / 滚轮 deltaX），仅保留上下滚动。teardown 时重置解锁。

## 3. 非目标

- 不引入 md 笔迹到文本段落的 DOM 锚定（沿用现有宽度重投影、高度保留 y 策略）。
- 不改变 PDF 既有笔迹数据模型与保存逻辑。
- 不改 md/PDF 笔迹与 AnnotationFile 的互通数据格式。

## 4. 约束

- 现有回归脚本必须全绿：`node scripts/test-canvas-budget.mjs`、`node scripts/test-native-pdf-geometry.mjs`、`node scripts/test-markdown-overlay-geometry.mjs`、`node scripts/test-smoothing.mjs`。
- `npm run build`（tsc + esbuild）exit 0。
- 遵循仓库惯例：feature 提交与 `main.js` 构建提交分离；发布提交 `release: bump version`。
- 手势锁只影响非书写手势，不与 canvas 书写的单指笔事件冲突。

## 5. 架构

模块改动：

```
src/overlay/
  shared/OverlayToolbar.ts          ← 新增「附加按钮注册位」registry（不污染核心构建）
  markdown/MarkdownOverlayAdapter.ts ← 交互重构 + canvas 铺满内容、随内容滚动
  pdf/PdfOverlayAdapter.ts          ← 注入锁按钮、持有 PdfGestureLock
  pdf/PdfGestureLock.ts             ← 新增：手势锁控制器（listen/unlisten）
```

### 5.1 共享工具条附加按钮（OverlayToolbar）

- 新增能力：`registerExtraButtons(specs: Array<{ key; icon; label; isActive(); onToggle() }>)`，在 dock 后附加一组按钮，`refresh()` 时按 `isActive()` 高亮。
- 默认空，md 不注册，PDF 注册「锁」按钮，避免共享层耦合 PDF 特性。

### 5.2 md 交互重构（MarkdownOverlayAdapter）

- 铅笔按钮语义改为 `annotating` 状态机（覆盖层常驻，切文件时拆除）：
  - 关闭 → 点击：`activate()` + `setAnnotating(true)`（工具条 `setCollapsed(false)`、canvas 可写）。
  - 开启 → 点击：`setAnnotating(false)`（工具条收起、canvas 只读、页面恢复原生滚动/选择）。
- `setAnnotating(true)` 时：canvas `pointer-events` 置 auto、`engine.setInputEnabled(true)`、工具条展开；`setAnnotating(false)` 反向。
- 覆盖层生命周期不变：切文件 / 离开 md 视图 → `deactivate()` 完整拆除。

### 5.3 md 画布改为铺满内容、随内容滚动

- 撤销 `position:fixed` + `armCanvasPosition` 滚动偏移方案。
- canvas 改 `position:absolute` 铺在 `.markdown-preview-view` 元素内部，覆盖 `scrollWidth × scrollHeight`（内容整高），作为内容的"影子层"。
- 因 canvas 是内容子树一部分，滚动时随内容自然移动，无需手动滚动偏移；坐标换算走 PDF 的 `basisRect` 模式：每次通过 `preview.getBoundingClientRect()` 实时换算 `clientToLogical / logicalToClient`。
- 笔画数据模型不变（逻辑坐标 = 内容坐标）。`toViewportStrokeWithScroll / fromViewportStrokeWithScroll` 的 scroll 偏移分支：改为不参与——笔画始终以逻辑坐标存取，渲染时直接以逻辑宽度/高度映射到画布像素（引擎层 canvas 像素坐标系与逻辑坐标按 `canvas.width / (scrollWidth || 1)` 比例映射，写入时反向），仅在宽度重投影后重绘。
- `measure()` 画布尺寸 = `scrollWidth/scrollHeight`；滚动不再触发重绘笔迹（无滚动偏移变化），仅字体/宽度/图片加载变化时重测重投影。
- 跟随重构：`onScroll` 不再做 `refreshStrokesForViewport`（画布随内容移动，无需按 scrollTop 重绘）；保留 `ResizeObserver` 重测。书写与展示态共用同一套画布定位。

### 5.4 PDF 手势锁（PdfGestureLock）

- 构造注入滚动容器（`.pdf-container`），提供 `setLocked(locked)` / `onScrollContainerChange`。
- 锁定启用时挂捕获期监听；解锁 / teardown 移除以恢复原生交互：

| 手势 | 锁定行为 |
|------|----------|
| 双指捏合 / 双指平移（`touchstart/touchmove` 两指以上） | `preventDefault` + `stopPropagation` |
| 单指横向拖动（位移横向分量占优） | `preventDefault`，保留纵向上下滚动 |
| 滚轮 `deltaX` 非零 | `preventDefault` |
| `Ctrl`+滚轮 | `preventDefault` |
| 顶部缩放按钮（`pdf-toolbar` 的 +/−） | 锁定期间拦截点击 |

- 锁只拦非书写手势；书写单指笔事件由 canvas 层处理，互不干扰。
- 状态字段 `panZoomLocked`；`teardownOverlay` 时置 false 并解除监听。

### 5.5 PDF 适配器接入

- `PdfOverlayAdapter` 在 `activateOverlay` 中创建 `PdfGestureLock` 实例；`teardownOverlay` 释放。
- 向 `OverlayToolbar` 注册锁按钮（`lock` 图标，`aria-label` 缩放/平移锁定），点击 toggle `panZoomLocked` 并调 `setLocked`；按钮高亮 `is-active`。

## 6. 错误处理与边界

- md 长内容画布：`scrollHeight × scrollWidth` 过大时受 `resolveInkCanvasBudget` 预算 clamp，超出预算 maxPixels 时引擎按比例降 DPR，保证不崩。
- PDF 锁按钮刷新：工具条 `refresh()` 时读取 `isActive()`，始终反映当前锁状态。
- 锁状态不跨覆盖层生命周期记忆：重新打开 PDF 恢复解锁。
- 原生 PDF 缩放按钮拦截失败回退：若 DOM 结构调整导致选择器失效，锁仍能拦双指/Ctrl+滚轮；缩放按钮作为附加手段，若失效则记录告警并在解锁后由用户自行缩放，不阻断锁功能。

## 7. 测试与验证

- `npm run build` exit 0。
- 回归：四个测试脚本全绿。
- 新增：`armCanvasPosition` 相关逻辑不再需要滚动偏移单测；`PdfGestureLock` 若抽纯函数则补测位移主方向判定。
- 真机验证清单：
  1. 打开 md 笔记 → 点铅笔按钮 → 底部浮动工具条浮现，可书写；再点 → 工具条收起、笔迹常显、可滚动可选中。
  2. 长笔记滚动到任意位置 → 整屏可书写，笔迹随内容滚动跟随。
  3. md 书写时单指不触发页面滚动/选中；展示态恢复。
  4. md 画笔/记号笔颜色粗细独立记忆；swatch 正常。
  5. PDF 打开 → 工具条出现锁按钮；点锁 → 双指捏合、双指平移、单指横向、滚轮横向、Ctrl+滚轮、缩放按钮均被禁；上下滚动正常；再点解锁恢复正常。
  6. PDF 关闭后重开 → 恢复解锁。
  7. md/PDF 笔迹保存与切走切回归正常。

## 8. 发布

按既有约定发布：bump `package.json` + `manifest.json` → `npm run build` → commit（release）→ push main → tag `vX.Y.Z` → GitHub release + 上传 main.js/manifest.json/styles.css。