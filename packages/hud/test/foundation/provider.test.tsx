// @vitest-environment happy-dom
import { render } from '@testing-library/preact';
import { describe, expect, test } from 'vitest';
import {
  HudProvider,
  applyUiSettings,
  autoScale,
  bindUiSettings,
  createHudModel,
  createRecordingCommands,
  locale,
  t,
  useCommands,
  useHud,
} from '../../src/index.ts';
import { fakeClock, fireEvent, flushSignals, lastCall, renderWithHud, screen } from '../support/index.tsx';
import { demoUnitCatalog } from '../../src/demo/catalog.ts';

const CAT = demoUnitCatalog();

function Probe() {
  const model = useHud();
  const commands = useCommands();
  return (
    <button type="button" data-testid="probe" onClick={() => commands.changeSpeed(1)}>
      {model.match.speed}
      {t('ui.common.back')}
    </button>
  );
}

describe('HudProvider', () => {
  test('provides model and commands; clicks reach the recording commands', async () => {
    const { model, log } = renderWithHud(<Probe />);
    const btn = screen.getByTestId('probe');
    expect(btn.textContent).toBe('1Zurück');
    fireEvent.click(btn);
    expect(log).toEqual([{ name: 'changeSpeed', args: [1] }]);
    expect(lastCall(log, 'changeSpeed')?.args).toEqual([1]);
    await flushSignals(() => {
      model.match.speed.value = 2;
    });
    expect(btn.textContent).toBe('2Zurück');
  });

  test('renderWithHud sets the locale and components follow it', async () => {
    renderWithHud(<Probe />, { locale: 'en' });
    expect(screen.getByTestId('probe').textContent).toBe('1Back');
    await flushSignals(() => {
      locale.value = 'de';
    });
    expect(screen.getByTestId('probe').textContent).toBe('1Zurück');
  });

  test('custom model and commands are used as given', () => {
    const model = createHudModel({ units: CAT });
    model.match.speed.value = 3;
    const rec = createRecordingCommands();
    renderWithHud(<Probe />, { model, commands: rec.commands });
    fireEvent.click(screen.getByTestId('probe'));
    expect(screen.getByTestId('probe').textContent).toBe('3Zurück');
    expect(rec.log).toHaveLength(1);
  });

  test('useHud outside a provider throws a clear error', () => {
    expect(() => render(<Probe />)).toThrow(/outside <HudProvider>/);
  });

  test('noop commands by default', () => {
    render(
      <HudProvider model={createHudModel({ units: CAT })}>
        <Probe />
      </HudProvider>,
    );
    expect(() => fireEvent.click(screen.getByTestId('probe'))).not.toThrow();
  });
});

describe('test support', () => {
  test('locale is reset after the previous test', () => {
    expect(locale.value).toBe('de');
  });

  test('fakeClock drives timers and animation frames', async () => {
    const clock = fakeClock(1000);
    const seen: string[] = [];
    setTimeout(() => seen.push('timeout'), 350);
    requestAnimationFrame(() => seen.push('raf'));
    await clock.frame();
    expect(seen).toEqual(['raf']);
    await clock.advance(400);
    expect(seen).toEqual(['raf', 'timeout']);
    expect(clock.now()).toBe(1416);
    expect(performance.now()).toBeGreaterThanOrEqual(416);
  });
});

describe('UI settings on the root', () => {
  test('applyUiSettings sets font-size, --ui-scale, data-teams, data-motion', () => {
    const root = document.createElement('div');
    applyUiSettings(root, { scale: 1.25, teams: 'cvd', reducedMotion: 'on' });
    expect(root.style.fontSize).toBe('20px');
    expect(root.style.getPropertyValue('--ui-scale')).toBe('1.25');
    expect(root.dataset['teams']).toBe('cvd');
    expect(root.dataset['motion']).toBe('reduce');
    applyUiSettings(root, { reducedMotion: 'off' });
    expect(root.dataset['motion']).toBe('full');
    applyUiSettings(root, { reducedMotion: 'system' });
    expect(root.dataset['motion']).toBeUndefined();
    expect(root.dataset['teams']).toBe('cvd');
  });

  test('bindUiSettings follows the model', () => {
    const root = document.createElement('div');
    const model = createHudModel({ units: CAT });
    const dispose = bindUiSettings(root, model);
    expect(root.style.fontSize).toBe('16px');
    expect(root.dataset['teams']).toBe('house');
    model.scale.value = 0.8;
    model.teams.value = 'relation';
    expect(root.style.fontSize).toBe('12.8px');
    expect(root.dataset['teams']).toBe('relation');
    dispose();
    model.scale.value = 1.5;
    expect(root.style.fontSize).toBe('12.8px');
  });

  test('autoScale: 1.0 at 1080p, 1.25 at 1440p, clamped 0.8–1.5', () => {
    expect(autoScale(1080)).toBe(1);
    expect(autoScale(1440)).toBe(1.25);
    expect(autoScale(2160)).toBe(1.5);
    expect(autoScale(720)).toBe(0.8);
    expect(autoScale(4320)).toBe(1.5);
  });
});
