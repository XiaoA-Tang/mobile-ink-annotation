# 原生 PDF 手写模式 UI 对齐原版悬浮工具栏 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将原生 PDF 手写模式的悬浮笔按钮移到右上角并改用原版样式，工具栏改造成原版那样的底部居中玻璃胶囊。

**Architecture:** 复用原版 `.mobile-ink-toolbar-dock` / `.mobile-ink-toolbar-group` / `.mobile-ink-icon-button` / `.mobile-ink-floating-button` 等**无作用域**样式；为被 `.mobile-ink-root` 作用域限定的按钮外观/图标字形规则在 `.mobile-ink-native-overlay` 下加一段别名 CSS。TS 侧重构 `buildToolbar` 产生原版标记，`refreshToolbar` 同步工具色 CSS 变量与激活态。

**Tech Stack:** TypeScript (Obsidian plugin), esbuild, CSS custom properties。

## Global Constraints

- 只改 `src/pdf/NativePdfOverlayManager.ts` 与 `styles.css` 两个文件；**禁止**改动 `src/pdf/nativePdfGeometry.ts`、`src/pdf/overlayInkData.ts`、`src/ink/*`、`src/views/*`、`src/main.ts`。
- 行为不变：点笔按钮进入绘制模式、工具栏出现、退出按钮离开并防抖保存；手势锁定、每页 InkEngine、保存逻辑不动。
- `mobile-ink-native-overlay` / `mobile-ink-native-capture` / `mobile-ink-native-page-canvas` 三个类与对应 CSS 保持不变；`NATIVE_*_CLS` 常量名不变。
- z-index 层级不变：overlay 350、toolbar 360、pen button 400。
- 构建命令 `npm run build`（= `tsc -noEmit -skipLibCheck && node esbuild.config.mjs production`）。回归命令 `node --experimental-strip-types scripts/test-canvas-budget.mjs` 与 `node --experimental-strip-types scripts/test-native-pdf-geometry.mjs`。
- Node 24，Windows PowerShell 5.1：`node -e` 或 `.mjs` 脚本；中文文件写 UTF-8 用 write 工具或 `[IO.File]::WriteAllText(..., UTF8Encoding($false))`。
- 本任务为纯 UI，无单元测试可写；以构建通过 + 现有回归通过 + 真机手测清单作为验收。

---

### Task 1: 原生覆盖层 UI 重构（笔按钮右上角 + 底部胶囊工具栏 + 别名 CSS）

**Files:**
- Modify: `src/pdf/NativePdfOverlayManager.ts`（新增字段、`attachPenButton`、`buildToolbar`、`refreshToolbar`、新增 `currentInkColor`）
- Modify: `styles.css`（改写 `.mobile-ink-native-pen-button` 块、改写 `.mobile-ink-native-toolbar`/删除 `.mobile-ink-native-tool`/`.mobile-ink-native-tool-active`、末尾追加别名块）

**Interfaces:**
- Consumes: `InkToolState`（已有 `tool`/`color`/`highlighterColor`/`highlighterWidth`/`width`）；`setIcon`（obsidian 导入，已有）；`NATIVE_PEN_BUTTON_CLS`（已有常量 `"mobile-ink-native-pen-button"`）。
- Produces: 私有方法 `private currentInkColor(): string`；私有字段 `private colorDot: HTMLElement | null = null;`；`buildToolbar` 生成的 dock/group 标记；`.mobile-ink-native-toolbar` 为底部居中定位包装（内含 `.mobile-ink-toolbar-dock`）。`refreshToolbar` 在 `this.toolbar` 上设置 `--mobile-ink-tool-color`，在工具按钮上切换 `mobile-ink-active`。

#### 步骤 1: 修改 `NativePdfOverlayManager.ts` — 新增字段与 `currentInkColor`

在字段声明处（`private toolbarButtons: Record<string, HTMLElement> = {};` 之后，行 ~36）新增：

```ts
  private colorDot: HTMLElement | null = null;
```

在类内任意私有方法处（建议放在 `refreshToolbar` 之前）新增：

```ts
  private currentInkColor(): string {
    return this.toolState.tool === "highlighter" ? this.toolState.highlighterColor : this.toolState.color;
  }
```

#### 步骤 2: 修改 `attachPenButton`（当前行 80-88）

原代码：

```ts
  private attachPenButton(leaf: WorkspaceLeaf): void {
    const button = leaf.view.containerEl.createEl("button", {
      cls: NATIVE_PEN_BUTTON_CLS,
      attr: { "aria-label": "就地手写批注" }
    });
    setIcon(button, "pencil");
    button.addEventListener("click", () => void this.enterDrawMode(leaf));
    this.penButton = button;
  }
```

替换为：

```ts
  private attachPenButton(leaf: WorkspaceLeaf): void {
    const button = leaf.view.containerEl.createEl("button", {
      cls: `${NATIVE_PEN_BUTTON_CLS} mobile-ink-floating-button`,
      attr: { "aria-label": "就地手写批注" }
    });
    button.style.setProperty("--mobile-ink-tool-color", this.currentInkColor());
    setIcon(button, "pencil");
    button.addEventListener("click", () => void this.enterDrawMode(leaf));
    this.penButton = button;
  }
```

