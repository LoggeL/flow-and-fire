/**
 * Compressed arena keyframes (PLAN §3.11 "Seek: Heap-Keyframes (Arena-memcpy, komprimiert) alle
 * 60 s Spielzeit, adaptiv bis 128 MB") for the replay player and long games.
 *
 * A keyframe is a session snapshot (`SimCore.snapshot`: identity header + dynamic arena, DECISIONS
 * 20) taken into one reused scratch buffer (memcpy) and compressed with raw DEFLATE. The budget
 * `maxBytes` bounds the COMPRESSED bytes held. When a capture pushes the store over it, the store
 * thins out like the uncompressed `KeyframeStore`: every second keyframe (never the first) is
 * dropped and the interval doubles, repeatedly if needed, so the whole game stays covered — the
 * newest keyframe is always less than one (new) interval behind the current tick.
 *
 * Differences to `KeyframeStore` (uncompressed, used by SimCore for live seek):
 * - Capturing a tick that lies before existing keyframes INSERTS it (sorted) instead of dropping
 *   the later ones: a replay's timeline is fixed, so keyframes collected while re-simulating after
 *   a backward seek belong to the same history. A branching timeline (live restore) must call
 *   `discardAfter` itself.
 * - Two capture paths: `capture` (synchronous fflate, canonical level) and `captureAsync` (native
 *   CompressionStream, for the sim worker so the tick does not wait for the compressor).
 *
 * Restoring inflates into a fresh buffer of the snapshot size (formats `inflateRaw` allocates its
 * output; restores are rare — seeks — so this is not on the tick path) and hands it to
 * `SimCore.restoreSnapshot`, which checks the identity header (SnapshotError for a foreign
 * session) and branches the core's timeline (see there).
 */

import { deflateRaw, inflateRaw } from '@faf/formats';
import type { SimCore } from '../core.ts';
import { DEFAULT_KEYFRAME_INTERVAL_TICKS, DEFAULT_KEYFRAME_MAX_BYTES } from '../keyframes.ts';
import { deflateRawNative, inflateRawNative } from './native-deflate.ts';

/**
 * fflate level of compressed keyframes. Keyframes live only in memory, so the level is chosen for
 * capture time, not for canonical bytes: on 1.5–1.9 MB session snapshots with 1,000–2,000 units
 * level 1 is within 1 % of level 6 in size and 29–44 % faster; level 9 saves < 0.1 % at 7–16x the
 * time (docs/status/track-replay/p2.md, bench:keyframes).
 */
export const DEFAULT_KEYFRAME_LEVEL = 1;

export interface CompressedKeyframeOptions {
  /** Capture interval in ticks (default 600 = 60 s game time); doubles on every thinning. */
  readonly intervalTicks?: number;
  /** Budget for the compressed bytes held (default 128 MiB). */
  readonly maxBytes?: number;
  /** fflate level 0..9 of the synchronous path (default DEFAULT_KEYFRAME_LEVEL). */
  readonly level?: number;
}

/** An asynchronous capture in flight (dropped when its tick leaves the timeline). */
interface PendingCapture {
  readonly tick: number;
  live: boolean;
}

/** At most this many snapshot buffers are kept for concurrent async captures. */
const ASYNC_POOL_MAX = 2;

export class CompressedKeyframeStore {
  /** Byte length of one session snapshot (SimCore.snapshotByteLength). */
  readonly snapshotByteLength: number;
  /** Budget for the compressed bytes held. */
  readonly maxBytes: number;
  /** fflate level of `capture`. */
  readonly level: number;
  private intervalValue: number;
  private readonly ticks: number[] = [];
  private readonly data: Uint8Array[] = [];
  private held = 0;
  private thinCount = 0;
  private readonly scratch: Uint8Array;
  private readonly pool: Uint8Array[] = [];
  private readonly pending: PendingCapture[] = [];

