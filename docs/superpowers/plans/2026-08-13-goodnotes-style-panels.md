# GoodNotes 风格面板 + 按钮状态 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将颜色/粗细弹出面板改为 GoodNotes 风格视觉，补全工具栏按钮选中/按下态，修复粗细滑块手势泄漏。

**Architecture:** 按已确认 spec `docs/superpowers/specs/2026-08-13-goodnotes-style-panels-design.md` 方案：1) 颜色面板改为 18 色圆形网格 + 底部取色器，点色即应用、面板保持打开；2) 粗细面板改为大滑块 + 圆形预设按钮 + pt 数值，加 `touch-action: pan-y` 修复侧边栏手势泄漏；3) 补全 `.mobile-ink-native-overlay` 作用域下按钮的 hover/active/selected 状态，面板打开时给锚点按钮加 active 态。

**Tech Stack:** TypeScript、Obsidian API、原生 CSS（无框架）、`OverlayToolbar`（现有共享层）。

## Global Constraints

- 遵守 spec：`docs/superpowers/specs/2026-08-13-goodnotes-style-panels-design.md`（状态「已确认」）。
- `AnnotationFile` 数据格式不变；`AnnotationView.ts` 不改动。
- 本次不加不透明度功能（InkEngine 无全局 alpha，留待后续）。
- 颜色 18 色：黑/深灰/中灰/浅灰/银灰/白、红/橙/黄/亮黄/绿/青、蓝/深蓝/紫/粉/棕/浅棕（色值见 spec §1）。
- 粗细预设从 [2,3,5,8] 扩展为 [1,3,5,8,12]（5 个，WIDTH_PRESETS 同步更新）。
- 回归脚本必须全绿：`node scripts/test-canvas-budget.mjs`（预存 1 失败忽略）、`node scripts/test-native-pdf-geometry.mjs`、`node scripts/test-markdown-overlay-geometry.mjs`、`node scripts/test-gesture-axis.mjs`、`node scripts/test-smoothing.mjs`。
- `npm run build`（`tsc -noEmit -skipLibCheck` + `node esbuild.config.mjs production`）必须 exit 0。
- 仓库惯例：feature 提交英文前缀；`main.js` 单独提交，消息 `构建: 提交…重建后的 main.js（仓库惯例）`。
- PowerShell 陷阱：git stderr 使 `if ($?)` 判失败；用 `Write-Output "exit=$LASTEXITCODE"`，`$LASTEXITCODE -eq 0` 才是成功；禁止 `&&`。
- 基线 commit = `cee92e8`（上一版 release v1.4.6-beta 之后的设计文档提交之前的最后代码提交——即 v1.4.6-beta 的代码 + 底部铅笔启动器功能）。实际基线：`29aaf31`（设计文档提交，代码未变）。

---

### Task 1: 原生覆盖层按钮选中/按下/悬停态补全

**Files:**
- Modify: `styles.css`（在 `.mobile-ink-native-overlay` 作用域追加按钮状态样式）

**Interfaces:**
- Consumes: 现有 `.mobile-ink-root` 作用域的按钮状态样式作为参考（styles.css:155-291）。
- Produces: `.mobile-ink-native-overlay` 作用域下的完整按钮交互态，供所有 Task 使用。

- [ ] **Step 1: 在 native-overlay 区段追加按钮状态样式**

定位到 `styles.css:2726`（SVG 图标规则之后，`/* Reactive overlay */` 注释之前），追加以下样式块：

