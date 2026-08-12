# 底部铅笔启动器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 PDF 与 Markdown 批注入口从右上角铅笔按钮迁移为底部悬浮铅笔按钮：收起态仅一个圆形铅笔，点击展开完整工具条，工具条尾部收起按钮收回；Markdown 收起即退出绘制。

**Architecture:** 按已确认 spec `docs/superpowers/specs/2026-08-12-bottom-pen-launcher-design.md` 方案 A。改造 `OverlayToolbar` 的收起态：`.mobile-ink-native-toolbar.is-collapsed` 由「整条隐藏」改为「隐藏 dock、显示单铅笔按钮」；`ToolbarHost` 新增可选 `onPenExpand`/`onCollapse` 回调；PDF/Markdown 两个 adapter 移除右上角铅笔注入，Markdown 工具条改为常驻 build。

**Tech Stack:** TypeScript、Obsidian API、`OverlayToolbar`/`OverlayToolkit`（现有共享层，核心逻辑不改）、`InkEngine`（仅删一处选择器）。

## Global Constraints

- 遵守 spec：`docs/superpowers/specs/2026-08-12-bottom-pen-launcher-design.md`（状态「已确认」）。
- `AnnotationFile` 数据格式不变；`AnnotationView.ts` 不删除、不注册。
- 回归脚本必须全绿：`node scripts/test-canvas-budget.mjs`、`node scripts/test-native-pdf-geometry.mjs`、`node scripts/test-markdown-overlay-geometry.mjs`、`node scripts/test-gesture-axis.mjs`、`node scripts/test-smoothing.mjs`。
- `npm run build`（`tsc -noEmit -skipLibCheck` + `node esbuild.config.mjs production`）必须 exit 0。
- 仓库惯例：feature 提交英文前缀；`main.js`（tracked 构建产物）单独提交，消息 `构建: 提交…重建后的 main.js（仓库惯例）`。
- PowerShell 陷阱：git stderr 使 `if ($?)` 判失败；用 `Write-Output "exit=$LASTEXITCODE"`，`$LASTEXITCODE -eq 0` 才是成功；禁止 `&&`。
- 所有命令在 `mobile-ink-annotation` 目录下执行；本仓库根目录是外层 `D:\编程文件\obsidian extend`（也是一个 git repo），改动路径一律用 `mobile-ink-annotation/...`。

---

### Task 1: `ToolbarHost` 接口新增可选回调

**Files:**
- Modify: `src/overlay/shared/types.ts:18-25`

**Interfaces:**
- Produces（后续 Task 2 使用）：
  - `ToolbarHost` 新增两个可选方法：`onPenExpand?(): void;` 与 `onCollapse?(): void;`

- [ ] **Step 1: 修改 `types.ts`**

将 `ToolbarHost` 类型改为：

```ts
export type ToolbarHost = {
  getToolState(): InkToolState;
  applyToolState(patch: Partial<InkToolState>): void;
  onUndo(): void;
  onRedo(): void;
  getOverlay(): HTMLElement | null;
  getWidthAnchor(): HTMLElement | null;
  onPenExpand?(): void;
  onCollapse?(): void;
};
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc -noEmit -skipLibCheck`
Expected: exit 0，无新增报错（现有 adapter 不传新字段，均为可选，编译通过）。

- [ ] **Step 3: 提交**

```bash
git add src/overlay/shared/types.ts
git commit -m "feat(overlay): add optional onPenExpand/onCollapse toolbar host callbacks"
```

---

### Task 2: `OverlayToolbar` 收起态视图 + 尾部收起按钮

**Files:**
- Modify: `src/overlay/shared/OverlayToolbar.ts`（字段区、`build()`、`mountExtraButton()`、`teardown()`）

**Interfaces:**
- Consumes: `types.ts` 的 `ToolbarHost.onPenExpand?` / `onCollapse?`（Task 1）。
- Produces（后续 Task 4 CSS 依赖的 class）：
  - 收起态铅笔按钮：class `mobile-ink-icon-button mobile-ink-collapsed-pen`，图标 `pencil`，位于 `.mobile-ink-native-toolbar` 内、dock 之外。
  - 展开态尾部收起按钮：class `mobile-ink-icon-button`，图标 `chevron-down`，位于 dock 末尾的 `.mobile-ink-toolbar-group`（名为 `collapseGroup`）。

- [ ] **Step 1: 新增字段**

