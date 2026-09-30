import { describe, expect, it, vi } from 'vitest';
import { Mixer } from '../../src/mixer/index.ts';
import {
  SETTINGS_STORAGE_KEY,
  attachVisibilityMute,
  bindSettingsToMixer,
  createSettingsController,
  localStorageSettingsStore,
  memorySettingsStore,
  sanitizeSettings,
  type StorageLike,
  type VisibilityDocument,
} from '../../src/settings/index.ts';
import { DEFAULT_AUDIO_SETTINGS, type AudioSettings } from '../../src/types.ts';
import { FakeAudioContext, type FakeGainNode } from '../support/index.ts';

class MapStorage implements StorageLike {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

class ThrowingStorage implements StorageLike {
  getItem(): string | null {
    throw new DOMException('denied', 'SecurityError');
  }
  setItem(): void {
    throw new DOMException('quota', 'QuotaExceededError');
  }
}

class FakeDocument extends EventTarget implements VisibilityDocument {
  visibilityState: 'visible' | 'hidden' = 'visible';
  listeners = 0;
  override addEventListener(type: 'visibilitychange', listener: () => void): void {
    this.listeners++;
    super.addEventListener(type, listener);
  }
  override removeEventListener(type: 'visibilitychange', listener: () => void): void {
    this.listeners--;
    super.removeEventListener(type, listener);
  }
  setVisibility(v: 'visible' | 'hidden'): void {
    this.visibilityState = v;
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

// Static proof: the real Document fits the structural parameter type.
const _documentFits: (d: Document) => VisibilityDocument = (d) => d;
void _documentFits;

async function running(): Promise<FakeAudioContext> {
  const ctx = new FakeAudioContext();
  await ctx.resume();
  return ctx;
}

function gain(node: unknown): FakeGainNode['gain'] {
  return (node as FakeGainNode).gain;
}

describe('SettingsController', () => {
  it('starts with the defaults, overridden by initial', () => {
    expect(createSettingsController(null).get()).toEqual(DEFAULT_AUDIO_SETTINGS);
    const c = createSettingsController(null, { music: 0.1, muted: true });
    expect(c.get().music).toBe(0.1);
    expect(c.get().muted).toBe(true);
    expect(c.get().sfx).toBe(DEFAULT_AUDIO_SETTINGS.sfx);
  });

  it('clamps volumes to 0..1 and ignores invalid values and unknown keys', () => {
    const c = createSettingsController(null);
    c.set({ sfx: 1.5, music: -2, ui: Number.NaN, alerts: Number.POSITIVE_INFINITY });
    expect(c.get().sfx).toBe(1);
    expect(c.get().music).toBe(0);
    expect(c.get().ui).toBe(DEFAULT_AUDIO_SETTINGS.ui);
    expect(c.get().alerts).toBe(DEFAULT_AUDIO_SETTINGS.alerts);
    c.set({ muted: 'yes', bogus: 1 } as unknown as Partial<AudioSettings>);
    expect(c.get().muted).toBe(false);
    expect('bogus' in c.get()).toBe(false);
  });

  it('returns frozen snapshots, notifies subscribers on effective changes only, unsubscribes', () => {
    const c = createSettingsController(null);
    const seen: Readonly<AudioSettings>[] = [];
    const off = c.subscribe((s) => seen.push(s));
    const s0 = c.get();
    expect(Object.isFrozen(s0)).toBe(true);
    c.set({ sfx: s0.sfx });
    expect(seen).toHaveLength(0);
    expect(c.get()).toBe(s0);
    c.set({ sfx: 0.3 });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.sfx).toBe(0.3);
    expect(c.get()).not.toBe(s0);
    off();
    c.set({ sfx: 0.4 });
    expect(seen).toHaveLength(1);
  });

  it('persists every change and restores it (roundtrip through localStorage format)', () => {
    const storage = new MapStorage();
    const store = localStorageSettingsStore(undefined, storage);
    const a = createSettingsController(store);
    a.set({ master: 0.42, music: 0, muteWhenHidden: false });
    const raw = JSON.parse(storage.getItem(SETTINGS_STORAGE_KEY)!) as Record<string, unknown>;
    expect(raw.v).toBe(1);
    expect(raw.master).toBe(0.42);
    const b = createSettingsController(localStorageSettingsStore(SETTINGS_STORAGE_KEY, storage));
    expect(b.get()).toEqual({ ...DEFAULT_AUDIO_SETTINGS, master: 0.42, music: 0, muteWhenHidden: false });
    // The persisted (complete) object wins over `initial`; `initial` only fills fields the store lacks.
    expect(createSettingsController(store, { master: 0.9, sfx: 0.1 }).get()).toMatchObject({ master: 0.42, sfx: DEFAULT_AUDIO_SETTINGS.sfx });
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ v: 1, master: 0.3 }));
    expect(createSettingsController(store, { master: 0.9, sfx: 0.1 }).get()).toMatchObject({ master: 0.3, sfx: 0.1 });
  });

  it('corrupt JSON, foreign versions and broken fields fall back to defaults (field by field)', () => {
    const storage = new MapStorage();
    const store = localStorageSettingsStore('k', storage);
    storage.setItem('k', '{not json');
    expect(createSettingsController(store).get()).toEqual(DEFAULT_AUDIO_SETTINGS);
    storage.setItem('k', JSON.stringify({ v: 2, master: 0.1 }));
    expect(createSettingsController(store).get()).toEqual(DEFAULT_AUDIO_SETTINGS);
    storage.setItem('k', JSON.stringify([1, 2, 3]));
    expect(createSettingsController(store).get()).toEqual(DEFAULT_AUDIO_SETTINGS);
    storage.setItem('k', JSON.stringify({ v: 1, master: 'loud', sfx: 0.2, ui: null, music: 7, muted: 1, muteWhenHidden: false }));
    expect(createSettingsController(store).get()).toEqual({
      ...DEFAULT_AUDIO_SETTINGS,
      sfx: 0.2,
      music: 1,
      muteWhenHidden: false,
    });
    expect(sanitizeSettings({ sfx: 0.5 })).toEqual({ ...DEFAULT_AUDIO_SETTINGS, sfx: 0.5 }); // unversioned plain store
  });

