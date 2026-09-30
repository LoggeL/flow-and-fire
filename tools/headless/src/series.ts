/**
 * Cold/warm series protocol (L3): cold = first run in a fresh worker/process, warm = the run after
 * WARMUP_RUNS warm-up runs in the same worker/process. Type-only imports keep this module tiny
 * (it is bundled into the harness page).
 */
import type { HashChain } from './goldens.ts';
import type { Job, JobResult, ReplayVerifyResultOfJob, RunMode } from './jobs.ts';
import type { EngineInfo } from './stats.ts';

export const WARMUP_RUNS = 3;

export interface SeriesResult {
  readonly engine: EngineInfo;
  readonly job: Job;
  readonly cold: JobResult;
  readonly warm: JobResult;
  /** Hash chains of the warm-up runs (hashChain jobs only; must equal cold/warm). */
  readonly warmupChains: readonly HashChain[];
  /** Results of the warm-up runs (replayVerify jobs only; must equal cold/warm). */
  readonly warmupReplays: readonly ReplayVerifyResultOfJob[];
}

/** Runs a series through `exec` (one call = one run in the same engine context). */
export async function runSeries(job: Job, info: EngineInfo, exec: (job: Job, mode: RunMode) => Promise<JobResult>): Promise<SeriesResult> {
  const cold = await exec(job, 'measure');
  const warmupChains: HashChain[] = [];
  const warmupReplays: ReplayVerifyResultOfJob[] = [];
  for (let i = 0; i < WARMUP_RUNS; i++) {
    const r = await exec(job, 'warmup');
    if (r.kind === 'hashChain') warmupChains.push(r.chain);
    else if (r.kind === 'replayVerify') warmupReplays.push(r);
  }
  const warm = await exec(job, 'measure');
  return { engine: info, job, cold, warm, warmupChains, warmupReplays };
}

/** Messages between harness page and worker. */
export type WorkerRequest =
  | { readonly id: number; readonly t: 'init'; readonly engine: string }
  | { readonly id: number; readonly t: 'run'; readonly job: Job; readonly mode: RunMode };

export type WorkerResponse =
  | { readonly id: number; readonly ok: true; readonly info?: EngineInfo; readonly result?: JobResult }
  | { readonly id: number; readonly ok: false; readonly error: string };
