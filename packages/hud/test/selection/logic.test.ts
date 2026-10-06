import { describe, expect, test } from 'vitest';
import {
  MULTI_MAX_GROUPS,
  MULTI_MAX_UNITS,
  SELECTION_DEMO_SCENARIOS,
  aggregateMultiStats,
  applySelectionDemo,
  createHudModel,
  demoArmySelection,
  demoCommanderDetail,
  demoEdgeSelection,
  demoFactoryRemainingS,
  demoLandFactoryDetail,
  orderChainLabel,
  orderChainValue,
  singleStructureKey,
  tickSelectionDemo,
} from '../../src/index.ts';
import { TILE_GEOMETRY, UNIT_GEOMETRY, gridCapacity } from '../../src/hud/selection/capacity.ts';
import { pointerMods } from '../../src/hud/selection/events.ts';
import {
  adjacencyText,
  bpParts,
  headGroup,
  helpersText,
  rallyText,
  remainingText,
  tapshotText,
  techLabel,
  vetText,
} from '../../src/hud/selection/labels.ts';
import { demoUnitCatalog } from '../../src/demo/catalog.ts';

const CAT = demoUnitCatalog();

describe('gridCapacity (fixed slots, ui.md §4.4)', () => {
  test('unmeasured boxes fall back to the maximum', () => {
    expect(gridCapacity(null, UNIT_GEOMETRY, 16, MULTI_MAX_UNITS)).toBe(60);
    expect(gridCapacity({ width: 0, height: 100 }, UNIT_GEOMETRY, 16, MULTI_MAX_UNITS)).toBe(60);
  });

  test('1080p middle column: one row of 18 tiles, one row of 37 units', () => {
    // 1356 − 2 × 12 padding = 1332 px content width.
    expect(gridCapacity({ width: 1332, height: 76 }, TILE_GEOMETRY, 16, MULTI_MAX_GROUPS, 1)).toBe(18);
    expect(gridCapacity({ width: 1332, height: 66 }, UNIT_GEOMETRY, 16, MULTI_MAX_UNITS)).toBe(37);
    // Two rows fit from 78 px (2 × 38 + 2).
    expect(gridCapacity({ width: 1332, height: 78 }, UNIT_GEOMETRY, 16, MULTI_MAX_UNITS)).toBe(60);
    // Scale 1.25: cells grow with rem.
    expect(gridCapacity({ width: 1332, height: 76 }, TILE_GEOMETRY, 20, MULTI_MAX_GROUPS, 1)).toBe(14);
  });

  test('never below one slot', () => {
    expect(gridCapacity({ width: 10, height: 10 }, TILE_GEOMETRY, 16, 24, 1)).toBe(1);
  });
});

describe('labels', () => {
  test('tech labels CMD / T1–T3 / EXP', () => {
    expect(techLabel(CAT, 'core:cmd_commander', 'de')).toBe('CMD');
    expect(techLabel(CAT, 'core:lnd_t2_tank', 'de')).toBe('T2');
    expect(techLabel(CAT, 'core:exp_lnd_walker', 'de')).toBe('EXP');
  });

  test('order labels and values', () => {
    const c = demoCommanderDetail();
    expect(orderChainLabel(CAT, c.orders[0]!, 'de')).toBe('Glutkessel I');
    expect(orderChainLabel(CAT, c.orders[4]!, 'de')).toBe('Reclaim · 3 Wracks');
    expect(orderChainLabel(CAT, c.orders[4]!, 'en')).toBe('Reclaim · 3 wrecks');
    expect(orderChainLabel(CAT, { kind: 'reclaim', targets: 1, x: 0, z: 0 }, 'de')).toBe('Reclaim · 1 Wrack');
    expect(orderChainLabel(CAT, { kind: 'assist', typeId: 'core:str_t1_fac_land', x: 0, z: 0 }, 'de')).toBe('Assist · Landwerk I');
    expect(orderChainLabel(CAT, { kind: 'patrol', x: 0, z: 0 }, 'en')).toBe('Patrol');
    expect(orderChainValue(c.orders[4]!, 'de')).toBe('86 M');
    expect(orderChainValue(c.orders[0]!, 'en')).toBe('64%');
    expect(orderChainValue({ kind: 'move', x: 0, z: 0 }, 'de')).toBe('');
    // Unknown types never throw in the HUD.
    expect(orderChainLabel(CAT, { kind: 'build', typeId: 'core:nope', x: 0, z: 0 }, 'de')).toBe('core:nope');
  });

  test('vet, tap shot, factory texts', () => {
    expect(vetText({ level: 1, progress: 0.42, mass: 420, massNext: 1000 }, 5, 'de')).toBe('420 / 1.000 M');
    expect(vetText({ level: 2, progress: 0.5 }, 5, 'en')).toBe('50%');
    expect(vetText({ level: 5, progress: 1 }, 5, 'de')).toBe('Höchste Stufe');
    expect(tapshotText({ stored: 2840, threshold: 7500 }, 'de')).toBe('2.840 / 7.500 E');
    expect(tapshotText({ stored: 7500, threshold: 7500 }, 'en')).toBe('ready · 7,500 E');
    expect(bpParts({ bpOwn: 20, bpAssist: 15 }, 'de')).toEqual({ sum: '20 + 15 = ', total: '35' });
    expect(bpParts({ bpOwn: 40, bpAssist: 0 }, 'de')).toEqual({ sum: '', total: '40' });
    expect(helpersText(CAT, demoLandFactoryDetail().helpers, 'de')).toBe('(Lehrling ×3, Assist)');
    expect(helpersText(CAT, [], 'en')).toBe('(none)');
    expect(adjacencyText(9, 'de')).toBe('−9 % E');
    expect(adjacencyText(0, 'de')).toBe('keine');
    expect(rallyText('unit', 'de')).toBe('auf Einheit (Assist)');
    expect(remainingText(3.09, 'de')).toBe('noch 3,1 s');
    expect(remainingText(Number.POSITIVE_INFINITY, 'en')).toBe('0.0 s left');
    expect(headGroup(3, 'Haus', 'de')).toBe('Gruppe 3');
    expect(headGroup(null, 'Haus Ambrecht', 'de')).toBe('Haus Ambrecht');
    expect(headGroup(null, null, 'de')).toBe('');
  });
});

