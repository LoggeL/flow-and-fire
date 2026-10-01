import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MVP_UNITS,
  ROSTER,
  UNIT_TEXT_FIELDS,
  buildTimeS,
  findUnit,
  flowDemand,
  getUnit,
  unitStats,
  unitText,
  unitTextKey,
  upgradeTarget,
} from '../../src/data/roster.ts';
import { BUILD_TABLE } from '../../src/data/build-table.gen.ts';

const REPO = resolve(import.meta.dirname, '../../../..');
const TEXTS = JSON.parse(readFileSync(resolve(REPO, 'packages/hud/scripts/unit-texts.json'), 'utf8')) as {
  units: Record<string, { short: { de: string; en: string }; desc: { de: string; en: string }; adjacency?: { en: string } }>;
};

describe('roster table', () => {
  it('contains every roster unit, MVP = 50 without the post-MVP experimentals', () => {
    expect(ROSTER).toHaveLength(56);
    expect(MVP_UNITS).toHaveLength(50);
    expect(ROSTER.filter((u) => u.postMvp).every((u) => u.tech === 4)).toBe(true);
  });

  it('every MVP unit has name, role, short (≤ 10 chars), desc (≤ 2 sentences) in DE and EN', () => {
    for (const u of MVP_UNITS) {
      const t = TEXTS.units[u.id];
      expect(t, u.id).toBeDefined();
      for (const lang of ['de', 'en'] as const) {
        for (const f of ['name', 'role', 'short', 'desc'] as const) expect(u[f][lang].length, `${u.id} ${f}.${lang}`).toBeGreaterThan(0);
        expect([...u.short[lang]].length, `${u.id} short.${lang}`).toBeLessThanOrEqual(10);
        expect(u.short[lang], `${u.id} short without roman tier`).not.toMatch(/\sI{1,3}$/);
        const sentences = u.desc[lang].split(/(?<=[.!?])\s+/).filter((s) => s.length > 0);
        expect(sentences.length, `${u.id} desc.${lang}`).toBeGreaterThanOrEqual(1);
        expect(sentences.length, `${u.id} desc.${lang}`).toBeLessThanOrEqual(2);
      }
      if (u.adjacency !== null) {
        expect(u.adjacency.de.length, u.id).toBeGreaterThan(0);
        expect(u.adjacency.en.length, u.id).toBeGreaterThan(0);
        expect(t!.adjacency?.en, u.id).toBe(u.adjacency.en);
      } else {
        expect(t!.adjacency, u.id).toBeUndefined();
      }
    }
  });

  it('player-facing texts never mention the FA reference (faction.md §2.4)', () => {
    for (const u of ROSTER) {
      for (const f of UNIT_TEXT_FIELDS) {
        for (const loc of ['de', 'en'] as const) expect(unitText(u.id, f, loc), `${u.id} ${f}`).not.toMatch(/\bFA\b|Overcharge|Commander\b(?! |$)/);
      }
    }
  });

  it('DPS sums weapons without tap shot; range is the maximum', () => {
    const vogt = getUnit('core:cmd_commander');
    expect(vogt.weapons).toMatchObject({ count: 1, dps: 100, range: 22 });
    expect(getUnit('core:air_t2_fbomber').weapons).toMatchObject({ count: 2, dps: 284, range: 50, layers: ['air', 'land'] });
    expect(getUnit('core:lnd_t1_arty').weapons).toMatchObject({ dps: 11.11, range: 30, rangeMin: 6 });
    expect(getUnit('core:lnd_t1_engineer').weapons).toMatchObject({ count: 0, dps: 0, range: 0 });
  });

  it('hotbuild: slot letters, upgrade-only tiers inherit the chain slot', () => {
    expect(getUnit('core:lnd_t1_tank').hotbuild).toEqual({ menu: 'Landwerk', slot: 'Q', viaUpgrade: false });
    expect(getUnit('core:str_t1_pd').hotbuild).toEqual({ menu: 'Bau', slot: 'Z', viaUpgrade: false });
    expect(getUnit('core:str_t2_mex').hotbuild).toEqual({ menu: 'Bau', slot: 'Q', viaUpgrade: true });
    expect(getUnit('core:str_t3_fac_land').hotbuild).toEqual({ menu: 'Bau', slot: 'A', viaUpgrade: true });
    expect(getUnit('core:str_t3_shield').hotbuild).toEqual({ menu: 'Bau', slot: 'F', viaUpgrade: true });
    expect(getUnit('core:cmd_commander').hotbuild).toBeNull();
  });

  it('toggles are normalised ids', () => {
    expect(getUnit('core:cmd_commander').toggles).toEqual(['auto_tapshot']);
    expect(getUnit('core:str_t2_radar').toggles).toEqual(['radar']);
    expect(getUnit('core:str_t2_shield').toggles).toEqual(['shield']);
  });

  it('adjacency DE drops the FA-relation remarks', () => {
    expect(getUnit('core:str_t1_mstore').adjacency?.de).toBe('+12,5 % Produktion je angrenzender Zapfstelle (max. 4 Seiten = +50 %).');
    expect(getUnit('core:str_t1_estore').adjacency?.de).toMatch(/^Bufft alle angrenzenden Energieproduzenten: Glutkessel I/);
  });

  it('build table covers every builder and never lists upgrade-only tiers', () => {
    const builders = ROSTER.filter((u) => ['ENGINEER', 'FACTORY', 'COMMAND'].some((c) => u.categories.includes(c))).map((u) => u.id);
    expect(Object.keys(BUILD_TABLE)).toEqual(builders);
    for (const list of Object.values(BUILD_TABLE)) {
      for (const id of list) expect(getUnit(id).id).not.toMatch(/t[23]_fac_|t[23]_radar|t3_shield/);
    }
    expect(BUILD_TABLE['core:str_t1_fac_land']).toEqual([
      'core:lnd_t1_engineer',
      'core:lnd_t1_scout',
      'core:lnd_t1_bot',
      'core:lnd_t1_tank',
      'core:lnd_t1_arty',
      'core:lnd_t1_aa',
    ]);
  });
});

