import { describe, expect, it } from 'vitest';
import {
  buildRangeOf,
  expandSteps,
  mapClassOf,
  managerRng,
  openingWeights,
  parseOpenings,
  referencedRoles,
  resolveRole,
  RoleTable,
  selectOpening,
  type Difficulty,
  type MapClass,
} from '../src/index.ts';
import { loadOpenings, loadOpeningsJson, loadRoster } from './support/fixtures.ts';

const doc = loadOpenings();
const T = loadRoster();

function clone(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(loadOpeningsJson())) as Record<string, unknown>;
}

function openingsOf(j: Record<string, unknown>): Record<string, unknown>[] {
  return j.openings as Record<string, unknown>[];
}

describe('parseOpenings', () => {
  it('parses the design document', () => {
    expect(doc.schema).toBe('faf-ai-openings/1');
    expect(doc.openings.map((o) => o.id)).toEqual(['eco_standard', 'land_rush', 'tech_greed', 'air_opener']);
    const eco = doc.openings[0]!;
    expect(eco.fromMsNumber).toBe(9);
    expect(eco.acu[0]).toEqual({ do: 'build', role: 'fac_land', tech: 1, at: 'slot:fac1', count: 1, fallback: null });
    expect(eco.factoryOrder).toEqual(['fac1']);
    expect(eco.engineers).toHaveLength(4);
    expect(eco.engineers[2]![0]).toMatchObject({ role: 'hydro', fallback: { role: 'pgen', at: 'slot:eco', count: 4 } });
    expect(eco.followUp.techT2).toMatchObject({ minS: 390, minMassIncome: 14, assistEngineers: 3, acuAssist: true, t2Engineers: 2 });
    expect(eco.followUp.waves).toEqual({ first: 8, grow: 4, maxS: 420, airFirst: null });
    expect(eco.followUp.engineers.cap).toEqual([
      [0, 4],
      [240, 6],
      [420, 8],
      [600, 10],
    ]);
    expect(eco.expect.setons!.fac1).toBe(31.8);
    expect((eco.expect.setons!.massInc as Record<string, number>)['180']).toBe(19);
    expect(doc.openings[3]!.followUp.waves.airFirst).toBe(3);
    expect(doc.difficultyTiming.easy).toEqual({ stepDelayS: 4, skipChance: 0.1, techDelayS: 150, engineerCapFactor: 0.6, waveExtra: 4 });
    expect(doc.baseTemplate.slots.fac1).toEqual({ f: 12, s: 0, footprint: 8 });
    expect(doc.assumptions.buildRangeWu.COMMAND).toBe(10);
  });

  it('rejects an unknown step', () => {
    const j = clone();
    (openingsOf(j)[0]!.acu as Record<string, unknown>[])[0]!.do = 'teleport';
    expect(() => parseOpenings(j)).toThrow(/unknown step 'teleport'/);
  });

  it('rejects missing fields', () => {
    const j = clone();
    delete (openingsOf(j)[0]!.acu as Record<string, unknown>[])[0]!.role;
    expect(() => parseOpenings(j)).toThrow(/acu\[0\]\.role/);
    const j2 = clone();
    delete (openingsOf(j2)[1]!.followUp as Record<string, unknown>).waves;
    expect(() => parseOpenings(j2)).toThrow(/waves/);
  });

  it('rejects unknown keys, roles, selectors and schema', () => {
    const j = clone();
    (openingsOf(j)[0]!.acu as Record<string, unknown>[])[0]!.speed = 3;
    expect(() => parseOpenings(j)).toThrow(/unknown key 'speed'/);
    const j2 = clone();
    (openingsOf(j2)[0]!.acu as Record<string, unknown>[])[0]!.role = 'battleship';
    expect(() => parseOpenings(j2)).toThrow(/unknown role/);
    const j3 = clone();
    (openingsOf(j3)[0]!.acu as Record<string, unknown>[])[0]!.at = 'somewhere';
    expect(() => parseOpenings(j3)).toThrow(/site selector/);
    const j4 = clone();
    j4.schema = 'faf-ai-openings/2';
    expect(() => parseOpenings(j4)).toThrow(/schema/);
    expect(() => parseOpenings([])).toThrow(/expected an object/);
  });

  it('expandSteps splits counts into single steps', () => {
    const acu = expandSteps(doc.openings[0]!.acu);
    expect(acu).toHaveLength(1 + 2 + 2 + 1 + 2 + 2);
    expect(acu.every((s) => s.do !== 'build' || s.count === 1)).toBe(true);
  });
});

