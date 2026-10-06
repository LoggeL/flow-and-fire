/**
 * AI sides for arena matches, with the host as a switch (tournaments, benchmarks, host tests):
 *
 * - 'sync':   AiHost + SyncAiSource in the match thread (headless default; commands never pending),
 * - 'worker': the brain runs in a Node worker thread (NodeAiWorker + AsyncAiSource over the
 *             @faf/ai/host protocol); the match must run with `runMatchAsync` (or a scheduler) to
 *             await 'pending'.
 *
 * Both hosts receive the same perception bytes (ArenaPerceiver = PerceptionWriter layout) and the
 * same init data, so they produce the same command stream (AI-DET-01). Every think is recorded in
 * `SideStats` (ops per think and manager, wall time, aborts); timeout marks and telemetry are kept
 * per side.
 */
import { parseOpenings, profileFor, type AiProfile, type Difficulty, type OpeningsDoc, type TelemetryEvent } from '@faf/ai';
import {
  AiHost,
  AsyncAiSource,
  SyncAiSource,
  toAiStaticWire,
  type AiClock,
  type AiHostEnv,
  type AiTimeoutMark,
} from '@faf/ai/host';
import type { CommandSource } from '@faf/protocol';
import { hostClock, type HostClockKind } from '../bench/clock.ts';
import { getArenaBps } from '../data/assumptions.ts';
import { loadOpeningsJson, loadRosterJson, type OpeningsJson, type RosterJson } from '../data/design.ts';
import { ArenaPerceiver } from '../perception/perceive.ts';
import type { ArenaWorld } from '../world/world.ts';
import { DEFAULT_BRAIN_SPEC, normalizeBrainSpec, type LoadedBrainFactory } from './brain-spec.ts';
import { NodeAiWorker, type NodeAiWorkerOptions } from './node-worker.ts';

export type HostKind = 'sync' | 'worker';

export const HOST_KINDS: readonly HostKind[] = ['sync', 'worker'];

let openingsJsonCache: OpeningsJson | null = null;
let openingsDocCache: OpeningsDoc | null = null;
let rosterJsonCache: RosterJson | null = null;

/** Raw ai-openings.json (cached per thread). */
export function arenaOpeningsJson(): OpeningsJson {
  openingsJsonCache ??= loadOpeningsJson();
  return openingsJsonCache;
}

/** Parsed ai-openings.json (cached per thread). */
export function arenaOpeningsDoc(): OpeningsDoc {
  openingsDocCache ??= parseOpenings(arenaOpeningsJson());
  return openingsDocCache;
}

/** Raw roster.json (cached per thread) — the blueprint source sent to AI workers. */
export function arenaRosterJson(): RosterJson {
  rosterJsonCache ??= loadRosterJson();
  return rosterJsonCache;
}

/** Per-think statistics of one AI side (diagnostics; never influence the match). */
export class SideStats {
  /** ThinkResult.opsTotal per think. */
  readonly ops: number[] = [];
  readonly ingestOps: number[] = [];
  /** Wall-clock ms per think (measured by the host's clock). */
  readonly ms: number[] = [];
  /** Think ticks in order. */
  readonly ticks: number[] = [];
  /** Ops per manager per think (managers not run in a think are absent for that think). */
  readonly opsByManager = new Map<string, number[]>();
  aborted = 0;

  record(tick: number, ops: number, ingestOps: number, byManager: Readonly<Record<string, number>>, ms: number, aborted: boolean): void {
    this.ticks.push(tick);
    this.ops.push(ops);
    this.ingestOps.push(ingestOps);
    this.ms.push(ms);
    if (aborted) this.aborted++;
    for (const name of Object.keys(byManager)) {
      let arr = this.opsByManager.get(name);
      if (arr === undefined) {
        arr = [];
        this.opsByManager.set(name, arr);
      }
      arr.push(byManager[name]!);
    }
  }

  get thinks(): number {
    return this.ops.length;
  }
}

export interface AiSideOptions {
  readonly army: number;
  readonly profile: Difficulty;
  readonly host: HostKind;
  /** Brain specifier 'module#export' (default '@faf/ai#createDefaultBrain'). */
  readonly brainSpec?: string;
  /** Loaded factory of `brainSpec` — required for the 'sync' host (loadBrainFactory). */
  readonly brainFactory?: LoadedBrainFactory;
  readonly openingId?: string;
  readonly maxMs?: number;
  /** Emergency limit preset (default 'headless' = 200 ms). */
  readonly env?: AiHostEnv;
  readonly timeoutMs?: number;
  readonly budgetScale?: number;
  /** Clock of the emergency stop ('sync' only; overrides clockKind). */
  readonly clock?: AiClock;
  /** Emergency-stop clock kind for both hosts (default 'wall'; see bench/clock.ts). */
  readonly clockKind?: HostClockKind;
  /** Default: world.seed. */
  readonly gameSeed?: number;
  readonly workerOptions?: NodeAiWorkerOptions;
}

