/**
 * Voice manager: the engine's single sound sink.
 *
 * Budget and policy (docs/design/audio.md §3/§4, PLAN §3.7):
 * - At most `maxVoices` (32) logical voices, at most `maxVoices` per sound and
 *   `categoryMaxVoices` per category (manifest policy via the SoundResolver).
 * - Cooldown per sound (`cooldownMs`, wall clock `nowMs`).
 * - Spatial culling BEFORE a voice is allocated (inaudible requests never steal).
 * - Stealing when a limit is full:
 *   - sound/category limit: the voice of that sound/category with the lowest effective loudness
 *     (gain × remaining fraction of its length; loops count as 1), ties → oldest; only if the
 *     new voice is at least as loud;
 *   - global limit: the quietest voice with a strictly lower priority, else drop;
 *   - a voice is never displaced by a lower priority, a running loop only by a strictly higher
 *     one.
 * - Stolen and stopped voices fade out linearly (`stealFadeMs`, 8 ms) as "tails": they no longer
 *   occupy a logical voice but are limited by `tailBudget`; beyond it the oldest tail is cut hard.
 * - Variant rotation without direct repetition, ±3 % playback-rate jitter (not for loops, music
 *   and alerts).
 * - ui/ack start synchronously at `when = 0` inside `play()`.
 *
 * Hot path: the 32 slot records, 8 tail records, the per-sound tables (Float64Array /
 * Int32Array / Int16Array) and all ended-handlers are allocated once in the constructor. A
 * dropped request allocates nothing; a started voice allocates its three Web Audio nodes
 * (source, gain, panner) plus one small handle object (the API contract needs a distinct
 * identity per voice that stays valid as a no-op after the voice ended).
 */

import type {
  AudioBufferLike,
  AudioBufferSourceNodeLike,
  AudioNodeLike,
  BaseAudioContextLike,
  GainNodeLike,
  StereoPannerNodeLike,
} from '../ports.ts';
import {
  DROP_REASONS,
  SOUND_CATEGORIES,
  categoryIndex,
  type ChannelBus,
  type DropReason,
  type PlayRequest,
  type ResolvedSound,
  type SoundResolver,
  type SoundSink,
  type SpatialModel,
  type SpatialResult,
  type VoiceHandle,
} from '../types.ts';
import type { VoiceStats } from './stats.ts';

/** The mixer surface the voice manager needs. */
export interface VoiceMixer {
  busInput(bus: ChannelBus): AudioNodeLike;
}

/** Options of {@link VoiceManager}. */
export interface VoiceManagerOptions {
  ctx: BaseAudioContextLike;
  mixer: VoiceMixer;
  resolver: SoundResolver;
  /** Spatial model; without it every voice plays centred at its request gain. */
  spatial?: SpatialModel | null | undefined;
  /** Logical voice budget (default 32). */
  maxVoices?: number | undefined;
  /** Default faction scope of name lookups. */
  faction: string;
  /** Wall clock in ms for calls without an explicit `nowMs` (default performance.now). */
  clockMs?: (() => number) | undefined;
  /** Random source in [0, 1) (variants, rate jitter; default Math.random). */
  random?: (() => number) | undefined;
  /** Maximum number of fading tails (default 8). */
  tailBudget?: number | undefined;
  /** Fade-out of stolen voices in ms (default 8). */
  stealFadeMs?: number | undefined;
  /** Requests quieter than this linear gain are culled (default −48 dB). */
  cullGain?: number | undefined;
  /** Relative playback-rate jitter of one-shots (default 0.03 = ±3 %). */
  rateJitter?: number | undefined;
}

/** Default fade of `VoiceHandle.stop()` in ms. */
export const DEFAULT_STOP_FADE_MS = 40;
/** Default τ of `setGain`/`setRate`/`setPosition` ramps in seconds. */
export const VOICE_RAMP_TAU_S = 0.015;
/** Default cull threshold (−48 dB). */
export const DEFAULT_CULL_GAIN = Math.pow(10, -48 / 20);
/** A one-shot whose `onended` did not arrive this long after its computed end is reclaimed. */
const SWEEP_GRACE_S = 0.5;

