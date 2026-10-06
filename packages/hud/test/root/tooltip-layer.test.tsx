// @vitest-environment happy-dom
import { describe, expect, test, vi } from 'vitest';
import { DEMO_TOOLTIPS, applyEcoPreset } from '../../src/demo/top.ts';
import { TooltipLayer } from '../../src/hud/root/index.ts';
import { createHudModel } from '../../src/model/index.ts';
import type { HudModel } from '../../src/model/index.ts';
import { TOOLTIP_DELAY_MS } from '../../src/model/tooltip.ts';
import type { TooltipAnchor, TooltipTarget } from '../../src/model/tooltip.ts';
import { fakeClock, flushSignals, renderWithHud, screen } from '../support/index.tsx';
import { demoUnitCatalog } from '../../src/demo/catalog.ts';

const CAT = demoUnitCatalog();

function setup() {
  const model = createHudModel({ units: CAT });
  applyEcoPreset(model, 'normal');
  const r = renderWithHud(
    <div data-testid="host" style={{ position: 'absolute', inset: 0 }}>
      <TooltipLayer />
    </div>,
    { model },
  );
  return { ...r, layer: () => screen.getByTestId('tooltip-layer') };
}

async function show(model: HudModel, target: TooltipTarget | null, viaKeyboard = false, anchor: TooltipAnchor = { kind: 'card' }): Promise<void> {
  await flushSignals(() => {
    model.tooltip.anchor.value = anchor;
    model.tooltip.viaKeyboard.value = viaKeyboard;
    model.tooltip.target.value = target;
  });
}

describe('TooltipLayer (ui.md §5.12)', () => {
  test('one reused node: hidden without a target, no panel id', () => {
    const { layer } = setup();
    expect(layer().hidden).toBe(true);
    expect(layer().getAttribute('data-panel')).toBeNull();
    expect(layer().getAttribute('role')).toBe('tooltip');
  });

  test('pointer hover: appears after 350 ms, not before; disappears at once', async () => {
    const clock = fakeClock();
    const { model, layer } = setup();
    const node = layer();
    await show(model, DEMO_TOOLTIPS.boiler);
    await clock.advance(TOOLTIP_DELAY_MS - 1);
    expect(layer().hidden).toBe(true);
    await clock.advance(1);
    expect(layer().hidden).toBe(false);
    expect(layer()).toBe(node);
    expect(layer().getAttribute('data-panel')).toBe('tooltip');
    expect(layer().querySelector('[data-component="UnitTooltip"]')).not.toBeNull();
    expect(layer().classList.contains('tipbox--card')).toBe(true);
    await show(model, null);
    expect(layer().hidden).toBe(true);
    expect(layer().childElementCount).toBe(0);
  });

  test('keyboard focus: at once', async () => {
    fakeClock();
    const { model, layer } = setup();
    await show(model, { kind: 'order', orderId: 'move' }, true);
    expect(layer().hidden).toBe(false);
    expect(layer().getAttribute('data-kind')).toBe('order');
    expect(layer().querySelector('[data-component="OrderTooltip"]')).not.toBeNull();
  });

  test('moving to another target while one is open switches at once; leaving before the delay shows nothing', async () => {
    const clock = fakeClock();
    const { model, layer } = setup();
    await show(model, DEMO_TOOLTIPS.boiler);
    await clock.advance(200);
    await show(model, null);
    await clock.advance(500);
    expect(layer().hidden).toBe(true);
    await show(model, DEMO_TOOLTIPS.boiler);
    await clock.advance(TOOLTIP_DELAY_MS);
    expect(layer().hidden).toBe(false);
    await show(model, { kind: 'resource', resource: 'energy' });
    expect(layer().getAttribute('data-kind')).toBe('resource');
    expect(layer().querySelector('[data-component="ResourceTooltip"]')).not.toBeNull();
  });

  test('point anchor: positioned by one measurement when it opens (transform), card anchor by CSS', async () => {
    fakeClock();
    const { model, layer } = setup();
    const node = layer();
    const host = screen.getByTestId('host');
    const hostRect = vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080, toJSON: () => ({}) });
    const tipRect = vi.spyOn(node, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 320, height: 200, right: 320, bottom: 200, toJSON: () => ({}) });
    await show(model, DEMO_TOOLTIPS.reeve, true, { kind: 'point', x: 1800, y: 1000 });
    expect(layer().classList.contains('tipbox--free')).toBe(true);
    expect(layer().style.transform).toBe('translate(1464px, 784px)');
    const calls = tipRect.mock.calls.length;
    // Content updates (4 Hz) do not measure again.
    await flushSignals(() => {
      model.eco.mass.stored.value = 999;
    });
    expect(tipRect.mock.calls.length).toBe(calls);
    await show(model, DEMO_TOOLTIPS.boiler, true, { kind: 'card' });
    expect(layer().style.transform).toBe('');
    hostRect.mockRestore();
    tipRect.mockRestore();
  });

  test('unknown type ids (core:cube, test/mod blueprints) render a minimal unit tooltip instead of throwing', async () => {
    fakeClock();
    const { model, layer } = setup();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await show(model, { kind: 'unit', typeId: 'core:cube' }, true);
    expect(layer().hidden).toBe(false);
    const tip = layer().querySelector('[data-component="UnitTooltip"]')!;
    expect(tip).not.toBeNull();
    expect(tip.getAttribute('data-type')).toBe('core:cube');
    expect(tip.textContent).toContain('core:cube');
    // Six value cells with „–“, no cost line.
    const values = [...tip.querySelectorAll('.ff-tip__grid b')].map((e) => e.textContent);
    expect(values).toEqual(['–', '–', '–', '–', '–', '–']);
    expect(tip.querySelector('.ff-tip__cost')).toBeNull();
    // With a builder BP as well (card cell of a mod unit): still no throw, no flow demand.
    await show(model, { kind: 'unit', typeId: 'test:dummy', builderBp: 20, mode: 'build' }, true);
    expect(layer().querySelector('[data-component="UnitTooltip"]')!.getAttribute('data-type')).toBe('test:dummy');
    expect(layer().querySelector('.ff-tip__cost')).toBeNull();
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  test('an empty catalog (game not handed over yet) never throws either', async () => {
    fakeClock();
    const model = createHudModel();
    renderWithHud(<TooltipLayer />, { model });
    await show(model, DEMO_TOOLTIPS.boiler, true);
    expect(screen.getByTestId('tooltip-layer').querySelector('[data-component="UnitTooltip"]')).not.toBeNull();
  });
});
