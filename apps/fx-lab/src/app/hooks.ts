/**
 * Test hooks of the fx-lab (`window.__fxlab`, contract for rfx-p7 benchmarks/E2E) and the sample ring
 * of the last {@link SAMPLE_RING_SIZE} frames.
 */
import type { RenderPresetName } from '@faf/render';
import type { FxSegment } from '@faf/render-fx';
import type { LabFxStats, SceneName } from './context.ts';

export const SAMPLE_RING_SIZE = 2048;

/** GPU segments in encode order (= FX_SEGMENTS of render-fx). */
export const LAB_SEGMENTS: readonly FxSegment[] = ['shadow', 'opaque', 'shields', 'particles', 'beams', 'post'];

export type SegmentRecord<T> = { [K in FxSegment]: T };

export interface FxLabSample {
  frame: number;
  /** Scene time of the frame (s). */
  t: number;
  /** rAF interval (ms). */
  frameMs: number;
  /** Whole frame callback (ms). */
  mainJsMs: number;
  /** render-fx CPU: LabFx.update + all FX encodes + scorch/shadows/post (ms). */
  fxJsMs: number;
  /** scene.update (ms). */
  labJsMs: number;
  draws: number;
  /** Transparent shields + particles + beams/trails of this frame (draw-budget gate). */
  fxDraws: number;
  /** Sum of the resolved GPU segments of this frame (null: no timer or not resolved yet). */
  gpuMs: number | null;
  gpuSeg: SegmentRecord<number | null>;
  particlesAlive: number;
}

export interface FxLabStats {
  draws: number;
  drawsBySeg: SegmentRecord<number>;
  fx: LabFxStats;
  scene: Record<string, number>;
  units: number;
  decals: { count: number; cap: number };
  csm: { enabled: boolean; staticRefreshes: number; staticDraws: number; dynamicDraws: number };
  post: { hdr: boolean; bloom: boolean; levels: number; fxaa: boolean };
  shakeActive: boolean;
  gpuTimer: boolean;
  canvas: [number, number];
}

export interface FxLabHooks {
  /** First frame after the scene init was presented (with `freeze`: after the freeze time was reached). */
  ready: boolean;
  frame: number;
  scene: SceneName;
  preset: RenderPresetName;
  error: string | null;
  restoreCount: number;
  stats(): FxLabStats;
  samples(): readonly FxLabSample[];
  resetSamples(): void;
  setScene(name: SceneName): void;
  /** Starts a context loss (debugLoseContext). false when WEBGL_lose_context is unavailable. */
  loseContext(): boolean;
  /** Restores a context lost via loseContext. false when unavailable or the loss was not observed yet. */
  restoreContext(): boolean;
  /** Forwards to the scene 'big' (immediate ACU explosion); no-op without it. */
  triggerBigExplosion(): void;
}

declare global {
  interface Window {
    __fxlab?: FxLabHooks;
  }
}

/**
 * Ring of per-frame samples (structure of arrays, no allocation per frame). GPU segment results arrive
 * a few frames late and are written into the sample of their frame via {@link setGpu}.
 */
export class SampleRing {
  readonly capacity: number;
  private readonly frame: Float64Array;
  private readonly t: Float64Array;
  private readonly frameMs: Float64Array;
  private readonly mainJs: Float64Array;
  private readonly fxJs: Float64Array;
  private readonly labJs: Float64Array;
  private readonly draws: Float64Array;
  private readonly fxDraws: Float64Array;
  private readonly alive: Float64Array;
  /** capacity × segments, NaN = not resolved. */
  private readonly gpu: Float64Array;
  private head = 0;
  private size = 0;

  constructor(
    capacity = SAMPLE_RING_SIZE,
    readonly segments: readonly FxSegment[] = LAB_SEGMENTS,
  ) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError(`SampleRing: invalid capacity ${capacity}`);
    this.capacity = capacity;
    this.frame = new Float64Array(capacity).fill(-1);
    this.t = new Float64Array(capacity);
    this.frameMs = new Float64Array(capacity);
    this.mainJs = new Float64Array(capacity);
    this.fxJs = new Float64Array(capacity);
    this.labJs = new Float64Array(capacity);
    this.draws = new Float64Array(capacity);
    this.fxDraws = new Float64Array(capacity);
    this.alive = new Float64Array(capacity);
    this.gpu = new Float64Array(capacity * segments.length).fill(Number.NaN);
  }

  /** Samples currently stored (≤ capacity). */
  get count(): number {
    return this.size;
  }

  push(frame: number, t: number, frameMs: number, mainJsMs: number, fxJsMs: number, labJsMs: number, draws: number, particlesAlive: number, fxDraws = 0): void {
    const i = this.head;
    this.frame[i] = frame;
    this.t[i] = t;
    this.frameMs[i] = frameMs;
    this.mainJs[i] = mainJsMs;
    this.fxJs[i] = fxJsMs;
    this.labJs[i] = labJsMs;
    this.draws[i] = draws;
    this.fxDraws[i] = fxDraws;
    this.alive[i] = particlesAlive;
    this.gpu.fill(Number.NaN, i * this.segments.length, (i + 1) * this.segments.length);
    this.head = (i + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
  }

  /**
   * Stores a resolved GPU segment time for `frame`. Returns false when that frame is no longer (or not
   * yet) in the ring.
   */
  setGpu(frame: number, segment: number, ms: number): boolean {
    if (segment < 0 || segment >= this.segments.length) return false;
    for (let k = 1; k <= this.size; k++) {
      const i = (this.head - k + this.capacity) % this.capacity;
      const f = this.frame[i]!;
      if (f === frame) {
        this.gpu[i * this.segments.length + segment] = ms;
        return true;
      }
      if (f < frame) return false;
    }
    return false;
  }

  /** Samples oldest → newest (allocates; for tests and benchmarks). */
  toArray(): FxLabSample[] {
    const out: FxLabSample[] = [];
    const nSeg = this.segments.length;
    for (let k = this.size; k >= 1; k--) {
      const i = (this.head - k + this.capacity) % this.capacity;
      const seg = {} as SegmentRecord<number | null>;
      let sum = 0;
      let complete = true;
      for (let s = 0; s < nSeg; s++) {
        const v = this.gpu[i * nSeg + s]!;
        const ok = !Number.isNaN(v);
        seg[this.segments[s]!] = ok ? v : null;
        if (ok) {
          sum += v;
        } else complete = false;
      }
      out.push({
        frame: this.frame[i]!,
        t: this.t[i]!,
        frameMs: this.frameMs[i]!,
        mainJsMs: this.mainJs[i]!,
        fxJsMs: this.fxJs[i]!,
        labJsMs: this.labJs[i]!,
        draws: this.draws[i]!,
        fxDraws: this.fxDraws[i]!,
        gpuMs: complete ? sum : null,
        gpuSeg: seg,
        particlesAlive: this.alive[i]!,
      });
    }
    return out;
  }

  reset(): void {
    this.head = 0;
    this.size = 0;
    this.frame.fill(-1);
    this.gpu.fill(Number.NaN);
  }
}
