/**
 * (a) Think time per difficulty (ai.md §2.3 "Normal-Think p95 ≤ 8 ms auf dem Referenz-Laptop"):
 * AI against AI of the same profile, synchronous hosts, Setons 1v1 over `ticks` (default 15 min).
 * Reports wall ms per think (p50/p95/p99/max, both sides pooled), ops per think and per manager
 * against the budget, aborted thinks, and (d) the arena throughput with and without AI (the same
 * trajectory replayed from the command log).
 */
import { PROFILES, type Difficulty } from '@faf/ai';
import { managerBudget } from '../tournament/run-game.ts';
import { summarize, type Summary } from '../stats/summary.ts';
import { closeAiSides } from '../host-node/sides.ts';
import { aiSides, logOf, runSyncLoop, setonsDuel, timedReplay } from './common.ts';

export interface ManagerOpsRow {
  readonly name: string;
  readonly p99: number;
  readonly max: number;
  readonly budget: number;
}

export interface ThinkTimeResult {
  readonly profile: Difficulty;
  readonly map: string;
  readonly seed: number;
  readonly ticks: number;
  readonly thinks: number;
  readonly thinkMs: Summary;
  readonly ops: Summary;
  readonly budget: number;
  readonly managers: readonly ManagerOpsRow[];
  readonly aborted: number;
  /** Ticks per second of the loop with AI (thinks + perception + steps). */
  readonly ticksPerSecWithAi: number;
  /** Ticks per second of the replay (arena only). */
  readonly ticksPerSecArena: number;
  readonly stepMsWithAi: Summary;
  readonly stepMsArena: Summary;
  readonly replayHashEqual: boolean;
  readonly openings: readonly (string | null)[];
}

export interface ThinkTimeOptions {
  readonly ticks?: number;
  readonly seed?: number;
  readonly map?: string;
  readonly brainSpec?: string;
}

export async function benchThinkTime(profile: Difficulty, o: ThinkTimeOptions = {}): Promise<ThinkTimeResult> {
  const ticks = o.ticks ?? 9000;
  const seed = o.seed ?? 7;
  const map = o.map ?? 'setons';
  const world = setonsDuel(seed, map);
  const sides = await aiSides(world, profile, 'sync', o.brainSpec);
  try {
    const run = runSyncLoop(world, sides, ticks);
    const hash = world.hash();
    const replay = timedReplay(logOf(world));
    const ms: number[] = [];
    const ops: number[] = [];
    const byManager = new Map<string, number[]>();
    let aborted = 0;
    for (const s of sides) {
      for (const v of s.stats.ms) ms.push(v);
      for (const v of s.stats.ops) ops.push(v);
      aborted += s.stats.aborted;
      for (const [name, values] of s.stats.opsByManager) {
        let arr = byManager.get(name);
        if (arr === undefined) {
          arr = [];
          byManager.set(name, arr);
        }
        for (const v of values) arr.push(v);
      }
    }
    const profileObj = sides[0]!.profile;
    return {
      profile,
      map,
      seed,
      ticks: run.ticks,
      thinks: ms.length,
      thinkMs: summarize(ms),
      ops: summarize(ops),
      budget: PROFILES[profile].budget.total,
      managers: [...byManager.entries()].map(([name, values]) => {
        const s = summarize(values);
        return { name, p99: s.p99, max: s.max, budget: managerBudget(profileObj, name) };
      }),
      aborted,
      ticksPerSecWithAi: (1000 * run.ticks) / run.totalMs,
      ticksPerSecArena: (1000 * replay.stepMs.length) / replay.totalMs,
      stepMsWithAi: summarize(run.stepMs),
      stepMsArena: summarize(replay.stepMs),
      replayHashEqual: replay.hash === hash,
      openings: sides.map((s) => s.openingId()),
    };
  } finally {
    await closeAiSides(sides);
  }
}
