/**
 * Frame consumer with adaptive render delay (PLAN §3.6 "Interpolation", G14, SPK6).
 *
 * Per rAF the client calls `poll(now)` once. The transport already copies on arrival (SAB triple
 * buffer / transfer ping-pong); the returned view is used as is — no second copy. The view stays
 * valid until the next `poll()` that returns a new frame, so the renderer can take the UnitRecord
 * bytes straight from it.
 *
 * Timing model. Every frame n carries prev = P(tₙ − 1) and cur = P(tₙ). The display runs on a
 * continuous clock `play` (in ticks); alpha = clamp(play − (tₙ − 1), 0, 1) interpolates prev → cur.
 * The clock advances with wall time (1 tick = 100 ms / speed from the frame header) and is steered
 * softly (time constant `steerTauMs`) towards
 *
 *     target(now) = tₙ + (now − arrivalₙ)/T − 1/2 − delay/T
 *
 * i.e. it trails the newest known sim state by `delay` + ½ tick on average: with delay = ½ tick
 * the display is 1 tick behind at arrival and reaches cur just when the next frame is due, so the
 * average lag behind the newest frame is ½ tick (the plan's target). `delay` adapts:
 *
 *     delay = targetDelayTicks·T + jitter,  jitter = p90(|interval − T|) of the recent arrival
 *     intervals (normalised per tick, capped at `maxJitterTicks`·T)
 *
 * so irregular arrivals (worker scheduling, catch-up slices) are absorbed instead of stalling at
 * alpha = 1. Large errors (> `snapTicks`, e.g. after a background tab) snap the clock.
 *
 * Pause (header flag): alpha = 1, frozen; the clock resynchronises on the first frame after
 * resume. `noInterp` records are handled by the shader (draw at cur).
 */
import { FrameReader, UNIT_RECORD_BYTES, type FrameConsumer } from '@faf/protocol';

/** Nominal tick length at 1x speed (10 Hz). */
export const BASE_TICK_MS = 100;

export interface FrameStreamOptions {
  /** Base render delay in ticks on top of the inherent prev→cur tick (plan: ≈ 0.5). */
  readonly targetDelayTicks?: number;
  /** Arrival intervals kept for the jitter estimate (default 32). */
  readonly historySize?: number;
  /** Cap of the jitter buffer in ticks (default 0.5). */
  readonly maxJitterTicks?: number;
  /** Time constant of the clock steering in ms (default 200). */
  readonly steerTauMs?: number;
  /** Clock error (ticks) beyond which the clock snaps instead of steering (default 1.5). */
  readonly snapTicks?: number;
}

export class FrameStream {
  readonly consumer: FrameConsumer;
  /** Reader bound to the newest frame (valid if `hasFrame`). */
  readonly reader = new FrameReader();
  readonly targetDelayTicks: number;
  readonly maxJitterTicks: number;
  readonly steerTauMs: number;
  readonly snapTicks: number;

  hasFrame = false;
  /** Newest frame's raw bytes (consumer-owned view). */
  bytes: Uint8Array = new Uint8Array(0);
  /** Frames accepted so far (also the render version key of the unit data). */
  frameCount = 0;
  /** Frames rejected by the reader (bad magic/bounds). */
  invalidFrames = 0;
  /** Sim ticks that never reached the client as a frame (skipped by the transport). */
  skippedTicks = 0;
  /** Clock snaps (resynchronisations). */
  snaps = 0;

  tick = 0;
  paused = false;
  speedPermille = 1000;
  /** Tick length in ms at the current speed. */
  tickMs = BASE_TICK_MS;
  ackSeq = 0;
  /** Local time (ms) the newest frame was polled. */
  arrivalMs = 0;

  /** Current jitter buffer in ms. */
  jitterMs = 0;
  /** Current adaptive render delay in ms (average lag of the display behind the newest frame). */
  renderDelayMs: number;
  /** Alpha of the last `alpha()` call. */
  lastAlpha = 1;
  /** Display clock in ticks. */
  play = 0;

  private readonly intervals: Float64Array;
  private readonly scratch: Float64Array;
  private intervalCount = 0;
  private intervalHead = 0;
  private lastNow = 0;
  private resync = true;
  private unitsCache: Uint8Array = new Uint8Array(0);
  private unitsCacheSrc: Uint8Array | null = null;
  private unitsCacheOff = -1;

  constructor(consumer: FrameConsumer, opts: FrameStreamOptions = {}) {
    this.consumer = consumer;
    this.targetDelayTicks = opts.targetDelayTicks ?? 0.5;
    this.maxJitterTicks = opts.maxJitterTicks ?? 0.5;
    this.steerTauMs = opts.steerTauMs ?? 200;
    this.snapTicks = opts.snapTicks ?? 1.5;
    const n = Math.max(4, opts.historySize ?? 32);
    this.intervals = new Float64Array(n);
    this.scratch = new Float64Array(n);
    this.renderDelayMs = this.targetDelayTicks * BASE_TICK_MS;
  }

  /** Number of UnitRecords in the newest frame. */
  get unitCount(): number {
    return this.hasFrame ? this.reader.unitCount : 0;
  }

