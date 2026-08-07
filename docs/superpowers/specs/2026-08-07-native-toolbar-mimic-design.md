# 原生 PDF 手写模式 UI 对齐原版悬浮工具栏

Date: 2026-08-07
Repo: mobile-ink-annotation
Parent plan: `docs/superpowers/plans/2026-08-07-pdf-native-overlay-ink.md` (v1.2.0-beta, native PDF overlay)

## 背景

v1.2.0-beta 已发布。原生 PDF 手写模式的工具栏目前是顶部横条（44px 方钮、`background-primary` 实底、8px 圆角），悬浮笔按钮是右下角 56px 主色 FAB。用户要求：
1. 悬浮笔按钮移到右上角；
2. 工具栏模仿完整标注视图（AnnotationView）的原版悬浮工具栏外观。

## 目标（成功标准）

- 悬浮笔按钮位于右上角，外观与原版 `mobile-ink-floating-button` 一致（40px 玻璃胶囊、笔色高亮、笔色图标）。
- 绘制模式工具栏为底部居中胶囊，视觉语言与原版 `.mobile-ink-toolbar` 一致：圆钮 34px、分组带分隔线、dock 毛玻璃 blur + 阴影、工具激活态为笔色淡染 + 下划线点、颜色按钮显示当前色圆点。
- 行为保持不变：点笔按钮进入绘制模式、工具栏出现、退出按钮离开并防抖保存；手势锁定、每页 InkEngine、保存逻辑均不动。
- 构建通过、两个测试脚本回归通过。

## 非目标

- 不改动完整标注视图（AnnotationView）的工具栏。
- 不引入工具栏拖动、popover（取色/线宽面板、橡皮面板）。原生工具栏保持"点击循环切换"交互。
- 不改变笔迹坐标系、保存格式、绘制引擎。

## 现状（关键事实）

- 原版工具栏视觉由 styles.css 的 `.mobile-ink-toolbar`（底部居中定位）、`.mobile-ink-toolbar-dock`（胶囊容器：`border-radius:999px`、`padding:6px 8px`、毛玻璃 blur、阴影）、`.mobile-ink-toolbar-group`（分组 + `border-left` 分隔线）、按钮类（`.mobile-ink-icon-button`/`.mobile-ink-tool-button`/`.mobile-ink-current-color-button`/`.mobile-ink-floating-button`）构成。
- 原版有 3 组规则**作用域限定**在 `.mobile-ink-root` 下，native 覆盖层（无 `.mobile-ink-root`）无法直接继承：
  - `.mobile-ink-root button.mobile-ink-icon-button/current-color-button/floating-button`（圆钮外观：`border-radius:999px`、`background:var(--background-secondary)`、`appearance`、位置 `relative` 等）；
  - `.mobile-ink-root .mobile-ink-toolbar button...`（盒几何 pin：`box-sizing:border-box; min-width/min-height:0; border:0; padding:0`）；
  - `.mobile-ink-root .mobile-ink-toolbar button...svg/.svg-icon`（18px 字形 pin、`stroke`/`fill`/`stroke-width`，缺失会渲染空白图标）。
- 其余关键规则（dock/group/hover/active/色点/悬浮按钮本体）均**无作用域**，可直接复用。
- `--mobile-ink-shell-border`/`--mobile-ink-shell-glow` 由 `.mobile-ink-root` 定义，dock 的阴影依赖它们，native 覆盖层需自行定义。
- 悬浮按钮规则（styles.css:519）含 `--mobile-ink-icon-foreground: var(--mobile-ink-tool-color, ...)` 与 `display:none`；native 别名若也声明 `--mobile-ink-icon-foreground: var(--text-muted)` 会因更高特异性覆盖笔色，需在别名内显式恢复悬浮按钮的笔色前景。

## 设计

### 1. 悬浮笔按钮 → 右上角 + 原版样式

`attachPenButton`（src/pdf/NativePdfOverlayManager.ts）中按钮类改为 `NATIVE_PEN_BUTTON_CLS + " mobile-ink-floating-button"`，并同步注入：

```ts
button.style.setProperty("--mobile-ink-tool-color", this.currentInkColor());
```

CSS 新增/改写：

```css
.mobile-ink-native-pen-button {
  position: fixed;
  top: max(14px, env(safe-area-inset-top));
  right: max(14px, env(safe-area-inset-right));
  display: inline-flex; /* 覆盖原版 base 的 display:none */
  z-index: 400;
}
```

原版 `.mobile-ink-floating-button` 本体样式（40px、玻璃、笔色阴影）无作用域，直接生效。

### 2. 工具栏 → 底部居中胶囊

`buildToolbar` 重构标记为：

```
.mobile-ink-native-toolbar            (定位包装，bottom 居中)
  └ .mobile-ink-toolbar-dock          (原版胶囊容器，复用现有样式)
      ├ .mobile-ink-toolbar-group     pen / highlighter / eraser
      │   各按钮 cls: "mobile-ink-icon-button mobile-ink-tool-button"，setIcon
      ├ .mobile-ink-toolbar-group     color(current-color-button+色点) / width(icon)
      ├ .mobile-ink-toolbar-group     undo / redo
      └ .mobile-ink-toolbar-group     save / exit
```

