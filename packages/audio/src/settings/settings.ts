/**
 * Audio settings: observable controller with clamping, field-wise sanitising of untrusted stored
 * data and a versioned persistence format (`{ v: 1, …AudioSettings }`).
 */

import { DEFAULT_AUDIO_SETTINGS, type AudioSettings, type SettingsController, type SettingsStore } from '../types.ts';

/** Version tag of the persisted settings object. */
export const SETTINGS_VERSION = 1;

/** Slider fields of {@link AudioSettings} (0..1). */
export const VOLUME_KEYS = ['master', 'sfx', 'ui', 'alerts', 'music', 'ambience'] as const;
/** Boolean fields of {@link AudioSettings}. */
export const FLAG_KEYS = ['muted', 'muteWhenHidden'] as const;

export type VolumeKey = (typeof VOLUME_KEYS)[number];
export type FlagKey = (typeof FLAG_KEYS)[number];

/** Persisted form. */
export interface StoredAudioSettings extends AudioSettings {
  v: typeof SETTINGS_VERSION;
}

function clampVolume(v: number): number {
  return v <= 0 ? 0 : v >= 1 ? 1 : v;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Sanitises untrusted data field by field onto `base`: finite numbers are clamped to 0..1,
 * booleans must be booleans, anything else (wrong type, NaN, missing) keeps the `base` value.
 * Unknown keys are ignored. A `v` other than 1 (unknown future/past format) discards the whole
 * object; a missing `v` is accepted (plain in-memory stores hand back what they were given).
 */
export function sanitizeSettings(raw: unknown, base: Readonly<AudioSettings> = DEFAULT_AUDIO_SETTINGS): AudioSettings {
  const out: AudioSettings = { ...base };
  if (!isRecord(raw)) return out;
  if (raw.v !== undefined && raw.v !== SETTINGS_VERSION) return out;
  for (const k of VOLUME_KEYS) {
    const v = raw[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = clampVolume(v);
  }
  for (const k of FLAG_KEYS) {
    const v = raw[k];
    if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}

/** Persisted form of `s`. */
export function toStored(s: Readonly<AudioSettings>): StoredAudioSettings {
  return {
    v: SETTINGS_VERSION,
    master: s.master,
    sfx: s.sfx,
    ui: s.ui,
    alerts: s.alerts,
    music: s.music,
    ambience: s.ambience,
    muted: s.muted,
    muteWhenHidden: s.muteWhenHidden,
  };
}

function sameSettings(a: Readonly<AudioSettings>, b: Readonly<AudioSettings>): boolean {
  for (const k of VOLUME_KEYS) if (a[k] !== b[k]) return false;
  for (const k of FLAG_KEYS) if (a[k] !== b[k]) return false;
  return true;
}

/**
 * Creates the settings controller.
 *
 * Start value: defaults, overridden by `initial` (sanitised), overridden field-wise by valid
 * values from `store.load()` (the user's persisted choice wins). A throwing store never breaks
 * the controller (load → defaults, save → ignored). `get()` returns a frozen snapshot that is
 * replaced on every effective change, so subscribers can compare by identity.
 */
export function createSettingsController(store: SettingsStore | null, initial?: Partial<AudioSettings>): SettingsController {
  let state: Readonly<AudioSettings> = sanitizeSettings(initial ?? null);
  if (store !== null) {
    let loaded: unknown;
    try {
      loaded = store.load();
    } catch {
      loaded = null;
    }
    state = sanitizeSettings(loaded, state);
  }
  state = Object.freeze(state);
  const subscribers = new Set<(s: Readonly<AudioSettings>) => void>();

  return {
    get(): Readonly<AudioSettings> {
      return state;
    },
    set(patch: Partial<AudioSettings>): void {
      const next = sanitizeSettings(patch, state);
      if (sameSettings(next, state)) return;
      state = Object.freeze(next);
      if (store !== null) {
        try {
          store.save(state);
        } catch {
          // Persistence is best effort (quota exceeded, private mode, …).
        }
      }
      for (const fn of [...subscribers]) fn(state);
    },
    subscribe(fn: (s: Readonly<AudioSettings>) => void): () => void {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },
  };
}
