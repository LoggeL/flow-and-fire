/** @faf/audio/settings — settings controller, persistence, mixer and visibility bindings. */
export {
  createSettingsController,
  sanitizeSettings,
  toStored,
  SETTINGS_VERSION,
  VOLUME_KEYS,
  FLAG_KEYS,
} from './settings.ts';
export type { StoredAudioSettings, VolumeKey, FlagKey } from './settings.ts';
export { localStorageSettingsStore, memorySettingsStore, SETTINGS_STORAGE_KEY } from './store.ts';
export type { StorageLike } from './store.ts';
export { applySettingsToMixer, attachVisibilityMute, bindSettingsToMixer } from './bind.ts';
export type { SettingsMixer, VisibilityDocument } from './bind.ts';
