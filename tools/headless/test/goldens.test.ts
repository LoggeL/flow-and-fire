import { describe, expect, it } from 'vitest';
import { SIM_BUILD } from '@faf/sim';
import { compareChains, goldenUpdateVerdict, parseGolden, goldenJson, toGolden, toHashChain, type Golden, type HashChain } from '../src/goldens.ts';
import { failedAsserts, mapLabel, runScenario } from '../src/scenario.ts';
import { HOLLOW_RIDGE_PATH, SCENARIO_NAMES, scenarioByName } from '../src/scenarios.ts';
import { loadMaps, loadSimBin, readGolden } from '../scripts/lib.ts';

describe('L2 goldens (Node)', () => {
  it('covers ≥ 2 scenarios on the test plane and ≥ 2 on hollow-ridge (MS2 DoD) plus the MS3 goldens', () => {
    const labels = SCENARIO_NAMES.map((n) => mapLabel(scenarioByName(n).map));
    expect(labels.filter((l) => l === 'testplane:512').length).toBeGreaterThanOrEqual(2);
    expect(labels.filter((l) => l === HOLLOW_RIDGE_PATH).length).toBeGreaterThanOrEqual(2);
    for (const n of ['ridge-group-offset', 'ridge-shift-queue', 'choke-3wu', 'obstacle-repath']) expect(SCENARIO_NAMES).toContain(n);
    // choke-3wu runs on a generated map (@faf/nav/testmap 'choke', inline RtsMap).
    expect(mapLabel(scenarioByName('choke-3wu').map)).toMatch(/^inline:nav-choke-128-3$/);
  });

  const simBin = loadSimBin();
  const maps = loadMaps();

  for (const name of SCENARIO_NAMES) {
    it(`${name}: asserts pass and the 2,000-tick hash chain equals the golden`, () => {
      const golden = readGolden(name);
      expect(golden, `golden for ${name} (pnpm --filter @faf/headless goldens -- --update)`).not.toBeNull();
      const r = runScenario(scenarioByName(name), { simBin, maps });
      expect(failedAsserts(r)).toEqual([]);
      expect(r.trail.length).toBe(Math.floor(r.ticks / 10));
      const g = toGolden(r);
      // simId contract (PLAN §3.1): the chain was recorded with the current SIM_BUILD. A bump
      // without re-recording fails here; a sim change without a bump fails the chain compare
      // below and `goldens --update` refuses to rewrite it (goldenUpdateVerdict).
      expect(golden!.simBuild, `golden ${name} simBuild (pnpm --filter @faf/headless goldens -- --update)`).toBe(SIM_BUILD);
      expect(g.simHash).toBe(golden!.simHash);
      expect(g.layoutHash).toBe(golden!.layoutHash);
      expect(g.map).toBe(golden!.map);
      expect(g.mapSimHash).toBe(golden!.mapSimHash);
      const d = compareChains(golden!, toHashChain(r));
      expect(d.equal, `first divergent tick ${d.firstDivergentTick}: ${d.detail}`).toBe(true);
      // The chain moves (units drive / churn), so a stuck world would be detected.
      expect(new Set(r.trail).size).toBeGreaterThan(Math.floor(r.trail.length * 0.5));
    }, 120_000);
  }

  it('goldens --update refuses a changed chain without a SIM_BUILD bump', () => {
    const base: Golden = {
      format: 'faf-golden',
      version: 3,
      simBuild: 'faf-sim/x1',
      scenario: 's',
      ticks: 30,
      seed: '0x00000001',
      simHash: '0x0000000a',
      layoutHash: '0x0000000b',
      map: 'testplane:512',
      mapSimHash: '0x0000000c',
      hashIntervalTicks: 10,
      finalUnitCount: 1,
      commandCount: 1,
      finalRuleHash: '0x3',
      finalFullHash: '0x9',
      trail: ['0x1', '0x2', '0x3'],
    };
    expect(parseGolden(goldenJson(base))).toEqual(base);
    expect(() => parseGolden(JSON.stringify({ ...base, simBuild: undefined }))).toThrow();
    expect(goldenUpdateVerdict(null, base).kind).toBe('new');
    expect(goldenUpdateVerdict(base, base).kind).toBe('unchanged');
    // Only the build tag changed (e.g. a bump for a change elsewhere): fine.
    expect(goldenUpdateVerdict(base, { ...base, simBuild: 'faf-sim/x2' }).kind).toBe('unchanged');
    const changed = { ...base, trail: ['0x1', '0xff', '0x3'] };
    expect(goldenUpdateVerdict(base, changed)).toMatchObject({ kind: 'needsBump', diff: { firstDivergentTick: 20 } });
    expect(goldenUpdateVerdict(base, { ...changed, simBuild: 'faf-sim/x2' }).kind).toBe('changed');
    // A layout change alone (same chain) also needs a bump: snapshots are no longer interchangeable.
    expect(goldenUpdateVerdict(base, { ...base, layoutHash: '0x0000000c' }).kind).toBe('needsBump');
    expect(goldenUpdateVerdict(base, { ...base, finalFullHash: '0x8' }).kind).toBe('needsBump');
    // An edited map changes the simId through mapSimHash on its own: no bump needed.
    expect(goldenUpdateVerdict(base, { ...changed, mapSimHash: '0x0000000d' }).kind).toBe('changed');
    // … unless the blueprints changed at the same time.
    expect(goldenUpdateVerdict(base, { ...changed, mapSimHash: '0x0000000d', simHash: '0x0000000e' }).kind).toBe('needsBump');
    expect(() => parseGolden(JSON.stringify({ ...base, mapSimHash: undefined }))).toThrow();
  });

  it('compareChains reports the first divergent tick', () => {
    const base: HashChain = { scenario: 's', ticks: 50, hashIntervalTicks: 10, trail: ['0x1', '0x2', '0x3', '0x4', '0x5'], finalRuleHash: '0x5', finalFullHash: '0x9' };
    expect(compareChains(base, base).equal).toBe(true);
    expect(compareChains(base, { ...base, trail: ['0x1', '0x2', '0xff', '0x4', '0x5'] }).firstDivergentTick).toBe(30);
    expect(compareChains(base, { ...base, trail: base.trail.slice(0, 4) }).firstDivergentTick).toBe(50);
    expect(compareChains(base, { ...base, finalFullHash: '0x8' })).toMatchObject({ equal: false, firstDivergentTick: 50 });
  });
});
