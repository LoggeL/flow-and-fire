/**
 * AiHost — runs one brain for one army (PLAN §3.10 "AiHost", ai.md §2.1–§2.3):
 *
 * - initialises the brain (static knowledge, profile, openings, seed),
 * - binds perception snapshots (bytes of the PerceptionWriter layout) to a reusable view,
 * - runs a think with the emergency limit (browser 40 ms, headless 200 ms) as `shouldAbort`:
 *   an exceeded limit yields `ThinkResult.aborted`, an `aiTimeout {tick}` mark for the command-log
 *   recorder (MARK chunk, MS9) and the telemetry event `aiTimeout`,
 * - forwards the telemetry appended by the managers since the previous think.
 *
 * The host is environment-neutral (neither DOM nor Node): the same class runs synchronously in the
 * arena/headless (`SyncAiSource`), inside the AI worker (`runAiWorker`) and — MS9 fallback with
 * ≤ 2 cores — inside the sim worker. Only the abort depends on the wall clock (`clock.ts`);
 * without an abort the command stream depends on nothing but seed and perception bytes.
 */
import type { CommandEnvelope } from '@faf/protocol';
import type { TelemetryEvent } from '../blackboard.ts';
import type { AiBrain, ThinkResult } from '../brain.ts';
import type { OpeningsDoc } from '../openings.ts';
import { SnapshotPerception } from '../perception/snapshot.ts';
import type { AiProfile } from '../profile.ts';
import { SyncThinkSource } from '../source.ts';
import type { AiStatic, PerceptionView } from '../types.ts';
import { AI_TIMEOUT_MS, systemClock, type AiClock, type AiHostEnv } from './clock.ts';

/** Emergency-stop mark of one think (recorded as `MARK aiTimeout` by the command-log recorder). */
export interface AiTimeoutMark {
  readonly kind: 'aiTimeout';
  /** Think tick N (its commands apply at N + lead). */
  readonly tick: number;
  /** Measured duration of the aborted think (wall clock, diagnostics only). */
  readonly elapsedMs: number;
}

export interface AiHostOptions {
  /** A fresh, not yet initialised brain. */
  readonly brain: AiBrain;
  readonly static: AiStatic;
  readonly profile: AiProfile;
  readonly openings: OpeningsDoc;
  /** Overrides AiStatic.gameSeed. */
  readonly gameSeed?: number;
  /** Forces an opening (scenarios); otherwise the brain's seeded selection. */
  readonly openingId?: string;
  /** Highest milestone of selectable openings (brain default 11). */
  readonly maxMs?: number;
  /** Emergency limit preset (default 'headless' = 200 ms). */
  readonly env?: AiHostEnv;
  /** Explicit emergency limit in ms (overrides `env`). */
  readonly timeoutMs?: number;
  /** Wall clock of the abort check (default: performance.now). */
  readonly clock?: AiClock;
  /** Scales every budget allotment (AI-DET-02: 0.5). */
  readonly budgetScale?: number;
  /** Called for every aborted think. */
  readonly onTimeout?: (mark: AiTimeoutMark) => void;
}

export interface HostThinkResult extends ThinkResult {
  /** Wall-clock duration of the think in ms (diagnostics/benchmarks, never a decision input). */
  readonly elapsedMs: number;
  /** Telemetry events appended since the previous think (incl. init events on the first think). */
  readonly telemetry: readonly TelemetryEvent[];
}

export class AiHost {
  readonly brain: AiBrain;
  readonly static: AiStatic;
  readonly profile: AiProfile;
  readonly timeoutMs: number;
  /** Timeout marks in think order. */
  readonly marks: AiTimeoutMark[] = [];
  private readonly clock: AiClock;
  private readonly budgetScale: number;
  private readonly onTimeout: ((mark: AiTimeoutMark) => void) | undefined;
  private readonly view: SnapshotPerception;
  private telemetryCursor = 0;
  private thinksRun = 0;