  it('never crashes when storage throws (private mode, quota) or is missing', () => {
    const store = localStorageSettingsStore('k', new ThrowingStorage());
    expect(store.load()).toBeNull();
    const c = createSettingsController(store);
    expect(() => c.set({ sfx: 0.1 })).not.toThrow();
    expect(c.get().sfx).toBe(0.1);
    // No global localStorage in Node: load null, save no-op.
    const g = localStorageSettingsStore();
    expect(g.load()).toBeNull();
    expect(() => g.save(DEFAULT_AUDIO_SETTINGS)).not.toThrow();
    // A global accessor that throws (blocked site data).
    const desc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
    try {
      const s = localStorageSettingsStore();
      expect(s.load()).toBeNull();
      expect(() => s.save(DEFAULT_AUDIO_SETTINGS)).not.toThrow();
    } finally {
      if (desc === undefined) delete (globalThis as { localStorage?: unknown }).localStorage;
      else Object.defineProperty(globalThis, 'localStorage', desc);
    }
    // A throwing custom store.
    const bad = {
      load: () => {
        throw new Error('x');
      },
      save: () => {
        throw new Error('y');
      },
    };
    const c2 = createSettingsController(bad);
    expect(c2.get()).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(() => c2.set({ ui: 0 })).not.toThrow();
  });

  it('uses the global localStorage when present', () => {
    const storage = new MapStorage();
    vi.stubGlobal('localStorage', storage);
    try {
      createSettingsController(localStorageSettingsStore()).set({ ambience: 0.05 });
      expect(JSON.parse(storage.getItem('faf.audio.v1')!).ambience).toBe(0.05);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('memorySettingsStore keeps the versioned form', () => {
    const m = memorySettingsStore();
    createSettingsController(m).set({ ui: 0.2 });
    expect(m.saves).toBe(1);
    expect(m.value).toMatchObject({ v: 1, ui: 0.2 });
    expect(createSettingsController(m).get().ui).toBe(0.2);
  });
});

describe('bindSettingsToMixer', () => {
  it('applies the current settings at once and later changes as ramps', async () => {
    const ctx = await running();
    const mixer = new Mixer(ctx);
    const c = createSettingsController(null, { master: 0.5, music: 0.2 });
    const unbind = bindSettingsToMixer(c, mixer);
    expect(gain(mixer.graph.user.master).value).toBe(0.25);
    expect(gain(mixer.graph.user.music).value).toBeCloseTo(0.04, 12);
    expect(gain(mixer.graph.user.sfx).value).toBeCloseTo(0.64, 12);
    ctx.advance(100);
    c.set({ sfx: 0.5, muted: true });
    const sfx = gain(mixer.graph.user.sfx);
    expect(sfx.calls[sfx.calls.length - 1]!.method).toBe('setTargetAtTime');
    ctx.advance(300);
    expect(sfx.value).toBeCloseTo(0.25, 4);
    expect(gain(mixer.graph.mute).value).toBeCloseTo(0, 4);
    unbind();
    c.set({ sfx: 1 });
    ctx.advance(300);
    expect(sfx.value).toBeCloseTo(0.25, 4);
  });
});

describe('attachVisibilityMute', () => {
  it('mutes softly while hidden and restores on visible; user mute stays in force', async () => {
    const ctx = await running();
    const mixer = new Mixer(ctx);
    const c = createSettingsController(null);
    const doc = new FakeDocument();
    const detach = attachVisibilityMute(doc, c, mixer);
    const mute = gain(mixer.graph.mute);
    expect(mixer.muted).toBe(false);
    ctx.advance(100);
    doc.setVisibility('hidden');
    expect(mixer.isMutedBy('hidden')).toBe(true);
    expect(mute.calls[mute.calls.length - 1]!.method).toBe('setTargetAtTime');
    ctx.advance(10);
    expect(mute.value).toBeGreaterThan(0.2); // soft, not a jump
    ctx.advance(300);
    expect(mute.value).toBeCloseTo(0, 4);
    doc.setVisibility('visible');
    ctx.advance(300);
    expect(mute.value).toBeCloseTo(1, 4);

    mixer.setMuted(true); // user mute
    doc.setVisibility('hidden');
    doc.setVisibility('visible');
    expect(mixer.muted).toBe(true);
    mixer.setMuted(false);

    // muteWhenHidden off: hiding does nothing; toggling it while hidden applies at once.
    c.set({ muteWhenHidden: false });
    doc.setVisibility('hidden');
    expect(mixer.muted).toBe(false);
    c.set({ muteWhenHidden: true });
    expect(mixer.isMutedBy('hidden')).toBe(true);

    detach();
    expect(doc.listeners).toBe(0);
    expect(mixer.isMutedBy('hidden')).toBe(false);
    doc.setVisibility('visible');
    doc.setVisibility('hidden');
    expect(mixer.muted).toBe(false);
    detach(); // idempotent
  });

  it('starts muted when attached to an already hidden document', async () => {
    const ctx = await running();
    const mixer = new Mixer(ctx);
    const doc = new FakeDocument();
    doc.visibilityState = 'hidden';
    attachVisibilityMute(doc, createSettingsController(null), mixer);
    expect(mixer.isMutedBy('hidden')).toBe(true);
  });
});
