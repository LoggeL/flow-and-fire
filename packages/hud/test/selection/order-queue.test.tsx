// @vitest-environment happy-dom
import { describe, expect, test } from 'vitest';
import {
  ORDER_QUEUE_MAX_ROWS,
  OrderQueue,
  SelectionPanel,
  UnitDetail,
  applySelectionDemo,
  createHudModel,
  orderRows,
} from '../../src/index.ts';
import type { SelectionDemoScenario } from '../../src/index.ts';
import { fireEvent, flushSignals, lastCall, renderWithHud, screen } from '../support/index.tsx';
import { countRenders, watchMutations } from './helpers.ts';
import { demoUnitCatalog } from '../../src/demo/catalog.ts';

const CAT = demoUnitCatalog();

function renderScenario(scenario: SelectionDemoScenario) {
  const model = createHudModel({ units: CAT });
  applySelectionDemo(model, scenario);
  return renderWithHud(<SelectionPanel />, { model });
}

const rows = (): HTMLElement[] => screen.queryAllByTestId(/^order-\d+$/);

describe('OrderQueue – states', () => {
  test('gehängt: running order with ember edge + progress, queued orders numbered (commander chain of 5)', () => {
    renderScenario('commander');
    const q = screen.getByTestId('order-queue');
    expect(q.getAttribute('data-component')).toBe('OrderQueue');
    expect(q.getAttribute('data-state')).toBe('queued');
    expect(q.textContent).toContain('Befehlskette');
    const r = rows();
    expect(r).toHaveLength(5);
    expect(r.every((el) => el.tagName === 'BUTTON')).toBe(true);
    expect(r[0]!.classList.contains('is-now')).toBe(true);
    expect(r[0]!.style.getPropertyValue('--v')).toBe('0.64');
    expect(r[0]!.textContent).toBe('Glutkessel I' + '64\u00a0%');
    expect(r[0]!.querySelector('[data-icon="assist"]')).not.toBeNull();
    expect(r[1]!.querySelector('.n')?.textContent).toBe('2');
    expect(r[1]!.textContent).toBe('2Glutkessel I0\u00a0%');
    expect(r[3]!.textContent).toBe('4Zapfstelle I0\u00a0%');
    expect(r[4]!.textContent).toBe('5Reclaim · 3 Wracks86 M');
    expect(r[4]!.querySelector('[data-icon="reclaim"]')).not.toBeNull();
    expect(r[1]!.getAttribute('aria-label')).toBe('Befehl 2: Glutkessel I · Klick: zum Wegpunkt · Rechtsklick: entfernen');
  });

  test('laufend: exactly one running order', () => {
    renderScenario('engineerRunning');
    expect(screen.getByTestId('order-queue').getAttribute('data-state')).toBe('running');
    expect(rows()).toHaveLength(1);
    expect(rows()[0]!.textContent).toBe('Zapfstelle I' + '38\u00a0%');
  });

  test('leer: idle hint, no rows', () => {
    renderScenario('engineerIdle');
    expect(screen.getByTestId('order-queue').getAttribute('data-state')).toBe('empty');
    expect(rows()).toHaveLength(0);
    expect(screen.getByTestId('order-empty').textContent).toBe('Keine Befehle · untätig');
  });

  test('longer chains: ORDER_QUEUE_MAX_ROWS − 1 rows plus "+N weitere Befehle"', () => {
    renderScenario('commanderLongChain');
    expect(rows()).toHaveLength(ORDER_QUEUE_MAX_ROWS - 1);
    expect(screen.getByTestId('order-more').textContent).toBe('+4 weitere Befehle');
    expect(orderRows(6)).toEqual({ shown: 6, more: 0 });
    expect(orderRows(7)).toEqual({ shown: 5, more: 2 });
    expect(orderRows(0)).toEqual({ shown: 0, more: 0 });
  });

  test('labels: attack move, move; orders on unit types', () => {
    renderScenario('tankDamaged');
    expect(rows()[0]!.textContent).toBe('Angriffsbewegung');
    expect(rows()[1]!.textContent).toBe('2Bewegen');
  });
});

