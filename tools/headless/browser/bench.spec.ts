/**
 * L6 benchmarks in the engine workers (cold + warm): tick bench on hollow-ridge and on the test
 * plane, SPK1 and SPK5.
 * Parameters come from the environment (set by scripts/bench.ts); results are aggregated there.
 */
import { expect, test } from '@playwright/test';
import { jobKey, type Job } from '../src/jobs.ts';
import { openHarness, runSeriesIn, writeRaw } from './harness.ts';

const num = (name: string, fallback: number): number => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

const JOBS: readonly Job[] = [
  { kind: 'tickBench', ticks: num('FAF_BENCH_TICKS', 1000), map: 'content/maps/hollow-ridge.rtsmap' },
  { kind: 'tickBench', ticks: num('FAF_BENCH_TICKS', 1000) },
  { kind: 'spk1', ticks: num('FAF_SPK1_TICKS', 300), rampTicks: num('FAF_SPK1_RAMP', 40) },
  { kind: 'spk5', reps: num('FAF_SPK5_REPS', 10) },
];

for (const job of JOBS) {
  test(`bench ${jobKey(job)} (cold + warm)`, async ({ page }, info) => {
    await openHarness(page);
    const series = await runSeriesIn(page, job, info.project.name);
    writeRaw(`bench-${info.project.name}-${jobKey(job)}`, series);
    expect(series.cold.kind).toBe(job.kind);
    expect(series.warm.kind).toBe(job.kind);
    if (series.warm.kind === 'spk5') {
      expect(series.warm.equality.full20MB, 'JS xxh32 == WASM xxh32 (20 MB)').toBe(true);
      expect(series.warm.equality.randomRanges.mismatches).toBe(0);
      expect(series.warm.keyframe.sim.roundtrip).toBe(true);
    }
  });
}
