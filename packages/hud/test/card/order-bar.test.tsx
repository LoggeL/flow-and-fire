// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { applyCardDemo } from '../../src/demo/card.ts';
import { OrderBar } from '../../src/hud/card/OrderBar.tsx';
import { OrderButton } from '../../src/hud/card/OrderButton.tsx';
import { OrderTooltip, orderStateText } from '../../src/hud/card/OrderTooltip.tsx';
import { orderBarVisible } from '../../src/hud/card/spec.ts';
import { createHudModel } from '../../src/model/index.ts';
import type { HudModel } from '../../src/model/index.ts';
import type { CardDemoId } from '../../src/demo/card.ts';
import { fireEvent, flushSignals, lastCall, renderWithHud } from '../support/index.tsx';
import { demoUnitCatalog } from '../../src/demo/catalog.ts';

const CAT = demoUnitCatalog();

function demo(id: CardDemoId): HudModel {
  const m = createHudModel({ units: CAT });
  applyCardDemo(m, id);
  return m;
}

function button(root: ParentNode, id: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(`[data-order="${id}"]`);
  if (el === null) throw new Error(`no order ${id}`);
  return el;
}

describe('OrderBar visibility (ui.md §5.8)', () => {
  it('visible for build, production and structure pages; hidden for orders and empty', () => {
    expect(orderBarVisible('build')).toBe(true);
    expect(orderBarVisible('production')).toBe(true);
    expect(orderBarVisible('structure')).toBe(true);
    expect(orderBarVisible('orders')).toBe(false);
    expect(orderBarVisible('empty')).toBe(false);
  });

  it('Vogt: 14 buttons in three groups with fixed places, Alt hint, keys per layout', () => {
    const { container } = renderWithHud(<OrderBar mac={false} />, { model: demo('vogt') });
    const bar = container.querySelector('[data-component="OrderBar"]')!;
    expect(bar.getAttribute('data-visible')).toBe('true');
    const groups = bar.querySelectorAll('.orders__grp');
    expect(Array.from(groups).map((g) => g.querySelectorAll('[data-order]').length)).toEqual([5, 5, 4]);
    expect(Array.from(bar.querySelectorAll('[data-order]')).map((b) => b.getAttribute('data-order'))).toEqual([
      'move',
      'patrol',
      'assist',
      'reclaim',
      'repair',
      'attack',
      'stop',
      'pause',
      'fireState',
      'ability',
      'attackGround',
      'tapshot',
      'formation',
      'selfDestruct',
    ]);
    expect(bar.querySelector('.orders__hint')?.textContent).toContain('Alt');
    expect(button(container, 'attackGround').querySelector('.ff-order__key')?.textContent).toBe('Y');
    // Self-destruct: no grid key in the bar (R4), key combination only in the label.
    expect(button(container, 'selfDestruct').querySelector('.ff-order__key')?.textContent).toBe('');
    expect(button(container, 'selfDestruct').getAttribute('aria-label')).toBe('Selbstzerstörung (Strg+Entf)');
    expect(button(container, 'stop').getAttribute('aria-label')).toBe('Stop (Alt+S)');
    // States from the demo: pause/formation disabled with reason, ability on, fire state cycle dots.
    expect(button(container, 'pause').classList.contains('is-disabled')).toBe(true);
    expect(button(container, 'pause').getAttribute('aria-label')).toContain('Nichts zu pausieren');
    expect(button(container, 'ability').classList.contains('is-on')).toBe(true);
    expect(button(container, 'fireState').querySelectorAll('.ff-order__dots i.on')).toHaveLength(1);
    expect(button(container, 'selfDestruct').classList.contains('ff-order--danger')).toBe(true);
  });

  it('army selection: bar hidden (orders are in the grid)', () => {
    const { container } = renderWithHud(<OrderBar />, { model: demo('army') });
    const bar = container.querySelector('[data-component="OrderBar"]')!;
    expect(bar.getAttribute('data-visible')).toBe('false');
    expect(bar.querySelectorAll('[data-order]')).toHaveLength(0);
  });

  it('switches with the selection event', async () => {
    const m = demo('army');
    const { container } = renderWithHud(<OrderBar />, { model: m });
    await flushSignals(() => applyCardDemo(m, 'landFactory'));
    expect(container.querySelector('[data-component="OrderBar"]')?.getAttribute('data-visible')).toBe('true');
    expect(button(container, 'move').classList.contains('is-disabled')).toBe(true);
    expect(button(container, 'stop').classList.contains('is-disabled')).toBe(false);
  });
});