const FREE = 0;
const ACTIVE = 1;

const CAT_ALERT = categoryIndex('alert');
const CAT_MUSIC = categoryIndex('music');
const CAT_ACK = categoryIndex('ack');
const CAT_UI = categoryIndex('ui');

const D_COOLDOWN = DROP_REASONS.indexOf('cooldown');
const D_CATEGORY = DROP_REASONS.indexOf('categoryLimit');
const D_SOUND = DROP_REASONS.indexOf('soundLimit');
const D_GLOBAL = DROP_REASONS.indexOf('globalLimit');
const D_CULLED = DROP_REASONS.indexOf('culled');
const D_NOT_LOADED = DROP_REASONS.indexOf('notLoaded');
const D_UNKNOWN = DROP_REASONS.indexOf('unknownSound');

/** One voice record: a logical slot or a tail. Allocated once, reused forever. */
class VoiceRecord {
  state = FREE;
  /** Incremented on every release; handles compare it to detect reuse. */
  gen = 0;
  source: AudioBufferSourceNodeLike | null = null;
  gainNode: GainNodeLike | null = null;
  panner: StereoPannerNodeLike | null = null;
  soundIndex = -1;
  categoryIndex = -1;
  priority = 0;
  loop = false;
  spatial = false;
  x = 0;
  z = 0;
  reqGain = 1;
  spatialGain = 1;
  /** reqGain × spatialGain (target of the gain node). */
  effGain = 1;
  pan = 0;
  /** Requested rate factor (without jitter). */
  rate = 1;
  /** Jitter factor applied on top of `rate`. */
  jitter = 1;
  /** Context time the output starts. */
  startAt = 0;
  /** Computed context end time (Infinity for loops). */
  endAt = Number.POSITIVE_INFINITY;
  /** Start order (ties in stealing → oldest). */
  seq = 0;
  /** Preallocated `onended` handler of this record. */
  onEnded: (ev: Event) => void = () => {};

  constructor(readonly slot: number) {}
}

/** Internal operations the handles call (kept off the public class surface). */
interface VoiceOps {
  stop(rec: VoiceRecord, gen: number, fadeMs: number): void;
  setGain(rec: VoiceRecord, gen: number, gain: number, rampMs: number): void;
  setPosition(rec: VoiceRecord, gen: number, x: number, z: number): void;
  setRate(rec: VoiceRecord, gen: number, rate: number): void;
}

class Handle implements VoiceHandle {
  constructor(
    private readonly ops: VoiceOps,
    private readonly rec: VoiceRecord,
    private readonly gen: number,
    readonly id: number,
  ) {}

  get alive(): boolean {
    return this.rec.gen === this.gen && this.rec.state === ACTIVE;
  }

  stop(fadeMs: number = DEFAULT_STOP_FADE_MS): void {
    this.ops.stop(this.rec, this.gen, fadeMs);
  }

  setGain(gain: number, rampMs = -1): void {
    this.ops.setGain(this.rec, this.gen, gain, rampMs);
  }

  setPosition(x: number, z: number): void {
    this.ops.setPosition(this.rec, this.gen, x, z);
  }

  setRate(rate: number): void {
    this.ops.setRate(this.rec, this.gen, rate);
  }
}

function sanitizeGain(g: number | undefined): number {
  if (g === undefined) return 1;
  return g > 0 && g < Number.POSITIVE_INFINITY ? g : 0;
}

function sanitizeRate(r: number | undefined): number {
  return r !== undefined && r > 0 && r < Number.POSITIVE_INFINITY ? r : 1;
}

