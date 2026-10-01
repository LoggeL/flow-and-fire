import type { AudioSettings } from '@faf/audio';

export interface GameAudioSettings {
  volMaster: number;
  volSfx: number;
  volVoice: number;
  volUi: number;
  volMusic: number;
  volAmbient: number;
  audioInBackground: boolean;
  audibleStall: boolean;
  alertVoice: 'voice' | 'gong' | 'off';
}

const VOLUME_KEYS = {
  volMaster: 'master', volSfx: 'sfx', volVoice: 'alerts', volUi: 'ui',
  volMusic: 'music', volAmbient: 'ambience',
} as const;

export interface AudioPreferences { audibleStall: boolean; alertVoice: GameAudioSettings['alertVoice'] }
export interface AudioPreferencesStore { load(): unknown; save(value: AudioPreferences): void }

export function localAudioPreferencesStore(): AudioPreferencesStore {
  const key = 'faf.game.audio.v1';
  return {
    load(): unknown {
      try { return JSON.parse(globalThis.localStorage?.getItem(key) ?? 'null') as unknown; }
      catch { return null; }
    },
    save(value): void {
      try { globalThis.localStorage?.setItem(key, JSON.stringify({ v: 1, ...value })); }
      catch { /* Blocked or full storage leaves the live settings usable. */ }
    },
  };
}

export function readAudioPreferences(store: AudioPreferencesStore): AudioPreferences {
  let raw: unknown;
  try { raw = store.load(); } catch { raw = null; }
  const value = raw !== null && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return {
    audibleStall: typeof value['audibleStall'] === 'boolean' ? value['audibleStall'] : true,
    alertVoice: value['alertVoice'] === 'gong' || value['alertVoice'] === 'off' ? value['alertVoice'] : 'voice',
  };
}

/** HUD sliders use percent; the engine clamps and persists its 0..1 values. */
export function audioSettingsPatch(key: string, value: unknown): Partial<AudioSettings> | null {
  if (Object.hasOwn(VOLUME_KEYS, key)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    const bus = VOLUME_KEYS[key as keyof typeof VOLUME_KEYS];
    return { [bus]: value / 100 };
  }
  if (key === 'audioInBackground' && typeof value === 'boolean') return { muteWhenHidden: !value };
  return null;
}

export function audioHudSettings(settings: Readonly<AudioSettings>, audibleStall: boolean, alertVoice: GameAudioSettings['alertVoice']): GameAudioSettings {
  return {
    volMaster: settings.master * 100, volSfx: settings.sfx * 100, volVoice: settings.alerts * 100,
    volUi: settings.ui * 100, volMusic: settings.music * 100, volAmbient: settings.ambience * 100,
    audioInBackground: !settings.muteWhenHidden, audibleStall, alertVoice,
  };
}
