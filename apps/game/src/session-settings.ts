import { signal } from '@preact/signals';
import { DEFAULT_SETTINGS, validateSettings, type SettingKey, type SettingsValues } from '@faf/hud';
export const LOCAL_SETTINGS = 'faf.game.settings.v1';
/** Values older builds offered but the runtime never applied, mapped to their supported neighbour. */
const LEGACY: Readonly<Partial<Record<SettingKey, readonly [unknown, unknown]>>> = { antialias: ['msaa4', 'fxaa'], splatLayers: [2, 4], shadowCascades: [3, 2], tooltips: ['short', 'full'] };
/**
 * Stored settings, key by key: a single broken or outdated value falls back to its default
 * while every other valid stored value is kept. Unknown keys are ignored.
 */
export function storedSettings(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): SettingsValues | null {
  try {
    const raw = storage?.getItem(LOCAL_SETTINGS);
    if (raw === null || raw === undefined) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const values: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    for (const key of Object.keys(DEFAULT_SETTINGS) as SettingKey[]) {
      if (!Object.hasOwn(parsed, key)) continue;
      let value = (parsed as Record<string, unknown>)[key];
      const legacy = LEGACY[key];
      if (legacy !== undefined && value === legacy[0]) value = legacy[1];
      const candidate = { ...DEFAULT_SETTINGS, [key]: value } as SettingsValues;
      if (validateSettings(candidate).length === 0) values[key] = value;
    }
    const result = values as unknown as SettingsValues;
    return validateSettings(result).length === 0 ? result : DEFAULT_SETTINGS;
  } catch { return null; }
}
export function restoreSettings(): SettingsValues { return storedSettings() ?? DEFAULT_SETTINGS; }
/** Interface language for UI outside the HUD model (replay panel); the HUD controller keeps it current. */
export const uiLocale = signal<'de' | 'en'>(restoreSettings().locale);
