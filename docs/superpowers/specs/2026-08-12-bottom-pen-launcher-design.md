# 底部铅笔启动器设计

日期：2026-08-12
范围：mobile-ink-annotation 插件（PDF 与 Markdown 批注场景）

## 目标

将批注工具的入口从"右上角铅笔按钮"迁移到底部悬浮工具栏：

- 收起态：底部中央只有一个圆形铅笔按钮
- 点击铅笔 → 展开完整笔类工具条（现有 OverlayToolbar 的全部工具）
- 展开态：工具条尾部有一个收起按钮，点击后收回为单铅笔
- 移除 PDF 原生顶栏与 Markdown view-header 中的右上角铅笔按钮
- Markdown 场景：收起 = 退出绘制模式

## 现状

- **PDF**：`PdfOverlayAdapter.attachPenButton` 把铅笔注入 `.pdf-toolbar`（右上角），点击 `toggleToolbar()` 切换 `OverlayToolbar` 的 `is-collapsed`（CSS 中 `display:none` 隐藏整条工具条）。工具条在 `activateOverlay` 时 `build`，`deactivateOverlay` 时 `teardown`。
- **Markdown**：`MarkdownOverlayAdapter.attachPenButton` 把铅笔注入 `.view-header` / `.view-header-actions`（右上角），点击 `toggle(leaf)`。`setAnnotating(value)` 内已联动 `toolbar.setCollapsed(!value)`：进入批注展开、退出批注收起。工具条同样在激活时 build。
- **OverlayToolbar**：`.mobile-ink-native-toolbar` 容器内含 `.mobile-ink-toolbar-dock`。dock 内有工具组（画笔/记号笔/橡皮擦）、样式组（颜色/粗细）、历史组（撤销/重做）、额外按钮组。`setCollapsed()` 仅切换 `is-collapsed` class。

## 设计

### 视图状态机（OverlayToolbar 内部）

`OverlayToolbar` 的收起态从"整条隐藏"改为"单铅笔按钮"：

| 状态 | 视觉 | 交互 |
|---|---|---|
| 收起（collapsed） | 仅一个圆形铅笔按钮，固定底部中央 | 点击 → 展开工具条 |
| 展开（expanded） | 完整 dock（全部现有工具）+ 尾部收起按钮 | 点收起按钮 → 收回为单铅笔 |

实现要点：

- 收起态铅笔按钮作为 `.mobile-ink-native-toolbar` 容器内的一个新元素（`mobile-ink-collapsed-pen`），与 dock 互斥显示。
- `setCollapsed(collapsed)` 仍复用现有 class 切换，但 CSS 语义改变：`is-collapsed` 时隐藏 dock、显示铅笔按钮；非收起时相反。
- 收起态铅笔按钮点击 → 展开（`setCollapsed(false)`），并通过 host 回调通知场景侧。
- 展开态尾部收起按钮点击 → `setCollapsed(true)`，并通过 host 回调通知场景侧。

### ToolbarHost 接口变更

`src/overlay/shared/types.ts` 的 `ToolbarHost` 增加可选回调：

```ts
onPenExpand?(): void;   // 收起态铅笔点击触发
onCollapse?(): void;    // 展开态收起按钮点击触发
```

`OverlayToolbar` 内部处理规则：

- 收起态铅笔点击：若 `host.onPenExpand` 存在则调用它，否则自行 `setCollapsed(false)` 展开。
- 展开态收起按钮点击：若 `host.onCollapse` 存在则调用它，否则自行 `setCollapsed(true)` 收起。

Markdown 通过这两个回调实现"进入批注展开 / 退出绘制收起"。

### 场景接入

**PDF（`PdfOverlayAdapter`）**：

- 删除 `attachPenButton` / `removePenButton` / `schedulePenButtonRetry` 及相关字段、`NATIVE_PEN_BUTTON_CLS` 常量、`getPdfToolbar`、`toggleToolbar()`。
- 收起态铅笔按钮点击由 OverlayToolbar 自行展开（不提供 `onPenExpand`）。
- `OverlayToolbar` 保持现有 build/teardown 时机（进入 PDF 激活 overlay 时 build，初始为**收起态**）。
- 移除 `InkEngine.isEventFromToolbar` 排除列表中的 `.mobile-ink-pdf-toolbar-pen`（按钮已删除，保留无效选择器）。收起态铅笔按钮位于 `.mobile-ink-native-toolbar` 内，已被现有排除项覆盖。

**Markdown（`MarkdownOverlayAdapter`）**：

- 删除 `attachPenButton` / `removePenButton` / `schedulePenButtonRetry` 及相关字段、`MARKDOWN_TITLE_BUTTON_CLS` 常量、`toggle(leaf)`。
- Overlay 与 `OverlayToolbar` 改为**常驻 build**：在 `update()` 检测到 reading view 时创建 overlay 并 build（初始收起态），`deactivate()` 时 teardown。`activate()` 不再负责创建工具条，只负责初始化引擎与画布并进入批注模式。
- 提供 `onPenExpand: () => this.setAnnotating(true)`、`onCollapse: () => this.setAnnotating(false)`，复用 `setAnnotating` 内已有的 `toolbar.setCollapsed(!value)` 联动。
- 移除 `toggle(leaf)` 后，进入批注的唯一路径为收起态铅笔点击（`onPenExpand`）。

### CSS（styles.css）

- 修改 `.mobile-ink-native-toolbar.is-collapsed`：从 `display:none` 改为隐藏 dock、显示收起态铅笔按钮。
- 新增收起态铅笔按钮样式（圆形、底部居中、与现有浮动按钮视觉一致，复用 `mobile-ink-floating-button` 或同源样式）。
- 展开态尾部收起按钮复用现有 `mobile-ink-icon-button` 样式。

## 边界与细节

- 收起态铅笔按钮固定底部中央，不提供拖拽。
- PDF 场景收起/展开不影响批注数据，仅 UI 显隐。
- Markdown 场景收起必然退出绘制模式（与现有一致）。
- 打开新笔记/切换 leaf 时，PDF 保持现有 build/teardown 时机（激活时 build）；Markdown 改为 `update()` 时 build、`deactivate()` 时 teardown（常驻）。
- 收起态铅笔按钮在展开时隐藏、在收起时显示；展开时 dock 显示、收起时 dock 隐藏。

## 测试

- PDF：进入 PDF → 底部显示铅笔；点击展开出现全部工具；点尾部收起钮收回；批注数据完整。
- Markdown：进入笔记 → 底部显示铅笔；点击进入批注并展开；点收起钮退出绘制并收回；可重新进入。
- 切换 leaf / 打开新笔记：工具条状态与 leaf 正确绑定，不残留。
- 无回归：现有工具（画笔/记号笔/橡皮擦/颜色/粗细/撤销/重做/额外按钮）在展开态可用。
