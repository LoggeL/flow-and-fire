/**
 * Cold/warm series protocol (L3): cold = first run in a fresh worker/process, warm = the run after
 * WARMUP_RUNS warm-up runs in the same worker/process. Type-only imports keep this module tiny
 * (it is bundled into the harness page).
 */
import type { HashChain } from './goldens.ts';
import type { Job, JobResult, RunMode } from './jobs.ts';
import type { EngineInfo } from './stats.ts';

export const WARMUP_RUNS = 3;

export interface SeriesResult {
  readonly engine: EngineInfo;
  readonly job: Job;
  readonly cold: JobResult;
  readonly warm: JobResult;
  /** Hash chains of the warm-up runs (hashChain jobs only; must equal cold/warm). */
  readonly warmupChains: readonly HashChain[];
  readonly warmupResults: readonly JobResult[];
}

/** Runs a series through `exec` (one call = one run in the same engine context). */
export async function runSeries(job: Job, info: EngineInfo, exec: (job: Job, mode: RunMode) => Promise<JobResult>): Promise<SeriesResult> {
  const cold = await exec(job, 'measure');
  const warmupChains: HashChain[] = [];
  const warmupResults: JobResult[] = [];
  for (let i = 0; i < WARMUP_RUNS; i++) {
    const r = await exec(job, 'warmup');
    if (r.kind === 'hashChain') warmupChains.push(r.chain);
    if (r.kind === 'replayVerify' || r.kind === 'requestBurst') warmupResults.push(r);
  }
  const warm = await exec(job, 'measure');
  return { engine: info, job, cold, warm, warmupChains, warmupResults };
}

/** Messages between harness page and worker. */
export type WorkerRequest =
  | { readonly id: number; readonly t: 'init'; readonly engine: string }
  | { readonly id: number; readonly t: 'run'; readonly job: Job; readonly mode: RunMode };

export type WorkerResponse =
  | { readonly id: number; readonly ok: true; readonly info?: EngineInfo; readonly result?: JobResult }
  | { readonly id: number; readonly ok: false; readonly error: string };
