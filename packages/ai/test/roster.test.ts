import { describe, expect, it } from 'vitest';
import {
  bpTableFromRoster,
  blipThreat,
  blipThreatTable,
  enemyAcuFactor,
  FixedBudget,
  ownAcuFactor,
  Scene as PlatoonScene,
  RATIO_EPS,
  strengthRadius,
  threatOf,
  type EnemyContact,
  type ManagerContext,
  type OwnEntry,
  type StrengthContext,
  type ThreatUnit,
  type UnitClasses,
} from '../src/index.ts';
import { loadRoster, loadRosterJson } from './support/fixtures.ts';

const T = loadRoster();

function bp(id: string) {
  const b = T.byId(id);
  if (b === undefined) throw new Error(id);
  return b;
}

describe('roster adapter', () => {
  it('sorts by id, index = position, lookups by binary search', () => {
    for (let i = 0; i < T.list.length; i++) {
      expect(T.list[i]!.index).toBe(i);
      if (i > 0) expect(T.list[i - 1]!.id < T.list[i]!.id).toBe(true);
      expect(T.byId(T.list[i]!.id)).toBe(T.list[i]);
    }
    expect(T.byId('core:nope')).toBeUndefined();
  });

  it('reads economy, motion and upgrade links', () => {
    const mex = bp('core:str_t1_mex');
    expect(mex.mass).toBe(36);
    expect(mex.massPerSec).toBe(2);
    expect(mex.upkeepEnergyPerSec).toBe(2);
    expect(mex.footprint).toEqual([2, 2]);
    expect(mex.isStructure).toBe(true);
    expect(T.list[mex.upgradesTo]!.id).toBe('core:str_t2_mex');
    expect(mex.upgradeFrom).toBe(-1);
    expect(T.list[bp('core:str_t2_mex').upgradeFrom]!.id).toBe('core:str_t1_mex');
    const acu = bp('core:cmd_commander');
    expect(acu.buildPower).toBe(10);
    expect(acu.storageMass).toBe(650);
    expect(acu.storageEnergy).toBe(3900);
    expect(acu.speed).toBe(1.7);
    expect(acu.isStructure).toBe(false);
    expect(acu.layer).toBe('land');
    expect(bp('core:air_t1_bomber').layer).toBe('air');
  });

  it('excludes the overcharge from DPS and counts shields into HP_eff (ai.md §5.6)', () => {
    const acu = bp('core:cmd_commander');
    expect(acu.dpsSurface).toBe(100);
    expect(acu.rangeMax).toBe(22);
    const shield = bp('core:lnd_t2_shield');
    expect(shield.hpEff).toBe(160 + 3200);
    const arty = bp('core:lnd_t1_arty');
    expect(arty.rangeMin).toBe(6);
    expect(arty.splash).toBe(1.1);
  });

  it('canBuild evaluates buildableBy against the builder categories', () => {
    const acu = bp('core:cmd_commander');
    const eng1 = bp('core:lnd_t1_engineer');
    const eng2 = bp('core:lnd_t2_engineer');
    const fac1 = bp('core:str_t1_fac_land');
    expect(T.canBuild(acu, bp('core:str_t1_mex'))).toBe(true);
    expect(T.canBuild(eng1, fac1)).toBe(true);
    expect(T.canBuild(eng1, bp('core:str_t2_mex'))).toBe(false);
    expect(T.canBuild(eng2, bp('core:str_t2_mex'))).toBe(true);
    expect(T.canBuild(fac1, eng1)).toBe(true);
    expect(T.canBuild(fac1, eng2)).toBe(false);
    // Upgrade-only stages are never directly buildable.
    expect(T.canBuild(eng2, bp('core:str_t2_fac_land'))).toBe(false);
    expect(T.canBuild(acu, acu)).toBe(false);
  });

  it('matches and compile work on the registry (incl. the pseudo category UPGRADE)', () => {
    expect(T.registry.bitOf('UPGRADE')).toBeGreaterThanOrEqual(0);
    const e = T.compile('STRUCTURE & FACTORY & LAND');
    expect(T.compile('STRUCTURE & FACTORY & LAND')).toBe(e);
    expect(T.matches(bp('core:str_t1_fac_land'), e)).toBe(true);
    expect(T.matches(bp('core:str_t1_fac_air'), e)).toBe(false);
  });

  it('rejects malformed rosters', () => {
    expect(() => bpTableFromRoster(null)).toThrow(/expected an object/);
    expect(() => bpTableFromRoster({ schema: 'x', units: [] })).toThrow(/schema/);
    const json = loadRosterJson() as { units: Record<string, unknown>[] };
    const dup = { ...(json as object), units: [json.units[0], json.units[0]] };
    expect(() => bpTableFromRoster(dup)).toThrow(/duplicate/);
    const bad = { ...(json as object), units: [{ ...json.units[0], economy: { mass: 'x' } }] };
    expect(() => bpTableFromRoster(bad)).toThrow(/finite number/);
  });
});

