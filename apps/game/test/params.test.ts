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
      map: 'hollow-ridge',
      preset: 'medium',
      units: 0,
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
      map: 'hollow-ridge',
      preset: 'medium',
      units: 0,
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

  it('map, preset, units (MS2)', () => {
    expect(parseParams('?map=testplane').map).toBe('testplane');
    expect(parseParams('?map=Hollow-Ridge').map).toBe('hollow-ridge');
    expect(parseParams('?map=../etc').map).toBe('hollow-ridge');
    for (const p of ['low', 'medium', 'high', 'ultra'] as const) expect(parseParams(`?preset=${p}`).preset).toBe(p);
    expect(parseParams('?preset=potato').preset).toBe('medium');
    // ?units= replaces the default start armies unless they are given explicitly.
    const u = parseParams('?units=2000');
    expect(u.units).toBe(2000);
    expect(u.cubes).toBe(0);
    expect(u.enemyCubes).toBe(0);
    const both = parseParams('?units=10&cubes=5&enemy=3');
    expect([both.units, both.cubes, both.enemyCubes]).toEqual([10, 5, 3]);
    expect(parseParams('?units=999999').units).toBe(16384);
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
