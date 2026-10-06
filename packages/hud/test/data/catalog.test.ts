import { describe, expect, it } from 'vitest';
import { resolveCardPage } from '../../src/data/card-logic.ts';
import { EMPTY_UNIT_CATALOG, createUnitCatalog } from '../../src/data/catalog.ts';
import { flowDemand, getUnit, unitName, unitText } from '../../src/data/roster.ts';
import type { UnitRecord } from '../../src/data/types.ts';
import { demoUnitCatalog } from '../../src/demo/catalog.ts';
import '../../src/hud/card/spec.ts'; // registers the card page resolver of the model
import { createHudModel } from '../../src/model/index.ts';

const DEMO = demoUnitCatalog();
const ENG1 = 'core:lnd_t1_engineer';
const PGEN = 'core:str_t1_pgen';

/** A mod catalog: the T1 engineer, a re-balanced boiler and one mod structure on slot T of the build menu. */
function modCatalog() {
  const eng = getUnit(DEMO, ENG1);
  const pgen = getUnit(DEMO, PGEN);
  const rebalanced: UnitRecord = { ...pgen, economy: { ...pgen.economy, mass: 150 } };
  const modTower: UnitRecord = {
    ...pgen,
    id: 'mod:tower',
    key: 'tower',
    name: { de: 'Turm', en: 'Tower' },
    short: { de: 'Turm', en: 'Tower' },
    hotbuild: { menu: 'Bau', slot: 'T', viaUpgrade: false },
    upgradesTo: null,
    upgradeFrom: null,
  };
  return createUnitCatalog({ units: [eng, rebalanced, modTower], buildTable: { [ENG1]: [PGEN, 'mod:tower', 'core:gone'] } }, 'mod');
}

describe('UnitCatalog (HudModel.units, PLAN §3.9)', () => {
  it('indexes full and short ids, keeps order, drops build table entries of unknown units', () => {
    const cat = modCatalog();
    expect(cat.label).toBe('mod');
    expect(cat.find('lnd_t1_engineer')?.id).toBe(ENG1);
    expect(cat.find('mod:tower')?.key).toBe('tower');
    expect(cat.indexOf('mod:tower')).toBe(2);
    expect(cat.indexOf('core:nope')).toBe(-1);
    expect(cat.buildTable[ENG1]).toEqual([PGEN, 'mod:tower']);
    expect(Object.isFrozen(cat.units)).toBe(true);
  });

  it('duplicate ids are a producer error at creation time', () => {
    const eng = getUnit(DEMO, ENG1);
    expect(() => createUnitCatalog({ units: [eng, eng], buildTable: {} }, 'dup')).toThrow(/duplicate unit/);
  });

  it('card logic, stats and texts follow the catalog (balance changes and mod units, no second truth)', () => {
    const cat = modCatalog();
    const page = resolveCardPage(cat, [ENG1]);
    expect(page.page).toBe('build');
    expect(page.cells.find((c) => c.slot === 'KeyT')?.typeId).toBe('mod:tower');
    // The demo catalog has no mod unit on T; its tables are memoised separately.
    expect(resolveCardPage(DEMO, [ENG1]).cells.find((c) => c.slot === 'KeyT')?.typeId).not.toBe('mod:tower');
    // Re-balanced cost reaches the flow demand of the tooltip.
    expect(flowDemand(cat, PGEN, 10)!.massPerS).toBeCloseTo(2 * flowDemand(DEMO, PGEN, 10)!.massPerS, 6);
    expect(unitName(cat, 'mod:tower', 'en')).toBe('Tower');
    expect(unitText(cat, 'mod:tower', 'short', 'de')).toBe('Turm');
  });

  it('the empty catalog never throws: unknown selections get the orders page, names fall back to ids', () => {
    expect(resolveCardPage(EMPTY_UNIT_CATALOG, [ENG1]).page).toBe('orders');
    expect(resolveCardPage(EMPTY_UNIT_CATALOG, []).page).toBe('empty');
    expect(unitName(EMPTY_UNIT_CATALOG, ENG1, 'de')).toBe(ENG1);
  });

  it('a new catalog in the model re-derives the card page (event, no re-selection needed)', () => {
    const model = createHudModel();
    model.card.selectedTypes.value = [ENG1];
    expect(model.card.page.value).toBe('orders');
    model.units.value = DEMO;
    expect(model.card.page.value).toBe('build');
  });
});