```css
/* Native overlay: button interactive states (match .mobile-ink-root patterns) */
.mobile-ink-native-overlay button.mobile-ink-icon-button:hover {
  background: var(--background-modifier-hover);
  color: var(--text-normal);
  --mobile-ink-icon-foreground: var(--text-normal);
}

.mobile-ink-native-overlay button.mobile-ink-icon-button:active {
  transform: scale(0.94);
}

.mobile-ink-native-overlay button.mobile-ink-icon-button:disabled {
  opacity: 0.4;
  pointer-events: none;
}

.mobile-ink-native-overlay button.mobile-ink-icon-button.mobile-ink-active {
  background: var(--interactive-accent);
  color: var(--text-on-accent);
  --mobile-ink-icon-foreground: var(--text-on-accent);
  box-shadow: 0 4px 12px color-mix(in srgb, var(--interactive-accent) 25%, transparent);
}

.mobile-ink-native-overlay button.mobile-ink-tool-button.mobile-ink-active {
  background: color-mix(in srgb, var(--mobile-ink-tool-color) 14%, var(--background-secondary));
  color: var(--mobile-ink-tool-color);
  --mobile-ink-icon-foreground: var(--mobile-ink-tool-color);
  position: relative;
}

.mobile-ink-native-overlay button.mobile-ink-tool-button.mobile-ink-active::after {
  content: "";
  position: absolute;
  bottom: -2px;
  left: 50%;
  transform: translateX(-50%);
  width: 16px;
  height: 2px;
  border-radius: 2px;
  background: var(--mobile-ink-tool-color);
}

.mobile-ink-native-overlay button.mobile-ink-current-color-button.mobile-ink-active {
  background: var(--background-modifier-hover);
  box-shadow: inset 0 0 0 2px var(--interactive-accent);
}

.theme-dark .mobile-ink-native-overlay button.mobile-ink-icon-button:hover {
  background: var(--background-modifier-hover);
}

.theme-dark .mobile-ink-native-overlay button.mobile-ink-icon-button.mobile-ink-active {
  background: var(--interactive-accent);
}

.theme-dark .mobile-ink-native-overlay button.mobile-ink-tool-button.mobile-ink-active {
  background: color-mix(in srgb, var(--mobile-ink-tool-color) 14%, var(--background-primary-alt));
}
```

（注：尺寸/圆角/基础背景由 2686 行的基础样式提供；这里只补交互态。）

- [ ] **Step 2: 提交**

```bash
git add styles.css
git commit -m "feat(styles): add hover/active/pressed button states for native overlay"
```

---

### Task 2: 面板手势隔离（修复侧边栏泄漏）+ 面板打开态按钮高亮

**Files:**
- Modify: `styles.css`（`.mobile-ink-swatch-panel` 加 touch-action）
- Modify: `src/overlay/shared/OverlayToolbar.ts`（openColorSwatch / openWidthSwatch / closeSwatch 里给锚点按钮切 active 态）

**Interfaces:**
- Consumes: Task 1 按钮 active 态样式；现有 color 按钮（`.mobile-ink-current-color-button`）、width 按钮（`buttons.width`）。
- Produces: 面板打开时锚点按钮高亮；滑块横向拖动不再泄漏到 Obsidian 侧边栏。

- [ ] **Step 1: CSS touch-action**

在 `.mobile-ink-swatch-panel` 规则（styles.css 约 2508-2522 行）中追加一行：

```css
  touch-action: pan-y;
```

（确保整个面板只允许垂直手势穿透，水平手势面板内消费。）

- [ ] **Step 2: openColorSwatch 给颜色按钮加 active**

在 `openColorSwatch(anchor: HTMLElement)` 方法开头追加：

```ts
anchor.classList.add("mobile-ink-active");
```

- [ ] **Step 3: openWidthSwatch 给宽度按钮加 active**

在 `openWidthSwatch()` 方法开头追加：

```ts
const widthBtn = this.buttonsMap.width;
if (widthBtn) widthBtn.classList.add("mobile-ink-active");
```

（注意：`getWidthAnchor` 返回的是按钮元素，和 `buttonsMap.width` 是同一个。）

- [ ] **Step 4: closeSwatch 移除 active**

在 `closeSwatch()` 方法开头追加：

```ts
const colorBtn = this.buttonsMap.color;
const widthBtn = this.buttonsMap.width;
if (colorBtn) colorBtn.classList.remove("mobile-ink-active");
if (widthBtn) widthBtn.classList.remove("mobile-ink-active");
```

