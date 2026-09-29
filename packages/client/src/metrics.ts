/**
 * Latency chain (SPK6) and main-thread metrics.
 *
 * Measured per move click (`beginClick`):
 * - click timestamp: `event.timeStamp` (same time origin as `performance.now()`),
 * - click marker: first rendered rAF after the click (ms and rAF count; ≤ 1 frame is the gate),
 * - seq confirmation: arrival (poll) of the first frame whose `ackSeq` ≥ the command's seq,
 * - "first moved pixel": first rAF in which one of the commanded units is drawn ≥ 1 CSS pixel away
 *   from how it was drawn at click time: either its interpolated position — projected with the
 *   camera of that rAF — differs by ≥ 1 px from its position at click time (projected with the same
 *   camera), or its interpolated heading turned so far that the hull's outer corner (radius from
 *   `setVisualRadii`) moved ≥ 1 px (chord length × the smaller on-screen scale of the ground axes at
 *   the unit). Projecting with the current camera makes the measure independent of camera motion.
 *   Up to `SAMPLE_UNITS` units that stand still (position and heading) at click time are sampled; if
 *   every commanded unit was already moving, the measurement is counted in `movingAtClick` and not
 *   used for the latency distribution.
 * Plus main-thread JS time per rAF callback and the rAF interval (FPS).
 *
 * Distributions are ring buffers (last `capacity` samples) with p50/p95/p99. `snapshot()` returns
 * a plain, structured-clonable object (window hooks, E2E).
 */
import { UnitFlags, type FrameReader } from '@faf/protocol';
import type { RtsCamera } from '@faf/render';
import { interpolatedPos } from './selection.ts';

const NO_INTERP = UnitFlags.NoInterp;

/** Summary of one distribution. */
export interface StatSummary {
  readonly count: number;
  readonly mean: number;
  readonly min: number;
  readonly max: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
}

/** Fixed-size ring buffer of samples with percentile summaries. `push` does not allocate. */
export class RingStats {
  private readonly values: Float64Array;
  private head = 0;
  private n = 0;
  /** Samples pushed in total (including overwritten ones). */
  total = 0;

  constructor(readonly capacity = 1024) {
    this.values = new Float64Array(Math.max(1, capacity));
  }

  push(v: number): void {
    this.values[this.head] = v;
    this.head = (this.head + 1) % this.values.length;
    if (this.n < this.values.length) this.n++;
    this.total++;
  }

  get count(): number {
    return this.n;
  }

  /** Most recent sample (NaN if empty). */
  last(): number {
    if (this.n === 0) return Number.NaN;
    return this.values[(this.head - 1 + this.values.length) % this.values.length]!;
  }

  clear(): void {
    this.n = 0;
    this.head = 0;
  }

  /** Percentile p ∈ [0, 1] (nearest rank on the sorted samples); NaN if empty. Allocates a copy. */
  percentile(p: number): number {
    if (this.n === 0) return Number.NaN;
    const s = this.sorted();
    return s[rank(p, s.length)]!;
  }

  summary(): StatSummary {
    const n = this.n;
    if (n === 0) return { count: 0, mean: Number.NaN, min: Number.NaN, max: Number.NaN, p50: Number.NaN, p95: Number.NaN, p99: Number.NaN };
    const s = this.sorted();
    let sum = 0;
    for (let i = 0; i < n; i++) sum += s[i]!;
    return {
      count: n,
      mean: sum / n,
      min: s[0]!,
      max: s[n - 1]!,
      p50: s[rank(0.5, n)]!,
      p95: s[rank(0.95, n)]!,
      p99: s[rank(0.99, n)]!,
    };
  }

  private sorted(): Float64Array {
    const s = this.values.slice(0, this.n);
    s.sort();
    return s;
  }
}

/** Nearest-rank index of percentile p in n sorted samples. */
function rank(p: number, n: number): number {
  const r = Math.ceil(p * n) - 1;
  return r < 0 ? 0 : r >= n ? n - 1 : r;
}

/** Commanded units sampled per click for the "first moved pixel" test. */
export const SAMPLE_UNITS = 8;
/** Concurrent click measurements. */
export const MAX_MEASUREMENTS = 16;
/** A measurement that is not complete after this time is dropped (timeouts). */
export const MEASUREMENT_TIMEOUT_MS = 5000;
/** Minimum on-screen displacement for "moved". */
export const MOVED_PX = 1;

