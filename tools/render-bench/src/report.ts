/**
 * Result shape of one scenario run (page → Node script) and the per-browser report.
 */
import type { PassDrawStats } from './bench-renderer.ts';
import type { ScenarioName } from './scenarios.ts';
import type { Summary } from './stats.ts';

export interface RunOptions {
  readonly scenario: ScenarioName;
  /** Warm-up flight (not measured), seconds. */
  readonly warmupS: number;
  /** Measured flight, seconds. */
  readonly measureS: number;
}

export interface ScenarioResult {
  readonly scenario: ScenarioName;
  readonly ok: boolean;
  readonly errors: string[];
  readonly userAgent: string;
  /** WEBGL_debug_renderer_info (unmasked) where exposed. */
  readonly gpuRenderer: string;
  readonly caps: { timerQuery: boolean; colorBufferFloat: boolean; multiDraw: boolean; crossOriginIsolated: boolean };
  readonly viewport: { width: number; height: number; dpr: number };
  readonly backbuffer: { width: number; height: number };
  readonly info: Record<string, string | number | boolean>;
  readonly frames: number;
  readonly measuredS: number;
  readonly fps: number;
  readonly draws: Summary;
  /** Maximum draws per pass group over the measured frames. */
  readonly drawsByPassMax: PassDrawStats;
  readonly drawBudget: { limit: number; bound: number; framesOver: number };
  /** Main-thread JS per frame: CPU culling + render submission (performance.now). */
  readonly mainJsMs: Summary;
  /**
   * Granularity of performance.now seen in the Main-JS samples. ≥ 0.1 ms (WebKit: 1 ms) ⇒ the
   * percentiles are quantized; the mean over all frames stays unbiased and is reported instead.
   */
  readonly clockResolutionMs: number;
  /** GPU time per frame (EXT_disjoint_timer_query_webgl2), null where unavailable. */
  readonly gpuMs: Summary | null;
  /** GPU time per segment (prototype: 0 uploads + shadows, 1 scene, 2 post), null for the facade. */
  readonly gpuSegmentsMs: Summary[] | null;
  readonly gpuTimer: { available: boolean; samples: number; disjoint: number; skipped: number };
  /** rAF interval (ms). */
  readonly frameMs: Summary;
  readonly unitInstances: Summary;
  readonly propInstances: Summary;
  readonly impostorInstances: Summary;
  readonly terrainPatches: Summary;
  readonly casterUnits: Summary;
  readonly shadowRefreshes: number;
  /** Synthetic sim ticks during the measurement (units moved at 10 Hz). */
  readonly ticks: number;
  /** Foreign GPU/browser load seen during the run (filled by the Node script; empty = clean). */
  readonly contention?: string[];
}

export interface BrowserReport {
  readonly browser: string;
  readonly version: string;
  readonly results: ScenarioResult[];
  readonly errors: string[];
  /** WebGL/console warnings that are not errors (implementation notes of the browser). */
  readonly warnings: string[];
}

export interface Spk4Report {
  readonly date: string;
  readonly mode: 'quick' | 'full';
  readonly machine: { platform: string; arch: string; cpus: string; memGB: number; note: string };
  readonly load: { before: number[]; after: number[]; concurrent: string[] };
  readonly browsers: BrowserReport[];
  readonly exitCode: number;
}

/** Page API of the benchmark (src/main.ts), used by scripts/spk4.ts through page.evaluate. */
export interface Spk4PageApi {
  ready: boolean;
  error: string | null;
  run(opts: RunOptions): Promise<ScenarioResult>;
}

declare global {
  interface Window {
    __spk4?: Spk4PageApi;
  }
}
