/**
 * @faf/ai-arena — headless test sim of TRACK-AI: map/roster loaders and model assumptions (data/),
 * flow economy (eco/), arena world with building, factories, upgrades, paths, abstract combat and
 * vision (world/), perception writer and AiStatic (perception/), match loop with metrics and replay
 * (match/), tournament statistics and worker pool (stats/), AI hosts in Node worker threads
 * (host-node/), tournament runner with gates and reports (tournament/), benchmarks (bench/) and the
 * scenario DSL of the ai.md §9 behaviour tests (scenarios/; the smoke script is not exported).
 */
/** Schema tag of arena reports and match records; later packages extend this module. */
export const ARENA_SCHEMA = 'faf-ai-arena/1';

export * from './data/index.ts';
export * from './eco/index.ts';
export * from './stats/index.ts';
export * from './world/index.ts';
export * from './perception/index.ts';
export * from './match/index.ts';
export * from './host-node/index.ts';
export * from './tournament/index.ts';
export * from './bench/index.ts';
export * from './scenarios/index.ts';
