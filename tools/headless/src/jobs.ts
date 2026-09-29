/**
 * Harness jobs: one entry point shared by the Node runner and the browser worker, so every engine
 * executes byte-identical code paths. Results are plain JSON.
 */
import { toHashChain, type HashChain } from './goldens.ts';
import { failedAsserts, runScenario, type AssertResult } from './scenario.ts';
import { scenarioByName } from './scenarios.ts';
import { runSpk1Bench, type Spk1BenchResult } from './spk1/run.ts';
import { runSpk5, type Spk5Result } from './spk5/bench.ts';
import { clockResolution, repsFor, round4, type Clock, type EngineInfo } from './stats.ts';
import { runTickBench, type TickBenchResult } from './tickbench.ts';

export type Job =
  | { readonly kind: 'hashChain'; readonly scenario: string }
  | { readonly kind: 'tickBench'; readonly ticks: number }
  | { readonly kind: 'spk1'; readonly ticks: number; readonly rampTicks: number }
  | { readonly kind: 'spk5'; readonly reps: number };

/** `measure`: the reported run; `warmup`: only warms the JIT (cheaper settings, result unused). */
export type RunMode = 'measure' | 'warmup';

export interface JobAssets {
  readonly simBin: Uint8Array;
  readonly xxh32Wasm: Uint8Array;
}

export interface JobEnv {
  readonly clock: Clock;
  readonly info: EngineInfo;
}

export interface HashChainResult {
  readonly kind: 'hashChain';
  readonly chain: HashChain;
  readonly failedAsserts: readonly AssertResult[];
  readonly ms: number;
}

export type JobResult =
  | HashChainResult
  | ({ readonly kind: 'tickBench' } & TickBenchResult)
  | ({ readonly kind: 'spk1' } & Spk1BenchResult)
  | ({ readonly kind: 'spk5' } & Spk5Result);

/** Time resolution targets for the repetition method (see measure.ts). */
export const TICKBENCH_TARGET_RES_MS = 0.05;
export const SPK1_TARGET_RES_MS = 0.25;

export async function runJob(job: Job, mode: RunMode, assets: JobAssets, env: JobEnv): Promise<JobResult> {
  const clock = env.clock;
  const res = env.info.clockResolutionMs;
  switch (job.kind) {
    case 'hashChain': {
      const t0 = clock();
      const r = runScenario(scenarioByName(job.scenario), { simBin: assets.simBin });
      return { kind: 'hashChain', chain: toHashChain(r), failedAsserts: failedAsserts(r), ms: round4(clock() - t0) };
    }
    case 'tickBench': {
      const reps = mode === 'warmup' ? 1 : repsFor(res, TICKBENCH_TARGET_RES_MS);
      const ticks = mode === 'warmup' ? Math.min(job.ticks, 500) : job.ticks;
      return { kind: 'tickBench', ...runTickBench({ simBin: assets.simBin, ticks, reps, clock }) };
    }
    case 'spk1': {
      const reps = mode === 'warmup' ? 1 : repsFor(res, SPK1_TARGET_RES_MS);
      const ticks = mode === 'warmup' ? Math.min(job.ticks, 100) : job.ticks;
      return { kind: 'spk1', ...runSpk1Bench({ ticks, rampTicks: job.rampTicks, reps, clock }) };
    }
    case 'spk5': {
      const reps = mode === 'warmup' ? 2 : job.reps;
      return { kind: 'spk5', ...(await runSpk5({ wasmBytes: assets.xxh32Wasm, simBin: assets.simBin, clock, reps, clockResolutionMs: mode === 'warmup' ? 0 : res })) };
    }
  }
}

/** Engine info of the current global scope. */
export function engineInfo(engine: string, clock: Clock): EngineInfo {
  const g = globalThis as unknown as { navigator?: { userAgent?: string }; crossOriginIsolated?: boolean; process?: { version?: string } };
  const ua = g.navigator?.userAgent ?? `node ${g.process?.version ?? '?'}`;
  return { engine, userAgent: ua, crossOriginIsolated: g.crossOriginIsolated === true, clockResolutionMs: clockResolution(clock) };
}
