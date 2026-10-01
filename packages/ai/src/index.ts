/**
 * @faf/ai — skirmish AI of Flow & Fire (PLAN §3.10, docs/design/ai.md).
 *
 * Contracts (types.ts), data adapters (roster, passability, AiStatic), openings, map analysis,
 * threat estimate, op budget, RNG, profiles, perception snapshots, commands (payloads + emitter),
 * blackboard/task board, brain skeleton and CommandSource adapters. Managers live in
 * `managers/` (TRACK-AI wave 1); the worker host in `host/` (wave 2, export './host').
 */
export * from './types.ts';
export * from './det.ts';
export * from './rng.ts';
export * from './budget.ts';
export * from './profile.ts';
export * from './openings.ts';
export * from './threat.ts';
export * from './taskboard.ts';
export * from './blackboard.ts';
export * from './brain.ts';
export * from './source.ts';
export * from './data/index.ts';
export * from './analysis/index.ts';
export * from './perception/index.ts';
export * from './commands/index.ts';
export * from './default-brain.ts';
export * from './managers/index.ts';
