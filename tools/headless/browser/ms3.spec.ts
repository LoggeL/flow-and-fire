/**
 * MS3 scenario 5 in the engine workers (cold + warm): 1,000 moving tanks with HPA* pathing on
 * hollow-ridge (job `ms3Load`). Parameters come from the environment (set by scripts/ms3.ts), the
 * raw series lands in results/ms3-<engine>-ms3Load.tmp.json; the script aggregates and gates.
 */
import { expect, test } from '@playwright/test';
import type { Job } from '../src/jobs.ts';
import { openHarness, runSeriesIn, writeRaw } from './harness.ts';

const num = (name: string, fallback: number): number => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

const JOB: Job = {
  kind: 'ms3Load',
  ticks: num('FAF_MS3_TICKS', 1000),
  rampTicks: num('FAF_MS3_RAMP', 200),
  map: 'content/maps/hollow-ridge.rtsmap',
};

test('ms3 load: 1,000 moving tanks with pathing (cold + warm)', async ({ page }, info) => {
  await openHarness(page);
  const series = await runSeriesIn(page, JOB, info.project.name);
  writeRaw(`ms3-${info.project.name}-ms3Load`, series);
  expect(series.cold.kind).toBe('ms3Load');
  expect(series.warm.kind).toBe('ms3Load');
});
