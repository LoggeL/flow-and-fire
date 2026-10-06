// @vitest-environment happy-dom
import { describe, expect, test } from 'vitest';
import { AlertFeed } from '../../src/hud/top/index.ts';
import { DEMO_TIME_S, applyAlertEvents, applyAlertPreset, demoAlertEvent } from '../../src/demo/index.ts';
import type { AlertPreset } from '../../src/demo/index.ts';
import { ALERT_TYPES, createHudModel, tickAlerts } from '../../src/model/index.ts';
import type { HudModel } from '../../src/model/index.ts';
import { fireEvent, flushSignals, lastCall, renderWithHud, screen, within } from '../support/index.tsx';
import { demoUnitCatalog } from '../../src/demo/catalog.ts';

const CAT = demoUnitCatalog();

function renderFeed(preset: AlertPreset, locale: 'de' | 'en' = 'de', tweak?: (m: HudModel) => void) {
  const model = createHudModel({ units: CAT });
  applyAlertPreset(model, preset);
  tweak?.(model);
  return renderWithHud(<AlertFeed />, { model, locale });
}

const alerts = (): HTMLElement[] => screen.queryAllByTestId(/^alert-\d+$/);

describe('Alert (ui.md §5.11)', () => {
  test('critical: octagon, title, meta, newest carries Space, flashes, feed is assertive', () => {
    const r = renderFeed('commanderDanger');
    const feed = screen.getByTestId('alert-feed');
    expect(feed.getAttribute('aria-live')).toBe('assertive');
    expect(feed.dataset['panel']).toBe('alerts');
    const [a] = alerts();
    expect(a?.className).toBe('ff-alert ff-alert--crit is-new');
    expect(a?.dataset['component']).toBe('Alert');
    expect(within(a as HTMLElement).getByTestId('alert-title').textContent).toBe('Vogt unter Feuer');
    expect(within(a as HTMLElement).getByTestId('alert-meta').textContent).toBe('Vogt · Basis · vor 0 s');
    const level = a?.querySelector('[data-component="LevelSymbol"]');
    expect(level?.getAttribute('aria-label')).toBe('Kritisch');
    expect(level?.querySelector('[data-icon="crit"]')).not.toBeNull();
    const jump = within(a as HTMLElement).getByRole('button');
    expect(jump.textContent).toBe('␣');
    expect(jump.getAttribute('aria-label')).toBe('Vogt unter Feuer – zum Ort springen (Leertaste)');
    fireEvent.click(jump);
    expect(lastCall(r.log, 'jumpToAlert')?.args).toEqual([1]);
    expect(screen.queryByTestId('alerts-more')).toBeNull();
  });

  test('no flash with reduced motion "on"', () => {
    renderFeed('commanderDanger', 'de', (m) => {
      m.reducedMotion.value = 'on';
    });
    expect(alerts()[0]?.className).toBe('ff-alert ff-alert--crit');
  });

  test('warning, info, success: level classes and symbols, polite feed, subject in title for ok alerts', () => {
    renderFeed('unitAttacked');
    expect(screen.getByTestId('alert-feed').getAttribute('aria-live')).toBe('polite');
    let a = alerts()[0] as HTMLElement;
    expect(a.className).toBe('ff-alert ff-alert--warn');
    expect(a.querySelector('[data-icon="warn"]')).not.toBeNull();
    expect(within(a).getByTestId('alert-meta').textContent).toBe('Funke · Kartenmitte · vor 4 s');
    screen.getByTestId('alert-feed').remove();

    renderFeed('enemyCommanderSpotted');
    a = alerts().at(-1) as HTMLElement;
    expect(a.className).toBe('ff-alert ff-alert--info');
    expect(a.querySelector('[data-icon="info"]')).not.toBeNull();
    expect(within(a).getByTestId('alert-title').textContent).toBe('Feind-Vogt gesichtet');

    renderFeed('buildComplete');
    a = alerts().at(-1) as HTMLElement;
    expect(a.className).toBe('ff-alert ff-alert--ok');
    expect(a.querySelector('[data-icon="ok"]')).not.toBeNull();
    expect(within(a).getByTestId('alert-title').textContent).toBe('Bau fertig: Zapfstelle I');
    expect(within(a).getByTestId('alert-meta').textContent).toBe('Süd · vor 4 s');
  });

  test('merged: title ×3', () => {
    renderFeed('merged');
    const [a] = alerts();
    expect(a?.dataset['count']).toBe('3');
    expect(within(a as HTMLElement).getByTestId('alert-title').textContent).toBe('Einheit angegriffen ×3');
  });

  test('stale from 20 s (1 Hz binding, class only), removed after 60 s', async () => {
    const r = renderFeed('unitAttacked', 'de', (m) => applyAlertEvents(m, [demoAlertEvent('unitAttacked', DEMO_TIME_S)], DEMO_TIME_S));
    const a = alerts()[0] as HTMLElement;
    expect(a.className).toBe('ff-alert ff-alert--warn');
    await flushSignals(() => {
      r.model.match.timeS.value = DEMO_TIME_S + 19;
    });
    expect(a.className).toBe('ff-alert ff-alert--warn');
    expect(within(a).getByTestId('alert-meta').textContent).toBe('Funke · Kartenmitte · vor 19 s');
    await flushSignals(() => {
      r.model.match.timeS.value = DEMO_TIME_S + 20;
    });
    expect(alerts()[0]).toBe(a); // same node, only the class changed
    expect(a.className).toBe('ff-alert ff-alert--warn is-stale');
    await flushSignals(() => {
      r.model.match.timeS.value = DEMO_TIME_S + 75;
    });
    expect(within(a).getByTestId('alert-meta').textContent).toBe('Funke · Kartenmitte · vor 1 min');
    await flushSignals(() => {
      tickAlerts(r.model.alerts, DEMO_TIME_S + 75);
    });
    expect(alerts()).toEqual([]);
    const more = screen.getByTestId('alerts-more');
    expect(more.textContent).toBe('1 ältere ·⇧␣durchblättern');
  });

  test('stale preset renders dimmed', () => {
    renderFeed('stale');
    expect(alerts()[0]?.className).toBe('ff-alert ff-alert--info is-stale');
  });

  test('mixed feed: 3 visible newest first, "2 ältere" cycles', () => {
    const r = renderFeed('mixed');
    expect(alerts().map((a) => a.dataset['type'])).toEqual(['commanderDanger', 'buildComplete', 'unitAttacked']);
    const buttons = alerts().map((a) => within(a).getByRole('button').textContent);
    expect(buttons).toEqual(['␣', 'Ort', 'Ort']);
    const more = screen.getByTestId('alerts-more');
    expect(more.textContent).toBe('2 ältere ·⇧␣durchblättern');
    expect(more.getAttribute('aria-label')).toBe('2 ältere Meldungen durchblättern (Umschalt+Leertaste)');
    fireEvent.click(more);
    expect(lastCall(r.log, 'cycleAlerts')).toEqual({ name: 'cycleAlerts', args: [] });
    fireEvent.click(within(alerts()[2] as HTMLElement).getByRole('button'));
    expect(lastCall(r.log, 'jumpToAlert')?.args).toEqual([3]);
  });

  test('stall alerts jump to the flow details; storage full has no jump button', () => {
    const r = renderFeed('energyStall');
    const a = alerts()[0] as HTMLElement;
    expect(within(a).getByTestId('alert-meta').textContent).toBe('Flow 72 % · alle Baustellen gedrosselt');
    const jump = within(a).getByRole('button');
    expect(jump.dataset['jump']).toBe('flowDetails');
    expect(jump.getAttribute('aria-label')).toBe('Energie knapp – Flow-Details öffnen (Leertaste)');
    fireEvent.click(jump);
    expect(lastCall(r.log, 'jumpToAlert')?.args).toEqual([1]);
    screen.getByTestId('alert-feed').remove();
    renderFeed('storageFull');
    expect(within(alerts().at(-1) as HTMLElement).queryByRole('button')).toBeNull();
    screen.getByTestId('alert-feed').remove();
    // Space skips an alert without target: the next one carries the key.
    renderFeed('unitAttacked', 'de', (m) =>
      applyAlertEvents(m, [demoAlertEvent('unitAttacked', DEMO_TIME_S - 3), demoAlertEvent('storageFull', DEMO_TIME_S)], DEMO_TIME_S),
    );
    expect(alerts().map((a) => a.querySelector('button')?.textContent ?? null)).toEqual([null, '␣']);
  });

  test('all 10 types render with their level', () => {
    for (const type of ALERT_TYPES) {
      renderFeed(type);
      const a = alerts().at(-1) as HTMLElement;
      expect(a.dataset['type']).toBe(type);
      expect(a.querySelector('[data-component="LevelSymbol"]')?.getAttribute('data-level')).toBe(a.dataset['level']);
      expect(within(a).getByTestId('alert-title').textContent).not.toBe('');
      screen.getByTestId('alert-feed').remove();
    }
  });

  test('English', () => {
    renderFeed('mixed', 'en');
    expect(alerts().map((a) => within(a).getByTestId('alert-title').textContent)).toEqual([
      'Reeve under fire',
      'Construction complete: Tap I',
      'Unit under attack',
    ]);
    expect(within(alerts()[2] as HTMLElement).getByTestId('alert-meta').textContent).toBe('Spark · Map centre · 9 s ago');
    expect(screen.getByTestId('alerts-more').textContent).toBe('2 older ·⇧␣cycle');
    expect(within(alerts()[1] as HTMLElement).getByRole('button').textContent).toBe('Go');
  });
});
