import { App, Notice, Plugin, PluginSettingTab } from "obsidian";
import { StrokeStore } from "./ink/StrokeStore";
import { VIEW_TYPE_MOBILE_INK } from "./constants";
import { PdfOverlayAdapter } from "./overlay/pdf/PdfOverlayAdapter";
import { MarkdownOverlayAdapter } from "./overlay/markdown/MarkdownOverlayAdapter";

export type SavedFilePosition =
  | { kind: "pdf"; page: number }
  | { kind: "markdown"; scrollTop: number };

type MobileInkAnnotationSettings = {
  savedPositions: Record<string, SavedFilePosition>;
};

const DEFAULT_SETTINGS: MobileInkAnnotationSettings = {
  savedPositions: {}
};

export default class MobileInkAnnotationPlugin extends Plugin {
  store!: StrokeStore;
  settings!: MobileInkAnnotationSettings;
  private nativePdfOverlay!: PdfOverlayAdapter;
  private markdownOverlay!: MarkdownOverlayAdapter;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.store = new StrokeStore(this.app, this);

    this.nativePdfOverlay = new PdfOverlayAdapter(this.app, this.store);
    this.nativePdfOverlay.onload();

    this.markdownOverlay = new MarkdownOverlayAdapter(this.app, this.store);
    this.markdownOverlay.onload();

    this.addCommand({
      id: "dump-native-overlay-diagnostics",
      name: "导出原生覆盖层诊断日志到笔记 (调试)",
      checkCallback: (checking) => {
        if (checking) return true;
        const data = this.nativePdfOverlay.collectDiagnostics();
        const text = "```json\n" + JSON.stringify(data, null, 2) + "\n```";
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const notePath = `mobile-ink-diagnostics-${stamp}.md`;
        void this.app.vault.create(notePath, `# Mobile Ink 诊断日志\n\n时间: ${new Date().toISOString()}\n\n${text}\n`)
          .then(() => new Notice(`诊断日志已写入 ${notePath}`))
          .catch((e) => new Notice("诊断日志写入失败: " + String(e)));
        return true;
      }
    });

    this.addSettingTab(new MobileInkAnnotationSettingTab(this.app, this));
  }

  onunload(): void {
    this.nativePdfOverlay?.onunload();
    this.markdownOverlay?.onunload();
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_MOBILE_INK);
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
  }
}
