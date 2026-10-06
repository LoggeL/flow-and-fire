// @vitest-environment happy-dom
import { options } from 'preact';
import type { VNode } from 'preact';
import { afterEach, describe, expect, test } from 'vitest';
import { FlowDetails, ResourceBar, ResourceMeter } from '../../src/hud/top/index.ts';
import { applyEcoPreset, applyFlowDetailsPreset, createEcoDemoTicker } from '../../src/demo/index.ts';
import { createHudModel } from '../../src/model/index.ts';
import { fireEvent, flushSignals, lastCall, renderWithHud, screen, within } from '../support/index.tsx';
import { demoUnitCatalog } from '../../src/demo/catalog.ts';

const CAT = demoUnitCatalog();

const meter = (kind: 'mass' | 'energy'): HTMLElement => screen.getByTestId(`resource-meter-${kind}`);
/** Visible text without the constant-width padding (U+2007/U+2008, padFigures). */
const text = (root: HTMLElement, id: string): string => (within(root).getByTestId(id).textContent ?? '').replace(/[\u2007\u2008]/g, '');
/** Raw text incl. padding. */
const rawText = (root: HTMLElement, id: string): string => within(root).getByTestId(id).textContent ?? '';

function renderBar(preset: Parameters<typeof applyEcoPreset>[1], locale: 'de' | 'en' = 'de') {
  const model = createHudModel({ units: CAT });
  applyEcoPreset(model, preset);
  return renderWithHud(<ResourceBar />, { model, locale });
}

