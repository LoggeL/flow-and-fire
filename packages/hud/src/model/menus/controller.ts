import { batch } from '@preact/signals';
import type { MenuCommands } from '../../commands/menus.ts';
import { setLocale } from '../../i18n/locale.ts';
import type { Locale } from '../../i18n/locale.ts';
import type { GameMenuSection } from './gamemenu.ts';
import type { ScoreSection } from './score.ts';
import type { Signal } from '@preact/signals';
import type { MotionSetting, SettingKey, SettingsSection, SettingsValues } from './settings.ts';
import { applySetting, resetSettingsValues } from './settings.ts';
import { patchSkirmish, skirmishConfig } from './skirmish.ts';
import type { SkirmishConfig, SkirmishSection, TeamColorMode } from './skirmish.ts';

/** Menu sections the controller writes (structural subset of MenusModel; no import of model/index.ts). */
export interface MenuControllerSections {
  readonly skirmish: SkirmishSection;
  readonly gameMenu: GameMenuSection;
  readonly settings: SettingsSection;
  readonly score: ScoreSection;
}

/** Model parts the menu controller writes (a HudModel satisfies it). */
export interface MenuControllerModel {
  readonly locale: Signal<Locale>;
  readonly teams: Signal<TeamColorMode>;
  readonly reducedMotion: Signal<MotionSetting>;
  readonly menus: MenuControllerSections;
}

/** Menu commands that only change model state (navigation, sim start, audio … stay with the game). */
export type MenuStateCommands = Pick<
  MenuCommands,
  | 'setLocale'
  | 'updateSkirmish'
  | 'setSetting'
  | 'resetSettings'
  | 'setSettingsTab'
  | 'openSettings'
  | 'setScoreTab'
  | 'resume'
  | 'askSurrender'
  | 'saveReplay'
>;

/**
 * Reference implementation of the state-only menu commands against the model (used by the gallery and
 * tests, and the template for the game in MS9): settings go through `applySetting` (validation + presets),
 * lobby patches through `patchSkirmish`, the language and the root-level UI settings follow the values.
 */
export function createMenuController(model: MenuControllerModel): MenuStateCommands {
  const { menus } = model;
  const syncRoot = (v: SettingsValues): void => {
    if (v.locale !== model.locale.peek() && model.locale.peek() !== 'pseudo') setLocale(v.locale);
    model.teams.value = v.teamColors;
    model.reducedMotion.value = v.reducedMotion;
  };
  return {
    setLocale(l: Locale) {
      batch(() => {
        setLocale(l);
        if (l === 'de' || l === 'en') menus.settings.values.value = applySetting(menus.settings.values.peek(), 'locale', l);
      });
    },
    updateSkirmish(patch: Partial<SkirmishConfig>) {
      const s = menus.skirmish;
      const next = patchSkirmish(skirmishConfig(s), patch, s.maps.peek());
      batch(() => {
        s.selectedMap.value = next.mapId;
        s.slots.value = next.slots;
        s.rules.value = next.rules;
      });
    },
    setSetting<K extends SettingKey>(key: K, value: SettingsValues[K]) {
      const next = applySetting(menus.settings.values.peek(), key, value);
      batch(() => {
        menus.settings.values.value = next;
        syncRoot(next);
      });
    },
    resetSettings() {
      const next = resetSettingsValues(menus.settings.values.peek(), menus.settings.defaults.peek());
      batch(() => {
        menus.settings.values.value = next;
        syncRoot(next);
      });
    },
    setSettingsTab(tab) {
      menus.settings.tab.value = tab;
    },
    openSettings(tab) {
      batch(() => {
        menus.settings.tab.value = tab;
        menus.gameMenu.open.value = false;
        menus.gameMenu.confirmSurrender.value = false;
      });
    },
    setScoreTab(tab) {
      menus.score.tab.value = tab;
    },
    resume() {
      batch(() => {
        menus.gameMenu.open.value = false;
        menus.gameMenu.confirmSurrender.value = false;
      });
    },
    askSurrender(open: boolean) {
      menus.gameMenu.confirmSurrender.value = open;
    },
    saveReplay() {
      menus.score.replaySaved.value = true;
    },
  };
}
