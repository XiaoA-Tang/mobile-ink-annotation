import { setIcon } from "obsidian";
import type { InkToolState } from "../../ink/types";
import type { ToolbarHost } from "./types";
import { GN_COLOR_PALETTE, WIDTH_MAX, WIDTH_MIN, WIDTH_PRESETS } from "./OverlayToolkit";

export class OverlayToolbar {
  private toolbarEl: HTMLElement | null = null;
  private buttonsMap: Record<string, HTMLElement> = {};
  private colorDot: HTMLElement | null = null;
  private swatchEl: HTMLElement | null = null;
  private extraButtons: Array<{ spec: { icon: string; label: string; isActive(): boolean; onClick(): void }; el: HTMLElement | null }> = [];
  private extraGroup: HTMLElement | null = null;
  private collapsedPenEl: HTMLElement | null = null;
  private collapseGroup: HTMLElement | null = null;

  constructor(private readonly host: ToolbarHost) {}

  get buttons(): Record<string, HTMLElement> {
    return this.buttonsMap;
  }

  get root(): HTMLElement | null {
    return this.toolbarEl;
  }

  isCollapsed(): boolean {
    return this.toolbarEl?.classList.contains("is-collapsed") ?? false;
  }

  setCollapsed(collapsed: boolean): void {
    this.toolbarEl?.classList.toggle("is-collapsed", collapsed);
  }

  build(overlay: HTMLElement): void {
    const bar = overlay.createDiv({ cls: "mobile-ink-native-toolbar" });
    this.toolbarEl = bar;
    const dock = bar.createDiv({ cls: "mobile-ink-toolbar-dock" });

    const collapsedPen = bar.createEl("button", {
      cls: "mobile-ink-icon-button mobile-ink-collapsed-pen",
      attr: { "aria-label": "手写批注" }
    });
    setIcon(collapsedPen, "pencil");
    collapsedPen.addEventListener("click", () => {
      if (this.host.onPenExpand) {
        this.host.onPenExpand();
      } else {
        this.setCollapsed(false);
      }
    });
    this.collapsedPenEl = collapsedPen;

    const addToolButton = (key: string, icon: string, label: string, action: () => void, group: HTMLElement): void => {
      const btn = group.createEl("button", {
        cls: "mobile-ink-icon-button mobile-ink-tool-button",
        attr: { "aria-label": label }
      });
      setIcon(btn, icon);
      btn.addEventListener("click", action);
      this.buttonsMap[key] = btn;
    };
    const addIconButton = (key: string, icon: string, label: string, action: () => void, group: HTMLElement): void => {
      const btn = group.createEl("button", {
        cls: "mobile-ink-icon-button",
        attr: { "aria-label": label }
      });
      setIcon(btn, icon);
      btn.addEventListener("click", action);
      this.buttonsMap[key] = btn;
    };

    const toolGroup = dock.createDiv({ cls: "mobile-ink-toolbar-group" });
    addToolButton("pen", "pencil", "画笔", () => this.host.applyToolState({ tool: "pen" }), toolGroup);
    addToolButton("highlighter", "highlighter", "记号笔", () => this.host.applyToolState({ tool: "highlighter" }), toolGroup);
    addToolButton("eraser", "eraser", "橡皮擦", () => this.host.applyToolState({ tool: "eraser" }), toolGroup);

    const styleGroup = dock.createDiv({ cls: "mobile-ink-toolbar-group" });
    const colorBtn = styleGroup.createEl("button", {
      cls: "mobile-ink-current-color-button",
      attr: { "aria-label": "颜色" }
    });
    const colorDot = colorBtn.createDiv({ cls: "mobile-ink-current-color-dot" });
    colorBtn.addEventListener("click", () => this.openColorSwatch(colorBtn));
    this.buttonsMap.color = colorBtn;
    this.colorDot = colorDot;
    addIconButton("width", "sliders-horizontal", "线条粗细", () => this.openWidthSwatch(), styleGroup);

    const historyGroup = dock.createDiv({ cls: "mobile-ink-toolbar-group" });
    addIconButton("undo", "undo-2", "撤销", () => { this.host.onUndo(); this.refresh(); }, historyGroup);
    addIconButton("redo", "redo-2", "重做", () => { this.host.onRedo(); this.refresh(); }, historyGroup);

    const collapseGroup = dock.createDiv({ cls: "mobile-ink-toolbar-group" });
    this.collapseGroup = collapseGroup;
    const collapseBtn = collapseGroup.createEl("button", {
      cls: "mobile-ink-icon-button",
      attr: { "aria-label": "收起" }
    });
    setIcon(collapseBtn, "chevron-down");
    collapseBtn.addEventListener("click", () => {
      if (this.host.onCollapse) {
        this.host.onCollapse();
      } else {
        this.setCollapsed(true);
      }
    });
    this.buttonsMap.collapse = collapseBtn;

    for (const entry of this.extraButtons) this.mountExtraButton(entry);

    this.refresh();
  }