describe('ResourceMeter states (ui.md §5.1)', () => {
  test('normal: storage, capacity, net with U+2212, income/usage, flow 100 %', () => {
    renderBar('normal');
    const m = meter('mass');
    expect(m.tagName).toBe('BUTTON');
    expect(m.className).toBe('res res--mass ff-panel');
    expect(m.dataset['component']).toBe('ResourceMeter');
    expect(m.dataset['panel']).toBe('res-mass');
    expect(text(m, 'meter-stored')).toBe('312/ 1.230');
    expect(text(m, 'meter-capacity')).toBe('/ 1.230');
    expect(text(m, 'meter-net')).toBe('−3,5');
    expect(within(m).getByTestId('meter-net').className).toBe('res__net num is-neg');
    expect(text(m, 'meter-income')).toBe('28,0');
    expect(text(m, 'meter-usage')).toBe('31,5');
    expect(text(m, 'meter-state')).toBe('Flow 100\u00a0%');
    expect(m.getAttribute('aria-label')).toBe('Mass: 312 von 1.230, netto −3,5 pro Sekunde, Flow 100\u00a0%');
    expect(m.getAttribute('aria-expanded')).toBe('false');
    expect(m.getAttribute('aria-controls')).toBe('ff-flow-details');
    const e = meter('energy');
    expect(text(e, 'meter-net')).toBe('+44,0');
    expect(within(e).getByTestId('meter-net').className).toContain('is-pos');
    // Storage bar: scaleX via --v, never width.
    const fill = within(m).getByTestId('meter-bar').querySelector('i') as HTMLElement;
    expect(Number(fill.style.getPropertyValue('--v'))).toBeCloseTo(312 / 1230, 4);
  });

  test('overflow: class, warn badge with symbol and text, warn bar', () => {
    renderBar('overflow');
    const e = meter('energy');
    expect(e.className).toContain('is-overflow');
    expect(e.dataset['status']).toBe('overflow');
    const badge = within(e).getByTestId('meter-badge');
    expect(badge.className).toContain('ff-badge--warn');
    expect(badge.textContent).toBe('Voll · verfällt');
    expect(badge.querySelector('[data-icon="warn"]')).not.toBeNull();
    expect(within(e).getByTestId('meter-bar').className).toContain('is-warn');
    expect(e.getAttribute('aria-label')).toContain('Voll · verfällt');
    expect(meter('mass').className).not.toContain('is-overflow');
  });

  test('stall soon: net pulses (is-soon), badge "Leer in N s", title on the net', () => {
    renderBar('stallSoon');
    const m = meter('mass');
    expect(m.className).toContain('is-stall-soon');
    const net = within(m).getByTestId('meter-net');
    expect(net.className).toBe('res__net num is-neg is-soon');
    // 38 stored at −5,5/s → 6,9 s → "Leer in 7 s".
    expect(net.getAttribute('title')).toBe('Leer in 7 s');
    expect(text(m, 'meter-badge')).toBe('Leer in 7 s');
  });

  test('stall: crit class, deficit as net, crit hatched bar, badge "Stall · Flow 72 %"', () => {
    renderBar('stall');
    const m = meter('mass');
    expect(m.className).toContain('is-stall');
    expect(text(m, 'meter-net')).toBe('−10,9'); // 28 − 38,9 (demand), not the served usage
    expect(within(m).getByTestId('meter-net').getAttribute('title')).toBe('Fehlbetrag: Einkommen − Bedarf');
    expect(text(m, 'meter-usage')).toBe('28,0');
    const badge = within(m).getByTestId('meter-badge');
    expect(badge.className).toContain('ff-badge--crit');
    expect(badge.querySelector('[data-icon="crit"]')).not.toBeNull();
    expect(badge.textContent).toBe('Stall · Flow 72\u00a0%');
    expect(within(m).getByTestId('meter-bar').className).toContain('is-crit');
  });

  test('English texts and number format', () => {
    renderBar('stall', 'en');
    const e = meter('energy');
    expect(text(e, 'meter-stored')).toBe('0/ 4,900');
    expect(text(e, 'meter-net')).toBe('−85.5');
    expect(text(e, 'meter-badge')).toBe('Stall · Flow 72%');
    expect(e.getAttribute('aria-label')).toBe('Energy: 0 of 4,900, net −85.5 per second, flow 72% · Stall · Flow 72%');
    expect(screen.getByTestId('resource-bar').getAttribute('aria-label')).toBe('Resources');
  });

  test('click toggles the flow details via the command', () => {
    const r = renderBar('normal');
    fireEvent.click(meter('energy'));
    expect(lastCall(r.log, 'toggleFlowDetails')).toEqual({ name: 'toggleFlowDetails', args: [] });
  });

  test('status changes switch the state slot (and class) when signals change', async () => {
    const r = renderBar('normal');
    await flushSignals(() => applyEcoPreset(r.model, 'stall'));
    expect(meter('mass').className).toContain('is-stall');
    expect(text(meter('mass'), 'meter-badge')).toBe('Stall · Flow 72\u00a0%');
    await flushSignals(() => applyEcoPreset(r.model, 'normal'));
    expect(meter('mass').className).toBe('res res--mass ff-panel');
    expect(text(meter('mass'), 'meter-state')).toBe('Flow 100\u00a0%');
    await flushSignals(() => {
      r.model.eco.detailsOpen.value = true;
    });
    expect(meter('mass').className).toBe('res res--mass ff-panel is-open');
    expect(meter('mass').getAttribute('aria-expanded')).toBe('true');
  });
});