- [ ] **Step 5: 类型检查**

Run: `npx tsc -noEmit -skipLibCheck`
Expected: exit 0。

- [ ] **Step 6: 提交**

```bash
git add styles.css src/overlay/shared/OverlayToolbar.ts
git commit -m "feat(overlay): panel touch-action containment + anchor button active when swatch open"
```

---

### Task 3: 颜色面板重写为 GoodNotes 风格 18 色网格

**Files:**
- Modify: `src/overlay/shared/OverlayToolbar.ts`（`openColorSwatch` 全部重写，`COLOR_PRIMARIES`/`COLOR_SHADES` 保留供其他用途）
- Modify: `styles.css`（GoodNotes 风格色板样式：`.mobile-ink-swatch-*` 相关全部替换/新增）
- Modify: `src/overlay/shared/OverlayToolkit.ts`（可选：加 18 色常量数组 `COLOR_PALETTE_GOODNOTES`，或直接在 OverlayToolbar 里写死数组——推荐放 Toolkit 里）

**Interfaces:**
- Consumes: Task 2 的 closeSwatch / touch-action。
- Produces: GoodNotes 风格颜色面板（18 色圆形网格 + 底部取色器），点色即应用、面板保持打开。

- [ ] **Step 1: 在 OverlayToolkit.ts 新增 18 色常量**

在 `OverlayToolkit.ts` 中 `COLOR_SHADES` 之后追加：

```ts
export const GN_COLOR_PALETTE = [
  "#111111", "#333333", "#666666", "#999999", "#cccccc", "#ffffff",
  "#e53935", "#ff7043", "#ffb300", "#fdd835", "#43a047", "#00acc1",
  "#1e88e5", "#3949ab", "#8e24aa", "#ec407a", "#6d4c41", "#d7ccc8"
];
```

（6 列 × 3 行，顺序与 spec 一致。）

- [ ] **Step 2: 重写 OverlayToolbar.openColorSwatch**

将 `openColorSwatch(anchor: HTMLElement)` 方法整体替换为：

```ts
private openColorSwatch(anchor: HTMLElement): void {
  this.closeSwatch();
  const overlay = this.host.getOverlay();
  if (!overlay) return;
  const state = this.host.getToolState();
  const current = state.tool === "highlighter" ? state.highlighterColor : state.color;

  anchor.classList.add("mobile-ink-active");

  const panel = overlay.createDiv({ cls: "mobile-ink-swatch-panel" });
  const titleRow = panel.createDiv({ cls: "mobile-ink-swatch-title-row" });
  titleRow.createDiv({ cls: "mobile-ink-swatch-title", text: "颜色" });

  const grid = panel.createDiv({ cls: "mobile-ink-swatch-gn-grid" });
  for (const color of COLOR_PRIMARIES) { // <- 改 import，用 GN_COLOR_PALETTE
    const sw = grid.createEl("button", {
      cls: "mobile-ink-swatch-gn-cell",
      attr: { "aria-label": color }
    });
    sw.style.background = color;
    if (color.toLowerCase() === current.toLowerCase()) {
      sw.classList.add("is-active");
    }
    sw.addEventListener("click", () => {
      if (state.tool === "highlighter") this.host.applyToolState({ highlighterColor: color });
      else this.host.applyToolState({ color });
      grid.querySelectorAll(".mobile-ink-swatch-gn-cell.is-active").forEach((el) => el.classList.remove("is-active"));
      sw.classList.add("is-active");
      this.refresh();
    });
  }

  const divider = panel.createDiv({ cls: "mobile-ink-swatch-gn-divider" });

  const customRow = panel.createDiv({ cls: "mobile-ink-swatch-gn-custom-row" });
  const customBtn = customRow.createEl("button", {
    cls: "mobile-ink-swatch-gn-custom-btn",
    attr: { "aria-label": "自定义颜色" }
  });
  const customInput = customRow.createEl("input", {
    type: "color",
    attr: { value: current.startsWith("#") && current.length === 7 ? current : "#111111" }
  });
  customInput.style.display = "none";
  customBtn.addEventListener("click", () => customInput.click());
  customInput.addEventListener("input", () => {
    const val = customInput.value;
    if (state.tool === "highlighter") this.host.applyToolState({ highlighterColor: val });
    else this.host.applyToolState({ color: val });
    grid.querySelectorAll(".mobile-ink-swatch-gn-cell.is-active").forEach((el) => el.classList.remove("is-active"));
    customBtn.style.background = val;
    this.refresh();
  });

  this.swatchEl = panel;
  panel.addEventListener("click", (e) => e.stopPropagation());
  this.positionSwatch(panel, anchor);
  this.registerSwatchOutsideClose(panel);
}
```

