/**
 * Alert queue (PLAN §3.7, docs/design/audio.md §6 MS9): priority queue of spoken/gong alerts with
 * a per-alert repeat interval, a location exception, expiry, exactly one alert voice at a time,
 * a history ring with positions and jump-to-location (repeated calls step back, like FA's space
 * bar). Alerts are rare (a few per minute), so records are plain objects; the per-frame
 * `update` does not allocate while the queue is idle.
 */

import type { AlertRule } from '../events/index.ts';
import type {
  AlertMode,
  AlertRecord,
  AlertRequest,
  JumpToCallback,
  PlayRequest,
  SoundResolver,
  SoundSink,
  VoiceHandle,
} from '../types.ts';

/** Default location radius (WU) of the location exception when the rule has none. */
export const DEFAULT_ALERT_RADIUS_WU = 48;

export interface AlertQueueOptions {
  resolver: SoundResolver;
  /** Faction scope for the alert sound lookup (per-request `faction` wins). */
  faction: string;
  /** Wall clock in ms (push time, jump window). */
  clockMs: () => number;
  onJumpTo?: JumpToCallback | undefined;
  /** Called once per announced alert (also when the voice was dropped, e.g. engine locked). */
  onAlert?: ((a: AlertRecord) => void) | undefined;
  /** Called when an alert voice actually started (the engine ducks sfx/music with it). */
  onAlertStart?: ((durationS: number) => void) | undefined;
  /** Alert rules of the event map (`EventSoundMap.alerts`): sound, repeatMs, radiusWu. */
  rules?: Readonly<Record<string, AlertRule>> | undefined;
  /** Pending alerts at most (default 4). */
  maxQueue?: number | undefined;
  /** Pending alerts older than this are dropped unannounced (default 6000 ms). */
  maxAgeMs?: number | undefined;
  /** Minimum spacing of the same alert at a clearly different location (default 1500 ms). */
  minSpacingMs?: number | undefined;
  /** History ring size (default 8). */
  historySize?: number | undefined;
  /** Radius for alerts whose rule has none (default 48 WU). */
  defaultRadiusWu?: number | undefined;
  /** Repeated `jumpToLast` calls within this window step further back (default 3000 ms). */
  jumpBackWindowMs?: number | undefined;
  /** Safety margin after the nominal alert duration before the next may start (default 100 ms). */
  endMarginMs?: number | undefined;
}

/** Counters of the queue (plain numbers, reset with `resetStats`). */
export interface AlertQueueStats {
  /** Accepted by `push`. */
  queued: number;
  /** Rejected by the repeat interval (incl. same location). */
  suppressed: number;
  /** Rejected because the alert sound is unknown. */
  unknown: number;
  /** Rejected or evicted because the queue was full of equal/higher priority. */
  overflow: number;
  /** Expired unannounced after `maxAgeMs`. */
  expired: number;
  /** Announced (history entry written). */
  announced: number;
  /** Announced with a started voice. */
  voiced: number;
}

interface Pending {
  active: boolean;
  seq: number;
  kind: string;
  soundIndex: number;
  soundId: string;
  priority: number;
  durationS: number;
  hasPos: boolean;
  x: number;
  z: number;
  pushedMs: number;
}

/** Recent accepted locations per alert kind (location exception). */
interface KindState {
  lastMs: number;
  readonly ms: Float64Array;
  readonly x: Float64Array;
  readonly z: Float64Array;
  readonly hasPos: Uint8Array;
  next: number;
}

const RECENT = 4;

interface HistoryEntry {
  readonly record: AlertRecord;
  readonly seq: number;
}

export class AlertQueue {
  readonly stats: AlertQueueStats = { queued: 0, suppressed: 0, unknown: 0, overflow: 0, expired: 0, announced: 0, voiced: 0 };

  private readonly resolver: SoundResolver;
  private readonly faction: string;
  private readonly clockMs: () => number;
  private readonly onJumpTo: JumpToCallback | undefined;
  private readonly onAlert: ((a: AlertRecord) => void) | undefined;
  private readonly onAlertStart: ((durationS: number) => void) | undefined;
  private readonly rules: Readonly<Record<string, AlertRule>>;
  private readonly maxAgeMs: number;
  private readonly minSpacingMs: number;
  private readonly defaultRadiusWu: number;
  private readonly jumpBackWindowMs: number;
  private readonly endMarginMs: number;

  private readonly pending: Pending[] = [];
  private readonly kinds = new Map<string, KindState>();
  private readonly history: (HistoryEntry | null)[];
  private historyNext = 0;
  private historyCount = 0;
  private seq = 0;
  private recordSeq = 0;

  private current: VoiceHandle | null = null;
  private mode: AlertMode = 'voice';
  private currentEndMs = 0;
  private readonly req: PlayRequest = {
    sound: 0,
    faction: undefined,
    x: undefined,
    z: undefined,
    gain: 1,
    rate: 1,
    when: undefined,
    priorityBoost: undefined,
    loop: false,
  };

