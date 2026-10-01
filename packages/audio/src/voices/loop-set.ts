/**
 * Keyed loops (e.g. one build loop per army, one ambience bed): `set(key, req)` starts,
 * updates (gain / position / rate with ramps) or — with `null` — stops a loop with a fade.
 * A loop voice that was lost (stolen by a higher priority, culled, not loaded yet) is restarted
 * at the next opportunity: the next `set()` of that key or `update()`, at most every `retryMs`.
 *
 * Entries live in a dense array plus a key → index map; `set()` for an existing key and
 * `update()` allocate nothing.
 */

import type { PlayRequest, SoundSink, VoiceHandle } from '../types.ts';
import { DEFAULT_STOP_FADE_MS } from './voice-manager.ts';

/** Options of {@link LoopSet}. */
export interface LoopSetOptions {
  /** Minimum interval between restart attempts of a lost loop in ms (default 100). */
  retryMs?: number | undefined;
  /** Fade of `set(key, null)` in ms (default 40). */
  stopFadeMs?: number | undefined;
}

/** Changes smaller than this are not re-sent as ramps. */
const EPS = 1e-4;

class LoopEntry {
  readonly req: PlayRequest = { sound: '' };
  handle: VoiceHandle | null = null;
  nextRetryMs = Number.NEGATIVE_INFINITY;
  /** Values last applied to the running voice. */
  gain = 1;
  rate = 1;
  x: number | undefined = undefined;
  z: number | undefined = undefined;

  constructor(readonly key: string) {}
}

function sameSound(a: PlayRequest, b: PlayRequest): boolean {
  return a.sound === b.sound && a.faction === b.faction && (a.loop ?? true) === (b.loop ?? true);
}

export class LoopSet {
  readonly retryMs: number;
  readonly stopFadeMs: number;
  private readonly entries: LoopEntry[] = [];
  private readonly index = new Map<string, number>();

  constructor(
    private readonly sink: SoundSink,
    opts: LoopSetOptions = {},
  ) {
    this.retryMs = Math.max(0, opts.retryMs ?? 100);
    this.stopFadeMs = Math.max(0, opts.stopFadeMs ?? DEFAULT_STOP_FADE_MS);
  }

  /** Number of keys. */
  get size(): number {
    return this.entries.length;
  }

  has(key: string): boolean {
    return this.index.has(key);
  }

  /** Handle of the running voice of `key` (null if none is running). */
  handle(key: string): VoiceHandle | null {
    const i = this.index.get(key);
    if (i === undefined) return null;
    const h = this.entries[i]!.handle;
    return h !== null && h.alive ? h : null;
  }

  /**
   * Starts, updates or (req = null) stops the loop `key`. `req.loop` defaults to true.
   * Returns the running handle or null.
   */
  set(key: string, req: PlayRequest | null, nowMs: number): VoiceHandle | null {
    const i = this.index.get(key);
    if (req === null) {
      if (i !== undefined) this.remove(i);
      return null;
    }
    if (i === undefined) {
      const e = new LoopEntry(key);
      this.copy(e.req, req);
      this.index.set(key, this.entries.length);
      this.entries.push(e);
      return this.start(e, nowMs);
    }
    const e = this.entries[i]!;
    if (!sameSound(e.req, req)) {
      if (e.handle !== null) e.handle.stop(this.stopFadeMs);
      e.handle = null;
      this.copy(e.req, req);
      return this.start(e, nowMs);
    }
    this.copy(e.req, req);
    const h = e.handle;
    if (h === null || !h.alive) {
      e.handle = null;
      return nowMs >= e.nextRetryMs ? this.start(e, nowMs) : null;
    }
    this.apply(e, h);
    return h;
  }

  /** Per frame: restarts lost loops whose retry time has come. */
  update(nowMs: number): void {
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i]!;
      const h = e.handle;
      if (h !== null && h.alive) continue;
      e.handle = null;
      if (nowMs >= e.nextRetryMs) this.start(e, nowMs);
    }
  }

  /** Stops and forgets every loop. */
  clear(fadeMs: number = this.stopFadeMs): void {
    for (let i = 0; i < this.entries.length; i++) {
      const h = this.entries[i]!.handle;
      if (h !== null) h.stop(fadeMs);
    }
    this.entries.length = 0;
    this.index.clear();
  }

  private remove(i: number): void {
    const e = this.entries[i]!;
    if (e.handle !== null) e.handle.stop(this.stopFadeMs);
    const last = this.entries.pop()!;
    this.index.delete(e.key);
    if (last !== e) {
      this.entries[i] = last;
      this.index.set(last.key, i);
    }
  }

  private start(e: LoopEntry, nowMs: number): VoiceHandle | null {
    const h = this.sink.play(e.req, nowMs);
    e.handle = h;
    e.gain = e.req.gain ?? 1;
    e.rate = e.req.rate ?? 1;
    e.x = e.req.x;
    e.z = e.req.z;
    if (h === null) e.nextRetryMs = nowMs + this.retryMs;
    return h;
  }

  private apply(e: LoopEntry, h: VoiceHandle): void {
    const r = e.req;
    const gain = r.gain ?? 1;
    if (Math.abs(gain - e.gain) > EPS) {
      e.gain = gain;
      h.setGain(gain);
    }
    const rate = r.rate ?? 1;
    if (Math.abs(rate - e.rate) > EPS) {
      e.rate = rate;
      h.setRate(rate);
    }
    const x = r.x;
    const z = r.z;
    if (x !== undefined && z !== undefined && (e.x === undefined || e.z === undefined || Math.abs(x - e.x) > EPS || Math.abs(z - e.z) > EPS)) {
      e.x = x;
      e.z = z;
      h.setPosition(x, z);
    }
  }

  private copy(dst: PlayRequest, src: PlayRequest): void {
    dst.sound = src.sound;
    dst.faction = src.faction;
    dst.x = src.x;
    dst.z = src.z;
    dst.gain = src.gain;
    dst.rate = src.rate;
    dst.priorityBoost = src.priorityBoost;
    dst.loop = src.loop ?? true;
    dst.when = undefined;
  }
}
