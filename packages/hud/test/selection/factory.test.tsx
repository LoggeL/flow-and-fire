// @vitest-environment happy-dom
import { describe, expect, test } from 'vitest';
import {
  FactoryDetail,
  FactoryQueue,
  QUEUE_MAX_BLOCKS,
  SelectionPanel,
  applySelectionDemo,
  createHudModel,
  factoryQueueState,
  fmtPct,
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

const blocks = (): HTMLElement[] => screen.queryAllByTestId('factory-block');
const state = (): string | null => screen.getByTestId('factory-queue').getAttribute('data-state');

describe('FactoryDetail', () => {
  test('portrait T1, name/role, HP, BP own + assist "20 + 15 = 35", helpers, adjacency, rally', () => {
    renderScenario('factory');
    expect(screen.getByTestId('portrait-tech').textContent).toBe('T1');
    expect(screen.getByTestId('factory-name').textContent).toBe('Landwerk I');
    expect(screen.getByTestId('factory-detail').textContent).toContain('Landfabrik');
    expect(screen.getByTestId('meter-hp-text').textContent).toBe('4.200 / 4.200');
    expect(screen.getByTestId('meter-bp-text').textContent).toBe('20 + 15 = 35');
    expect(screen.getByTestId('meter-bp-text').querySelector('.meter__total')?.textContent).toBe('35');
    expect(screen.getByTestId('meter-bp-bar').querySelector('i')!.style.getPropertyValue('--v')).toBe(String(20 / 35));
    expect(screen.getByTestId('factory-helpers').textContent).toBe('Helfer 3 (Lehrling ×3, Assist)' + 'Nachbarschaft −9 % E');
    expect(screen.getByTestId('factory-adjacency').classList.contains('is-adjacency')).toBe(true);
    const rally = screen.getByTestId('factory-rally-state');
    expect(rally.textContent).toBe('Rally gesetzt Rechtsklick Boden');
    expect(rally.querySelector('b')!.classList.contains('is-set')).toBe(true);
  });

  test('empty factory: no assist ("20"), no helpers, no adjacency, rally not set', () => {
    renderScenario('factoryEmpty');
    expect(screen.getByTestId('meter-bp-text').textContent).toBe('20');
    expect(screen.getByTestId('factory-helpers').textContent).toBe('Helfer 0 (keine)' + 'Nachbarschaft keine');
    expect(screen.getByTestId('factory-rally-state').querySelector('b')!.getAttribute('data-rally')).toBe('none');
  });

  test('HP (4 Hz) is bound without re-render', async () => {
    const { model } = renderScenario('factory');
    const counter = countRenders([FactoryDetail, FactoryQueue]);
    await flushSignals(() => {
      model.factory.detail.value = { ...model.factory.detail.peek()!, hp: 1000 };
    });
    counter.restore();
    expect(counter.total()).toBe(0);
    expect(screen.getByTestId('meter-hp-text').textContent).toBe('1.000 / 4.200');
    expect(screen.getByTestId('meter-hp-bar').classList.contains('is-crit')).toBe(true);
  });
});

describe('FactoryQueue – states', () => {
  test('laufend: now block (icon, name, remaining, bar, percent), 4 merged blocks, first marked', () => {
    renderScenario('factory');
    expect(state()).toBe('running');
    expect(screen.getByTestId('factory-now-name').textContent).toBe('Punze');
    expect(screen.getByTestId('factory-now-sub').textContent).toBe(' · noch 3,1 s');
    expect(screen.getByTestId('factory-pct').textContent).toBe(fmtPct(0.64));
    expect(screen.getByTestId('factory-progress').querySelector('i')!.style.getPropertyValue('--v')).toBe('0.64');
    const b = blocks();
    expect(b.map((el) => el.getAttribute('data-block'))).toEqual(['core:lnd_t1_tank', 'core:lnd_t1_arty', 'core:lnd_t1_engineer', 'core:lnd_t1_aa']);
    expect(b.map((el) => el.querySelector('b')!.textContent)).toEqual(['5', '2', '1', '1']);
    expect(b[0]!.classList.contains('is-first')).toBe(true);
    expect(b.some((el) => el.classList.contains('is-loop'))).toBe(false);
    expect(b[0]!.title).toBe('Punze ×5 · Klick +1 · Umschalt+Klick +5 · Rechtsklick −1 · Strg+Klick an den Anfang');
    expect(screen.getByTestId('factory-repeat').getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByTestId('factory-multi')).toBeNull();
  });

  test('Wiederholen an: loop marker on every block, repeat button on', () => {
    renderScenario('factoryRepeat');
    expect(state()).toBe('repeat');
    expect(blocks().every((el) => el.classList.contains('is-loop'))).toBe(true);
    const btn = screen.getByTestId('factory-repeat');
    expect(btn.classList.contains('is-on')).toBe(true);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  test('pausiert: now block paused, pause button on, remaining time replaced', () => {
    renderScenario('factoryPaused');
    expect(state()).toBe('paused');
    expect(screen.getByTestId('factory-now').classList.contains('is-paused')).toBe(true);
    expect(screen.getByTestId('factory-now-sub').textContent).toBe(' · pausiert');
    expect(screen.getByTestId('factory-pause').classList.contains('is-on')).toBe(true);
    expect(screen.getByTestId('factory-pause').getAttribute('aria-pressed')).toBe('true');
  });

  test('leer: idle block, "Queue leer", clear disabled', () => {
    renderScenario('factoryEmpty');
    expect(state()).toBe('empty');
    expect(screen.getByTestId('factory-now').classList.contains('is-idle')).toBe(true);
    expect(screen.getByTestId('factory-now').textContent).toContain('Leerlauf');
    expect(screen.getByTestId('factory-empty').textContent).toBe('Queue leer');
    expect(blocks()).toHaveLength(0);
    expect((screen.getByTestId('factory-clear') as HTMLButtonElement).disabled).toBe(true);
  });

  test('Mehrfach-Fabrik: head "3 Fabriken", queue head "3 Fabriken · Aufträge reihum", summed blocks', () => {
    renderScenario('factoryMulti');
    expect(state()).toBe('multi');
    expect(screen.getByTestId('selection-head').textContent).toBe('Auswahl · 3 Fabriken' + 'Gruppe 4');
    expect(screen.getByTestId('factory-multi').textContent).toBe('3 Fabriken · Aufträge reihum');
    expect(blocks().map((el) => el.querySelector('b')!.textContent)).toEqual(['12', '6', '3', '3', '1']);
  });

  test('more than 10 blocks: 9 blocks + "+N"', () => {
    renderScenario('factoryLong');
    expect(blocks()).toHaveLength(QUEUE_MAX_BLOCKS - 1);
    const more = screen.getByTestId('factory-block-more');
    expect(more.textContent).toBe('+3');
    expect(more.getAttribute('aria-label')).toBe('3 weitere Blöcke');
  });

  test('factoryQueueState derivation', () => {
    expect(factoryQueueState(null, 1)).toBe('empty');
    expect(factoryQueueState({ current: null, blocks: [], repeat: true, paused: true }, 1)).toBe('empty');
    expect(factoryQueueState({ current: { typeId: 'x' }, blocks: [], repeat: true, paused: true }, 1)).toBe('paused');
    expect(factoryQueueState({ current: { typeId: 'x' }, blocks: [], repeat: true, paused: false }, 1)).toBe('repeat');
    expect(factoryQueueState({ current: { typeId: 'x' }, blocks: [], repeat: false, paused: false }, 2)).toBe('multi');
  });
});

describe('FactoryQueue – interaction', () => {
  test('block clicks: +1, Shift +5, right −1, Shift+right −5, Ctrl to front, Ctrl+Shift 5 to front', () => {
    const { log } = renderScenario('factory');
    const arty = blocks()[1]!;
    fireEvent.click(arty);
    expect(lastCall(log, 'queueAdd')?.args).toEqual(['core:lnd_t1_arty', 1, false]);
    fireEvent.click(arty, { shiftKey: true });
    expect(lastCall(log, 'queueAdd')?.args).toEqual(['core:lnd_t1_arty', 5, false]);
    expect(fireEvent.contextMenu(arty, { button: 2 })).toBe(false);
    expect(lastCall(log, 'queueRemove')?.args).toEqual(['core:lnd_t1_arty', 1]);
    expect(fireEvent.contextMenu(arty, { button: 2, shiftKey: true })).toBe(false);
    expect(lastCall(log, 'queueRemove')?.args).toEqual(['core:lnd_t1_arty', 5]);
    fireEvent.click(arty, { ctrlKey: true });
    expect(lastCall(log, 'queueAdd')?.args).toEqual(['core:lnd_t1_arty', 1, true]);
    fireEvent.click(blocks()[0]!.querySelector('svg')!, { ctrlKey: true, shiftKey: true });
    expect(lastCall(log, 'queueAdd')?.args).toEqual(['core:lnd_t1_tank', 5, true]);
    // macOS Ctrl+click arrives as contextmenu with button 0 → to the front, not −1.
    expect(fireEvent.contextMenu(arty, { button: 0, ctrlKey: true })).toBe(false);
    expect(lastCall(log, 'queueAdd')?.args).toEqual(['core:lnd_t1_arty', 1, true]);
    expect(log.map((c) => c.name)).toEqual(['queueAdd', 'queueAdd', 'queueRemove', 'queueRemove', 'queueAdd', 'queueAdd', 'queueAdd']);
  });

  test('"+N" and the list background issue no command; right click there shows no browser menu', () => {
    const { log } = renderScenario('factoryLong');
    fireEvent.click(screen.getByTestId('factory-block-more'));
    expect(fireEvent.contextMenu(screen.getByTestId('factory-block-more'), { button: 2 })).toBe(false);
    fireEvent.click(screen.getByTestId('factory-blocks'));
    expect(log).toHaveLength(0);
  });

  test('controls: repeat, pause, rally, clear', () => {
    const { log } = renderScenario('factory');
    fireEvent.click(screen.getByTestId('factory-repeat'));
    fireEvent.click(screen.getByTestId('factory-pause'));
    fireEvent.click(screen.getByTestId('factory-rally'));
    fireEvent.click(screen.getByTestId('factory-clear'));
    expect(log.map((c) => c.name)).toEqual(['toggleRepeat', 'togglePauseProduction', 'armRally', 'clearQueue']);
    expect(log.every((c) => c.args.length === 0)).toBe(true);
  });
});

describe('FactoryQueue – 10 Hz progress', () => {
  test('progress and remaining time are bound (transform/text only), no re-render', async () => {
    const { model } = renderScenario('factory');
    const counter = countRenders([FactoryQueue, FactoryDetail, SelectionPanel]);
    const q = screen.getByTestId('factory-queue');
    const watch = watchMutations(q);
    for (let i = 1; i <= 10; i++) {
      await flushSignals(() => {
        model.factory.progress.value = 0.64 + i * 0.03;
        model.factory.remainingS.value = 3.1 - i * 0.26;
      });
    }
    counter.restore();
    watch.stop();
    expect(counter.total()).toBe(0);
    for (const r of watch.records()) {
      if (r.type === 'childList') for (const n of [...r.addedNodes, ...r.removedNodes]) expect(n.nodeType).toBe(3);
      // style = --v; class = the Bar primitive re-applies its (unchanged) level classes.
      if (r.type === 'attributes') expect(['style', 'class']).toContain(r.attributeName);
    }
    expect(screen.getByTestId('factory-progress').className).toBe('ff-bar ff-bar--build');
    expect(screen.getByTestId('factory-progress').querySelector('i')!.style.getPropertyValue('--v')).toBe(String(0.64 + 10 * 0.03));
    expect(screen.getByTestId('factory-pct').textContent).toBe(fmtPct(0.94));
    expect(screen.getByTestId('factory-now-sub').textContent).toBe(' · noch 0,5 s');
  });

  test('a queue event (block added) re-renders the queue once', async () => {
    const { model } = renderScenario('factory');
    const counter = countRenders([FactoryQueue]);
    await flushSignals(() => {
      const q = model.factory.queue.peek()!;
      model.factory.queue.value = { ...q, blocks: [...q.blocks, { typeId: 'core:lnd_t1_scout', count: 2 }] };
    });
    counter.restore();
    expect(counter.count(FactoryQueue)).toBe(1);
    expect(blocks()).toHaveLength(5);
  });
});
