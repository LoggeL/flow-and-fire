// @vitest-environment happy-dom
import { describe, expect, test } from 'vitest';
import {
  MULTI_MAX_GROUPS,
  MULTI_MAX_UNITS,
  mvpUnits,
  SelectionGroups,
  SelectionMulti,
  SelectionPanel,
  SelectionSummary,
  SelectionUnits,
  aggregateMultiStats,
  applySelectionDemo,
  createHudModel,
  demoArmySelection,
  demoEdgeSelection,
  fmtPct,
  iconMaskClass,
} from '../../src/index.ts';
import type { HudModel, MultiSelectionData, TypeCount } from '../../src/index.ts';
import { fireEvent, flushSignals, lastCall, renderWithHud, screen } from '../support/index.tsx';
import { countNodes, countRenders, watchMutations } from './helpers.ts';
import { demoUnitCatalog } from '../../src/demo/catalog.ts';

const CAT = demoUnitCatalog();

function renderArmy(scenario: 'army' | 'armyFocus' | 'edge' = 'army') {
  const model = createHudModel({ units: CAT });
  applySelectionDemo(model, scenario);
  return renderWithHud(<SelectionPanel />, { model });
}

const tiles = (): HTMLElement[] => screen.getAllByTestId('selection-tile');
const units = (): HTMLElement[] => screen.getAllByTestId('selection-unit');

describe('SelectionGroups (type tiles)', () => {
  test('tile = button + svg/use + count + damaged count (5 nodes), HP and vet as CSS variables', () => {
    renderArmy();
    const t0 = tiles()[0]!;
    expect(t0.tagName).toBe('BUTTON');
    expect(countNodes(t0)).toBe(5);
    expect(t0.getAttribute('data-type')).toBe('core:lnd_t1_tank');
    expect(t0.querySelector('.tile__n')?.textContent).toBe('×9');
    // 9 tanks, hp [1,1,1,.35,1,1,1,.6,.2] → 2 below 50 %, average 0.794, highest vet 2.
    expect(t0.querySelector('.tile__dmg')?.textContent).toBe('2 <50 %');
    expect(Number(t0.style.getPropertyValue('--v'))).toBeCloseTo(7.15 / 9, 5);
    expect(t0.style.getPropertyValue('--vet')).toBe('2');
    expect(t0.classList.contains('is-warn')).toBe(false);
    // Undamaged types show no damaged count.
    expect(tiles()[2]!.querySelector('.tile__dmg')?.textContent).toBe('');
    expect(t0.title).toBe('Punze ×9 · Klick: nur diese · Umschalt+Klick: entfernen · Strg+Klick: nur beschädigte');
  });

  test('focus type is marked (is-focus + aria-current), Tab focus moves without re-render', async () => {
    const { model } = renderArmy('armyFocus');
    expect(tiles()[2]!.classList.contains('is-focus')).toBe(true);
    expect(tiles()[2]!.getAttribute('aria-current')).toBe('true');
    expect(tiles()[0]!.classList.contains('is-focus')).toBe(false);
    const counter = countRenders([SelectionGroups]);
    await flushSignals(() => {
      model.selection.focusTypeId.value = 'core:lnd_t1_aa';
    });
    counter.restore();
    expect(counter.count(SelectionGroups)).toBe(0);
    expect(tiles()[3]!.classList.contains('is-focus')).toBe(true);
    expect(tiles()[2]!.classList.contains('is-focus')).toBe(false);
    expect(tiles()[2]!.hasAttribute('aria-current')).toBe(false);
  });

  test('click = selectType, Shift = deselectType, Ctrl/⌘ = selectDamagedOfType', () => {
    const { log } = renderArmy();
    const arty = tiles()[2]!;
    fireEvent.click(arty);
    expect(lastCall(log, 'selectType')?.args).toEqual(['core:lnd_t1_arty']);
    fireEvent.click(arty, { shiftKey: true });
    expect(lastCall(log, 'deselectType')?.args).toEqual(['core:lnd_t1_arty']);
    fireEvent.click(arty, { ctrlKey: true });
    expect(lastCall(log, 'selectDamagedOfType')?.args).toEqual(['core:lnd_t1_arty']);
    fireEvent.click(tiles()[0]!, { metaKey: true });
    expect(lastCall(log, 'selectDamagedOfType')?.args).toEqual(['core:lnd_t1_tank']);
    // A click on the icon inside the tile is delegated to the tile.
    fireEvent.click(tiles()[1]!.querySelector('svg')!);
    expect(lastCall(log, 'selectType')?.args).toEqual(['core:lnd_t1_bot']);
    expect(log.map((c) => c.name)).toEqual(['selectType', 'deselectType', 'selectDamagedOfType', 'selectDamagedOfType', 'selectType']);
  });

  test('right click on a tile never opens the browser menu and issues no command', () => {
    const { log } = renderArmy();
    const notCancelled = fireEvent.contextMenu(tiles()[0]!, { button: 2 });
    expect(notCancelled).toBe(false);
    expect(log).toHaveLength(0);
  });

  test('macOS Ctrl+click (contextmenu with button 0) = only damaged of this type', () => {
    const { log } = renderArmy();
    expect(fireEvent.contextMenu(tiles()[0]!, { button: 0, ctrlKey: true })).toBe(false);
    expect(lastCall(log, 'selectDamagedOfType')?.args).toEqual(['core:lnd_t1_tank']);
  });

  test('more types than slots: capacity − 1 tiles plus "+N"', () => {
    const model = createHudModel({ units: CAT });
    // 30 distinct types > 24 slots.
    const groups: TypeCount[] = mvpUnits(CAT).slice(1, 31).map((u) => ({ typeId: u.id, count: 3 }));
    const multi: MultiSelectionData = { groups, units: [], total: 90 };
    model.selection.kind.value = 'multi';
    model.selection.multi.value = multi;
    renderWithHud(<SelectionPanel />, { model });
    expect(tiles()).toHaveLength(MULTI_MAX_GROUPS - 1);
    const more = screen.getByTestId('selection-tile-more');
    expect(more.textContent).toBe('+7');
    expect(more.getAttribute('aria-label')).toBe('7 weitere Typen');
    // Over 60 units: no single units, a hint instead.
    expect(screen.queryAllByTestId('selection-unit')).toHaveLength(0);
    expect(screen.getByTestId('selection-units-hidden').textContent).toContain('60');
  });
});