#### 步骤 3: 重写 `buildToolbar`（当前行 174-195）

原方法整体替换为（注意每个按钮都用 `setIcon`，类名必须与别名 CSS 匹配）：

```ts
  private buildToolbar(containerEl: HTMLElement): void {
    const bar = containerEl.createDiv({ cls: "mobile-ink-native-toolbar" });
    this.toolbar = bar;
    const dock = bar.createDiv({ cls: "mobile-ink-toolbar-dock" });

    const addToolButton = (key: string, icon: string, label: string, action: () => void, group: HTMLElement): void => {
      const btn = group.createEl("button", {
        cls: "mobile-ink-icon-button mobile-ink-tool-button",
        attr: { "aria-label": label, title: label }
      });
      setIcon(btn, icon);
      btn.addEventListener("click", action);
      this.toolbarButtons[key] = btn;
    };
    const addIconButton = (key: string, icon: string, label: string, action: () => void, group: HTMLElement): void => {
      const btn = group.createEl("button", {
        cls: "mobile-ink-icon-button",
        attr: { "aria-label": label, title: label }
      });
      setIcon(btn, icon);
      btn.addEventListener("click", action);
      this.toolbarButtons[key] = btn;
    };

    const toolGroup = dock.createDiv({ cls: "mobile-ink-toolbar-group" });
    addToolButton("pen", "pencil", "画笔", () => this.applyToolState({ tool: "pen" }), toolGroup);
    addToolButton("highlighter", "highlighter", "记号笔", () => this.applyToolState({ tool: "highlighter" }), toolGroup);
    addToolButton("eraser", "eraser", "橡皮擦", () => this.applyToolState({ tool: "eraser" }), toolGroup);

    const styleGroup = dock.createDiv({ cls: "mobile-ink-toolbar-group" });
    const colorBtn = styleGroup.createEl("button", {
      cls: "mobile-ink-current-color-button",
      attr: { "aria-label": "颜色", title: "颜色" }
    });
    const colorDot = colorBtn.createDiv({ cls: "mobile-ink-current-color-dot" });
    colorBtn.addEventListener("click", () => this.cycleColor());
    this.toolbarButtons.color = colorBtn;
    this.colorDot = colorDot;
    addIconButton("width", "sliders-horizontal", "线条粗细", () => this.cycleWidth(), styleGroup);

    const historyGroup = dock.createDiv({ cls: "mobile-ink-toolbar-group" });
    addIconButton("undo", "undo-2", "撤销", () => {
      for (const e of this.engines) e.engine.undo();
      this.refreshToolbar();
    }, historyGroup);
    addIconButton("redo", "redo-2", "重做", () => {
      for (const e of this.engines) e.engine.redo();
      this.refreshToolbar();
    }, historyGroup);

    const actionGroup = dock.createDiv({ cls: "mobile-ink-toolbar-group" });
    addIconButton("save", "checkmark", "保存", () => void this.flushSave(), actionGroup);
    addIconButton("exit", "x", "退出", () => void this.exitDrawMode(), actionGroup);

    this.refreshToolbar();
  }
```

#### 步骤 4: 重写 `refreshToolbar`（当前行 197-204）

原方法整体替换为：

```ts
  private refreshToolbar(): void {
    if (!this.toolbar) return;
    this.toolbar.style.setProperty("--mobile-ink-tool-color", this.currentInkColor());
    for (const key of ["pen", "highlighter", "eraser"]) {
      const el = this.toolbarButtons[key];
      if (el) el.classList.toggle("mobile-ink-active", this.toolState.tool === key);
    }
    if (this.colorDot) {
      this.colorDot.style.background = this.currentInkColor();
    }
  }
```

`applyToolState`（当前行 206-210）末尾已调用 `this.refreshToolbar()`，无需改动。

#### 步骤 5: 修改 `styles.css` — 改写笔按钮与工具栏，删除旧 tool 规则

**5a.** 将当前 `.mobile-ink-native-pen-button` 块（行 2472-2491，含 `:hover`）整体替换为：

```css
.mobile-ink-native-pen-button {
  position: fixed;
  top: max(14px, env(safe-area-inset-top));
  right: max(14px, env(safe-area-inset-right));
  display: inline-flex;
  z-index: 400;
}
.mobile-ink-native-pen-button:hover {
  filter: brightness(1.05);
}
```

**5b.** 将当前 `.mobile-ink-native-toolbar` + `.mobile-ink-native-tool` + `.mobile-ink-native-tool-active` 三段（行 2511-2540，至文件末尾）整体替换为：

```css
.mobile-ink-native-toolbar {
  position: absolute;
  left: 50%;
  bottom: max(48px, env(safe-area-inset-bottom));
  transform: translateX(-50%);
  max-width: calc(100% - 20px);
  box-sizing: border-box;
  z-index: 360;
  pointer-events: auto;
}
```

**5c.** 在文件末尾追加别名块（保持上面替换后的内容在其后）：