注意：从 `OverlayToolkit` import `GN_COLOR_PALETTE`（替换对 `COLOR_PRIMARIES`/`COLOR_SHADES` 的依赖——`renderShades` 方法不再需要，但方法保留不删，以免其他地方用）。

- [ ] **Step 3: CSS GoodNotes 风格色板**

在 styles.css 中 `mobile-ink-swatch-*` 老规则块的位置（约 2508-2611 行），**在老规则之后**追加新的 GoodNotes 风格规则（老规则保留不删，因为可能还有其他地方用；新 class 以 `mobile-ink-swatch-gn-` 前缀区分）：

```css
/* GoodNotes-style color swatch */
.mobile-ink-swatch-panel {
  width: 260px;
  padding: 14px 12px 12px;
  border-radius: 18px;
  background: var(--background-primary);
  border: 1px solid var(--background-modifier-border);
  box-shadow: 0 12px 32px rgba(0,0,0,0.25), 0 0 0 0.5px rgba(255,255,255,0.02) inset;
}

@supports (background: color-mix(in srgb, red 50%, transparent)) {
  .mobile-ink-swatch-panel {
    background: color-mix(in srgb, var(--background-primary) 92%, transparent);
    backdrop-filter: blur(22px) saturate(1.4);
    -webkit-backdrop-filter: blur(22px) saturate(1.4);
  }
}

.theme-dark .mobile-ink-swatch-panel {
  background: var(--background-secondary);
}

@supports (background: color-mix(in srgb, red 50%, transparent)) {
  .theme-dark .mobile-ink-swatch-panel {
    background: color-mix(in srgb, var(--background-secondary) 88%, transparent);
  }
}

.mobile-ink-swatch-title-row {
  margin-bottom: 10px;
  padding: 0 2px;
}

.mobile-ink-swatch-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-normal);
}

.mobile-ink-swatch-gn-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 10px;
  margin-bottom: 12px;
}

.mobile-ink-swatch-gn-cell {
  aspect-ratio: 1 / 1;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  padding: 0;
  outline: none;
  transition: transform 0.12s ease, border-color 0.12s ease;
}

.mobile-ink-swatch-gn-cell:hover {
  transform: scale(1.08);
}

.mobile-ink-swatch-gn-cell:active {
  transform: scale(0.92);
}

.mobile-ink-swatch-gn-cell.is-active {
  border-color: var(--text-normal);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--text-normal) 25%, transparent);
}

.mobile-ink-swatch-gn-divider {
  height: 1px;
  background: var(--background-modifier-border);
  margin: 4px 2px 10px;
}

.mobile-ink-swatch-gn-custom-row {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2px 0;
}

.mobile-ink-swatch-gn-custom-btn {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 2px solid var(--background-modifier-border);
  background: conic-gradient(#ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000);
  cursor: pointer;
  padding: 0;
  position: relative;
}

.mobile-ink-swatch-gn-custom-btn::after {
  content: "";
  position: absolute;
  inset: 4px;
  border-radius: 50%;
  background: var(--background-primary);
  border: 1.5px solid var(--background-modifier-border);
}

.mobile-ink-swatch-gn-custom-btn:hover { transform: scale(1.08); }
.mobile-ink-swatch-gn-custom-btn:active { transform: scale(0.92); }
```