  private lastJumpMs = Number.NEGATIVE_INFINITY;
  private jumpCursorSeq = -1;

  constructor(opts: AlertQueueOptions) {
    this.resolver = opts.resolver;
    this.faction = opts.faction;
    this.clockMs = opts.clockMs;
    this.onJumpTo = opts.onJumpTo;
    this.onAlert = opts.onAlert;
    this.onAlertStart = opts.onAlertStart;
    this.rules = opts.rules ?? {};
    const maxQueue = opts.maxQueue ?? 4;
    const historySize = opts.historySize ?? 8;
    if (!Number.isInteger(maxQueue) || maxQueue < 1) throw new RangeError(`maxQueue must be an integer ≥ 1, got ${maxQueue}`);
    if (!Number.isInteger(historySize) || historySize < 1) throw new RangeError(`historySize must be an integer ≥ 1, got ${historySize}`);
    this.maxAgeMs = opts.maxAgeMs ?? 6000;
    this.minSpacingMs = opts.minSpacingMs ?? 1500;
    this.defaultRadiusWu = opts.defaultRadiusWu ?? DEFAULT_ALERT_RADIUS_WU;
    this.jumpBackWindowMs = opts.jumpBackWindowMs ?? 3000;
    this.endMarginMs = opts.endMarginMs ?? 100;
    for (let i = 0; i < maxQueue; i++) {
      this.pending.push({ active: false, seq: 0, kind: '', soundIndex: -1, soundId: '', priority: 0, durationS: 0, hasPos: false, x: 0, z: 0, pushedMs: 0 });
    }
    this.history = new Array<HistoryEntry | null>(historySize).fill(null);
  }

  /** Number of pending (not yet announced) alerts. */
  get size(): number {
    let n = 0;
    for (const p of this.pending) if (p.active) n++;
    return n;
  }

  /** True while an alert voice is playing. */
  get busy(): boolean {
    return this.current !== null && this.current.alive;
  }

  /** A policy change also stops the current alert, without affecting acknowledgements. */
  setMode(mode: AlertMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.current?.stop(20);
    this.current = null;
    this.currentEndMs = 0;
  }

  /**
   * Queues an alert. Returns false if it is suppressed (repeat interval, same location), the
   * sound is unknown, or the queue is full of alerts with equal or higher priority.
   */
  push(req: AlertRequest): boolean {
    const nowMs = this.clockMs();
    const rule = this.rules[req.kind];
    const sound = this.resolver.resolve(rule !== undefined ? rule.sound : req.kind, req.faction ?? this.faction);
    if (sound === null) {
      this.stats.unknown++;
      return false;
    }
    const hasPos = req.x !== undefined && req.z !== undefined && Number.isFinite(req.x) && Number.isFinite(req.z);
    const x = hasPos ? (req.x as number) : 0;
    const z = hasPos ? (req.z as number) : 0;
    const intervalMs = rule !== undefined && rule.repeatMs !== null ? rule.repeatMs : sound.cooldownMs;
    const radius = rule !== undefined && rule.radiusWu !== null ? rule.radiusWu : this.defaultRadiusWu;

    let state = this.kinds.get(req.kind);
    if (state !== undefined && nowMs - state.lastMs < intervalMs) {
      if (!hasPos || nowMs - state.lastMs < this.minSpacingMs || !this.farFromRecent(state, nowMs, intervalMs, x, z, radius)) {
        this.stats.suppressed++;
        return false;
      }
    }

    const slot = this.freeSlot(sound.priority);
    if (slot === null) {
      this.stats.overflow++;
      return false;
    }
    slot.active = true;
    slot.seq = ++this.seq;
    slot.kind = req.kind;
    slot.soundIndex = sound.index;
    slot.soundId = sound.id;
    slot.priority = sound.priority;
    slot.durationS = sound.durationS;
    slot.hasPos = hasPos;
    slot.x = x;
    slot.z = z;
    slot.pushedMs = nowMs;

    if (state === undefined) {
      state = { lastMs: nowMs, ms: new Float64Array(RECENT), x: new Float64Array(RECENT), z: new Float64Array(RECENT), hasPos: new Uint8Array(RECENT), next: 0 };
      state.ms.fill(Number.NEGATIVE_INFINITY);
      this.kinds.set(req.kind, state);
    }
    state.lastMs = nowMs;
    const r = state.next;
    state.ms[r] = nowMs;
    state.x[r] = x;
    state.z[r] = z;
    state.hasPos[r] = hasPos ? 1 : 0;
    state.next = (r + 1) % RECENT;
    this.stats.queued++;
    return true;
  }

