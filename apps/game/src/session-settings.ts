import { DEFAULT_SETTINGS, validateSettings, type SettingsValues } from '@faf/hud';
export const LOCAL_SETTINGS = 'faf.game.settings.v1';
export function storedSettings(): SettingsValues | null {
  try {
    const raw = localStorage.getItem(LOCAL_SETTINGS);
    if (raw === null) return null;
    const values = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } as SettingsValues;
    return validateSettings(values).length === 0 ? values : null;
  } catch { return null; }
}
export function restoreSettings(): SettingsValues { return storedSettings() ?? DEFAULT_SETTINGS; }
