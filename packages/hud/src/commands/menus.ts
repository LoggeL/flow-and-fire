import type { Locale } from '../i18n/locale.ts';
import type { MenuScreen } from '../model/menus/main.ts';
import type { ScoreTab } from '../model/menus/score.ts';
import type { SettingKey, SettingsTab, SettingsValues } from '../model/menus/settings.ts';
import type { SkirmishConfig } from '../model/menus/skirmish.ts';

/** Audio buses with a sound sample in the settings (audio.md: signature bell, weapon, alert gong). */
export type SoundSample = 'signature' | 'weapon' | 'alert';

/**
 * Menu commands (ui.md §5.15). Menus never change state themselves; `createMenuController()` (model/menus)
 * implements the state-only ones against the model for the game and the gallery.
 */
export interface MenuCommands {
  /** Main menu navigation / "Zurück" to another screen. */
  navigate(screen: MenuScreen): void;
  /** DE/EN switch (P12, live). */
  setLocale(locale: Locale): void;
  /** Alt+Enter / fullscreen button (C11). */
  toggleFullscreen(): void;
  /** "Gefecht starten" with the complete configuration. */
  startSkirmish(config: SkirmishConfig): void;
  /** Any lobby change (map, slots, rules). */
  updateSkirmish(patch: Partial<SkirmishConfig>): void;
  /** Dice next to the seed field: the game picks a new seed. */
  rerollSeed(): void;
  /** Loading screen error: try again. */
  retryLoading(): void;
  /** Loading screen error: back to the main menu. */
  backToMenu(): void;
  setSetting<K extends SettingKey>(key: K, value: SettingsValues[K]): void;
  /** "Standard wiederherstellen". */
  resetSettings(): void;
  setSettingsTab(tab: SettingsTab): void;
  /** Opens the settings on a tab (from the in-game menu: settings, key overview). */
  openSettings(tab: SettingsTab): void;
  /** "Fertig" / Esc in the settings: back to where they were opened from. */
  closeSettings(): void;
  /** Autodetect: run the 3-s benchmark again (P9). */
  runGraphicsBenchmark(): void;
  /** Settings audio card: play a sample on its bus. */
  playSoundSample(sample: SoundSample): void;
  setScoreTab(tab: ScoreTab): void;
  saveReplay(): void;
  watchReplay(): void;
  rematch(): void;
  /** In-game menu: close and continue (also Esc). */
  resume(): void;
  /** In-game menu: show (true) or dismiss (false) the surrender confirmation. */
  askSurrender(open: boolean): void;
  /** Confirmed surrender. */
  surrender(): void;
  quitToMenu(): void;
}

export const MENU_COMMAND_NAMES = [
  'navigate',
  'setLocale',
  'toggleFullscreen',
  'startSkirmish',
  'updateSkirmish',
  'rerollSeed',
  'retryLoading',
  'backToMenu',
  'setSetting',
  'resetSettings',
  'setSettingsTab',
  'openSettings',
  'closeSettings',
  'runGraphicsBenchmark',
  'playSoundSample',
  'setScoreTab',
  'saveReplay',
  'watchReplay',
  'rematch',
  'resume',
  'askSurrender',
  'surrender',
  'quitToMenu',
] as const satisfies readonly (keyof MenuCommands)[];
