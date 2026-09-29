import { describe, expect, it } from 'vitest';
import { compareChains, toGolden, toHashChain, type HashChain } from '../src/goldens.ts';
import { failedAsserts, runScenario } from '../src/scenario.ts';
import { SCENARIO_NAMES, scenarioByName } from '../src/scenarios.ts';
import { loadSimBin, readGolden } from '../scripts/lib.ts';

describe('L2 goldens (Node)', () => {
  const simBin = loadSimBin();

  for (const name of SCENARIO_NAMES) {
    it(`${name}: asserts pass and the 2,000-tick hash chain equals the golden`, () => {
      const golden = readGolden(name);
      expect(golden, `golden for ${name} (pnpm --filter @faf/headless goldens -- --update)`).not.toBeNull();
      const r = runScenario(scenarioByName(name), { simBin });
      expect(failedAsserts(r)).toEqual([]);
      expect(r.trail.length).toBe(200);
      const g = toGolden(r);
      expect(g.simHash).toBe(golden!.simHash);
      expect(g.layoutHash).toBe(golden!.layoutHash);
      const d = compareChains(golden!, toHashChain(r));
      expect(d.equal, `first divergent tick ${d.firstDivergentTick}: ${d.detail}`).toBe(true);
      // The chain moves (units drive / churn), so a stuck world would be detected.
      expect(new Set(r.trail).size).toBeGreaterThan(150);
    });
  }

  it('compareChains reports the first divergent tick', () => {
    const base: HashChain = { scenario: 's', ticks: 50, hashIntervalTicks: 10, trail: ['0x1', '0x2', '0x3', '0x4', '0x5'], finalRuleHash: '0x5', finalFullHash: '0x9' };
    expect(compareChains(base, base).equal).toBe(true);
    expect(compareChains(base, { ...base, trail: ['0x1', '0x2', '0xff', '0x4', '0x5'] }).firstDivergentTick).toBe(30);
    expect(compareChains(base, { ...base, trail: base.trail.slice(0, 4) }).firstDivergentTick).toBe(50);
    expect(compareChains(base, { ...base, finalFullHash: '0x8' })).toMatchObject({ equal: false, firstDivergentTick: 50 });
  });
});
