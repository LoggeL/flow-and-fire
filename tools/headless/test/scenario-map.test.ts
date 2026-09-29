/**
 * ScenarioBuilder maps (MS2): test plane / .rtsmap path / in-memory RtsMap, invariants, map
 * identity in results, tick bench on hollow-ridge.
 */
import { describe, expect, it } from 'vitest';
import { FX_ONE } from '@faf/fixed';
import { createRtsMap, createTestPlaneMap, mapSimHash, readRtsMap } from '@faf/formats';
import { failedAsserts, mapLabel, runScenario, ScenarioBuilder } from '../src/scenario.ts';
import { HOLLOW_RIDGE_PATH, ridgeWaterBlock } from '../src/scenarios.ts';
import { runTickBench } from '../src/tickbench.ts';
import { jobKey } from '../src/jobs.ts';
import { loadMaps, loadSimBin, MAP_PATHS } from '../scripts/lib.ts';

const simBin = loadSimBin();
const maps = loadMaps();

describe('scenario maps', () => {
  it('a file map must be provided; its identity is part of the result', () => {
    expect(MAP_PATHS).toContain(HOLLOW_RIDGE_PATH);
    const sc = new ScenarioBuilder('file-map').map({ path: HOLLOW_RIDGE_PATH }).ticks(20).spawn({ army: 0, count: 10, x: 100, z: 100, spread: 3 }).build();
    expect(mapLabel(sc.map)).toBe(HOLLOW_RIDGE_PATH);
    expect(() => runScenario(sc, { simBin })).toThrow(/not provided/);
    const r = runScenario(sc, { simBin, maps });
    expect(r.map).toBe(HOLLOW_RIDGE_PATH);
    expect(r.mapSimHash).toBe(0x90ec94f0);
    expect(r.finalUnitCount).toBe(10);
    // Parsed maps work as well as bytes.
    const parsed = runScenario(sc, { simBin, maps: { [HOLLOW_RIDGE_PATH]: readRtsMap(maps[HOLLOW_RIDGE_PATH]!) } });
    expect(parsed.trail).toEqual(r.trail);
    expect(() => new ScenarioBuilder('x').map({ path: '../secret.rtsmap' })).toThrow(RangeError);
  });

  it('inline maps and the test plane report their mapSimHash; invariants report the first failure once', () => {
    const map = createRtsMap({ sizeWu: 64, name: 'tiny', waterLevelRaw: 4 * FX_ONE, heights: (x) => (x < 20 ? 1280 : 0) });
    const sc = new ScenarioBuilder('inline-map')
      .map({ rtsMap: map })
      .ticks(30)
      .spawn({ army: 0, count: 5, x: 10, z: 10, spread: 2 })
      .spawn({ army: 1, count: 5, x: 40, z: 40, spread: 2 }) // 4 WU deep: all rejected
      .invariant(5, 'fails from tick 15 on', (c) => (c.tick < 15 ? true : `tick ${c.tick}`))
      .invariant(1, 'always holds', () => true)
      .build();
    expect(sc.mapSizeWu).toBe(64);
    const r = runScenario(sc, { simBin });
    expect(r.map).toBe('inline:tiny');
    expect(r.mapSimHash).toBe(mapSimHash(map));
    expect(r.finalUnitCount).toBe(5);
    expect(failedAsserts(r)).toEqual([{ tick: 15, name: 'fails from tick 15 on', ok: false, detail: 'tick 15' }]);
    expect(r.asserts.find((a) => a.name.startsWith('always holds'))).toMatchObject({ ok: true, tick: 30 });
    const plane = runScenario(new ScenarioBuilder('plane').map({ sizeWu: 256 }).ticks(10).build(), { simBin });
    expect(plane.map).toBe('testplane:256');
    expect(plane.mapSimHash).toBe(mapSimHash(createTestPlaneMap(256)) >>> 0);
  });

  it('ridge-water-block: the golden scenario passes its asserts in Node', () => {
    const r = runScenario(ridgeWaterBlock(), { simBin, maps });
    expect(failedAsserts(r)).toEqual([]);
    expect(r.asserts.length).toBeGreaterThanOrEqual(9);
  });
});

describe('tick bench on hollow-ridge', () => {
  it('runs 1,000 driving cubes on the map (short run)', () => {
    const job = { kind: 'tickBench', ticks: 60, map: HOLLOW_RIDGE_PATH } as const;
    expect(jobKey(job)).toBe('tickBench-hollow-ridge');
    expect(jobKey({ kind: 'tickBench', ticks: 60 })).toBe('tickBench');
    const r = runTickBench({ simBin, ticks: 60, reps: 1, clock: () => performance.now(), map: maps[HOLLOW_RIDGE_PATH]! });
    expect(r.map).toBe('Hollow Ridge');
    expect(r.units).toBe(1000);
    expect(r.movingAtEnd).toBeGreaterThan(500);
    expect(r.total.n).toBe(60);
  });
});
