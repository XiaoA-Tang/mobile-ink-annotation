import { App, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf } from "obsidian";
import { StrokeStore } from "./ink/StrokeStore";
import { AnnotationView } from "./views/AnnotationView";
import { VIEW_TYPE_MOBILE_INK } from "./constants";
import { probeNativePdfStructure } from "./pdf/nativePdfProbe";
import { NativePdfOverlayManager } from "./pdf/NativePdfOverlayManager";

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
  private nativePdfOverlay!: NativePdfOverlayManager;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.store = new StrokeStore(this.app, this);

    this.nativePdfOverlay = new NativePdfOverlayManager(this.app, this.store);
    this.nativePdfOverlay.onload();

    this.registerView(
      VIEW_TYPE_MOBILE_INK,
      (leaf) => new AnnotationView(leaf, this)
    );

    this.registerEvent(this.app.workspace.on("file-open", (file) => {
      this.queueOpenPdfWithAnnotationByDefault(file);
    }));

    this.addCommand({
      id: "probe-native-pdf-structure",
      name: "探测原生 PDF 视图结构 (SPIKE)",
      checkCallback: (checking) => {
        const leaf = this.app.workspace.activeLeaf;
        const ok = !!leaf && leaf.getViewState().type === "pdf";
        if (checking) return ok;
        if (!ok || !leaf) return false;
        const result = probeNativePdfStructure(leaf);
        const text = JSON.stringify(result, null, 2);
        console.log("[MobileInkProbe]", text);
        const pluginDir = this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`;
        void this.app.vault.adapter.write(`${pluginDir}/native-pdf-probe.json`, text);
        new Notice(`探测完成: 页候选数 ${result.candidatePageCount}, iframe=${result.iframeCount}, embed=${result.embeds.length}。结果写入 ${pluginDir}/native-pdf-probe.json`);
        return true;
      }
    });

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
    this.nativePdfOverlay?.onunload();
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

  private findLeafWithFile(file: TFile): WorkspaceLeaf | null {
    let found: WorkspaceLeaf | null = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (found) return;
      const viewState = leaf.getViewState();
      const state = (viewState.state ?? {}) as { file?: unknown; sourcePath?: unknown };
      const statePath = typeof state.sourcePath === "string"
        ? state.sourcePath
        : typeof state.file === "string"
          ? state.file
          : "";
      const leafFile = (leaf.view as { file?: unknown }).file;
      const leafFilePath = leafFile instanceof TFile ? leafFile.path : "";
      if (statePath === file.path || leafFilePath === file.path) {
        found = leaf;
      }
    });
    return found;
  }

  private isLeafShowingFile(leaf: WorkspaceLeaf, file: TFile): boolean {
    const viewState = leaf.getViewState();
    const state = (viewState.state ?? {}) as { file?: unknown; sourcePath?: unknown };
    const statePath = typeof state.sourcePath === "string"
      ? state.sourcePath
      : typeof state.file === "string"
        ? state.file
        : "";
    const leafFile = (leaf.view as { file?: unknown }).file;
    const leafFilePath = leafFile instanceof TFile ? leafFile.path : "";
    return statePath === file.path || leafFilePath === file.path;
  }

  private isPdfViewLoaded(leaf: WorkspaceLeaf | null): boolean {
    if (!leaf || leaf.getViewState().type !== "pdf") return false;
    const el = leaf.view.containerEl;
    if (!el) return false;
    return !!el.querySelector(".pdf-view, canvas, .pdf-embed, embed");
  }

  private async openPdfWithAnnotationByDefaultIfNeeded(file: TFile | null): Promise<boolean> {
    if (!this.settings.openPdfWithAnnotationByDefault) return true;
    if (!(file instanceof TFile) || file.extension !== "pdf") return true;
    if (this.defaultPdfOpenPath === file.path) return true;

    const leaf = this.findLeafWithFile(file) ?? this.app.workspace.activeLeaf;
    if (!leaf || !this.isLeafShowingFile(leaf, file)) return false;
    if (!this.isPdfViewLoaded(leaf)) return false;

    if (leaf.getViewState().type === VIEW_TYPE_MOBILE_INK) return true;

    this.defaultPdfOpenPath = file.path;
    try {
      await this.openInkForFile(file, leaf);
    } catch (e) {
      new Notice("标注视图切换失败: " + String(e));
    } finally {
      window.setTimeout(() => {
        if (this.defaultPdfOpenPath === file.path) {
          this.defaultPdfOpenPath = null;
        }
      }, 0);
    }
    return true;
  }

  private queueOpenPdfWithAnnotationByDefault(file: TFile | null): void {
    if (!(file instanceof TFile) || file.extension !== "pdf") return;

    let attempts = 0;
    const maxAttempts = 120;
    const retry = (): void => {
      void this.openPdfWithAnnotationByDefaultIfNeeded(file)
        .then((done) => {
          if (done || attempts >= maxAttempts) {
            if (!done) {
              new Notice("标注自动切换失败: PDF未加载完成");
            }
            return;
          }
          attempts += 1;
          window.setTimeout(retry, 200);
        })
        .catch(() => {});
    };
    retry();
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