describe('roles', () => {
  it('every (role, tech) pair used in ai-openings.json resolves to exactly one blueprint', () => {
    const pairs = referencedRoles(doc);
    expect(pairs.length).toBeGreaterThan(10);
    for (const { role, tech } of pairs) {
      const bp = resolveRole(role, tech, T, doc.roles);
      expect(bp.categoryNames).toContain(`TECH${tech}`);
    }
  });

  it('resolves the MVP roles like ecosim (upgrade stages only as fallback)', () => {
    const roles = new RoleTable(T, doc.roles);
    const id = (r: string, t: number): string => roles.resolve(r, t).id;
    expect(id('mex', 1)).toBe('core:str_t1_mex');
    expect(id('mex', 2)).toBe('core:str_t2_mex');
    expect(id('fac_land', 1)).toBe('core:str_t1_fac_land');
    expect(id('fac_land', 2)).toBe('core:str_t2_fac_land');
    expect(id('pgen', 1)).toBe('core:str_t1_pgen');
    expect(id('hydro', 1)).toBe('core:str_t1_hydro');
    expect(id('eng', 1)).toBe('core:lnd_t1_engineer');
    expect(id('scout', 1)).toBe('core:lnd_t1_scout');
    expect(id('tank', 1)).toBe('core:lnd_t1_tank');
    expect(id('tank', 2)).toBe('core:lnd_t2_tank');
    expect(id('bot', 1)).toBe('core:lnd_t1_bot');
    expect(id('arty', 2)).toBe('core:lnd_t2_mml');
    expect(id('pd', 1)).toBe('core:str_t1_pd');
    expect(id('fighter', 1)).toBe('core:air_t1_fighter');
    expect(roles.tryResolve('hydro', 2)).toBeNull();
    expect(() => roles.resolve('hydro', 2)).toThrow(/role hydro@T2/);
    expect(roles.isRole(T.byId('core:lnd_t2_tank')!, 'tank')).toBe(true);
  });

  it('bestFor picks the highest buildable tech ≥ minimum (loop semantics)', () => {
    const roles = new RoleTable(T, doc.roles);
    expect(roles.bestFor('tank', 1, T.byId('core:str_t1_fac_land')!)!.id).toBe('core:lnd_t1_tank');
    expect(roles.bestFor('tank', 1, T.byId('core:str_t2_fac_land')!)!.id).toBe('core:lnd_t2_tank');
    expect(roles.bestFor('eng', 2, T.byId('core:str_t1_fac_land')!)).toBeNull();
  });

  it('build ranges come from the assumptions', () => {
    expect(buildRangeOf(T.byId('core:cmd_commander')!, doc, T)).toBe(10);
    expect(buildRangeOf(T.byId('core:lnd_t1_engineer')!, doc, T)).toBe(6);
    expect(buildRangeOf(T.byId('core:lnd_t2_engineer')!, doc, T)).toBe(7);
    expect(buildRangeOf(T.byId('core:lnd_t1_tank')!, doc, T)).toBe(0);
  });
});

describe('opening selection (ai.md §4.4)', () => {
  const shares = (mc: MapClass, d: Difficulty, maxMs?: number): number[] =>
    openingWeights(doc, mc, d, maxMs === undefined ? {} : { maxMs }).map((w) => w.share * 100);
  const near = (got: number[], want: number[]): void => {
    expect(got).toHaveLength(want.length);
    for (let i = 0; i < want.length; i++) expect(Math.abs(got[i]! - want[i]!)).toBeLessThanOrEqual(0.1);
  };

  it('map classes', () => {
    expect(mapClassOf('Setons', 1024)).toBe('setons');
    expect(mapClassOf('setons', 1024)).toBe('setons');
    expect(mapClassOf('Hollow Ridge', 512)).toBe('size512');
    expect(mapClassOf('x', 256)).toBe('size256');
    expect(mapClassOf('x', 1024)).toBe('size1024');
  });

  it('before MS12 (air_opener off): Hard 44.9/23.1/32.1 % (Setons) and 45.2/38.7/16.1 % (512 WU)', () => {
    near(shares('setons', 'hard'), [44.9, 23.1, 32.1, 0]);
    near(shares('size512', 'hard'), [45.2, 38.7, 16.1, 0]);
    near(shares('setons', 'normal'), [50.0, 16.7, 33.3, 0]);
    near(shares('size512', 'normal'), [52.9, 29.4, 17.6, 0]);
    near(shares('setons', 'easy'), [100, 0, 0, 0]);
    near(shares('size512', 'easy'), [100, 0, 0, 0]);
  });

  it('from MS12 the table of ai.md §4.4 holds', () => {
    near(shares('setons', 'hard', 12), [39.8, 20.5, 28.4, 11.4]);
    near(shares('size512', 'hard', 12), [41.9, 35.9, 15.0, 7.2]);
    near(shares('setons', 'normal', 12), [50.0, 16.7, 33.3, 0]);
  });

  it('draws deterministically and roughly by weight; air_opener is never drawn before MS12', () => {
    const count: Record<string, number> = {};
    for (let seed = 1; seed <= 2000; seed++) {
      const o = selectOpening(doc, 'setons', 'hard', managerRng(seed, 0, 'opening-select'));
      count[o.id] = (count[o.id] ?? 0) + 1;
    }
    expect(count.air_opener).toBeUndefined();
    expect(Math.abs(count.eco_standard! / 2000 - 0.449)).toBeLessThan(0.04);
    expect(Math.abs(count.land_rush! / 2000 - 0.231)).toBeLessThan(0.04);
    const a = selectOpening(doc, 'size512', 'normal', managerRng(7, 1, 'opening-select')).id;
    const b = selectOpening(doc, 'size512', 'normal', managerRng(7, 1, 'opening-select')).id;
    expect(a).toBe(b);
    expect(selectOpening(doc, 'size512', 'normal', managerRng(7, 1, 'x'), { allow: ['tech_greed'] }).id).toBe('tech_greed');
    expect(selectOpening(doc, 'size256', 'normal', managerRng(7, 1, 'x')).id).toBe('eco_standard');
  });
});
