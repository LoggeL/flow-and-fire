import { describe, expect, it } from 'vitest';
import { compileEffectLibrary } from '../../src/effects/compile.ts';
import type { EffectDef, EffectLayerDef } from '../../src/effects/define.ts';
import { FxRng, fxHash32 } from '../../src/effects/random.ts';
import { createParticleState, evalParticle, particleRandoms } from '../../src/effects/reference.ts';

const layer: EffectLayerDef = {
  name: 'l',
  shape: 'glow',
  orient: 'billboard',
  motion: 'ballistic',
  count: 1,
  lifetime: [2, 3],
  speed: [4, 8],
  spread: 30,
  gravity: -9.8,
  drag: 0,
  size: [
    [0, 1],
    [1, 2],
  ],
  sizeJitter: 0.5,
  color: [
    [0, 2, 1, 0.5, 1],
    [1, 0, 0, 0, 0],
  ],
  blend: [
    [0, 0],
    [1, 1],
  ],
  spin: [-2, 2],
  priority: 1,
};

const defs: EffectDef[] = [
  { id: 'test:nodrag', boundsWu: 10, layers: [layer] },
  { id: 'test:drag', boundsWu: 10, layers: [{ ...layer, drag: 1.7, gravity: 2.5, delay: [0.1, 0.4], emitRadius: 0.5 }] },
  {
    id: 'test:stream',
    boundsWu: 10,
    continuous: true,
    layers: [
      {
        ...layer,
        motion: 'stream',
        count: 0,
        rate: 50,
        lifetime: [0.5, 0.7],
        emitRadius: 0.4,
        streamWave: 0.3,
        streamWaves: 2,
        gravity: -3,
        tint: 'spawn',
      },
    ],
  },
  { id: 'test:ring', boundsWu: 10, layers: [{ ...layer, spread: 90, spreadInner: 80 }] },
];
const lib = compileEffectLibrary(defs);

/** RK4 integration of dv/dt = g − k·v from (p0, v0). */
function integrate(p0: number[], v0: number[], g: number, k: number, t: number): number[] {
  const steps = 4000;
  const h = t / steps;
  const p = p0.slice();
  const v = v0.slice();
  const acc = (vv: number[]): number[] => [-k * vv[0]!, g - k * vv[1]!, -k * vv[2]!];
  for (let s = 0; s < steps; s++) {
    const k1v = acc(v);
    const k1p = v;
    const v2 = v.map((x, i) => x + (h / 2) * k1v[i]!);
    const k2v = acc(v2);
    const k2p = v2;
    const v3 = v.map((x, i) => x + (h / 2) * k2v[i]!);
    const k3v = acc(v3);
    const k3p = v3;
    const v4 = v.map((x, i) => x + h * k3v[i]!);
    const k4v = acc(v4);
    const k4p = v4;
    for (let i = 0; i < 3; i++) {
      p[i]! += (h / 6) * (k1p[i]! + 2 * k2p[i]! + 2 * k3p[i]! + k4p[i]!);
      v[i]! += (h / 6) * (k1v[i]! + 2 * k2v[i]! + 2 * k3v[i]! + k4v[i]!);
    }
  }
  return p;
}

describe('particleRandoms', () => {
  it('follows the documented 16-bit split of fxHash32(seed, layer, k)', () => {
    const r = particleRandoms(1234, 5);
    const h0 = fxHash32(1234, 5, 0);
    const h4 = fxHash32(1234, 5, 4);
    expect(r.uLife).toBe((h0 & 0xffff) / 65536);
    expect(r.uSpeed).toBe((h0 >>> 16) / 65536);
    expect(r.uDelay).toBe((h4 & 0xffff) / 65536);
    expect(r.uPhase).toBe((h4 >>> 16) / 65536);
    for (const v of Object.values(r)) expect(v >= 0 && v < 1).toBe(true);
    expect(particleRandoms(1234, 5)).toEqual(r);
    expect(particleRandoms(1235, 5)).not.toEqual(r);
  });
});

