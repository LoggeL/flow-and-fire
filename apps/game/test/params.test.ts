import { describe, expect, it } from 'vitest';
import { chooseTransport, DEFAULT_CUBES, DEFAULT_ENEMY_CUBES, DEFAULT_SEED, parseParams } from '../src/params.ts';

describe('URL parameters', () => {
  it('defaults', () => {
    expect(parseParams('')).toEqual({
      transport: 'auto',
      seed: DEFAULT_SEED,
      cubes: DEFAULT_CUBES,
      enemyCubes: DEFAULT_ENEMY_CUBES,
      autostart: true,
    });
    expect(DEFAULT_CUBES).toBe(1000);
  });

  it('parses transport, seed, cubes, enemy, autostart', () => {
    expect(parseParams('?transport=sab&seed=7&cubes=12&enemy=0&autostart=0')).toEqual({
      transport: 'sab',
      seed: 7,
      cubes: 12,
      enemyCubes: 0,
      autostart: false,
    });
    expect(parseParams('transport=transfer').transport).toBe('transfer');
    expect(parseParams('autostart=false').autostart).toBe(false);
    expect(parseParams('autostart=1').autostart).toBe(true);
  });

  it('invalid values fall back, out-of-range values are clamped', () => {
    const p = parseParams('?transport=pigeon&seed=-3&cubes=abc&enemy=99999');
    expect(p.transport).toBe('auto');
    expect(p.seed).toBe(DEFAULT_SEED);
    expect(p.cubes).toBe(DEFAULT_CUBES);
    expect(p.enemyCubes).toBe(8192);
    expect(parseParams('seed=99999999999').seed).toBe(0xffffffff);
  });

  it('transport choice: SAB only when cross-origin isolated', () => {
    expect(chooseTransport('auto', true)).toEqual({ kind: 'sab', note: null });
    expect(chooseTransport('auto', false)).toEqual({ kind: 'transfer', note: null });
    expect(chooseTransport('transfer', true)).toEqual({ kind: 'transfer', note: null });
    expect(chooseTransport('sab', true)).toEqual({ kind: 'sab', note: null });
    const fallback = chooseTransport('sab', false);
    expect(fallback.kind).toBe('transfer');
    expect(fallback.note).toMatch(/not cross-origin isolated/);
  });
});
