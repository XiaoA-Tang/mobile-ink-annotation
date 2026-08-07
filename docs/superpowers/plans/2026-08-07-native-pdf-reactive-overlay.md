# 原生 PDF 响应式覆盖层实施计划（v1.2.3-beta）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `NativePdfOverlayManager` 从「按钮进入绘制 + 手势劫持」重构为「PDF 激活即永远就绪 + 笔手分离 + 逐帧跟随原生视图页面矩形」的响应式覆盖层，并移除 SPIKE 自动探测弹窗。

**Architecture:** 覆盖层与画布 `pointer-events: none`，手指触控直通 Obsidian 原生 PDF 视图（原生滚动/捏合缩放照常工作）；笔事件由 InkEngine 的 window/document 捕获级监听 + 画布矩形命中测试接收作画。新增 rAF 循环每帧把画布对齐到可见 `.page` 的 `getBoundingClientRect`，缩放尺寸稳定 200ms 后全量重建引擎渲染清晰笔迹。

**Tech Stack:** TypeScript、Obsidian API（`Workspace`/`WorkspaceLeaf`/`loadPdfJs`/`Platform`）、自研 `InkEngine`（只调用公开 API）、pdf.js（随 Obsidian 内置）。

## Global Constraints

- 遵守 spec：`docs/superpowers/specs/2026-08-07-native-pdf-reactive-overlay-design.md`。
- **禁止改动 `src/ink/InkEngine.ts`**。只调用其公开方法：`setToolState`/`getStrokes`/`loadStrokes`/`undo`/`redo`/`resize`/`setDisplayScale`/`setInputEnabled`/`destroy`。
- 沿用仓库惯例：功能提交用英文 `feat:`/`fix:`/`docs:` 前缀；`main.js`（tracked 构建产物）单独提交，消息为中文 `构建: 提交…重建后的 main.js（仓库惯例）`。
- 构建：`npm run build`（`tsc -noEmit -skipLibCheck && node esbuild.config.mjs production`）必须 exit 0。
- 回归：`node scripts/test-canvas-budget.mjs`、`node scripts/test-native-pdf-geometry.mjs` 必须全绿。
- PowerShell 陷阱：git 输出到 stderr 会使 `if ($?)` 判失败；用 `Write-Output "exit=$LASTEXITCODE"` 检查。`$LASTEXITCODE -eq 0` 才是成功。
- `setInputEnabled(false)` 内部会 `finishInterruptedInput()` + `flushPendingCommits()`（提交活动笔划），`destroy()` 只 `flushPendingCommits()`——**销毁/重建引擎前必须先 `setInputEnabled(false)`，否则丢进行中笔划**。
- 本分支最终由终局 whole-branch review 把关，评审通过后按用户约定直接发布 `v1.2.3-beta`。

---

### Task 1: NativePdfOverlayManager 重构为响应式覆盖层

**Files:**
- Modify: `src/pdf/NativePdfOverlayManager.ts`（整文件重写为下方内容）
- Modify: `styles.css:2472-2488`（覆盖层/画布 pointer-events）、`styles.css:2551`（删 panning 规则）

**Interfaces:**
- Consumes: `src/ink/InkEngine` 公开 API、`nativePdfGeometry.ts` 的 `buildUniformPageLayout`/`computePageSizeFromPdf`/`LogicalPage`/`LogicalPageLayout`/`ScreenRect`、`overlayInkData.ts` 的 `assignStrokeToPage`/`convertStrokesToLogical`/`convertStrokesToScreen`/`splitStrokesByPage`、`InkToolState`、`StrokeStore.load/save`。
- Produces: 导出的常量 `NATIVE_PEN_BUTTON_CLS`/`NATIVE_OVERLAY_CLS`/`NATIVE_OVERLAY_PAGE_CANVAS_CLS`/`NATIVE_ANNOTATING_CLS`（Task 2 的 CSS 与 main.ts 依赖）；行为——PDF 叶签激活自动挂载覆盖层、顶栏笔按钮切换工具条显隐、手指触控放行、rAF 逐帧跟随页面。

