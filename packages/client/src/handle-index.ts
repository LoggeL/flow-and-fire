/**
 * Handle → record index of the current frame (MS3): an open-addressing hash table over typed
 * arrays, rebuilt once per new frame in O(units) without allocation (generation stamps instead of
 * clearing). Selection, control groups, watch lines and command-target markers look units up by
 * handle through it instead of scanning the frame.
 */
import type { FrameReader } from '@faf/protocol';

const EMPTY = -1;

export class HandleIndex {
  private keys = new Uint32Array(0);
  private vals = new Int32Array(0);
  private stamp = new Uint32Array(0);
  private gen = 0;
  private mask = 0;
  /** Records indexed by the last `build`. */
  size = 0;
  /** Bumped by every `build` (cache key for consumers). */
  version = 0;

  /** Indexes every UnitRecord of `r` (handle → record index). */
  build(r: FrameReader): void {
    const n = r.unitCount;
    this.ensure(n);
    this.gen = (this.gen + 1) >>> 0;
    if (this.gen === 0) {
      this.stamp.fill(0);
      this.gen = 1;
    }
    const g = this.gen;
    const keys = this.keys;
    const vals = this.vals;
    const st = this.stamp;
    const m = this.mask;
    for (let i = 0; i < n; i++) {
      const h = r.unitHandle(i) >>> 0;
      let s = hash(h) & m;
      while (st[s] === g && keys[s] !== h) s = (s + 1) & m;
      st[s] = g;
      keys[s] = h;
      vals[s] = i;
    }
    this.size = n;
    this.version++;
  }

  /** Record index of `handle` in the indexed frame, or −1. */
  get(handle: number): number {
    if (this.size === 0) return EMPTY;
    const h = handle >>> 0;
    const m = this.mask;
    const g = this.gen;
    const st = this.stamp;
    let s = hash(h) & m;
    while (st[s] === g) {
      if (this.keys[s] === h) return this.vals[s]!;
      s = (s + 1) & m;
    }
    return EMPTY;
  }

  /** Forgets the indexed frame. */
  clear(): void {
    this.size = 0;
    this.gen = (this.gen + 1) >>> 0;
    if (this.gen === 0) {
      this.stamp.fill(0);
      this.gen = 1;
    }
    this.version++;
  }

  private ensure(n: number): void {
    let cap = this.keys.length;
    if (cap >= 2 * n && cap > 0) return;
    cap = Math.max(cap, 64);
    while (cap < 2 * n) cap *= 2;
    this.keys = new Uint32Array(cap);
    this.vals = new Int32Array(cap);
    this.stamp = new Uint32Array(cap);
    this.gen = 0;
    this.mask = cap - 1;
  }
}

function hash(h: number): number {
  return Math.imul(h ^ (h >>> 16), 0x9e3779b1) >>> 7;
}
