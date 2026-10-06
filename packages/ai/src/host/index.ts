/**
 * @faf/ai/host — the AI host and its worker protocol (PLAN §3.10, ai.md §2.1–§2.3). Environment
 * neutral (neither DOM nor Node): `AiHost` + `SyncAiSource` run a brain synchronously (headless,
 * arena, sim-worker fallback), `runAiWorker` serves a brain on a message port (AI worker), and
 * `AsyncAiSource` is the sim-side CommandSource that answers 'pending' until the worker's result
 * has arrived. `clock.ts` is the only wall-clock access of the AI package (emergency stop).
 */
export * from './clock.ts';
export * from './ai-host.ts';
export * from './protocol.ts';
export * from './worker.ts';
export * from './async-source.ts';
