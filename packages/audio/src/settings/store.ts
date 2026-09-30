/** Settings persistence backends. */

import type { AudioSettings, SettingsStore } from '../types.ts';
import { toStored } from './settings.ts';

/** Default localStorage key of the audio settings. */
export const SETTINGS_STORAGE_KEY = 'faf.audio.v1';

/** The part of the Web Storage API the store uses. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Settings store on `localStorage` (or `storage`). Every access is guarded: a missing or
 * throwing storage (private mode, blocked site data, SecurityError on access, quota) makes
 * `load` return null and `save` a no-op. Corrupt JSON loads as null. Saves the versioned
 * form `{ v: 1, … }`.
 */
export function localStorageSettingsStore(key = SETTINGS_STORAGE_KEY, storage?: StorageLike | null): SettingsStore {
  const resolve = (): StorageLike | null => {
    if (storage !== undefined) return storage;
    // Reading the global itself throws in some sandboxed/blocked contexts.
    const g = globalThis as { localStorage?: StorageLike };
    return g.localStorage ?? null;
  };
  return {
    load(): unknown {
      try {
        const s = resolve();
        if (s === null) return null;
        const raw = s.getItem(key);
        return raw === null ? null : (JSON.parse(raw) as unknown);
      } catch {
        return null;
      }
    },
    save(v: AudioSettings): void {
      try {
        const s = resolve();
        if (s !== null) s.setItem(key, JSON.stringify(toStored(v)));
      } catch {
        // Best effort.
      }
    },
  };
}

/** In-memory store (tests, no persistence wanted but a store object required). */
export function memorySettingsStore(initial: unknown = null): SettingsStore & { value: unknown; saves: number } {
  const store = {
    value: initial,
    saves: 0,
    load(): unknown {
      return store.value;
    },
    save(v: AudioSettings): void {
      store.value = toStored(v);
      store.saves++;
    },
  };
  return store;
}
