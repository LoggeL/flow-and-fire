import type { Locale } from '../i18n/locale.ts';
import type { MenuScreen } from '../model/menus/main.ts';
import type { SettingKey, SettingsValues } from '../model/menus/settings.ts';
import type { SkirmishConfig } from '../model/menus/skirmish.ts';

/** Menu commands (ui.md §5.15). */
export interface MenuCommands {
  navigate(screen: MenuScreen): void;
  setLocale(locale: Locale): void;
  startSkirmish(config: SkirmishConfig): void;
  updateSkirmish(patch: Partial<SkirmishConfig>): void;
  retryLoading(): void;
  backToMenu(): void;
  setSetting<K extends SettingKey>(key: K, value: SettingsValues[K]): void;
  resetSettings(): void;
  requestAutodetect(): void;
  previewAudio(): void;
  saveReplay(): void;
  watchReplay(): void;
  rematch(): void;
  resume(): void;
  surrender(): void;
  quitToMenu(): void;
}

export const MENU_COMMAND_NAMES = [
  'navigate',
  'setLocale',
  'startSkirmish',
  'updateSkirmish',
  'retryLoading',
  'backToMenu',
  'setSetting',
  'resetSettings',
  'requestAutodetect',
  'previewAudio',
  'saveReplay',
  'watchReplay',
  'rematch',
  'resume',
  'surrender',
  'quitToMenu',
] as const satisfies readonly (keyof MenuCommands)[];