describe('hot updates (ui.md §9.1/§9.2)', () => {
  const prevDiffed = options.diffed;
  afterEach(() => {
    if (prevDiffed) options.diffed = prevDiffed;
    else delete options.diffed;
  });

  test('a 10 Hz value change rewrites text nodes only, the meter never re-renders', async () => {
    let meterRenders = 0;
    options.diffed = (vnode: VNode) => {
      if (vnode.type === ResourceMeter) meterRenders++;
      prevDiffed?.(vnode);
    };
    const r = renderBar('normal');
    expect(meterRenders).toBe(2);
    const m = meter('mass');
    const storedEl = within(m).getByTestId('meter-stored');
    const storedText = storedEl.firstChild;
    const records: MutationRecord[] = [];
    const mo = new MutationObserver((list) => records.push(...list));
    mo.observe(m, { subtree: true, childList: true, characterData: true, attributes: true, attributeOldValue: true });
    // Effective attribute writes only (classList.toggle to the same state may still be reported).
    const changedAttrs = (list: readonly MutationRecord[]): (string | null)[] =>
      list
        .filter((x) => x.type === 'attributes' && (x.target as Element).getAttribute(x.attributeName ?? '') !== x.oldValue)
        .map((x) => x.attributeName);

    await flushSignals(() => {
      r.model.eco.mass.stored.value = 318.4;
    });
    records.push(...mo.takeRecords());
    expect(text(m, 'meter-stored')).toBe('318/ 1.230');
    expect(storedEl.firstChild).toBe(storedText); // same text node, new data
    expect(meterRenders).toBe(2);
    // Only leaf writes: the stored text, the aria-label and the bar's --v; no child list changes.
    expect(records.filter((x) => x.type === 'childList')).toEqual([]);
    expect(new Set(changedAttrs(records))).toEqual(new Set(['aria-label', 'style']));
    expect(records.some((x) => x.type === 'characterData')).toBe(true);

    // A change that does not alter the formatted string writes nothing.
    records.length = 0;
    await flushSignals(() => {
      r.model.eco.mass.stored.value = 318.3;
    });
    records.push(...mo.takeRecords());
    expect(records.filter((x) => x.type !== 'attributes')).toEqual([]);
    expect(changedAttrs(records).filter((a) => a !== 'style')).toEqual([]);

    // 50 ticks of the demo driver: still no re-render of the meters.
    const ticker = createEcoDemoTicker(r.model, 7);
    for (let i = 0; i < 50; i++) await flushSignals(() => ticker.step());
    mo.disconnect();
    expect(meterRenders).toBe(2);
  });
});

