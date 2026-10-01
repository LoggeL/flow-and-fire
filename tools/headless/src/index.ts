/**
 * @faf/headless — headless runner, L2 scenarios/goldens, cross-engine harness jobs and the
 * SPK1/SPK5 spikes (PLAN §3.12, §4). Node-only helpers live in scripts/.
 */
export * from './scenario.ts';
export * from './scenarios.ts';
export * from './maps.ts';
export * from './goldens.ts';
export * from './stats.ts';
export * from './measure.ts';
export * from './tickbench.ts';
export * from './jobs.ts';
export * from './series.ts';
export { createSpk1, runSpk1Bench, runSpk1Chain, SPK1_DEFAULT_SEED, type Spk1BenchResult, type Spk1ChainResult } from './spk1/run.ts';
export { SPK1_PHASE_NAMES, Spk1Phase, spk1Step, type Spk1Counts } from './spk1/systems.ts';
export { crossCheckXxh32, loadWasmXxh32, runSpk5, SPK5_ARENA_BYTES, type Spk5Result, type WasmXxh32 } from './spk5/bench.ts';

export { requestBurst, requestBurstProblems, type RequestBurstResult } from './ms3/request-burst.ts';
export { runReplayVerifyJob, type ReplayVerifyJobResult } from './replay/xengine-job.ts';