- [ ] **Step 1: 重写 `src/pdf/NativePdfOverlayManager.ts`**

将文件内容整体替换为以下最终代码（改动要点：删手势劫持/pinch/`viewer` 内部解析/capture 层/滚轮劫持/`.panning`；覆盖层 pointer-events 由 CSS 控制；新增 `followFrame` rAF 循环 + `syncPageTracking` + settle 重建；`update()` 自动激活；顶栏按钮改为 `toggleToolbar`；工具条移除「退出」按钮）：

```ts
import { App, loadPdfJs, Notice, Platform, setIcon, TFile, Workspace, WorkspaceLeaf } from "obsidian";
import { StrokeStore } from "../ink/StrokeStore";
import { InkEngine } from "../ink/InkEngine";
import { InkStroke, InkToolState } from "../ink/types";
import { resolveInkCanvasBudget } from "../ink/inkBudget";
import { PdfJsDocument, PdfJsLib } from "../views/annotationTypes";
import { buildUniformPageLayout, computePageSizeFromPdf, LogicalPage, LogicalPageLayout, ScreenRect } from "./nativePdfGeometry";
import { assignStrokeToPage, convertStrokesToLogical, convertStrokesToScreen, splitStrokesByPage } from "./overlayInkData";

export const NATIVE_PEN_BUTTON_CLS = "mobile-ink-pdf-toolbar-pen";
export const NATIVE_OVERLAY_CLS = "mobile-ink-native-overlay";
export const NATIVE_OVERLAY_PAGE_CANVAS_CLS = "mobile-ink-native-page-canvas";
export const NATIVE_ANNOTATING_CLS = "mobile-ink-native-annotating";

const SETTLE_MS = 200;

export class NativePdfOverlayManager {
  private penButton: HTMLElement | null = null;
  private currentLeaf: WorkspaceLeaf | null = null;
  private activeLeaf: WorkspaceLeaf | null = null;
  private eventRefs: ReturnType<Workspace["on"]>[] = [];

  private overlay: HTMLElement | null = null;
  private drawFile: TFile | null = null;
  private layout: LogicalPageLayout | null = null;
  private pageStrokes: Map<number, InkStroke[]> = new Map();
  private engines: Array<{
    engine: InkEngine;
    page: LogicalPage;
    rect: ScreenRect;
    live: HTMLCanvasElement;
    committed: HTMLCanvasElement;
    pageEl: HTMLElement;
  }> = [];
  private toolState: InkToolState = {
    tool: "pen", color: "#111111", width: 2,
    highlighterColor: "#ffd54a", highlighterWidth: 14,
    eraserRadius: 18, acceptTouchInput: false
  };
  private saveTimer: number | null = null;
  private dirty = false;
  private toolbar: HTMLElement | null = null;
  private toolbarButtons: Record<string, HTMLElement> = {};
  private colorDot: HTMLElement | null = null;

  private followFrame: number | null = null;
  private sizeChangedAt: number | null = null;
  private rectCache = new Map<HTMLElement, ScreenRect>();
  private teardownToken = 0;
  private retryBlockedUntil = 0;

  constructor(
    private readonly app: App,
    private readonly store: StrokeStore
  ) {}

  onload(): void {
    this.eventRefs.push(
      this.app.workspace.on("layout-change", () => this.update()),
      this.app.workspace.on("active-leaf-change", () => this.update())
    );
  }

  onunload(): void {
    for (const ref of this.eventRefs) this.app.workspace.offref(ref);
    this.eventRefs = [];
    this.removePenButton();
    void this.deactivateOverlay();
  }

  private get isActive(): boolean {
    return this.activeLeaf !== null;
  }

  private update(): void {
    const leaf = this.app.workspace.activeLeaf;
    if (this.isActive) {
      if (!leaf || leaf !== this.activeLeaf || leaf.getViewState().type !== "pdf") {
        void this.deactivateOverlay();
      }
      return;
    }
    const isPdf = !!leaf && leaf.getViewState().type === "pdf";
    if (!isPdf || !leaf) {
      this.removePenButton();
      return;
    }
    if (leaf === this.currentLeaf && this.penButton) return;
    this.removePenButton();
    this.currentLeaf = leaf;
    this.attachPenButton(leaf);
    void this.activateOverlay(leaf);
  }

  private getPdfToolbar(containerEl: HTMLElement): HTMLElement | null {
    return containerEl.querySelector<HTMLElement>(".pdf-toolbar");
  }

  private attachPenButton(leaf: WorkspaceLeaf): void {
    const toolbar = this.getPdfToolbar(leaf.view.containerEl);
    if (!toolbar) return;
    const button = toolbar.createEl("button", {
      cls: `clickable-icon ${NATIVE_PEN_BUTTON_CLS}`,
      attr: { "aria-label": "显示/隐藏批注工具条" }
    });
    setIcon(button, "pencil");
    button.addEventListener("click", () => this.toggleToolbar());
    this.penButton = button;
  }

  private removePenButton(): void {
    this.penButton?.remove();
    this.penButton = null;
    this.currentLeaf = null;
  }

  private toggleToolbar(): void {
    this.toolbar?.classList.toggle("is-collapsed");
  }

  private async activateOverlay(leaf: WorkspaceLeaf): Promise<void> {
    if (this.isActive) return;
    if (performance.now() < this.retryBlockedUntil) return;
    const file = (leaf.view as unknown as { file?: TFile }).file;
    if (!(file instanceof TFile) || file.extension !== "pdf") return;

    const token = ++this.teardownToken;
    this.activeLeaf = leaf;
    this.drawFile = file;
    const containerEl = leaf.view.containerEl;
    try {
      const scrollClientWidth = Math.max(320, containerEl.clientWidth || window.innerWidth);
      const pdfjsLib = (await loadPdfJs()) as PdfJsLib;
      if (token !== this.teardownToken) return;
      const data = new Uint8Array(await this.app.vault.readBinary(file));
      if (token !== this.teardownToken) return;
      const pdf = (await pdfjsLib.getDocument({ data }).promise) as PdfJsDocument;
      if (token !== this.teardownToken) return;
      const computed = await computePageSizeFromPdf(pdf, scrollClientWidth);
      if (token !== this.teardownToken) return;
      const annotation = await this.store.load(file.path, computed.width, computed.height);
      if (token !== this.teardownToken) return;

      const useSaved = Number.isFinite(annotation.pageWidth) && annotation.pageWidth > 0
        && Number.isFinite(annotation.pageHeight) && annotation.pageHeight > 0;
      const pageWidth = useSaved ? annotation.pageWidth : computed.width;
      const pageHeight = useSaved ? annotation.pageHeight : computed.height;
      const layout = buildUniformPageLayout(pageWidth, pageHeight, pdf.numPages);
      this.layout = layout;

      this.pageStrokes = splitStrokesByPage(annotation.strokes, layout);
      const orphanStrokes = annotation.strokes.filter((s) => !assignStrokeToPage(s, layout));
      if (orphanStrokes.length > 0) {
        const p1 = this.pageStrokes.get(1) ?? [];
        this.pageStrokes.set(1, [...orphanStrokes, ...p1]);
      }

      this.overlay = containerEl.createDiv({ cls: NATIVE_OVERLAY_CLS, attr: { "aria-hidden": "true" } });
      containerEl.classList.add(NATIVE_ANNOTATING_CLS);
      this.buildToolbar(this.overlay);

      const pages = this.getVisiblePages(containerEl);
      for (const { el, pageNumber, rect } of pages) {
        const page = layout.pages[pageNumber - 1];
        if (!page) continue;
        this.createPageEngine(containerEl, el, page, rect);
      }

      this.followFrame = window.requestAnimationFrame(this.followFrame);
      this.retryBlockedUntil = 0;
    } catch (error) {
      console.error("Mobile Ink Annotation: failed to activate overlay", error);
      new Notice("就地批注启动失败: " + String(error));
      if (token === this.teardownToken) {
        this.activeLeaf = null;
        this.teardownOverlay(containerEl);
        this.retryBlockedUntil = performance.now() + 3000;
        this.update();
      }
    }
  }

  private followFrame = (): void => {
    this.followFrame = null;
    if (!this.isActive) return;
    const containerEl = this.activeLeaf?.view.containerEl;
    if (!containerEl) return;
    try {
      this.syncPageTracking(containerEl);
    } catch (error) {
      console.error("Mobile Ink Annotation: overlay tracking error", error);
    }
    if (this.isActive) {
      this.followFrame = window.requestAnimationFrame(this.followFrame);
    }
  };

  private syncPageTracking(containerEl: HTMLElement): void {
    const pages = this.getVisiblePages(containerEl);

    for (const entry of Array.from(this.engines)) {
      const stillVisible = pages.some((p) => p.el === entry.pageEl);
      if (stillVisible) continue;
      entry.engine.setInputEnabled(false);
      this.replacePageStrokes(entry.page.pageNumber);
      entry.engine.destroy();
      entry.live.remove();
      entry.committed.remove();
      this.rectCache.delete(entry.pageEl);
      this.engines.splice(this.engines.indexOf(entry), 1);
    }

    for (const p of pages) {
      if (this.engines.some((e) => e.pageEl === p.el)) continue;
      const page = this.layout?.pages[p.pageNumber - 1];
      if (!page) continue;
      this.createPageEngine(containerEl, p.el, page, p.rect);
    }

    for (const p of pages) {
      const entry = this.engines.find((e) => e.pageEl === p.el);
      if (!entry) continue;
      const r = p.rect;
      const prev = this.rectCache.get(p.el);
      const sizeChanged = !prev || Math.abs(prev.width - r.width) > 0.5 || Math.abs(prev.height - r.height) > 0.5;
      if (sizeChanged) this.sizeChangedAt = performance.now();
      this.rectCache.set(p.el, r);
      const moved = Math.abs(entry.rect.left - r.left) > 0.5
        || Math.abs(entry.rect.top - r.top) > 0.5
        || Math.abs(entry.rect.width - r.width) > 0.5
        || Math.abs(entry.rect.height - r.height) > 0.5;
      if (moved) {
        entry.rect = r;
        for (const c of [entry.live, entry.committed]) {
          c.style.left = `${r.left}px`;
          c.style.top = `${r.top}px`;
          c.style.width = `${r.width}px`;
          c.style.height = `${r.height}px`;
        }
      }
      const hidden = p.el.style.visibility === "hidden" || p.el.offsetParent === null;
      const vis = hidden ? "hidden" : "";
      if (entry.live.style.visibility !== vis) {
        entry.live.style.visibility = vis;
        entry.committed.style.visibility = vis;
      }
    }

    if (this.sizeChangedAt !== null && performance.now() - this.sizeChangedAt > SETTLE_MS) {
      this.sizeChangedAt = null;
      this.relayout(containerEl);
    }
  }

  private getVisiblePages(containerEl: HTMLElement): Array<{ el: HTMLElement; pageNumber: number; rect: ScreenRect }> {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const candidates = containerEl.querySelectorAll<HTMLElement>(".page");
    const pages: Array<{ el: HTMLElement; pageNumber: number; rect: ScreenRect }> = [];
    candidates.forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > vh || rect.right < 0 || rect.left > vw) return;
      const fromAttr = Number(el.getAttribute("data-page-number")) || Number(el.dataset.pageNumber);
      const pageNumber = Number.isFinite(fromAttr) && fromAttr > 0 ? fromAttr : 0;
      if (pageNumber < 1) return;
      pages.push({ el, pageNumber, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } });
    });
    return pages;
  }

  private createPageEngine(containerEl: HTMLElement, pageEl: HTMLElement, page: LogicalPage, rect: ScreenRect): void {
    const width = Math.max(1, Math.ceil(rect.width));
    const height = Math.max(1, Math.ceil(rect.height));

    const live = document.createElement("canvas");
    live.className = NATIVE_OVERLAY_PAGE_CANVAS_CLS;
    const committed = document.createElement("canvas");
    committed.className = NATIVE_OVERLAY_PAGE_CANVAS_CLS;
    for (const c of [live, committed]) {
      c.style.position = "absolute";
      c.style.left = `${rect.left}px`;
      c.style.top = `${rect.top}px`;
      c.style.width = `${width}px`;
      c.style.height = `${height}px`;
      c.style.touchAction = "none";
    }
    this.overlay!.append(live, committed);

    const engine = new InkEngine(live, committed, containerEl, {
      initialToolState: { ...this.toolState },
      canvasMaxDpr: 3,
      canvasMaxPixels: resolveInkCanvasBudget(Platform.isMobile),
      panOutsideCanvas: false,
      onInputStart: () => this.markDirty(),
      onChange: () => this.markDirty()
    });
    engine.resize(width, height);
    engine.setDisplayScale(1);

    const logicalStrokes = this.pageStrokes.get(page.pageNumber) ?? [];
    engine.loadStrokes(convertStrokesToScreen(logicalStrokes, page, rect));

    this.engines.push({ engine, page, rect, live, committed, pageEl });
    this.rectCache.set(pageEl, { ...rect });
  }

  private replacePageStrokes(pageNumber: number): void {
    const entry = this.engines.find((e) => e.page.pageNumber === pageNumber);
    if (!entry) return;
    const logical = convertStrokesToLogical(entry.engine.getStrokes(), entry.page, entry.rect);
    this.pageStrokes.set(pageNumber, logical);
  }

  private relayout(containerEl: HTMLElement): void {
    for (const entry of this.engines) entry.engine.setInputEnabled(false);
    for (const entry of this.engines) this.replacePageStrokes(entry.page.pageNumber);
    for (const entry of this.engines) {
      entry.engine.destroy();
      entry.live.remove();
      entry.committed.remove();
    }
    this.engines = [];
    this.rectCache.clear();
    const pages = this.getVisiblePages(containerEl);
    for (const { el, pageNumber, rect } of pages) {
      const page = this.layout?.pages[pageNumber - 1];
      if (!page) continue;
      this.createPageEngine(containerEl, el, page, rect);
    }
  }

  private buildToolbar(containerEl: HTMLElement): void {
    const bar = containerEl.createDiv({ cls: "mobile-ink-native-toolbar" });
    this.toolbar = bar;
    const dock = bar.createDiv({ cls: "mobile-ink-toolbar-dock" });

    const addToolButton = (key: string, icon: string, label: string, action: () => void, group: HTMLElement): void => {
      const btn = group.createEl("button", {
        cls: "mobile-ink-icon-button mobile-ink-tool-button",
        attr: { "aria-label": label }
      });
      setIcon(btn, icon);
      btn.addEventListener("click", action);
      this.toolbarButtons[key] = btn;
    };
    const addIconButton = (key: string, icon: string, label: string, action: () => void, group: HTMLElement): void => {
      const btn = group.createEl("button", {
        cls: "mobile-ink-icon-button",
        attr: { "aria-label": label }
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
      attr: { "aria-label": "颜色" }
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

    this.refreshToolbar();
  }

  private currentInkColor(): string {
    return this.toolState.tool === "highlighter" ? this.toolState.highlighterColor : this.toolState.color;
  }

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

  private applyToolState(patch: Partial<InkToolState>): void {
    Object.assign(this.toolState, patch);
    for (const e of this.engines) e.engine.setToolState({ ...patch });
    this.refreshToolbar();
  }

  private cycleColor(): void {
    const palette = ["#111111", "#e53935", "#1e88e5", "#43a047", "#ffb300", "#8e24aa"];
    const current = this.toolState.tool === "highlighter" ? this.toolState.highlighterColor : this.toolState.color;
    const next = palette[(palette.indexOf(current) + 1 + palette.length) % palette.length];
    if (this.toolState.tool === "highlighter") this.applyToolState({ highlighterColor: next });
    else this.applyToolState({ color: next });
  }

  private cycleWidth(): void {
    const widths = [2, 3, 5, 8];
    const current = this.toolState.tool === "highlighter" ? this.toolState.highlighterWidth : this.toolState.width;
    const next = widths[(widths.indexOf(current) + 1) % widths.length];
    if (this.toolState.tool === "highlighter") this.applyToolState({ highlighterWidth: next });
    else this.applyToolState({ width: next });
  }

  private markDirty(): void {
    this.dirty = true;
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.flushSave(), 800);
  }

  private async flushSave(): Promise<void> {
    if (!this.dirty || !this.layout) return;
    this.dirty = false;
    if (this.saveTimer !== null) { window.clearTimeout(this.saveTimer); this.saveTimer = null; }
    const file = this.drawFile;
    if (!(file instanceof TFile)) return;
    for (const entry of this.engines) {
      this.replacePageStrokes(entry.page.pageNumber);
    }
    const rebuilt: InkStroke[] = [];
    const pageNumbers = Array.from(this.pageStrokes.keys()).sort((a, b) => a - b);
    for (const pn of pageNumbers) {
      rebuilt.push(...(this.pageStrokes.get(pn) ?? []));
    }
    const annotation = await this.store.load(file.path, this.layout.pageWidth, this.layout.pageHeight);
    annotation.strokes = rebuilt;
    await this.store.save(annotation);
  }

  private async deactivateOverlay(): Promise<void> {
    this.teardownToken++;
    const leaf = this.activeLeaf;
    const containerEl = leaf?.view.containerEl;
    this.activeLeaf = null;
    await this.flushSave();
    this.teardownOverlay(containerEl);
    if (leaf) {
      this.currentLeaf = null;
    }
  }

  private teardownOverlay(containerEl?: HTMLElement): void {
    if (this.saveTimer !== null) { window.clearTimeout(this.saveTimer); this.saveTimer = null; }
    if (this.followFrame !== null) { window.cancelAnimationFrame(this.followFrame); this.followFrame = null; }
    this.sizeChangedAt = null;
    this.rectCache.clear();
    for (const entry of this.engines) {
      entry.engine.destroy();
    }
    this.engines = [];
    this.pageStrokes = new Map();
    this.layout = null;
    this.drawFile = null;
    this.overlay?.remove();
    this.overlay = null;
    if (containerEl) containerEl.classList.remove(NATIVE_ANNOTATING_CLS);
    this.toolbar = null;
    this.toolbarButtons = {};
    this.colorDot = null;
  }
}
```

