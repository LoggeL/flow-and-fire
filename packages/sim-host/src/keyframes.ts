/**
 * Arena keyframes (PLAN §3.11 "Seek"): snapshots of the dynamic arena (one memcpy each) every
 * `intervalTicks` (default 600 = 60 s game time) in a store bounded by `maxBytes` (default
 * 128 MB). When the store is full it thins out adaptively: every second keyframe (never the
 * first) is dropped and the interval doubles, so the whole game stays covered with coarser
 * granularity. Buffers are reused; capturing into a recycled buffer allocates nothing.
 *
 * Seeking = restore the nearest keyframe at or before the target and re-simulate with the
 * command log (see SimCore.seek).
 */

import { restore, snapshot, type World } from '@faf/sim';

export const DEFAULT_KEYFRAME_INTERVAL_TICKS = 600;
export const DEFAULT_KEYFRAME_MAX_BYTES = 128 * 1024 * 1024;

export interface KeyframeOptions {
  readonly intervalTicks?: number;
  readonly maxBytes?: number;
}

export class KeyframeStore {
  readonly snapshotBytes: number;
  /** Maximum number of keyframes held (≥ 2). */
  readonly capacity: number;
  private intervalValue: number;
  private readonly ticks: Int32Array;
  private readonly bufs: (Uint8Array | null)[];
  private readonly free: Uint8Array[] = [];
  private n = 0;
  /** Times the store was thinned out. */
  thinnings = 0;

  constructor(snapshotBytes: number, options: KeyframeOptions = {}) {
    this.snapshotBytes = snapshotBytes;
    this.intervalValue = Math.max(1, Math.floor(options.intervalTicks ?? DEFAULT_KEYFRAME_INTERVAL_TICKS));
    const maxBytes = options.maxBytes ?? DEFAULT_KEYFRAME_MAX_BYTES;
    this.capacity = Math.max(2, Math.floor(maxBytes / snapshotBytes));
    this.ticks = new Int32Array(this.capacity);
    this.bufs = new Array<Uint8Array | null>(this.capacity).fill(null);
  }

  /** Current capture interval in ticks (doubles on every thinning). */
  get intervalTicks(): number {
    return this.intervalValue;
  }

  get count(): number {
    return this.n;
  }

  /** Bytes held by keyframe buffers (including recycled ones). */
  get byteLength(): number {
    return (this.n + this.free.length) * this.snapshotBytes;
  }

  tickAt(i: number): number {
    return this.ticks[i]!;
  }

  /** Snapshot bytes of keyframe `i` (do not modify). */
  bytesAt(i: number): Uint8Array {
    return this.bufs[i]!;
  }

  /** Index of the keyframe with the largest tick ≤ `tick`, or −1. */
  latestAtOrBefore(tick: number): number {
    let lo = 0;
    let hi = this.n;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.ticks[mid]! <= tick) lo = mid + 1;
      else hi = mid;
    }
    return lo - 1;
  }

  /** Index of the keyframe at exactly `tick`, or −1. */
  indexOf(tick: number): number {
    const i = this.latestAtOrBefore(tick);
    return i >= 0 && this.ticks[i] === tick ? i : -1;
  }

  /** Captures a keyframe if `world.tick` is on the interval and not captured yet. */
  maybeCapture(world: World): boolean {
    const t = world.tick as number;
    if (t % this.intervalValue !== 0) return false;
    return this.capture(world);
  }

  /** Captures a keyframe of the current state (no-op if one exists for this tick). */
  capture(world: World): boolean {
    const t = world.tick as number;
    if (this.n > 0 && this.ticks[this.n - 1]! >= t) {
      if (this.indexOf(t) >= 0) return false;
      // Out of order (after a backward seek): drop everything after t first.
      this.discardAfter(t);
    }
    if (this.n === this.capacity) this.thin();
    const buf = this.free.pop() ?? new Uint8Array(this.snapshotBytes);
    snapshot(world, buf);
    this.ticks[this.n] = t;
    this.bufs[this.n] = buf;
    this.n++;
    return true;
  }

  /** Restores keyframe `i` into `world`; returns its tick. */
  restoreInto(world: World, i: number): number {
    if (i < 0 || i >= this.n) throw new RangeError(`no keyframe ${i}`);
    restore(world, this.bufs[i]!);
    return this.ticks[i]!;
  }

  /** Drops keyframes with a tick greater than `tick` (timeline branch). */
  discardAfter(tick: number): void {
    const keep = this.latestAtOrBefore(tick) + 1;
    for (let i = keep; i < this.n; i++) {
      this.free.push(this.bufs[i]!);
      this.bufs[i] = null;
    }
    this.n = keep;
  }

  /** Drops every second keyframe (keeping the first) and doubles the interval. */
  private thin(): void {
    let w = 1;
    for (let r = 1; r < this.n; r++) {
      if (r % 2 === 0) {
        this.ticks[w] = this.ticks[r]!;
        this.bufs[w] = this.bufs[r]!;
        w++;
      } else {
        this.free.push(this.bufs[r]!);
      }
    }
    for (let i = w; i < this.n; i++) this.bufs[i] = null;
    this.n = w;
    this.intervalValue *= 2;
    this.thinnings++;
  }
}