在 `OverlayToolbar` 类字段区（第 11-12 行 `extraGroup` 附近）追加：

```ts
private collapsedPenEl: HTMLElement | null = null;
private collapseGroup: HTMLElement | null = null;
```

- [ ] **Step 2: `build()` 中创建收起态铅笔按钮**

在 `build()` 内、`const dock = bar.createDiv(...)` 之后追加（dock 与铅笔按钮是 `.mobile-ink-native-toolbar` 的两个互斥子元素）：

```ts
const collapsedPen = bar.createEl("button", {
  cls: "mobile-ink-icon-button mobile-ink-collapsed-pen",
  attr: { "aria-label": "手写批注" }
});
setIcon(collapsedPen, "pencil");
collapsedPen.addEventListener("click", () => {
  this.host.onPenExpand?.();
  this.setCollapsed(false);
});
this.collapsedPenEl = collapsedPen;
```

- [ ] **Step 3: `build()` 中创建尾部收起按钮**

在 `historyGroup` 创建与撤销/重做按钮追加之后、`for (const entry of this.extraButtons)` 循环**之前**插入：

```ts
const collapseGroup = dock.createDiv({ cls: "mobile-ink-toolbar-group" });
this.collapseGroup = collapseGroup;
const collapseBtn = collapseGroup.createEl("button", {
  cls: "mobile-ink-icon-button",
  attr: { "aria-label": "收起" }
});
setIcon(collapseBtn, "chevron-down");
collapseBtn.addEventListener("click", () => {
  this.host.onCollapse?.();
  this.setCollapsed(true);
});
this.buttonsMap.collapse = collapseBtn;
```

（收起按钮放在 extra 循环前创建，`mountExtraButton` 会把 `extraGroup` 插到 `collapseGroup` 之前，保证收起按钮始终位于 dock 末尾。）

- [ ] **Step 4: `mountExtraButton()` 把 extraGroup 插到收起组之前**

将 `mountExtraButton` 中 extraGroup 的创建改为（原代码为 `?.createDiv(...)` 直接追加）：

```ts
private mountExtraButton(entry: { spec: { icon: string; label: string; isActive(): boolean; onClick(): void }; el: HTMLElement | null }): void {
  if (!this.toolbarEl) return;
  if (!this.extraGroup) {
    const dock = this.toolbarEl.querySelector<HTMLElement>(".mobile-ink-toolbar-dock");
    if (!dock) return;
    this.extraGroup = dock.createDiv({ cls: "mobile-ink-toolbar-group" });
    if (this.collapseGroup) dock.insertBefore(this.extraGroup, this.collapseGroup);
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

- [ ] **Step 5: `teardown()` 复位新字段**

在 `teardown()` 中 `this.extraGroup = null;` 后追加：

```ts
this.collapsedPenEl = null;
this.collapseGroup = null;
```

- [ ] **Step 6: 类型检查**

Run: `npx tsc -noEmit -skipLibCheck`
Expected: exit 0。

- [ ] **Step 7: 提交**

```bash
git add src/overlay/shared/OverlayToolbar.ts
git commit -m "feat(overlay): collapsed state shows single pen button, trailing collapse button on dock"
```

---

### Task 3: 收起态 CSS

**Files:**
- Modify: `styles.css:2734-2737`

**Interfaces:**
- Consumes: Task 2 产生的 class `mobile-ink-collapsed-pen`。
- Produces: 收起态互斥显隐规则（dock 隐藏 / 铅笔显示），供 Task 4 生效。

- [ ] **Step 1: 替换收起态规则**

将：

```css
/* 顶栏笔按钮显隐底部工具条 */
.mobile-ink-native-toolbar.is-collapsed {
  display: none;
}
```

替换为：

```css
/* 底部悬浮栏收起态：仅显示单铅笔按钮，dock 隐藏 */
.mobile-ink-native-toolbar .mobile-ink-collapsed-pen {
  display: none;
}

.mobile-ink-native-toolbar.is-collapsed .mobile-ink-toolbar-dock {
  display: none;
}

