// Perf harness of the HUD gallery (hud-p5-root): #/perf route alias, measurement loop, statistics.
export { PERF_STORY_ID, installPerfRoute, parsePerfParams, perfAliasHash } from './params.ts';
export type { PerfParams } from './params.ts';
export { pendingPerfResult, runHudPerf } from './harness.ts';
export type { HudPerfResult } from './harness.ts';
export { PerfHud } from './PerfHud.tsx';
export { EMPTY_SUMMARY, countHudNodes, summarize } from './stats.ts';
export type { PerfSummary } from './stats.ts';