describe('threat (ai.md §5.5/§5.6)', () => {
  // ai.md §5.6 table, ±1. Stichel: roster.json (single source of numbers) now has 30 M / 60 HP /
  // 23.3 DPS ⇒ √(23.3·60) = 37 (ai.md still lists 40 from an older roster; ecosim --threat also 37).
  const table: [string, 'surface' | 'air', number][] = [
    ['core:cmd_commander', 'surface', 1095],
    ['core:lnd_t1_scout', 'surface', 8],
    ['core:lnd_t1_bot', 'surface', 37],
    ['core:lnd_t1_arty', 'surface', 48],
    ['core:lnd_t1_tank', 'surface', 84],
    ['core:lnd_t2_tank', 'surface', 294],
    ['core:lnd_t2_mml', 'surface', 216],
    ['core:str_t1_pd', 'surface', 474],
    ['core:str_t1_aa', 'air', 234],
    ['core:lnd_t1_aa', 'air', 93],
  ];
  for (const [id, layer, want] of table) {
    it(`${id} ${layer} ≈ ${want}`, () => {
      expect(Math.abs(threatOf(bp(id), 1, layer) - want)).toBeLessThanOrEqual(1);
    });
  }

  it('scales with the HP fraction and has no cross-layer threat', () => {
    expect(threatOf(bp('core:lnd_t1_tank'), 0.5, 'surface')).toBeCloseTo(threatOf(bp('core:lnd_t1_tank'), 1, 'surface') / 2, 12);
    expect(threatOf(bp('core:lnd_t1_tank'), 1, 'air')).toBe(0);
    expect(threatOf(bp('core:lnd_t1_aa'), 1, 'surface')).toBe(0);
  });

  it('commander factors use only explicit, non-fog inputs (R-07)', () => {
    expect(ownAcuFactor(7499)).toBe(1);
    expect(ownAcuFactor(7500)).toBe(1.5);
    expect(enemyAcuFactor(false, 2999)).toBe(1);
    expect(enemyAcuFactor(false, 3000)).toBe(1.5);
    expect(enemyAcuFactor(true, 0)).toBe(1.5);
  });

  it('blip threat = median direct-fire land unit of the highest seen tech (T1 84, T2 294)', () => {
    const bt = blipThreatTable(T);
    expect(Math.round(blipThreat(bt, 0))).toBe(84);
    expect(Math.round(blipThreat(bt, 1))).toBe(84);
    expect(Math.round(blipThreat(bt, 2))).toBe(294);
    expect(Math.round(blipThreat(bt, 3))).toBe(693);
  });

  it('R = 0.7 for 7 vs 10 Punzen and 0.64 for 7 vs 11 (linear sums, ai.md §5.5) — production path PlatoonScene.strengthAt', () => {
    const tank = bp('core:lnd_t1_tank').index;
    const sctx: StrengthContext = {
      table: T,
      layer: 'surface',
      tick: 0,
      ownStoredEnergy: 0,
      enemyEnergyStorageSeen: false,
      highestEnemyTechSeen: 1,
      blipTable: blipThreatTable(T),
    };
    /** The scene as the PlatoonManager uses it (bucket indices, op budget); classes are not needed for R. */
    const scene = (own: readonly ThreatUnit[], enemies: readonly ThreatUnit[], budget = 1e9): PlatoonScene => {
      const s = new PlatoonScene(1024, null as unknown as UnitClasses);
      s.sctx = sctx;
      s.ctx = { budget: new FixedBudget(budget), profile: { platoonGridMode: false }, bb: { threat: null } } as unknown as ManagerContext;
      own.forEach((u, i) => s.ownIdx.add({ ...u, handle: i + 1, rec: null } as unknown as OwnEntry));
      enemies.forEach((u, i) => s.enemyIdx.add({ ...u, id: i + 1, army: 1, kind: u.bp < 0 ? 'blip' : 'visible' } as unknown as EnemyContact));
      return s;
    };
    const own = Array.from({ length: 7 }, (_, i) => ({ bp: tank, x: 100 + i, z: 100, hpFrac: 1 }));
    const e10 = Array.from({ length: 10 }, (_, i) => ({ bp: tank, x: 110 + i, z: 105, hpFrac: 1 }));
    const e11 = [...e10, { bp: tank, x: 120, z: 106, hpFrac: 1 }];
    const r = strengthRadius(T, [tank]);
    expect(r).toBe(38);
    const r10 = scene(own, e10).strengthAt(105, 102, r)!;
    expect(r10.ratio).toBeCloseTo(0.7, 12);
    // The retreat threshold compares with RATIO_EPS: 7 vs 10 is not a retreat, 7 vs 11 is.
    expect(r10.ratio >= 0.7 - RATIO_EPS).toBe(true);
    const r11 = scene(own, e11).strengthAt(105, 102, r)!;
    expect(r11.ratio).toBeCloseTo(7 / 11, 12);
    expect(r11.ratio < 0.7 - RATIO_EPS).toBe(true);
    // Blips count with the T1 median; out-of-radius units do not count.
    const blips = [{ bp: -1, x: 100, z: 100, hpFrac: 1 }, { bp: tank, x: 900, z: 900, hpFrac: 1 }];
    expect(Math.round(scene(own, blips).strengthAt(100, 100, r)!.enemy)).toBe(84);
    // Every visited candidate costs one op: an exhausted budget yields null (cursor continuation).
    expect(scene(own, e10, 5).strengthAt(105, 102, r)).toBeNull();
  });

});
