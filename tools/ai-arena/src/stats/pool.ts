/**
 * Worker pool for tournaments and benchmarks (Node, node:worker_threads).
 *
 * - At most 4 workers (memory rule of the repository: no swap, shared heavy-job gate).
 * - Workers run TypeScript modules: execArgv ['--import', <tsx loader>] (tsx resolved from this
 *   package, so the pool works independent of the process cwd; falls back to the bare 'tsx').
 * - The worker module calls `serveJobs(handler)` (pool-worker.ts). Jobs are handed out one at a
 *   time to the next idle worker; results come back ordered by job index, independent of which
 *   worker finished first.
 * - A handler exception or a crashed worker (uncaught error, process.exit, OOM) becomes
 *   `{ ok: false, error }` for exactly that job; a crashed worker is replaced for the remaining jobs.
 * - All workers are terminated before `runPool` resolves, also after failures.
 *
 * The pool is infrastructure, not arena logic: which worker runs which job does not influence any
 * result, because every job is self-contained (seeded).
 */

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';

/** Hard upper bound for the number of workers. */
export const MAX_POOL_WORKERS = 4;

export type JobResult<R> =
  | { readonly ok: true; readonly index: number; readonly value: R }
  | { readonly ok: false; readonly index: number; readonly error: string };

export interface PoolOptions {
  /** Number of workers, 1..4 (default: min(4, jobs.length)). */
  readonly workers?: number;
  /** Passed unchanged to every worker (`workerData`, available in the job context). */
  readonly workerData?: unknown;
  /** Override of the worker execArgv (default: tsx loader). */
  readonly execArgv?: readonly string[];
  /** Called after every finished job (progress reporting); must not throw. */
  readonly onResult?: (result: JobResult<unknown>, done: number, total: number) => void;
}

export interface PoolRun<R> {
  /** results[i] belongs to jobs[i]. */
  readonly results: JobResult<R>[];
  /** Workers created (initial ones plus replacements for crashed workers). */
  readonly workersSpawned: number;
  /** Workers whose exit was observed (equals workersSpawned when runPool resolves). */
  readonly workersExited: number;
}

/** Messages main → worker. */
export interface PoolJobMessage {
  readonly type: 'job';
  readonly index: number;
  readonly job: unknown;
}

/** Messages worker → main. */
export type PoolResultMessage =
  | { readonly type: 'result'; readonly index: number; readonly ok: true; readonly value: unknown }
  | { readonly type: 'result'; readonly index: number; readonly ok: false; readonly error: string };

/** Human-readable error text (name: message) for pool results. */
export function errorText(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  return String(e);
}

let tsxArgv: readonly string[] | null = null;

/** execArgv that lets a worker import TypeScript modules through tsx. */
export function tsxExecArgv(): readonly string[] {
  if (tsxArgv !== null) return tsxArgv;
  let spec: string;
  try {
    spec = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
  } catch {
    spec = 'tsx';
  }
  tsxArgv = ['--import', spec];
  return tsxArgv;
}

interface Slot {
  readonly worker: Worker;
  /** Job index in flight, −1 when idle. */
  current: number;
  lastError: string | null;
  exited: boolean;
  readonly exitPromise: Promise<void>;
}

/**
 * Runs `jobs` on up to 4 worker threads executing `workerModuleUrl` (a module that calls
 * `serveJobs`). Never rejects because of job failures; rejects only for invalid arguments.
 */
export async function runPool<J, R>(
  jobs: readonly J[],
  workerModuleUrl: URL | string,
  opts: PoolOptions = {},
): Promise<PoolRun<R>> {
  const total = jobs.length;
  if (total === 0) return { results: [], workersSpawned: 0, workersExited: 0 };
  const wanted = opts.workers ?? Math.min(MAX_POOL_WORKERS, total);
  if (!Number.isInteger(wanted) || wanted < 1 || wanted > MAX_POOL_WORKERS) {
    throw new RangeError(`runPool: workers must be 1..${MAX_POOL_WORKERS} (${String(opts.workers)})`);
  }
  const results: (JobResult<R> | undefined)[] = new Array<JobResult<R> | undefined>(total).fill(undefined);

  const url = typeof workerModuleUrl === 'string' ? new URL(workerModuleUrl) : workerModuleUrl;
  const execArgv = [...(opts.execArgv ?? tsxExecArgv())];
  const slots: Slot[] = [];
  let next = 0;
  let done = 0;
  let spawned = 0;
  let exitedCount = 0;

  return await new Promise<PoolRun<R>>((resolvePool) => {
    let finishing = false;

    const finish = (): void => {
      if (finishing) return;
      finishing = true;
      const live = slots.filter((s) => !s.exited);
      for (const s of live) void s.worker.terminate();
      void Promise.all(slots.map((s) => s.exitPromise)).then(() => {
        resolvePool({
          results: results.map((r, i) => r ?? { ok: false as const, index: i, error: 'job was not run' }),
          workersSpawned: spawned,
          workersExited: exitedCount,
        });
      });
    };

    const record = (r: JobResult<R>): void => {
      if (results[r.index] !== undefined) return;
      results[r.index] = r;
      done++;
      if (opts.onResult !== undefined) opts.onResult(r as JobResult<unknown>, done, total);
      if (done === total) finish();
    };

    const dispatch = (slot: Slot): void => {
      if (finishing || slot.exited) return;
      if (next >= total) {
        slot.current = -1;
        // No more work for this worker: let it go now instead of idling until the end.
        void slot.worker.terminate();
        return;
      }
      const index = next++;
      slot.current = index;
      const msg: PoolJobMessage = { type: 'job', index, job: jobs[index] };
      try {
        slot.worker.postMessage(msg);
      } catch (e) {
        slot.current = -1;
        record({ ok: false, index, error: `could not send job: ${errorText(e)}` });
        dispatch(slot);
      }
    };

    const spawn = (): void => {
      spawned++;
      const worker = new Worker(url, { execArgv, workerData: opts.workerData });
      let markExited: () => void = () => undefined;
      const exitPromise = new Promise<void>((res) => {
        markExited = res;
      });
      const slot: Slot = { worker, current: -1, lastError: null, exited: false, exitPromise };
      slots.push(slot);

      worker.on('message', (m: unknown) => {
        const msg = m as PoolResultMessage;
        if (msg === null || typeof msg !== 'object' || msg.type !== 'result') return;
        if (msg.index !== slot.current) return;
        slot.current = -1;
        if (msg.ok) record({ ok: true, index: msg.index, value: msg.value as R });
        else record({ ok: false, index: msg.index, error: msg.error });
        dispatch(slot);
      });
      worker.on('messageerror', (e: unknown) => {
        slot.lastError = `message could not be deserialized: ${errorText(e)}`;
        const index = slot.current;
        if (index >= 0) {
          slot.current = -1;
          record({ ok: false, index, error: slot.lastError });
          dispatch(slot);
        }
      });
      worker.on('error', (e: unknown) => {
        slot.lastError = errorText(e);
      });
      worker.on('exit', (code: number) => {
        slot.exited = true;
        exitedCount++;
        const index = slot.current;
        slot.current = -1;
        markExited();
        if (index >= 0) {
          record({ ok: false, index, error: `worker crashed (exit code ${code})${slot.lastError !== null ? ': ' + slot.lastError : ''}` });
          // Replace the crashed worker while jobs remain.
          if (!finishing && next < total) spawn();
        }
      });
      dispatch(slot);
    };

    const initial = wanted < total ? wanted : total;
    for (let i = 0; i < initial; i++) spawn();
  });
}
