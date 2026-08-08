# 悬浮颜色/粗细选择面板重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将原生 PDF 覆盖层的颜色/粗细选择器重设计为成熟移动端交互：锚点毛玻璃卡片、颜色主色+渐变展开、粗细整数滑杆+数值显示+预设。

**Architecture:** 全部改动集中在 `NativePdfOverlayManager.ts`（两个悬浮面板方法 `openColorSwatch`/`openWidthSwatch` 重写 + 新增色板常量/渐变数据）与 `styles.css`（面板毛玻璃与渐变/滑杆样式）。复用 v1.2.8 已有的 `swatchEl`/`closeSwatch`/`positionSwatch`/`registerSwatchOutsideClose` 基础设施。

**Tech Stack:** TypeScript、Obsidian API、原生 `input[type=range]`/`input[type=color]`、CSS `backdrop-filter`。

## Global Constraints

- 遵守 spec：`docs/superpowers/specs/2026-08-08-native-overlay-swatch-redesign-design.md`。
- 改动文件：`src/pdf/NativePdfOverlayManager.ts`、`styles.css`。
- 不改变笔画数据/保存格式；不新增设置项。
- 仓库惯例：功能提交英文前缀；`main.js`（tracked 构建产物）单独提交，消息 `构建: 提交…重建后的 main.js（仓库惯例）`。
- 构建：`npm run build`（tsc + esbuild）必须 exit 0。
- 回归：`node scripts/test-canvas-budget.mjs`（24 断言）、`node scripts/test-native-pdf-geometry.mjs`（26 断言）必须全绿。
- PowerShell 陷阱：git stderr 使 `if ($?)` 判失败；用 `Write-Output "exit=$LASTEXITCODE"`，`$LASTEXITCODE -eq 0` 才是成功。
- 完成后按用户约定直接发布 `v1.2.9-beta`。

---

### Task 1: 颜色悬浮面板——主色 + 渐变展开 + 自定义

**Files:**
- Modify: `src/pdf/NativePdfOverlayManager.ts`（field 附近加色板常量；重写 `openColorSwatch`；`cycleColor` 已无用可删除）
- Modify: `styles.css`（面板毛玻璃 + 颜色渐变样式）
- Test: `npm run build` + 两个回归脚本

**Interfaces:**
- Consumes: 现有 `applyToolState(patch)`（`Object.assign(this.toolState, patch)` + 全部引擎 `setToolState` + `refreshToolbar`）、`closeSwatch()`、`positionSwatch(panel, anchor)`、`registerSwatchOutsideClose(panel)`、`this.overlay`、`this.swatchEl`、`this.toolState.tool`/`.color`/`.highlighterColor`。
- Produces: 重写后的 `openColorSwatch(anchor: HTMLElement): void`（Task 2 与按钮点击共用）；新增模块级常量 `COLOR_PRIMARIES: string[]` 与 `COLOR_SHADES: Record<string, string[]>`（Task 2 不依赖，但保持同一文件顶部）。

- [ ] **Step 1: 在文件顶部（const SETTLE_MS 之后）加色板常量**

在 `const SETTLE_MS = 200;` 之后插入：

```ts
const COLOR_PRIMARIES = ["#111111", "#e53935", "#1e88e5", "#43a047", "#ffb300", "#8e24aa", "#ffffff"];

const COLOR_SHADES: Record<string, string[]> = {
  "#111111": ["#eeeeee", "#cccccc", "#888888", "#444444", "#111111"],
  "#e53935": ["#ffcdd2", "#ef9a9a", "#e57373", "#ef5350", "#e53935"],
  "#1e88e5": ["#bbdefb", "#90caf9", "#64b5f6", "#42a5f5", "#1e88e5"],
  "#43a047": ["#c8e6c9", "#a5d6a7", "#81c784", "#66bb6a", "#43a047"],
  "#ffb300": ["#ffe082", "#ffd54f", "#ffca28", "#ffc107", "#ffb300"],
  "#8e24aa": ["#e1bee7", "#ce93d8", "#ba68c8", "#ab47bc", "#8e24aa"],
  "#ffffff": ["#ffffff", "#f5f5f5", "#eeeeee", "#e0e0e0", "#bdbdbd"]
};
```

- [ ] **Step 2: 删除已无用的 `cycleColor` 方法**

删除 `NativePdfOverlayManager.ts:421-427` 的 `cycleColor()` 方法（颜色按钮已改为打开面板，不再循环切换）。

- [ ] **Step 3: 重写 `openColorSwatch` 方法**

把 `NativePdfOverlayManager.ts:437-476` 的整体 `openColorSwatch` 方法替换为：

