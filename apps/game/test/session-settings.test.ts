import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, validateSettings } from '@faf/hud';
import { restoreSettings, storedSettings } from '../src/session-settings.ts';

afterEach(() => vi.unstubAllGlobals());
describe('persisted game settings', () => {
  it('retains the real Low preset scale through restoration and the next preset selection', () => {
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ ...DEFAULT_SETTINGS, preset: 'low', renderScale: 0.66 }) });
    const saved=storedSettings()!;
    expect(saved.preset).toBe('low'); expect(saved.renderScale).toBe(0.66);
    expect(validateSettings({ ...saved, preset: 'high' })).toEqual([]);
  });
  it('drops only a broken stored value and keeps every other valid one', () => {
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ ...DEFAULT_SETTINGS, renderScale: 0.49, volMaster: 12, locale: 'en', keyScheme: 'nope', unknown: 1 }) });
    expect(storedSettings()).toEqual({ ...DEFAULT_SETTINGS, volMaster: 12, locale: 'en' });
    vi.stubGlobal('localStorage', { getItem: () => '{broken' });
    expect(storedSettings()).toBeNull(); expect(restoreSettings()).toEqual(DEFAULT_SETTINGS);
    vi.stubGlobal('localStorage', { getItem: () => '[1,2]' });
    expect(storedSettings()).toBeNull();
  });
  it('maps values older builds offered but never applied to the supported neighbour', () => {
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ antialias: 'msaa4', splatLayers: 2, shadowCascades: 3, bloom: false }) });
    expect(storedSettings()).toEqual({ ...DEFAULT_SETTINGS, antialias: 'fxaa', splatLayers: 4, shadowCascades: 2, bloom: false });
  });
});
