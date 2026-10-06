import { describe, expect, it } from 'vitest';
import { chooseTransport, DEFAULT_CUBES, DEFAULT_ENEMY_CUBES, DEFAULT_SEED, DEFAULT_TANKS, parseParams } from '../src/params.ts';

describe('URL parameters', () => {
  it('defaults (MS3: placeholder tanks, no cubes)', () => {
    expect(parseParams('')).toEqual({
      transport: 'auto',
      seed: DEFAULT_SEED,
      cubes: 0,
      enemyCubes: 0,
      autostart: true,
      map: 'hollow-ridge',
      preset: 'medium',
      units: 0,
      spawn: 'tanks',
      tanks: DEFAULT_TANKS,
      paths: false,
    });
    expect(DEFAULT_TANKS).toBe(150);
    expect(DEFAULT_CUBES).toBe(1000);
  });

  it('?spawn=tanks|cubes|none, ?tanks=, ?paths= (MS3); ?cubes=/?units= keep the MS2 cube scene', () => {
    const cubes = parseParams('?spawn=cubes');
    expect([cubes.spawn, cubes.cubes, cubes.enemyCubes, cubes.tanks]).toEqual(['cubes', DEFAULT_CUBES, DEFAULT_ENEMY_CUBES, 0]);
    const none = parseParams('?spawn=none');
    expect([none.spawn, none.cubes, none.enemyCubes, none.tanks]).toEqual(['none', 0, 0, 0]);
    expect(parseParams('?tanks=40').tanks).toBe(40);
    expect(parseParams('?tanks=99999').tanks).toBe(4096);
    expect(parseParams('?spawn=TANKS&tanks=7').tanks).toBe(7);
    expect(parseParams('?spawn=pigeons').spawn).toBe('tanks');
    // Legacy: an explicit cube or flight-test count means the cube scene.
    expect(parseParams('?cubes=1000').spawn).toBe('cubes');
    expect(parseParams('?cubes=1000').cubes).toBe(1000);
    expect(parseParams('?units=2000').spawn).toBe('cubes');
    expect(parseParams('?cubes=10&spawn=tanks').spawn).toBe('tanks');
    expect(parseParams('?cubes=10&spawn=tanks').cubes).toBe(0);
    expect(parseParams('?paths=1').paths).toBe(true);
    expect(parseParams('?paths=0').paths).toBe(false);
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
      spawn: 'cubes',
      tanks: 0,
      paths: false,
    });
    expect(parseParams('transport=transfer').transport).toBe('transfer');
    expect(parseParams('autostart=false').autostart).toBe(false);
    expect(parseParams('autostart=1').autostart).toBe(true);
  });

  it('invalid values fall back, out-of-range values are clamped', () => {
    const p = parseParams('?transport=pigeon&seed=-3&cubes=abc&enemy=99999&spawn=cubes');
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