```css

/* Native overlay alias: 原版按钮外观/字形规则被 .mobile-ink-root 作用域限定，
   native 覆盖层与笔按钮复用同一套视觉语言，这里以 native 作用域复刻。 */
.mobile-ink-native-overlay {
  --mobile-ink-shell-border: color-mix(in srgb, var(--interactive-accent) 42%, var(--background-modifier-border));
  --mobile-ink-shell-glow: color-mix(in srgb, var(--interactive-accent) 18%, transparent);
}

.mobile-ink-native-overlay button.mobile-ink-icon-button,
.mobile-ink-native-overlay button.mobile-ink-current-color-button {
  --mobile-ink-icon-foreground: var(--text-muted);
  appearance: none;
  -webkit-appearance: none;
  border-radius: 999px;
  background: var(--background-secondary);
  color: var(--text-muted);
  line-height: 1;
  box-shadow: inset 0 0 0 1px var(--background-modifier-border);
  touch-action: manipulation;
  position: relative;
  box-sizing: border-box;
  min-width: 0;
  min-height: 0;
  border: 0;
  padding: 0;
}

.theme-dark .mobile-ink-native-overlay button.mobile-ink-icon-button,
.theme-dark .mobile-ink-native-overlay button.mobile-ink-current-color-button {
  background: var(--background-primary-alt);
  color: var(--text-muted);
  box-shadow: inset 0 0 0 1px var(--background-modifier-border);
}

.mobile-ink-native-overlay button.mobile-ink-icon-button svg,
.mobile-ink-native-overlay button.mobile-ink-icon-button .svg-icon,
.mobile-ink-native-overlay button.mobile-ink-floating-button svg,
.mobile-ink-native-overlay button.mobile-ink-floating-button .svg-icon,
button.mobile-ink-native-pen-button svg,
button.mobile-ink-native-pen-button .svg-icon {
  display: block;
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  min-width: 18px;
  min-height: 18px;
  color: var(--mobile-ink-icon-foreground, var(--text-muted));
  stroke: var(--mobile-ink-icon-foreground, var(--text-muted));
  fill: none;
  stroke-width: 2.05;
  opacity: 1;
  visibility: visible;
}

/* 悬浮按钮/笔按钮：仅 pin 盒几何与圆角，外观继承原版 floating-button 本体（玻璃+笔色），并恢复笔色图标前景 */
.mobile-ink-native-overlay button.mobile-ink-floating-button,
button.mobile-ink-native-pen-button {
  appearance: none;
  -webkit-appearance: none;
  border-radius: 999px;
  position: relative;
  box-sizing: border-box;
  min-width: 0;
  min-height: 0;
  border: 0;
  padding: 0;
  --mobile-ink-icon-foreground: var(--mobile-ink-tool-color, var(--interactive-accent));
}
```

#### 步骤 6: 构建验证

Run:
```bash
npm run build
```
Expected: 无 TypeScript 错误，esbuild 输出 `main.js`，exit 0。

#### 步骤 7: 回归测试

Run:
```bash
node --experimental-strip-types scripts/test-canvas-budget.mjs
node --experimental-strip-types scripts/test-native-pdf-geometry.mjs
```
Expected: 两者均输出 `OK` / `all ... assertions passed`，exit 0。

#### 步骤 8: 静态自检（grep）

Run:
```bash
node -e "const s=require('fs').readFileSync('styles.css','utf8');const re=/(\.mobile-ink-native-tool-active|\.mobile-ink-native-tool\s*\{)/g;console.log('old native-tool rules:', (s.match(re)||[]).length);console.log('pen-button present:', (s.match(/button\.mobile-ink-native-pen-button/g)||[]).length);console.log('toolbar bottom:', /\.mobile-ink-native-toolbar\s*\{\s*position: absolute;\s*left: 50%;/.test(s))"
```
Expected: `old native-tool rules: 0`（旧 `.mobile-ink-native-tool {` 与 `.mobile-ink-native-tool-active {` 已删），`pen-button present: 2`（本体 + 别名），`toolbar bottom: true`。

#### 步骤 9: 提交

`npm run build` 会重新生成 `main.js`（仓库跟踪的构建产物，惯例随功能一起提交）。

```bash
git add src/pdf/NativePdfOverlayManager.ts styles.css main.js
git commit -m "feat: mimic original floating toolbar for native PDF overlay (top-right pen button + bottom pill toolbar)"
```

---

## 真机手测清单（发布前由用户在平板验证）

- 打开 PDF，右上角出现 40px 玻璃胶囊笔按钮（图标随笔色）。
- 点笔按钮进入绘制模式：底部居中胶囊工具栏出现，笔/荧光笔/橡皮为 34px 圆钮，当前工具呈笔色淡染 + 下划线点；颜色按钮显示当前墨色圆点；分组间有分隔线。
- 切换工具/颜色/线宽，观察激活态与色点同步；撤销/重做生效。
- 保存/退出后回到原生 PDF 视图，重开验证笔迹保留。
- 右上角笔按钮不与 Obsidian 顶栏/返回键冲突（若遮挡，调整 safe-area 偏移或 z-index）。
- 窄屏（手机竖屏）工具栏横向可滚动、不遮挡页面关键内容。
