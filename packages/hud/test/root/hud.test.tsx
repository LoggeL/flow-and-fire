// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { applyHudScenario, createHudScenario } from '../../src/demo/scenarios.ts';
import type { HudScenarioId } from '../../src/demo/scenarios.ts';
import { Hud, parseTipAttr } from '../../src/hud/root/index.ts';
import { createHudModel } from '../../src/model/index.ts';
import { TOOLTIP_DELAY_MS } from '../../src/model/tooltip.ts';
import { fakeClock, fireEvent, flushSignals, lastCall, renderWithHud, screen } from '../support/index.tsx';
import { demoUnitCatalog } from '../../src/demo/catalog.ts';
import { PanelBoundary } from '../../src/ui/PanelBoundary.tsx';
import type { JSX } from 'preact';

const CAT = demoUnitCatalog();

function renderScenario(id: HudScenarioId, props: Parameters<typeof Hud>[0] = { mac: false }) {
  const model = createHudModel({ units: CAT });
  applyHudScenario(model, createHudScenario(id));
  return renderWithHud(<Hud {...props} />, { model });
}

const panels = (root: Element): string[] => [...root.querySelectorAll('[data-panel]')].map((e) => e.getAttribute('data-panel') ?? '');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Hud root (ui.md §4.2, §4.4, §10)', () => {
  test('root: data-hud-root, click-through class, region label; all panels of the layout', () => {
    const { container } = renderScenario('vogt');
    const root = screen.getByTestId('hud');
    expect(root.hasAttribute('data-hud-root')).toBe(true);
    expect(root.classList.contains('hud-root')).toBe(true);
    expect(root.getAttribute('data-component')).toBe('Hud');
    expect(root.getAttribute('aria-label')).toBe('Spiel-HUD');
    expect(panels(container)).toEqual(
      expect.arrayContaining(['res-mass', 'res-energy', 'status', 'alerts', 'filters', 'groups', 'orders', 'minimap', 'selection', 'card', 'tooltip']),
    );
    // Dock order: minimap | selection | card.
    const dock = screen.getByTestId('hud-dock');
    expect([...dock.children].map((c) => c.getAttribute('data-panel'))).toEqual(['minimap', 'selection', 'card']);
    // Top zone left to right / strip order: filters | groups | orders.
    const strip = root.querySelector('.strip')!;
    expect([...strip.querySelectorAll('[data-panel]')].map((e) => e.getAttribute('data-panel'))).toEqual(['filters', 'groups', 'orders']);
  });

  test('scenario content lands in the panels (vogt: Reeve selected, build card, tooltip at once)', () => {
    renderScenario('vogt');
    expect(screen.getByTestId('selection-panel').textContent).toContain('Vogt');
    expect(screen.getByTestId('tooltip-layer').hidden).toBe(false);
    expect(screen.getByTestId('tooltip-layer').querySelector('[data-type="core:str_t1_pgen"]')).not.toBeNull();
    expect(screen.getByTestId('minimap')).not.toBeNull();
  });

  test('pause scenario shows the banner; flow details open in the stall scenario', () => {
    const a = renderScenario('pause-cvd');
    expect(a.container.querySelector('[data-panel="banner"]')).not.toBeNull();
    a.unmount();
    const b = renderScenario('fabrik-stall');
    expect(b.container.querySelector('[data-panel="flow-details"]')).not.toBeNull();
    expect(b.container.querySelectorAll('.ff-alert')).toHaveLength(3);
  });

  test('data-tip delegation: hover over a resource meter opens the resource tooltip after 350 ms, leaving closes it', async () => {
    const clock = fakeClock();
    const { model } = renderScenario('armee');
    const meter = screen.getByTestId('resource-meter-energy');
    fireEvent.pointerOver(meter.querySelector('.res__store')!);
    expect(model.tooltip.target.value).toEqual({ kind: 'resource', resource: 'energy' });
    expect(model.tooltip.anchor.value.kind).toBe('rect');
    await clock.advance(TOOLTIP_DELAY_MS);
    const layer = screen.getByTestId('tooltip-layer');
    expect(layer.hidden).toBe(false);
    expect(layer.querySelector('[data-component="ResourceTooltip"]')).not.toBeNull();
    // Moving inside the meter keeps it; leaving it closes at once.
    fireEvent.pointerOut(meter.querySelector('.res__store')!, { relatedTarget: meter });
    expect(model.tooltip.target.value).not.toBeNull();
    fireEvent.pointerOut(meter, { relatedTarget: document.body });
    await flushSignals();
    expect(model.tooltip.target.value).toBeNull();
    expect(layer.hidden).toBe(true);
  });

  test('keyboard focus on a meter opens the tooltip at once', async () => {
    fakeClock();
    const { model } = renderScenario('armee');
    fireEvent.focusIn(screen.getByTestId('resource-meter-mass'));
    await flushSignals();
    expect(model.tooltip.viaKeyboard.value).toBe(true);
    expect(screen.getByTestId('tooltip-layer').hidden).toBe(false);
  });

  test('hotkeys only when asked for (the game binds its own input layer)', () => {
    const off = renderScenario('vogt');
    fireEvent.keyDown(window, { code: 'KeyW', key: 'w' });
    expect(lastCall(off.log, 'cardActivate')).toBeUndefined();
    off.unmount();
    const on = renderScenario('vogt', { mac: false, hotkeys: true });
    fireEvent.keyDown(window, { code: 'KeyW', key: 'w' });
    expect(lastCall(on.log, 'cardActivate')?.args[0]).toBe('KeyW');
  });

  test('scaleSetting "auto" writes the scale of ui.md §4.1 from the root size (ResizeObserver)', () => {
    let report: ((entries: { contentRect: { width: number; height: number } }[]) => void) | null = null;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: (entries: { contentRect: { width: number; height: number } }[]) => void) {
          report = cb;
        }
        observe(): void {}
        disconnect(): void {}
      },
    );
    const { model } = renderScenario('vogt', { mac: false, scaleSetting: 'auto' });
    report!([{ contentRect: { width: 2560, height: 1440 } }]);
    expect(model.scale.value).toBe(1.25);
    report!([{ contentRect: { width: 1280, height: 720 } }]);
    expect(model.scale.value).toBe(0.8);
  });
});