class Measurement {
  active = false;
  clickMs = 0;
  clickRaf = 0;
  seq = -1;
  markerDone = false;
  ackDone = false;
  movedDone = false;
  /** Sampled units were already moving at click time: no move latency sample. */
  moving = false;
  sampleCount = 0;
  readonly handles = new Uint32Array(SAMPLE_UNITS);
  /** Record index where the sample was last found (lookup hint). */
  readonly hint = new Int32Array(SAMPLE_UNITS);
  /** Click-time interpolated positions (raw, float), 3 per sample. */
  readonly pos = new Float64Array(SAMPLE_UNITS * 3);
  /** Click-time heading (Ang16) per sample. */
  readonly yaw = new Float64Array(SAMPLE_UNITS);
  /** Hull corner radius (WU) per sample; 0 = rotation not visible. */
  readonly radius = new Float64Array(SAMPLE_UNITS);
}

/** Interpolated heading (Ang16, float) of record `i` — shortest 16-bit arc, like the unit shader. */
export function interpolatedYaw(r: FrameReader, i: number, alpha: number, noInterp: boolean): number {
  const cur = r.unitCurYaw(i);
  if (noInterp) return cur;
  const prev = r.unitPrevYaw(i);
  const d = ((cur - prev + 98304) % 65536) - 32768;
  return prev + d * alpha;
}

const ANG16_TO_RAD = (2 * Math.PI) / 65536;
const RAW_PER_WU = 4096;

/** Extra live values merged into the snapshot (frame stream, commands). */
export interface MetricsSources {
  frame?(): Readonly<Record<string, number | boolean>>;
}

export interface MetricsSnapshot {
  readonly rafs: number;
  readonly fps: number;
  readonly rafIntervalMs: StatSummary;
  readonly mainJsMs: StatSummary;
  readonly clickToMarkerMs: StatSummary;
  readonly clickToMarkerFrames: StatSummary;
  readonly clickToAckMs: StatSummary;
  readonly clickToMoveMs: StatSummary;
  readonly clicks: number;
  readonly pendingMeasurements: number;
  readonly timeouts: number;
  readonly movingAtClick: number;
  readonly frame: Readonly<Record<string, number | boolean>>;
}

export class ClientMetrics {
  readonly rafInterval: RingStats;
  readonly mainJs: RingStats;
  readonly clickToMarkerMs: RingStats;
  readonly clickToMarkerFrames: RingStats;
  readonly clickToAckMs: RingStats;
  readonly clickToMoveMs: RingStats;
  rafs = 0;
  clicks = 0;
  timeouts = 0;
  movingAtClick = 0;
  sources: MetricsSources = {};

  private readonly ms: Measurement[] = [];
  private pending = 0;
  private lastRafTs = Number.NaN;
  private rafStart = 0;
  private readonly p = new Float64Array(3);
  private readonly sa = new Float64Array(4);
  private readonly sb = new Float64Array(4);
  private readonly sc = new Float64Array(4);
  private visualRadius: Float64Array = new Float64Array(0);

  constructor(capacity = 1024) {
    this.rafInterval = new RingStats(capacity);
    this.mainJs = new RingStats(capacity);
    this.clickToMarkerMs = new RingStats(capacity);
    this.clickToMarkerFrames = new RingStats(capacity);
    this.clickToAckMs = new RingStats(capacity);
    this.clickToMoveMs = new RingStats(capacity);
    for (let i = 0; i < MAX_MEASUREMENTS; i++) this.ms.push(new Measurement());
  }

  /**
   * Hull corner radius (WU) per visual index (UnitRecord.visual) for the rotation part of the
   * "first moved pixel" test; 0 (or a missing entry) = rotation is not visible (e.g. cylinders).
   */
  setVisualRadii(radii: ArrayLike<number>): void {
    this.visualRadius = Float64Array.from(radii as ArrayLike<number>);
  }

  /** Start of a rAF callback: `rafTs` is the rAF timestamp, `nowMs` = performance.now(). */
  beginRaf(rafTs: number, nowMs: number): void {
    if (!Number.isNaN(this.lastRafTs)) this.rafInterval.push(rafTs - this.lastRafTs);
    this.lastRafTs = rafTs;
    this.rafStart = nowMs;
    this.rafs++;
  }