  refresh(): void {
    if (!this.toolbarEl) return;
    const state = this.host.getToolState();
    this.toolbarEl.style.setProperty("--mobile-ink-tool-color", this.currentInkColor(state));
    for (const key of ["pen", "highlighter", "eraser"]) {
      const el = this.buttonsMap[key];
      if (el) el.classList.toggle("mobile-ink-active", state.tool === key);
    }
    if (this.colorDot) {
      this.colorDot.style.background = this.currentInkColor(state);
    }
    for (const entry of this.extraButtons) {
      if (entry.el) entry.el.classList.toggle("mobile-ink-active", entry.spec.isActive());
    }
  }

  registerExtraButton(spec: { icon: string; label: string; isActive(): boolean; onClick(): void }): void {
    this.extraButtons.push({ spec, el: null });
    if (this.toolbarEl) this.mountExtraButton(this.extraButtons[this.extraButtons.length - 1]);
    this.refresh();
  }

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

  teardown(): void {
    this.closeSwatch();
    this.toolbarEl?.remove();
    this.toolbarEl = null;
    this.buttonsMap = {};
    this.colorDot = null;
    this.extraButtons = [];
    this.extraGroup = null;
    this.collapsedPenEl = null;
    this.collapseGroup = null;
  }

  private currentInkColor(state: InkToolState): string {
    return state.tool === "highlighter" ? state.highlighterColor : state.color;
  }

