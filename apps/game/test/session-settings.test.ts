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
  it('rejects corrupt and out-of-range stored values without losing usable defaults', () => {
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ ...DEFAULT_SETTINGS, renderScale: 0.49 }) });
    expect(storedSettings()).toBeNull(); expect(restoreSettings()).toEqual(DEFAULT_SETTINGS);
    vi.stubGlobal('localStorage', { getItem: () => '{broken' });
    expect(storedSettings()).toBeNull();
  });
});