  /** End of a rAF callback: records the main-thread JS time. */
  endRaf(nowMs: number): void {
    this.mainJs.push(nowMs - this.rafStart);
  }

  /**
   * Registers a move click. `handles` are the commanded units; up to SAMPLE_UNITS of them that
   * stand still in `reader`'s frame are sampled with their position interpolated at `alpha`.
   */
  beginClick(clickMs: number, seq: number, handles: ArrayLike<number>, reader: FrameReader | null, alpha: number): void {
    this.clicks++;
    let m: Measurement | null = null;
    for (let i = 0; i < this.ms.length; i++) {
      if (!this.ms[i]!.active) {
        m = this.ms[i]!;
        break;
      }
    }
    if (m === null) {
      // All slots busy: drop the oldest measurement.
      let oldest = this.ms[0]!;
      for (let i = 1; i < this.ms.length; i++) if (this.ms[i]!.clickMs < oldest.clickMs) oldest = this.ms[i]!;
      oldest.active = false;
      this.pending--;
      this.timeouts++;
      m = oldest;
    }
    m.active = true;
    this.pending++;
    m.clickMs = clickMs;
    m.clickRaf = this.rafs;
    m.seq = seq;
    m.markerDone = false;
    m.ackDone = false;
    m.movedDone = false;
    m.moving = false;
    m.sampleCount = 0;
    if (reader === null || handles.length === 0) {
      m.moving = true;
      this.movingAtClick++;
      m.movedDone = true;
      return;
    }
    // Sample spread over the selection: stride through the handle list.
    const nh = handles.length;
    const stride = Math.max(1, Math.floor(nh / SAMPLE_UNITS));
    const n = reader.unitCount;
    for (let k = 0; k < nh && m.sampleCount < SAMPLE_UNITS; k += stride) {
      const h = handles[k]! >>> 0;
      for (let i = 0; i < n; i++) {
        if (reader.unitHandle(i) !== h) continue;
        const still =
          reader.unitPrev(i, 0) === reader.unitCur(i, 0) &&
          reader.unitPrev(i, 1) === reader.unitCur(i, 1) &&
          reader.unitPrev(i, 2) === reader.unitCur(i, 2) &&
          reader.unitPrevYaw(i) === reader.unitCurYaw(i);
        if (!still) break;
        interpolatedPos(reader, i, alpha, this.p);
        const s = m.sampleCount++;
        m.yaw[s] = reader.unitCurYaw(i);
        const v = reader.unitVisual(i);
        m.radius[s] = v < this.visualRadius.length ? this.visualRadius[v]! : 0;
        m.handles[s] = h;
        m.hint[s] = i;
        m.pos[s * 3] = this.p[0]!;
        m.pos[s * 3 + 1] = this.p[1]!;
        m.pos[s * 3 + 2] = this.p[2]!;
        break;
      }
    }
    if (m.sampleCount === 0) {
      // Every sampled unit was already moving (or none was found): no move-latency sample.
      m.moving = true;
      m.movedDone = true;
      this.movingAtClick++;
    }
  }

  /** A command was confirmed (seq ack observed at `ackMs`). */
  onAck(seq: number, ackMs: number): void {
    if (this.pending === 0) return;
    for (let k = 0; k < this.ms.length; k++) {
      const m = this.ms[k]!;
      if (!m.active || m.ackDone || m.seq !== seq) continue;
      m.ackDone = true;
      this.clickToAckMs.push(ackMs - m.clickMs);
      this.finish(m);
    }
  }

  /**
   * After a rAF rendered: `nowMs` is the time the frame was drawn, `reader`/`alpha` what was drawn,
   * `camera` the camera used. Resolves marker and "first moved pixel" measurements.
   */
  onRendered(nowMs: number, reader: FrameReader | null, alpha: number, camera: RtsCamera): void {
    if (this.pending === 0) return;
    for (let k = 0; k < this.ms.length; k++) {
      const m = this.ms[k]!;
      if (!m.active) continue;
      if (!m.markerDone) {
        m.markerDone = true;
        this.clickToMarkerMs.push(nowMs - m.clickMs);
        this.clickToMarkerFrames.push(this.rafs - m.clickRaf);
      }
      if (!m.movedDone && reader !== null && this.moved(m, reader, alpha, camera)) {
        m.movedDone = true;
        this.clickToMoveMs.push(nowMs - m.clickMs);
      }
      if (m.active && nowMs - m.clickMs > MEASUREMENT_TIMEOUT_MS) {
        m.active = false;
        this.pending--;
        this.timeouts++;
        continue;
      }
      this.finish(m);
    }
  }