.mobile-ink-native-toolbar.is-collapsed .mobile-ink-collapsed-pen {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  flex-basis: 44px;
  border-radius: 999px;
}
```

（`.mobile-ink-icon-button` 的圆角/背景/图标尺寸由 `styles.css:2686` 起的 native-overlay 规则提供，收起态铅笔按钮自然继承。）

- [ ] **Step 2: 提交**

```bash
git add styles.css
git commit -m "feat(styles): collapsed native toolbar shows single bottom pen button instead of hiding"
```

---

### Task 4: PDF adapter 移除右上角铅笔，初始收起

**Files:**
- Modify: `src/overlay/pdf/PdfOverlayAdapter.ts`（import 区、第 14/27-28/61-64 字段、`update()`、`getPdfToolbar`~`removePenButton`、`toggleToolbar()`、`activateOverlay` 的 build 处、catch 分支、`deactivateOverlay`、`onunload`）

**Interfaces:**
- Consumes: Task 2/3 的收起态视图（PDF 不提供 `onPenExpand`/`onCollapse`，收起态铅笔点击由 `OverlayToolbar` 自行展开）。
- Produces: 清理后的 `PdfOverlayAdapter`（无 `penButton`/`currentLeaf` 注入逻辑）。

- [ ] **Step 1: 清理 import 与字段**

- 删除 import：`setIcon` 从 `import { App, loadPdfJs, Notice, Platform, setIcon, TFile, Workspace, WorkspaceLeaf } from "obsidian";` 中移除（仅 `attachPenButton` 用到）。
- 删除常量：`export const NATIVE_PEN_BUTTON_CLS = "mobile-ink-pdf-toolbar-pen";`。
- 删除字段：`penButton`（27）、`currentLeaf`（28）、`penButtonRetryTimer`/`penButtonRetryCount`/`penButtonRetryMs`/`penButtonRetryMax`（61-64）。

- [ ] **Step 2: 重写 `update()`**

将 `update()` 改为：

```ts
private update(): void {
  if (this.unloaded) return;
  const leaf = this.app.workspace.activeLeaf;
  if (this.isActive) {
    const file = leaf ? (leaf.view as unknown as { file?: TFile }).file : undefined;
    const fileChanged = !!file && this.drawFile !== file;
    if (!leaf || leaf !== this.activeLeaf || leaf.getViewState().type !== "pdf" || fileChanged) {
      void this.deactivateOverlay();
    }
    return;
  }
  const isPdf = !!leaf && leaf.getViewState().type === "pdf";
  if (!isPdf || !leaf) return;
  void this.activateOverlay(leaf);
}
```

- [ ] **Step 3: 删除铅笔注入相关方法**

删除以下方法整体：`getPdfToolbar`、`attachPenButton`、`schedulePenButtonRetry`、`clearPenButtonRetry`、`removePenButton`、`toggleToolbar`。

- [ ] **Step 4: `onunload()` 清理调用**

将 `onunload()` 中 `this.clearPenButtonRetry();` 与 `this.removePenButton();` 两行删除（保留其余）。

- [ ] **Step 5: `activateOverlay` 初始收起**

在 `activateOverlay` 中 `this.toolbar.build(this.overlay);` 之后追加：

```ts
this.toolbar.setCollapsed(true);
```

并将 catch 分支中的 `this.removePenButton();` 删除。

- [ ] **Step 6: `deactivateOverlay` 清理**

删除 `deactivateOverlay` 中：

```ts
if (leaf) {
  this.currentLeaf = null;
}
```

（若 `leaf` 变量因此不再使用，同时删除 `const leaf = this.activeLeaf;` 赋值；保留 `const containerEl = leaf?.view.containerEl;` 所需的 `leaf` 引用，确认后调整。）

- [ ] **Step 7: 类型检查**

Run: `npx tsc -noEmit -skipLibCheck`
Expected: exit 0。

- [ ] **Step 8: 提交**

```bash
git add src/overlay/pdf/PdfOverlayAdapter.ts
git commit -m "feat(pdf): remove top-right pen button, start native toolbar collapsed"
```

---

### Task 5: InkEngine 清理废弃选择器

**Files:**
- Modify: `src/ink/InkEngine.ts:1072-1075`

**Interfaces:**
- Consumes: Task 4 已删除 `.mobile-ink-pdf-toolbar-pen` 元素。
- Produces: `isEventFromToolbar` 排除列表不含已废弃 class。

- [ ] **Step 1: 删除选择器**

将：

```ts
    if (target.closest(
      ".mobile-ink-toolbar, .mobile-ink-pdf-page-nav, .mobile-ink-native-toolbar, " +
      ".mobile-ink-pdf-toolbar-pen, .pdf-toolbar, .mobile-ink-swatch-panel"
    )) return true;
