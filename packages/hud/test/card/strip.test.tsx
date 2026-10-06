// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { applyStripDemo } from '../../src/demo/card.ts';
import { ControlGroups } from '../../src/hud/strip/ControlGroups.tsx';
import { IdleButton } from '../../src/hud/strip/IdleButton.tsx';
import { SelectionFilter } from '../../src/hud/strip/SelectionFilter.tsx';
import { Strip } from '../../src/hud/strip/Strip.tsx';
import { createHudModel } from '../../src/model/index.ts';
import type { HudModel } from '../../src/model/index.ts';
import { fireEvent, flushSignals, lastCall, renderWithHud } from '../support/index.tsx';
import { demoUnitCatalog } from '../../src/demo/catalog.ts';

const CAT = demoUnitCatalog();

function stripModel(opts: Parameters<typeof applyStripDemo>[1] = {}): HudModel {
  const m = createHudModel({ units: CAT });
  applyStripDemo(m, opts);
  return m;
}

describe('SelectionFilter (ui.md §5.9)', () => {
  it('four 34-px filters F2/F3/F4/F6 in order, labels with key and Shift hint', () => {
    const { container } = renderWithHud(<SelectionFilter withIdle={false} />);
    const buttons = container.querySelectorAll<HTMLElement>('[data-filter]');
    expect(Array.from(buttons).map((b) => b.getAttribute('data-filter'))).toEqual(['land', 'air', 'factories', 'engineers']);
    expect(Array.from(buttons).map((b) => b.querySelector('.ff-order__key')?.textContent)).toEqual(['F2', 'F3', 'F4', 'F6']);
    expect(buttons[0]?.getAttribute('aria-label')).toBe('Alle Landeinheiten (F2) · ⇧ = aktuelle Auswahl filtern');
    expect(container.querySelector('[data-component="SelectionFilter"]')?.getAttribute('data-panel')).toBe('filters');
  });

  it('click → filter(kind, false), Shift+click → filter(kind, true)', () => {
    const { container, log } = renderWithHud(<SelectionFilter />);
    fireEvent.click(container.querySelector('[data-filter="air"]')!);
    expect(lastCall(log, 'filter')?.args).toEqual(['air', false]);
    fireEvent.click(container.querySelector('[data-filter="engineers"] svg')!, { shiftKey: true });
    expect(lastCall(log, 'filter')?.args).toEqual(['engineers', true]);
  });

  it('demo hover state on one filter', () => {
    const { container } = renderWithHud(<SelectionFilter demo={{ kind: 'factories', state: 'hover' }} />);
    expect(container.querySelector('[data-filter="factories"]')?.classList.contains('is-hover')).toBe(true);
    expect(container.querySelector('[data-filter="land"]')?.classList.contains('is-hover')).toBe(false);
  });
});

describe('IdleButton (ui.md §5.9)', () => {
  it('badge only when > 0, updates at 1 Hz', async () => {
    const m = stripModel({ idle: 0 });
    const { container } = renderWithHud(<IdleButton />, { model: m });
    expect(container.querySelector('[data-testid="idle-count"]')).toBeNull();
    expect(container.querySelector('button')?.getAttribute('aria-label')).toContain('Keine untätigen Engineers');
    await flushSignals(() => {
      m.strip.idleEngineers.value = 3;
    });
    expect(container.querySelector('[data-testid="idle-count"]')?.textContent).toBe('3');
    expect(container.querySelector('button')?.getAttribute('aria-label')).toContain('3 untätige Engineers');
    await flushSignals(() => {
      m.strip.idleEngineers.value = 120;
    });
    expect(container.querySelector('[data-testid="idle-count"]')?.textContent).toBe('99+');
  });

  it('click = next idle engineer, Shift = all, right click = idle factory', () => {
    const { container, log } = renderWithHud(<IdleButton />, { model: stripModel() });
    const b = container.querySelector<HTMLElement>('[data-testid="idle-engineer"]')!;
    fireEvent.click(b);
    expect(lastCall(log, 'selectIdleEngineer')?.args).toEqual([false]);
    fireEvent.click(b, { shiftKey: true });
    expect(lastCall(log, 'selectIdleEngineer')?.args).toEqual([true]);
    fireEvent.contextMenu(b);
    expect(lastCall(log, 'selectIdleFactory')?.args).toEqual([]);
    expect(b.querySelector('.ff-order__key')?.textContent).toBe('.');
  });
});

describe('ControlGroups (ui.md §5.10)', () => {
  it('ten places: empty, filled (icon + count), active', () => {
    const { container } = renderWithHud(<ControlGroups />, { model: stripModel({ active: 1 }) });
    const groups = container.querySelectorAll<HTMLElement>('.grp');
    expect(groups).toHaveLength(10);
    expect(Array.from(groups).map((g) => g.querySelector('.grp__k')?.textContent)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']);
    expect(groups[0]?.querySelector('.grp__n')?.textContent).toBe('18');
    expect(groups[0]?.querySelector('[data-component="StrategicIcon"]')).not.toBeNull();
    expect(groups[1]?.classList.contains('is-active')).toBe(true);
    expect(groups[1]?.getAttribute('aria-pressed')).toBe('true');
    expect(groups[4]?.classList.contains('is-empty')).toBe(true);
    expect(groups[4]?.querySelector('.grp__n')).toBeNull();
    expect(groups[4]?.getAttribute('aria-label')).toBe('Gruppe 5 leer · Alt+5 oder Rechtsklick = Auswahl speichern');
    expect(groups[0]?.getAttribute('aria-label')).toContain('Gruppe 1: 18 Einheiten');
  });

  it('click recalls (Shift adds), right click saves, Shift+right click adds to the group', () => {
    const { container, log } = renderWithHud(<ControlGroups />, { model: stripModel() });
    const g3 = container.querySelector<HTMLElement>('[data-group="2"]')!;
    fireEvent.click(g3);
    expect(lastCall(log, 'recallGroup')?.args).toEqual([2, { shift: false, ctrl: false, alt: false }]);
    fireEvent.click(g3.querySelector('.grp__k')!, { shiftKey: true });
    expect(lastCall(log, 'recallGroup')?.args).toEqual([2, { shift: true, ctrl: false, alt: false }]);
    fireEvent.contextMenu(container.querySelector('[data-group="6"]')!);
    expect(lastCall(log, 'saveGroup')?.args).toEqual([6, false]);
    fireEvent.contextMenu(container.querySelector('[data-group="0"]')!, { shiftKey: true });
    expect(lastCall(log, 'saveGroup')?.args).toEqual([0, true]);
  });

  it('an active index on an empty group is not shown as active', () => {
    const { container } = renderWithHud(<ControlGroups />, { model: stripModel({ active: 7 }) });
    expect(container.querySelectorAll('.grp.is-active')).toHaveLength(0);
  });
});

describe('Strip', () => {
  it('composes filters + idle, groups and the order bar', () => {
    const { container } = renderWithHud(<Strip />, { model: stripModel() });
    const strip = container.querySelector('.strip')!;
    expect(Array.from(strip.children).map((c) => c.getAttribute('data-component'))).toEqual(['SelectionFilter', 'ControlGroups', 'OrderBar']);
  });
});
