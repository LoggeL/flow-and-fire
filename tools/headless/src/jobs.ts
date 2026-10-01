/**
 * Harness jobs: one entry point shared by the Node runner and the browser worker, so every engine
 * executes byte-identical code paths. Results are plain JSON.
 */
import { requestBurst, type RequestBurstResult } from './ms3/request-burst.ts';
import { runReplayVerifyJob, type ReplayVerifyJobResult } from './replay/xengine-job.ts';
import { toHashChain, type HashChain } from './goldens.ts';
import { failedAsserts, runScenario, type AssertResult } from './scenario.ts';
import { scenarioByName } from './scenarios.ts';
import { runSpk1Bench, type Spk1BenchResult } from './spk1/run.ts';
import { runSpk5, type Spk5Result } from './spk5/bench.ts';
import { clockResolution, repsFor, round4, type Clock, type EngineInfo } from './stats.ts';
import { runTickBench, type TickBenchResult } from './tickbench.ts';

export type Job =
  | { readonly kind: 'hashChain'; readonly scenario: string }
  /** `map`: repo-relative .rtsmap path (JobAssets.maps); missing = MS1 test plane. */
  | { readonly kind: 'tickBench'; readonly ticks: number; readonly map?: string }
  | { readonly kind: 'spk1'; readonly ticks: number; readonly rampTicks: number }
  | { readonly kind: 'spk5'; readonly reps: number }
  | { readonly kind: 'replayVerify'; readonly replay: string }
  | { readonly kind: 'requestBurst'; readonly size: 512 | 1024 };

/** `measure`: the reported run; `warmup`: only warms the JIT (cheaper settings, result unused). */
export type RunMode = 'measure' | 'warmup';

export interface JobAssets {
  readonly simBin: Uint8Array;
  readonly replays: Readonly<Record<string, Uint8Array>>;
  readonly xxh32Wasm: Uint8Array;
  /** Scenario/bench maps by repo-relative path (.rtsmap bytes). */
  readonly maps: Readonly<Record<string, Uint8Array>>;
}

/** Unique key of a job for result files and tables (`tickBench-hollow-ridge` for a map bench). */
export function jobKey(job: Job): string {
  if (job.kind === 'tickBench' && job.map !== undefined) {
    const base = job.map.slice(job.map.lastIndexOf('/') + 1).replace(/\.rtsmap$/, '');
    return `tickBench-${base}`;
  }
  if (job.kind === 'replayVerify') return `replayVerify-${job.replay.slice(job.replay.lastIndexOf('/') + 1).replace(/\.rtsreplay$/, '')}`;
  if (job.kind === 'requestBurst') return `requestBurst-${job.size}`;
  return job.kind;
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
  | ({ readonly kind: 'spk5' } & Spk5Result)
  | ({ readonly kind: 'replayVerify' } & ReplayVerifyJobResult)
  | ({ readonly kind: 'requestBurst' } & RequestBurstResult);

/** Time resolution targets for the repetition method (see measure.ts). */
export const TICKBENCH_TARGET_RES_MS = 0.05;
export const SPK1_TARGET_RES_MS = 0.25;

export async function runJob(job: Job, mode: RunMode, assets: JobAssets, env: JobEnv): Promise<JobResult> {
  const clock = env.clock;
  const res = env.info.clockResolutionMs;
  switch (job.kind) {
    case 'replayVerify': {
      const bytes = assets.replays[job.replay];
      if (bytes === undefined) throw new Error(`replay '${job.replay}' not provided`);
      return { kind: 'replayVerify', ...runReplayVerifyJob(bytes, assets, clock) };
    }
    case 'requestBurst': return { kind: 'requestBurst', ...requestBurst(job.size, assets.simBin, clock) };
    case 'hashChain': {
      const t0 = clock();
      const r = runScenario(scenarioByName(job.scenario), { simBin: assets.simBin, maps: assets.maps });
      return { kind: 'hashChain', chain: toHashChain(r), failedAsserts: failedAsserts(r), ms: round4(clock() - t0) };
    }
    case 'tickBench': {
      const reps = mode === 'warmup' ? 1 : repsFor(res, TICKBENCH_TARGET_RES_MS);
      const ticks = mode === 'warmup' ? Math.min(job.ticks, 500) : job.ticks;
      let map: Uint8Array | undefined;
      if (job.map !== undefined) {
        map = assets.maps[job.map];
        if (map === undefined) throw new Error(`tickBench map '${job.map}' not provided`);
      }
      return { kind: 'tickBench', ...runTickBench({ simBin: assets.simBin, ticks, reps, clock, ...(map !== undefined ? { map } : {}) }) };
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
