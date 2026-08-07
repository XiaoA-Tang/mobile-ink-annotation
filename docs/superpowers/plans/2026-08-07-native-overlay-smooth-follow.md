# 原生 PDF 覆盖层 v1.2.4 修复实施计划（平滑跟随 + 可点击笔按钮 + 删保存按钮）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让原生 PDF 覆盖层画布成为 `.page` 的直接子元素（随原生滚动/缩放由合成器带动、消除阶梯感），扩展 `isEventFromToolbar` 使顶栏笔按钮可点击，并删除冗余的「保存」按钮。

**Architecture:** 画布嵌入 `.page` 元素内（`position:absolute; top:0; left:0; width:100%; height:100%`），滚动时零 JS 定位写入；`syncPageTracking` 只负责页面进出视口、尺寸变化检测（稳定 200ms 后 relayout）与引擎生命周期；命中测试仍每笔点实时读 `liveCanvas.getBoundingClientRect()`。

**Tech Stack:** TypeScript、Obsidian API、自研 `InkEngine`（本次获准仅改 `isEventFromToolbar` 一处）、pdf.js（Obsidian 内置）。

## Global Constraints

- 遵守 spec：`docs/superpowers/specs/2026-08-07-native-overlay-smooth-follow-design.md`。
- **本次获准修改 `src/ink/InkEngine.ts`，但仅限 `isEventFromToolbar` 的选择器一处**（用户已明确解除「禁止改动 InkEngine」约束）。
- 其余改动文件：`src/pdf/NativePdfOverlayManager.ts`、`styles.css`。
- 不改变 InkEngine 其它行为；不改动笔迹数据结构/保存格式。
- 仓库惯例：功能提交英文 `fix:` 前缀；`main.js`（tracked 构建产物）单独提交，消息 `构建: 提交…重建后的 main.js（仓库惯例）`。
- 构建：`npm run build`（`tsc -noEmit -skipLibCheck && node esbuild.config.mjs production`）必须 exit 0。
- 回归：`node scripts/test-canvas-budget.mjs`（24 断言）、`node scripts/test-native-pdf-geometry.mjs`（22 断言）必须全绿。
- PowerShell 陷阱：git 输出到 stderr 会使 `if ($?)` 判失败；用 `Write-Output "exit=$LASTEXITCODE"` 检查。`$LASTEXITCODE -eq 0` 才是成功。
- 数据安全不变量：销毁/重建引擎前必须先 `setInputEnabled(false)`（内部 finish+flush 提交活动笔划）。
- 完成后按用户约定直接发布 `v1.2.4-beta`。

---

### Task 1: InkEngine `isEventFromToolbar` 识别 PDF 工具条与笔按钮

**Files:**
- Modify: `src/ink/InkEngine.ts:1023`（选择器一行）
- Test: `npm run build` + 两个回归脚本

**Interfaces:**
- Consumes: 现有 `isEventFromToolbar(event)` 私有方法（`target instanceof Element` 判定在前，无外部依赖）。
- Produces: 行为变化——`event.target` 或其祖先匹配 `.pdf-toolbar` / `.mobile-ink-pdf-toolbar-pen` 时返回 true，`onPointerDown`/`onPointerMove`/`onTouchStart`/`onDocumentSelectionChange` 全部忽略该事件（Task 2 依赖此行为让顶栏笔按钮可点）。

- [ ] **Step 1: 修改选择器**

把 `src/ink/InkEngine.ts:1023` 从：

```ts
    if (target.closest(".mobile-ink-toolbar, .mobile-ink-pdf-page-nav, .mobile-ink-native-toolbar")) return true;
```

改为：

```ts
    if (target.closest(
      ".mobile-ink-toolbar, .mobile-ink-pdf-page-nav, .mobile-ink-native-toolbar, " +
      ".mobile-ink-pdf-toolbar-pen, .pdf-toolbar"
    )) return true;
```

- [ ] **Step 2: 构建验证**

Run: `npm run build`
Expected: exit 0（tsc 无错、esbuild 成功产出 main.js）。

- [ ] **Step 3: 回归验证**

Run: `node scripts/test-canvas-budget.mjs`
Expected: `checked 24 assertions` + `OK: all canvas budget assertions passed`，exit 0。

Run: `node scripts/test-native-pdf-geometry.mjs`
Expected: `OK: all native-pdf-geometry assertions passed`，exit 0。

- [ ] **Step 4: 自检 diff**

Run: `git diff src/ink/InkEngine.ts`
Expected: 仅 `isEventFromToolbar` 一处选择器变化；`grep -n "pdf-toolbar" src/ink/InkEngine.ts` 出现在 :1023 附近。

- [ ] **Step 5: 提交**

```bash
git add src/ink/InkEngine.ts
git commit -m "fix: let isEventFromToolbar ignore pdf-toolbar and native pen button events"
```

