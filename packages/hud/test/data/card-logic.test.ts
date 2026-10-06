import { describe, expect, it } from 'vitest';
import {
  buildableBy,
  builderMenu,
  canBuild,
  headBuilder,
  menuMaxTab,
  nextHotbuildTier,
  resolveCardPage,
  rosterSlot,
  slotCodeOf,
} from '../../src/data/card-logic.ts';
import type { CardCellSpec, CardPageSpec, HotbuildStep } from '../../src/data/card-logic.ts';
import { getUnit } from '../../src/data/roster.ts';
import { SLOT_CODES } from '../../src/ui/keys.ts';
import type { SlotCode } from '../../src/ui/keys.ts';
import { demoUnitCatalog } from '../../src/demo/catalog.ts';

const CAT = demoUnitCatalog();

const VOGT = 'core:cmd_commander';
const ENG1 = 'core:lnd_t1_engineer';
const ENG2 = 'core:lnd_t2_engineer';
const ENG3 = 'core:lnd_t3_engineer';
const LAND1 = 'core:str_t1_fac_land';
const LAND2 = 'core:str_t2_fac_land';
const LAND3 = 'core:str_t3_fac_land';
const AIR1 = 'core:str_t1_fac_air';
const AIR2 = 'core:str_t2_fac_air';

function cell(page: CardPageSpec, letter: string): CardCellSpec {
  const c = page.cells.find((x) => x.slot === (`Key${letter}` as SlotCode));
  if (c === undefined) throw new Error(`no cell ${letter}`);
  return c;
}

/** Slot → directly buildable tiers for all non-empty unit cells. */
function tierTable(page: CardPageSpec): Record<string, readonly number[]> {
  const out: Record<string, readonly number[]> = {};
  for (const c of page.cells) if (c.kind === 'unit' && c.tiers.length > 0) out[rosterSlot(c.slot)] = c.tiers;
  return out;
}

describe('ui.md §5.6 "Tech-Stufen je Taste" (exact reproduction)', () => {
  it('Bau (T3 engineer): Q I–III, W I–III, E I, R I, T I, A I, S I, D I, F II, Z I–II, X I–III, C I, V II–III', () => {
    expect(tierTable(resolveCardPage(CAT, [ENG3]))).toEqual({
      Q: [1, 2, 3],
      W: [1, 2, 3],
      E: [1],
      R: [1],
      T: [1],
      A: [1],
      S: [1],
      D: [1],
      F: [2],
      Z: [1, 2],
      X: [1, 2, 3],
      C: [1],
      V: [2, 3],
    });
  });

  it('Bau roleTiers are the same table for every builder of the menu (stripes)', () => {
    const expected = tierTable(resolveCardPage(CAT, [ENG3]));
    for (const b of [VOGT, ENG1, ENG2, ENG3]) {
      const roles: Record<string, readonly number[]> = {};
      for (const c of resolveCardPage(CAT, [b]).cells) if (c.roleTiers.length > 0) roles[rosterSlot(c.slot)] = c.roleTiers;
      expect(roles, b).toEqual(expected);
    }
  });

  it('Landwerk (T3 factory): Q 1–2, W 1–3, E 1–3, R 1–3, A 1, S 1–3, D 2, F 3', () => {
    expect(tierTable(resolveCardPage(CAT, [LAND3]))).toEqual({
      Q: [1, 2],
      W: [1, 2, 3],
      E: [1, 2, 3],
      R: [1, 2, 3],
      A: [1],
      S: [1, 2, 3],
      D: [2],
      F: [3],
    });
  });

  it('Luftwerk (T2 factory): Q/W/A only T1, E/R only T2', () => {
    expect(tierTable(resolveCardPage(CAT, [AIR2]))).toEqual({ Q: [1], W: [1], A: [1], E: [2], R: [2] });
  });

  it('tab counts: Bau and Landwerk T1–T3, Luftwerk T1–T2', () => {
    expect(menuMaxTab(CAT, 'Bau')).toBe(3);
    expect(menuMaxTab(CAT, 'Landwerk')).toBe(3);
    expect(menuMaxTab(CAT, 'Luftwerk')).toBe(2);
  });
});

