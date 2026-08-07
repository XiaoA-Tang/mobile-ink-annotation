# PDF 原生视图就地书写模式设计

日期：2026-08-07
状态：待用户审阅

## 背景与目标

当前手写标注的工作流需要切换到插件自定义标注视图（额外打开一个标签页），步骤繁琐，用户觉得像"另开一页纸"。期望行为参考华为笔记 app：在当前原生 PDF 页面上出现一个**笔按钮**，点击直接进入绘画模式就地手写，写完后退出，回到原生视图继续阅读/缩放，全程不换标签页。

约束与范围：
- 仅 **PDF** 文件；Markdown / 独立笔记继续走现有完整标注视图，本设计不改动。
- 仅 **手写笔迹**（笔、荧光笔、橡皮）；不做文字高亮/下划线/划线层（用户确认不需要，且原生移动端 PDF 本身不支持文字选择）。
- 用户在平板上确认：原生 PDF 视图**支持双指缩放**、**不支持文字选择**。

目标：
- 消除"另开标签页"的繁琐，实现"就地书写"。
- 笔迹数据与现有标注视图**互通**（同一份 `.ink.json`，同一坐标约定）。
- 不重复踩刚修复的缩放渲染类问题（内存上限、desynchronized 呈现缺陷）。

## 关键决策

1. **采用覆盖层方案**（叠加在 Obsidian 原生 PDF 视图上），而非视图切换方案。
   - 理由：最接近"华为笔记式就地书写"体验；用户已确认原生 PDF 可双指缩放。
   - 唯一实质风险是原生 PDF DOM 结构检测，见"风险"节，以真机 SPIKE 先行验证。
2. **绘画模式锁定缩放/滚动**（用户认可）：单指针（手写笔优先，可选手指）书写；退出绘画模式后才恢复原生缩放/翻页。
   - 主动规避"边写边同步原生缩放变换"这一高风险环节（不掌握原生变换源，轮询对齐易产生错位/消失类问题）。
3. **笔迹坐标沿用全局逻辑坐标**（第 N 页 `y = 累计 offsetY + 页内 y`，逻辑点 = PDF 视口尺寸）。
   - 与现有 `AnnotationFile.strokes` 存储完全同构 → 覆盖层与完整标注视图读写同一份数据。
4. **逻辑页尺寸来自插件自有 pdfjs 加载**（复用现有 `getPdfSourcePageLayout` 视口数据），不依赖原生 PDF 视图内部 API。
5. **真机 SPIKE 先行**：先发一个探测版本，在用户平板上列出原生 PDF 视图内检测到的页元素及其屏幕矩形，确认：
   - 页元素可定位（类名/结构启发式有效）；
   - 页面不是 iframe/embed 隔离的（隔离则无法直接叠加 DOM）。
   这是可行性闸门，SPIKE 通过后才进入全量实施。

## 架构

```
Obsidian 原生 PDF 视图 (leaf, view type "pdf")
   └─ 覆盖层容器 mobile-ink-native-overlay (fixed, 覆盖视口, pointer-events 按需)
        ├─ 顶部工具栏 (笔/荧光笔/橡皮/撤销/重做/颜色/线宽/保存/退出)
        └─ 墨迹画布组: 每个可见页一个绝对定位 canvas, 对齐页屏幕矩形
              └─ InkEngine (复用现有引擎)
                    ├─ committed canvas: 普通合成 (desynchronized:false)
                    └─ live canvas: desynchronized:true (预测段)
   ├─ 几何映射: 页元素 getBoundingClientRect ↔ 逻辑坐标 (自有 pdfjs 视口)
   └─ 数据: StrokeStore.load/save (.ink.json) + SaveQueue
```

### 组件

**1. 新增 `src/pdf/NativePdfOverlayManager.ts`（新文件）**
- 监听 `workspace.on("layout-change")` 与 leaf 视图变化，检测活动 leaf 的 view type 为 `"pdf"`。
- 在原生 PDF 视图容器右下角挂载**笔按钮**（悬浮，`pointer-events:auto`）。
- `enterDrawMode()` / `exitDrawMode()`：创建/移除覆盖层；保存/恢复被锁定的交互。
- 提供命令入口（可选，便于映射到手写笔物理快捷键）。

**2. 几何映射（`src/pdf/nativePdfGeometry.ts`，新文件）**
- `findVisiblePdfPages(containerEl): NativePdfPage[]`：
  - 启发式查找页元素（优先 `.pdf-page` 类；备选"包含较大 canvas 且尺寸成页比例"的节点），取当前视口内可见者。
  - 每项返回 `{ element, rect: getBoundingClientRect(), }`。
