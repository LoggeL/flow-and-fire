// @vitest-environment happy-dom
import { describe, expect, test } from 'vitest';
import { DEMO_SETTINGS_CHANGED, applySettingsDemo } from '../../src/demo/index.ts';
import { ALL_ROWS, KEYBOARD_ROWS, Settings, capLabel, enumOptions, gridCaptions, keyKind, optionLabel, rangeView } from '../../src/menus/settings/index.ts';
import {
  DEFAULT_SETTINGS,
  GRAPHICS_PRESETS,
  LOAD_BUDGET,
  SETTING_KEYS,
  SETTING_SPECS,
  SETTINGS_TABS,
  applySetting,
  canResetSettings,
  changedSettings,
  coerceSetting,
  detectPreset,
  estimateLoad,
  isValidSetting,
  resetSettingsValues,
  sanitizeSettings,
} from '../../src/model/menus/settings.ts';
import type { SettingKey, SettingsTab } from '../../src/model/menus/settings.ts';
import { CVD_COLORS, HOUSE_COLORS, parseHex, simulateVision, teamColorCss } from '../../src/model/menus/teams.ts';
import { fireEvent, flushSignals, screen, within } from '../support/index.tsx';
import { callsOf, focusedId, key, names, renderMenu } from './helpers.tsx';
import { demoUnitCatalog } from '../../src/demo/catalog.ts';

const CAT = demoUnitCatalog();

