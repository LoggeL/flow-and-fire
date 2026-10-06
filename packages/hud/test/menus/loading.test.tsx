// @vitest-environment happy-dom
import { describe, expect, test } from 'vitest';
import { LoadingScreen, loadingHint } from '../../src/menus/loading/index.ts';
import { applyLoadingDemo } from '../../src/demo/index.ts';
import {
  LOADING_PHASE_IDS,
  PHASE_WEIGHTS,
  currentPhase,
  initialPhases,
  overallProgress,
  phasesFromGameState,
  withPhase,
} from '../../src/model/menus/loading.ts';
import type { GameLoadStateLike, LoadingPhase } from '../../src/model/menus/loading.ts';
import { fireEvent, flushSignals, screen } from '../support/index.tsx';
import { focusedId, names, renderMenu } from './helpers.tsx';

const state = (p: Partial<GameLoadStateLike>): GameLoadStateLike => ({
  phase: 'assets',
  asset: null,
  source: null,
  bytesLoaded: 0,
  bytesTotal: 0,
  fromCache: 0,
  fromNetwork: 0,
  message: null,
  ...p,
});

const summary = (ps: readonly LoadingPhase[]): string => ps.map((p) => `${p.id}:${p.state}:${Math.round(p.progress * 100)}`).join(' ');

describe('loading model (pure)', () => {
  test('five phases in order, weights sum to 1', () => {
    expect(LOADING_PHASE_IDS).toEqual(['manifest', 'assets', 'map', 'simWorker', 'aiWorker']);
    const sum = Object.values(PHASE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 9);
    expect(initialPhases().every((p) => p.state === 'pending' && p.progress === 0)).toBe(true);
  });

  test('overallProgress: done phases count fully, active ones by progress, clamped', () => {
    expect(overallProgress(initialPhases())).toBe(0);
    let ps = withPhase(initialPhases(), 'manifest', { state: 'done', progress: 0.3 });
    expect(overallProgress(ps)).toBeCloseTo(0.02, 6);
    ps = withPhase(ps, 'assets', { state: 'active', progress: 0.5 });
    expect(overallProgress(ps)).toBeCloseTo(0.02 + 0.43, 6);
    ps = withPhase(ps, 'assets', { progress: 7 });
    expect(overallProgress(ps)).toBeCloseTo(0.88, 6);
    const all = initialPhases().map((p) => ({ ...p, state: 'done' as const }));
    expect(overallProgress(all)).toBe(1);
  });

  test('currentPhase: error first, then active, then pending; null when all done', () => {
    let ps = withPhase(initialPhases(), 'manifest', { state: 'done' });
    expect(currentPhase(ps)?.id).toBe('assets');
    ps = withPhase(ps, 'map', { state: 'active' });
    expect(currentPhase(ps)?.id).toBe('map');
    ps = withPhase(ps, 'aiWorker', { state: 'error' });
    expect(currentPhase(ps)?.id).toBe('aiWorker');
    expect(currentPhase(initialPhases().map((p) => ({ ...p, state: 'done' as const })))).toBeNull();
  });

  test('phasesFromGameState maps apps/game LoadState + worker readiness onto the five phases', () => {
    const w = { simWorker: false, aiWorker: false };
    expect(summary(phasesFromGameState(state({ phase: 'manifest' }), w))).toBe(
      'manifest:active:0 assets:pending:0 map:pending:0 simWorker:pending:0 aiWorker:pending:0',
    );
    expect(summary(phasesFromGameState(state({ phase: 'assets', bytesLoaded: 71, bytesTotal: 100 }), w))).toBe(
      'manifest:done:100 assets:active:71 map:pending:0 simWorker:pending:0 aiWorker:pending:0',
    );
    expect(summary(phasesFromGameState(state({ phase: 'sim', bytesLoaded: 100, bytesTotal: 100 }), w))).toBe(
      'manifest:done:100 assets:done:100 map:active:0 simWorker:pending:0 aiWorker:pending:0',
    );
    expect(summary(phasesFromGameState(state({ phase: 'sim', bytesLoaded: 100, bytesTotal: 100 }), { simWorker: true, aiWorker: false }))).toBe(
      'manifest:done:100 assets:done:100 map:done:100 simWorker:active:0 aiWorker:pending:0',
    );
    expect(summary(phasesFromGameState(state({ phase: 'ready' }), { simWorker: true, aiWorker: false }))).toBe(
      'manifest:done:100 assets:done:100 map:done:100 simWorker:done:100 aiWorker:active:0',
    );
    expect(summary(phasesFromGameState(state({ phase: 'ready' }), { simWorker: true, aiWorker: true }))).toBe(
      'manifest:done:100 assets:done:100 map:done:100 simWorker:done:100 aiWorker:done:100',
    );
    // No AI in the match: the AI phase counts as done.
    expect(phasesFromGameState(state({ phase: 'manifest' }), { simWorker: false, aiWorker: null })[4]?.state).toBe('done');
    // Errors: during assets (bytes incomplete), before the manifest (no total), after the assets.
    expect(summary(phasesFromGameState(state({ phase: 'error', bytesLoaded: 40, bytesTotal: 100 }), w))).toBe(
      'manifest:done:100 assets:error:40 map:pending:0 simWorker:pending:0 aiWorker:pending:0',
    );
    expect(summary(phasesFromGameState(state({ phase: 'error' }), w))).toBe(
      'manifest:error:0 assets:pending:0 map:pending:0 simWorker:pending:0 aiWorker:pending:0',
    );
    expect(summary(phasesFromGameState(state({ phase: 'error', bytesLoaded: 100, bytesTotal: 100 }), w))).toBe(
      'manifest:done:100 assets:done:100 map:error:0 simWorker:pending:0 aiWorker:pending:0',
    );
  });

  test('hints rotate and wrap', () => {
    expect(loadingHint(0)).toBe(loadingHint(5));
    expect(loadingHint(-1)).toBe(loadingHint(4));
    expect(loadingHint(1)).not.toBe(loadingHint(0));
  });
});

