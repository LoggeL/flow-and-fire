/** MS3's exact burst workload in fresh browser workers, with cold/warm results. */
import { expect, test } from '@playwright/test';
import { requestBurstProblems } from '../src/ms3/request-burst.ts';
import { openHarness, runSeriesIn, writeRaw } from './harness.ts';

for (const size of [512, 1024] as const) {
  test(`request burst ${size} (cold + warm)`, async ({ page }, info) => {
    await openHarness(page);
    const series = await runSeriesIn(page, { kind: 'requestBurst', size }, info.project.name);
    writeRaw(`burst-${info.project.name}-${size}`, series);
    expect(series.engine.crossOriginIsolated).toBe(true);
    expect(series.warmupResults.length).toBe(3);
    for (const r of [series.cold, ...series.warmupResults, series.warm]) {
      if (r.kind !== 'requestBurst') throw new Error(`unexpected result kind ${r.kind}`);
      expect(requestBurstProblems(r, (r === series.cold || r === series.warm) && process.env['FAF_PERF_GATE'] === '1')).toEqual([]);
    }
  });
}