describe('SelectionUnits (single units)', () => {
  test('exactly one <button> per unit, icon as CSS mask class, HP as --v, warn/crit as class', () => {
    renderArmy();
    const list = units();
    expect(list).toHaveLength(19);
    for (const u of list) {
      expect(u.tagName).toBe('BUTTON');
      expect(u.children).toHaveLength(0);
    }
    // Units come in type order: 9 tanks first (3 → 0.35 warn, 7 → 0.6 ok, 8 → 0.2 crit).
    expect(list[0]!.classList.contains(iconMaskClass('land_direct_t1'))).toBe(true);
    expect(list[9]!.classList.contains(iconMaskClass('land_bot_t1'))).toBe(true);
    expect(list[3]!.style.getPropertyValue('--v')).toBe(String(Math.fround(0.35)));
    expect(list[3]!.classList.contains('is-warn')).toBe(true);
    expect(list[7]!.classList.contains('is-warn')).toBe(false);
    expect(list[8]!.classList.contains('is-crit')).toBe(true);
    expect(list[0]!.title).toBe('Punze · Klick: nur diese Einheit · Umschalt+Klick: abwählen');
  });

  test('click → selectUnit(handle, mods) with Shift/Ctrl; right click → button 2 without browser menu', () => {
    const { log } = renderArmy();
    const u = units()[4]!;
    const handle = Number(u.getAttribute('data-handle'));
    fireEvent.click(u);
    expect(lastCall(log, 'selectUnit')?.args).toEqual([handle, { shift: false, ctrl: false, alt: false, button: 0 }]);
    fireEvent.click(u, { shiftKey: true });
    expect(lastCall(log, 'selectUnit')?.args).toEqual([handle, { shift: true, ctrl: false, alt: false, button: 0 }]);
    fireEvent.click(u, { ctrlKey: true, altKey: true });
    expect(lastCall(log, 'selectUnit')?.args).toEqual([handle, { shift: false, ctrl: true, alt: true, button: 0 }]);
    expect(fireEvent.contextMenu(u, { button: 2, shiftKey: true })).toBe(false);
    expect(lastCall(log, 'selectUnit')?.args).toEqual([handle, { shift: true, ctrl: false, alt: false, button: 2 }]);
    expect(log).toHaveLength(4);
  });

  test('clicks on the gaps between units do nothing', () => {
    const { log } = renderArmy();
    fireEvent.click(screen.getByTestId('selection-units'));
    fireEvent.contextMenu(screen.getByTestId('selection-units'));
    expect(log).toHaveLength(0);
  });
});