describe('LoadingScreen (P3)', () => {
  test('running (phase 2): map, facts, houses with badges, phases, file with source, bytes, total bar', () => {
    renderMenu(<LoadingScreen />, { setup: (m) => applyLoadingDemo(m, 'running') });
    const root = screen.getByTestId('loading-screen');
    expect(root.dataset['state']).toBe('assets');
    expect(screen.getByTestId('loading-map').textContent).toBe('Setons');
    expect(root.querySelector('.load__crumb')?.textContent).toBe('Lotung läuft');
    expect(root.querySelector('.load__facts')?.textContent).toBe('AssassinationUnit-Cap 500Seed 48213');
    expect(screen.getByTestId('loading-house-0').textContent).toBe('Haus AmbrechtDu · Varkan · Start 1 Südwestbereit');
    expect(screen.getByTestId('loading-house-1').textContent).toBe('Haus DorneKI Normal · AIx ×1,3 · Start 5 Nordostwartet');
    expect(screen.getByTestId('loading-ready-0').className).toContain('ff-badge--ok');
    const phases = LOADING_PHASE_IDS.map((id) => screen.getByTestId(`phase-${id}`));
    expect(phases.map((p) => p.dataset['state'])).toEqual(['done', 'active', 'pending', 'pending', 'pending']);
    expect(phases[0]?.className).toBe('phase is-done');
    expect(phases[1]?.className).toBe('phase is-now');
    const bar = phases[1]?.querySelector('[role="progressbar"]') as HTMLElement;
    expect(bar.getAttribute('aria-valuenow')).toBe('71');
    expect(bar.getAttribute('aria-label')).toMatch(/^Assets: läuft, 71\s%$/);
    expect((bar.querySelector('i') as HTMLElement).style.getPropertyValue('--v')).toBe('0.71');
    expect(screen.getByTestId('loading-now').textContent).toBe('Assets laden … tex/terrain_splat_rock.ktx2 (aus dem Cache)');
    expect(screen.getByTestId('loading-bytes').textContent).toMatch(/^63\s% · 38,2\sMB \/ 52,6\sMB · Cache 212 · Netz 31$/);
    const total = screen.getByTestId('loading-total');
    expect(total.getAttribute('aria-valuenow')).toBe('63');
    expect(total.className).not.toContain('is-crit');
    expect(screen.getByTestId('loading-hint').textContent).toBe(loadingHint(0));
    // Preview markers: start 1 (Ambrecht) and 5 (Dorne), static (no swap on the loading screen).
    const marks = screen.getByTestId('loading-preview').querySelectorAll('button');
    expect(Array.from(marks).map((b) => b.textContent)).toEqual(['1', '5']);
    expect((marks[0] as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId('loading-retry')).toBeNull();
  });

  test('AI worker phase: four phases done, AI badge "KI-Worker startet", no current file', () => {
    renderMenu(<LoadingScreen />, { setup: (m) => applyLoadingDemo(m, 'aiWorker') });
    expect(screen.getByTestId('loading-screen').dataset['state']).toBe('aiWorker');
    expect(screen.getByTestId('loading-now').textContent).toBe('KI-Worker startet … ');
    expect(screen.queryByTestId('loading-file')).toBeNull();
    expect(screen.getByTestId('loading-ready-1').textContent).toBe('KI-Worker startet');
    expect(screen.getByTestId('phase-simWorker').dataset['state']).toBe('done');
    expect(screen.getByTestId('loading-hint').textContent).toBe(loadingHint(2));
  });

  test('error: badge + cause, focus on "Erneut", retry and back to the menu', () => {
    const r = renderMenu(<LoadingScreen />, { setup: (m) => applyLoadingDemo(m, 'error') });
    expect(screen.getByTestId('loading-screen').dataset['state']).toBe('error');
    expect(screen.getByTestId('loading-failed').textContent).toBe('Laden fehlgeschlagen');
    expect(screen.getByTestId('loading-cause').textContent).toBe('tex/terrain_splat_rock.ktx2: HTTP 404');
    expect(screen.getByTestId('phase-assets').className).toBe('phase is-error');
    expect(screen.getByTestId('loading-total').className).toContain('is-crit');
    expect(screen.getByTestId('loading-screen').querySelector('.load__crumb')?.textContent).toBe('Lotung unterbrochen');
    expect(focusedId()).toBe('loading-retry');
    fireEvent.click(screen.getByTestId('loading-retry'));
    fireEvent.click(screen.getByTestId('loading-to-menu'));
    expect(names(r.calls)).toEqual(['retryLoading', 'backToMenu']);
  });

  test('progress updates re-render bars and texts; ready state', async () => {
    const r = renderMenu(<LoadingScreen />, { setup: (m) => applyLoadingDemo(m, 'running') });
    const l = r.model.menus.loading;
    await flushSignals(() => {
      l.phases.value = withPhase(l.phases.peek(), 'assets', { progress: 0.9 });
      l.currentFile.value = { path: 'mesh/tank.glb', source: 'network' };
      l.hintIndex.value = 3;
    });
    expect(screen.getByTestId('phase-assets').querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('90');
    expect(screen.getByTestId('loading-file').textContent).toBe('mesh/tank.glb (aus dem Netz)');
    expect(screen.getByTestId('loading-hint').textContent).toBe(loadingHint(3));
    await flushSignals(() => applyLoadingDemo(r.model, 'ready'));
    expect(screen.getByTestId('loading-screen').dataset['state']).toBe('ready');
    expect(screen.getByTestId('loading-now').textContent).toBe('Bereit ');
    expect(screen.getByTestId('loading-total').getAttribute('aria-valuenow')).toBe('100');
  });

  test('EN texts', () => {
    renderMenu(<LoadingScreen />, { setup: (m) => applyLoadingDemo(m, 'error'), locale: 'en' });
    expect(screen.getByTestId('loading-failed').textContent).toBe('Loading failed');
    expect(screen.getByTestId('loading-retry').textContent).toBe('Retry');
  });
});