describe('settings values (pure)', () => {
  test('defaults: every key has a spec and a valid default; Medium preset = DECISIONS 17/25 values', () => {
    expect(SETTING_KEYS.slice().sort()).toEqual((Object.keys(SETTING_SPECS) as SettingKey[]).sort());
    for (const k of SETTING_KEYS) expect(isValidSetting(k, DEFAULT_SETTINGS[k]), k).toBe(true);
    expect(DEFAULT_SETTINGS.preset).toBe('medium');
    expect(GRAPHICS_PRESETS.medium).toEqual({ renderScale: 0.8, shadows: 'blob', splatLayers: 8, particleCap: 16000, bloom: true, antialias: 'fxaa' });
    expect(GRAPHICS_PRESETS.low.shadows).toBe('off');
    expect(GRAPHICS_PRESETS.low.splatLayers).toBe(4);
    expect(GRAPHICS_PRESETS.high.shadows).toBe('csm2');
    expect(detectPreset(DEFAULT_SETTINGS)).toBe('medium');
    expect(changedSettings(DEFAULT_SETTINGS)).toEqual([]);
  });

  test('validation: types, enum members, ranges and steps', () => {
    expect(isValidSetting('volMusic', 40)).toBe(true);
    expect(isValidSetting('volMusic', 101)).toBe(false);
    expect(isValidSetting('volMusic', -1)).toBe(false);
    expect(isValidSetting('volMusic', 40.5)).toBe(false);
    expect(isValidSetting('volMusic', '40')).toBe(false);
    expect(isValidSetting('renderScale', 0.85)).toBe(true);
    expect(isValidSetting('renderScale', 0.83)).toBe(false);
    expect(isValidSetting('renderScale', 0.4)).toBe(false);
    expect(isValidSetting('splatLayers', 8)).toBe(true);
    expect(isValidSetting('splatLayers', '8')).toBe(false);
    expect(isValidSetting('uiScale', 'auto')).toBe(true);
    expect(isValidSetting('uiScale', 1.3)).toBe(false);
    expect(isValidSetting('bloom', 1)).toBe(false);
    expect(coerceSetting('renderScale', 0.8000001)).toBe(0.8);
    expect(coerceSetting('renderScale', 0.83)).toBe(0.85);
    expect(coerceSetting('renderScale', 3)).toBe(1);
    expect(coerceSetting('volSfx', -20)).toBe(0);
    expect(coerceSetting('volSfx', Number.NaN)).toBeNull();
    expect(coerceSetting('shadows', 'csm9')).toBeNull();
  });

  test('applySetting: invalid → unchanged, preset sets its values, graphics change re-derives the preset', () => {
    expect(applySetting(DEFAULT_SETTINGS, 'volMusic', 400)).toEqual({ ...DEFAULT_SETTINGS, volMusic: 100 });
    expect(applySetting(DEFAULT_SETTINGS, 'shadows', 'nope')).toBe(DEFAULT_SETTINGS);
    expect(applySetting(DEFAULT_SETTINGS, 'volMusic', DEFAULT_SETTINGS.volMusic)).toBe(DEFAULT_SETTINGS);
    const high = applySetting(DEFAULT_SETTINGS, 'preset', 'high');
    expect(high).toEqual({ ...DEFAULT_SETTINGS, ...GRAPHICS_PRESETS.high, preset: 'high' });
    const custom = applySetting(high, 'bloom', false);
    expect(custom.preset).toBe('custom');
    expect(applySetting(custom, 'bloom', true).preset).toBe('high');
    expect(applySetting(DEFAULT_SETTINGS, 'preset', 'custom')).toEqual({ ...DEFAULT_SETTINGS, preset: 'custom' });
    // Non-graphics keys keep the preset.
    expect(applySetting(high, 'volUi', 10).preset).toBe('high');
  });

  test('reset keeps the language; sanitize drops unknown keys and bad values', () => {
    const v = applySetting(applySetting(DEFAULT_SETTINGS, 'locale', 'en'), 'volSfx', 5);
    expect(resetSettingsValues(v)).toEqual({ ...DEFAULT_SETTINGS, locale: 'en' });
    expect(sanitizeSettings(null)).toBe(DEFAULT_SETTINGS);
    expect(sanitizeSettings({ volSfx: 33, bogus: 1, shadows: 'x', renderScale: 0.9 })).toEqual({
      ...DEFAULT_SETTINGS,
      volSfx: 33,
      renderScale: 0.9,
      preset: 'custom',
    });
    expect(sanitizeSettings({ ...GRAPHICS_PRESETS.high, preset: 'low' }).preset).toBe('high');
  });

  test('canResetSettings ignores the language (reset keeps it)', () => {
    expect(canResetSettings(DEFAULT_SETTINGS)).toBe(false);
    expect(canResetSettings({ ...DEFAULT_SETTINGS, locale: 'en' })).toBe(false);
    expect(canResetSettings({ ...DEFAULT_SETTINGS, volUi: 1 })).toBe(true);
  });

  test('changedSettings lists the dirty keys (ember dot)', () => {
    expect(changedSettings(DEMO_SETTINGS_CHANGED)).toEqual(['preset', 'renderScale', 'volMusic', 'keyScheme', 'teamColors', 'uiScale', 'tooltips']);
  });

  test('load estimate grows with the preset and stays inside the budget on Medium', () => {
    const low = estimateLoad(GRAPHICS_PRESETS.low);
    const med = estimateLoad(GRAPHICS_PRESETS.medium);
    const high = estimateLoad(GRAPHICS_PRESETS.high);
    expect(low.gpuMs).toBeLessThan(med.gpuMs);
    expect(med.gpuMs).toBeLessThan(high.gpuMs);
    expect(med.gpuMs).toBeLessThanOrEqual(LOAD_BUDGET.gpuMs);
    expect(high.gpuMs).toBeGreaterThan(LOAD_BUDGET.gpuMs);
    expect(med.draws).toBeLessThanOrEqual(LOAD_BUDGET.draws);
  });

  test('team colours per mode and colour-vision simulation', () => {
    expect(teamColorCss('house', 'team-gruen', 0, 'self')).toBe('var(--team-gruen)');
    expect(teamColorCss('house', 'nonsense', 0, 'self')).toBe('var(--team-self)');
    expect(teamColorCss('relation', 'team-gruen', 1, 'enemy')).toBe('var(--rel-enemy)');
    expect(teamColorCss('cvd', 'team-gruen', 1, 'enemy')).toBe('var(--cvd-rot)');
    expect(teamColorCss('cvd', 'team-gruen', 9, 'enemy')).toBe('var(--cvd-rot)');
    expect(HOUSE_COLORS).toHaveLength(8);
    expect(CVD_COLORS.slice(0, 2).map((c) => c.token)).toEqual(['cvd-blau', 'cvd-rot']);
    expect(parseHex('#0072b2')).toEqual([0, 114, 178]);
    expect(() => parseHex('red')).toThrow();
    expect(simulateVision('#0072B2', 'normal')).toBe('#0072b2');
    expect(simulateVision('#ffffff', 'deutan')).toBe('rgb(255,255,255)');
    // Red and green collapse for deutans (both end up yellowish-brown), blue stays blue.
    const red = simulateVision('#c8372d', 'deutan');
    const green = simulateVision('#3e9a4a', 'deutan');
    expect(red).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
    expect(red).not.toBe(green);
  });
});

