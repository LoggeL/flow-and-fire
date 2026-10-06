/**
 * CommandSource adapters of the AI (PLAN §3.1/§3.10): the AI thinks at N ≡ 0 (mod thinkEvery) with
 * Perception(N) and its commands apply at N + lead.
 *
 * All AI sources share `DueCommandSource`, which gives them one semantics:
 *
 * - **Envelope form** (`protocol.CommandSource`): `commandsFor(t)` returns the commands due at t or
 *   'pending'. It is idempotent for the current tick: a sim loop that polls several sources and
 *   retries a tick because ANOTHER source was pending gets the same commands again (AI-DET-03:
 *   nothing is dropped).
 * - **Byte form** (structurally the `TickSource` of sim-host, without importing it): `pending(t)`
 *   triggers a due think/request but consumes nothing; `batchFor(t)` returns the due commands as a
 *   command batch (or null), also idempotent for the current tick. Batches delivered as bytes (the
 *   worker's `result`) are handed out unchanged — no decode/encode round trip per tick.
 *
 * Ticks must be asked in ascending order without gaps at think ticks (every tick at least once, as
 * the sim does). `AiCommandSource` runs a bare brain synchronously (unit tests, fixture brains);
 * `SyncAiSource` (host/) runs an `AiHost` with emergency stop and telemetry (arena, scenarios,
 * tournaments, sim-worker fallback); `PendingAiSource` is the generic base of asynchronous hosts
 * (`AsyncAiSource`, the MS6 scripted dummy AI).
 */
import type { Tick } from '@faf/fixed';
import { decodeBatch, encodeBatch, validateBatch, type CommandEnvelope, type CommandSource } from '@faf/protocol';
import type { AiBrain, ThinkOptions, ThinkResult } from './brain.ts';
import type { PerceptionView } from './types.ts';

const NO_COMMANDS: readonly CommandEnvelope[] = [];

/** Commands of one due tick: envelope lists and/or encoded batches, in delivery order. */
type DuePart = { readonly envs: readonly CommandEnvelope[] } | { readonly batch: Uint8Array };

/** The resolved commands of the current tick (both forms created lazily). */
class DueEntry {
  private envsCache: readonly CommandEnvelope[] | null = null;
  private batchCache: Uint8Array | null | undefined = undefined;

  constructor(private readonly parts: readonly DuePart[]) {}

  envelopes(): readonly CommandEnvelope[] {
    if (this.envsCache === null) {
      const p = this.parts;
      if (p.length === 0) this.envsCache = NO_COMMANDS;
      else if (p.length === 1) {
        const x = p[0]!;
        this.envsCache = 'envs' in x ? x.envs : decodeBatch(x.batch);
      } else {
        const out: CommandEnvelope[] = [];
        for (const x of p) for (const e of 'envs' in x ? x.envs : decodeBatch(x.batch)) out.push(e);
        this.envsCache = out;
      }
    }
    return this.envsCache;
  }

  batch(): Uint8Array | null {
    if (this.batchCache === undefined) {
      const p = this.parts;
      const only = p.length === 1 ? p[0]! : null;
      if (only !== null && 'batch' in only) {
        this.batchCache = validateBatch(only.batch) > 0 ? only.batch : null;
      } else {
        const envs = this.envelopes();
        this.batchCache = envs.length === 0 ? null : encodeBatch(envs);
      }
    }
    return this.batchCache;
  }
}

const EMPTY_ENTRY = new DueEntry([]);

/**
 * Due-tick bookkeeping shared by all AI sources. Subclasses implement `prepare(t)`: run/request the
 * think of t if t is a think tick, and answer whether the commands of t are available.
 */
export abstract class DueCommandSource implements CommandSource {
  /** Due tick → parts (insertion order). */
  private readonly due = new Map<number, DuePart[]>();
  private curTick = -1;
  private cur: DueEntry = EMPTY_ENTRY;