  constructor(snapshotByteLength: number, options: CompressedKeyframeOptions = {}) {
    if (!Number.isInteger(snapshotByteLength) || snapshotByteLength <= 0) {
      throw new RangeError(`snapshotByteLength must be a positive integer, got ${snapshotByteLength}`);
    }
    const level = options.level ?? DEFAULT_KEYFRAME_LEVEL;
    if (!Number.isInteger(level) || level < 0 || level > 9) throw new RangeError(`keyframe level must be 0..9, got ${level}`);
    const maxBytes = options.maxBytes ?? DEFAULT_KEYFRAME_MAX_BYTES;
    if (!(maxBytes > 0)) throw new RangeError(`keyframe budget must be positive, got ${maxBytes}`);
    this.snapshotByteLength = snapshotByteLength;
    this.maxBytes = maxBytes;
    this.level = level;
    this.intervalValue = Math.max(1, Math.floor(options.intervalTicks ?? DEFAULT_KEYFRAME_INTERVAL_TICKS));
    this.scratch = new Uint8Array(snapshotByteLength);
  }

  /** Current capture interval in ticks (doubles on every thinning). */
  get intervalTicks(): number {
    return this.intervalValue;
  }

  /** Number of keyframes held. */
  get count(): number {
    return this.ticks.length;
  }

  /** Compressed bytes held (the budgeted quantity; scratch/pool buffers not included). */
  get byteLength(): number {
    return this.held;
  }

  /** Uncompressed equivalent of the keyframes held (count × snapshotByteLength). */
  get rawByteLength(): number {
    return this.ticks.length * this.snapshotByteLength;
  }

  /** Times the store was thinned out. */
  get thinnings(): number {
    return this.thinCount;
  }

  /** Asynchronous captures in flight. */
  get pendingCount(): number {
    return this.pending.length;
  }

  /** Tick of keyframe `i`. */
  tickAt(i: number): number {
    if (i < 0 || i >= this.ticks.length) throw new RangeError(`no keyframe ${i}`);
    return this.ticks[i]!;
  }

  /** Compressed bytes of keyframe `i` (raw DEFLATE of a session snapshot; do not modify). */
  bytesAt(i: number): Uint8Array {
    if (i < 0 || i >= this.data.length) throw new RangeError(`no keyframe ${i}`);
    return this.data[i]!;
  }

