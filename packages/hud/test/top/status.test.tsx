// @vitest-environment happy-dom
import { options } from 'preact';
import type { VNode } from 'preact';
import { afterEach, describe, expect, test } from 'vitest';
import { MatchStatus, PauseBanner } from '../../src/hud/top/index.ts';
import { applyBannerPreset, applyMatchPreset } from '../../src/demo/index.ts';
import type { BannerPreset, MatchPreset } from '../../src/demo/index.ts';
import { createHudModel } from '../../src/model/index.ts';
import { fireEvent, flushSignals, lastCall, renderWithHud, screen, within } from '../support/index.tsx';
import { demoUnitCatalog } from '../../src/demo/catalog.ts';

const CAT = demoUnitCatalog();

function renderStatus(preset: MatchPreset, locale: 'de' | 'en' = 'de') {
  const model = createHudModel({ units: CAT });
  applyMatchPreset(model, preset);
  return renderWithHud(<MatchStatus />, { model, locale });
}

describe('MatchStatus (ui.md §5.2)', () => {
  test('normal: timer mm:ss, ×1,0, units / cap, no scores, panel markup', () => {
    renderStatus('normal');
    const s = screen.getByTestId('match-status');
    expect(s.className).toBe('status ff-panel');
    expect(s.dataset['component']).toBe('MatchStatus');
    expect(s.dataset['panel']).toBe('status');
    expect(s.getAttribute('aria-label')).toBe('Partiestatus');
    expect(screen.getByTestId('status-timer').textContent).toBe('11:42');
    expect(screen.getByTestId('status-timer').getAttribute('title')).toBe('Spielzeit (Sim-Zeit)');
    expect(screen.getByTestId('status-speed-value').textContent).toBe('×1,0');
    expect(screen.getByTestId('status-speed').className).toBe('stat stat--speed');
    const cap = screen.getByTestId('status-cap');
    expect(cap.className).toBe('stat stat--cap');
    expect(cap.textContent).toBe('64/ 500');
    expect(cap.getAttribute('aria-label')).toBe('Einheiten 64 von 500');
    expect(screen.queryByTestId('status-score')).toBeNull();
    expect(screen.getByTestId('status-menu').getAttribute('aria-label')).toBe('Menü (Esc)');
  });

  test('speed ≠ 1 is ember (is-changed); cap near / reached swap class and symbol', () => {
    renderStatus('speed');
    expect(screen.getByTestId('status-speed').className).toContain('is-changed');
    expect(screen.getByTestId('status-speed-value').textContent).toBe('×2,0');
  });

  test('cap near and reached', async () => {
    const r = renderStatus('capNear');
    let cap = screen.getByTestId('status-cap');
    expect(cap.className).toBe('stat stat--cap is-near');
    expect(cap.querySelector('[data-icon="warn"]')).not.toBeNull();
    expect(cap.getAttribute('aria-label')).toBe('Unit-Cap fast erreicht: 462 von 500');
    await flushSignals(() => applyMatchPreset(r.model, 'capReached'));
    cap = screen.getByTestId('status-cap');
    expect(cap.className).toBe('stat stat--cap is-reached');
    expect(cap.querySelector('[data-icon="crit"]')).not.toBeNull();
    expect(cap.getAttribute('aria-label')).toBe('Unit-Cap erreicht: 500 von 500');
  });

  test('scores only in replays; long matches use h:mm:ss', async () => {
    const r = renderStatus('replay');
    const score = screen.getByTestId('status-score');
    expect(score.textContent).toBe('8.4127.980');
    expect(score.getAttribute('title')).toBe('Punkte: eigenes Haus 8.412, Gegner 7.980');
    await flushSignals(() => {
      r.model.match.replay.value = false;
    });
    expect(screen.queryByTestId('status-score')).toBeNull();
    await flushSignals(() => applyMatchPreset(r.model, 'long'));
    expect(screen.getByTestId('status-timer').textContent).toBe('1:02:05');
  });

  test('buttons call changeSpeed(−1/+1) and openGameMenu', () => {
    const r = renderStatus('normal');
    fireEvent.click(screen.getByTestId('status-slower'));
    expect(lastCall(r.log, 'changeSpeed')?.args).toEqual([-1]);
    fireEvent.click(screen.getByTestId('status-faster'));
    expect(lastCall(r.log, 'changeSpeed')?.args).toEqual([1]);
    fireEvent.click(screen.getByTestId('status-menu'));
    expect(lastCall(r.log, 'openGameMenu')).toEqual({ name: 'openGameMenu', args: [] });
    expect(screen.getByTestId('status-slower').getAttribute('aria-label')).toBe('Sim-Tempo verringern (−)');
  });

  test('English', () => {
    renderStatus('capReached', 'en');
    expect(screen.getByTestId('status-cap').getAttribute('aria-label')).toBe('Unit cap reached: 500 of 500');
    expect(screen.getByTestId('status-speed-value').textContent).toBe('×1.0');
    expect(screen.getByTestId('status-menu').getAttribute('aria-label')).toBe('Menu (Esc)');
  });

  const prevDiffed = options.diffed;
  afterEach(() => {
    if (prevDiffed) options.diffed = prevDiffed;
    else delete options.diffed;
  });

  test('1 Hz timer and unit count update without re-rendering the status', async () => {
    let renders = 0;
    options.diffed = (vnode: VNode) => {
      if (vnode.type === MatchStatus) renders++;
      prevDiffed?.(vnode);
    };
    const r = renderStatus('normal');
    expect(renders).toBe(1);
    await flushSignals(() => {
      r.model.match.timeS.value = 703;
      r.model.match.units.value = 65;
    });
    expect(screen.getByTestId('status-timer').textContent).toBe('11:43');
    expect(screen.getByTestId('status-units').textContent).toBe('65');
    expect(renders).toBe(1);
  });
});