describe('FlowDetails (ui.md §5.1)', () => {
  function renderDetails(preset: Parameters<typeof applyFlowDetailsPreset>[1], locale: 'de' | 'en' = 'de') {
    const model = createHudModel({ units: CAT });
    applyFlowDetailsPreset(model, preset);
    return renderWithHud(<FlowDetails />, { model, locale });
  }

  test('closed renders nothing', () => {
    renderDetails('closed');
    expect(screen.queryByTestId('flow-details')).toBeNull();
  });

  test('open, read-only: rows per resource with got / want, no pause buttons, priority, hint', () => {
    renderDetails('open');
    const d = screen.getByTestId('flow-details');
    expect(d.id).toBe('ff-flow-details');
    expect(d.dataset['panel']).toBe('flow-details');
    expect(within(d).getByTestId('flow-state').textContent).toBe('kein Engpass');
    const mass = within(d).getByTestId('flow-col-mass');
    // Largest mass consumers first; the upkeep row has no mass request.
    const rows = within(mass).getAllByTestId(/^flow-row-mass-/);
    expect(rows.map((x) => x.dataset['consumer'])).toEqual(['1', '4', '2', '3']);
    expect(rows[0]?.querySelector('.flow__name')?.textContent).toBe('Landwerk I · Punze');
    expect(rows[1]?.querySelector('.flow__name')?.textContent).toBe('Zapfstelle I → II');
    expect(rows[3]?.querySelector('.flow__name')?.textContent).toBe('Lehrling ×2 · Zapfstelle I');
    expect(rows[0]?.querySelector('.flow__got')?.textContent).toBe('10,9');
    expect(rows[0]?.querySelector('.want')?.textContent).toBe('/ 10,9');
    const energyRows = within(within(d).getByTestId('flow-col-energy')).getAllByTestId(/^flow-row-energy-/);
    expect(energyRows.map((x) => x.querySelector('.flow__name')?.textContent)).toContain('Horcher I (Unterhalt)');
    expect(within(d).queryAllByRole('button')).toEqual([]);
    expect(within(d).getByTestId('flow-readonly').textContent).toBe('nur Anzeige (Pausieren ab E13)');
    expect(d.textContent).toContain('Stall-Priorität: Fabriken ▸ Engineers ▸ Upgrades ▸ Unterhalt');
    expect(within(d).queryByTestId('flow-paused')).toBeNull();
  });

  test('row paused: struck-through, play button, counter, pause command', () => {
    const r = renderDetails('paused');
    const d = screen.getByTestId('flow-details');
    const row = within(d).getByTestId('flow-row-mass-4');
    expect(row.className).toContain('is-paused');
    expect(row.querySelector('.flow__got')?.textContent).toBe('0,0');
    const resume = within(d).getByTestId('flow-pause-mass-4');
    expect(resume.getAttribute('aria-pressed')).toBe('true');
    expect(resume.getAttribute('aria-label')).toBe('Zapfstelle I → II fortsetzen');
    expect(resume.className).toContain('is-on');
    expect(within(d).getByTestId('flow-paused').textContent).toBe('1 pausiert');
    fireEvent.click(resume);
    expect(lastCall(r.log, 'pauseConsumer')?.args).toEqual([4, false]);
    const pause = within(d).getByTestId('flow-pause-energy-1');
    expect(pause.getAttribute('aria-label')).toBe('Landwerk I · Punze pausieren');
    fireEvent.click(pause);
    expect(lastCall(r.log, 'pauseConsumer')?.args).toEqual([1, true]);
    expect(within(d).queryByTestId('flow-readonly')).toBeNull();
  });

  test('bottleneck: crit badge in the head, every running row marked', () => {
    renderDetails('bottleneck');
    const d = screen.getByTestId('flow-details');
    const head = within(d).getByTestId('flow-state');
    expect(head.className).toContain('ff-badge--crit');
    expect(head.textContent).toBe('alle Verbraucher 72\u00a0%');
    const row = within(d).getByTestId('flow-row-energy-1');
    expect(row.className).toContain('is-bottleneck');
    expect(row.querySelector('.flow__got')?.getAttribute('title')).toBe('Engpass: Landwerk I · Punze erhält 39,2 von 54,4');
  });

  test('English', () => {
    renderDetails('bottleneck', 'en');
    const d = screen.getByTestId('flow-details');
    expect(within(d).getByTestId('flow-state').textContent).toBe('all consumers 72%');
    expect(d.textContent).toContain('Stall priority: Factories ▸ Engineers ▸ Upgrades ▸ Upkeep');
    expect(within(d).getByTestId('flow-row-mass-3').querySelector('.flow__name')?.textContent).toBe('Prentice ×2 · Tap I');
  });

  test('ResourceBar shows the details when opened', async () => {
    const r = renderBar('normal');
    expect(screen.queryByTestId('flow-details')).toBeNull();
    await flushSignals(() => applyFlowDetailsPreset(r.model, 'open'));
    expect(screen.getByTestId('flow-details')).not.toBeNull();
  });
});

describe('constant-width values (no layout shift at 10 Hz, ui.md §9.2)', () => {
  test('net, stored, income/usage and flow keep their rendered width when the digit count changes', async () => {
    const r = renderBar('normal');
    const m = meter('mass');
    const shape = (s: string): string => s.replace(/[0-9+−±\u2007]/gu, 'W').replace(/[.,\u2008]/g, 'n');
    const sample = (): string[] => ['meter-net', 'meter-stored', 'meter-income', 'meter-usage'].map((id) => shape(rawText(m, id)));
    await flushSignals(() => {
      r.model.eco.mass.stored.value = 7;
      r.model.eco.mass.income.value = 10.4;
      r.model.eco.mass.demand.value = 1.1;
      r.model.eco.mass.served.value = 1.1;
    });
    const small = sample();
    await flushSignals(() => {
      r.model.eco.mass.stored.value = 12_345;
      r.model.eco.mass.income.value = 312.5;
      r.model.eco.mass.demand.value = 435.9;
      r.model.eco.mass.served.value = 99.9;
    });
    // Same multiset of glyph classes (digit-wide W, separator-wide n) → same width with tabular figures.
    const sorted = (a: string[]): string[] => a.map((x) => [...x].sort().join(''));
    expect(sorted(sample())).toEqual(sorted(small));
    expect(text(m, 'meter-net')).toBe('−123,4');
    // The accessible name keeps the unpadded values.
    expect(m.getAttribute('aria-label')).not.toMatch(/[\u2007\u2008]/);
  });
});