- [ ] **Step 2: 更新 `styles.css` 覆盖层规则**

a) 找到 `.mobile-ink-native-overlay {` 块（约 `2472-2477`），在 `overflow: hidden;` 后新增一行 `pointer-events: none;`，并删除其下 `.mobile-ink-native-capture { ... }` 块（约 `2479-2484`）：

```css
.mobile-ink-native-overlay {
  position: fixed;
  inset: 0;
  z-index: 350;
  overflow: hidden;
  pointer-events: none;
}
```

b) `.mobile-ink-native-page-canvas` 块（约 `2486-2488`）把 `pointer-events: auto;` 改为 `pointer-events: none;`：

```css
.mobile-ink-native-page-canvas {
  pointer-events: none;
}
```

c) 删除文件末尾 `.mobile-ink-native-overlay.mobile-ink-native-panning .mobile-ink-native-page-canvas { ... }` 整条规则（含 `visibility: hidden`）。

- [ ] **Step 3: 构建验证**

Run: `npm run build`
Expected: exit 0（tsc 无错、esbuild 成功产出 main.js）。

- [ ] **Step 4: 回归验证**

Run: `node scripts/test-canvas-budget.mjs`
Expected: `checked 24 assertions` + `OK: all canvas budget assertions passed`，exit 0。