describe('parseTipAttr', () => {
  test('resource, order and unit targets; junk → null', () => {
    expect(parseTipAttr('resource:mass')).toEqual({ kind: 'resource', resource: 'mass' });
    expect(parseTipAttr('order:stop')).toEqual({ kind: 'order', orderId: 'stop' });
    expect(parseTipAttr('unit:core:lnd_t1_tank')).toEqual({ kind: 'unit', typeId: 'core:lnd_t1_tank', mode: 'info' });
    expect(parseTipAttr('resource:gold')).toBeNull();
    expect(parseTipAttr('order:dance')).toBeNull();
    expect(parseTipAttr('nothing')).toBeNull();
    expect(parseTipAttr(null)).toBeNull();
  });
});

describe('PanelBoundary (data errors stay inside one panel)', () => {
  test('a throwing panel is removed and reported, its siblings keep rendering; a new reset key retries', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let fail = true;
    function Boom(): JSX.Element {
      if (fail) throw new Error('bad data');
      return <span data-testid="boom-ok">ok</span>;
    }
    const view = (key: number) => (
      <div>
        <PanelBoundary name="Boom" resetKey={key}>
          <Boom />
        </PanelBoundary>
        <span data-testid="sibling">sibling</span>
      </div>
    );
    const r = renderWithHud(view(1));
    await flushSignals();
    expect(screen.queryByTestId('boom-ok')).toBeNull();
    expect(screen.getByTestId('sibling').textContent).toBe('sibling');
    expect(errors.mock.calls.some((c) => String(c[0]).includes("panel 'Boom'"))).toBe(true);
    fail = false;
    r.rerender(view(2));
    await flushSignals();
    expect(screen.getByTestId('boom-ok').textContent).toBe('ok');
    errors.mockRestore();
  });
});