然后单独提交 main.js（仓库惯例，中文消息）：
```bash
git add main.js
git commit -m "构建: 提交扩展工具条事件识别重建后的 main.js（仓库惯例）"
```

---

### Task 2: NativePdfOverlayManager 画布嵌入 `.page` + 简化跟踪 + 删保存按钮

**Files:**
- Modify: `src/pdf/NativePdfOverlayManager.ts`（整文件重写为下方内容）
- Modify: `styles.css:2480-2482`（`.mobile-ink-native-page-canvas` 补定位/填充规则）

**Interfaces:**
- Consumes: `src/ink/InkEngine` 公开 API（`resize`/`setDisplayScale`/`loadStrokes`/`getStrokes`/`setInputEnabled`/`destroy`/`setToolState`/`undo`/`redo`）、`nativePdfGeometry.ts` 的 `buildUniformPageLayout`/`computePageSizeFromPdf`/`LogicalPage`/`LogicalPageLayout`/`ScreenRect`、`overlayInkData.ts` 的 `assignStrokeToPage`/`convertStrokesToLogical`/`convertStrokesToScreen`/`splitStrokesByPage`、Task 1 的 `isEventFromToolbar` 扩展行为。
- Produces: 导出的常量不变（`NATIVE_PEN_BUTTON_CLS`/`NATIVE_OVERLAY_CLS`/`NATIVE_OVERLAY_PAGE_CANVAS_CLS`/`NATIVE_ANNOTATING_CLS`）；行为——画布是 `.page` 子元素随滚动零延迟、`syncPageTracking` 无每帧样式写入、顶栏笔按钮可点击、工具条无保存按钮。

- [ ] **Step 1: 重写 `src/pdf/NativePdfOverlayManager.ts`**

