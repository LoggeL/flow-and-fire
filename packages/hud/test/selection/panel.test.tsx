// @vitest-environment happy-dom
import { describe, expect, test } from 'vitest';
import { SelectionPanel, applySelectionDemo, createHudModel, setLocale } from '../../src/index.ts';
import { flushSignals, renderWithHud, screen, within } from '../support/index.tsx';
import { demoUnitCatalog } from '../../src/demo/catalog.ts';

const CAT = demoUnitCatalog();

function renderScenario(scenario: Parameters<typeof applySelectionDemo>[1]) {
  const model = createHudModel({ units: CAT });
  applySelectionDemo(model, scenario);
  return renderWithHud(<SelectionPanel />, { model });
}

const head = (): string => screen.getByTestId('selection-head').textContent ?? '';

describe('SelectionPanel – kinds', () => {
  test('empty: short help with key caps (H, ".", Strg+A) and head "leer"', () => {
    renderScenario('none');
    const panel = screen.getByTestId('selection-panel');
    expect(panel.getAttribute('data-component')).toBe('SelectionPanel');
    expect(panel.getAttribute('data-panel')).toBe('selection');
    expect(panel.classList.contains('ff-panel')).toBe(true);
    expect(head()).toBe('Auswahl' + 'leer');
    const empty = screen.getByTestId('selection-empty');
    expect(empty.textContent).toContain('Nichts ausgewählt');
    expect(empty.textContent).toContain('Klick / Rahmen ziehen');
    const keys = within(empty)
      .getAllByTestId('key')
      .map((k) => k.textContent);
    expect(keys).toEqual(['H', '.', 'Strg', 'A']);
  });

  test('single: commander with portrait CMD, vet, HP, vet mass, tap shot, stats, order chain, house label', () => {
    renderScenario('commander');
    expect(head()).toBe('Auswahl · 1 Einheit' + 'Haus Ambrecht');
    expect(screen.getByTestId('unit-detail').getAttribute('data-kind')).toBe('single');
    expect(screen.getByTestId('portrait-tech').textContent).toBe('CMD');
    expect(screen.getByTestId('portrait-vet').getAttribute('data-level')).toBe('1');
    expect(screen.getByTestId('unit-name').textContent).toBe('Vogt');
    expect(screen.getByTestId('unit-role').textContent).toBe('Kommandant · Tod = Niederlage');
    expect(screen.getByTestId('meter-hp-text').textContent).toBe('10.320 / 12.000');
    expect(screen.getByTestId('meter-vet-text').textContent).toBe('420 / 1.000 M');
    expect(screen.getByTestId('meter-tapshot-text').textContent).toBe('2.840 / 7.500 E');
    expect(screen.queryByTestId('meter-shield')).toBeNull();
    const stats = screen.getByTestId('unit-stats').textContent ?? '';
    for (const part of ['DPS 100', 'RW 22', 'Tempo 1,7', 'Sicht 26', 'BP 10', 'Regen 10/s']) expect(stats).toContain(part);
    expect(screen.getByTestId('order-queue')).toBeTruthy();
  });

  test('single damaged tank: T1, critical hatched HP bar below 30 %, group head, no BP/regen/tap shot', () => {
    renderScenario('tankDamaged');
    expect(head()).toBe('Auswahl · 1 Einheit' + 'Gruppe 2');
    expect(screen.getByTestId('portrait-tech').textContent).toBe('T1');
    const bar = screen.getByTestId('meter-hp-bar');
    expect(bar.classList.contains('is-crit')).toBe(true);
    expect(screen.getByTestId('meter-hp-text').textContent).toBe('81 / 300');
    expect(screen.queryByTestId('meter-tapshot')).toBeNull();
    const stats = screen.getByTestId('unit-stats').textContent ?? '';
    expect(stats).not.toContain('BP');
    expect(stats).not.toContain('Regen');
  });

  test('HP level classes follow ui.md §3.7 (warn < 55 %, crit < 30 %)', async () => {
    const { model } = renderScenario('tankDamaged');
    const bar = screen.getByTestId('meter-hp-bar');
    await flushSignals(() => {
      model.selection.single.value = { ...model.selection.single.peek()!, hp: 150 };
    });
    expect(bar.classList.contains('is-warn')).toBe(true);
    expect(bar.classList.contains('is-crit')).toBe(false);
    await flushSignals(() => {
      model.selection.single.value = { ...model.selection.single.peek()!, hp: 300 };
    });
    expect(bar.classList.contains('is-warn')).toBe(false);
    expect(bar.classList.contains('is-crit')).toBe(false);
  });

  test('shield row appears for units with a shield (K10)', () => {
    const model = createHudModel({ units: CAT });
    applySelectionDemo(model, 'tankDamaged');
    model.selection.single.value = { ...model.selection.single.peek()!, shield: { hp: 1600, hpMax: 3200 } };
    renderWithHud(<SelectionPanel />, { model });
    expect(screen.getByTestId('meter-shield-text').textContent).toBe('1.600 / 3.200');
    expect(screen.getByTestId('meter-shield-bar').classList.contains('ff-bar--shield')).toBe(true);
  });

  test('multi: head "N Einheiten · M Typen", tiles, units, totals, group', () => {
    renderScenario('army');
    expect(head()).toBe('Auswahl · 19 Einheiten · 5 Typen' + 'Gruppe 1');
    expect(screen.getAllByTestId('selection-tile')).toHaveLength(5);
    expect(screen.getAllByTestId('selection-unit')).toHaveLength(19);
    expect(screen.getByTestId('sum-dps').textContent).toBe('393');
    expect(screen.getByTestId('sum-mass').textContent).toBe('894');
    expect(screen.getByTestId('sum-speed').textContent).toBe('1,9');
    expect(screen.getByTestId('selection-summary').textContent).toContain('Typ wechseln');
  });

  test('factory: head with the factory name, detail and queue', () => {
    renderScenario('factory');
    expect(head()).toBe('Auswahl · Landwerk I' + 'Gruppe 3');
    expect(screen.getByTestId('factory-detail').getAttribute('data-kind')).toBe('factory');
    expect(screen.getByTestId('factory-queue').getAttribute('data-state')).toBe('running');
  });

  test('switching the kind rebuilds the body; clearing returns to the help', async () => {
    const { model } = renderScenario('army');
    await flushSignals(() => applySelectionDemo(model, 'factory'));
    expect(screen.queryByTestId('selection-multi')).toBeNull();
    expect(screen.getByTestId('factory-detail')).toBeTruthy();
    await flushSignals(() => applySelectionDemo(model, 'none'));
    expect(screen.getByTestId('selection-empty')).toBeTruthy();
    await flushSignals(() => {
      model.selection.kind.value = 'single';
    });
    // kind "single" without data shows the help instead of failing.
    expect(screen.getByTestId('selection-empty')).toBeTruthy();
  });

  test('control group 10 is labelled with key 0', async () => {
    const { model } = renderScenario('army');
    await flushSignals(() => {
      model.selection.controlGroup.value = 10;
    });
    expect(head()).toContain('Gruppe 0');
  });
});