（注意：面板原来的 touch-action: pan-y 由 Task 2 已加在 `.mobile-ink-swatch-panel` 上，新面板继承。）

- [ ] **Step 4: 类型检查 + 构建验证**

Run: `npm run build`
Expected: exit 0。

- [ ] **Step 5: 提交**

```bash
git add src/overlay/shared/OverlayToolbar.ts src/overlay/shared/OverlayToolkit.ts styles.css
git commit -m "feat(overlay): rewrite color swatch in GoodNotes style (18-color grid + custom picker)"
```

---

### Task 4: 粗细面板重写为 GoodNotes 风格 + 5 预设

**Files:**
- Modify: `src/overlay/shared/OverlayToolbar.ts`（`openWidthSwatch` 重写）
- Modify: `src/overlay/shared/OverlayToolkit.ts`（`WIDTH_PRESETS` 从 [2,3,5,8] 改为 [1,3,5,8,12]）
- Modify: `styles.css`（GoodNotes 风格粗细面板样式：`.mobile-ink-swatch-width-gn-*` 系列）

**Interfaces:**
- Consumes: Task 2 的 touch-action + active 态；Task 3 的面板基础样式模式。
- Produces: GoodNotes 风格粗细面板（标题+pt 数值、大滑块、分隔线、5 个圆形预设按钮），预设从 4 个扩展为 5 个。

- [ ] **Step 1: 更新 WIDTH_PRESETS**

在 `OverlayToolkit.ts` 中将：

```ts
export const WIDTH_PRESETS = [2, 3, 5, 8];
```

改为：

```ts
export const WIDTH_PRESETS = [1, 3, 5, 8, 12];
```

- [ ] **Step 2: 重写 openWidthSwatch**

将 `openWidthSwatch()` 方法整体替换为：