function safeStop(src: AudioBufferSourceNodeLike, when: number): void {
  try {
    src.stop(when);
  } catch {
    // Already stopped/ended in some engines; nothing to do.
  }
}

function cutNodes(src: AudioBufferSourceNodeLike, gain: GainNodeLike | null, panner: StereoPannerNodeLike | null): void {
  src.onended = null;
  safeStop(src, 0);
  src.disconnect();
  if (gain !== null) gain.disconnect();
  if (panner !== null) panner.disconnect();
}

export class VoiceManager implements SoundSink {
  readonly maxVoices: number;
  readonly tailBudget: number;
  readonly stealFadeMs: number;
  readonly cullGain: number;
  readonly rateJitter: number;
  /** Reason of the most recent `play()` that returned null; null after a successful start. */
  lastDrop: DropReason | null = null;

  private readonly ctx: BaseAudioContextLike;
  private readonly mixer: VoiceMixer;
  private readonly resolver: SoundResolver;
  private spatial: SpatialModel | null;
  private readonly faction: string;
  private readonly clock: () => number;
  private readonly random: () => number;

  private readonly slots: VoiceRecord[] = [];
  private readonly freeStack: Int32Array;
  private freeTop: number;
  private readonly tailRecs: VoiceRecord[] = [];
  private tailCount = 0;

  private readonly soundCount: number;
  private readonly lastStartMs: Float64Array;
  private readonly soundVoiceCount: Int32Array;
  private readonly lastVariant: Int16Array;
  private readonly catVoices = new Int32Array(SOUND_CATEGORIES.length);
  private readonly dropped = new Int32Array(DROP_REASONS.length);
  private voices = 0;
  private peakVoices = 0;
  private played = 0;
  private stolen = 0;
  private stickyDrop: DropReason | null = null;
  private seq = 0;
  private nextId = 1;
  private readonly tmp: SpatialResult = { gain: 1, pan: 0 };
  private readonly ops: VoiceOps;

  constructor(opts: VoiceManagerOptions) {
    this.ctx = opts.ctx;
    this.mixer = opts.mixer;
    this.resolver = opts.resolver;
    this.spatial = opts.spatial ?? null;
    this.faction = opts.faction;
    this.maxVoices = Math.max(1, Math.floor(opts.maxVoices ?? 32));
    this.tailBudget = Math.max(0, Math.floor(opts.tailBudget ?? 8));
    this.stealFadeMs = Math.max(0, opts.stealFadeMs ?? 8);
    this.cullGain = Math.max(0, opts.cullGain ?? DEFAULT_CULL_GAIN);
    this.rateJitter = Math.max(0, opts.rateJitter ?? 0.03);
    this.clock = opts.clockMs ?? (() => performance.now());
    this.random = opts.random ?? Math.random;

    this.freeStack = new Int32Array(this.maxVoices);
    for (let i = 0; i < this.maxVoices; i++) {
      const rec = new VoiceRecord(i);
      rec.onEnded = (ev: Event) => this.slotEnded(rec, ev);
      this.slots.push(rec);
      // Pop order 0, 1, 2 … (cosmetic, eases debugging).
      this.freeStack[i] = this.maxVoices - 1 - i;
    }
    this.freeTop = this.maxVoices;
    for (let i = 0; i < this.tailBudget; i++) {
      const rec = new VoiceRecord(-1 - i);
      rec.onEnded = (ev: Event) => this.tailEnded(rec, ev);
      this.tailRecs.push(rec);
    }

    this.soundCount = this.resolver.size;
    this.lastStartMs = new Float64Array(this.soundCount).fill(Number.NEGATIVE_INFINITY);
    this.soundVoiceCount = new Int32Array(this.soundCount);
    this.lastVariant = new Int16Array(this.soundCount).fill(-1);

    this.ops = {
      stop: (rec, gen, fadeMs) => {
        if (rec.gen === gen && rec.state === ACTIVE) this.release(rec, fadeMs);
      },
      setGain: (rec, gen, gain, rampMs) => {
        if (rec.gen !== gen || rec.state !== ACTIVE) return;
        rec.reqGain = sanitizeGain(gain);
        this.applyGain(rec, rampMs);
      },
      setPosition: (rec, gen, x, z) => {
        if (rec.gen !== gen || rec.state !== ACTIVE) return;
        rec.x = x;
        rec.z = z;
        if (rec.spatial) this.respatialize(rec);
      },
      setRate: (rec, gen, rate) => {
        if (rec.gen !== gen || rec.state !== ACTIVE) return;
        const now = this.ctx.currentTime;
        const oldRate = rec.rate * rec.jitter;
        rec.rate = sanitizeRate(rate);
        const newRate = rec.rate * rec.jitter;
        if (!rec.loop && rec.endAt > now) {
          const from = rec.startAt > now ? rec.startAt : now;
          rec.endAt = from + ((rec.endAt - from) * oldRate) / newRate;
        }
        const p = rec.source!.playbackRate;
        p.cancelScheduledValues(now);
        p.setTargetAtTime(newRate, now, VOICE_RAMP_TAU_S);
      },
    };
  }

