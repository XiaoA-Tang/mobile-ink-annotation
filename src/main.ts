import { App, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf } from "obsidian";
import { StrokeStore } from "./ink/StrokeStore";
import { AnnotationView } from "./views/AnnotationView";
import { VIEW_TYPE_MOBILE_INK } from "./constants";

export type SavedFilePosition =
  | { kind: "pdf"; page: number }
  | { kind: "markdown"; scrollTop: number };

type MobileInkAnnotationSettings = {
  openPdfWithAnnotationByDefault: boolean;
  savedPositions: Record<string, SavedFilePosition>;
};

const DEFAULT_SETTINGS: MobileInkAnnotationSettings = {
  openPdfWithAnnotationByDefault: false,
  savedPositions: {}
};

export default class MobileInkAnnotationPlugin extends Plugin {
  store!: StrokeStore;
  settings!: MobileInkAnnotationSettings;
  private defaultPdfOpenPath: string | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.store = new StrokeStore(this.app, this);

    this.registerView(
      VIEW_TYPE_MOBILE_INK,
      (leaf) => new AnnotationView(leaf, this)
    );

    this.registerEvent(this.app.workspace.on("file-open", (file) => {
      this.queueOpenPdfWithAnnotationByDefault(file);
    }));

    this.addSettingTab(new MobileInkAnnotationSettingTab(this.app, this));

    this.addRibbonIcon("pencil", "打开手写标注", async () => {
      await this.openInkForActiveFile();
    });

    this.addCommand({
      id: "open-mobile-ink-annotation",
      name: "Open mobile ink annotation for current note",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const canRun = file instanceof TFile && (file.extension === "md" || file.extension === "pdf");
        if (checking) return canRun;
        if (canRun && file) {
          void this.openInkForFile(file);
        }
        return true;
      }
    });
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_MOBILE_INK);
  }

  async openInkForActiveFile(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!(file instanceof TFile)) {
      new Notice("请先打开一个 Markdown 笔记或 PDF 文件");
      return;
    }

    if (file.extension !== "md" && file.extension !== "pdf") {
      new Notice("当前版本只支持 Markdown 笔记或 PDF 文件标注");
      return;
    }

    await this.openInkForFile(file);
  }

  async openInkForFile(file: TFile, leaf: WorkspaceLeaf = this.app.workspace.getLeaf(true)): Promise<void> {
    await leaf.setViewState({
      type: VIEW_TYPE_MOBILE_INK,
      active: true,
      state: {
        file: file.path,
        sourcePath: file.path
      }
    });
    this.app.workspace.revealLeaf(leaf);
  }

  private async openPdfWithAnnotationByDefaultIfNeeded(file: TFile | null): Promise<void> {
    if (!this.settings.openPdfWithAnnotationByDefault) return;
    if (!(file instanceof TFile) || file.extension !== "pdf") return;
    if (this.defaultPdfOpenPath === file.path) return;

    const leaf = this.app.workspace.activeLeaf;
    if (!leaf) return;

    const viewState = leaf.getViewState();
    const state = (viewState.state ?? {}) as { file?: unknown; sourcePath?: unknown };
    const statePath = typeof state.sourcePath === "string"
      ? state.sourcePath
      : typeof state.file === "string"
        ? state.file
        : "";
    const activeFile = this.app.workspace.getActiveFile();
    const activePath = activeFile instanceof TFile ? activeFile.path : "";
    const leafFile = (leaf.view as { file?: unknown }).file;
    const leafFilePath = leafFile instanceof TFile ? leafFile.path : "";

    if (viewState.type === VIEW_TYPE_MOBILE_INK && statePath === file.path) return;

    const leafLooksRelatedToFile = activePath === file.path
      || leafFilePath === file.path
      || statePath === file.path
      || viewState.type === VIEW_TYPE_MOBILE_INK;
    if (!leafLooksRelatedToFile) return;

    this.defaultPdfOpenPath = file.path;
    try {
      await this.openInkForFile(file, leaf);
    } finally {
      window.setTimeout(() => {
        if (this.defaultPdfOpenPath === file.path) {
          this.defaultPdfOpenPath = null;
        }
      }, 0);
    }
  }

  private queueOpenPdfWithAnnotationByDefault(file: TFile | null): void {
    if (!(file instanceof TFile) || file.extension !== "pdf") return;

    for (const delay of [0, 80, 240]) {
      window.setTimeout(() => {
        void this.openPdfWithAnnotationByDefaultIfNeeded(file);
      }, delay);
    }
  }

  openActivePdfWithAnnotationIfEnabled(): void {
    const file = this.app.workspace.getActiveFile();
    if (!(file instanceof TFile) || file.extension !== "pdf") return;

    void this.openPdfWithAnnotationByDefaultIfNeeded(file);
  }

  /** 本版本不区分基础版/进阶版，所有功能门禁一律放行。 */
  hasFeature(_feature: string): boolean {
    return true;
  }

  async loadSettings(): Promise<void> {
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(await this.loadData())
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

class MobileInkAnnotationSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: MobileInkAnnotationPlugin
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("PDF 默认使用标注视图打开")
      .setDesc("开启后，点击 PDF 文件会自动切换到本插件的 PDF 标注视图，并显示已保存的手写标注、文字高亮、下划线和批注。关闭后，之后打开 PDF 会继续使用 Obsidian 原生 PDF 视图。")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.openPdfWithAnnotationByDefault)
          .onChange(async (value) => {
            this.plugin.settings.openPdfWithAnnotationByDefault = value;
            await this.plugin.saveSettings();
            if (value) {
              this.plugin.openActivePdfWithAnnotationIfEnabled();
              new Notice("已开启 PDF 默认标注视图。");
            } else {
              new Notice("已关闭 PDF 默认标注视图，之后打开 PDF 将使用 Obsidian 原生视图。");
            }
          });
      });
  }
}
