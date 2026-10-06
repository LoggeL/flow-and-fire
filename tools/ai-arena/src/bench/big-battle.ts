/**
 * (b) Big Battle, AI-BUD-01 analogue (ai.md §9): 2 × `perSide` combat units (cheat spawn, default
 * 300: 150 tanks, 100 bots, 50 artillery per side) facing each other in the middle of Setons, both
 * armies run by the Hard AI (synchronous hosts, headless emergency limit 200 ms). Gates: ops-p99 per
 * think ≤ budget, 0 aborted thinks. Arena tick p95 with AI (world.step only, the AI thinks in the
 * same thread between the steps) against the replay of the same trajectory without AI.
 */
import { PROFILES, type Difficulty } from '@faf/ai';
import { summarize, type Summary } from '../stats/summary.ts';
import { closeAiSides } from '../host-node/sides.ts';
import { aiSides, logOf, runSyncLoop, setonsDuel, startDistance, startFrame, timedReplay } from './common.ts';

export const BIG_BATTLE_MIX: readonly (readonly [string, number])[] = [
  ['core:lnd_t1_tank', 0.5],
  ['core:lnd_t1_bot', 1 / 3],
  ['core:lnd_t1_arty', 1 / 6],
];

export interface BigBattleResult {
  readonly profile: Difficulty;
  readonly perSide: number;
  readonly ticks: number;
  readonly thinks: number;
  readonly ops: Summary;
  readonly budget: number;
  readonly aborted: number;
  readonly thinkMs: Summary;
  readonly stepMsWithAi: Summary;
  readonly stepMsNoAi: Summary;
  /** (p95 with AI − p95 without) / p95 without, in %. */
  readonly stepP95DeltaPct: number;
  readonly unitsLost: readonly number[];
  readonly commands: number;
  readonly replayHashEqual: boolean;
}

export interface BigBattleOptions {
  readonly perSide?: number;
  readonly ticks?: number;
  readonly profile?: Difficulty;
  readonly seed?: number;
  readonly brainSpec?: string;
}

/** Counts per blueprint for `n` units (largest remainder, deterministic). */
export function mixCounts(n: number): [string, number][] {
  const out: [string, number][] = BIG_BATTLE_MIX.map(([id, share]) => [id, Math.floor(n * share)]);
  let rest = n;
  for (const [, c] of out) rest -= c;
  for (let i = 0; rest > 0; i = (i + 1) % out.length, rest--) out[i]![1]++;
  return out;
}

export async function benchBigBattle(o: BigBattleOptions = {}): Promise<BigBattleResult> {
  const perSide = o.perSide ?? 300;
  const ticks = o.ticks ?? 1200;
  const profile = o.profile ?? 'hard';
  const world = setonsDuel(o.seed ?? 1);
  const half = startDistance(world, 0, 1) / 2;
  for (const army of [0, 1]) {
    const at = startFrame(world, army, 1 - army);
    let k = 0;
    for (const [id, n] of mixCounts(perSide)) {
      for (let i = 0; i < n; i++, k++) {
        const p = at(half - 30 - 2 * Math.floor(k / 20), -19 + 2 * (k % 20));
        world.spawn(army, id, p.x, p.z);
      }
    }
  }
  const sides = await aiSides(world, profile, 'sync', o.brainSpec);
  try {
    const run = runSyncLoop(world, sides, ticks);
    const hash = world.hash();
    const replay = timedReplay(logOf(world));
    const ops: number[] = [];
    const ms: number[] = [];
    let aborted = 0;
    for (const s of sides) {
      for (const v of s.stats.ops) ops.push(v);
      for (const v of s.stats.ms) ms.push(v);
      aborted += s.stats.aborted;
    }
    const withAi = summarize(run.stepMs);
    const noAi = summarize(replay.stepMs);
    return {
      profile,
      perSide,
      ticks: run.ticks,
      thinks: ops.length,
      ops: summarize(ops),
      budget: PROFILES[profile].budget.total,
      aborted,
      thinkMs: summarize(ms),
      stepMsWithAi: withAi,
      stepMsNoAi: noAi,
      stepP95DeltaPct: noAi.p95 > 0 ? (100 * (withAi.p95 - noAi.p95)) / noAi.p95 : 0,
      unitsLost: [world.counters[0]!.unitsLost, world.counters[1]!.unitsLost],
      commands: world.commandLog.length,
      replayHashEqual: replay.hash === hash,
    };
  } finally {
    await closeAiSides(sides);
  }
}
