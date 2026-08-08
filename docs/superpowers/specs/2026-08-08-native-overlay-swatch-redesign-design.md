# Spec: 悬浮颜色/粗细选择面板重设计——主色渐变展开 + 整数滑杆

日期：2026-08-08
目标版本：v1.2.9-beta
状态：已获用户设计认可

## 1. 背景与问题

v1.2.8 已上线基础悬浮面板（颜色单层网格 + 固定档位粗细点选）。用户要求参考成熟标注应用（GoodNotes / Notability / Apple Notes / PDF Expert）重设计，保证美学与便利性。

## 2. 目标

将原生 PDF 覆盖层的颜色与粗细选择器重设计为成熟移动端交互：

1. **面板形态**：锚点弹出的圆角毛玻璃卡片（`backdrop-filter: blur` + 半透明背景），贴合工具栏视觉语言。
2. **颜色**：主色横排 + 选中主色的同色系渐变展开供微调 + 底部自定义取色器。
3. **粗细**：连续滑动条（**整数步进** 1–12）+ 实时显示当前数值 + 常用预设快速键。
4. 颜色与粗细按画笔/记号笔**分别记忆**（沿用现有 `toolState`）。

## 3. 非目标

- 不改动笔画数据/保存格式。
- 不新增颜色方案持久化设置项（沿用现有 toolState，随笔画保存）。
- 不做真机主观评测；以视觉美学与点击便利性为准。

## 4. 约束

- 仓库惯例：`npm run build` exit 0；`node scripts/test-canvas-budget.mjs`（24）、`node scripts/test-native-pdf-geometry.mjs`（26）全绿。
- 改动文件：`src/pdf/NativePdfOverlayManager.ts`、`styles.css`。
- 提交惯例：功能提交英文前缀；`main.js` 单独中文构建提交。
- 完成后按用户约定直接发布。

## 5. 架构变更

### 5.1 面板通用形态（NativePdfOverlayManager + styles.css）

- 保留 `swatchEl` 挂载点、`closeSwatch()`/`positionSwatch()`/`registerSwatchOutsideClose()` 基础架构（v1.2.8）。
- 面板容器改为毛玻璃：`background: color-mix(...)` + `backdrop-filter: blur()` + 圆角 + 阴影。
- 卡片顶部统一标题行，随当前工具显示「颜色」/「记号笔颜色」等。

### 5.2 颜色面板：主色 + 渐变展开

数据结构（常量）：
- `COLOR_PRIMARIES = ["#111111", "#e53935", "#1e88e5", "#43a047", "#ffb300", "#8e24aa", "#ffffff"]`
- 每个主色映射一组同色系渐变档（5 档，由浅到深）。黑主色用灰阶（`#ffffff → #111111`）。

交互：
- 顶部主色横排按钮，点选后**下方滑出**该主色的渐变档行（当前选中主色高亮）。
- 渐变档为可点色块，点选即应用并关闭面板。
- 底部「自定义」行：原生 `input[type=color]` + 「应用」按钮，支持任意颜色。
- 当前生效颜色（含自定义）在渐变档中高亮。

### 5.3 粗细面板：整数滑杆 + 数值显示 + 预设

- 滑动条：`input[type=range]`，`min=1, max=12, step=1`，值取**整数**。
- 拖动时实时更新顶部数值显示（如「4」）并实时应用（`applyToolState({ width })`）。
- 底部预设键：2 / 3 / 5 / 8，命中当前值则高亮，点击即跳转并应用。
- 高亮笔（`highlighter`）时标题「记号笔粗细」，操作 `highlighterWidth`；画笔操作 `width`。

### 5.4 命中测试与输入

- 面板 `pointer-events: auto`，内部点击 `stopPropagation`，点击外部关闭（沿用 v1.2.8）。
- 面板不参与画布笔迹命中（`isEventFromToolbar` 已忽略 `.mobile-ink-native-toolbar` 及 overlay 内工具条）。

## 6. 错误处理与边界

- 面板定位：`positionSwatch` 自动避让屏幕边缘（左/上/下越界回退）。
- 面板随 `teardownOverlay` 清理（`closeSwatch()`）。
- 重复点击触发按钮：`openColorSwatch`/`openWidthSwatch` 先 `closeSwatch()` 再重建。
- 自定义取色器默认值：取当前颜色，若非法回退 `#111111`。

## 7. 测试与验证

- `npm run build` exit 0。
- 两个回归脚本全绿（24 + 26 断言）。
- 真机验证清单：
  1. 点颜色圆点 → 毛玻璃卡片弹出，主色横排，点主色下方渐变展开。
  2. 渐变档/自定义应用后颜色生效，面板关闭。
  3. 点滑杆按钮 → 弹出粗细面板，拖动滑杆数值实时变化、笔迹实时变粗/细。
  4. 预设 2/3/5/8 点击生效，当前值高亮。
  5. 画笔与记号笔颜色/粗细各自独立记忆。
  6. 点击面板外自动关闭；再次点触发按钮可重开。

## 8. 发布

按用户约定直接发布 `v1.2.9-beta`（bump → build → commit → push main → tag → GitHub release + 3 assets）。