  /**
   * Runs or requests the think of `t` (only once per think tick) and returns false while the
   * commands of `t` are not available ('pending'). Must not consume the commands of `t`.
   */
  protected abstract prepare(t: number): boolean;

  /** Stores commands for tick `at` (appended after earlier deliveries for the same tick). */
  protected schedule(at: number, part: DuePart): void {
    if (at <= this.curTick) throw new Error(`AI source: commands for tick ${at} arrive after the tick was served`);
    const list = this.due.get(at);
    if (list === undefined) this.due.set(at, [part]);
    else list.push(part);
  }

  /** The entry of `t` (consumed once, then cached for repeated asks of the same tick). */
  private entry(t: number): DueEntry {
    if (t === this.curTick) return this.cur;
    if (t < this.curTick) throw new RangeError(`AI source: tick ${t} asked after tick ${this.curTick}`);
    const parts = this.due.get(t);
    this.due.delete(t);
    this.curTick = t;
    this.cur = parts === undefined ? EMPTY_ENTRY : new DueEntry(parts);
    return this.cur;
  }

  /** True while the commands of `tick` are missing (TickSource form; consumes nothing). */
  pending(tick: number): boolean {
    if (tick === this.curTick) return false;
    return !this.prepare(tick);
  }

  commandsFor(tick: Tick): readonly CommandEnvelope[] | 'pending' {
    const t = tick as number;
    if (t !== this.curTick && !this.prepare(t)) return 'pending';
    return this.entry(t).envelopes();
  }

  /**
   * The commands of `tick` as one command batch, or null if there are none (TickSource form; only
   * valid when `pending(tick)` is false). The bytes belong to the caller until the next tick (the
   * host stamps the tick in place).
   */
  batchFor(tick: number): Uint8Array | null {
    if (tick !== this.curTick && !this.prepare(tick)) throw new Error(`AI source: batchFor(${tick}) while pending`);
    return this.entry(tick).batch();
  }
}

/** Shared scheduling of the synchronous sources: think at N ≡ 0 (mod thinkEvery), deliver at N + lead. */
export abstract class SyncThinkSource extends DueCommandSource {
  readonly thinkEvery: number;
  readonly lead: number;
  private lastThink = -1;

  constructor(thinkEvery: number, lead: number, what: string) {
    super();
    if (!(thinkEvery >= 1) || !(lead >= 0)) throw new RangeError(`${what}: bad thinkEvery/lead`);
    this.thinkEvery = thinkEvery;
    this.lead = lead;
  }

  /** Thinks at tick N and returns the commands for N + lead. */
  protected abstract thinkAt(tick: number): readonly CommandEnvelope[];

  protected prepare(t: number): boolean {
    if (t % this.thinkEvery === 0 && t > this.lastThink) {
      this.lastThink = t;
      this.schedule(t + this.lead, { envs: this.thinkAt(t) });
    }
    return true;
  }

  /** Synchronous sources are never pending (narrowed signature). */
  override commandsFor(tick: Tick): readonly CommandEnvelope[] {
    return super.commandsFor(tick) as readonly CommandEnvelope[];
  }
}

export interface AiCommandSourceOptions {
  readonly brain: AiBrain;
  /** Perception of the AI's army at tick N (called on think ticks, before the tick is stepped). */
  readonly perceive: (tick: number) => PerceptionView;
  /** Default: brain.profile.thinkEvery. */
  readonly thinkEvery?: number;
  /** Default: brain.profile.lead. */
  readonly lead?: number;
  /** Per-think options (budget scale, abort signal). */
  readonly thinkOptions?: ThinkOptions | ((tick: number) => ThinkOptions);
  /** Called after every think (metrics, telemetry). */
  readonly onThink?: (tick: number, result: ThinkResult) => void;
}

/**
 * Synchronous source over a bare, initialised brain (no emergency stop, no telemetry forwarding):
 * unit tests and fixture brains. Games, scenarios and tournaments use `SyncAiSource` over an
 * `AiHost` (same scheduling, see `SyncThinkSource`). Never 'pending'.
 */