将文件内容整体替换为以下最终代码（改动要点：删除 `rectCache` Map 与全部每帧 `left/top/width/height` 写入与 visibility 手动切换；`createPageEngine` 画布 `append` 到 `pageEl`、样式 `absolute; top:0; left:0; width:100%; height:100%; z-index:3`，`resize` 后回写 `100%`；`syncPageTracking` 三件事——进出视口销毁/创建、`entry.rect` 尺寸变化检测记 `sizeChangedAt`、稳定 200ms 后 relayout；`buildToolbar` 删除保存按钮；`relayout`/`teardownOverlay` 删 `rectCache.clear()`）：

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
  private teardownToken = 0;
  private retryBlockedUntil = 0;
  private unloaded = false;

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
    this.unloaded = true;
    for (const ref of this.eventRefs) this.app.workspace.offref(ref);
    this.eventRefs = [];
    this.removePenButton();
    void this.deactivateOverlay();
  }

  private get isActive(): boolean {
    return this.activeLeaf !== null;
  }

  private update(): void {
    if (this.unloaded) return;
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

      this.followFrame = window.requestAnimationFrame(this.followTick);
      this.retryBlockedUntil = 0;
    } catch (error) {
      console.error("Mobile Ink Annotation: failed to activate overlay", error);
      new Notice("就地批注启动失败: " + String(error));
      if (token === this.teardownToken) {
        this.activeLeaf = null;
        this.teardownOverlay(containerEl);
        this.retryBlockedUntil = performance.now() + 3000;
        this.removePenButton();
        this.update();
      }
    }
  }

  private followTick = (): void => {
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
      this.followFrame = window.requestAnimationFrame(this.followTick);
    }
  };

  private syncPageTracking(containerEl: HTMLElement): void {
    const pages = this.getVisiblePages(containerEl);

    for (const entry of Array.from(this.engines)) {
      const stillVisible = pages.some((p) => p.el === entry.pageEl);
      const connected = entry.pageEl.isConnected && entry.live.isConnected;
      if (stillVisible && connected) continue;
      entry.engine.setInputEnabled(false);
      this.replacePageStrokes(entry.page.pageNumber);
      entry.engine.destroy();
      entry.live.remove();
      entry.committed.remove();
      this.engines.splice(this.engines.indexOf(entry), 1);
    }

    for (const p of pages) {
      if (this.engines.some((e) => e.pageEl === p.el)) continue;
      const page = this.layout?.pages[p.pageNumber - 1];
      if (!page) continue;
      this.createPageEngine(containerEl, p.el, page, p.rect);
    }

    let sizeChanged = false;
    for (const p of pages) {
      const entry = this.engines.find((e) => e.pageEl === p.el);
      if (!entry) continue;
      const r = p.rect;
      if (Math.abs(entry.rect.width - r.width) > 0.5 || Math.abs(entry.rect.height - r.height) > 0.5) {
        sizeChanged = true;
      }
      entry.rect = r;
    }
    if (sizeChanged) this.sizeChangedAt = performance.now();

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

    if (getComputedStyle(pageEl).position === "static") pageEl.style.position = "relative";

    const live = document.createElement("canvas");
    live.className = NATIVE_OVERLAY_PAGE_CANVAS_CLS;
    const committed = document.createElement("canvas");
    committed.className = NATIVE_OVERLAY_PAGE_CANVAS_CLS;
    for (const c of [live, committed]) {
      c.style.position = "absolute";
      c.style.top = "0";
      c.style.left = "0";
      c.style.touchAction = "none";
      c.style.zIndex = "3";
    }
    pageEl.append(live, committed);

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
    for (const c of [live, committed]) {
      c.style.width = "100%";
      c.style.height = "100%";
    }

    const logicalStrokes = this.pageStrokes.get(page.pageNumber) ?? [];
    engine.loadStrokes(convertStrokesToScreen(logicalStrokes, page, rect));

    this.engines.push({ engine, page, rect, live, committed, pageEl });
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
    const token = ++this.teardownToken;
    const leaf = this.activeLeaf;
    const containerEl = leaf?.view.containerEl;
    this.activeLeaf = null;
    for (const entry of this.engines) entry.engine.setInputEnabled(false);
    await this.flushSave();
    if (token !== this.teardownToken) return;
    this.teardownOverlay(containerEl);
    if (leaf) {
      this.currentLeaf = null;
    }
    this.update();
  }

  private teardownOverlay(containerEl?: HTMLElement): void {
    if (this.saveTimer !== null) { window.clearTimeout(this.saveTimer); this.saveTimer = null; }
    if (this.followFrame !== null) { window.cancelAnimationFrame(this.followFrame); this.followFrame = null; }
    this.sizeChangedAt = null;
    for (const entry of this.engines) {
      entry.engine.setInputEnabled(false);
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

- [ ] **Step 2: 更新 `styles.css` `.mobile-ink-native-page-canvas`**

把 `styles.css:2480-2482` 的：

```css
.mobile-ink-native-page-canvas {
  pointer-events: none;
}
```

改为（补定位/填充/层级，作为内联样式的兜底）：

```css
.mobile-ink-native-page-canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 3;
  pointer-events: none;
  touch-action: none;
}
```

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
Expected: 仅 `src/pdf/NativePdfOverlayManager.ts`、`styles.css` 变化。

Run: `Select-String -Path src/pdf/NativePdfOverlayManager.ts -Pattern "rectCache|checkmark|mobile-ink-toolbar-group"`（`buildToolbar` 内应无匹配；`rectCache` 应无任何匹配）。
Run: `Select-String -Path src/pdf/NativePdfOverlayManager.ts -Pattern "style.left|style.top = .*r\.|createPageEngine\(containerEl, p\.el"` → 无 `style.left`/`style.top` 写入残留。

- [ ] **Step 6: 提交**

```bash
git add src/pdf/NativePdfOverlayManager.ts styles.css
git commit -m "fix: embed overlay canvases inside .page for compositor-smooth scroll follow; drop per-frame style writes; remove redundant save button"
```

然后单独提交 main.js：
```bash
git add main.js
git commit -m "构建: 提交画布嵌入页面重建后的 main.js（仓库惯例）"
```

---

### Task 3: 终局 whole-branch review + 发布

- [x] 用 code-reviewer（`requesting-code-review`）对基线 `98b0bdb`（release v1.2.3）至 HEAD 做 whole-branch review。
- [x] 评审结论：Ready to merge「With fixes（仅 1 Important）」。修复同窗格 PDF→PDF 切换：新增 `file-open` 订阅，`update()` 比较 `leaf.view.file` 与 `drawFile`，文件变化即 `deactivateOverlay()`（spec §7.6 明确要求）；另加 `followTick` 的 `unloaded` guard（Minor 防御）。修复提交 `17556e9`（源）+ `d5f84a4`（main.js）。重验 build exit 0 + 24 断言 + 22 断言全绿。其余 Minor（内联样式重复、relayout 空白帧、getVisiblePages 视口）为既有/有意为之，beta 期接受，记录不修。
- [ ] 按用户约定直接发布 `v1.2.4-beta`：bump `package.json`+`manifest.json` → `npm run build` → commit `release: bump version to 1.2.4` → push main → 本地 tag `v1.2.4-beta` 并 push → write 工具写 UTF-8 body → `curl.exe --data-binary @payload.json` 创建 release（`prerelease:true`）→ 上传 main.js/manifest.json/styles.css → GET 校验尺寸与本地一致。
- [ ] 交付真机验证清单（见 spec §7，重点：滚动零延迟贴页、捏合 200ms 后变清晰、顶栏笔按钮可点、无对号按钮、自动保存仍生效）。