describe('evalParticle', () => {
  const origin = [10, 2, -5];
  const st = createParticleState();

  it('k = 0: matches numerical integration and stays in the cone', () => {
    const rng = new FxRng(1);
    for (let i = 0; i < 50; i++) {
      const seed = rng.next() & 0xffff;
      const dir = rng.unitVector();
      const s0 = evalParticle(lib, 0, { originWu: origin, dir, seed }, 0, createParticleState());
      expect(s0.alive).toBe(true);
      const v0 = s0.velWu.slice();
      const speed = Math.hypot(v0[0]!, v0[1]!, v0[2]!);
      expect(speed).toBeGreaterThanOrEqual(4 - 1e-6);
      expect(speed).toBeLessThanOrEqual(8 + 1e-6);
      const cos = (v0[0]! * dir[0] + v0[1]! * dir[1] + v0[2]! * dir[2]) / speed;
      expect(cos).toBeGreaterThanOrEqual(Math.cos(Math.PI / 6) - 1e-6);
      const t = 0.9 * s0.lifeS * rng.float01();
      evalParticle(lib, 0, { originWu: origin, dir, seed }, t, st);
      const ref = integrate(s0.posWu.slice(), v0, -9.8, 0, t);
      for (let k = 0; k < 3; k++) expect(st.posWu[k]!).toBeCloseTo(ref[k]!, 5);
    }
  });

  it('k > 0: matches numerical integration (drag, buoyancy, delay, emit radius)', () => {
    const rng = new FxRng(2);
    const L = 1;
    for (let i = 0; i < 50; i++) {
      const seed = rng.next() & 0xffff;
      const dir = rng.cone([0, 1, 0], 1);
      const probe = evalParticle(lib, L, { originWu: origin, dir, seed, speed: 1.5, scale: 1.2 }, 0, createParticleState());
      const delay = probe.delayS;
      expect(delay).toBeGreaterThanOrEqual(0.1 - 1e-6);
      expect(delay).toBeLessThanOrEqual(0.4 + 1e-6);
      expect(probe.alive).toBe(false);
      const s0 = evalParticle(lib, L, { originWu: origin, dir, seed, speed: 1.5, scale: 1.2 }, delay, createParticleState());
      expect(s0.alive).toBe(true);
      const off = Math.hypot(s0.posWu[0] - origin[0]!, s0.posWu[1] - origin[1]!, s0.posWu[2] - origin[2]!);
      expect(off).toBeLessThanOrEqual(0.5 * 1.2 + 1e-9);
      const t = s0.lifeS * rng.float01() * 0.95;
      evalParticle(lib, L, { originWu: origin, dir, seed, speed: 1.5, scale: 1.2 }, delay + t, st);
      const ref = integrate(s0.posWu.slice(), s0.velWu.slice(), 2.5, 1.7, t);
      for (let k = 0; k < 3; k++) expect(st.posWu[k]!).toBeCloseTo(ref[k]!, 5);
    }
  });

  it('is dead before its delay and after its lifetime', () => {
    const s = evalParticle(lib, 0, { originWu: origin, seed: 77 }, 0, createParticleState());
    const life = s.lifeS;
    expect(life).toBeGreaterThanOrEqual(2);
    expect(life).toBeLessThanOrEqual(3);
    expect(evalParticle(lib, 0, { originWu: origin, seed: 77 }, life - 1e-6).alive).toBe(true);
    expect(evalParticle(lib, 0, { originWu: origin, seed: 77 }, life).alive).toBe(false);
    expect(evalParticle(lib, 0, { originWu: origin, seed: 77 }, life + 5).alive).toBe(false);
    expect(evalParticle(lib, 0, { originWu: origin, seed: 77 }, -0.01).alive).toBe(false);
  });

  it('samples size, color and blend from the LUT with jitter and scale', () => {
    for (let seed = 0; seed < 30; seed++) {
      const s = evalParticle(lib, 0, { originWu: origin, seed, scale: 2 }, 0);
      expect(s.sizeWu).toBeGreaterThanOrEqual(2 * 0.5 - 1e-9);
      expect(s.sizeWu).toBeLessThanOrEqual(2 * 1.5 + 1e-9);
      expect(s.color).toEqual([2, 1, 0.5, 1]);
      expect(s.blend).toBe(0);
      const e = evalParticle(lib, 0, { originWu: origin, seed }, s.lifeS * 0.5);
      expect(e.age01).toBeCloseTo(0.5, 9);
      expect(e.color[0]).toBeCloseTo(1, 2);
      expect(e.blend).toBeCloseTo(0.5, 2);
    }
  });

  it('stream: starts near the origin, reaches the target at a → 1, applies the spawn tint', () => {
    const target = [18, 6, 3];
    for (let seed = 0; seed < 40; seed++) {
      const sp = { originWu: origin, targetWu: target, seed, tint: 0x80ff00 };
      const s0 = evalParticle(lib, 2, sp, 0, createParticleState());
      const d0 = Math.hypot(s0.posWu[0] - origin[0]!, s0.posWu[1] - origin[1]!, s0.posWu[2] - origin[2]!);
      expect(d0).toBeLessThanOrEqual(0.4 + 1e-9);
      expect(s0.color[0]).toBeCloseTo(2 * (0x80 / 255), 9);
      expect(s0.color[1]).toBe(1);
      expect(s0.color[2]).toBe(0);
      const end = evalParticle(lib, 2, sp, s0.lifeS * (1 - 1e-7), createParticleState());
      expect(end.alive).toBe(true);
      for (let k = 0; k < 3; k++) expect(end.posWu[k]!).toBeCloseTo(target[k]!, 4);
      // Mid-path the particle stays close to the line (wave + emit offset + sag).
      const mid = evalParticle(lib, 2, sp, s0.lifeS * 0.5, createParticleState());
      const lin = origin.map((o, k) => o + (target[k]! - o) * 0.5);
      const dm = Math.hypot(mid.posWu[0] - lin[0]!, mid.posWu[1] - lin[1]!, mid.posWu[2] - lin[2]!);
      expect(dm).toBeLessThan(0.2 + 0.3 + 0.5 * 3 * 0.35 * 0.35 + 1e-6);
    }
  });

  it('stream velocity matches the finite difference of the position', () => {
    const sp = { originWu: origin, targetWu: [0, 0, 0], seed: 9 };
    const a = evalParticle(lib, 2, sp, 0.2, createParticleState());
    const h = 1e-5;
    const b = evalParticle(lib, 2, sp, 0.2 + h, createParticleState());
    for (let k = 0; k < 3; k++) expect(a.velWu[k]!).toBeCloseTo((b.posWu[k]! - a.posWu[k]!) / h, 2);
  });

  it('spreadInner restricts directions to a ring', () => {
    for (let seed = 0; seed < 200; seed++) {
      const s = evalParticle(lib, 3, { originWu: [0, 0, 0], seed }, 0);
      const v = s.velWu;
      const cos = v[1] / Math.hypot(v[0], v[1], v[2]);
      expect(cos).toBeLessThanOrEqual(Math.cos((80 * Math.PI) / 180) + 1e-6);
      expect(cos).toBeGreaterThanOrEqual(-1e-6);
    }
  });

  it('rejects unknown layers', () => {
    expect(() => evalParticle(lib, 9, { originWu: origin, seed: 1 }, 0)).toThrow(/layer 9/);
  });
});