  constructor(o: AiHostOptions) {
    if (o.brain.initialized) throw new Error('AiHost: the brain is already initialised');
    const limit = o.timeoutMs ?? AI_TIMEOUT_MS[o.env ?? 'headless'];
    if (!(limit > 0)) throw new RangeError(`AiHost: timeout must be > 0 ms (${limit})`);
    this.brain = o.brain;
    this.profile = o.profile;
    this.timeoutMs = limit;
    this.clock = o.clock ?? systemClock;
    this.budgetScale = o.budgetScale ?? 1;
    this.onTimeout = o.onTimeout;
    o.brain.init(o.static, o.profile, {
      openings: o.openings,
      ...(o.gameSeed !== undefined ? { gameSeed: o.gameSeed } : {}),
      ...(o.openingId !== undefined ? { openingId: o.openingId } : {}),
      ...(o.maxMs !== undefined ? { maxMs: o.maxMs } : {}),
    });
    this.static = o.brain.static;
    this.view = new SnapshotPerception(this.static);
  }

  /** Id of the opening chosen in init (null if none). */
  get openingId(): string | null {
    return this.brain.opening?.id ?? null;
  }

  /** Number of thinks run. */
  get thinks(): number {
    return this.thinksRun;
  }

  /** Thinks on a perception snapshot (bytes of the PerceptionWriter layout of this army). */
  thinkBytes(bytes: Uint8Array): HostThinkResult {
    this.view.reset(bytes);
    return this.think(this.view);
  }

  /** Thinks on a perception view; aborts at the emergency limit (wall clock). */
  think(view: PerceptionView): HostThinkResult {
    const clock = this.clock;
    const limit = this.timeoutMs;
    const start = clock.now();
    const r = this.brain.think(view, {
      budgetScale: this.budgetScale,
      shouldAbort: () => clock.now() - start > limit,
    });
    const elapsedMs = clock.now() - start;
    this.thinksRun++;
    if (r.aborted) {
      const mark: AiTimeoutMark = { kind: 'aiTimeout', tick: r.tick, elapsedMs };
      this.marks.push(mark);
      this.brain.blackboard.telemetry.push({ kind: 'aiTimeout', tick: r.tick });
      this.onTimeout?.(mark);
    }
    const events = this.brain.blackboard.telemetry.events;
    const telemetry = events.slice(this.telemetryCursor);
    this.telemetryCursor = events.length;
    return { ...r, elapsedMs, telemetry };
  }
}

export interface SyncAiSourceOptions {
  readonly host: AiHost;
  /** Perception of the host's army at tick N (bytes or a view), called on think ticks. */
  readonly perceive: (tick: number) => Uint8Array | PerceptionView;
  /** Default: host.profile.thinkEvery. */
  readonly thinkEvery?: number;
  /** Default: host.profile.lead. */
  readonly lead?: number;
  readonly onThink?: (tick: number, result: HostThinkResult) => void;
}

/**
 * Synchronous CommandSource over an AiHost (headless, arena, scenarios, tournaments, sim-worker
 * fallback): thinks at N ≡ 0 (mod thinkEvery) with Perception(N) and returns the commands at
 * N + lead; never 'pending'. Scheduling, idempotency and the byte form (`pending`/`batchFor`,
 * structurally sim-host's TickSource) come from `SyncThinkSource` (source.ts).
 */
export class SyncAiSource extends SyncThinkSource {
  readonly host: AiHost;
  private readonly perceive: (tick: number) => Uint8Array | PerceptionView;
  private readonly onThink: ((tick: number, result: HostThinkResult) => void) | undefined;

  constructor(o: SyncAiSourceOptions) {
    super(o.thinkEvery ?? o.host.profile.thinkEvery, o.lead ?? o.host.profile.lead, 'SyncAiSource');
    this.host = o.host;
    this.perceive = o.perceive;
    this.onThink = o.onThink;
  }

  protected thinkAt(t: number): readonly CommandEnvelope[] {
    const p = this.perceive(t);
    const r = p instanceof Uint8Array ? this.host.thinkBytes(p) : this.host.think(p);
    this.onThink?.(t, r);
    return r.commands;
  }
}
