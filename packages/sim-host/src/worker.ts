/**
 * Sim worker entry (package export `@faf/sim-host/worker`, PLAN §3.6). Load as a module worker:
 *
 * ```ts
 * const worker = new Worker(new URL('@faf/sim-host/worker', import.meta.url), { type: 'module' });
 * worker.postMessage(init, [init.simBin]); // InitMessage (frameSab only for transport 'sab')
 * ```
 *
 * Messages from the main thread: `init` (once), `cmd` (batch transferred), `ctl`. Replies:
 * `ready`, `status`, `stats`, `log`, `error`. Frames go through the FrameTransport (SAB triple
 * buffer, or transfer ping-pong on the worker port itself). Every failure becomes an `error`
 * message; the worker never throws into the void.
 */

import { startSimWorker, type WorkerScopeLike } from './worker-host.ts';

// Keep the dedicated entry's existing helper API available to explicit consumers.
export { startSimWorker, type StartSimWorkerOptions, type WorkerScopeLike } from './worker-host.ts';

/** True when this module runs as the top level of a dedicated worker. */
function isDedicatedWorker(): boolean {
  const g = globalThis as { WorkerGlobalScope?: unknown; DedicatedWorkerGlobalScope?: unknown };
  return typeof g.DedicatedWorkerGlobalScope === 'function' && typeof g.WorkerGlobalScope === 'function';
}

if (isDedicatedWorker()) startSimWorker(globalThis as unknown as WorkerScopeLike);
