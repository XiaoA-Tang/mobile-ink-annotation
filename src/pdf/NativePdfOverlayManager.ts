import { App, Platform, setIcon, TFile, Workspace, WorkspaceLeaf } from "obsidian";
import { StrokeStore } from "../ink/StrokeStore";

export const NATIVE_PEN_BUTTON_CLS = "mobile-ink-native-pen-button";

export class NativePdfOverlayManager {
  private penButton: HTMLElement | null = null;
  private currentLeaf: WorkspaceLeaf | null = null;
  private drawModeLeaf: WorkspaceLeaf | null = null;
  private eventRefs: ReturnType<Workspace["on"]>[] = [];

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
  }

  private get activeDrawMode(): boolean {
    return this.drawModeLeaf !== null;
  }

  private update(): void {
    const leaf = this.app.workspace.activeLeaf;
    if (this.activeDrawMode) {
      if (!leaf || leaf !== this.drawModeLeaf) {
        void this.exitDrawMode();
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
  }

  private attachPenButton(leaf: WorkspaceLeaf): void {
    const button = leaf.view.containerEl.createEl("button", {
      cls: NATIVE_PEN_BUTTON_CLS,
      attr: { "aria-label": "就地手写批注" }
    });
    setIcon(button, "pencil");
    button.addEventListener("click", () => void this.enterDrawMode(leaf));
    this.penButton = button;
  }

  private removePenButton(): void {
    this.penButton?.remove();
    this.penButton = null;
    this.currentLeaf = null;
  }

  private async enterDrawMode(leaf: WorkspaceLeaf): Promise<void> {
    if (this.activeDrawMode) return;
    const file = (leaf.view as unknown as { file?: TFile }).file;
    if (!(file instanceof TFile) || file.extension !== "pdf") return;
    this.drawModeLeaf = leaf;
    this.removePenButton();
    // Task 5 填充：加载标注 → 计算布局 → 建覆盖层与逐页墨迹引擎
    // Task 6 填充：工具栏、保存、退出
  }

  private async exitDrawMode(): Promise<void> {
    const leaf = this.drawModeLeaf;
    this.drawModeLeaf = null;
    // Task 6 填充：flush 保存 + 卸载覆盖层
    if (leaf) {
      this.currentLeaf = null;
      this.update();
    }
  }
}