```ts
private openWidthSwatch(): void {
  this.closeSwatch();
  const overlay = this.host.getOverlay();
  if (!overlay) return;
  const state = this.host.getToolState();
  const isHighlighter = state.tool === "highlighter";
  const current = isHighlighter ? state.highlighterWidth : state.width;

  const anchor = this.host.getWidthAnchor();
  if (anchor) anchor.classList.add("mobile-ink-active");

  const panel = overlay.createDiv({ cls: "mobile-ink-swatch-panel" });

  const titleRow = panel.createDiv({ cls: "mobile-ink-swatch-title-row" });
  titleRow.createDiv({ cls: "mobile-ink-swatch-title", text: "线条粗细" });
  const valueEl = titleRow.createDiv({ cls: "mobile-ink-swatch-gn-width-value", text: `${current} pt` });

  const sliderWrap = panel.createDiv({ cls: "mobile-ink-swatch-gn-slider-wrap" });
  const track = sliderWrap.createDiv({ cls: "mobile-ink-swatch-gn-slider-track" });
  const fill = track.createDiv({ cls: "mobile-ink-swatch-gn-slider-fill" });
  const thumb = track.createDiv({ cls: "mobile-ink-swatch-gn-slider-thumb" });

  const divider = panel.createDiv({ cls: "mobile-ink-swatch-gn-divider" });

  const presetRow = panel.createDiv({ cls: "mobile-ink-swatch-gn-preset-row" });
  const apply = (w: number): void => {
    const clamped = Math.max(WIDTH_MIN, Math.min(WIDTH_MAX, Math.round(w)));
    valueEl.textContent = `${clamped} pt`;
    fill.style.width = `${((clamped - WIDTH_MIN) / (WIDTH_MAX - WIDTH_MIN)) * 100}%`;
    thumb.style.left = `${((clamped - WIDTH_MIN) / (WIDTH_MAX - WIDTH_MIN)) * 100}%`;
    previewLine.style.height = `${clamped}px`;
    if (isHighlighter) this.host.applyToolState({ highlighterWidth: clamped });
    else this.host.applyToolState({ width: clamped });
    presetRow.querySelectorAll(".mobile-ink-swatch-gn-preset.is-active").forEach((el) => el.classList.remove("is-active"));
  };

  const previewWrap = panel.createDiv({ cls: "mobile-ink-swatch-gn-preview-row" });
  const previewLine = previewWrap.createDiv({ cls: "mobile-ink-swatch-gn-preview-line" });
  previewLine.style.height = `${current}px`;
  fill.style.width = `${((current - WIDTH_MIN) / (WIDTH_MAX - WIDTH_MIN)) * 100}%`;
  thumb.style.left = `${((current - WIDTH_MIN) / (WIDTH_MAX - WIDTH_MIN)) * 100}%`;

  // 预设按钮
  for (const w of WIDTH_PRESETS) {
    const btn = presetRow.createEl("button", {
      cls: "mobile-ink-swatch-gn-preset",
      attr: { "aria-label": `${w}`, "data-width": `${w}` }
    });
    const line = btn.createDiv({ cls: "mobile-ink-swatch-gn-preset-line" });
    line.style.height = `${Math.max(1, Math.min(10, w))}px`;
    btn.createDiv({ cls: "mobile-ink-swatch-gn-preset-num", text: `${w}` });
    if (Math.round(current) === w) btn.classList.add("is-active");
    btn.addEventListener("click", () => apply(w));
  }

  // 滑块拖动
  let dragging = false;
  const onMove = (clientX: number): void => {
    if (!dragging) return;
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const w = WIDTH_MIN + ratio * (WIDTH_MAX - WIDTH_MIN);
    apply(w);
  };
  thumb.addEventListener("pointerdown", (e) => {
    dragging = true;
    thumb.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  thumb.addEventListener("pointermove", (e) => onMove(e.clientX));
  thumb.addEventListener("pointerup", (e) => {
    dragging = false;
    thumb.releasePointerCapture(e.pointerId);
  });
  // 点轨道跳转
  track.addEventListener("pointerdown", (e) => {
    if (e.target === thumb) return;
    dragging = true;
    thumb.setPointerCapture(e.pointerId);
    onMove(e.clientX);
    e.preventDefault();
  });

  this.swatchEl = panel;
  panel.addEventListener("click", (e) => e.stopPropagation());
  if (anchor) this.positionSwatch(panel, anchor);
  this.registerSwatchOutsideClose(panel);
}
```

- [ ] **Step 3: CSS GoodNotes 风格粗细面板**

在 styles.css 中颜色面板新规则之后，追加粗细面板 GoodNotes 风格规则：

```css
/* GoodNotes-style width swatch */
.mobile-ink-swatch-gn-width-value {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-normal);
  font-variant-numeric: tabular-nums;
}

.mobile-ink-swatch-gn-slider-wrap {
  padding: 8px 4px 12px;
}

.mobile-ink-swatch-gn-slider-track {
  position: relative;
  height: 6px;
  border-radius: 3px;
  background: var(--background-modifier-border);
  touch-action: none;
  cursor: pointer;
}

.mobile-ink-swatch-gn-slider-fill {
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 30%;
  background: linear-gradient(to right, var(--interactive-accent), color-mix(in srgb, var(--interactive-accent) 70%, #ffffff));
  border-radius: 3px;
  pointer-events: none;
}

.mobile-ink-swatch-gn-slider-thumb {
  position: absolute;
  left: 30%;
  top: 50%;
  width: 22px;
  height: 22px;
  background: #fff;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  box-shadow: 0 2px 6px rgba(0,0,0,0.3), 0 0 0 1px rgba(0,0,0,0.05);
  cursor: grab;
  touch-action: none;
}

.mobile-ink-swatch-gn-slider-thumb:active {
  cursor: grabbing;
  transform: translate(-50%, -50%) scale(1.1);
}

.mobile-ink-swatch-gn-preview-row {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px 0 10px;
  height: 24px;
}

.mobile-ink-swatch-gn-preview-line {
  width: 80%;
  border-radius: 2px;
  background: var(--text-muted);
  transition: height 0.05s ease;
}

.mobile-ink-swatch-gn-preset-row {
  display: flex;
  justify-content: space-between;
  gap: 6px;
  padding-top: 2px;
}

.mobile-ink-swatch-gn-preset {
  flex: 1;
  aspect-ratio: 1 / 1;
  max-width: 44px;
  border-radius: 12px;
  background: var(--background-secondary);
  border: 1.5px solid transparent;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 0;
  transition: all 0.12s ease;
}

.mobile-ink-swatch-gn-preset:hover {
  background: var(--background-modifier-hover);
}

.mobile-ink-swatch-gn-preset:active {
  transform: scale(0.94);
}

.mobile-ink-swatch-gn-preset.is-active {
  border-color: var(--interactive-accent);
  background: color-mix(in srgb, var(--interactive-accent) 12%, transparent);
}

.mobile-ink-swatch-gn-preset-line {
  width: 20px;
  background: var(--text-muted);
  border-radius: 2px;
}

.mobile-ink-swatch-gn-preset.is-active .mobile-ink-swatch-gn-preset-line {
  background: var(--interactive-accent);
}

.mobile-ink-swatch-gn-preset-num {
  font-size: 10px;
  color: var(--text-muted);
  line-height: 1;
}

.mobile-ink-swatch-gn-preset.is-active .mobile-ink-swatch-gn-preset-num {
  color: var(--interactive-accent);
  font-weight: 600;
}
```