  // -------------------------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------------------------

  /** Replaces the spatial model (null = everything centred). */
  setSpatialModel(spatial: SpatialModel | null): void {
    this.spatial = spatial;
  }

  /**
   * Starts a voice for `req` or returns null (reason in `lastDrop`). `nowMs` is the wall clock
   * for cooldowns. See the module comment for the rules.
   */
  play(req: PlayRequest, nowMs: number): VoiceHandle | null {
    // a) resolve
    const sound = this.resolveSound(req);
    if (sound === null) return this.drop(D_UNKNOWN);
    const si = sound.index;
    if (!this.resolver.isLoaded(si)) {
      this.resolver.requestLoad(si);
      return this.drop(D_NOT_LOADED);
    }
    // b) cooldown per sound
    if (nowMs - this.lastStartMs[si]! < sound.cooldownMs) return this.drop(D_COOLDOWN);
    const variant = this.pickVariant(sound);
    if (variant < 0) {
      this.resolver.requestLoad(si);
      return this.drop(D_NOT_LOADED);
    }
    // c) spatialisation and culling (before any voice is allocated or stolen)
    const reqGain = sanitizeGain(req.gain);
    let spatialGain = 1;
    let pan = 0;
    let spatial = false;
    const x = req.x;
    const z = req.z;
    const ci = sound.categoryIndex;
    if (sound.spatial && this.spatial !== null && x !== undefined && z !== undefined) {
      spatial = true;
      const out = this.tmp;
      if (!this.spatial.spatialize(ci, x, z, out)) return this.drop(D_CULLED);
      spatialGain = out.gain;
      pan = out.pan;
    }
    const eff = reqGain * spatialGain;
    if (!(eff >= this.cullGain) || eff === 0) return this.drop(D_CULLED);
    // d) limits and stealing
    const prio = sound.priority + (req.priorityBoost ?? 0);
    if (this.soundVoiceCount[si]! >= sound.maxVoices) {
      const victim = this.pickLocal(si, -1, prio, eff);
      if (victim === null) return this.drop(D_SOUND);
      this.steal(victim);
    }
    if (this.catVoices[ci]! >= sound.categoryMaxVoices) {
      const victim = this.pickLocal(-1, ci, prio, eff);
      if (victim === null) return this.drop(D_CATEGORY);
      this.steal(victim);
    }
    if (this.freeTop === 0) {
      const victim = this.pickGlobal(prio);
      if (victim === null) return this.drop(D_GLOBAL);
      this.steal(victim);
    }
    // g) start
    const buffer = this.resolver.buffer(si, variant)!;
    const loop = req.loop ?? sound.loop !== null;
    const rate = sanitizeRate(req.rate);
    const jitter = loop || ci === CAT_MUSIC || ci === CAT_ALERT ? 1 : 1 + (this.random() * 2 - 1) * this.rateJitter;
    const immediate = ci === CAT_UI || ci === CAT_ACK;
    const rw = req.when;
    const when = immediate || rw === undefined || !(rw > 0 && rw < Number.POSITIVE_INFINITY) ? 0 : rw;
    const rec = this.startVoice(sound, buffer, loop, rate, jitter, eff, pan, when);
    rec.spatial = spatial;
    rec.x = x ?? 0;
    rec.z = z ?? 0;
    rec.reqGain = reqGain;
    rec.spatialGain = spatialGain;
    rec.priority = prio;
    this.lastStartMs[si] = nowMs;
    this.lastVariant[si] = variant;
    this.lastDrop = null;
    return new Handle(this.ops, rec, rec.gen, this.nextId++);
  }