describe('build page (Vogt / engineers)', () => {
  it('Vogt: head, T1 preselected, all roles on their keys', () => {
    const p = resolveCardPage(CAT, [VOGT]);
    expect(p.page).toBe('build');
    expect(p.menu).toBe('Bau');
    expect(p.headTypeId).toBe(VOGT);
    expect(p.maxTab).toBe(3);
    expect(p.defaultTab).toBe(1);
    expect(p.tab).toBe(1);
    expect(p.cells).toHaveLength(15);
    expect(p.cells.map((c) => c.slot)).toEqual(SLOT_CODES);
    expect(cell(p, 'Q').typeId).toBe('core:str_t1_mex');
    expect(cell(p, 'W').typeId).toBe('core:str_t1_pgen');
    expect(cell(p, 'E').typeId).toBe('core:str_t1_hydro');
    expect(cell(p, 'R').typeId).toBe('core:str_t1_mstore');
    expect(cell(p, 'T').typeId).toBe('core:str_t1_estore');
    expect(cell(p, 'A').typeId).toBe('core:str_t1_fac_land');
    expect(cell(p, 'S').typeId).toBe('core:str_t1_fac_air');
    expect(cell(p, 'D').typeId).toBe('core:str_t1_radar');
    expect(cell(p, 'Z').typeId).toBe('core:str_t1_pd');
    expect(cell(p, 'X').typeId).toBe('core:str_t1_aa');
    expect(cell(p, 'C').typeId).toBe('core:str_t1_wall');
    for (const k of ['G', 'B']) expect(cell(p, k).kind, k).toBe('empty');
    for (const c of p.cells) if (c.kind === 'unit' && c.locked === null) expect(c.tiers).toEqual([1]);
  });

  it('Vogt: F Schirm and V Tiegel are locked until a T2 engineer (Geselle)', () => {
    const p = resolveCardPage(CAT, [VOGT]);
    const f = cell(p, 'F');
    const v = cell(p, 'V');
    expect(f).toMatchObject({ kind: 'unit', typeId: 'core:str_t2_shield', shownTier: 2, tiers: [], locked: { reason: 'needBuilderTech', tier: 2 } });
    expect(v).toMatchObject({ kind: 'unit', typeId: 'core:str_t2_arty', shownTier: 2, tiers: [], locked: { reason: 'needBuilderTech', tier: 2 } });
    const locked = p.cells.filter((c) => c.locked !== null).map((c) => rosterSlot(c.slot));
    expect(locked).toEqual(['F', 'V']);
    // A T2 engineer builds both directly.
    const p2 = resolveCardPage(CAT, [ENG2]);
    expect(cell(p2, 'F').locked).toBeNull();
    expect(cell(p2, 'V').locked).toBeNull();
  });

  it('str_t2_mex is directly buildable by T2/T3 engineers (buildableBy wins over the slot text)', () => {
    expect(canBuild(CAT, [ENG2], 'core:str_t2_mex')).toBe(true);
    expect(canBuild(CAT, [ENG3], 'core:str_t2_mex')).toBe(true);
    expect(canBuild(CAT, [VOGT, ENG1], 'core:str_t2_mex')).toBe(false);
    const p = resolveCardPage(CAT, [ENG2]);
    expect(cell(p, 'Q')).toMatchObject({ typeId: 'core:str_t2_mex', tiers: [1, 2], shownTier: 2, locked: null });
    expect(p.defaultTab).toBe(2);
  });

  it('upgrade-only tiers never appear in the build grid', () => {
    for (const b of [VOGT, ENG1, ENG2, ENG3]) {
      for (const c of resolveCardPage(CAT, [b], 3).cells) {
        if (c.typeId === null) continue;
        const u = getUnit(CAT, c.typeId);
        expect(u.id, b).not.toMatch(/str_t[23]_fac_|str_t[23]_radar|str_t3_shield/);
      }
    }
    expect(buildableBy(CAT, ENG3)).not.toContain(LAND2);
  });

  it('tab shows the highest tier ≤ tab per key and a lower one instead of a gap', () => {
    const t1 = resolveCardPage(CAT, [ENG3], 1);
    const t2 = resolveCardPage(CAT, [ENG3], 2);
    const t3 = resolveCardPage(CAT, [ENG3], 3);
    expect(t3.defaultTab).toBe(3);
    expect([cell(t1, 'Q').typeId, cell(t2, 'Q').typeId, cell(t3, 'Q').typeId]).toEqual([
      'core:str_t1_mex',
      'core:str_t2_mex',
      'core:str_t3_mex',
    ]);
    // Z has I–II: tab 3 falls back to II.
    expect(cell(t3, 'Z')).toMatchObject({ typeId: 'core:str_t2_pd', shownTier: 2 });
    // E has only I: every tab shows I.
    expect(cell(t3, 'E')).toMatchObject({ typeId: 'core:str_t1_hydro', shownTier: 1 });
    // V has II–III: tab 1 shows the lowest buildable tier (position stays, only the tier changes).
    expect(cell(t1, 'V')).toMatchObject({ typeId: 'core:str_t2_arty', shownTier: 2, locked: null });
    expect(cell(t3, 'V')).toMatchObject({ typeId: 'core:str_t3_arty', shownTier: 3 });
    // Positions never change between tabs.
    for (const p of [t1, t2, t3]) expect(p.cells.map((c) => c.kind)).toEqual(t3.cells.map((c) => c.kind));
  });

  it('tab is clamped; null/undefined selects the default tab', () => {
    expect(resolveCardPage(CAT, [ENG2], 9).tab).toBe(3);
    expect(resolveCardPage(CAT, [ENG2], 0).tab).toBe(1);
    expect(resolveCardPage(CAT, [ENG2], null).tab).toBe(2);
    expect(resolveCardPage(CAT, [ENG2]).tab).toBe(2);
    // A locked tab above the builder's reach shows the reachable tiers (no empty grid).
    expect(cell(resolveCardPage(CAT, [VOGT], 3), 'Q').typeId).toBe('core:str_t1_mex');
  });
});