  get pendingMeasurements(): number {
    return this.pending;
  }

  /** Plain-object snapshot of all metrics. */
  snapshot(): MetricsSnapshot {
    const ri = this.rafInterval.summary();
    return {
      rafs: this.rafs,
      fps: ri.count > 0 && ri.mean > 0 ? 1000 / ri.mean : 0,
      rafIntervalMs: ri,
      mainJsMs: this.mainJs.summary(),
      clickToMarkerMs: this.clickToMarkerMs.summary(),
      clickToMarkerFrames: this.clickToMarkerFrames.summary(),
      clickToAckMs: this.clickToAckMs.summary(),
      clickToMoveMs: this.clickToMoveMs.summary(),
      clicks: this.clicks,
      pendingMeasurements: this.pending,
      timeouts: this.timeouts,
      movingAtClick: this.movingAtClick,
      frame: this.sources.frame?.() ?? {},
    };
  }

  /** Clears all distributions and counters (e.g. between E2E phases). */
  reset(): void {
    this.rafInterval.clear();
    this.mainJs.clear();
    this.clickToMarkerMs.clear();
    this.clickToMarkerFrames.clear();
    this.clickToAckMs.clear();
    this.clickToMoveMs.clear();
    for (const m of this.ms) m.active = false;
    this.pending = 0;
    this.clicks = 0;
    this.timeouts = 0;
    this.movingAtClick = 0;
  }

  // ---- internals ------------------------------------------------------------------------------

  private finish(m: Measurement): void {
    if (m.active && m.markerDone && m.ackDone && m.movedDone) {
      m.active = false;
      this.pending--;
    }
  }

  private moved(m: Measurement, r: FrameReader, alpha: number, camera: RtsCamera): boolean {
    const n = r.unitCount;
    for (let s = 0; s < m.sampleCount; s++) {
      const h = m.handles[s]!;
      const hint = m.hint[s]!;
      const start = hint < n && r.unitHandle(hint) === h ? hint : 0;
      for (let i = start; i < n; i++) {
        if (r.unitHandle(i) !== h) continue;
        m.hint[s] = i;
        interpolatedPos(r, i, alpha, this.p);
        const okA = camera.project(this.p[0]!, this.p[1]!, this.p[2]!, this.sa);
        const okB = camera.project(m.pos[s * 3]!, m.pos[s * 3 + 1]!, m.pos[s * 3 + 2]!, this.sb);
        if (okA && okB) {
          const dx = this.sa[0]! - this.sb[0]!;
          const dy = this.sa[1]! - this.sb[1]!;
          if (dx * dx + dy * dy >= MOVED_PX * MOVED_PX) return true;
        }
        const radius = m.radius[s]!;
        if (okA && radius > 0) {
          const noInterp = (r.unitFlags(i) & NO_INTERP) !== 0;
          const yaw = interpolatedYaw(r, i, alpha, noInterp);
          const dYaw = Math.abs(((yaw - m.yaw[s]! + 98304) % 65536) - 32768);
          if (dYaw > 0) {
            const chordWU = 2 * radius * Math.sin((dYaw * ANG16_TO_RAD) / 2);
            const scale = this.pxPerWU(camera);
            if (chordWU * scale >= MOVED_PX) return true;
          }
        }
        break;
      }
    }
    return false;
  }

  /**
   * Smaller on-screen length (CSS px) of 1 WU along the ground x and z axes at the point in
   * `this.p` (raw), projected with `camera`; the point's projection must already be in `this.sa`.
   */
  private pxPerWU(camera: RtsCamera): number {
    const p = this.p;
    let scale = Number.POSITIVE_INFINITY;
    if (camera.project(p[0]! + RAW_PER_WU, p[1]!, p[2]!, this.sc)) {
      scale = Math.min(scale, Math.hypot(this.sc[0]! - this.sa[0]!, this.sc[1]! - this.sa[1]!));
    }
    if (camera.project(p[0]!, p[1]!, p[2]! + RAW_PER_WU, this.sc)) {
      scale = Math.min(scale, Math.hypot(this.sc[0]! - this.sa[0]!, this.sc[1]! - this.sa[1]!));
    }
    return Number.isFinite(scale) ? scale : 0;
  }
}