  /**
   * Re-applies the spatial model to all running spatial voices (call after the listener moved
   * noticeably). Ramped, no allocation.
   */
  refreshSpatial(): void {
    for (let i = 0; i < this.slots.length; i++) {
      const rec = this.slots[i]!;
      if (rec.state === ACTIVE && rec.spatial) this.respatialize(rec);
    }
  }

  /**
   * Per-frame housekeeping: reclaims voices/tails whose `onended` never arrived (e.g. a context
   * that was closed) once the audio clock is well past their computed end.
   */
  update(_nowMs: number = this.clock()): void {
    const t = this.ctx.currentTime - SWEEP_GRACE_S;
    for (let i = 0; i < this.slots.length; i++) {
      const rec = this.slots[i]!;
      if (rec.state === ACTIVE && rec.endAt < t) {
        cutNodes(rec.source!, rec.gainNode, rec.panner);
        this.freeSlot(rec);
      }
    }
    for (let i = 0; i < this.tailRecs.length; i++) {
      const rec = this.tailRecs[i]!;
      if (rec.state === ACTIVE && rec.endAt < t) {
        cutNodes(rec.source!, rec.gainNode, rec.panner);
        this.freeTail(rec);
      }
    }
  }

  /** Stops every voice (fade `fadeMs`; tails beyond the budget are cut). */
  stopAll(fadeMs: number = DEFAULT_STOP_FADE_MS): void {
    for (let i = 0; i < this.slots.length; i++) {
      const rec = this.slots[i]!;
      if (rec.state === ACTIVE) this.release(rec, fadeMs);
    }
  }

  /** Cuts every voice and tail immediately (disposal). */
  dispose(): void {
    for (let i = 0; i < this.slots.length; i++) {
      const rec = this.slots[i]!;
      if (rec.state === ACTIVE) {
        cutNodes(rec.source!, rec.gainNode, rec.panner);
        this.freeSlot(rec);
      }
    }
    for (let i = 0; i < this.tailRecs.length; i++) {
      const rec = this.tailRecs[i]!;
      if (rec.state === ACTIVE) {
        cutNodes(rec.source!, rec.gainNode, rec.panner);
        this.freeTail(rec);
      }
    }
  }

  /** Counts a drop decided outside the manager (engine: 'locked', 'muted'). */
  countDrop(reason: DropReason): void {
    this.drop(DROP_REASONS.indexOf(reason));
  }

  /** Logical voices currently allocated. */
  get voiceCount(): number {
    return this.voices;
  }

  /** Fading tails currently alive. */
  get tails(): number {
    return this.tailCount;
  }

  /** Logical voices of one category (by categoryIndex). */
  categoryVoices(catIndex: number): number {
    return this.catVoices[catIndex] ?? 0;
  }

  /** Logical voices of one sound (by ResolvedSound.index). */
  soundVoices(soundIndex: number): number {
    return this.soundVoiceCount[soundIndex] ?? 0;
  }

