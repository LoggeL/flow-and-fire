import { describe, expect, it } from 'vitest';
import { MAX_LIBRARY_LAYERS, compileEffectLibrary } from '../../src/effects/compile.ts';
import { hexColor } from '../../src/effects/curves.ts';
import { effectBudget } from '../../src/effects/define.ts';
import { createParticleState, evalParticle } from '../../src/effects/reference.ts';
import { VARKAN_EFFECTS, VARKAN_EVENT_FX, VARKAN_GLOW, glowTintForArmyColor, hueSat } from '../../src/effects/varkan.ts';

const lib = compileEffectLibrary(VARKAN_EFFECTS);

const REQUIRED = [
  'muzzle_small',
  'muzzle_cannon',
  'muzzle_artillery',
  'muzzle_missile',
  'impact_ground_small',
  'impact_ground_large',
  'impact_metal',
  'impact_shield',
  'explosion_small',
  'explosion_medium',
  'explosion_large',
  'acu_explosion',
  'smoke_damage',
  'smoke_puff',
  'sparks_burst',
  'wreck_smolder',
  'missile_smoke_trail',
  'build_stream',
  'reclaim_stream',
];

describe('VARKAN_EFFECTS', () => {
  it('compiles with at least 18 unique effects and ≤ 256 layers', () => {
    expect(VARKAN_EFFECTS.length).toBeGreaterThanOrEqual(18);
    expect(new Set(VARKAN_EFFECTS.map((e) => e.id)).size).toBe(VARKAN_EFFECTS.length);
    expect(lib.layerCount).toBeLessThanOrEqual(MAX_LIBRARY_LAYERS);
    for (const name of REQUIRED) expect(lib.index[`varkan:${name}`], name).toBeTypeOf('number');
    for (const e of VARKAN_EFFECTS) expect(e.id.startsWith('varkan:')).toBe(true);
  });

  it('keeps the particle budgets', () => {
    const budget = (id: string): number => effectBudget(lib.get(id).def).total;
    expect(budget('varkan:acu_explosion')).toBeLessThanOrEqual(2500);
    expect(budget('varkan:acu_explosion') + budget('varkan:acu_aftermath')).toBeLessThanOrEqual(2500);
    expect(budget('varkan:explosion_small')).toBeLessThanOrEqual(60);
    expect(budget('varkan:explosion_medium')).toBeLessThanOrEqual(150);
    expect(budget('varkan:explosion_large')).toBeLessThanOrEqual(400);
    for (const id of ['muzzle_small', 'muzzle_cannon', 'muzzle_artillery', 'muzzle_missile']) {
      expect(budget(`varkan:${id}`), id).toBeLessThanOrEqual(30);
    }
    for (const id of ['impact_ground_small', 'impact_metal', 'impact_shield']) expect(budget(`varkan:${id}`), id).toBeLessThanOrEqual(30);
    for (const e of lib.effects) expect(e.budget, e.id).toBeLessThanOrEqual(2500);
  });

  it('commander explosion: shake, priority-0 core, ground shock ring, mushroom and afterglow', () => {
    const acu = lib.get('varkan:acu_explosion');
    expect(acu.shake).not.toBeNull();
    expect(acu.shake!.radiusWu).toBeGreaterThanOrEqual(120);
    const layers = acu.def.layers;
    const byName = new Map(layers.map((l) => [l.name, l]));
    expect(byName.get('flash')?.priority).toBe(0);
    expect(byName.get('fireball')?.priority).toBe(0);
    expect(byName.get('shockwave')).toMatchObject({ orient: 'ground', shape: 'ring', priority: 0 });
    expect(byName.get('cap')?.gravity).toBeGreaterThan(0);
    expect(byName.get('embers')).toBeDefined();
    expect(byName.get('sparks')?.orient).toBe('velocity');
  });

  it('continuous effects emit, streams use motion stream', () => {
    for (const id of ['smoke_damage', 'wreck_smolder', 'missile_smoke_trail', 'build_stream', 'reclaim_stream']) {
      const e = lib.get(`varkan:${id}`);
      expect(e.continuous, id).toBe(true);
    }
    for (const id of ['build_stream', 'reclaim_stream']) {
      const layers = lib.get(`varkan:${id}`).def.layers;
      expect(layers.some((l) => l.motion === 'stream' && l.shape === 'stream' && (l.rate ?? 0) >= 60)).toBe(true);
    }
  });

  it('build stream is dense enough to read as a continuous pour', () => {
    // Particles on the path at the same time: rate · lifetime; each streak covers size + stretch·|v|·0.05.
    const e = lib.get('varkan:build_stream');
    const pour = e.def.layers.find((l) => l.name === 'pour')!;
    const pathWu = 10;
    const life = (pour.lifetime[0] + pour.lifetime[1]) / 2;
    const perPath = (pour.rate ?? 0) * life;
    const streak = 0.24 + (pour.stretch ?? 0) * (pathWu / life) * 0.05;
    expect((perPath * streak) / pathWu).toBeGreaterThan(2);
  });

  it('every layer evaluates to finite values over its lifetime', () => {
    const st = createParticleState();
    for (let li = 0; li < lib.layerCount; li++) {
      for (let seed = 0; seed < 8; seed++) {
        for (const age of [0, 0.05, 0.3, 1, 3, 8]) {
          evalParticle(lib, li, { originWu: [0, 0, 0], targetWu: [6, 2, 3], seed }, age, st);
          if (!st.alive) continue;
          for (const v of [...st.posWu, ...st.color, st.sizeWu, st.blend]) expect(Number.isFinite(v)).toBe(true);
          expect(st.sizeWu).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('VARKAN_EVENT_FX references only existing effects and covers all classes', () => {
    const all: string[] = [];
    const m = VARKAN_EVENT_FX;
    for (const rec of [m.weapon, m.impact, m.death]) for (const ids of Object.values(rec)) all.push(...ids);
    all.push(...m.build, ...m.reclaim, ...m.damaged, ...m.wreck, ...m.missileTrail);
    for (const id of all) expect(() => lib.indexOf(id), id).not.toThrow();
    expect(Object.keys(m.weapon).sort()).toEqual(['aa', 'artillery', 'cannon', 'direct_small', 'missile']);
    expect(Object.keys(m.death).sort()).toEqual(['acu', 'large', 'medium', 'small', 'structure']);
    expect(m.death.acu).toContain('varkan:acu_explosion');
    for (const cls of Object.values(m.groundImpactForWeapon)) expect(m.impact[cls]).toBeDefined();
  });
});

describe('glow colors and white-hot rule', () => {
  it('exposes the faction glow colors', () => {
    expect(VARKAN_GLOW.core).toEqual(hexColor('#FFD9A0'));
    expect(VARKAN_GLOW.falloff).toEqual(hexColor('#FF8A2A'));
    expect(VARKAN_GLOW.whiteHot).toEqual(hexColor('#FFE9C0'));
    expect(hueSat(VARKAN_GLOW.falloff).hue).toBeCloseTo(27, 0);
  });

  it('red and orange armies glow white-hot, the others amber', () => {
    const palette: Record<string, string> = {
      red: '#C8372D',
      blue: '#2F6FD0',
      green: '#3E9A4A',
      violet: '#7A4CC2',
      cyan: '#27A6B5',
      orange: '#E07A1F',
      pink: '#D0569A',
      olive: '#8A8F2E',
    };
    const hot = Object.entries(palette)
      .filter(([, hex]) => glowTintForArmyColor(hexColor(hex)).whiteHot)
      .map(([n]) => n)
      .sort();
    expect(hot).toEqual(['orange', 'red']);
    const w = glowTintForArmyColor(hexColor('#C8372D'));
    expect(w.core).toEqual(VARKAN_GLOW.whiteHot);
    expect(w.tint).not.toBe(0xffffff);
    // White-hot tint desaturates: blue channel is the largest multiplier.
    expect(w.tint & 255).toBe(255);
    expect((w.tint >> 16) & 255).toBeLessThan(255);
    const b = glowTintForArmyColor(hexColor('#2F6FD0'));
    expect(b.whiteHot).toBe(false);
    expect(b.tint).toBe(0xffffff);
    expect(glowTintForArmyColor([0.5, 0.5, 0.5]).whiteHot).toBe(false);
    expect(glowTintForArmyColor([0.9, 0.35, 0.1]).whiteHot).toBe(true);
  });
});