describe('production page (factories)', () => {
  it('Landwerk I: T1 units, T2/T3 roles locked behind the factory upgrade, B = Upgrade to Landwerk II', () => {
    const p = resolveCardPage(CAT, [LAND1]);
    expect(p).toMatchObject({ page: 'production', menu: 'Landwerk', headTypeId: LAND1, maxTab: 3, defaultTab: 1 });
    expect(cell(p, 'Q')).toMatchObject({ typeId: 'core:lnd_t1_tank', tiers: [1], roleTiers: [1, 2], locked: null });
    expect(cell(p, 'W').typeId).toBe('core:lnd_t1_arty');
    expect(cell(p, 'E').typeId).toBe('core:lnd_t1_engineer');
    expect(cell(p, 'R').typeId).toBe('core:lnd_t1_aa');
    expect(cell(p, 'A').typeId).toBe('core:lnd_t1_scout');
    expect(cell(p, 'S').typeId).toBe('core:lnd_t1_bot');
    expect(cell(p, 'D')).toMatchObject({ typeId: 'core:lnd_t2_shield', locked: { reason: 'needFactoryUpgrade', tier: 2 } });
    expect(cell(p, 'F')).toMatchObject({ typeId: 'core:lnd_t3_sniper', locked: { reason: 'needFactoryUpgrade', tier: 3 } });
    expect(cell(p, 'B')).toMatchObject({ kind: 'upgrade', typeId: LAND2, shownTier: 2, locked: null });
  });

  it('B Upgrade follows special.upgradesTo; the top tier has no upgrade', () => {
    expect(cell(resolveCardPage(CAT, [LAND2]), 'B')).toMatchObject({ kind: 'upgrade', typeId: LAND3 });
    expect(cell(resolveCardPage(CAT, [LAND3]), 'B').kind).toBe('empty');
    expect(cell(resolveCardPage(CAT, [AIR1]), 'B')).toMatchObject({ kind: 'upgrade', typeId: AIR2 });
    expect(cell(resolveCardPage(CAT, [AIR2]), 'B').kind).toBe('empty');
  });

  it('Luftwerk I: gunship and fighter-bomber locked, no engineers', () => {
    const p = resolveCardPage(CAT, [AIR1]);
    expect(p).toMatchObject({ page: 'production', menu: 'Luftwerk', maxTab: 2, defaultTab: 1 });
    expect(cell(p, 'E')).toMatchObject({ typeId: 'core:air_t2_gunship', locked: { reason: 'needFactoryUpgrade', tier: 2 } });
    expect(cell(p, 'R')).toMatchObject({ typeId: 'core:air_t2_fbomber', locked: { reason: 'needFactoryUpgrade', tier: 2 } });
    expect(buildableBy(CAT, AIR2)).not.toContain(ENG1);
  });
});