Run: `node scripts/test-native-pdf-geometry.mjs`
Expected: `OK: all native-pdf-geometry assertions passed`，exit 0。

- [ ] **Step 5: 自检 diff**

Run: `git diff --stat`
Expected: 仅 `src/pdf/NativePdfOverlayManager.ts`、`styles.css` 变化；确认已无 `pinchTouches`/`beginPinch`/`handlePinchMove`/`endPinch`/`scheduleRelayout`/`resolveViewer`/`viewerWarned`/`captureLayer`/`mobile-ink-native-panning` 残留。

- [ ] **Step 6: 提交**

```bash
git add src/pdf/NativePdfOverlayManager.ts styles.css
git commit -m "feat: reactive always-ready native PDF overlay (pen/finger separation, per-frame page tracking, drop gesture hijack)"
```

然后单独提交 main.js（仓库惯例，中文消息）：
```bash
git add main.js
git commit -m "构建: 提交响应式覆盖层重建后的 main.js（仓库惯例）"
```

---

### Task 2: 移除 SPIKE 自动探测 + 禁用原生文本选择 CSS + 工具条折叠样式

**Files:**
- Modify: `src/main.ts:44-58`（删除 `active-leaf-change` 自动探测块）
- Modify: `styles.css`（新增 `.mobile-ink-native-annotating .textLayer` 与 `.mobile-ink-native-toolbar.is-collapsed`）