describe('pointerMods', () => {
  const ev = (type: string, button: number, extra: Partial<MouseEvent> = {}): MouseEvent =>
    ({ type, button, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...extra }) as MouseEvent;
  test('click, right click, macOS Ctrl+click', () => {
    expect(pointerMods(ev('click', 0, { shiftKey: true }))).toEqual({ shift: true, ctrl: false, alt: false, button: 0 });
    expect(pointerMods(ev('contextmenu', 2))).toEqual({ shift: false, ctrl: false, alt: false, button: 2 });
    expect(pointerMods(ev('contextmenu', 0, { ctrlKey: true }))).toEqual({ shift: false, ctrl: true, alt: false, button: 0 });
    expect(pointerMods(ev('click', 0, { metaKey: true })).ctrl).toBe(true);
  });
});

describe('demo data', () => {
  test('mockup numbers: army 19 units / 5 types, edge case 60 / 24, factory remaining 3.1 s', () => {
    const army = demoArmySelection();
    expect(army.multi.total).toBe(19);
    expect(army.multi.groups).toHaveLength(5);
    expect(army.stats.groupDamaged[0]).toBe(2);
    const edge = demoEdgeSelection();
    expect(edge.multi.total).toBe(60);
    expect(edge.multi.units).toHaveLength(60);
    expect(edge.multi.groups).toHaveLength(24);
    expect(new Set(edge.multi.groups.map((g) => g.typeId)).size).toBe(24);
    expect(demoFactoryRemainingS('core:lnd_t1_tank', 35, 0.64)).toBeCloseTo(3.0857, 3);
    expect(demoCommanderDetail().orders).toHaveLength(5);
  });

  test('deterministic: two builds are identical', () => {
    expect(JSON.stringify(demoEdgeSelection().samples)).toBe(JSON.stringify(demoEdgeSelection().samples));
    expect([...demoEdgeSelection().stats.unitHp]).toEqual([...demoEdgeSelection().stats.unitHp]);
  });

  test('every scenario applies cleanly and sets a consistent kind', () => {
    const model = createHudModel({ units: CAT });
    for (const s of SELECTION_DEMO_SCENARIOS) {
      applySelectionDemo(model, s);
      const kind = model.selection.kind.peek();
      if (kind === 'single') expect(model.selection.single.peek()).not.toBeNull();
      if (kind === 'multi') expect(model.selection.multiStats.peek()).not.toBeNull();
      if (kind === 'factory') expect(model.factory.queue.peek()).not.toBeNull();
      if (s === 'none') expect(kind).toBe('none');
      // Leftovers of the previous scenario are cleared.
      if (kind !== 'multi') expect(model.selection.multi.peek()).toBeNull();
      if (kind !== 'factory') expect(model.factory.detail.peek()).toBeNull();
    }
  });

  test('tickSelectionDemo changes hot values only (structure keys and multi stay)', () => {
    const model = createHudModel({ units: CAT });
    applySelectionDemo(model, 'commander');
    const key = singleStructureKey(model.selection.single.peek());
    tickSelectionDemo(model, 7);
    expect(singleStructureKey(model.selection.single.peek())).toBe(key);
    expect(model.selection.single.peek()!.orders[0]!.progress).toBeCloseTo(7 / 40, 6);

    applySelectionDemo(model, 'edge');
    const multi = model.selection.multi.peek();
    const stats = model.selection.multiStats.peek()!;
    const samples = demoEdgeSelection().samples;
    tickSelectionDemo(model, 3, samples);
    expect(model.selection.multi.peek()).toBe(multi);
    const next = model.selection.multiStats.peek()!;
    expect(next).not.toBe(stats);
    // Arrays are refilled in place (no allocation at 4 Hz).
    expect(next.unitHp).toBe(stats.unitHp);

    applySelectionDemo(model, 'factory');
    tickSelectionDemo(model, 10);
    expect(model.factory.progress.peek()).toBeCloseTo(0.25, 6);
  });
});

describe('aggregation cost (measurement, not a gate – DECISIONS 5/16)', () => {
  test('500 units: 4 Hz aggregation stays well below the 1 ms HUD budget on the dev machine', () => {
    const edge = demoEdgeSelection();
    const samples = [];
    for (let i = 0; i < 500; i++) samples.push({ ...edge.samples[i % edge.samples.length]!, hp: (i % 97) / 97 });
    let stats = aggregateMultiStats(edge.multi.groups, edge.multi.units.length, samples);
    const runs = 200;
    const t0 = performance.now();
    for (let r = 0; r < runs; r++) stats = aggregateMultiStats(edge.multi.groups, edge.multi.units.length, samples, stats);
    const perRun = (performance.now() - t0) / runs;
    console.info(`[hud-p3] aggregateMultiStats 500 units / 24 types: ${(perRun * 1000).toFixed(1)} µs per 4 Hz update`);
    expect(perRun).toBeLessThan(5);
  });
});