```ts
  private openColorSwatch(anchor: HTMLElement): void {
    this.closeSwatch();
    if (!this.overlay) return;
    const panel = this.overlay.createDiv({ cls: "mobile-ink-swatch-panel" });
    const isHighlighter = this.toolState.tool === "highlighter";
    const current = isHighlighter ? this.toolState.highlighterColor : this.toolState.color;

    const titleRow = panel.createDiv({ cls: "mobile-ink-swatch-title-row" });
    titleRow.createDiv({ cls: "mobile-ink-swatch-title", text: isHighlighter ? "记号笔颜色" : "颜色" });
    const currentDot = titleRow.createDiv({ cls: "mobile-ink-swatch-current-dot" });
    currentDot.style.background = current;

    const apply = (color: string): void => {
      if (isHighlighter) this.applyToolState({ highlighterColor: color });
      else this.applyToolState({ color });
      this.closeSwatch();
    };

    let selectedPrimary = COLOR_PRIMARIES.find((p) => (COLOR_SHADES[p] ?? []).includes(current)) ?? "#111111";

    const primaryRow = panel.createDiv({ cls: "mobile-ink-swatch-primary-row" });
    for (const color of COLOR_PRIMARIES) {
      const sw = primaryRow.createEl("button", { cls: "mobile-ink-swatch-cell", attr: { "aria-label": color } });
      sw.style.background = color;
      if (color === selectedPrimary) sw.classList.add("is-active");
      sw.addEventListener("click", () => {
        selectedPrimary = color;
        this.renderShades(shadesEl, color, current, apply);
        primaryRow.querySelectorAll(".mobile-ink-swatch-cell.is-active").forEach((el) => el.classList.remove("is-active"));
        sw.classList.add("is-active");
      });
    }

    const shadesEl = panel.createDiv({ cls: "mobile-ink-swatch-shades" });
    this.renderShades(shadesEl, selectedPrimary, current, apply);

    const customRow = panel.createDiv({ cls: "mobile-ink-swatch-custom" });
    const customInput = customRow.createEl("input", {
      type: "color",
      value: current.startsWith("#") && current.length === 7 ? current : "#111111"
    });
    const applyBtn = customRow.createEl("button", { cls: "mobile-ink-swatch-apply", text: "应用" });
    applyBtn.addEventListener("click", () => apply(customInput.value));

    this.swatchEl = panel;
    panel.addEventListener("click", (e) => e.stopPropagation());
    this.positionSwatch(panel, anchor);
    this.registerSwatchOutsideClose(panel);
  }

  private renderShades(container: HTMLElement, primary: string, current: string, apply: (c: string) => void): void {
    container.empty();
    const shades = COLOR_SHADES[primary] ?? COLOR_SHADES["#111111"];
    for (const color of shades) {
      const sw = container.createEl("button", { cls: "mobile-ink-swatch-cell mobile-ink-swatch-shade-cell", attr: { "aria-label": color } });
      sw.style.background = color;
      if (color === current) sw.classList.add("is-active");
      sw.addEventListener("click", () => apply(color));
    }
  }
```

- [ ] **Step 4: 更新 `styles.css` 颜色面板样式**

把 `styles.css` 现有的 `.mobile-ink-swatch-panel`、`.mobile-ink-swatch-title`、`.mobile-ink-swatch-grid` 规则替换/补充为毛玻璃 + 颜色面板新结构。找到 `.mobile-ink-swatch-panel {` 块，把 `.mobile-ink-swatch-panel`、`.mobile-ink-swatch-title` 替换为：

```css
.mobile-ink-swatch-panel {
  position: fixed;
  z-index: 380;
  min-width: 200px;
  max-width: calc(100% - 16px);
  padding: 12px;
  border-radius: 16px;
  background: color-mix(in srgb, var(--background-primary) 78%, transparent);
  -webkit-backdrop-filter: blur(20px) saturate(140%);
  backdrop-filter: blur(20px) saturate(140%);
  border: 1px solid color-mix(in srgb, var(--background-modifier-border) 80%, transparent);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  pointer-events: auto;
  box-sizing: border-box;
}

.mobile-ink-swatch-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.mobile-ink-swatch-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
}

.mobile-ink-swatch-current-dot {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid var(--background-modifier-border);
}

.mobile-ink-swatch-primary-row {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}

.mobile-ink-swatch-cell {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 10px;
  border: 2px solid var(--background-modifier-border);
  cursor: pointer;
  padding: 0;
}

.mobile-ink-swatch-cell.is-active {
  border-color: var(--interactive-accent);
  outline: 2px solid color-mix(in srgb, var(--interactive-accent) 40%, transparent);
  outline-offset: 1px;
}

.mobile-ink-swatch-primary-row .mobile-ink-swatch-cell {
  flex: 1;
  max-width: 40px;
}

.mobile-ink-swatch-shades {
  display: flex;
  gap: 8px;
  padding: 8px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--background-secondary) 55%, transparent);
  margin-bottom: 10px;
}

.mobile-ink-swatch-shade-cell {
  flex: 1;
  max-width: 40px;
}
```