  /** Size of the slot pool (constant; proves the pool never grows). */
  get poolSize(): number {
    return this.slots.length + this.tailRecs.length;
  }

  /** Fills `out` with the current counters (no allocation). */
  snapshotStats(out: VoiceStats): VoiceStats {
    out.voices = this.voices;
    out.peakVoices = this.peakVoices;
    out.tails = this.tailCount;
    out.byCategory.set(this.catVoices);
    out.played = this.played;
    out.stolen = this.stolen;
    out.dropped.set(this.dropped);
    out.lastDrop = this.stickyDrop;
    return out;
  }

  /** Resets the cumulative counters (played, stolen, dropped, peak = current voices). */
  resetStats(): void {
    this.played = 0;
    this.stolen = 0;
    this.dropped.fill(0);
    this.peakVoices = this.voices;
    this.stickyDrop = null;
  }

  // -------------------------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------------------------

  private drop(reasonIndex: number): null {
    const r = DROP_REASONS[reasonIndex]!;
    this.dropped[reasonIndex]!++;
    this.lastDrop = r;
    this.stickyDrop = r;
    return null;
  }

  private resolveSound(req: PlayRequest): ResolvedSound | null {
    const s = req.sound;
    let sound: ResolvedSound | null;
    if (typeof s === 'number') {
      if (!Number.isInteger(s) || s < 0 || s >= this.soundCount) return null;
      sound = this.resolver.byIndex(s);
    } else {
      sound = this.resolver.resolve(s, req.faction ?? this.faction);
    }
    if (sound === null || sound.index < 0 || sound.index >= this.soundCount) return null;
    return sound;
  }

  /**
   * Random variant, never the previous one when ≥ 2 exist; skips variants without a decoded
   * buffer. −1 if no variant is loaded.
   */
  private pickVariant(sound: ResolvedSound): number {
    const n = sound.variantCount;
    const si = sound.index;
    if (n <= 1) return n === 1 && this.resolver.buffer(si, 0) !== null ? 0 : -1;
    const last = this.lastVariant[si]!;
    let v: number;
    if (last >= 0 && last < n) {
      v = Math.floor(this.random() * (n - 1));
      if (v >= n - 1) v = n - 2;
      if (v >= last) v++;
    } else {
      v = Math.floor(this.random() * n);
      if (v >= n) v = n - 1;
    }
    for (let k = 0; k < n; k++) {
      const c = (v + k) % n;
      if (c === last) continue;
      if (this.resolver.buffer(si, c) !== null) return c;
    }
    return last >= 0 && last < n && this.resolver.buffer(si, last) !== null ? last : -1;
  }

  /** Effective loudness for stealing: gain × remaining fraction (loops/not yet started: 1). */
  private loudness(rec: VoiceRecord, now: number): number {
    if (rec.loop || now <= rec.startAt) return rec.effGain;
    const len = rec.endAt - rec.startAt;
    if (!(len > 0) || len === Number.POSITIVE_INFINITY) return rec.effGain;
    const rem = (rec.endAt - now) / len;
    return rec.effGain * (rem <= 0 ? 0 : rem >= 1 ? 1 : rem);
  }

