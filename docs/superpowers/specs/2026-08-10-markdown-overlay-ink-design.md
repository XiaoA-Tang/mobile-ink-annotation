# Spec: md 笔记原生视图手写批注覆盖层（右上角开关 + 笔迹常显）

日期：2026-08-10
状态：已确认（分节逐节获批）

## 1. 背景与动机

当前插件对 md/PDF 的手写批注走 `AnnotationView`（全屏标注视图）：点击入口会把当前叶子整体切换成一个自定义标注视图。用户希望 md 笔记改用「覆盖层」模式——笔记停留在 Obsidian 原生阅读视图，右上角按钮作为手写开关，已画笔迹常显在笔记内容上，随滚动跟随。PDF 已有一套 `NativePdfOverlayManager` 覆盖层，本次为 md 补齐同一体验，并全部废弃 `AnnotationView`。

## 2. 目标

- md 笔记在 Obsidian 原生阅读视图上支持手写批注，右上角标题栏按钮作为开关。
- 开关关闭时笔迹**常显**、纯展示、页面恢复原生滚动/选择；开关开启时浮现完整浮动工具条并可书写，页面手势被 canvas 拦截。
- 笔迹跟随滚动；宽度变化按比例重投影，高度变化保留 y（不锚定文本）。
- 与现有笔迹数据互通：沿用 `AnnotationFile`（`pageWidth/pageHeight/strokes`）同一数据模型；旧 AnnotationView 笔迹按宽度比例缩放适配显示。
- 全部废弃 `AnnotationView` 全屏标注模式及其入口。

## 3. 非目标

- 不做 md 笔迹到文本段落的 DOM 锚定（高度变化时笔迹 y 不随文本行移动）。
- 不做 md 文本选择/高亮/下划线批注（`AnnotationView` 原有能力随其废弃，不在本次范围）。
- 不改变 PDF 覆盖层既有交互与数据结构。

## 4. 约束

- `AnnotationFile` 数据格式不变（版本、字段、存储位置 `annotations/` 目录）。
- 现有回归脚本必须继续全绿：`node scripts/test-canvas-budget.mjs`（24 断言）、`node scripts/test-native-pdf-geometry.mjs`（26 断言）。
- `npm run build` exit 0。
- 遵循仓库惯例：feature 提交与 `main.js` 构建提交分离。

## 5. 架构

模块划分（方案 A：抽取共享层）：

```
src/overlay/
  shared/OverlayToolkit.ts          ← 从 NativePdfOverlayManager 抽出的共享核心
  shared/OverlayToolbar.ts          ← 浮动工具条 + 颜色/粗细 swatch
  shared/types.ts
  pdf/PdfOverlayAdapter.ts          ← 现有 NativePdfOverlayManager 瘦身为内容适配器（多页、pdf.js、跟随）
  markdown/MarkdownOverlayAdapter.ts ← 新增：md 单页长内容适配器
```

### 5.1 共享核心 OverlayToolkit

职责：
- InkEngine 生命周期（live/committed canvas、resize、displayScale、canvas 预算 `resolveInkCanvasBudget`）。
- 浮动工具条构建（画笔/记号笔/橡皮擦/颜色圆点/粗细/撤销/保存）。
- 颜色 swatch、粗细 swatch、宽度面板（复用本次会话已完成的 swatch UI）。
- `applyToolState`、`closeSwatch`、`positionSwatch`、`registerSwatchOutsideClose`。
- 触摸手势拦截、保存队列（`SaveQueue`）、dirty 管理。

### 5.2 适配器职责

- 检测当前叶子类型并决定是否激活（PDF 视图 / md 阅读视图）。
- 提供「页面集合」：
  - PDF：多页（页宽 × 页高），页数来自 pdf.js。
  - md：单页（内容区渲染宽度 × 内容总高度）。
- 提供滚动容器、坐标换算（`clientRectToPageRect` / 跟随模式，`basisRect` 基准）。
- 挂载标题栏按钮：PDF 用 `.pdf-toolbar`，md 用视图标题栏操作区。

## 6. md 适配器细节

### 6.1 坐标系统（决策 2a：不重复渲染）

- 逻辑宽度 `W = .markdown-preview-view` 实际渲染宽度（含 padding）。
- 逻辑高度 `H = 渲染内容总高度`（scrollHeight 对应逻辑高度）。
- 逻辑尺寸：`pageWidth = W`，`pageHeight = H`。
- canvas 直接叠加在原生已渲染内容之上，不额外渲染隐藏基准层。

### 6.2 笔迹加载与旧数据适配

- 加载时：`scale = W_render / annotation.pageWidth`（新/旧宽度比例）。
- 首次加载：x 与 y 均乘 `scale`，随后以当前宽度为准存储（写入时用当前 W/H）。
- 若 `annotation.pageWidth <= 0` 或 NaN，按 `scale = 1` 处理。
- 宽度变化重投影（`x * newW/oldW`）；高度变化仅更新 pageHeight，y 不变。