describe('settings row layout', () => {
  test('five tabs, every setting (except none) appears exactly once', () => {
    expect(SETTINGS_TABS).toEqual(['graphics', 'audio', 'keys', 'access', 'game']);
    const keys = ALL_ROWS.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.slice().sort()).toEqual(SETTING_KEYS.slice().sort());
  });

  test('option labels and slider mapping', () => {
    expect(optionLabel('preset', 'medium')).toBe('Mittel');
    expect(optionLabel('particleCap', 16000)).toBe('16.000');
    expect(optionLabel('uiScale', 'auto', 1.25)).toBe('Auto (1,25)');
    expect(optionLabel('uiScale', 0.8)).toBe('0,8');
    expect(optionLabel('frameCap', 'monitor')).not.toBe('ui.settings.opt.frameCap.monitor');
    const r = rangeView('renderScale');
    expect([r.min, r.max, r.step]).toEqual([50, 100, 5]);
    expect(r.toUi(0.8)).toBe(80);
    expect(r.fromUi(85)).toBe(0.85);
    expect(r.text(0.8)).toMatch(/^80\s%$/);
    expect(rangeView('volMaster').text(80)).toBe('80');
    expect(enumOptions('volMaster')).toEqual([]);
  });
});

function renderSettings(tab: SettingsTab, changed = false, controller = false) {
  return renderMenu(<Settings />, { setup: (m) => applySettingsDemo(m, tab, changed), controller });
}

/** Operates the control of a row so that a different valid value is chosen; returns false when locked. */
function changeRow(key: SettingKey): boolean {
  const el = screen.getByTestId(`setting-${key}`);
  if (el.getAttribute('role') === 'switch') {
    fireEvent.click(el);
    return true;
  }
  if (el.getAttribute('role') === 'radiogroup') {
    const other = within(el)
      .getAllByRole('radio')
      .find((b) => b.getAttribute('aria-checked') === 'false' && !(b as HTMLButtonElement).disabled);
    if (!other) return false;
    fireEvent.click(other);
    return true;
  }
  if (el.tagName === 'SELECT') {
    const s = el as HTMLSelectElement;
    const other = Array.from(s.options).find((o) => o.value !== s.value);
    if (!other) return false;
    fireEvent.change(s, { target: { value: other.value } });
    return true;
  }
  const input = el as HTMLInputElement;
  const next = Number(input.value) === Number(input.min) ? Number(input.max) : Number(input.min);
  fireEvent.input(input, { target: { value: String(next) } });
  return true;
}