  /** Index of the keyframe with the largest tick ≤ `tick`, or −1. */
  latestAtOrBefore(tick: number): number {
    const ticks = this.ticks;
    let lo = 0;
    let hi = ticks.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (ticks[mid]! <= tick) lo = mid + 1;
      else hi = mid;
    }
    return lo - 1;
  }

  /** Index of the keyframe at exactly `tick`, or −1. */
  indexOf(tick: number): number {
    const i = this.latestAtOrBefore(tick);
    return i >= 0 && this.ticks[i] === tick ? i : -1;
  }

  /** True if `tick` is on the current interval and neither held nor being captured. */
  isDue(tick: number): boolean {
    return tick % this.intervalValue === 0 && this.indexOf(tick) < 0 && !this.isPending(tick);
  }

  /** Captures a keyframe if the core's tick is on the interval and not captured yet. */
  maybeCapture(core: SimCore): boolean {
    return this.isDue(core.tick) && this.capture(core);
  }

  /**
   * Captures a keyframe of the current state synchronously: session snapshot into the reused
   * scratch buffer, then fflate raw DEFLATE at `level`. No-op (false) if one exists for this tick.
   * All capture paths return true if the keyframe is held afterwards (a thinning triggered by the
   * capture itself may drop it again when it lands on an odd position).
   */
  capture(core: SimCore): boolean {
    const t = core.tick;
    if (this.indexOf(t) >= 0) return false;
    this.checkCore(core);
    core.snapshot(this.scratch);
    return this.insert(t, deflateRaw(this.scratch, this.level));
  }

  /**
   * Captures a keyframe with the native compressor (fflate fallback without CompressionStream):
   * the snapshot is taken synchronously (memcpy into a pooled buffer, so the core may tick on
   * immediately), the compression runs asynchronously. The keyframe is inserted on completion only
   * if its tick still belongs to the timeline — a `discardAfter` below it in the meantime drops it.
   * Intended for the sim worker: the tick does not wait for the compressor. Resolves true if the
   * keyframe was added.
   */
  async captureAsync(core: SimCore): Promise<boolean> {
    const t = core.tick;
    if (this.indexOf(t) >= 0 || this.isPending(t)) return false;
    this.checkCore(core);
    const buf = this.pool.pop() ?? new Uint8Array(this.snapshotByteLength);
    core.snapshot(buf);
    const job: PendingCapture = { tick: t, live: true };
    this.pending.push(job);
    let compressed: Uint8Array;
    try {
      compressed = await deflateRawNative(buf, this.level);
    } finally {
      const k = this.pending.indexOf(job);
      if (k >= 0) this.pending.splice(k, 1);
      if (this.pool.length < ASYNC_POOL_MAX) this.pool.push(buf);
    }
    return job.live && this.captureBytes(t, compressed, this.snapshotByteLength);
  }

  /** Captures if due, asynchronously (see captureAsync); null if the tick is not due. */
  maybeCaptureAsync(core: SimCore): Promise<boolean> | null {
    return this.isDue(core.tick) ? this.captureAsync(core) : null;
  }

  /**
   * Adds an already compressed keyframe (raw DEFLATE of a session snapshot of `rawLength` bytes,
   * which must equal snapshotByteLength). Sorted insert; no-op (false) if the tick is held. A view
   * into a larger buffer is copied so the store never pins foreign memory.
   */
  captureBytes(tick: number, compressed: Uint8Array, rawLength: number): boolean {
    if (!Number.isInteger(tick) || tick < 0) throw new RangeError(`keyframe tick must be a non-negative integer, got ${tick}`);
    if (rawLength !== this.snapshotByteLength) {
      throw new RangeError(`keyframe raw length ${rawLength} differs from the store's snapshot length ${this.snapshotByteLength}`);
    }
    if (this.indexOf(tick) >= 0) return false;
    const exact = compressed.byteOffset === 0 && compressed.byteLength === compressed.buffer.byteLength ? compressed : compressed.slice();
    return this.insert(tick, exact);
  }

  /**
   * Restores keyframe `i` into `core` (inflate + SimCore.restoreSnapshot, which throws
   * SnapshotError for a snapshot of another session); returns its tick.
   */
  restoreInto(core: SimCore, i: number): number {
    const tick = this.tickAt(i);
    core.restoreSnapshot(inflateRaw(this.data[i]!, this.snapshotByteLength));
    return tick;
  }

  /**
   * Like restoreInto, but inflates with the native DecompressionStream (fflate fallback). The
   * keyframe's bytes are taken before the first await, so a concurrent thinning cannot swap them.
   */
  async restoreIntoAsync(core: SimCore, i: number): Promise<number> {
    const tick = this.tickAt(i);
    const raw = await inflateRawNative(this.data[i]!, this.snapshotByteLength);
    core.restoreSnapshot(raw);
    return tick;
  }

  /** Drops keyframes (held and in flight) with a tick greater than `tick` (timeline branch). */
  discardAfter(tick: number): void {
    const keep = this.latestAtOrBefore(tick) + 1;
    for (let i = keep; i < this.data.length; i++) this.held -= this.data[i]!.length;
    this.ticks.length = keep;
    this.data.length = keep;
    const pending = this.pending;
    for (let k = 0; k < pending.length; k++) if (pending[k]!.tick > tick) pending[k]!.live = false;
  }

  private isPending(tick: number): boolean {
    const pending = this.pending;
    for (let k = 0; k < pending.length; k++) if (pending[k]!.live && pending[k]!.tick === tick) return true;
    return false;
  }

  private checkCore(core: SimCore): void {
    if (core.snapshotByteLength !== this.snapshotByteLength) {
      throw new RangeError(`core snapshot length ${core.snapshotByteLength} differs from the store's ${this.snapshotByteLength}`);
    }
  }

  private insert(tick: number, bytes: Uint8Array): boolean {
    const at = this.latestAtOrBefore(tick) + 1;
    this.ticks.splice(at, 0, tick);
    this.data.splice(at, 0, bytes);
    this.held += bytes.length;
    while (this.held > this.maxBytes && this.ticks.length > 2) this.thin();
    return this.indexOf(tick) >= 0;
  }

  /** Drops every second keyframe (keeping the first) and doubles the interval. */
  private thin(): void {
    const ticks = this.ticks;
    const data = this.data;
    let w = 1;
    for (let r = 1; r < ticks.length; r++) {
      if (r % 2 === 0) {
        ticks[w] = ticks[r]!;
        data[w] = data[r]!;
        w++;
      } else {
        this.held -= data[r]!.length;
      }
    }
    ticks.length = w;
    data.length = w;
    this.intervalValue *= 2;
    this.thinCount++;
  }
}