  private openColorSwatch(anchor: HTMLElement): void {
    this.closeSwatch();
    const overlay = this.host.getOverlay();
    if (!overlay) return;
    const state = this.host.getToolState();
    const isHighlighter = state.tool === "highlighter";
    const current = isHighlighter ? state.highlighterColor : state.color;

    anchor.classList.add("mobile-ink-active");

    const panel = overlay.createDiv({ cls: "mobile-ink-swatch-panel" });
    const titleRow = panel.createDiv({ cls: "mobile-ink-swatch-title-row" });
    titleRow.createDiv({ cls: "mobile-ink-swatch-title", text: "颜色" });

    const grid = panel.createDiv({ cls: "mobile-ink-swatch-gn-grid" });
    for (const color of GN_COLOR_PALETTE) {
      const sw = grid.createEl("button", {
        cls: "mobile-ink-swatch-gn-cell",
        attr: { "aria-label": color }
      });
      sw.style.background = color;
      if (color.toLowerCase() === current.toLowerCase()) {
        sw.classList.add("is-active");
      }
      sw.addEventListener("click", () => {
        if (isHighlighter) this.host.applyToolState({ highlighterColor: color });
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
      if (isHighlighter) this.host.applyToolState({ highlighterColor: val });
      else this.host.applyToolState({ color: val });
      grid.querySelectorAll(".mobile-ink-swatch-gn-cell.is-active").forEach((el) => el.classList.remove("is-active"));
      customBtn.style.setProperty("--mobile-ink-custom-color", val);
      this.refresh();
    });

    this.swatchEl = panel;
    panel.addEventListener("click", (e) => e.stopPropagation());
    this.positionSwatch(panel, anchor);
    this.registerSwatchOutsideClose(panel);
  }

  private openWidthSwatch(): void {
    this.closeSwatch();
    const overlay = this.host.getOverlay();
    if (!overlay) return;
    this.buttonsMap.width?.classList.add("mobile-ink-active");
    const anchor = this.host.getWidthAnchor();
    const state = this.host.getToolState();
    const isHighlighter = state.tool === "highlighter";
    const current = isHighlighter ? state.highlighterWidth : state.width;

    const panel = overlay.createDiv({ cls: "mobile-ink-swatch-panel" });
    const titleRow = panel.createDiv({ cls: "mobile-ink-swatch-title-row" });
    titleRow.createDiv({ cls: "mobile-ink-swatch-title", text: isHighlighter ? "记号笔粗细" : "线条粗细" });
    const valueEl = titleRow.createDiv({ cls: "mobile-ink-swatch-width-value", text: `${current}` });

    const apply = (w: number): void => {
      const clamped = Math.max(WIDTH_MIN, Math.min(WIDTH_MAX, Math.round(w)));
      valueEl.textContent = `${clamped}`;
      preview.style.height = `${clamped}px`;
      if (isHighlighter) this.host.applyToolState({ highlighterWidth: clamped });
      else this.host.applyToolState({ width: clamped });
    };

    const target = document.createElement("input");
    target.type = "range";
    target.min = String(WIDTH_MIN);
    target.max = String(WIDTH_MAX);
    target.step = "1";
    target.value = String(Math.max(WIDTH_MIN, Math.min(WIDTH_MAX, Math.round(current))));
    target.className = "mobile-ink-swatch-width-slider";

    const syncPresetHighlight = (): void => {
      const w = Math.max(WIDTH_MIN, Math.min(WIDTH_MAX, Math.round(Number(target.value))));
      presets.querySelectorAll(".mobile-ink-swatch-width-preset.is-active").forEach((el) => el.classList.remove("is-active"));
      presets.querySelectorAll<HTMLElement>(".mobile-ink-swatch-width-preset").forEach((el) => {
        if (Number(el.dataset.width) === w) el.classList.add("is-active");
      });
    };

    target.addEventListener("input", () => {
      apply(Number(target.value));
      syncPresetHighlight();
    });
    panel.appendChild(target);

    const preview = panel.createDiv({ cls: "mobile-ink-swatch-width-preview-line" });

    const presets = panel.createDiv({ cls: "mobile-ink-swatch-width-presets" });
    for (const w of WIDTH_PRESETS) {
      const btn = presets.createEl("button", { cls: "mobile-ink-swatch-width-preset", attr: { "aria-label": `${w}`, "data-width": `${w}` } });
      const line = btn.createDiv({ cls: "mobile-ink-swatch-width-preview" });
      line.style.height = `${w}px`;
      btn.createDiv({ cls: "mobile-ink-swatch-width-label", text: `${w}` });
      if (Math.round(current) === w) btn.classList.add("is-active");
      btn.addEventListener("click", () => {
        target.value = String(w);
        apply(w);
        syncPresetHighlight();
      });
    }

    apply(current);

    this.swatchEl = panel;
    panel.addEventListener("click", (e) => e.stopPropagation());
    if (anchor) this.positionSwatch(panel, anchor);
    this.registerSwatchOutsideClose(panel);
  }

  private registerSwatchOutsideClose(panel: HTMLElement): void {
    const handler = (e: PointerEvent): void => {
      if (this.swatchEl !== panel) {
        document.removeEventListener("pointerdown", handler, true);
        return;
      }
      if (!panel.contains(e.target as Node)) {
        this.closeSwatch();
        document.removeEventListener("pointerdown", handler, true);
      }
    };
    document.addEventListener("pointerdown", handler, true);
  }

  private positionSwatch(panel: HTMLElement, anchor: HTMLElement): void {
    const anchorRect = anchor.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = anchorRect.left;
    let top = anchorRect.top - panelRect.height - 8;
    if (left + panelRect.width > vw) left = Math.max(8, vw - panelRect.width - 8);
    if (left < 8) left = 8;
    if (top < 8) top = anchorRect.bottom + 8;
    if (top + panelRect.height > vh) top = Math.max(8, vh - panelRect.height - 8);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  private closeSwatch(): void {
    this.buttonsMap.color?.classList.remove("mobile-ink-active");
    this.buttonsMap.width?.classList.remove("mobile-ink-active");
    this.swatchEl?.remove();
    this.swatchEl = null;
  }
}