/**
 * Worker side of the pool (`runPool`): a worker module imports this and calls `serveJobs(handler)`.
 * Every job message is answered with exactly one result message; handler exceptions (sync or
 * async) are reported as `{ ok: false, error }` and the worker keeps serving.
 */

import { parentPort, threadId, workerData } from 'node:worker_threads';
import { errorText, type PoolJobMessage, type PoolResultMessage } from './pool.ts';

export interface JobContext {
  /** `PoolOptions.workerData` as passed to runPool. */
  readonly workerData: unknown;
  /** Node thread id of this worker (diagnostics only; results must not depend on it). */
  readonly threadId: number;
}

export type JobHandler<J, R> = (job: J, ctx: JobContext) => R | Promise<R>;

/** Starts answering pool jobs on this worker thread. Throws when not running inside a worker. */
export function serveJobs<J, R>(handler: JobHandler<J, R>): void {
  const port = parentPort;
  if (port === null) throw new Error('serveJobs: must run inside a worker thread');
  const ctx: JobContext = { workerData: workerData as unknown, threadId };
  port.on('message', (m: unknown) => {
    const msg = m as PoolJobMessage;
    if (msg === null || typeof msg !== 'object' || msg.type !== 'job') return;
    const index = msg.index;
    const reply = (r: PoolResultMessage): void => {
      try {
        port.postMessage(r);
      } catch (e) {
        port.postMessage({ type: 'result', index, ok: false, error: `result not transferable: ${errorText(e)}` } satisfies PoolResultMessage);
      }
    };
    let out: R | Promise<R>;
    try {
      out = handler(msg.job as J, ctx);
    } catch (e) {
      reply({ type: 'result', index, ok: false, error: errorText(e) });
      return;
    }
    Promise.resolve(out).then(
      (value) => reply({ type: 'result', index, ok: true, value }),
      (e: unknown) => reply({ type: 'result', index, ok: false, error: errorText(e) }),
    );
  });
}
