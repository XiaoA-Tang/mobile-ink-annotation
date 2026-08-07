# Spec: 原生 PDF 覆盖层 v1.2.4 修复——平滑跟随 + 可点击笔按钮 + 删保存按钮

日期：2026-08-07
目标版本：v1.2.4-beta
状态：已获用户设计认可

## 1. 背景与问题（真机反馈，v1.2.3-beta）

1. **滑动时笔迹跟随僵硬**：`syncPageTracking`（rAF 循环）每帧对可见 `.page` 调 `getBoundingClientRect` 并写画布 `left/top/width/height` → 每帧强制布局 + 1 帧延迟，滚动时笔迹呈阶梯感（用户明确要"能优化则优化"）。
2. **顶栏笔按钮不可点**：选中画笔时，右上角铅笔按钮（`.mobile-ink-pdf-toolbar-pen`，位于 `.pdf-toolbar` 内）区域被判定为画布：`InkEngine.isEventFromToolbar`（InkEngine.ts:1019）不识别该按钮/工具栏类 → `isEventInsideAnnotation` 因按钮在容器内为 true → 手指落在按钮上（且该区域落在页 1 画布矩形内）→ 被当作起笔 `preventDefault` 吞掉，点击失效。
3. **对号（保存）按钮冗余**：工具栏已有 800ms 防抖自动保存 + 去激活时 `flushSave`，手动「保存」按钮无必要。

## 2. 目标

1. **平滑跟随**：画布作为 `.page` 的直接子元素（`position:absolute; top:0; left:0; width:100%; height:100%`），原生滚动/缩放时由合成器带动，零 JS 定位写入 → 消除阶梯感。
2. **笔按钮可点**：`isEventFromToolbar` 识别 `.pdf-toolbar` 与 `.mobile-ink-pdf-toolbar-pen`，引擎忽略这些元素上的笔/指事件；`syncPageTracking` 不再吞掉工具条区域输入。
3. **删保存按钮**：移除 `buildToolbar` 中 `actionGroup` 与 `checkmark` 按钮（保存仍由自动保存覆盖）。

## 3. 非目标

- 不改变 InkEngine 除 `isEventFromToolbar` 选择器外的任何行为；不改动笔迹数据结构/保存格式。
- 不做性能微基准测量；以真机主观顺滑为准。
- 不改动 `.mobile-ink-toolbar` 等其它工具栏；不新增设置项。

## 4. 约束

- 仓库惯例：`npm run build` exit 0；`node scripts/test-canvas-budget.mjs`（24）、`node scripts/test-native-pdf-geometry.mjs`（22）全绿。
- **本次获准修改 `src/ink/InkEngine.ts`，但仅限 `isEventFromToolbar` 一处选择器**（用户已明确解除该约束）。
- 其余文件：`src/pdf/NativePdfOverlayManager.ts`、`styles.css`。
- 提交惯例：功能提交英文 `fix:` 前缀；`main.js` 单独提交，消息 `构建: 提交…重建后的 main.js（仓库惯例）`。
- PowerShell 陷阱：git stderr 使 `if ($?)` 判失败；用 `Write-Output "exit=$LASTEXITCODE"`。
- 完成后按用户约定直接发布 `v1.2.4-beta`。

## 5. 架构变更

### 5.1 画布嵌入 `.page`（NativePdfOverlayManager + styles.css）

- `createPageEngine`：把 `live`/`committed` 画布 `append` 到 `pageEl`（`.page`）而不是 `this.overlay`；样式改为 `position:absolute; top:0; left:0; width:100%; height:100%`（由 `setupCanvas` 的 `resize(width,height)` 维持 backing store 尺寸与 `ctx.setTransform`）。撤销 `rectCache` Map：`entry.rect` 即每引擎最近屏幕矩形，供尺寸变化检测与逻辑↔屏幕换算（`convertStrokesToScreen`/`convertStrokesToLogical`）使用。
- `syncPageTracking` 简化为三件事，**移除全部每帧样式写入**：
  1. 页面进出视口：不可见页面销毁引擎（先 `replacePageStrokes` 再 `destroy`，`isConnected` 防护 pdf.js 重建页面元素）；
  2. 尺寸变化检测：以 `entry.rect` 为"上次"，每帧从 `getBoundingClientRect` 读出当前矩形比较，变化则更新 `entry.rect` 并记 `sizeChangedAt`；稳定 200ms（`SETTLE_MS`）后 `relayout` 重建清晰笔迹；
  3. 删除旧的 visibility 手动切换（`.page` 隐藏时子画布自动继承隐藏）。
- `relayout` 保持重建语义：先 `setInputEnabled(false)` + `replacePageStrokes` 全部引擎，再销毁重建。
- 命中测试不变：`getCanvasPointMapping` 每笔点实时读 `liveCanvas.getBoundingClientRect()`，滚动/缩放期间坐标正确（不依赖缓存矩形）。

### 5.2 `isEventFromToolbar` 扩展（InkEngine）

InkEngine.ts `isEventFromToolbar`（约 :1019）选择器追加 `.mobile-ink-pdf-toolbar-pen` 与 `.pdf-toolbar`：

```ts
if (target.closest(
  ".mobile-ink-toolbar, .mobile-ink-pdf-page-nav, .mobile-ink-native-toolbar, " +
  ".mobile-ink-pdf-toolbar-pen, .pdf-toolbar"
)) return true;
```

### 5.3 删除保存按钮（NativePdfOverlayManager）

`buildToolbar` 删除：

```ts
const actionGroup = dock.createDiv({ cls: "mobile-ink-toolbar-group" });
addIconButton("save", "checkmark", "保存", () => void this.flushSave(), actionGroup);
```

`flushSave` 仍由 `markDirty`（800ms 防抖）与 `deactivateOverlay` 调用，数据不丢。

## 6. 错误处理与竞态

- 画布嵌入 `.page` 后，pdf.js 重建/移除 `.page` 元素时画布随之移除：`syncPageTracking` 的不可见分支以 `isConnected` 为准，保证引擎销毁前保存笔迹、重建后恢复。
- `deactivateOverlay` 的 `teardownToken` 竞态守卫保持不变。

## 7. 测试与验证

- `npm run build`（tsc + esbuild）exit 0。
- `node scripts/test-canvas-budget.mjs`（24 断言）、`node scripts/test-native-pdf-geometry.mjs`（22 断言）全绿。
- 终局 whole-branch 代码评审（基线 `98b0bdb` release v1.2.3）。
- 真机验证清单：
  1. 打开 PDF 即显示笔迹，无需点按钮。
  2. **手指滚动时笔迹零延迟贴页移动，无明显阶梯感。**
  3. **捏合缩放期间笔迹随页移动，稳定后 ~200ms 变清晰。**
  4. **选中画笔时，顶栏笔按钮（右上角铅笔）可正常点击显隐底部工具条。**
  5. 缩放后笔迹与页面几何对齐；保存后重开仍对齐。
  6. 同窗格 PDF→PDF 切换：新页笔迹自动显示。
  7. 底部工具条不再有对号（保存）按钮；自动保存仍生效（写几笔后离开再开仍在）。
  8. 原生 PDF 文本不可被选中。

## 8. 发布

按用户约定：完成后直接发布 `v1.2.4-beta`（bump package.json+manifest.json → build → commit `release: bump version to 1.2.4` → push main → tag `v1.2.4-beta` → GitHub release + 3 assets）。