describe('page selection', () => {
  it('empty selection → empty page, 15 empty cells', () => {
    const p = resolveCardPage(CAT, []);
    expect(p).toMatchObject({ page: 'empty', menu: null, headTypeId: null, maxTab: 0, tab: 0 });
    expect(p.cells.every((c) => c.kind === 'empty' && c.typeId === null)).toBe(true);
  });

  it('pure combat selection → orders page with empty cells (filled with orders by the card)', () => {
    const p = resolveCardPage(CAT, ['core:lnd_t1_tank', 'core:lnd_t1_arty', 'core:lnd_t1_tank']);
    expect(p.page).toBe('orders');
    expect(p.cells.every((c) => c.kind === 'empty')).toBe(true);
  });

  it('mixed selection with builders → list of the highest-ranked builder', () => {
    expect(resolveCardPage(CAT, ['core:lnd_t1_tank', ENG1]).headTypeId).toBe(ENG1);
    expect(resolveCardPage(CAT, [ENG1, ENG2, 'core:lnd_t1_bot']).headTypeId).toBe(ENG2);
    expect(headBuilder(CAT, [ENG1, VOGT])).toBe(VOGT);
    // Engineers outrank a factory of the same reach.
    expect(headBuilder(CAT, [LAND1, ENG1])).toBe(ENG1);
    // Higher reach wins.
    expect(headBuilder(CAT, [ENG1, LAND2])).toBe(LAND2);
    expect(resolveCardPage(CAT, [ENG1, ENG3]).defaultTab).toBe(3);
  });

  it('structure page: B upgrade, G ability, D pause', () => {
    const mex = resolveCardPage(CAT, ['core:str_t1_mex']);
    expect(mex).toMatchObject({ page: 'structure', headTypeId: 'core:str_t1_mex', maxTab: 0 });
    expect(cell(mex, 'B')).toMatchObject({ kind: 'upgrade', typeId: 'core:str_t2_mex', shownTier: 2 });
    expect(cell(mex, 'D').kind).toBe('pause');
    expect(cell(mex, 'G').kind).toBe('empty');
    const radar = resolveCardPage(CAT, ['core:str_t1_radar']);
    expect(cell(radar, 'B')).toMatchObject({ kind: 'upgrade', typeId: 'core:str_t2_radar' });
    expect(cell(radar, 'G')).toMatchObject({ kind: 'ability', typeId: 'core:str_t1_radar' });
    const wall = resolveCardPage(CAT, ['core:str_t1_wall']);
    expect(wall.page).toBe('structure');
    expect(wall.cells.every((c) => c.kind === 'empty')).toBe(true);
    // Mixed structures: highest tier is the head.
    expect(resolveCardPage(CAT, ['core:str_t1_mex', 'core:str_t2_mex']).headTypeId).toBe('core:str_t2_mex');
    // Structures mixed with combat units → orders.
    expect(resolveCardPage(CAT, ['core:str_t1_mex', 'core:lnd_t1_tank']).page).toBe('orders');
  });

  it('unknown and duplicate ids are ignored', () => {
    expect(resolveCardPage(CAT, ['nope', VOGT, VOGT]).headTypeId).toBe(VOGT);
    // Units the catalog does not know still get the orders page (move/attack apply to any unit).
    expect(resolveCardPage(CAT, ['nope']).page).toBe('orders');
    expect(resolveCardPage(CAT, []).page).toBe('empty');
  });

  it('builder menus', () => {
    expect(builderMenu(CAT, VOGT)).toBe('Bau');
    expect(builderMenu(CAT, ENG2)).toBe('Bau');
    expect(builderMenu(CAT, LAND1)).toBe('Landwerk');
    expect(builderMenu(CAT, AIR1)).toBe('Luftwerk');
    expect(builderMenu(CAT, 'core:lnd_t1_tank')).toBeNull();
    expect(builderMenu(CAT, 'core:exp_lnd_foundry')).toBeNull();
  });
});