- 颜色按钮：`.mobile-ink-current-color-button`，内含 `.mobile-ink-current-color-dot` div，其 `style.background` 由 `refreshToolbar` 设为当前墨色；点击触发 `cycleColor`。
- 线宽按钮：`.mobile-ink-icon-button`，图标 `sliders-horizontal`，点击触发 `cycleWidth`。
- 撤销/重做/保存/退出：`.mobile-ink-icon-button`，图标 `undo-2`/`redo-2`/`checkmark`/`x`。
- `refreshToolbar`：
  - 对 pen/highlighter/eraser 切换 `mobile-ink-active`（替代原 `-native-tool-active`）；
  - 设置 `this.toolbar.style.setProperty("--mobile-ink-tool-color", currentInkColor())`；
  - 更新色点 `style.background`。

CSS 改写 `.mobile-ink-native-toolbar`：

```css
.mobile-ink-native-toolbar {
  position: absolute;
  left: 50%;
  bottom: max(48px, env(safe-area-inset-bottom));
  transform: translateX(-50%);
  max-width: calc(100% - 20px);
  z-index: 360;
  box-sizing: border-box;
  pointer-events: auto;
}
```

删除现有 `.mobile-ink-native-tool` / `.mobile-ink-native-tool-active` 规则。

### 3. Native 覆盖层别名 CSS

以 `.mobile-ink-native-overlay` 为作用域复刻原版 3 组作用域规则（圆钮外观 + 盒几何、dark 主题底色、18px 字形 pin），并显式恢复悬浮按钮笔色前景、定义 shell 变量。**悬浮笔按钮挂在 PDF 容器（非 overlay）下，必须把 `.mobile-ink-native-pen-button` 一并加入别名选择器**，否则按钮圆钮外观与图标字形缺失。悬浮按钮/笔按钮**只 pin 盒几何与圆角**，背景/阴影继承原版 `.mobile-ink-floating-button` 本体（玻璃+笔色），避免别名把玻璃背景压成纯色：

```css
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
  box-sizing: border-box;
  min-width: 0;
  min-height: 0;
  border: 0;
  padding: 0;
  --mobile-ink-icon-foreground: var(--mobile-ink-tool-color, var(--interactive-accent));
}

/* 笔按钮定位：与 button.mobile-ink-floating-button 同特异性 (0,1,1) 且位于文件末尾，
   故 display/position/top/right/z-index 必须写在此处（基础规则 (0,1,0) 会被盖掉） */
button.mobile-ink-native-pen-button {
  position: fixed;
  display: inline-flex;
  top: max(14px, env(safe-area-inset-top));
  right: max(14px, env(safe-area-inset-right));
  z-index: 400;
}
```

别名规则追加在 styles.css 末尾（当前 native 块之后），确保与 `.mobile-ink-floating-button` 本体规则（styles.css:519）同级时后者序在前的语义正确：`button.mobile-ink-native-pen-button` 与 `button.mobile-ink-floating-button` 特异性相同，靠后的定位规则覆盖 `display:none`、获得笔色前景。注意：基础规则 `.mobile-ink-native-pen-button`（(0,1,0)）里的 `display`/`position` 会被任何 (0,1,1) 规则覆盖，因此定位必须放在文件末尾的 `button.mobile-ink-native-pen-button` 专用规则里。

### 4. 工具色辅助

新增私有方法（读当前墨色，荧光笔/笔分开）：

```ts
private currentInkColor(): string {
  return this.toolState.tool === "highlighter" ? this.toolState.highlighterColor : this.toolState.color;
}
```

`attachPenButton` 与 `refreshToolbar` 均调用它。

## 数据流 / 错误处理

- 无新数据流。`refreshToolbar` 在 `buildToolbar` 与 `applyToolState` 后调用，`exitDrawMode`/`teardownDrawMode` 不变。
- 若 `--shadow-s` 等 Obsidian 变量缺失，仅 dock 软阴影减弱，其余不变（与完整视图行为一致）。
- 图标渲染依赖别名 CSS；若缺失会空白，因此别名必须与标记改动同步提交。

## 测试

- `npm run build` exit 0（tsc + esbuild）。
- `node --experimental-strip-types scripts/test-canvas-budget.mjs` 与 `scripts/test-native-pdf-geometry.mjs` 回归通过。
- 真机手测（平板）：进入绘制模式看底部胶囊与激活态、切换工具颜色、退出后再进；右上角悬浮按钮不与 Obsidian 顶栏/返回键冲突（如冲突调整 safe-area 偏移或 z-index）。

## 文件清单

- `src/pdf/NativePdfOverlayManager.ts`：attachPenButton 类名+工具色注入；buildToolbar 重构；refreshToolbar 更新；新增 currentInkColor。
- `styles.css`：改写 native-pen-button / native-toolbar；删除 native-tool / native-tool-active；新增 alias 块（含 shell 变量）。
