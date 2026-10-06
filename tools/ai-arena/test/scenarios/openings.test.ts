/**
 * AI-OPEN-01/02 (ai.md §9): opening timings of the default brain in the arena against
 * `ai-openings.json → expect` (Normal, no enemy military), and AI-OPEN-03 (ring reservation).
 *
 * Window: until expect.techT2 + 30 s, extended to expect + tolerance of every metric whose
 * expectation lies behind that (tech_greed/Hollow Ridge mex8), so every metric is measured. Tolerance
 * ±10 s (ai.md); deviations with a known cause are listed in TOLERANCE (docs/status/track-ai.md §6.2,
 * fragment tai-p5) — `expect` itself is never changed.
 */
import { describe, expect, it } from 'vitest';
import { secondsOf } from '../../src/scenarios/index.ts';
import { buildOrderOf, openingById, openingRun, sec } from './support.ts';

type Metric = 'fac1' | 'eng1' | 'mex4' | 'mex8' | 'techT2';
const METRICS: readonly Metric[] = ['fac1', 'eng1', 'mex4', 'mex8', 'techT2'];
const DEFAULT_TOL_S = 10;

/**
 * Documented exceptions (cause in the fragment): the arena walks A* paths with string pulling (≈ 4 %
 * shorter than ecosim's grid path × 1.1) and builders stop at build range + half footprint; the
 * contested Hollow Ridge spots (mex 7/8) are 245–250 WU away, so the arena reaches them earlier.
 */
const TOLERANCE: Readonly<Record<string, number>> = {
  'eco_standard/hollow-ridge/mex8': 12,
  /**
   * −44.5 s (arena 591.2 s, expect 635.7 s). Cause: priority order, not the arena model. The arena
   * follows ai.md §5.3 (Mex-Expansion prio 50 before Mex-Upgrade-Assist prio 40): the engineer freed
   * by the first finished mex upgrade (7:29) walks to the second contested spot. ecosim's
   * `policy_step` asks `upgrade_target` BEFORE `pick_spot('mass')` and keeps it on the next upgrade
   * assist until Landwerk II frees three engineers at 8:14. mex7 is equal (572.0 vs 574).
   */
  'tech_greed/hollow-ridge/mex8': 45,
};

const CASES: readonly (readonly [string, string])[] = [
  ['eco_standard', 'setons'],
  ['land_rush', 'setons'],
  ['tech_greed', 'setons'],
  ['eco_standard', 'hollow-ridge'],
  ['land_rush', 'hollow-ridge'],
  ['tech_greed', 'hollow-ridge'],
];

function metricS(m: ReturnType<ReturnType<typeof openingRun>['army']>, k: Metric): number | null {
  switch (k) {
    case 'fac1':
      return secondsOf(m.fac1Tick);
    case 'eng1':
      return secondsOf(m.eng1Tick);
    case 'mex4':
      return secondsOf(m.mex4Tick);
    case 'mex8':
      return secondsOf(m.mex8Tick);
    case 'techT2':
      return secondsOf(m.t2Tick);
  }
}

describe('AI-OPEN-01/02: opening timings against ai-openings.json expect (Normal, no enemy military)', () => {
  for (const [id, map] of CASES) {
    it(`${id} on ${map}: fac1, eng1, mex4, mex8, techT2 within tolerance`, () => {
      const block = openingById(id).expect[map];
      if (block === undefined) throw new Error(`no expect for ${id}/${map}`);
      const exp = (k: Metric): number => {
        const v = block[k];
        if (typeof v !== 'number') throw new Error(`expect.${map}.${k} missing`);
        return v;
      };
      let windowS = Math.ceil(exp('techT2') + 30);
      const baseWindow = windowS;
      for (const k of METRICS) windowS = Math.max(windowS, Math.ceil(exp(k) + (TOLERANCE[`${id}/${map}/${k}`] ?? DEFAULT_TOL_S)));
      // An extended window runs into the first wave: keep the passive enemy commander alive.
      const r = openingRun(map, id, windowS, windowS > baseWindow ? { keepEnemyAlive: true } : {});
      const m = r.army(0);
      expect(r.brain(0).opening?.id).toBe(id);
      expect(r.metrics.endTick).toBe(sec(windowS));
      const report: string[] = [];
      for (const k of METRICS) {
        const want = exp(k);
        const tol = TOLERANCE[`${id}/${map}/${k}`] ?? DEFAULT_TOL_S;
        const got = metricS(m, k);
        report.push(`${k} ${got ?? '–'} (expect ${want})`);
        expect(got, `${id}/${map} ${k}: ${report.join(', ')}`).not.toBeNull();
        expect(Math.abs(got! - want), `${id}/${map} ${k} = ${got} s, expect ${want} s ± ${tol}`).toBeLessThanOrEqual(tol);
      }
    });
  }
});

describe('AI-OPEN-03: ring reservation (eco_standard, Setons)', () => {
  it('no engineer takes a ring spot; the commander builds all four ring mex', () => {
    const violations: string[] = [];
    const ringBuilders = new Map<number, Set<string>>();
    const r = openingRun('setons', 'eco_standard', 150, {
      observe: [
        {
          every: 1,
          run: (rt, t) => {
            const w = rt.world;
            const ring = rt.brain(0).analysis.ringSpots;
            const mexBp = w.bpIndex('core:str_t1_mex');
            for (const u of w.unitsOf(0)) {
              if (!u.alive || !u.info.isBuilder) continue;
              const o = buildOrderOf(u);
              if (o === null || o.bp !== mexBp) continue;
              for (const si of ring) {
                const sp = w.baseStatic.spots[si]!;
                if (Math.abs(sp.x - o.x) > 1 || Math.abs(sp.z - o.z) > 1) continue;
                const who = u.info.isCommander ? 'commander' : 'engineer';
                let set = ringBuilders.get(si);
                if (set === undefined) ringBuilders.set(si, (set = new Set()));
                set.add(who);
                if (!u.info.isCommander) violations.push(`${t}: engineer ${u.handle} → ring spot ${si}`);
              }
            }
          },
        },
      ],
    });
    const ring = r.brain(0).analysis.ringSpots;
    expect(ring).toHaveLength(4);
    expect(violations).toEqual([]);
    // All four ring mex stand and were ordered by the commander.
    const mexBp = r.world.bpIndex('core:str_t1_mex');
    for (const si of ring) {
      const sp = r.world.baseStatic.spots[si]!;
      const built = r.world.unitsOf(0).some((u) => u.alive && u.complete && u.bp.index === mexBp && Math.abs(u.x - sp.x) <= 1 && Math.abs(u.z - sp.z) <= 1);
      expect(built, `ring spot ${si} built`).toBe(true);
      expect([...(ringBuilders.get(si) ?? [])]).toEqual(['commander']);
    }
    // Engineer 1 went to an outer spot (first own mex that is not a ring spot).
    expect(secondsOf(r.army(0).eng1Tick)).not.toBeNull();
  });
});