- [ ] **Step 4: 类型检查 + 构建**

Run: `npm run build`
Expected: exit 0。

- [ ] **Step 5: 提交**

```bash
git add src/overlay/shared/OverlayToolbar.ts src/overlay/shared/OverlayToolkit.ts styles.css
git commit -m "feat(overlay): rewrite width swatch in GoodNotes style (custom slider + 5 round presets + pt value)"
```

---

### Task 5: 构建 + 回归 + main.js 提交 + 最终验证

**Files:**
- Verify: 全部改动；构建产物 `main.js`

- [ ] **Step 1: 构建**

Run: `npm run build`
Expected: exit 0。

- [ ] **Step 2: 回归脚本**

Run:
```bash
node scripts/test-canvas-budget.mjs
node scripts/test-native-pdf-geometry.mjs
node scripts/test-markdown-overlay-geometry.mjs
node scripts/test-gesture-axis.mjs
node scripts/test-smoothing.mjs
```

Expected: 每个脚本全 PASS（canvas-budget 的 dpr=2.5 预存失败忽略）。

- [ ] **Step 3: 提交 main.js**

```bash
git add main.js
git commit -m "构建: 提交…重建后的 main.js（仓库惯例）"
```

- [ ] **Step 4: 手动验证清单**
  - 颜色面板：18 色圆形网格 + 底部取色器；点色即时应用；面板保持打开；点外部关闭；选中态有白圈
  - 粗细面板：大滑块 + 5 个圆形预设 + pt 数值；横向拖动滑块不触发侧边栏；预设点选生效
  - 工具栏按钮：选中的工具有底部指示条 + 染色；按下有 scale 反馈；颜色/粗细按钮在面板打开时高亮

---

## 自审

**Spec 覆盖：**
- 18 色 GoodNotes 风格网格 + 取色器 → Task 3 ✓
- 粗细面板 GoodNotes 风格 + 5 预设 → Task 4 ✓
- 手势修复（touch-action: pan-y）→ Task 2 ✓
- 按钮选中/按下/悬停态 → Task 1 ✓
- 面板打开锚点按钮高亮 → Task 2 ✓
- WIDTH_PRESETS 5 个 → Task 4 ✓
- 不加不透明度 → spec §边界确认 ✓

**占位符扫描：** 无 TBD/TODO。

**类型一致性：** `GN_COLOR_PALETTE` 在 Toolkit 定义、Task 3 消费；`WIDTH_PRESETS` 更新在 Toolkit、Task 4 消费；`mobile-ink-swatch-gn-*` class 名一致。