保留现有 `.mobile-ink-swatch-custom`、`.mobile-ink-swatch-custom input[type="color"]`、`.mobile-ink-swatch-apply` 规则（结构不变）。

- [ ] **Step 5: 构建验证**

Run: `npm run build`
Expected: exit 0（tsc 无错、esbuild 成功产出 main.js）。

- [ ] **Step 6: 回归验证**

Run: `node scripts/test-canvas-budget.mjs`
Expected: `checked 24 assertions` + `OK: all canvas budget assertions passed`，exit 0。

Run: `node scripts/test-native-pdf-geometry.mjs`
Expected: `OK: all native-pdf-geometry assertions passed`，exit 0。

- [ ] **Step 7: 自检 diff**

Run: `git diff --stat`
Expected: 仅 `src/pdf/NativePdfOverlayManager.ts`、`styles.css` 变化。

Run: `Select-String -Path src/pdf/NativePdfOverlayManager.ts -Pattern "cycleColor|COLOR_PRIMARIES|renderShades|openColorSwatch"`
Expected: 无 `cycleColor` 匹配；有 `COLOR_PRIMARIES`、`renderShades`、`openColorSwatch`。

- [ ] **Step 8: 提交**

```bash
git add src/pdf/NativePdfOverlayManager.ts styles.css
git commit -m "feat: redesign color swatch to primary row with gradient shades and custom color"
```

然后单独提交 main.js：
```bash
git add main.js
git commit -m "构建: 提交颜色悬浮面板重建后的 main.js（仓库惯例）"
```

---

### Task 2: 粗细悬浮面板——整数滑杆 + 数值显示 + 预设

**Files:**
- Modify: `src/pdf/NativePdfOverlayManager.ts`（重写 `openWidthSwatch`；`cycleWidth` 已无用可删除）
- Modify: `styles.css`（滑杆/预设样式）
- Test: `npm run build` + 两个回归脚本

**Interfaces:**
- Consumes: Task 1 的 `applyToolState`、`closeSwatch`、`positionSwatch`、`registerSwatchOutsideClose`、`this.overlay`、`this.swatchEl`、`this.toolState.tool`/`.width`/`.highlighterWidth`。
- Produces: 重写后的 `openWidthSwatch(): void`（`buildToolbar` 中滑杆按钮点击调用）。

- [ ] **Step 1: 删除已无用的 `cycleWidth` 方法**

删除 `NativePdfOverlayManager.ts:429-435` 的 `cycleWidth()` 方法（粗细按钮已改为打开面板）。

- [ ] **Step 2: 重写 `openWidthSwatch` 方法**

把 `NativePdfOverlayManager.ts:478-507` 的整体 `openWidthSwatch` 方法替换为：

```ts
  private openWidthSwatch(): void {
    this.closeSwatch();
    if (!this.overlay) return;
    const anchor = this.toolbarButtons.width;
    const panel = this.overlay.createDiv({ cls: "mobile-ink-swatch-panel" });
    const isHighlighter = this.toolState.tool === "highlighter";
    const current = isHighlighter ? this.toolState.highlighterWidth : this.toolState.width;

    const titleRow = panel.createDiv({ cls: "mobile-ink-swatch-title-row" });
    titleRow.createDiv({ cls: "mobile-ink-swatch-title", text: isHighlighter ? "记号笔粗细" : "线条粗细" });
    const valueEl = titleRow.createDiv({ cls: "mobile-ink-width-value", text: `${current}` });

    const apply = (w: number): void => {
      if (isHighlighter) this.applyToolState({ highlighterWidth: w });
      else this.applyToolState({ width: w });
    };

    const target = document.createElement("input");
    target.type = "range";
    target.min = "1";
    target.max = "12";
    target.step = "1";
    target.value = String(Math.max(1, Math.min(12, Math.round(current))));
    target.className = "mobile-ink-width-slider";
    target.addEventListener("input", () => {
      const w = Math.max(1, Math.min(12, Math.round(Number(target.value))));
      valueEl.textContent = `${w}`;
      apply(w);
    });
    panel.appendChild(target);

    const preview = panel.createDiv({ cls: "mobile-ink-width-preview-line" });
    preview.style.height = `${Math.max(1, Math.round(current))}px`;

    const presets = panel.createDiv({ cls: "mobile-ink-width-presets" });
    for (const w of [2, 3, 5, 8]) {
      const btn = presets.createEl("button", { cls: "mobile-ink-width-preset", attr: { "aria-label": `${w}` } });
      const line = btn.createDiv({ cls: "mobile-ink-width-preview" });
      line.style.height = `${w}px`;
      btn.createDiv({ cls: "mobile-ink-width-label", text: `${w}` });
      if (Math.round(current) === w) btn.classList.add("is-active");
      btn.addEventListener("click", () => {
        target.value = String(w);
        valueEl.textContent = `${w}`;
        preview.style.height = `${w}px`;
        presets.querySelectorAll(".mobile-ink-width-preset.is-active").forEach((el) => el.classList.remove("is-active"));
        btn.classList.add("is-active");
        apply(w);
      });
    }

    target.addEventListener("input", () => {
      presets.querySelectorAll(".mobile-ink-width-preset.is-active").forEach((el) => el.classList.remove("is-active"));
    });

    this.swatchEl = panel;
    panel.addEventListener("click", (e) => e.stopPropagation());
    if (anchor) this.positionSwatch(panel, anchor);
    this.registerSwatchOutsideClose(panel);
  }
```

