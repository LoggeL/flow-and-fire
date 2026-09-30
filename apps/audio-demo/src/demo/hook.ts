/**
 * Test hook contract of the demo page (`window.__fafAudioDemo`), shared by the page, the
 * Playwright specs and the browser benchmark (documented in docs/status/audioeng-c2.md).
 */

import type { AlertRecord, AudioSettings, AudioStats, DecodePath, SoundCategory, TimingStats } from '@faf/audio';
import type { FafAudioEngine } from '@faf/audio/engine';
import type { CameraPose } from './camera.ts';
import type { ScenarioStats } from './scenario.ts';

/** Options of `start()`; omitted fields keep the URL / current values. */
export interface DemoStartOptions {
  /** Shots per second. */
  shots?: number | undefined;
  /** Sim speed 0.25..3. */
  speed?: number | undefined;
  seed?: number | undefined;
  /** Sim seconds until the battle stops by itself (null = endless). */
  seconds?: number | null | undefined;
}

/** Load state of the demo's sound bank. */
export interface DemoLoadState {
  phase: 'manifest' | 'loading' | 'done' | 'error';
  /** Variants finished (all load calls). */
  done: number;
  total: number;
  failed: number;
  /** Wall time of all load calls in ms. */
  ms: number;
  paths: Record<DecodePath, number>;
  error: string | null;
}

/** Snapshot returned by `stats()`. */
export interface DemoStats {
  engine: AudioStats;
  scenario: ScenarioStats & { running: boolean; shotsPerSecond: number; speed: number; seed: number };
  /** Main-thread cost of the scenario generator per frame (ms, whole run). */
  generator: TimingStats;
  /**
   * JS time of all engine calls per frame measured by the demo around the calls (handleEvents,
   * setLoop, setListener, update, playUi, jumpToLastAlert) over the whole run (ms). The engine's
   * own `engine.mainJs` covers only its last 1024 frames.
   */
  engineCalls: TimingStats;
  /** Like `engineCalls`, but only frames that carried at least one sim tick (event batch). */
  engineCallsTickFrames: TimingStats;
  /** Highest logical voice count seen after any engine call since start(). */
  maxVoicesSeen: number;
  maxTailsSeen: number;
  maxByCategorySeen: Record<SoundCategory, number>;
  /** Category voice limits from the manifest. */
  categoryLimits: Record<SoundCategory, number>;
  /** Global voice budget. */
  voiceLimit: number;
  /** Frames rendered since start(). */
  frames: number;
  /** Wall time since start() in ms. */
  runMs: number;
  camera: CameraPose & { viewHalfWidth: number };
  load: DemoLoadState;
  /** Last UI acknowledgement: ms from the input event to the synchronous playUi return. */
  ack: { count: number; started: number; lastLatencyMs: number | null };
  crossOriginIsolated: boolean;
  /** Smallest observed step of performance.now() in ms (timer coarsening of the browser). */
  timerResolutionMs: number;
  contextState: string;
  sampleRate: number;
}

export interface DemoHook {
  /** Resolves once the manifest and the battle sounds are loaded (rejects on load errors). */
  ready: Promise<void>;
  start(opts?: DemoStartOptions): void;
  stop(): void;
  /** Resets engine statistics, timing rings and peak trackers without restarting the battle (after a warm-up). */
  resetStats(): void;
  readonly running: boolean;
  stats(): DemoStats;
  readonly engine: FafAudioEngine;
  setCamera(p: Partial<CameraPose>): void;
  camera(): CameraPose & { viewHalfWidth: number };
  alerts(): AlertRecord[];
  settings(): Readonly<AudioSettings>;
  /** Plays the click acknowledgement (same as the HUD button). */
  ack(): boolean;
}

declare global {
  interface Window {
    __fafAudioDemo?: DemoHook;
  }
}

/** Growable ring of per-frame durations (ms) with percentiles on demand. */
export class TimingRing {
  private values: Float64Array;
  private n = 0;

  constructor(capacity = 1 << 16) {
    this.values = new Float64Array(capacity);
  }

  get count(): number {
    return this.n;
  }

  push(v: number): void {
    if (this.n === this.values.length) {
      // Keep the newest half: bounded memory for endless runs.
      this.values.copyWithin(0, this.n >> 1, this.n);
      this.n -= this.n >> 1;
    }
    this.values[this.n++] = v;
  }

  clear(): void {
    this.n = 0;
  }

  /** Nearest-rank percentiles (allocates a sorted copy; call rarely). */
  stats(): TimingStats {
    const n = this.n;
    if (n === 0) return { samples: 0, p50: 0, p95: 0, p99: 0, max: 0 };
    const s = this.values.slice(0, n).sort();
    const at = (p: number): number => s[Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1))]!;
    return { samples: n, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: s[n - 1]! };
  }
}