```

改为：

```ts
    if (target.closest(
      ".mobile-ink-toolbar, .mobile-ink-pdf-page-nav, .mobile-ink-native-toolbar, " +
      ".pdf-toolbar, .mobile-ink-swatch-panel"
    )) return true;
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc -noEmit -skipLibCheck`
Expected: exit 0。

- [ ] **Step 3: 提交**

```bash
git add src/ink/InkEngine.ts
git commit -m "chore(ink): drop obsolete .mobile-ink-pdf-toolbar-pen from toolbar exclusion"
```

---

### Task 6: Markdown adapter 移除铅笔、工具条常驻 build

**Files:**
- Modify: `src/overlay/markdown/MarkdownOverlayAdapter.ts`（import 区、第 15/26/31/49-52 字段、`onunload`、`update()`、`attachPenButton`~`clearPenButtonRetry`、`toggle`、`activate`、`setAnnotating`、`teardown`）

**Interfaces:**
- Consumes: Task 1 的 `onPenExpand`/`onCollapse` 回调；Task 2/3 的收起态视图。
- Produces:
  - `ensureBuilt(leaf: WorkspaceLeaf): boolean` —— 创建 overlay + toolkit + toolbar 并 build（初始收起态），已存在则直接返回 true。
  - `onPenExpand` → `activate()` 或 `setAnnotating(true)`；`onCollapse` → `setAnnotating(false)`。

- [ ] **Step 1: 清理 import、常量、字段**

- 删除 import：`setIcon` 从 `import { App, Platform, setIcon, TFile, Workspace, WorkspaceLeaf } from "obsidian";` 中移除。
- 删除常量：`export const MARKDOWN_TITLE_BUTTON_CLS = "mobile-ink-markdown-pen";`。
- 删除字段：`currentLeaf`（26）、`penButton`（31）、`penButtonRetryTimer`/`penButtonRetryCount`/`penButtonRetryMs`/`penButtonRetryMax`（49-52）。

- [ ] **Step 2: `onunload()` 清理**

将 `onunload()` 中 `this.removePenButton();` 一行删除。

- [ ] **Step 3: 新增 `ensureBuilt()` 并重写 `update()`**

删除 `attachPenButton`、`schedulePenButtonRetry`、`clearPenButtonRetry`、`removePenButton`、`toggle` 方法整体。

新增（放在 `update()` 之前）：

```ts
private ensureBuilt(leaf: WorkspaceLeaf): boolean {
  if (this.overlay && this.toolbar && this.toolkit) return true;
  const preview = leaf.view.containerEl.querySelector<HTMLElement>(".markdown-preview-view");
  if (!preview) return false;
  this.containerEl = leaf.view.containerEl;
  this.overlay = this.containerEl.createDiv({ cls: `${MARKDOWN_OVERLAY_CLS} mobile-ink-native-overlay`, attr: { "aria-hidden": "true" } });
  this.toolkit = new OverlayToolkit(
    { app: this.app, store: this.store },
    () => this.saveAnnotation()
  );
  this.toolbar = new OverlayToolbar({
    getToolState: () => this.toolkit!.toolState,
    applyToolState: (patch) => this.applyToolState(patch),
    onUndo: () => { this.engine?.undo(); this.toolbar?.refresh(); this.toolkit?.markDirty(); },
    onRedo: () => { this.engine?.redo(); this.toolbar?.refresh(); this.toolkit?.markDirty(); },
    getOverlay: () => this.overlay,
    getWidthAnchor: () => this.toolbar?.buttons.width ?? null,
    onPenExpand: () => {
      if (this.isActive) {
        this.setAnnotating(true);
        return;
      }
      const leaf = this.app.workspace.activeLeaf;
      if (leaf) void this.activate(leaf);
    },
    onCollapse: () => this.setAnnotating(false)
  });
  this.toolbar.build(this.overlay);
  this.toolbar.setCollapsed(true);
  return true;
}
```

将 `update()` 改为：

```ts
private update(): void {
  if (this.unloaded) return;
  const leaf = this.app.workspace.activeLeaf;
  if (this.isActive) {
    const file = leaf ? (leaf.view as unknown as { file?: TFile }).file : undefined;
    const fileChanged = !!file && this.drawFile !== file;
    if (!leaf || leaf !== this.activeLeaf || leaf.getViewState().type !== "markdown" || fileChanged) {
      void this.deactivate();
    }
    return;
  }
  const isMd = !!leaf && leaf.getViewState().type === "markdown";
  if (!isMd || !leaf) {
    if (this.toolbar) void this.deactivate();
    return;
  }
  if (!this.isReadingView(leaf)) {
    if (this.toolbar) void this.deactivate();
    return;
  }
  this.ensureBuilt(leaf);
}
```

- [ ] **Step 4: `activate()` 复用常驻工具条**

在 `activate()` 中：
- 保留开头 `if (this.isActive) return;`、`teardownToken`、`file` 校验。
- 在 `this.preview = preview;` 之前调用并校验：`if (!this.ensureBuilt(leaf)) { this.activeLeaf = null; this.drawFile = null; return; }`。
- 删除原 `activate()` 中重复创建 overlay/toolkit/toolbar 的代码块（第 203-217 行），其余（store.load、canvas、engine、measure、`setAnnotating(true)` 等）保持不变。

- [ ] **Step 5: `setAnnotating()` 与 `teardown()` 清理**

在 `setAnnotating()` 中删除一行：

```ts
    if (this.penButton) this.penButton.classList.toggle("is-active", value);