export interface AiSide {
  readonly army: number;
  readonly host: HostKind;
  readonly profile: AiProfile;
  readonly brainSpec: string;
  readonly source: CommandSource;
  readonly stats: SideStats;
  /** aiTimeout marks (MARK chunk of the recorder in the real game). */
  readonly marks: readonly AiTimeoutMark[];
  readonly telemetry: readonly TelemetryEvent[];
  /** Opening chosen by the brain (sync: immediately; worker: after its ready message). */
  openingId(): string | null;
  /** Ends the worker thread (no-op for 'sync'). */
  close(): Promise<void>;
}

/**
 * Creates an AI side for `world` (call before the first step of the match, e.g. inside a
 * runMatch source factory). The side's perception is written by its own ArenaPerceiver; do not
 * use `MatchSourceContext.perceive` for the same army in parallel (it consumes the event queue).
 */
export function createAiSide(world: ArenaWorld, o: AiSideOptions): AiSide {
  const openings = arenaOpeningsDoc();
  const profile = profileFor(o.profile, openings);
  const spec = normalizeBrainSpec(o.brainSpec ?? DEFAULT_BRAIN_SPEC);
  const gameSeed = (o.gameSeed ?? world.seed) >>> 0;
  const perceiver = new ArenaPerceiver(world, o.army, gameSeed);
  const stats = new SideStats();
  if (o.host === 'sync') {
    if (o.brainFactory === undefined) throw new Error(`createAiSide: the sync host needs a loaded brainFactory for '${spec}'`);
    const host = new AiHost({
      brain: o.brainFactory(),
      static: perceiver.static,
      profile,
      openings,
      gameSeed,
      ...(o.openingId !== undefined ? { openingId: o.openingId } : {}),
      ...(o.maxMs !== undefined ? { maxMs: o.maxMs } : {}),
      ...(o.env !== undefined ? { env: o.env } : {}),
      ...(o.timeoutMs !== undefined ? { timeoutMs: o.timeoutMs } : {}),
      ...(o.budgetScale !== undefined ? { budgetScale: o.budgetScale } : {}),
      ...(o.clock !== undefined ? { clock: o.clock } : o.clockKind !== undefined ? { clock: hostClock(o.clockKind) } : {}),
    });
    const telemetry: TelemetryEvent[] = [];
    const source = new SyncAiSource({
      host,
      perceive: (tick) => perceiver.bytes(tick),
      onThink: (tick, r) => {
        stats.record(tick, r.opsTotal, r.ingestOps, r.opsByManager, r.elapsedMs, r.aborted);
        for (const e of r.telemetry) telemetry.push(e);
      },
    });
    return {
      army: o.army,
      host: 'sync',
      profile,
      brainSpec: spec,
      source,
      stats,
      marks: host.marks,
      telemetry,
      openingId: () => host.openingId,
      close: () => Promise.resolve(),
    };
  }
  if (world.bps !== getArenaBps()) {
    throw new Error('createAiSide: the worker host rebuilds the blueprint table from roster.json; the world must use getArenaBps()');
  }
  const worker = new NodeAiWorker({ ...(o.clockKind !== undefined ? { clock: o.clockKind } : {}), ...o.workerOptions });
  const source = new AsyncAiSource({
    port: worker.port,
    init: {
      static: toAiStaticWire(perceiver.static, { kind: 'roster', roster: arenaRosterJson() }),
      profileName: o.profile,
      gameSeed,
      openings: arenaOpeningsJson(),
      brainSpec: spec,
      ...(o.openingId !== undefined ? { openingId: o.openingId } : {}),
      ...(o.maxMs !== undefined ? { maxMs: o.maxMs } : {}),
      ...(o.env !== undefined ? { env: o.env } : {}),
      ...(o.timeoutMs !== undefined ? { timeoutMs: o.timeoutMs } : {}),
      ...(o.budgetScale !== undefined ? { budgetScale: o.budgetScale } : {}),
    },
    thinkEvery: profile.thinkEvery,
    lead: profile.lead,
    perceiveBytes: (tick) => perceiver.bytes(tick),
    onResult: (r) => stats.record(r.tick, r.ops, r.ingestOps, r.opsByManager, r.ms, r.aborted),
  });
  let closed = false;
  return {
    army: o.army,
    host: 'worker',
    profile,
    brainSpec: spec,
    source,
    stats,
    marks: source.marks,
    telemetry: source.telemetry,
    openingId: () => source.ready?.opening ?? null,
    close: async () => {
      if (closed) return;
      closed = true;
      source.shutdown();
      await worker.terminate();
    },
  };
}

/** Closes all sides (ignores errors of already dead workers). */
export async function closeAiSides(sides: readonly AiSide[]): Promise<void> {
  await Promise.all(sides.map((s) => s.close().catch(() => undefined)));
}