**Interfaces:**
- Consumes: Task 1 导出的 `NATIVE_ANNOTATING_CLS`（类名 `mobile-ink-native-annotating`，覆盖层激活时加到 PDF 叶签容器）与工具条类 `mobile-ink-native-toolbar`。
- Produces: 无新接口；行为——打开 PDF 不再自动弹「探测到…」Notice；原生 PDF 文本不可选中；顶栏笔按钮可折叠底部工具条。

- [ ] **Step 1: 删除 `src/main.ts` 自动探测块**

删除 `onload()` 中从 `let nativePdfProbeDone = false;` 到对应 `this.registerEvent(this.app.workspace.on("active-leaf-change", () => { ... }));` 结尾的整段代码（约 `44-58` 行）。保留手动命令 `probe-native-pdf-structure` 与 `import { probeNativePdfStructure }`（命令仍使用它）。

删除后 `onload()` 不再包含 `active-leaf-change` 的 `registerEvent`；确认 `nativePdfProbeDone`、`window.setTimeout(...)` 探测回调不再存在。

- [ ] **Step 2: 新增 CSS（追加到 `styles.css` 文件末尾）**

```css
/* Reactive overlay: 批注激活时禁用原生 PDF 文本选择（手写为核心，无文字框选需求） */
.mobile-ink-native-annotating .textLayer {
  user-select: none;
  -webkit-user-select: none;
}

/* 顶栏笔按钮显隐底部工具条 */
.mobile-ink-native-toolbar.is-collapsed {
  display: none;
}
```