describe('SelectionPanel – English', () => {
  test('texts, plurals and key caps in EN', () => {
    setLocale('en');
    const model = createHudModel({ units: CAT });
    model.keyboardLayout.value = 'en';
    applySelectionDemo(model, 'army');
    renderWithHud(<SelectionPanel />, { model, locale: 'en' });
    expect(head()).toBe('Selection · 19 units · 5 types' + 'Group 1');
    expect(screen.getByTestId('selection-summary').textContent).toContain('(slowest)');
    expect(screen.getByTestId('sum-mass').textContent).toBe('894');
  });

  test('EN factory detail, queue controls and empty help', async () => {
    const model = createHudModel({ units: CAT });
    model.keyboardLayout.value = 'en';
    applySelectionDemo(model, 'factory');
    renderWithHud(<SelectionPanel />, { model, locale: 'en' });
    expect(head()).toBe('Selection · Land Works I' + 'Group 3');
    expect(screen.getByTestId('factory-helpers').textContent).toContain('(Prentice ×3, assist)');
    expect(screen.getByTestId('factory-adjacency').textContent).toBe('−9% E');
    expect(screen.getByTestId('factory-repeat').textContent).toBe('Repeat');
    expect(screen.getByTestId('factory-now-sub').textContent).toBe(' · 3.1 s left');
    await flushSignals(() => applySelectionDemo(model, 'none'));
    const keys = within(screen.getByTestId('selection-empty'))
      .getAllByTestId('key')
      .map((k) => k.textContent);
    expect(keys).toEqual(['H', '.', 'Ctrl', 'A']);
    expect(screen.getByTestId('selection-empty').textContent).toContain('Nothing selected');
  });

  test('switching the locale re-renders the texts', async () => {
    const model = createHudModel({ units: CAT });
    applySelectionDemo(model, 'commander');
    renderWithHud(<SelectionPanel />, { model });
    expect(screen.getByTestId('unit-role').textContent).toContain('Tod = Niederlage');
    await flushSignals(() => setLocale('en'));
    expect(screen.getByTestId('unit-name').textContent).toBe('Reeve');
    expect(screen.getByTestId('unit-role').textContent).toContain('death = defeat');
    expect(head()).toBe('Selection · 1 unit' + 'Haus Ambrecht');
  });
});
