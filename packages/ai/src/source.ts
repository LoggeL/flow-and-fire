/**
 * CommandSource adapters of the AI (PLAN §3.1/§3.10): the AI thinks at N ≡ 0 (mod thinkEvery) with
 * Perception(N) and its commands apply at N + lead. `AiCommandSource` runs the brain synchronously
 * (headless, arena); `PendingAiSource` is the generic base of asynchronous hosts (worker): the sim
 * asks `commandsFor(t)`, gets 'pending' while the result of a due think is missing and waits
 * (SP sim lag — nothing is dropped).
 */
import type { Tick } from '@faf/fixed';
import type { CommandEnvelope, CommandSource } from '@faf/protocol';
import type { AiBrain, ThinkOptions, ThinkResult } from './brain.ts';
import type { PerceptionView } from './types.ts';

export interface AiCommandSourceOptions {
  readonly brain: AiBrain;
  /** Optional host-controlled think, including emergency clock boundary. */
  readonly think?: (view:PerceptionView, options?:ThinkOptions)=>ThinkResult;
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
 * Synchronous AI source: at a think tick N it perceives, thinks and stores the commands for
 * N + lead; `commandsFor(t)` returns the commands due at t (never 'pending'). Ticks must be asked
 * in ascending order without gaps at think ticks (every tick once, as the sim does).
 */
export class AiCommandSource implements CommandSource {
  private readonly brain: AiBrain;
  private readonly think: (view:PerceptionView, options?:ThinkOptions)=>ThinkResult;
  private readonly perceive: (tick: number) => PerceptionView;
  readonly thinkEvery: number;
  readonly lead: number;
  private readonly thinkOptions: ThinkOptions | ((tick: number) => ThinkOptions) | undefined;
  private readonly onThink: ((tick: number, result: ThinkResult) => void) | undefined;
  /** Due tick → commands (insertion order). */
  private readonly due = new Map<number, readonly CommandEnvelope[]>();
  private lastThink = -1;

  constructor(o: AiCommandSourceOptions) {
    this.brain = o.brain;
    this.think = o.think ?? ((view,options)=>this.brain.think(view,options));
    this.perceive = o.perceive;
    this.thinkEvery = o.thinkEvery ?? o.brain.profile.thinkEvery;
    this.lead = o.lead ?? o.brain.profile.lead;
    if (!(this.thinkEvery >= 1) || !(this.lead >= 0)) throw new RangeError('AiCommandSource: bad thinkEvery/lead');
    this.thinkOptions = o.thinkOptions;
    this.onThink = o.onThink;
  }

  commandsFor(tick: Tick): readonly CommandEnvelope[] {
    const t = tick as number;
    if (t % this.thinkEvery === 0 && t > this.lastThink) {
      this.lastThink = t;
      const opts = typeof this.thinkOptions === 'function' ? this.thinkOptions(t) : this.thinkOptions;
      const r = this.think(this.perceive(t), opts);
      this.onThink?.(t, r);
      const at = t + this.lead;
      const prev = this.due.get(at);
      this.due.set(at, prev === undefined ? r.commands : [...prev, ...r.commands]);
    }
    const out = this.due.get(t);
    if (out === undefined) return [];
    this.due.delete(t);
    return out;
  }
}

export interface PendingAiSourceOptions {
  readonly thinkEvery: number;
  readonly lead: number;
  /** Asks the host to think at tick N (perception of N); called exactly once per think tick. */
  readonly request: (tick: number) => void;
}

/**
 * Generic asynchronous AI source: `commandsFor(t)` triggers `request(N)` at think ticks N and
 * answers 'pending' as long as a think N with N + lead ≤ t has not been delivered. `deliver(N, cmds)`
 * stores the commands of think N for tick N + lead.
 */
export class PendingAiSource implements CommandSource {
  readonly thinkEvery: number;
  readonly lead: number;
  private readonly request: (tick: number) => void;
  /** Requested, not yet delivered thinks (ascending). */
  private readonly outstanding: number[] = [];
  private readonly due = new Map<number, readonly CommandEnvelope[]>();
  private lastRequested = -1;
  private pendingAnswers = 0;

  constructor(o: PendingAiSourceOptions) {
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

  commandsFor(tick: Tick): readonly CommandEnvelope[] | 'pending' {
    const t = tick as number;
    if (t % this.thinkEvery === 0 && t > this.lastRequested) {
      this.lastRequested = t;
      this.outstanding.push(t);
      this.request(t);
    }
    if (this.outstanding.length > 0 && this.outstanding[0]! + this.lead <= t) {
      this.pendingAnswers++;
      return 'pending';
    }
    const out = this.due.get(t);
    if (out === undefined) return [];
    this.due.delete(t);
    return out;
  }

  /** Delivers the commands of think N (applied at N + lead). */
  deliver(thinkTick: number, cmds: readonly CommandEnvelope[]): void {
    const i = this.outstanding.indexOf(thinkTick);
    if (i < 0) throw new Error(`PendingAiSource: think ${thinkTick} was not requested or already delivered`);
    this.outstanding.splice(i, 1);
    const at = thinkTick + this.lead;
    const prev = this.due.get(at);
    this.due.set(at, prev === undefined ? cmds : [...prev, ...cmds]);
  }
}
