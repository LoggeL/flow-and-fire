/**
 * Runs one tournament game (a MatchJob) in the arena and condenses it into a GameRecord: truth
 * metrics (MatchMetrics) plus AI telemetry and host statistics per side. Exceptions become a crash
 * record (the tournament continues and reports the crash with its seed).
 */
import { PROFILES, type AiProfile, type TelemetryEvent } from '@faf/ai';
import type { ArmyMatchMetrics } from '../match/metrics.ts';
import { runMatch, runMatchAsync, type MatchResult, type RunMatchOptions } from '../match/run.ts';
import { loadBrainFactory, type LoadedBrainFactory } from '../host-node/brain-spec.ts';
import { closeAiSides, createAiSide, type AiSide } from '../host-node/sides.ts';
import { errorText } from '../stats/pool.ts';
import { summarize } from '../stats/summary.ts';
import type { GameRecord, ManagerOps, MatchJob, SideRecord } from './types.ts';

/** Budget of a manager name in the profile (opening and emitter draw from the reserve). */
export function managerBudget(profile: AiProfile, name: string): number {
  const b = profile.budget as unknown as Readonly<Record<string, number>>;
  const v = b[name];
  return typeof v === 'number' ? v : profile.budget.reserve;
}

function firstWave(tel: readonly TelemetryEvent[]): { tick: number | null; units: number; forced: boolean; waves: number } {
  let first: Extract<TelemetryEvent, { kind: 'waveAttack' }> | null = null;
  let waves = 0;
  for (const e of tel) {
    if (e.kind !== 'waveAttack') continue;
    waves++;
    if (first === null && e.enemyHalf) first = e;
  }
  return { tick: first?.tick ?? null, units: first?.units ?? 0, forced: first?.forced ?? false, waves };
}

/** Condenses one side of a finished match. */
export function sideRecord(job: MatchJob, side: AiSide, m: ArmyMatchMetrics): SideRecord {
  const js = job.sides[side.army]!;
  const st = side.stats;
  const ops = summarize(st.ops);
  const ms = summarize(st.ms);
  const opsByManager: ManagerOps[] = [];
  for (const [name, values] of st.opsByManager) {
    const s = summarize(values);
    opsByManager.push({ name, thinks: s.n, p99: s.p99, max: s.max, budget: managerBudget(side.profile, name) });
  }
  const wave = firstWave(side.telemetry);
  let retreats = 0;
  for (const e of side.telemetry) if (e.kind === 'retreat') retreats++;
  return {
    army: js.army,
    contestant: js.contestant,
    label: js.label,
    profile: js.profile,
    opening: side.openingId(),
    defeated: m.defeated,
    t2Tick: m.t2Tick,
    firstWaveTick: wave.tick,
    firstWaveUnits: wave.units,
    firstWaveForced: wave.forced,
    waves: wave.waves,
    retreats,
    fac1Tick: m.fac1Tick,
    mex8Tick: m.mex8Tick,
    idleEngineerPct: m.idleEngineerPct,
    engineerIdleTicks: m.engineerIdleTicks,
    engineerAliveTicks: m.engineerAliveTicks,
    energyStallPct: m.energyStallPct,
    energyStallTicks: m.energyStallTicks,
    energyCountedTicks: m.energyCountedTicks,
    overflowPct: m.overflowPct,
    massBpStallPct: m.massBpStallPct,
    apmWindows: m.commandsPerWindow.slice(),
    apmMax: m.apmMax,
    apmCap: side.profile.apm.cap,
    thinks: st.thinks,
    opsP50: ops.p50,
    opsP99: ops.p99,
    opsMax: ops.max,
    budgetTotal: side.profile.budget.total,
    opsByManager,
    aiTimeouts: side.marks.length,
    timeoutTicks: side.marks.map((k) => k.tick),
    thinkMsP50: ms.p50,
    thinkMsP95: ms.p95,
    thinkMsMax: ms.max,
    unitsProduced: m.unitsProduced,
    unitsLost: m.unitsLost,
    commandsRejected: m.commandsRejected,
  };
}

function baseRecord(job: MatchJob): Omit<GameRecord, 'crash' | 'winner' | 'endTick' | 'endReason' | 'commands' | 'sides'> {
  return {
    game: job.game,
    suite: job.suite,
    pairing: job.pairing,
    mirror: job.mirror,
    seed: job.seed,
    map: job.map,
    swapped: job.swapped,
    armyA: job.armyA,
    starts: job.starts,
    aiSeed: job.aiSeed,
    host: job.host,
    clock: job.clock,
    maxTicks: job.maxTicks,
    sampledArmy: job.sampledArmy,
  };
}

/** Crash record of a job (no match result). */
export function crashRecord(job: MatchJob, error: string): GameRecord {
  return { ...baseRecord(job), crash: error, winner: -1, endTick: 0, endReason: 'crash', commands: 0, sides: [] };
}

/** Record of a finished match. */
export function gameRecord(job: MatchJob, r: MatchResult, sides: readonly AiSide[]): GameRecord {
  const recs: SideRecord[] = [];
  for (const army of [0, 1] as const) {
    const side = sides.find((s) => s.army === army);
    const m = r.metrics.armies.find((a) => a.army === army);
    if (side === undefined || m === undefined) throw new Error(`game ${job.game}: side of army ${army} missing`);
    recs.push(sideRecord(job, side, m));
  }
  return {
    ...baseRecord(job),
    crash: null,
    winner: r.metrics.winner,
    endTick: r.metrics.endTick,
    endReason: r.metrics.endReason,
    commands: r.log.commands.length,
    sides: recs,
  };
}

/** Runs a job; never throws (errors become crash records). */
export async function runGameJob(job: MatchJob): Promise<GameRecord> {
  const sides: AiSide[] = [];
  try {
    const factories = new Map<string, LoadedBrainFactory>();
    if (job.host === 'sync') {
      for (const s of job.sides) if (!factories.has(s.brain)) factories.set(s.brain, await loadBrainFactory(s.brain));
    }
    for (const s of job.sides) if (PROFILES[s.profile] === undefined) throw new Error(`unknown profile '${s.profile}'`);
    const opts: RunMatchOptions = {
      map: job.map,
      seed: job.seed,
      maxTicks: job.maxTicks,
      armies: [
        { army: 0, startIndex: job.starts[0] },
        { army: 1, startIndex: job.starts[1] },
      ],
      sides: job.sides.map((js) => ({
        army: js.army,
        source: (ctx) => {
          const f = factories.get(js.brain);
          const side = createAiSide(ctx.world, {
            army: js.army,
            profile: js.profile,
            host: job.host,
            clockKind: job.clock,
            gameSeed: job.aiSeed,
            brainSpec: js.brain,
            ...(f !== undefined ? { brainFactory: f } : {}),
          });
          sides.push(side);
          return side.source;
        },
      })),
    };
    const r = job.host === 'sync' ? runMatch(opts) : await runMatchAsync(opts);
    return gameRecord(job, r, sides);
  } catch (e) {
    return crashRecord(job, errorText(e));
  } finally {
    await closeAiSides(sides);
  }
}