describe('OrderBar clicks → activateOrder', () => {
  it('passes modifiers; disabled buttons issue nothing; right click is button 2', () => {
    const { container, log } = renderWithHud(<OrderBar />, { model: demo('vogt') });
    fireEvent.click(button(container, 'reclaim').querySelector('svg')!, { shiftKey: true });
    expect(lastCall(log, 'activateOrder')?.args).toEqual(['reclaim', { shift: true, ctrl: false, alt: false, button: 0 }]);
    fireEvent.contextMenu(button(container, 'move'), { button: 2 });
    expect(lastCall(log, 'activateOrder')?.args).toEqual(['move', { shift: false, ctrl: false, alt: false, button: 2 }]);
    const n = log.length;
    fireEvent.click(button(container, 'formation'));
    expect(log.length).toBe(n);
  });

  it('self-destruct: click starts; while counting the seconds replace the key and a click aborts', async () => {
    const m = demo('vogt');
    const { container, log } = renderWithHud(<OrderBar />, { model: m });
    fireEvent.click(button(container, 'selfDestruct'));
    expect(lastCall(log, 'activateOrder')?.args[0]).toBe('selfDestruct');
    await flushSignals(() => {
      m.orders.selfDestructCountdown.value = 4;
      m.orders.states.value = { ...m.orders.states.value, selfDestruct: { enabled: false, reason: 'noSelection' } };
    });
    const sd = button(container, 'selfDestruct');
    expect(sd.classList.contains('is-countdown')).toBe(true);
    expect(sd.classList.contains('is-disabled')).toBe(false);
    expect(sd.querySelector('.ff-order__key')?.textContent).toBe('4');
    const n = log.length;
    fireEvent.click(sd);
    expect(log.length).toBe(n + 1);
  });

  it('hover names the order for the tooltip layer', () => {
    const m = demo('vogt');
    const { container } = renderWithHud(<OrderBar />, { model: m });
    fireEvent.pointerOver(button(container, 'repair'));
    expect(m.tooltip.target.value).toEqual({ kind: 'order', orderId: 'repair' });
    fireEvent.pointerLeave(container.querySelector('[data-component="OrderBar"]')!);
    expect(m.tooltip.target.value).toBeNull();
  });

  it('re-renders only when the visible order state changes (4-Hz rewrites of equal content)', async () => {
    const m = demo('vogt');
    const { container } = renderWithHud(<OrderBar />, { model: m });
    const before = button(container, 'move');
    let mutations = 0;
    const obs = new MutationObserver((records) => {
      mutations += records.length;
    });
    obs.observe(container, { subtree: true, childList: true, attributes: true, characterData: true });
    await flushSignals(() => {
      m.orders.states.value = { ...m.orders.states.value };
    });
    await flushSignals(() => {
      m.orders.states.value = { ...m.orders.states.value };
    });
    obs.disconnect();
    expect(mutations).toBe(0);
    expect(button(container, 'move')).toBe(before);
  });
});

