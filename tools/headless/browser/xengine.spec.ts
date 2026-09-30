/**
 * L3 cross-engine hash chains: every golden scenario in a fresh worker (JIT cold) and after
 * 3 warm-up runs in the same worker (JIT warm); every chain must equal the checked-in golden.
 * Golden replays (TRACK-REPLAY p6): every test/golden-replays/*.rtsreplay is played the same way
 * (keyframes, hash + sub-hash check, backward seek to the middle, replay to the end); trail ==
 * HASH chunk == golden trail, final hashes == golden, full hash right after the backward seek ==
 * direct run at that tick, full hash at the end after the seek == first pass.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { readRtsReplay } from '@faf/formats';
import { compareChains, parseGolden } from '../src/goldens.ts';
import { checkReplayJobResult, GOLDEN_REPLAY_PATHS, recordedTrail, scenarioOfReplayPath } from '../src/replay/xengine-job.ts';
import { SCENARIO_NAMES } from '../src/scenarios.ts';
import { GOLDENS_DIR, openHarness, REPO_DIR, runSeriesIn, writeRaw } from './harness.ts';

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

for (const path of GOLDEN_REPLAY_PATHS) {
  const scenario = scenarioOfReplayPath(path);
  test(`golden replay ${scenario} (cold + warm, backward seek) equals HASH chunk and golden`, async ({ page }, info) => {
    const golden = parseGolden(readFileSync(resolve(GOLDENS_DIR, `${scenario}.json`), 'utf8'));
    const replay = readRtsReplay(new Uint8Array(readFileSync(resolve(REPO_DIR, path))));
    const recorded = { firstTick: replay.hashes.firstTick, interval: replay.hashes.interval, trail: recordedTrail(replay) };
    await openHarness(page);
    const series = await runSeriesIn(page, { kind: 'replayVerify', replay: path }, info.project.name);
    writeRaw(`xengine-${info.project.name}-replay-${scenario}`, series);
    expect(series.engine.crossOriginIsolated, 'harness page must be cross-origin isolated').toBe(true);
    expect(series.warmupReplays.length).toBe(3);
    const runs = [['cold', series.cold], ['warm', series.warm], ...series.warmupReplays.map((r, i) => [`warm-up ${i + 1}`, r] as const)] as const;
    for (const [mode, r] of runs) {
      if (r.kind !== 'replayVerify') throw new Error(`unexpected result kind ${r.kind}`);
      const c = checkReplayJobResult(r, recorded, golden);
      expect(c.equal, `${info.project.name} ${mode}: first divergent tick ${c.firstDivergentTick ?? '–'} — ${c.problems.join('; ')}`).toBe(true);
    }
  });
}