  /**
   * Takes the newest frame from the transport (if any). Returns true when a new frame was
   * accepted; the reader, header fields, jitter estimate and render delay are updated.
   */
  poll(nowMs: number): boolean {
    const bytes = this.consumer.poll();
    if (bytes === null) return false;
    const r = this.reader;
    if (!r.reset(bytes)) {
      // The consumer may have reused the previous frame's buffer: nothing valid to show anymore.
      this.invalidFrames++;
      this.hasFrame = false;
      this.resync = true;
      return false;
    }
    const prevTick = this.tick;
    const prevArrival = this.arrivalMs;
    const hadFrame = this.hasFrame;
    const wasPaused = this.paused;

    this.bytes = bytes;
    this.hasFrame = true;
    this.frameCount++;
    this.tick = r.tick;
    this.paused = r.paused;
    this.ackSeq = r.ackSeq;
    this.arrivalMs = nowMs;
    const sp = r.speedPermille;
    if (sp !== this.speedPermille && sp > 0) {
      this.speedPermille = sp;
      this.intervalCount = 0;
      this.resync = true;
    }
    this.tickMs = BASE_TICK_MS * (1000 / (this.speedPermille > 0 ? this.speedPermille : 1000));

    const dTick = this.tick - prevTick;
    if (hadFrame && dTick > 1) this.skippedTicks += dTick - 1;
    if (!hadFrame || this.paused || wasPaused || dTick <= 0 || dTick > 8) {
      // First frame, pause/resume edge, step while paused, or discontinuity: no interval sample.
      if (!this.paused) this.resync = true;
    } else {
      this.pushInterval((nowMs - prevArrival) / dTick);
    }
    this.updateDelay();
    return true;
  }

  /**
   * Interpolation factor prev → cur for the display at `nowMs`; advances the display clock.
   * 1 while paused or without a frame.
   */
  alpha(nowMs: number): number {
    const dt = nowMs - this.lastNow;
    this.lastNow = nowMs;
    if (!this.hasFrame || this.paused) {
      this.play = this.tick;
      this.resync = true;
      this.lastAlpha = 1;
      return 1;
    }
    const T = this.tickMs;
    const target = this.tick + (nowMs - this.arrivalMs) / T - 0.5 - this.renderDelayMs / T;
    if (this.resync) {
      this.play = target;
      this.resync = false;
    } else {
      this.play += (dt > 0 ? dt : 0) / T;
      const err = target - this.play;
      if (err > this.snapTicks || err < -this.snapTicks) {
        this.play = target;
        this.snaps++;
      } else if (dt > 0) {
        const k = dt >= this.steerTauMs ? 1 : dt / this.steerTauMs;
        this.play += err * k;
      }
    }
    const a = this.play - (this.tick - 1);
    const alpha = a < 0 ? 0 : a > 1 ? 1 : a;
    this.lastAlpha = alpha;
    return alpha;
  }

  /**
   * UnitRecord section of the newest frame (view, 48 B per record). Cached per frame buffer so the
   * steady state does not allocate.
   */
  units(): Uint8Array {
    if (!this.hasFrame) return this.unitsCache.subarray(0, 0);
    const r = this.reader;
    const off = r.unitsOffset;
    const len = r.unitCount * UNIT_RECORD_BYTES;
    const b = this.bytes;
    const c = this.unitsCache;
    if (this.unitsCacheSrc === b && this.unitsCacheOff === off && c.length === len) return c;
    const v = b.subarray(off, off + len);
    this.unitsCache = v;
    this.unitsCacheSrc = b;
    this.unitsCacheOff = off;
    return v;
  }

  /** Recent arrival intervals (ms per tick), oldest first, into `out`; returns the count. */
  intervalsInto(out: Float64Array): number {
    const n = Math.min(this.intervalCount, out.length);
    const cap = this.intervals.length;
    const start = (this.intervalHead - this.intervalCount + cap) % cap;
    for (let i = 0; i < n; i++) out[i] = this.intervals[(start + i) % cap]!;
    return n;
  }

  // ---- internals ------------------------------------------------------------------------------

  private pushInterval(ms: number): void {
    const cap = this.intervals.length;
    this.intervals[this.intervalHead] = ms;
    this.intervalHead = (this.intervalHead + 1) % cap;
    if (this.intervalCount < cap) this.intervalCount++;
  }

  private updateDelay(): void {
    const T = this.tickMs;
    const n = this.intervalCount;
    let jitter = 0;
    if (n >= 2) {
      const s = this.scratch;
      // Insertion sort of |interval − T| (n ≤ historySize, allocation-free).
      for (let i = 0; i < n; i++) {
        const v = Math.abs(this.intervals[i]! - T);
        let j = i - 1;
        while (j >= 0 && s[j]! > v) {
          s[j + 1] = s[j]!;
          j--;
        }
        s[j + 1] = v;
      }
      jitter = s[Math.min(n - 1, Math.floor(n * 0.9))]!;
    }
    const cap = this.maxJitterTicks * T;
    this.jitterMs = jitter > cap ? cap : jitter;
    this.renderDelayMs = this.targetDelayTicks * T + this.jitterMs;
  }
}