### 6.3 重排监听

触发重新测量的事件：
- 容器尺寸变化（`ResizeObserver`）。
- 编辑器布局变化 / 工作区布局变化。
- 字体缩放变化。
- 图片加载完成后（`load` 事件委托或 `waitForImages` 等价逻辑）。

重测流程：
1. 读新 `W'`、`H'`。
2. 若 `W' != W`：重投影全部笔迹并更新 pageWidth。
3. 更新 pageHeight。
4. 重绘已提交笔迹。

### 6.4 渲染与跟随

- 内容容器上叠加透明 canvas，尺寸 = 当前视口裁剪，通过滚动偏移 + `basisRect` 映射到逻辑坐标（复用 PDF 覆盖层的跟随模式）。
- 跟随滚动：监听滚动容器 `scroll`，rAF 重绘已提交笔迹。
- `pointer-events`：
  - 开启手写：canvas 捕获全部指针事件（拦截滚动/选中），`NATIVE_ANNOTATING_CLS` 类标记。
  - 关闭手写：canvas `pointer-events: none`，纯展示，页面恢复原生交互。

## 7. 开关按钮、状态与工具条

- 按钮：md 视图标题栏右侧操作区（`view-header-actions`），`clickable-icon` 外观 + `pencil` 图标，与 PDF 按钮视觉一致。
- 状态：
  - 关闭（默认）：按钮普通，笔迹层存在但 `pointer-events:none`。
  - 开启：按钮高亮（`is-active` + accent 色），浮现浮动工具条。
- 点击切换 `off ⇄ on`；切换时若 dirty 则保存（关闭时保存，重开时按当前宽度加载）。
- 浮动工具条复用共享核心，画笔/记号笔颜色粗细独立记忆；工具条可拖动。
- 离开 md 视图或切换到其他笔记 → 关闭覆盖层（dirty 则保存）、移除按钮与笔迹层。

## 8. AnnotationView 废弃与入口改造

- `AnnotationView` 整体停用：不再 `registerView(VIEW_TYPE_MOBILE_INK, ...)`，移除打开入口。
- `main.ts` 移除：
  - ribbon 图标「打开手写标注」及 `openInkForActiveFile` / `openInkForFile`。
  - 命令 `open-mobile-ink-annotation`。
  - PDF 默认标注视图设置项 `openPdfWithAnnotationByDefault` 及 `queueOpenPdfWithAnnotationByDefault` / `openPdfWithAnnotationByDefaultIfNeeded`。
- PDF 继续用 `NativePdfOverlayManager`（瘦身为 `PdfOverlayAdapter`），不受 AnnotationView 移除影响。
- `AnnotationView.ts` 中可复用底层（`MarkdownRenderer` 渲染/测量工具、`markdownLayout` 快照、PDF 文本批注数据结构）在本次不主动删除，但若不再被任何路径引用则后续清理；本次以「不再注册、无入口」为验收。
- 数据兼容：数据文件不变，md 与 PDF 共用同一套 `AnnotationFile` 读取。

## 9. 测试与验证

- `npm run build` exit 0。
- 回归：`node scripts/test-canvas-budget.mjs`（24 断言）、`node scripts/test-native-pdf-geometry.mjs`（26 断言）全绿。
- 新增：md 坐标缩放纯函数单测（旧宽度→新宽度重投影公式、高度变化保留 y、pageWidth<=0 回退 scale=1），仿照现有几何测试脚本。
- 真机验证清单：
  1. 打开 md 笔记 → 标题栏右上角出现铅笔按钮。
  2. 点按钮 → 浮现工具条，页面书写生效；再次点 → 工具条隐藏、笔迹常显。
  3. 关闭状态滚动页面 → 笔迹跟随滚动、不遮挡阅读。
  4. 画笔/记号笔颜色粗细独立记忆。
  5. 颜色/粗细面板交互正常。
  6. 开启状态页面上拖动不触发滚动/选中；关闭后恢复。
  7. 窗口/字体/图片加载导致宽度变化 → 笔迹按比例重投影。
  8. 切走再切回 → 笔迹按当前宽度加载。
  9. 旧 AnnotationView 笔迹数据 → 新覆盖层按宽度缩放显示。
  10. PDF 覆盖层回归：标题栏按钮、工具条、swatch、滚动跟随一切正常。

## 10. 发布

按用户约定发布 beta 版本：bump `package.json` + `manifest.json` → `npm run build` → commit（release）→ push main → tag `vX.Y.Z-beta` 并 push → GitHub release（prerelease）+ 上传 main.js/manifest.json/styles.css 三个资产 → 校验尺寸一致。