  /**
   * Victim inside one sound (`soundIndex ≥ 0`) or one category: lowest effective loudness, ties
   * → oldest; never a higher priority, a loop only for a strictly higher priority; the new voice
   * must be at least as loud as the victim.
   */
  private pickLocal(soundIndex: number, catIndex: number, prio: number, newGain: number): VoiceRecord | null {
    const now = this.ctx.currentTime;
    let best: VoiceRecord | null = null;
    let bestL = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.slots.length; i++) {
      const rec = this.slots[i]!;
      if (rec.state !== ACTIVE) continue;
      if (soundIndex >= 0 ? rec.soundIndex !== soundIndex : rec.categoryIndex !== catIndex) continue;
      if (rec.priority > prio || (rec.loop && rec.priority >= prio)) continue;
      const l = this.loudness(rec, now);
      if (l < bestL || (l === bestL && best !== null && rec.seq < best.seq)) {
        best = rec;
        bestL = l;
      }
    }
    return best !== null && newGain >= bestL ? best : null;
  }

  /** Global victim: the quietest voice with a strictly lower priority (ties → oldest). */
  private pickGlobal(prio: number): VoiceRecord | null {
    const now = this.ctx.currentTime;
    let best: VoiceRecord | null = null;
    let bestL = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.slots.length; i++) {
      const rec = this.slots[i]!;
      if (rec.state !== ACTIVE || rec.priority >= prio) continue;
      const l = this.loudness(rec, now);
      if (l < bestL || (l === bestL && best !== null && rec.seq < best.seq)) {
        best = rec;
        bestL = l;
      }
    }
    return best;
  }

  private steal(rec: VoiceRecord): void {
    this.stolen++;
    this.release(rec, this.stealFadeMs);
  }

  /**
   * Ends the logical voice of `rec`: fades it out as a tail over `fadeMs` (or cuts it for
   * `fadeMs ≤ 0`) and frees the slot at once.
   */
  private release(rec: VoiceRecord, fadeMs: number): void {
    const src = rec.source!;
    if (!(fadeMs > 0)) {
      cutNodes(src, rec.gainNode, rec.panner);
      this.freeSlot(rec);
      return;
    }
    const tail = this.acquireTail();
    if (tail === null) {
      cutNodes(src, rec.gainNode, rec.panner);
      this.freeSlot(rec);
      return;
    }
    const now = this.ctx.currentTime;
    const end = now + fadeMs / 1000;
    const g = rec.gainNode!.gain;
    // Start the fade from the value actually playing (a gain ramp may still be in progress).
    const cur = g.value;
    g.cancelScheduledValues(now);
    g.setValueAtTime(cur >= 0 && cur < Number.POSITIVE_INFINITY ? cur : rec.effGain, now);
    g.linearRampToValueAtTime(0, end);
    safeStop(src, end);
    tail.state = ACTIVE;
    tail.source = src;
    tail.gainNode = rec.gainNode;
    tail.panner = rec.panner;
    tail.startAt = rec.startAt;
    tail.endAt = end > rec.startAt ? end : rec.startAt;
    tail.seq = ++this.seq;
    src.onended = tail.onEnded;
    this.tailCount++;
    this.freeSlot(rec);
  }

  /** A free tail record; if the budget is used up the oldest tail is cut to make room. */
  private acquireTail(): VoiceRecord | null {
    let oldest: VoiceRecord | null = null;
    for (let i = 0; i < this.tailRecs.length; i++) {
      const t = this.tailRecs[i]!;
      if (t.state === FREE) return t;
      if (oldest === null || t.seq < oldest.seq) oldest = t;
    }
    if (oldest === null) return null;
    cutNodes(oldest.source!, oldest.gainNode, oldest.panner);
    this.freeTail(oldest);
    return oldest;
  }

  private startVoice(
    sound: ResolvedSound,
    buffer: AudioBufferLike,
    loop: boolean,
    rate: number,
    jitter: number,
    eff: number,
    pan: number,
    when: number,
  ): VoiceRecord {
    const ctx = this.ctx;
    const rec = this.slots[this.freeStack[--this.freeTop]!]!;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const playRate = rate * jitter;
    src.playbackRate.value = playRate;
    if (loop) {
      src.loop = true;
      const lp = sound.loop;
      if (lp !== null) {
        // Seconds, not samples: correct for buffers resampled to the context rate.
        const end = lp.endS < buffer.duration ? lp.endS : buffer.duration;
        src.loopStart = lp.startS < end ? lp.startS : 0;
        src.loopEnd = end;
      }
    }
    const gain = ctx.createGain();
    gain.gain.value = eff;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    src.connect(gain);
    gain.connect(panner);
    panner.connect(this.mixer.busInput(sound.bus));
    src.onended = rec.onEnded;
    const now = ctx.currentTime;
    src.start(when);

    rec.state = ACTIVE;
    rec.source = src;
    rec.gainNode = gain;
    rec.panner = panner;
    rec.soundIndex = sound.index;
    rec.categoryIndex = sound.categoryIndex;
    rec.loop = loop;
    rec.effGain = eff;
    rec.pan = pan;
    rec.rate = rate;
    rec.jitter = jitter;
    rec.startAt = when > now ? when : now;
    rec.endAt = loop ? Number.POSITIVE_INFINITY : rec.startAt + buffer.duration / playRate;
    rec.seq = ++this.seq;

    this.soundVoiceCount[sound.index]!++;
    this.catVoices[sound.categoryIndex]!++;
    this.voices++;
    if (this.voices > this.peakVoices) this.peakVoices = this.voices;
    this.played++;
    return rec;
  }

  private freeSlot(rec: VoiceRecord): void {
    rec.state = FREE;
    rec.gen++;
    rec.source = null;
    rec.gainNode = null;
    rec.panner = null;
    this.soundVoiceCount[rec.soundIndex]!--;
    this.catVoices[rec.categoryIndex]!--;
    this.voices--;
    this.freeStack[this.freeTop++] = rec.slot;
  }

  private freeTail(rec: VoiceRecord): void {
    rec.state = FREE;
    rec.gen++;
    rec.source = null;
    rec.gainNode = null;
    rec.panner = null;
    this.tailCount--;
  }

  /**
   * `onended` of a slot. Sources are re-pointed (tail handler) or detached (`onended = null`)
   * whenever they leave a record, and a real 'ended' event carries its source as `target`, so a
   * late event of an earlier voice can never free the voice that now occupies the slot.
   */
  private slotEnded(rec: VoiceRecord, ev: Event | null): void {
    if (rec.state !== ACTIVE) return;
    const src = rec.source!;
    const target: unknown = ev === null ? null : ev.target;
    if (target !== null && target !== src) return;
    src.onended = null;
    src.disconnect();
    rec.gainNode!.disconnect();
    rec.panner!.disconnect();
    this.freeSlot(rec);
  }

  private tailEnded(rec: VoiceRecord, ev: Event | null): void {
    if (rec.state !== ACTIVE) return;
    const src = rec.source!;
    const target: unknown = ev === null ? null : ev.target;
    if (target !== null && target !== src) return;
    src.onended = null;
    src.disconnect();
    rec.gainNode!.disconnect();
    rec.panner!.disconnect();
    this.freeTail(rec);
  }

  private applyGain(rec: VoiceRecord, rampMs: number): void {
    rec.effGain = rec.reqGain * rec.spatialGain;
    const p = rec.gainNode!.gain;
    const now = this.ctx.currentTime;
    p.cancelScheduledValues(now);
    if (rampMs === 0) p.setValueAtTime(rec.effGain, now);
    else p.setTargetAtTime(rec.effGain, now, rampMs > 0 ? rampMs / 3000 : VOICE_RAMP_TAU_S);
  }

  private respatialize(rec: VoiceRecord): void {
    const out = this.tmp;
    const sp = this.spatial;
    let gain = 0;
    let pan = rec.pan;
    if (sp !== null && sp.spatialize(rec.categoryIndex, rec.x, rec.z, out)) {
      gain = out.gain;
      pan = out.pan;
    }
    rec.spatialGain = gain;
    this.applyGain(rec, -1);
    if (pan !== rec.pan) {
      rec.pan = pan;
      const p = rec.panner!.pan;
      const now = this.ctx.currentTime;
      p.cancelScheduledValues(now);
      p.setTargetAtTime(pan, now, VOICE_RAMP_TAU_S);
    }
  }
}
