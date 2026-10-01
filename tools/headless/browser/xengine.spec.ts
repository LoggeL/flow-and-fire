/**
 * L3 cross-engine hash chains: both golden scenarios in a fresh worker (JIT cold) and after
 * 3 warm-up runs in the same worker (JIT warm); every chain must equal the checked-in golden.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { compareChains, parseGolden } from '../src/goldens.ts';
import { hex32 } from '../src/goldens.ts';
import { readRtsReplay } from '@faf/formats';
import { REPLAY_PATHS } from '../src/replay/assets.ts';
import { SCENARIO_NAMES } from '../src/scenarios.ts';
import { GOLDENS_DIR, REPO_DIR, openHarness, runSeriesIn, writeRaw } from './harness.ts';

for (const scenario of SCENARIO_NAMES) {
  test(`hash chain ${scenario} (cold + warm) equals golden`, async ({ page }, info) => {
    const golden = parseGolden(readFileSync(resolve(GOLDENS_DIR, `${scenario}.json`), 'utf8'));
    await openHarness(page);
    const series = await runSeriesIn(page, { kind: 'hashChain', scenario }, info.project.name);
    writeRaw(`xengine-${info.project.name}-${scenario}`, series);
    expect(series.engine.crossOriginIsolated, 'harness page must be cross-origin isolated').toBe(true);
    const runs = [
      ['cold', series.cold],
      ['warm', series.warm],
    ] as const;
    for (const [mode, r] of runs) {
      if (r.kind !== 'hashChain') throw new Error(`unexpected result kind ${r.kind}`);
      expect(r.failedAsserts, `${mode}: scenario asserts`).toEqual([]);
      const d = compareChains(golden, r.chain);
      expect(d.equal, `${info.project.name} ${mode}: first divergent tick ${d.firstDivergentTick} — ${d.detail}`).toBe(true);
    }
    expect(series.warmupChains.length).toBe(3);
    for (const [k, chain] of series.warmupChains.entries()) {
      const d = compareChains(golden, chain);
      expect(d.equal, `${info.project.name} warm-up ${k + 1}: first divergent tick ${d.firstDivergentTick} — ${d.detail}`).toBe(true);
    }
  });
}

for (const replay of REPLAY_PATHS) {
  const scenario = replay.slice(replay.lastIndexOf('/') + 1).replace(/\.rtsreplay$/, '');
  test(`replay ${scenario} (cold + warm + seek) equals golden`, async ({ page }, info) => {
    const golden = parseGolden(readFileSync(resolve(GOLDENS_DIR, `${scenario}.json`), 'utf8'));
    const recorded = readRtsReplay(new Uint8Array(readFileSync(resolve(REPO_DIR, replay))));
    await openHarness(page);
    const series = await runSeriesIn(page, { kind: 'replayVerify', replay }, info.project.name);
    writeRaw(`xengine-${info.project.name}-replay-${scenario}`, series);
    expect(series.engine.crossOriginIsolated).toBe(true);
    expect(series.warmupResults.length).toBe(3);
    for (const r of [series.cold, ...series.warmupResults, series.warm]) {
      if (r.kind !== 'replayVerify') throw new Error(`unexpected result kind ${r.kind}`);
      expect(r.divergences).toEqual([]);
      expect(r.trail).toEqual(Array.from(recorded.hashes.hashes, hex32));
      const d = compareChains(golden, { ...r, scenario });
      expect(d.equal, d.detail).toBe(true);
      expect(r.compared).toBe(golden.trail.length);
      expect(r.seekFullHash).toBe(r.finalFullHash);
    }
  });
}