describe('OrderQueue – interaction', () => {
  test('click → jumpToOrder(i); right click → removeOrder(i) without browser menu', () => {
    const { log } = renderScenario('commander');
    fireEvent.click(rows()[2]!);
    expect(lastCall(log, 'jumpToOrder')?.args).toEqual([2]);
    fireEvent.click(rows()[0]!.querySelector('svg')!);
    expect(lastCall(log, 'jumpToOrder')?.args).toEqual([0]);
    expect(fireEvent.contextMenu(rows()[3]!, { button: 2 })).toBe(false);
    expect(lastCall(log, 'removeOrder')?.args).toEqual([3]);
    // Right click on the header: browser menu suppressed, no command.
    expect(fireEvent.contextMenu(screen.getByTestId('order-queue').firstElementChild!, { button: 2 })).toBe(false);
    expect(log.map((c) => c.name)).toEqual(['jumpToOrder', 'jumpToOrder', 'removeOrder']);
  });

  test('keyboard: rows are buttons (Enter/Space click)', () => {
    const { log } = renderScenario('commander');
    const r = rows()[1]!;
    r.focus();
    expect(document.activeElement).toBe(r);
    fireEvent.click(r, { detail: 0 });
    expect(lastCall(log, 'jumpToOrder')?.args).toEqual([1]);
  });
});

describe('UnitDetail – 4 Hz values without re-render', () => {
  test('HP, vet, tap shot and running order progress are bound; the chain re-renders only on structure changes', async () => {
    const { model } = renderScenario('commander');
    const counter = countRenders([UnitDetail, OrderQueue]);
    const detail = screen.getByTestId('unit-detail');
    const watch = watchMutations(detail);
    const base = model.selection.single.peek()!;
    for (let i = 1; i <= 4; i++) {
      await flushSignals(() => {
        model.selection.single.value = {
          ...base,
          hp: 12000 - i * 1000,
          vet: { level: 1, progress: 0.42 + i * 0.1, mass: 420 + i * 100, massNext: 1000 },
          tapshot: { stored: 2840 + i * 1500, threshold: 7500 },
          orders: [{ ...base.orders[0]!, progress: 0.64 + i * 0.05 }, ...base.orders.slice(1)],
        };
      });
    }
    counter.restore();
    watch.stop();
    expect(counter.total()).toBe(0);
    for (const r of watch.records()) {
      if (r.type === 'childList') for (const n of [...r.addedNodes, ...r.removedNodes]) expect(n.nodeType).toBe(3);
    }
    expect(screen.getByTestId('meter-hp-text').textContent).toBe('8.000 / 12.000');
    expect(screen.getByTestId('meter-hp-bar').querySelector('i')!.style.getPropertyValue('--v')).toBe(String(8000 / 12000));
    expect(screen.getByTestId('meter-vet-text').textContent).toBe('820 / 1.000 M');
    // 2.840 + 6.000 = 8.840 ≥ 7.500: tap shot ready.
    expect(screen.getByTestId('meter-tapshot-text').textContent).toBe('bereit · 8.840 E');
    expect(screen.getByTestId('meter-tapshot-text').classList.contains('is-ready')).toBe(true);
    expect(screen.getByTestId('order-running-value').textContent).toBe('84\u00a0%');
    expect(rows()[0]!.style.getPropertyValue('--v')).toBe(String(0.64 + 4 * 0.05));
  });

  test('vet level up toggles the diamonds without re-render; highest level shows "Höchste Stufe"', async () => {
    const { model } = renderScenario('commander');
    const counter = countRenders([UnitDetail]);
    await flushSignals(() => {
      model.selection.single.value = { ...model.selection.single.peek()!, vet: { level: 5, progress: 1 } };
    });
    counter.restore();
    expect(counter.total()).toBe(0);
    const vet = screen.getByTestId('portrait-vet');
    expect(vet.getAttribute('data-level')).toBe('5');
    expect(vet.querySelectorAll('i.on')).toHaveLength(5);
    expect(vet.getAttribute('aria-label')).toBe('Veteranenstufe 5 von 5');
    expect(screen.getByTestId('meter-vet-text').textContent).toBe('Höchste Stufe');
  });

  test('a new order in the chain re-renders the queue once; another unit rebuilds the detail', async () => {
    const { model } = renderScenario('commander');
    const counter = countRenders([OrderQueue]);
    const base = model.selection.single.peek()!;
    await flushSignals(() => {
      model.selection.single.value = { ...base, orders: base.orders.slice(1) };
    });
    counter.restore();
    expect(counter.count(OrderQueue)).toBe(1);
    expect(rows()).toHaveLength(4);
    expect(rows()[0]!.classList.contains('is-now')).toBe(true);
    await flushSignals(() => applySelectionDemo(model, 'tankDamaged'));
    expect(screen.getByTestId('unit-name').textContent).toBe('Punze');
  });
});
