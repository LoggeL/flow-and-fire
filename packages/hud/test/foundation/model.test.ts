import { effect } from '@preact/signals';
import { describe, expect, test } from 'vitest';
import {
  ALERT_DEFS,
  ALERT_TYPES,
  CONTROL_GROUP_COUNT,
  DEFAULT_SETTINGS,
  LOADING_PHASE_IDS,
  ORDER_GRID,
  ORDER_IDS,
  SLOT_CODES,
  capLevel,
  changedSettings,
  createHudModel,
  createMultiStats,
  createResourceSignals,
  hpLevel,
  locale,
  net,
  resourceStatus,
  secondsToEmpty,
  secondsToFull,
} from '../../src/index.ts';
import { demoUnitCatalog } from '../../src/demo/catalog.ts';

const CAT = demoUnitCatalog();

describe('eco derivations (ui.md §5.1)', () => {
  test('net and time to empty/full', () => {
    expect(net(28, 31.5)).toBeCloseTo(-3.5);
    expect(secondsToEmpty(35, -3.5)).toBeCloseTo(10);
    expect(secondsToEmpty(100, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(secondsToFull(1000, 1230, 23)).toBeCloseTo(10);
    expect(secondsToFull(1230, 1230, 5)).toBe(0);
    expect(secondsToFull(10, 100, -1)).toBe(Number.POSITIVE_INFINITY);
  });

  test('status rules: stall, overflow, stall soon, normal', () => {
    expect(resourceStatus(0, 4900, 220, 305, 0.72)).toBe('stall');
    expect(resourceStatus(4900, 4900, 340, 296, 0.99)).toBe('stall');
    expect(resourceStatus(1230, 1230, 44, 31.5, 1)).toBe('overflow');
    expect(resourceStatus(30, 1230, 28, 31.5, 1)).toBe('stallSoon');
    expect(resourceStatus(35, 1230, 28, 31.5, 1)).toBe('normal');
    expect(resourceStatus(2840, 4900, 340, 296, 1)).toBe('normal');
    expect(resourceStatus(0, 0, 0, 0, 1)).toBe('normal');
  });

  test('resource signals derive net and status reactively', () => {
    const r = createResourceSignals({ stored: 2840, capacity: 4900, income: 340, demand: 296 });
    const seen: string[] = [];
    const dispose = effect(() => {
      seen.push(r.status.value);
    });
    expect(r.net.value).toBe(44);
    r.flow.value = 0.72;
    r.flow.value = 1;
    r.stored.value = 4900;
    dispose();
    expect(seen).toEqual(['normal', 'stall', 'normal', 'overflow']);
  });
});

describe('other derivations', () => {
  test('unit cap level: yellow from 90 %, red at the cap', () => {
    expect(capLevel(64, 500)).toBe('normal');
    expect(capLevel(450, 500)).toBe('near');
    expect(capLevel(500, 500)).toBe('reached');
    expect(capLevel(3, 0)).toBe('normal');
  });

  test('hp level thresholds 55 % / 30 %', () => {
    expect(hpLevel(0.86)).toBe('ok');
    expect(hpLevel(0.55)).toBe('ok');
    expect(hpLevel(0.54)).toBe('warn');
    expect(hpLevel(0.3)).toBe('warn');
    expect(hpLevel(0.18)).toBe('crit');
  });

  test('changed settings', () => {
    expect(changedSettings(DEFAULT_SETTINGS)).toEqual([]);
    expect(changedSettings({ ...DEFAULT_SETTINGS, volMusic: 10, keyScheme: 'wasd' })).toEqual(['volMusic', 'keyScheme']);
  });

  test('multi stats buffers', () => {
    const s = createMultiStats(5, 19);
    expect(s.groupHp).toBeInstanceOf(Float32Array);
    expect(s.groupHp).toHaveLength(5);
    expect(s.unitHp).toHaveLength(19);
  });
});

describe('alert table (ui.md §5.11)', () => {
  test('10 types with level, interval, jump target and sound', () => {
    expect(ALERT_TYPES).toHaveLength(10);
    const table = ALERT_TYPES.map((t) => [t, ALERT_DEFS[t].level, ALERT_DEFS[t].repeatS, ALERT_DEFS[t].jump]);
    expect(table).toEqual([
      ['commanderDanger', 'crit', 8, 'unit'],
      ['energyStall', 'crit', 20, 'flowDetails'],
      ['massStall', 'warn', 20, 'flowDetails'],
      ['baseAttacked', 'warn', 15, 'structure'],
      ['unitAttacked', 'warn', 10, 'unit'],
      ['enemyAir', 'warn', 30, 'sighting'],
      ['enemyCommanderSpotted', 'info', 30, 'sighting'],
      ['storageFull', 'info', 30, 'none'],
      ['buildComplete', 'ok', 5, 'structure'],
      ['factoryUpgraded', 'ok', 5, 'structure'],
    ]);
    for (const t of ALERT_TYPES) expect(ALERT_DEFS[t].sound).toMatch(/^alt_[a-z_]+$/);
  });
});

describe('order grid (ui.md §5.8)', () => {
  test('fixed places; self-destruct has no grid key (R4)', () => {
    expect(ORDER_IDS).toHaveLength(14);
    expect(new Set(ORDER_GRID.map((o) => o.slot)).size).toBe(14);
    for (const o of ORDER_GRID) expect(SLOT_CODES).toContain(o.slot);
    expect(ORDER_GRID.find((o) => o.id === 'selfDestruct')).toEqual({ id: 'selfDestruct', slot: 'KeyB', key: null });
    expect(ORDER_GRID.find((o) => o.id === 'attackGround')?.slot).toBe('KeyZ');
  });
});

describe('createHudModel', () => {
  test('defaults', () => {
    const m = createHudModel({ units: CAT });
    expect(m.locale).toBe(locale);
    expect(m.teams.value).toBe('house');
    expect(m.scale.value).toBe(1);
    expect(m.keyboardLayout.value).toBe('de');
    expect(m.eco.mass.flow.value).toBe(1);
    expect(m.eco.mass.status.value).toBe('normal');
    expect(m.selection.kind.value).toBe('none');
    expect(m.card.page.value).toBe('empty');
    expect(m.strip.groups.value).toHaveLength(CONTROL_GROUP_COUNT);
    expect(m.match.unitCap.value).toBe(500);
    expect(m.minimap.available.value).toBe(false);
    expect(m.menus.loading.phases.value.map((p) => p.id)).toEqual(LOADING_PHASE_IDS);
    expect(m.menus.settings.values.value).toEqual(DEFAULT_SETTINGS);
  });

  test('models are independent (except the shared locale)', () => {
    const a = createHudModel({ units: CAT });
    const b = createHudModel({ units: CAT });
    a.eco.mass.stored.value = 99;
    expect(b.eco.mass.stored.value).toBe(0);
    expect(a.locale).toBe(b.locale);
  });
});