describe('Settings (P9, C11, P12, P16)', () => {
  test('vertical tabs: tablist semantics, ↑/↓ select (setSettingsTab), Home/End', async () => {
    const r = renderSettings('graphics', false, true);
    const tabs = screen.getByRole('tablist');
    expect(tabs.getAttribute('aria-orientation')).toBe('vertical');
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Grafik', 'Audio', 'Tasten', 'Barrierefreiheit', 'Spiel & Sprache']);
    const g = screen.getByTestId('settings-tab-graphics');
    expect(g.getAttribute('aria-selected')).toBe('true');
    expect(g.tabIndex).toBe(0);
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(g.id);
    g.focus();
    await flushSignals(() => key(g, 'ArrowDown'));
    expect(callsOf(r.calls, 'setSettingsTab')).toEqual([['audio']]);
    expect(focusedId()).toBe('settings-tab-audio');
    expect(screen.getByTestId('settings').dataset['tab']).toBe('audio');
    expect(screen.getByTestId('settings-crumb').textContent).toBe('Audio');
    await flushSignals(() => key(document.activeElement as Element, 'End'));
    expect(r.model.menus.settings.tab.value).toBe('game');
    await flushSignals(() => key(document.activeElement as Element, 'ArrowDown'));
    expect(r.model.menus.settings.tab.value).toBe('graphics');
    await flushSignals(() => key(document.activeElement as Element, 'ArrowUp'));
    expect(r.model.menus.settings.tab.value).toBe('game');
    await flushSignals(() => fireEvent.click(screen.getByTestId('settings-tab-access')));
    expect(r.model.menus.settings.tab.value).toBe('access');
    expect(screen.getByTestId('settings-pane-access')).toBeTruthy();
  });

  test.each(SETTINGS_TABS)('tab %s: every control sends setSetting(key, value) with a valid, typed value', (tab) => {
    const r = renderSettings(tab);
    const rows = ALL_ROWS.filter((row) => row.tab === tab);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      r.clearLog();
      const acted = changeRow(row.key);
      const calls = callsOf(r.calls, 'setSetting');
      if (row.locked) {
        expect(calls, row.key).toEqual([]);
        continue;
      }
      expect(acted, row.key).toBe(true);
      expect(calls, row.key).toHaveLength(1);
      const [k, v] = calls[0] as [SettingKey, unknown];
      expect(k).toBe(row.key);
      expect(isValidSetting(row.key, v), `${row.key}=${String(v)}`).toBe(true);
      expect(v, row.key).not.toEqual(DEFAULT_SETTINGS[row.key]);
      expect(typeof v === typeof DEFAULT_SETTINGS[row.key] || SETTING_SPECS[row.key].kind === 'enum', row.key).toBe(true);
    }
  });

  test('typed values: number options stay numbers (select/segmented), render scale in 0,05 steps', () => {
    const r = renderSettings('graphics');
    fireEvent.change(screen.getByTestId('setting-particleCap'), { target: { value: '64000' } });
    fireEvent.click(within(screen.getByTestId('setting-splatLayers')).getByText('4'));
    fireEvent.change(screen.getByTestId('setting-frameCap'), { target: { value: 'monitor' } });
    fireEvent.input(screen.getByTestId('setting-renderScale'), { target: { value: '65' } });
    fireEvent.click(within(screen.getByTestId('setting-preset')).getByText('Hoch'));
    expect(callsOf(r.calls, 'setSetting')).toEqual([
      ['particleCap', 64000],
      ['splatLayers', 4],
      ['frameCap', 'monitor'],
      ['renderScale', 0.65],
      ['preset', 'high'],
    ]);
    // "Eigen" cannot be chosen directly.
    expect((within(screen.getByTestId('setting-preset')).getByText('Eigen') as HTMLButtonElement).disabled).toBe(true);
  });

  test('dirty marking: changed rows carry the ember dot, reset is enabled and calls resetSettings', async () => {
    const r = renderSettings('graphics', true, true);
    expect(screen.getByTestId('row-renderScale').className).toContain('is-changed');
    expect(screen.getByTestId('row-renderScale').textContent).toContain('(geändert)');
    expect(screen.getByTestId('row-shadows').className).not.toContain('is-changed');
    expect(within(screen.getByTestId('setting-preset')).getByRole('radio', { checked: true }).textContent).toBe('Eigen');
    const reset = screen.getByTestId('settings-reset') as HTMLButtonElement;
    expect(reset.disabled).toBe(false);
    await flushSignals(() => fireEvent.click(reset));
    expect(names(r.calls)).toEqual(['resetSettings']);
    expect(r.model.menus.settings.values.value).toEqual(DEFAULT_SETTINGS);
    expect(screen.getByTestId('row-renderScale').className).not.toContain('is-changed');
    expect((screen.getByTestId('settings-reset') as HTMLButtonElement).disabled).toBe(true);
    expect(r.model.teams.value).toBe('house');
  });

  test('controller: a change marks the row dirty and syncs root settings (team colours)', async () => {
    const r = renderSettings('access', false, true);
    expect(screen.getByTestId('row-teamColors').dataset['changed']).toBeUndefined();
    await flushSignals(() => fireEvent.click(within(screen.getByTestId('setting-teamColors')).getByText('Farbenblind')));
    expect(callsOf(r.calls, 'setSetting')).toEqual([['teamColors', 'cvd']]);
    expect(r.model.teams.value).toBe('cvd');
    expect(screen.getByTestId('row-teamColors').dataset['changed']).toBe('');
    expect(screen.getByTestId('team-palette').dataset['mode']).toBe('cvd');
    await flushSignals(() => fireEvent.click(within(screen.getByTestId('setting-reducedMotion')).getByText('An')));
    expect(r.model.reducedMotion.value).toBe('on');
  });

  test('language DE/EN switches live through setSetting("locale")', async () => {
    const r = renderSettings('game', false, true);
    await flushSignals(() => fireEvent.click(within(screen.getByTestId('setting-locale')).getByText('English')));
    expect(callsOf(r.calls, 'setSetting')).toEqual([['locale', 'en']]);
    expect(r.model.locale.value).toBe('en');
    expect(screen.getByTestId('settings-tab-graphics').textContent).toBe('Graphics');
    expect(screen.getByTestId('settings-crumb').textContent).toBe('Game & language');
  });

  test('Esc, "Fertig" and the back icon close the settings', () => {
    const r = renderSettings('graphics');
    key(screen.getByTestId('settings-tab-graphics'), 'Escape');
    fireEvent.click(screen.getByTestId('settings-done'));
    fireEvent.click(screen.getByTestId('settings-back'));
    expect(names(r.calls)).toEqual(['closeSettings', 'closeSettings', 'closeSettings']);
    // Esc inside a select keeps its native meaning.
    r.clearLog();
    key(screen.getByTestId('setting-shadows'), 'Escape');
    expect(names(r.calls)).toEqual([]);
  });

  test('graphics: autodetect box (GPU, benchmark, API) with "Neu messen", load estimate card', async () => {
    const r = renderSettings('graphics');
    const det = screen.getByTestId('graphics-detect');
    expect(det.textContent).toContain('Automatisch erkannt: Mittel');
    expect(det.textContent).toContain('Intel Iris Xe · 3-s-Benchmark 64 FPS (Big-Battle-Szene) · WebGL2, EXT_color_buffer_float');
    fireEvent.click(screen.getByTestId('graphics-rerun'));
    expect(names(r.calls)).toEqual(['runGraphicsBenchmark']);
    await flushSignals(() => {
      r.model.menus.settings.detect.value = { ...r.model.menus.settings.detect.peek(), state: 'running' };
    });
    expect((screen.getByTestId('graphics-rerun') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('load-estimate').querySelectorAll('.row')).toHaveLength(4);
    expect(screen.getByTestId('load-next').textContent).toMatch(/^„Hoch“ würde ≈ \d+,\d ms GPU kosten\.$/);
  });

  test('audio: six buses, sound samples', () => {
    const r = renderSettings('audio');
    for (const k of ['volMaster', 'volSfx', 'volVoice', 'volUi', 'volMusic', 'volAmbient']) expect(screen.getByTestId(`setting-${k}`)).toBeTruthy();
    expect(screen.getByTestId('setting-volMusic-value').textContent).toBe('40');
    fireEvent.click(screen.getByTestId('probe-signature'));
    fireEvent.click(screen.getByTestId('probe-weapon'));
    fireEvent.click(screen.getByTestId('probe-alert'));
    expect(callsOf(r.calls, 'playSoundSample')).toEqual([['signature'], ['weapon'], ['alert']]);
  });

  test('keys: keyboard view with DE labels (Y on KeyZ), F-row, Tab, Entf, comma; rebinding locked', () => {
    renderSettings('keys');
    const kb = screen.getByTestId('keyboard-view');
    expect(kb.dataset['layout']).toBe('de');
    const cap = (code: string): HTMLElement => kb.querySelector(`[data-code="${code}"]`) as HTMLElement;
    expect(cap('KeyZ').querySelector('b')?.textContent).toBe('Y');
    expect(cap('Delete').querySelector('b')?.textContent).toBe('Entf');
    expect(cap('ControlLeft').querySelector('b')?.textContent).toBe('Strg');
    for (const code of ['Escape', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'Tab', 'Comma', 'Period']) expect(cap(code), code).toBeTruthy();
    expect(cap('KeyQ').dataset['kind']).toBe('grid');
    expect(cap('KeyW').dataset['kind']).toBe('grid');
    expect(cap('ArrowUp').dataset['kind']).toBe('cam');
    expect(cap('KeyB').textContent).toContain('Upgrade');
    expect(screen.getByTestId('key-combos').querySelectorAll('tbody tr')).toHaveLength(4);
    expect((screen.getByTestId('settings-rebind') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId('wasd-warning')).toBeNull();
  });

  test('keys (EN layout, WASD scheme): Z on KeyZ, W/A/S/D become camera keys, Alt+Shift warning', async () => {
    const r = renderSettings('keys', true);
    await flushSignals(() => {
      r.model.keyboardLayout.value = 'en';
    });
    const kb = screen.getByTestId('keyboard-view');
    expect(kb.dataset['scheme']).toBe('wasd');
    const cap = (code: string): HTMLElement => kb.querySelector(`[data-code="${code}"]`) as HTMLElement;
    expect(cap('KeyZ').querySelector('b')?.textContent).toBe('Z');
    expect(cap('Delete').querySelector('b')?.textContent).toBe('Del');
    expect(cap('KeyW').dataset['kind']).toBe('cam');
    expect(cap('KeyW').textContent).toContain('Schwenk');
    expect(cap('KeyQ').dataset['kind']).toBe('grid');
    expect(screen.getByTestId('wasd-warning').textContent).toContain('Alt+Shift');
  });

  test('keyboard helpers: kinds, captions from the roster, cap labels', () => {
    const all = KEYBOARD_ROWS.flat();
    expect(all.filter((c) => c.kind === 'grid')).toHaveLength(15);
    const w = all.find((c) => c.code === 'KeyW');
    expect(w && keyKind(w, 'grid')).toBe('grid');
    expect(w && keyKind(w, 'wasd')).toBe('cam');
    const q = gridCaptions(CAT, 'KeyQ', 'de');
    expect(q.units.length).toBeGreaterThan(0);
    expect(gridCaptions(CAT, 'KeyB', 'de').order).toBe('Upgrade');
    expect(capLabel('CapsLock', 'de')).toBe('⇪');
    expect(capLabel('KeyY', 'de')).toBe('Z');
  });

  test('accessibility: palette preview per mode and colour-vision simulation strips', async () => {
    const r = renderSettings('access');
    expect(screen.getByTestId('team-palette').children).toHaveLength(8);
    const sim = screen.getByTestId('cvd-simulation');
    expect(sim.getAttribute('role')).toBe('img');
    expect(sim.querySelectorAll('.cvdsim__strip')).toHaveLength(8);
    expect(sim.querySelectorAll('.cvdsim__strip i')).toHaveLength(64);
    await flushSignals(() => {
      r.model.menus.settings.values.value = { ...DEFAULT_SETTINGS, teamColors: 'relation' };
    });
    expect(screen.getByTestId('team-palette').children).toHaveLength(3);
    expect(screen.getByTestId('team-palette').textContent).toBe('EigenVerbündetFeind');
  });

  test('game & language: unit name example DE / EN comes from the roster texts', () => {
    renderSettings('game');
    const ex = screen.getByTestId('unit-name-example').textContent ?? '';
    expect(ex).toMatch(/^.+ · .+ \/ .+ · .+$/);
  });

  test('EN keyboard view labels when the UI is English', () => {
    renderMenu(<Settings />, { setup: (m) => applySettingsDemo(m, 'keys'), locale: 'en' });
    expect(screen.getByTestId('settings-tab-keys').textContent).toBe('Keys');
    expect(screen.getByTestId('keyboard-view').getAttribute('aria-label')).not.toBe('Tastatur-Ansicht');
  });
});