- [ ] **Step 3: 构建验证**

Run: `npm run build`
Expected: exit 0。

- [ ] **Step 4: 自检**

Run: `git diff src/main.ts`
Expected: 仅删除自动探测块；命令与导入保留。

Run: `Select-String -Path main.js -Pattern "页候选数"`（构建产物）
Expected: 无匹配（旧构建已含该字符串则说明 build 未重跑/失败）。

- [ ] **Step 5: 提交**

```bash
git add src/main.ts styles.css
git commit -m "chore: drop auto PDF structure probe notice; disable native text selection while annotating; toolbar collapse style"
```

然后单独提交 main.js：
```bash
git add main.js
git commit -m "构建: 提交移除自动探测重建后的 main.js（仓库惯例）"
```

---

### Task 3: 终局 whole-branch review + 发布

- [ ] 用 code-reviewer（`requesting-code-review`）对基线 `951260f`（release v1.2.2）至 HEAD 做 whole-branch review；修复发现的问题并重验 `npm run build` + 两个回归脚本。
- [ ] 按用户约定直接发布 `v1.2.3-beta`：bump `package.json`+`manifest.json` → `npm run build` → commit `release: bump version to 1.2.3` → push main → 本地 tag `v1.2.3-beta` 并 push → write 工具写 UTF-8 body → `curl.exe --data-binary` 创建 release（`prerelease:true`）→ 上传 main.js/manifest.json/styles.css → GET 校验尺寸与本地一致。
- [ ] 交付真机验证清单（见 spec §8）。