describe('OrderButton states (ui.md §6)', () => {
  const cases = [
    ['Scharf', { enabled: true, armed: true }, 'is-armed'],
    ['An', { enabled: true, toggle: 'on' }, 'is-on'],
    ['Gemischt', { enabled: true, toggle: 'mixed' }, 'is-mixed'],
    ['Deaktiviert', { enabled: false, reason: 'noEngineer' }, 'is-disabled'],
  ] as const;
  it.each(cases)('%s → %s', (_n, state, cls) => {
    const { container } = renderWithHud(<OrderButton id="pause" state={state} keyText="D" keysLabel="Alt+D" />);
    expect(container.querySelector('.ff-order')?.classList.contains(cls)).toBe(true);
  });

  it('toggle exposes aria-pressed incl. mixed; demo hover class', () => {
    const { container } = renderWithHud(
      <OrderButton id="ability" state={{ enabled: true, toggle: 'mixed' }} keyText="G" keysLabel="Alt+G" demoState="hover" />,
    );
    const b = container.querySelector('.ff-order')!;
    expect(b.getAttribute('aria-pressed')).toBe('mixed');
    expect(b.classList.contains('is-hover')).toBe(true);
  });

  it('attack ground badge shows the capable units', () => {
    const { container } = renderWithHud(<OrderButton id="attackGround" state={{ enabled: true, badge: 3 }} keyText="Y" keysLabel="Alt+Y" />);
    expect(container.querySelector('.ff-order__badge')?.textContent).toBe('3');
  });
});

describe('OrderTooltip (ui.md §5.12 „Befehl“)', () => {
  it('name, Alt key on a build page, behaviour, description, feature hint', () => {
    const { container } = renderWithHud(<OrderTooltip orderId="reclaim" mac={false} />, { model: demo('vogt') });
    const root = container.querySelector('[data-component="OrderTooltip"]')!;
    expect(root.querySelector('.ff-tip__name')?.textContent).toBe('Reclaim');
    expect(root.querySelector('.ff-key')?.textContent).toBe('Alt+R');
    expect(root.textContent).toContain('Scharf: Linksklick wählt das Ziel');
    expect(root.textContent).toContain('Linksklick-Ziehen reclaimt einen Bereich');
    expect(root.querySelector('[data-testid="order-tooltip-feature"]')?.textContent).toBe('Feature E7, E12, E14 · ab MS5');
    expect(root.querySelector('[data-testid="order-tooltip-reason"]')).toBeNull();
  });

  it('grid key on the orders page, reason when disabled', () => {
    const { container } = renderWithHud(<OrderTooltip orderId="repair" />, { model: demo('army') });
    expect(container.querySelector('.ff-key')?.textContent).toBe('T');
    expect(container.querySelector('[data-testid="order-tooltip-reason"]')?.textContent).toBe(
      'Nicht verfügbar: Nur für Engineers und den Vogt',
    );
  });

  it('stop on a build page explains Alt+S (R5); self-destruct names Ctrl+Delete / Ctrl+⌫ on macOS', () => {
    const r = renderWithHud(<OrderTooltip orderId="stop" />, { model: demo('vogt') });
    expect(r.container.textContent).toContain('Stop über Alt+S');
    r.unmount();
    const { container } = renderWithHud(<OrderTooltip orderId="selfDestruct" mac />, { model: demo('army') });
    expect(container.querySelector('.ff-key')?.textContent).toBe('Strg+Entf / Strg+⌫');
  });

  it('state texts: armed, cycle, toggle, countdown, capable', () => {
    expect(orderStateText('attack', { enabled: true, armed: true }, null)).toBe('Scharf – wartet auf ein Ziel');
    expect(orderStateText('fireState', { enabled: true, cycle: 1 }, null)).toBe('Nur erwidern → Feuer halten');
    expect(orderStateText('ability', { enabled: true, toggle: 'mixed', ability: 'radar' }, null)).toBe('Radar: Gemischt');
    expect(orderStateText('selfDestruct', { enabled: true }, 2.2)).toBe('Sprengung in 3 s – erneut klicken bricht ab');
    expect(orderStateText('attackGround', { enabled: true, badge: 3 }, null)).toBe('3 fähige Einheiten');
    expect(orderStateText('move', { enabled: true }, null)).toBeNull();
  });
});
