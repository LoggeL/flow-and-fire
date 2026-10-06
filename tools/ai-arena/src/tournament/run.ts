/**
 * Tournament runner: executes the jobs of a plan on the worker pool (`runPool`, ≤ 4 threads) or
 * in-process (workers = 0, sequential; debugging) and returns the records in game order. A failed
 * pool job (worker thread crashed, result not transferable) becomes a crash record of that game, so
 * the tournament always yields one record per job.
 *
 * Thread budget: with host 'worker' every game spawns two AI worker threads in addition to its pool
 * thread, therefore the pool is limited to `MAX_WORKER_HOST_POOL` (2 games ⇒ 6 threads) there.
 */
import { MAX_POOL_WORKERS, runPool } from '../stats/pool.ts';
import { crashRecord, runGameJob } from './run-game.ts';
import type { GameRecord, MatchJob } from './types.ts';

/** Module of the pool workers. */
export const TOURNAMENT_WORKER = new URL('./worker.ts', import.meta.url);

/** Default pool size (PLAN memory rule: at most 4 worker threads). */
export const DEFAULT_TOURNAMENT_WORKERS = 4;

/** Pool limit when the games themselves run their brains in worker threads. */
export const MAX_WORKER_HOST_POOL = 2;

export interface RunTournamentOptions {
  /** 0 = in-process (sequential); 1..4 pool threads (default 4, host 'worker': at most 2). */
  readonly workers?: number;
  /** Progress callback after every game (done = finished games so far). */
  readonly onGame?: (record: GameRecord, done: number, total: number) => void;
  /** Worker execArgv override (tests). */
  readonly execArgv?: readonly string[];
}

/** Effective pool size for a plan. */
export function effectiveWorkers(jobs: readonly MatchJob[], requested: number = DEFAULT_TOURNAMENT_WORKERS): number {
  if (!Number.isInteger(requested) || requested < 0 || requested > MAX_POOL_WORKERS) {
    throw new RangeError(`workers must be 0..${MAX_POOL_WORKERS} (${requested})`);
  }
  if (requested === 0 || jobs.length === 0) return 0;
  const workerHost = jobs.some((j) => j.host === 'worker');
  const cap = workerHost ? MAX_WORKER_HOST_POOL : MAX_POOL_WORKERS;
  return Math.min(requested, cap, jobs.length);
}

/** Runs all jobs; resolves with one record per job, ordered by `game`. */
export async function runTournament(jobs: readonly MatchJob[], o: RunTournamentOptions = {}): Promise<GameRecord[]> {
  const workers = effectiveWorkers(jobs, o.workers ?? DEFAULT_TOURNAMENT_WORKERS);
  const total = jobs.length;
  if (workers === 0) {
    const out: GameRecord[] = [];
    for (const job of jobs) {
      const r = await runGameJob(job);
      out.push(r);
      o.onGame?.(r, out.length, total);
    }
    return out;
  }
  const run = await runPool<MatchJob, GameRecord>(jobs, TOURNAMENT_WORKER, {
    workers,
    ...(o.execArgv !== undefined ? { execArgv: o.execArgv } : {}),
    onResult: (res, done) => {
      const rec = res.ok ? (res.value as GameRecord) : crashRecord(jobs[res.index]!, res.error);
      o.onGame?.(rec, done, total);
    },
  });
  return run.results.map((res) => (res.ok ? res.value : crashRecord(jobs[res.index]!, res.error)));
}