- `logicalToScreen / screenToLogical` 换算：
  - 页逻辑尺寸来自自有 pdfjs 视口 + 累计 offsetY（复用现有布局数据）。
  - `screenToLogical(clientX, clientY)`: `x = (clientX-rect.left)/rect.width*pageW`；`y = offsetY + (clientY-rect.top)/rect.height*pageH`。
- 页矩形变化时（仅退出模式后可能变化，绘画中锁定），重建/重定位画布。

**3. 墨迹层（复用，少量接线）**
- 每个可见页建一个 canvas，绝对定位覆盖该页屏幕矩形。
- 复用 `InkEngine`（`setupCanvas` 已支持 `desynchronized` 选项）：
  - committed canvas `desynchronized:false`（v1.1.15 修复）；
  - 尺寸受 `resolveInkCanvasBudget` 约束（v1.1.14 修复）。
- 页矩形与画布按显示比例换算，笔迹始终从逻辑坐标重渲染，避免放大/错位累积。

**4. 工具栏（最小集，含荧光笔）**
- 工具：笔、**荧光笔**、橡皮；撤销、重做；颜色；线宽；保存；退出。
- 复用现有 `InkToolState`（pen/highlighter/eraser 三态已支持荧光笔宽度与颜色）、图标与工具状态持久化。
- 退出 = 保存 + 卸载覆盖层 + 恢复原生交互。

**5. 数据（复用）**
- 进入模式：`StrokeStore.load(file)` 读取现有笔迹并按可见页绘制到对应画布。
- 书写：追加到内存 strokes；`SaveQueue.markDirty()` 与现有视图同一套自动保存机制。
- 保存/退出：写入同一 `.ink.json`（全局逻辑坐标）。

## 常量

- 笔按钮定位：视口右下角（`position:fixed; right:16px; bottom:16px`，z-index 高于原生视图内容）。
- 工具栏：视口顶部横向条；按钮尺寸适配触控（≥44px）。
- 覆盖层 z-index：介于原生 PDF 视图内容与 Obsidian 全局 UI 之间（实际值实施时以真机为准）。
- 荧光笔沿用现有 `highlighterColor` / `highlighterWidth` 默认值。

## 数据流与错误处理

- 进入绘画模式：检测可见页 → 建画布 → 按 rect 对齐 → 加载该 PDF 已有笔迹 → 绑定指针事件。
- 指针（单指/笔）：落到对应页画布 → `InkEngine` 现有采样/平滑/增量渲染流程 → commit → `SaveQueue.markDirty()`。
- 双指/滚动/捏合：绘画模式下被拦截（锁定），不传递给原生视图；退出后释放。
- 退出：保存 → 卸载覆盖层 → 恢复原生交互。
- **降级路径**：页元素检测失败（结构变化/iframe 隔离）时，隐藏笔按钮或点击时提示"请使用完整标注视图"，不崩溃。

## 测试

1. **几何换算 Node 测试**（`scripts/test-native-pdf-geometry.mjs`）：给定页矩形 + 逻辑页尺寸，验证 screenToLogical / logicalToScreen 往返一致、跨页 offsetY 正确。
2. **真机 SPIKE 探测**：脚本打印检测到的页元素、矩形、是否 iframe 隔离，输出供判断可行性。
3. **浏览器 harness（可选）**：用 mock 原生 PDF 视图结构验证覆盖层对齐与指针路由逻辑。

## 兼容性

- 存储格式不变（`InkStroke.points` 原始点、全局逻辑坐标）→ 旧标注可读，覆盖层笔迹与完整视图互通。
- 现有 `AnnotationView`（PDF 完整模式 / Markdown / 独立笔记）不改动。
- 笔按钮仅在原生 PDF 视图出现，不影响其他视图。

## 版本与发布

- 分两阶段发布（对应风险控制）：
  - **1.1.16-beta**：SPIKE 探测版（含探测逻辑与日志，不含全量绘制），真机验证 DOM 可检测。
  - **1.2.0-beta**（或 SPIKE 通过后的下一版本）：完整就地书写模式。
- 每个阶段按既有流程：`npm run build` → commit → tag → push（token URL）→ POST release（UTF8 body）→ 上传 assets。

## 风险

- **原生 PDF DOM 是 Obsidian 内部实现**，类名/结构随版本变化 → 缓解：矩形几何为主、启发式检测、SPIKE 先行；失败时降级提示。
- **iframe/embed 隔离**：若原生 PDF 渲染在隔离的 iframe 中，外部覆盖层无法对齐内部页元素 → SPIKE 必须确认；确认隔离则需评估同源注入或放弃覆盖层方案。
- **移动端 WebView 行为差异**（事件路由、touch-action、desynchronized）→ 沿用已验证的设置（committed 无 desync、预算上限）。
- 绘画模式锁手势是主动取舍，不列为缺陷。
