import { describe, expect, it } from 'vitest';
import { MAX_POOL_WORKERS, runPool, type JobResult } from '../../src/stats/index.ts';
import type { FixtureJob, FixtureResult } from '../fixtures/pool-worker.ts';

const WORKER = new URL('../fixtures/pool-worker.ts', import.meta.url);

describe('runPool', () => {
  it('4 workers, 20 jobs: ordered results, crash and exceptions reported per job, all workers ended', async () => {
    const jobs: FixtureJob[] = [];
    for (let i = 0; i < 20; i++) {
      if (i === 7) jobs.push({ kind: 'crash', code: 3 });
      else if (i === 13) jobs.push({ kind: 'throw', message: 'boom 13' });
      else if (i === 17) jobs.push({ kind: 'reject', message: 'nope 17' });
      else jobs.push({ kind: 'square', x: i });
    }
    const progress: number[] = [];
    const run = await runPool<FixtureJob, FixtureResult>(jobs, WORKER, {
      workers: 4,
      workerData: 'tag-1',
      onResult: (_r, done) => progress.push(done),
    });
    expect(run.results.length).toBe(20);
    run.results.forEach((r, i) => expect(r.index).toBe(i));

    const crash = run.results[7] as JobResult<FixtureResult>;
    expect(crash.ok).toBe(false);
    if (!crash.ok) expect(crash.error).toMatch(/worker crashed \(exit code 3\)/);
    const thrown = run.results[13] as JobResult<FixtureResult>;
    expect(thrown).toEqual({ ok: false, index: 13, error: 'Error: boom 13' });
    const rejected = run.results[17] as JobResult<FixtureResult>;
    expect(rejected).toEqual({ ok: false, index: 17, error: 'RangeError: nope 17' });

    const threads = new Set<number>();
    run.results.forEach((r, i) => {
      if (i === 7 || i === 13 || i === 17) return;
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value.y).toBe(i * i);
        expect(r.value.tag).toBe('tag-1');
        threads.add(r.value.threadId);
      }
    });
    // The first four jobs start on four different workers.
    expect(threads.size).toBeGreaterThanOrEqual(4);
    // The crashed worker is replaced only if jobs were still unassigned when it exited (timing):
    // 4 or 5 workers; every worker has exited when runPool resolves.
    expect(run.workersSpawned).toBeGreaterThanOrEqual(4);
    expect(run.workersSpawned).toBeLessThanOrEqual(5);
    expect(run.workersExited).toBe(run.workersSpawned);
    expect(progress).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('replaces a crashed worker while jobs remain', async () => {
    const jobs: FixtureJob[] = [
      { kind: 'crash', code: 9 },
      { kind: 'square', x: 5 },
      { kind: 'crash', code: 1 },
      { kind: 'square', x: 6 },
    ];
    const run = await runPool<FixtureJob, FixtureResult>(jobs, WORKER, { workers: 1 });
    expect(run.results.map((r) => r.ok)).toEqual([false, true, false, true]);
    expect(run.results[1]).toMatchObject({ value: { y: 25 } });
    expect(run.results[3]).toMatchObject({ value: { y: 36 } });
    expect(run.workersSpawned).toBe(3);
    expect(run.workersExited).toBe(3);
  });

  it('a worker module that fails to load turns every job into an error and still ends all workers', async () => {
    const bad = new URL('../fixtures/does-not-exist.ts', import.meta.url);
    const run = await runPool<number, number>([1, 2, 3], bad, { workers: 2 });
    expect(run.results.map((r) => r.ok)).toEqual([false, false, false]);
    expect(run.results.map((r) => r.index)).toEqual([0, 1, 2]);
    expect(run.workersExited).toBe(run.workersSpawned);
    expect(run.workersSpawned).toBe(3);
  });

  it('handles empty job lists and enforces the worker limit', async () => {
    expect(await runPool([], WORKER, { workers: 4 })).toEqual({ results: [], workersSpawned: 0, workersExited: 0 });
    await expect(runPool([1], WORKER, { workers: MAX_POOL_WORKERS + 1 })).rejects.toThrow(RangeError);
    await expect(runPool([1], WORKER, { workers: 0 })).rejects.toThrow(RangeError);
  });

  it('uses at most as many workers as jobs', async () => {
    const run = await runPool<FixtureJob, FixtureResult>([{ kind: 'square', x: 3 }], WORKER);
    expect(run.workersSpawned).toBe(1);
    expect(run.results[0]).toMatchObject({ ok: true, index: 0, value: { y: 9 } });
  });
});
