/**
 * Worker fixture for the pool tests (tools/ai-arena/test/stats/pool.test.ts).
 * Jobs: square (returns x², threadId), throw (handler exception), reject (async rejection),
 * crash (worker thread exits hard in the middle of a job).
 */

import { serveJobs } from '../../src/stats/pool-worker.ts';

export type FixtureJob =
  | { readonly kind: 'square'; readonly x: number }
  | { readonly kind: 'throw'; readonly message: string }
  | { readonly kind: 'reject'; readonly message: string }
  | { readonly kind: 'crash'; readonly code: number };

export interface FixtureResult {
  readonly y: number;
  readonly threadId: number;
  readonly tag: unknown;
}

serveJobs<FixtureJob, FixtureResult>(async (job, ctx) => {
  switch (job.kind) {
    case 'square':
      // Yield once so several workers are busy at the same time.
      await Promise.resolve();
      return { y: job.x * job.x, threadId: ctx.threadId, tag: ctx.workerData };
    case 'throw':
      throw new Error(job.message);
    case 'reject':
      return await Promise.reject(new RangeError(job.message));
    case 'crash':
      process.exit(job.code);
  }
});