```

删除 `teardown()` 末尾的一行：

```ts
    if (this.penButton) this.penButton.classList.remove("is-active");
```

- [ ] **Step 6: 类型检查**

Run: `npx tsc -noEmit -skipLibCheck`
Expected: exit 0。

- [ ] **Step 7: 提交**

```bash
git add src/overlay/markdown/MarkdownOverlayAdapter.ts
git commit -m "feat(markdown): persistent bottom toolbar with collapsed pen entry, collapse exits annotating"
```

---

### Task 7: 构建 + 回归 + main.js 提交

**Files:**
- Verify: 全部改动；构建产物 `main.js`

- [ ] **Step 1: 构建**

Run: `npm run build`
Expected: exit 0（`tsc -noEmit -skipLibCheck` 与 `node esbuild.config.mjs production` 均成功，`main.js` 重新生成）。

- [ ] **Step 2: 回归脚本**

Run:

```bash
node scripts/test-canvas-budget.mjs
node scripts/test-native-pdf-geometry.mjs
node scripts/test-markdown-overlay-geometry.mjs
node scripts/test-gesture-axis.mjs
node scripts/test-smoothing.mjs
```

Expected: 每个脚本均输出全 PASS，无失败断言。

- [ ] **Step 3: 提交 main.js**

```bash
git add main.js
git commit -m "构建: 提交…重建后的 main.js（仓库惯例）"
```

- [ ] **Step 4: 手动验证清单（在 Obsidian 移动端）**

- PDF：进入 PDF → 底部中央出现圆形铅笔；点击展开全部工具（画笔/记号笔/橡皮擦/颜色/粗细/撤销/重做/锁定）；dock 尾部有收起按钮；点收起回到单铅笔；批注数据保存完整。
- Markdown：进入阅读视图 → 底部显示铅笔；点铅笔进入批注并展开工具条；点收起退出绘制并收回；再次点击可重新进入批注。
- 切换笔记/leaf：工具条随 leaf 正确销毁/重建，无残留；现有工具功能无回归。

---

## 自审

**Spec 覆盖：**
- 收起态单铅笔（spec「视图状态机」）→ Task 2/3 ✓
- 点击展开（spec 交互）→ Task 2 `onPenExpand` + 自行展开 ✓
- 尾部收起按钮（spec「收起方式」）→ Task 2 Step 3 ✓
- 移除右上角（PDF）→ Task 4 ✓
- 移除右上角（Markdown）+ 常驻 build → Task 6 ✓
- Markdown 收起=退出绘制（`onCollapse` → `setAnnotating(false)`）→ Task 6 ✓
- InkEngine 选择器清理 → Task 5 ✓
- CSS 语义改变 → Task 3 ✓

**占位符扫描：** 无 TBD/TODO，全部步骤含具体代码与命令。

**类型一致性：** `onPenExpand`/`onCollapse` 在 Task 1 定义、Task 2 消费、Task 6 提供，签名一致；`ensureBuilt` 在 Task 6 定义并使用；class 名 `mobile-ink-collapsed-pen` 在 Task 2 产出、Task 3 引用，一致。
