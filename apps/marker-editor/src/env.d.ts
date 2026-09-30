/// <reference types="vite/client" />

import type { TerrainViewStats } from './view/terrain-view.ts';

/** Test/debug hook of the terrain view (E2E view.spec.ts). */
export interface EditorViewHook {
  /** True once the current map has been rendered at least once. */
  ready: boolean;
  /** Name of the loaded map (file name without .rtsmap), null before the first load. */
  mapName: string | null;
  /** Last load error message, null if the last load succeeded. */
  error: string | null;
  /** Milliseconds from load start (fetch) to the first rendered frame of the last load. */
  loadMs: number;
  stats(): TerrainViewStats;
  /** Loads /maps/<name>.rtsmap and resolves after its first rendered frame. */
  load(name: string): Promise<void>;
  /** Requests one render and resolves after it has happened. */
  frame(): Promise<void>;
  /**
   * Renders `n` frames synchronously, each followed by a 1-pixel readPixels (waits for the GPU):
   * frame time including GPU work, in ms (a measurement aid, not a steady-state frame rate).
   */
  benchFrames(n: number): { readonly frames: number; readonly avgMs: number; readonly p95Ms: number; readonly maxMs: number };
}

declare global {
  interface Window {
    __editorView?: EditorViewHook;
  }
}
