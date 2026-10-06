// @vitest-environment happy-dom
import type { ComponentChildren } from 'preact';
import { describe, expect, test } from 'vitest';
import { ResourceTooltip, TOOLTIP_SAMPLE_MS, UnitTooltip, unitTooltipStats } from '../../src/hud/top/index.ts';
import { DEMO_TOOLTIPS, applyEcoPreset, applyResourcePreset } from '../../src/demo/index.ts';
import { createHudModel } from '../../src/model/index.ts';
import type { HudModel } from '../../src/model/index.ts';
import { fakeClock, flushSignals, renderWithHud, screen, within } from '../support/index.tsx';
import { demoUnitCatalog } from '../../src/demo/catalog.ts';

const CAT = demoUnitCatalog();

const cells = (root: HTMLElement): string[][] =>
  [...root.querySelectorAll('.ff-tip__grid > div')].map((d) => [...d.childNodes].map((n) => n.textContent ?? ''));

function renderUnit(ui: ComponentChildren, eco: (m: HudModel) => void = (m) => applyEcoPreset(m, 'normal'), locale: 'de' | 'en' = 'de') {
  const model = createHudModel({ units: CAT });
  eco(model);
  return renderWithHud(ui, { model, locale });
}

describe('UnitTooltip (ui.md §5.12)', () => {
  test('structure in the build grid with adjacency: head, cost, flow demand in yellow, grid, desc, foot', () => {
    renderUnit(<UnitTooltip {...DEMO_TOOLTIPS.boiler} />);
    const tip = screen.getByTestId('unit-tooltip');
    expect(tip.dataset['component']).toBe('UnitTooltip');
    expect(tip.dataset['mode']).toBe('build');
    expect(tip.querySelector('.ff-tip__name')?.textContent).toBe('Glutkessel I');
    expect(tip.querySelector('.ff-tip__role')?.textContent).toBe('Kraftwerk');
    expect(tip.querySelector('.ff-tip__head [data-component="Key"]')?.textContent).toBe('W');
    expect(tip.querySelector('.ff-tip__head [data-component="StrategicIcon"]')?.getAttribute('data-icon')).toBe('struct_energy_t1');
    expect(tip.querySelector('.ff-tip__mass b')?.textContent).toBe('75');
    expect(tip.querySelector('.ff-tip__energy b')?.textContent).toBe('750');
    // 75 M / (125 / 10 s) = 6,0 M/s; 750 E → 60 E/s. Mass net is −3,5 → demand above net → warn.
    const flow = tip.querySelector('.ff-tip__flow') as HTMLElement;
    expect(flow.textContent).toBe('≈ 6,0 M/s · 60 E/s Flow');
    expect(flow.className).toContain('is-warn');
    expect(within(tip).getByTestId('tooltip-flow').getAttribute('title')).toBe('Flow-Bedarf über dem aktuellen Netto');
    expect(cells(tip)).toEqual([
      ['HP', '620'],
      ['Energy', '+20/s'],
      ['Reichweite', '–'],
      ['Sicht', '–'],
      ['Bauzeit', '12,5 s', 'bei BP 10'],
      ['Tech', 'T1'],
    ]);
    expect(tip.querySelector('.tip-desc')?.textContent).toContain('Kessel mit Schlot');
    const adj = within(tip).getByTestId('tooltip-adjacency');
    expect(adj.textContent).toMatch(/^Nachbarschaft: Fabriken \(8×8\)/);
    expect(tip.querySelector('.ff-tip__foot')?.textContent).toBe('Klickplatzieren⇧mehrere');
  });

  test('unit in the factory: DPS, range, speed, target layer, factory foot, no warning when the eco can afford it', () => {
    renderUnit(<UnitTooltip {...DEMO_TOOLTIPS.punch} />, (m) => {
      applyResourcePreset(m, 'mass', 'overflow');
      applyResourcePreset(m, 'energy', 'normal');
    });
    const tip = screen.getByTestId('unit-tooltip');
    expect(tip.dataset['mode']).toBe('factory');
    expect(tip.querySelector('.ff-tip__role')?.textContent).toBe('Kampfpanzer · Ziel: Land');
    expect(tip.querySelector('.ff-tip__flow')?.textContent).toBe('≈ 6,5 M/s · 33 E/s Flow');
    expect(tip.querySelector('.ff-tip__flow')?.className).not.toContain('is-warn');
    expect(cells(tip)).toEqual([
      ['HP', '300'],
      ['DPS', '23,3'],
      ['Reichweite', '18 WU'],
      ['Tempo', '3,3 WU/s'],
      ['Bauzeit', '8,6 s', 'bei BP 35'],
      ['Tech', 'T1'],
    ]);
    expect(within(tip).queryByTestId('tooltip-adjacency')).toBeNull();
    expect(tip.querySelector('.ff-tip__foot')?.textContent).toBe('Klick+1⇧+5Rechtsklick−1');
  });

  test('the flow warning follows the economy (re-renders only when it flips)', async () => {
    const r = renderUnit(<UnitTooltip {...DEMO_TOOLTIPS.punch} />, (m) => {
      applyResourcePreset(m, 'mass', 'overflow');
      applyResourcePreset(m, 'energy', 'normal');
    });
    const flow = (): string => screen.getByTestId('unit-tooltip').querySelector('.ff-tip__flow')?.className ?? '';
    expect(flow()).not.toContain('is-warn');
    await flushSignals(() => applyResourcePreset(r.model, 'mass', 'stallSoon'));
    expect(flow()).toContain('is-warn');
  });

  test('info mode (Reeve): no cost, regeneration instead of build time, no adjacency, select foot', () => {
    renderUnit(<UnitTooltip {...DEMO_TOOLTIPS.reeve} />);
    const tip = screen.getByTestId('unit-tooltip');
    expect(tip.dataset['mode']).toBe('info');
    expect(tip.querySelector('.ff-tip__cost')).toBeNull();
    expect(tip.querySelector('.ff-tip__head [data-component="Key"]')).toBeNull();
    expect(cells(tip)).toEqual([
      ['HP', '12.000'],
      ['DPS', '100,0'],
      ['Build Power', '10'],
      ['Tempo', '1,7 WU/s'],
      ['Regeneration', '+10,0/s'],
      ['Tech', '–'],
    ]);
    expect(within(tip).queryByTestId('tooltip-adjacency')).toBeNull();
    expect(tip.querySelector('.ff-tip__foot')?.textContent).toBe('KlickauswählenDoppelklickalle dieses Typs');
  });

  test('locked cell names the requirement, disabled cell the reason', () => {
    renderUnit(<UnitTooltip {...DEMO_TOOLTIPS.canopyLocked} />);
    expect(screen.getByTestId('tooltip-locked').textContent).toBe('Gesperrt: braucht einen Bauer ab T2 (Freisprechen)');
    expect(screen.getByTestId('tooltip-locked').querySelector('[data-icon="lock"]')).not.toBeNull();
    screen.getByTestId('unit-tooltip').remove();
    renderUnit(<UnitTooltip {...DEMO_TOOLTIPS.tapDisabled} disabledReason="Upgrade läuft" />);
    expect(screen.getByTestId('tooltip-disabled').textContent).toBe('Nicht verfügbar: Upgrade läuft');
  });

  test('upkeep structure shows upkeep; English texts', () => {
    renderUnit(<UnitTooltip typeId="core:str_t1_radar" builderBp={10} slot="KeyC" />, undefined, 'en');
    const tip = screen.getByTestId('unit-tooltip');
    expect(tip.querySelector('.ff-tip__name')?.textContent).toBe('Listener I');
    expect(cells(tip)[3]).toEqual(['Upkeep', '−20 E/s']);
    expect(cells(tip)[4]).toEqual(['Build time', '8.0 s', 'at BP 10']);
    expect(tip.querySelector('.ff-tip__foot')?.textContent).toBe('Clickplace⇧several');
    // German keyboard: KeyC stays C; the slot label follows the layout.
    expect(tip.querySelector('.ff-tip__head [data-component="Key"]')?.textContent).toBe('C');
  });

  test('stats builder covers every MVP structure/unit kind without throwing', () => {
    expect(unitTooltipStats(CAT, 'core:str_t1_mex', 10, 'de').map((c) => c.label)).toEqual(['HP', 'Mass', 'Reichweite', 'Unterhalt', 'Bauzeit', 'Tech']);
    expect(unitTooltipStats(CAT, 'core:str_t1_mstore', 10, 'de')[2]).toEqual({ label: 'Speicher', value: '500 M' });
    expect(unitTooltipStats(CAT, 'core:str_t1_fac_land', 10, 'de')[2]).toEqual({ label: 'Build Power', value: '20' });
  });
});

