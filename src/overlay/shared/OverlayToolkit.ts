import type { InkToolState } from "../../ink/types";
import { SaveQueue } from "../../ink/SaveQueue";
import type { OverlayHost } from "./types";

export const WIDTH_MIN = 1;
export const WIDTH_MAX = 14;
export const WIDTH_PRESETS = [2, 3, 5, 8];

export const COLOR_PRIMARIES = ["#111111", "#e53935", "#1e88e5", "#43a047", "#ffb300", "#8e24aa", "#ffffff"];

export const COLOR_SHADES: Record<string, string[]> = {
  "#111111": ["#eeeeee", "#cccccc", "#888888", "#444444", "#111111"],
  "#e53935": ["#ffcdd2", "#ef9a9a", "#e57373", "#ef5350", "#e53935"],
  "#1e88e5": ["#bbdefb", "#90caf9", "#64b5f6", "#42a5f5", "#1e88e5"],
  "#43a047": ["#c8e6c9", "#a5d6a7", "#81c784", "#66bb6a", "#43a047"],
  "#ffb300": ["#ffe082", "#ffd54f", "#ffca28", "#ffc107", "#ffb300"],
  "#8e24aa": ["#e1bee7", "#ce93d8", "#ba68c8", "#ab47bc", "#8e24aa"],
  "#ffffff": ["#ffffff", "#f5f5f5", "#eeeeee", "#e0e0e0", "#bdbdbd"]
};

export class OverlayToolkit {
  toolState: InkToolState = {
    tool: "pen", color: "#111111", width: 2,
    highlighterColor: "#ffd54a", highlighterWidth: 14,
    eraserRadius: 18, acceptTouchInput: false
  };

  private activeEngines: Array<{ setToolState(patch: Partial<InkToolState>): void }> = [];
  private saveQueue: SaveQueue;

  constructor(
    private readonly host: OverlayHost,
    saveFn: () => Promise<void>,
    debounceMs = 800
  ) {
    this.saveQueue = new SaveQueue(saveFn, debounceMs);
  }

  currentInkColor(): string {
    return this.toolState.tool === "highlighter" ? this.toolState.highlighterColor : this.toolState.color;
  }

  applyToolState(patch: Partial<InkToolState>): void {
    Object.assign(this.toolState, patch);
    for (const e of this.activeEngines) e.setToolState({ ...patch });
  }

  setActiveEngines(engines: Array<{ setToolState(patch: Partial<InkToolState>): void }>): void {
    this.activeEngines = engines;
  }

  markDirty(): void {
    this.saveQueue.markDirty();
  }

  async flush(): Promise<void> {
    await this.saveQueue.flush();
  }
}