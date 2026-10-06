/**
 * Contract between the render-fx smoke harness (smoke/main.ts, scripts/smoke.ts) and its cases
 * (smoke/cases/<name>.ts, each exporting `smokeCase: SmokeCase`).
 */
import type { RtsCamera, WebGL2Device } from '@faf/render';
import type { FxFrameUniforms, GpuSpanTimer } from '../src/index.ts';

export interface SmokeContext {
  dev: WebGL2Device;
  canvas: HTMLCanvasElement;
  camera: RtsCamera;
  /** Updated by the harness before every `frame()` (time t, dt 1/60, drawing-buffer viewport). */
  frame: FxFrameUniforms;
  /** Drawing-buffer size in pixels (960×540, DPR ignored). */
  width: number;
  height: number;
  /**
   * RGBA8 pixels of the canvas; call directly after `frame()` (i.e. inside `frame` or `check`).
   * Canvas coordinates, rows from the top (row 0 = top), `w × h × 4` bytes.
   */
  readPixels(x: number, y: number, w: number, h: number): Uint8Array;
  /** World position (WU) → canvas pixels (top-left origin). */
  project(xWu: number, yWu: number, zWu: number): [number, number];
  /**
   * GPU timer with segment 0 = 'frame' (started by the harness before `frame()`) plus the case's
   * `segments`; a case may switch segments inside `frame()` via `timer.beginNamed(name)`.
   */
  timer: GpuSpanTimer;
}

export interface SmokeCase {
  readonly name: string;
  /** Frames rendered before `check` (default 30, dt 1/60). */
  readonly frames?: number;
  /** Extra GPU timer segments (reported as p50 ms in the smoke report). */
  readonly segments?: readonly string[];
  setup(ctx: SmokeContext): void;
  /** Renders one frame at time t (s); returns the draw calls issued. */
  frame(ctx: SmokeContext, t: number): number;
  /** Error texts, empty = ok. Runs directly after the last `frame()`. */
  check?(ctx: SmokeContext): string[];
  destroy(ctx: SmokeContext): void;
}

/** Result the page publishes on `window.__smoke`. */
export interface SmokeState {
  done: boolean;
  error: string | null;
  case: string;
  /** Draws of the last frame. */
  draws: number;
  frames: number;
  checks: string[];
  /** Median GPU ms per timer segment (null = no timer query / no results). */
  gpuMs: Record<string, number | null>;
  /** Median JS ms of `frame()` (incl. uniform update). */
  jsMs: number;
  renderer: string;
  caps: { colorBufferFloat: boolean; timerQuery: boolean; loseContext: boolean };
  /** Loses and restores the context, renders again and re-runs `check`. */
  loseAndRestore(): Promise<{ supported: boolean; checks: string[]; draws: number }>;
  /** Destroys the case and returns remaining GL errors. */
  finish(): string[];
}

declare global {
  interface Window {
    __smoke?: SmokeState;
  }
}