describe('unitText / unitTextKey (P12)', () => {
  it('key schema unit.core.<id>.<field>', () => {
    expect(unitTextKey('core:lnd_t1_tank', 'name')).toBe('unit.core.lnd_t1_tank.name');
    expect(unitTextKey('lnd_t1_tank', 'short')).toBe('unit.core.lnd_t1_tank.short');
    expect(unitTextKey('core:str_t1_pgen', 'adjacency')).toBe('unit.core.str_t1_pgen.adjacency');
  });

  it('texts per locale', () => {
    expect(unitText('core:lnd_t1_tank', 'name', 'de')).toBe('Punze');
    expect(unitText('core:lnd_t1_tank', 'name', 'en')).toBe('Punch');
    expect(unitText('core:lnd_t1_tank', 'role', 'de')).toBe('Kampfpanzer');
    expect(unitText('core:str_t2_pgen', 'short', 'de')).toBe('Glutkessel');
    expect(unitText('core:str_t1_pgen', 'adjacency', 'en')).toMatch(/Heat Bank/);
    expect(unitText('core:lnd_t1_tank', 'adjacency', 'de')).toBe('');
  });

  it('pseudo: long fields stretched with brackets, short only accented (≤ 10 chars)', () => {
    const name = unitText('core:str_t1_fac_land', 'name', 'pseudo');
    expect(name.startsWith('[') && name.endsWith(']')).toBe(true);
    expect(name.length).toBeGreaterThan('Landwerk I'.length * 1.3);
    for (const u of MVP_UNITS) {
      const s = unitText(u.id, 'short', 'pseudo');
      expect([...s].length, u.id).toBe([...u.short.de].length);
      expect(s, u.id).not.toMatch(/[[\]~]/);
    }
    expect(unitText('core:lnd_t1_tank', 'short', 'pseudo')).not.toBe('Punze');
  });

  it('unknown ids throw in getUnit, findUnit returns undefined', () => {
    expect(findUnit('core:nope')).toBeUndefined();
    expect(() => getUnit('core:nope')).toThrow(/unknown unit type/);
    expect(() => unitText('core:nope', 'name', 'de')).toThrow();
  });
});

describe('stats and flow', () => {
  it('unitStats (tank, commander, radar, mobile shield)', () => {
    expect(unitStats('core:lnd_t1_tank')).toMatchObject({ hp: 300, dps: 23.33, range: 18, speed: 3.3, vision: 20, mass: 56, energy: 280, buildTime: 300, buildPower: 0, structure: false });
    expect(unitStats('core:cmd_commander')).toMatchObject({ hp: 12000, regenPerS: 10, buildPower: 10, storageMass: 650, storageEnergy: 3900, massPerS: 1, energyPerS: 20 });
    expect(unitStats('core:str_t1_radar')).toMatchObject({ radar: 116, upkeepEnergyPerS: 20, speed: 0, structure: true });
    expect(unitStats('core:lnd_t2_shield')).toMatchObject({ shieldHp: 3200, upkeepEnergyPerS: 80 });
    expect(unitStats('core:str_t2_mex')).toMatchObject({ massPerS: 6, upkeepEnergyPerS: 9, tech: 2 });
  });

  it('buildTimeS = buildTime / bp', () => {
    expect(buildTimeS('core:str_t1_pgen', 10)).toBe(12.5);
    expect(buildTimeS('core:lnd_t1_tank', 20)).toBe(15);
    expect(buildTimeS('core:lnd_t1_tank', 0)).toBe(Number.POSITIVE_INFINITY);
  });

  it('flowDemand = cost / (buildTime / bp)', () => {
    // Glutkessel I by the Vogt (BP 10): 75 M, 750 E over 12,5 s.
    expect(flowDemand('core:str_t1_pgen', 10)).toEqual({ massPerS: 6, energyPerS: 60 });
    // Punze in Landwerk I with one T1 helper (20 + 15 = 35 BP): 56 M · 35 / 300.
    const f = flowDemand('core:lnd_t1_tank', 35);
    expect(f.massPerS).toBeCloseTo(6.5333, 3);
    expect(f.energyPerS).toBeCloseTo(32.6667, 3);
    // Linear in BP, total = cost.
    const t = buildTimeS('core:str_t2_pgen', 13);
    expect(flowDemand('core:str_t2_pgen', 13).massPerS * t).toBeCloseTo(1200, 6);
    expect(flowDemand('core:str_t2_pgen', 0)).toEqual({ massPerS: 0, energyPerS: 0 });
  });

  it('upgradeTarget follows special.upgradesTo', () => {
    expect(upgradeTarget('core:str_t1_mex')).toBe('core:str_t2_mex');
    expect(upgradeTarget('core:str_t1_fac_land')).toBe('core:str_t2_fac_land');
    expect(upgradeTarget('core:str_t3_mex')).toBeNull();
    expect(upgradeTarget('core:lnd_t1_tank')).toBeNull();
  });
});