describe('ResourceTooltip (ui.md §5.1 tooltip)', () => {
  test('values, forecast, sources, storage by building', () => {
    renderUnit(<ResourceTooltip resource="mass" />);
    const tip = screen.getByTestId('resource-tooltip-mass');
    expect(tip.dataset['component']).toBe('ResourceTooltip');
    expect(tip.querySelector('.ff-tip__name')?.textContent).toBe('Mass');
    expect(cells(tip)).toEqual([
      ['Einkommen', '+28,0/s'],
      ['Verbrauch', '−31,5/s'],
      ['Netto', '−3,5/s'],
      ['Speicher', '312 / 1.230'],
      ['Flow', '100 %'],
      ['Prognose', 'leer in 90 s'],
    ]);
    expect(screen.queryByTestId('tooltip-res-state')).toBeNull();
    const sources = screen.getByTestId('tooltip-res-sources');
    expect([...sources.querySelectorAll('.tip-res__row')].map((r) => r.textContent)).toEqual(['Zapfstellen+24,0', 'Vogt+1,0', 'Reclaim+3,0']);
    const storage = screen.getByTestId('tooltip-res-storage');
    expect([...storage.querySelectorAll('.tip-res__row')].map((r) => r.textContent)).toEqual(['Vogt650', 'Landwerk I80', 'Erzspeicher500']);
    expect(tip.querySelector('.ff-tip__foot')?.textContent).toBe('Klicköffnet die Flow-Details');
  });

  test('stall and overflow state lines carry symbol + text', () => {
    renderUnit(<ResourceTooltip resource="energy" />, (m) => applyEcoPreset(m, 'stallEnergy'));
    let state = screen.getByTestId('tooltip-res-state');
    expect(state.className).toBe('tip-res__state is-crit');
    expect(state.textContent).toBe('Stall: alle Verbraucher laufen mit Flow 72 %');
    expect(state.querySelector('[data-icon="crit"]')).not.toBeNull();
    screen.getByTestId('resource-tooltip-energy').remove();
    renderUnit(<ResourceTooltip resource="energy" />, (m) => applyEcoPreset(m, 'overflow'));
    state = screen.getByTestId('tooltip-res-state');
    expect(state.className).toBe('tip-res__state is-warn');
    expect(state.textContent).toBe('Speicher voll: 44,0/s verfallen');
    expect(cells(screen.getByTestId('resource-tooltip-energy'))[5]).toEqual(['Prognose', 'voll']);
  });

  test('values are sampled at 4 Hz, not on every eco tick', async () => {
    const clock = fakeClock(0);
    const r = renderUnit(<ResourceTooltip resource="mass" />);
    const storage = (): string => cells(screen.getByTestId('resource-tooltip-mass'))[3]?.[1] ?? '';
    expect(storage()).toBe('312 / 1.230');
    await flushSignals(() => {
      r.model.eco.mass.stored.value = 500;
    });
    expect(storage()).toBe('312 / 1.230');
    await clock.advance(TOOLTIP_SAMPLE_MS);
    expect(storage()).toBe('500 / 1.230');
  });

  test('English', () => {
    renderUnit(<ResourceTooltip resource="energy" />, (m) => applyEcoPreset(m, 'normal'), 'en');
    const tip = screen.getByTestId('resource-tooltip-energy');
    expect(cells(tip)[5]).toEqual(['Forecast', 'full in 47 s']);
    expect(tip.querySelector('.ff-tip__role')?.textContent).toBe('Income, storage and flow');
  });
});