describe('4 Hz updates without re-render', () => {
  function refill(model: HudModel, step: number): void {
    const demo = model.selection.multi.peek()!;
    const samples = demoArmySelection().samples.map((s, i) => ({ ...s, hp: ((i * 13 + step * 29) % 100) / 100, vet: (i + step) % 4 }));
    model.selection.multiStats.value = aggregateMultiStats(demo.groups, demo.units.length, samples, model.selection.multiStats.peek() ?? undefined);
  }

  test('multiStats changes write CSS variables/classes/text only – no component render, no childList mutation', async () => {
    const { model } = renderArmy();
    const panel = screen.getByTestId('selection-panel');
    const counter = countRenders([SelectionPanel, SelectionMulti, SelectionGroups, SelectionUnits, SelectionSummary]);
    const watch = watchMutations(panel);
    for (let step = 1; step <= 8; step++) await flushSignals(() => refill(model, step));
    counter.restore();
    watch.stop();
    expect(counter.total()).toBe(0);
    const records = watch.records();
    expect(records.length).toBeGreaterThan(0);
    const structural = records.filter((r) => r.type === 'childList' && (r.target as Element).nodeType === 1 && !(r.target as Element).classList.contains('tile__dmg'));
    // Only text changes: the damaged count (textContent) and the summary text bindings.
    for (const r of structural) {
      for (const n of [...r.addedNodes, ...r.removedNodes]) expect(n.nodeType).toBe(3);
    }
    const attrs = new Set(records.filter((r) => r.type === 'attributes').map((r) => r.attributeName));
    for (const a of attrs) expect(['style', 'class', 'aria-current']).toContain(a);
    // Values after the last step are visible.
    const st = model.selection.multiStats.peek()!;
    expect(Number(units()[5]!.style.getPropertyValue('--v'))).toBeCloseTo(st.unitHp[5]!, 5);
    expect(Number(tiles()[1]!.style.getPropertyValue('--v'))).toBeCloseTo(st.groupHp[1]!, 5);
    expect(screen.getByTestId('sum-hp').textContent).toBe(fmtPct(st.avgHpPct / 100));
  });

  test('a new selection (multi) re-renders the structure once', async () => {
    const { model } = renderArmy();
    const counter = countRenders([SelectionGroups, SelectionUnits]);
    await flushSignals(() => {
      const edge = demoEdgeSelection();
      model.selection.multi.value = edge.multi;
      model.selection.multiStats.value = edge.stats;
    });
    counter.restore();
    expect(counter.count(SelectionGroups)).toBe(1);
    expect(counter.count(SelectionUnits)).toBe(1);
    expect(tiles()).toHaveLength(24);
    expect(units()).toHaveLength(60);
  });
});

describe('update cost (measurement, not a gate – DECISIONS 5/16)', () => {
  test('edge case: one 4 Hz multiStats update (aggregation of 500 samples + DOM writes) in happy-dom', async () => {
    const { model } = renderArmy('edge');
    const edge = demoEdgeSelection();
    const samples = [];
    for (let i = 0; i < 500; i++) samples.push({ ...edge.samples[i % 60]!, hp: (i % 89) / 89 });
    const multi = model.selection.multi.peek()!;
    const runs = 40;
    let total = 0;
    for (let r = 0; r < runs; r++) {
      const moved = samples.map((s, i) => ({ ...s, hp: ((i * 7 + r * 13) % 100) / 100 }));
      const t0 = performance.now();
      model.selection.multiStats.value = aggregateMultiStats(multi.groups, multi.units.length, moved, model.selection.multiStats.peek() ?? undefined);
      total += performance.now() - t0;
    }
    const per = total / runs;
    console.info(`[hud-p3] 4 Hz update, 60 units + 24 tiles + totals (happy-dom): ${per.toFixed(3)} ms`);
    // happy-dom is far slower than a browser; this only guards against pathological regressions.
    expect(per).toBeLessThan(20);
    await flushSignals();
  });
});

describe('DOM budget (ui.md §9.2)', () => {
  test('edge case 60 units + 24 types: panel ≤ 210 nodes, every unit one node, every tile five', () => {
    renderArmy('edge');
    expect(tiles()).toHaveLength(MULTI_MAX_GROUPS);
    expect(units()).toHaveLength(MULTI_MAX_UNITS);
    for (const t of tiles()) expect(countNodes(t)).toBe(5);
    for (const u of units()) expect(countNodes(u)).toBe(1);
    const nodes = countNodes(screen.getByTestId('selection-panel'));
    expect(nodes).toBeLessThanOrEqual(210);
    // 24 × 5 + 60 × 1 = 180 leaves; frame, head and totals stay small.
    expect(nodes).toBeGreaterThanOrEqual(180);
  });

  test('army view (19 units, 5 types) stays far below the budget', () => {
    renderArmy();
    expect(countNodes(screen.getByTestId('selection-panel'))).toBeLessThan(80);
  });
});