function renderBanner(preset: BannerPreset, locale: 'de' | 'en' = 'de') {
  const model = createHudModel({ units: CAT });
  applyBannerPreset(model, preset);
  return renderWithHud(<PauseBanner />, { model, locale });
}

describe('PauseBanner (ui.md §5.3)', () => {
  test('nothing without pause, speed, lag or context loss', () => {
    renderBanner('none');
    expect(screen.queryByTestId('pause-banner')).toBeNull();
  });

  test('pause: title, sub line with key P, resume button', () => {
    const r = renderBanner('pause');
    const b = screen.getByTestId('pause-banner');
    expect(b.className).toBe('banner ff-panel ff-panel--ember');
    expect(b.dataset['kind']).toBe('pause');
    expect(b.getAttribute('role')).toBe('status');
    expect(b.textContent).toBe('PAUSESim angehalten · Kamera und Befehle bleiben aktiv · Pfortsetzen');
    const resume = within(b).getByTestId('banner-resume');
    expect(resume.getAttribute('aria-label')).toBe('fortsetzen (P)');
    fireEvent.click(resume);
    expect(lastCall(r.log, 'togglePause')).toEqual({ name: 'togglePause', args: [] });
  });

  test('background pause, speed, sim lag, context loss', async () => {
    const r = renderBanner('background');
    expect(screen.getByTestId('pause-banner').textContent).toBe('PAUSEPausiert – Tab war verborgen · Pfortsetzen');
    await flushSignals(() => applyBannerPreset(r.model, 'speed'));
    let b = screen.getByTestId('pause-banner');
    expect(b.className).toBe('banner banner--speed ff-panel');
    expect(b.textContent).toBe('SIM-TEMPO ×2,0');
    await flushSignals(() => applyBannerPreset(r.model, 'lag'));
    b = screen.getByTestId('pause-banner');
    expect(b.className).toBe('banner banner--note banner--lag ff-panel');
    expect(b.textContent).toBe('Sim hinkt nach · ×0,8 effektiv');
    expect(b.querySelector('[data-level="warn"]')).not.toBeNull();
    await flushSignals(() => applyBannerPreset(r.model, 'contextLoss'));
    b = screen.getByTestId('pause-banner');
    expect(b.className).toBe('banner banner--note banner--context ff-panel');
    expect(b.textContent).toBe('Grafik wird wiederhergestellt · Sim läuft weiter');
    expect(b.querySelector('[data-level="info"]')).not.toBeNull();
    await flushSignals(() => applyBannerPreset(r.model, 'none'));
    expect(screen.queryByTestId('pause-banner')).toBeNull();
  });

  test('English', async () => {
    const r = renderBanner('pause', 'en');
    expect(screen.getByTestId('pause-banner').textContent).toBe('PAUSEDSim halted · camera and orders stay active · Presume');
    await flushSignals(() => applyBannerPreset(r.model, 'lag'));
    expect(screen.getByTestId('pause-banner').textContent).toBe('Sim is lagging · ×0.8 effective');
  });
});