export class AiCommandSource extends SyncThinkSource {
  private readonly brain: AiBrain;
  private readonly perceive: (tick: number) => PerceptionView;
  private readonly thinkOptions: ThinkOptions | ((tick: number) => ThinkOptions) | undefined;
  private readonly onThink: ((tick: number, result: ThinkResult) => void) | undefined;

  constructor(o: AiCommandSourceOptions) {
    super(o.thinkEvery ?? o.brain.profile.thinkEvery, o.lead ?? o.brain.profile.lead, 'AiCommandSource');
    this.brain = o.brain;
    this.perceive = o.perceive;
    this.thinkOptions = o.thinkOptions;
    this.onThink = o.onThink;
  }

  protected thinkAt(t: number): readonly CommandEnvelope[] {
    const opts = typeof this.thinkOptions === 'function' ? this.thinkOptions(t) : this.thinkOptions;
    const r = this.brain.think(this.perceive(t), opts);
    this.onThink?.(t, r);
    return r.commands;
  }
}

export interface PendingAiSourceOptions {
  readonly thinkEvery: number;
  readonly lead: number;
  /** Asks the host to think at tick N (perception of N); called exactly once per think tick. */
  readonly request: (tick: number) => void;
}

/**
 * Generic asynchronous AI source: at think ticks N it calls `request(N)` and answers 'pending'
 * (resp. `pending(t) === true`) as long as a think N with N + lead ≤ t has not been delivered.
 * `deliver(N, cmds)` / `deliverBatch(N, bytes)` store the commands of think N for tick N + lead.
 */
export class PendingAiSource extends DueCommandSource {
  readonly thinkEvery: number;
  readonly lead: number;
  private readonly request: (tick: number) => void;
  /** Requested, not yet delivered thinks (ascending). */
  private readonly outstanding: number[] = [];
  private lastRequested = -1;
  private pendingAnswers = 0;

  constructor(o: PendingAiSourceOptions) {
    super();
    if (!(o.thinkEvery >= 1) || !(o.lead >= 0)) throw new RangeError('PendingAiSource: bad thinkEvery/lead');
    this.thinkEvery = o.thinkEvery;
    this.lead = o.lead;
    this.request = o.request;
  }

  /** Number of 'pending' answers given so far. */
  get pendingCount(): number {
    return this.pendingAnswers;
  }

  /** Thinks requested but not delivered. */
  get outstandingThinks(): readonly number[] {
    return this.outstanding;
  }

  protected prepare(t: number): boolean {
    if (t % this.thinkEvery === 0 && t > this.lastRequested) {
      this.lastRequested = t;
      this.outstanding.push(t);
      this.request(t);
    }
    if (this.outstanding.length > 0 && this.outstanding[0]! + this.lead <= t) {
      this.pendingAnswers++;
      return false;
    }
    return true;
  }

  private settle(thinkTick: number): number {
    const i = this.outstanding.indexOf(thinkTick);
    if (i < 0) throw new Error(`PendingAiSource: think ${thinkTick} was not requested or already delivered`);
    this.outstanding.splice(i, 1);
    return thinkTick + this.lead;
  }

  /** Delivers the commands of think N (applied at N + lead). */
  deliver(thinkTick: number, cmds: readonly CommandEnvelope[]): void {
    const at = this.settle(thinkTick);
    this.schedule(at, { envs: cmds });
  }

  /**
   * Delivers the commands of think N as an encoded command batch (kept as bytes for `batchFor`,
   * decoded only if `commandsFor` asks). Throws RangeError if the batch is malformed.
   */
  deliverBatch(thinkTick: number, batch: Uint8Array): void {
    if (validateBatch(batch) < 0) throw new RangeError(`PendingAiSource: result of think ${thinkTick} is not a valid command batch`);
    const at = this.settle(thinkTick);
    this.schedule(at, { batch });
  }
}
