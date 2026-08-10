import type { App } from "obsidian";
import type { InkEngine } from "../../ink/InkEngine";
import type { InkToolState } from "../../ink/types";
import type { StrokeStore } from "../../ink/StrokeStore";
import type { LogicalPage, ScreenRect } from "../../pdf/nativePdfGeometry";

export type OverlayEngineEntry = {
  engine: InkEngine;
  page: LogicalPage;
  rect: ScreenRect;
  basisRect: ScreenRect;
  live: HTMLCanvasElement;
  committed: HTMLCanvasElement;
  pageEl: HTMLElement;
};

export type ToolbarHost = {
  getToolState(): InkToolState;
  applyToolState(patch: Partial<InkToolState>): void;
  onUndo(): void;
  onRedo(): void;
  getOverlay(): HTMLElement | null;
  getWidthAnchor(): HTMLElement | null;
};

export type OverlayHost = {
  app: App;
  store: StrokeStore;
};