- [ ] **Step 3: 更新 `styles.css` 粗细面板样式**

把 `styles.css` 现有的 `.mobile-ink-width-list`、`.mobile-ink-width-row`、`.mobile-ink-width-preview`、`.mobile-ink-width-label` 规则替换为滑杆 + 预设样式：

```css
.mobile-ink-width-value {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-normal);
  font-variant-numeric: tabular-nums;
}

.mobile-ink-width-slider {
  width: 100%;
  margin: 4px 0 8px;
  accent-color: var(--interactive-accent);
}

.mobile-ink-width-preview-line {
  width: 100%;
  border-radius: 3px;
  background: var(--text-normal);
  margin-bottom: 10px;
}

.mobile-ink-width-presets {
  display: flex;
  gap: 8px;
}

.mobile-ink-width-preset {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px 4px;
  border-radius: 10px;
  border: 1px solid var(--background-modifier-border);
  background: transparent;
  cursor: pointer;
}

.mobile-ink-width-preset.is-active {
  border-color: var(--interactive-accent);
  background: color-mix(in srgb, var(--interactive-accent) 12%, transparent);
}

.mobile-ink-width-preview {
  width: 36px;
  border-radius: 3px;
  background: var(--text-normal);
}

.mobile-ink-width-label {
  font-size: 13px;
  color: var(--text-normal);
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 4: 构建验证**

Run: `npm run build`
Expected: exit 0。

- [ ] **Step 5: 回归验证**

Run: `node scripts/test-canvas-budget.mjs`
Expected: 24 断言 + OK，exit 0。

Run: `node scripts/test-native-pdf-geometry.mjs`
Expected: OK，exit 0。

- [ ] **Step 6: 自检 diff**

Run: `git diff --stat`
Expected: 仅 `src/pdf/NativePdfOverlayManager.ts`、`styles.css` 变化。

Run: `Select-String -Path src/pdf/NativePdfOverlayManager.ts -Pattern "cycleWidth|mobile-ink-width-slider|mobile-ink-width-presets|openWidthSwatch"`
Expected: 无 `cycleWidth` 匹配；有 `mobile-ink-width-slider`、`mobile-ink-width-presets`、`openWidthSwatch`。

- [ ] **Step 7: 提交**

```bash
git add src/pdf/NativePdfOverlayManager.ts styles.css
git commit -m "feat: redesign width swatch with integer slider, live value, and presets"
```

然后单独提交 main.js：
```bash
git add main.js
git commit -m "构建: 提交粗细悬浮面板重建后的 main.js（仓库惯例）"
```

---

### Task 3: 终局 whole-branch review + 发布

- [ ] 用 code-reviewer（`requesting-code-review`）对基线 `fac99ed`（release v1.2.6，含坐标修复）至 HEAD 做 whole-branch review；修复发现的问题并重验 `npm run build` + 两个回归脚本。
- [ ] 按用户约定直接发布 `v1.2.9-beta`：bump `package.json`+`manifest.json` → `npm run build` → commit `release: bump version to 1.2.9` → push main → 本地 tag `v1.2.9-beta` 并 push → write 工具写 UTF-8 body → `gh release create ... --notes-file`（prerelease）→ `gh release upload` 上传 main.js/manifest.json/styles.css → `gh api --template` 校验尺寸与本地一致。
- [ ] 交付真机验证清单（见 spec §7，重点：主色渐变展开、自定义取色、滑杆数值实时变化、预设高亮、画笔/记号笔独立记忆、点击外部关闭）。