describe('hotbuild cycle (roster.json hotbuildGrid.rule)', () => {
  it('cycles only through tiers of the same role, highest first, wrapping', () => {
    const q = slotCodeOf('Q');
    const s1 = nextHotbuildTier(CAT, q, null, [ENG3]);
    expect(s1).toEqual({ tier: 3, typeId: 'core:str_t3_mex' });
    const s2 = nextHotbuildTier(CAT, q, s1!.tier, [ENG3]);
    expect(s2).toEqual({ tier: 2, typeId: 'core:str_t2_mex' });
    const s3 = nextHotbuildTier(CAT, q, s2!.tier, [ENG3]);
    expect(s3).toEqual({ tier: 1, typeId: 'core:str_t1_mex' });
    expect(nextHotbuildTier(CAT, q, s3!.tier, [ENG3])).toEqual({ tier: 3, typeId: 'core:str_t3_mex' });
  });

  it('never changes the type: the role on the key stays (X = Rost/Hochrost)', () => {
    const x = slotCodeOf('X');
    const seen: string[] = [];
    let tier: number | null = null;
    for (let i = 0; i < 6; i++) {
      const s: HotbuildStep = nextHotbuildTier(CAT, x, tier, [ENG3])!;
      seen.push(s.typeId);
      tier = s.tier;
    }
    expect(seen).toEqual([
      'core:str_t3_sam',
      'core:str_t2_aa',
      'core:str_t1_aa',
      'core:str_t3_sam',
      'core:str_t2_aa',
      'core:str_t1_aa',
    ]);
  });

  it('single-tier roles stay; unbuildable roles return null', () => {
    expect(nextHotbuildTier(CAT, slotCodeOf('E'), 1, [ENG3])).toEqual({ tier: 1, typeId: 'core:str_t1_hydro' });
    expect(nextHotbuildTier(CAT, slotCodeOf('F'), null, [VOGT])).toBeNull();
    expect(nextHotbuildTier(CAT, slotCodeOf('G'), null, [VOGT])).toBeNull();
    expect(nextHotbuildTier(CAT, slotCodeOf('Q'), null, ['core:lnd_t1_tank'])).toBeNull();
  });

  it('factories cycle their production tiers', () => {
    const w = slotCodeOf('W');
    expect(nextHotbuildTier(CAT, w, null, [LAND3])).toEqual({ tier: 3, typeId: 'core:lnd_t3_arty' });
    expect(nextHotbuildTier(CAT, w, 3, [LAND3])).toEqual({ tier: 2, typeId: 'core:lnd_t2_mml' });
    expect(nextHotbuildTier(CAT, w, null, [LAND1])).toEqual({ tier: 1, typeId: 'core:lnd_t1_arty' });
  });

  it('KeyZ is the roster slot Z (Riegel)', () => {
    expect(rosterSlot('KeyZ')).toBe('Z');
    expect(slotCodeOf('Z')).toBe('KeyZ');
    expect(cell(resolveCardPage(CAT, [VOGT]), 'Z').typeId).toBe('core:str_t1_pd');
  });
});
