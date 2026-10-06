import { afterEach, describe, expect, test } from 'vitest';
import { DEMO_DURATION_S, DEMO_MAPS, DEMO_SETTINGS_CHANGED, applyLoadingDemo, applyMainMenuDemo, applyScoreDemo, applySettingsDemo, applySkirmishDemo } from '../../src/demo/index.ts';
import { createHudModel, createMenuController, locale, setLocale } from '../../src/index.ts';
import { DEFAULT_SETTINGS, changedSettings, overallProgress, seriesSampleCount, validateSkirmish, skirmishConfig } from '../../src/index.ts';
import { demoUnitCatalog } from '../../src/demo/catalog.ts';

const CAT = demoUnitCatalog();

afterEach(() => setLocale('de'));

describe('menu demo data (deterministic fake data)', () => {
  test('lobby maps: Setons 1.024, Hollow Ridge 512, Tessera, Braidwater (locked, M8)', () => {
    expect(DEMO_MAPS.map((m) => `${m.name}:${m.sizeWu}:${m.available ? 'ok' : 'locked'}`)).toEqual([
      'Setons:1024:ok',
      'Hollow Ridge:512:ok',
      'Tessera:768:ok',
      'Braidwater:512:locked',
    ]);
    for (const m of DEMO_MAPS) {
      expect(m.startPositions).toHaveLength(m.starts);
      expect(m.resources.length).toBeGreaterThan(0);
      for (const r of m.resources) {
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.x).toBeLessThanOrEqual(1);
      }
    }
  });

  test('demo presets are valid / invalid as intended', () => {
    const m = createHudModel({ units: CAT });
    applySkirmishDemo(m);
    expect(validateSkirmish(skirmishConfig(m.menus.skirmish), DEMO_MAPS)).toEqual([]);
    applySkirmishDemo(m, 'invalid');
    expect(validateSkirmish(skirmishConfig(m.menus.skirmish), DEMO_MAPS).map((p) => p.code)).toEqual(['sameColor', 'sameTeam']);
    applySkirmishDemo(m, 'hardAix');
    expect(m.menus.skirmish.slots.value[1]?.ai).toEqual({ difficulty: 'hard', aix: true, aixFactor: 1.5 });
  });

  test('victory after 23:41 with 30-s series of equal length; identical on every call', () => {
    const a = createHudModel({ units: CAT });
    const b = createHudModel({ units: CAT });
    applyScoreDemo(a);
    applyScoreDemo(b);
    expect(a.menus.score.durationS.value).toBe(DEMO_DURATION_S);
    const n = seriesSampleCount(DEMO_DURATION_S, 30);
    for (const s of a.menus.score.series.value) {
      expect(s.stepS).toBe(30);
      expect(s.self).toHaveLength(n);
      expect(s.enemy).toHaveLength(n);
      expect(s.self.every((v) => v >= 0)).toBe(true);
    }
    expect(a.menus.score.series.value).toEqual(b.menus.score.series.value);
    expect(a.menus.score.bestUnits.value).toHaveLength(4);
    applyScoreDemo(b, 'defeat');
    expect(b.menus.score.verdict.value).toBe('defeat');
    applyScoreDemo(b, 'minimal');
    expect(b.menus.score.minimal.value).toBe(true);
  });

  test('loading presets: running at phase 2, AI worker, error, ready', () => {
    const m = createHudModel({ units: CAT });
    applyLoadingDemo(m, 'running');
    expect(m.menus.loading.phases.value.map((p) => p.state)).toEqual(['done', 'active', 'pending', 'pending', 'pending']);
    applyLoadingDemo(m, 'aiWorker');
    expect(m.menus.loading.phases.value[4]?.state).toBe('active');
    applyLoadingDemo(m, 'error');
    expect(m.menus.loading.error.value).not.toBeNull();
    applyLoadingDemo(m, 'ready');
    expect(overallProgress(m.menus.loading.phases.value)).toBe(1);
  });

  test('settings: defaults and changed values', () => {
    const m = createHudModel({ units: CAT });
    applySettingsDemo(m, 'audio');
    expect(m.menus.settings.values.value).toBe(DEFAULT_SETTINGS);
    expect(m.menus.settings.tab.value).toBe('audio');
    applySettingsDemo(m, 'graphics', true);
    expect(m.menus.settings.values.value).toBe(DEMO_SETTINGS_CHANGED);
    expect(m.menus.settings.dirty.value).toEqual(changedSettings(DEMO_SETTINGS_CHANGED));
    expect(m.teams.value).toBe('cvd');
    applyMainMenuDemo(m, 'empty');
    expect(m.menus.main.lastMatch.value).toBeNull();
  });
});

describe('createMenuController (reference implementation of the state-only commands)', () => {
  test('setLocale switches the i18n locale and the stored setting; pseudo stays out of the settings', () => {
    const m = createHudModel({ units: CAT });
    const c = createMenuController(m);
    c.setLocale('en');
    expect(locale.value).toBe('en');
    expect(m.menus.settings.values.value.locale).toBe('en');
    c.setLocale('pseudo');
    expect(locale.value).toBe('pseudo');
    expect(m.menus.settings.values.value.locale).toBe('en');
  });

  test('setSetting validates and syncs locale, team colours and motion; invalid values are ignored', () => {
    const m = createHudModel({ units: CAT });
    const c = createMenuController(m);
    c.setSetting('teamColors', 'relation');
    c.setSetting('reducedMotion', 'on');
    c.setSetting('locale', 'en');
    expect(m.teams.value).toBe('relation');
    expect(m.reducedMotion.value).toBe('on');
    expect(locale.value).toBe('en');
    const before = m.menus.settings.values.value;
    c.setSetting('volMusic', Number.NaN);
    expect(m.menus.settings.values.value).toBe(before);
    c.resetSettings();
    expect(m.teams.value).toBe('house');
    expect(m.menus.settings.values.value.locale).toBe('en');
  });

  test('lobby, tabs, in-game menu and replay flags', () => {
    const m = createHudModel({ units: CAT });
    applySkirmishDemo(m);
    const c = createMenuController(m);
    c.updateSkirmish({ mapId: 'tessera' });
    expect(m.menus.skirmish.selectedMap.value).toBe('tessera');
    expect(m.menus.skirmish.slots.value.map((s) => s.start)).toEqual([0, 2]);
    c.setSettingsTab('keys');
    expect(m.menus.settings.tab.value).toBe('keys');
    c.setScoreTab('army');
    expect(m.menus.score.tab.value).toBe('army');
    m.menus.gameMenu.open.value = true;
    c.askSurrender(true);
    expect(m.menus.gameMenu.confirmSurrender.value).toBe(true);
    c.resume();
    expect(m.menus.gameMenu.open.value).toBe(false);
    expect(m.menus.gameMenu.confirmSurrender.value).toBe(false);
    c.saveReplay();
    expect(m.menus.score.replaySaved.value).toBe(true);
  });
});