  /**
   * Per frame: expires old entries and starts the next alert once the previous alert voice has
   * ended (handle no longer alive, or its nominal duration passed). The alert is announced
   * (history, `onAlert`) even if the sink drops the voice (engine locked, muted, not loaded).
   */
  update(nowMs: number, sink: SoundSink): void {
    for (const p of this.pending) {
      if (p.active && nowMs - p.pushedMs > this.maxAgeMs) {
        p.active = false;
        this.stats.expired++;
      }
    }
    if (this.current !== null) {
      if (this.current.alive && nowMs < this.currentEndMs) return;
      this.current = null;
    }
    let best: Pending | null = null;
    for (const p of this.pending) {
      if (!p.active) continue;
      if (best === null || p.priority > best.priority || (p.priority === best.priority && p.seq < best.seq)) best = p;
    }
    if (best === null) return;
    best.active = false;

    const req = this.req;
    const gong = this.mode === 'gong' ? this.resolver.resolve('alt_gong', this.faction) : null;
    req.sound = gong?.index ?? best.soundIndex;
    // No fallback to voiced alerts if the requested gong is unavailable.
    const handle = this.mode === 'off' || (this.mode === 'gong' && gong === null) ? null : sink.play(req, nowMs);
    const durationS = gong?.durationS ?? best.durationS;
    if (handle !== null) {
      this.current = handle;
      this.currentEndMs = nowMs + durationS * 1000 + this.endMarginMs;
      this.stats.voiced++;
      this.onAlertStart?.(durationS);
    }
    const record: AlertRecord = {
      kind: best.kind,
      soundId: gong?.id ?? best.soundId,
      x: best.hasPos ? best.x : null,
      z: best.hasPos ? best.z : null,
      atMs: nowMs,
    };
    this.history[this.historyNext] = { record, seq: ++this.recordSeq };
    this.historyNext = (this.historyNext + 1) % this.history.length;
    if (this.historyCount < this.history.length) this.historyCount++;
    this.stats.announced++;
    this.onAlert?.(record);
  }

  /**
   * Calls `onJumpTo` with the newest announced alert that has a position. Repeated calls within
   * `jumpBackWindowMs` step back to older located alerts (wrapping to the newest after the
   * oldest). Returns false if the history holds no alert with a position.
   */
  jumpToLast(): boolean {
    const nowMs = this.clockMs();
    const stepping = nowMs - this.lastJumpMs <= this.jumpBackWindowMs && this.jumpCursorSeq >= 0;
    let target: HistoryEntry | null = null;
    let newest: HistoryEntry | null = null;
    for (let age = 0; age < this.historyCount; age++) {
      const e = this.entryAt(age);
      if (e === null || e.record.x === null || e.record.z === null) continue;
      if (newest === null) newest = e;
      if (!stepping || e.seq < this.jumpCursorSeq) {
        target = e;
        break;
      }
    }
    if (target === null) target = newest;
    if (target === null) return false;
    this.lastJumpMs = nowMs;
    this.jumpCursorSeq = target.seq;
    this.onJumpTo?.(target.record.x as number, target.record.z as number);
    return true;
  }

  /** Announced alerts, newest first (allocates; UI only). */
  historyList(): AlertRecord[] {
    const out: AlertRecord[] = [];
    for (let age = 0; age < this.historyCount; age++) {
      const e = this.entryAt(age);
      if (e !== null) out.push(e.record);
    }
    return out;
  }

  /** Drops pending alerts and forgets repeat state (history stays). */
  clear(): void {
    for (const p of this.pending) p.active = false;
    this.kinds.clear();
    this.current = null;
  }

  resetStats(): void {
    const s = this.stats;
    s.queued = s.suppressed = s.unknown = s.overflow = s.expired = s.announced = s.voiced = 0;
  }

  /** History entry `age` steps back (0 = newest). */
  private entryAt(age: number): HistoryEntry | null {
    const n = this.history.length;
    return this.history[(((this.historyNext - 1 - age) % n) + n) % n] ?? null;
  }

  /** True if (x, z) is farther than `radius` from every located recent alert of this kind. */
  private farFromRecent(s: KindState, nowMs: number, intervalMs: number, x: number, z: number, radius: number): boolean {
    const r2 = radius * radius;
    for (let i = 0; i < RECENT; i++) {
      if (nowMs - s.ms[i]! >= intervalMs) continue;
      if (s.hasPos[i] === 0) return false;
      const dx = s.x[i]! - x;
      const dz = s.z[i]! - z;
      if (dx * dx + dz * dz <= r2) return false;
    }
    return true;
  }

  /** A free slot, or the slot of the lowest-priority (then oldest) entry if `priority` beats it. */
  private freeSlot(priority: number): Pending | null {
    let victim: Pending | null = null;
    for (const p of this.pending) {
      if (!p.active) return p;
      if (victim === null || p.priority < victim.priority || (p.priority === victim.priority && p.seq < victim.seq)) victim = p;
    }
    if (victim !== null && priority > victim.priority) {
      victim.active = false;
      this.stats.overflow++;
      return victim;
    }
    return null;
  }
}
