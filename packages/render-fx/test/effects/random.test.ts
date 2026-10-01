import { describe, expect, it } from 'vitest';
import { FxRng, fxFmix32, fxHash32, hashToUnit, orthonormalBasis } from '../../src/effects/random.ts';

describe('fxHash32', () => {
  it('is a deterministic u32 and sensitive to every argument', () => {
    const h = fxHash32(1, 2, 3);
    expect(h).toBe(fxHash32(1, 2, 3));
    expect(Number.isInteger(h) && h >= 0 && h < 2 ** 32).toBe(true);
    expect(fxHash32(1, 2, 4)).not.toBe(h);
    expect(fxHash32(1, 3, 3)).not.toBe(h);
    expect(fxHash32(2, 2, 3)).not.toBe(h);
    expect(fxHash32(1)).toBe(fxHash32(1, 0, 0));
  });

  it('matches the documented formula (GLSL mirror contract)', () => {
    const a = 12345;
    const b = 678;
    const c = 9;
    let h = fxFmix32((a + 0x9e3779b9) >>> 0);
    h = fxFmix32((h ^ ((b + 0x7f4a7c15) >>> 0)) >>> 0);
    h = fxFmix32((h ^ ((c + 0x94d049bb) >>> 0)) >>> 0);
    expect(fxHash32(a, b, c)).toBe(h);
    // Fixed reference values guard against accidental formula changes.
    expect(fxFmix32(0)).toBe(0);
    expect(fxFmix32(1)).toBe(0x514e28b7);
  });

  it('wraps inputs to u32 like GLSL uint arithmetic', () => {
    expect(fxHash32(2 ** 32 + 5)).toBe(fxHash32(5));
    expect(fxHash32(-1)).toBe(fxHash32(0xffffffff));
  });

  it('has roughly uniform low bits', () => {
    const buckets = new Array<number>(16).fill(0);
    for (let i = 0; i < 16000; i++) buckets[fxHash32(i, 7) & 15]!++;
    for (const b of buckets) expect(Math.abs(b - 1000)).toBeLessThan(150);
    expect(hashToUnit(0xffffffff)).toBeLessThan(1);
  });
});

describe('FxRng', () => {
  it('replays the same sequence for the same seed', () => {
    const a = new FxRng(42);
    const b = new FxRng(42);
    const c = new FxRng(43);
    const sa = Array.from({ length: 50 }, () => a.next());
    const sb = Array.from({ length: 50 }, () => b.next());
    const sc = Array.from({ length: 50 }, () => c.next());
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
    a.reseed(42);
    expect(a.next()).toBe(sa[0]);
  });

  it('float01/range/int are in range with a uniform mean', () => {
    const r = new FxRng(7);
    let sum = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const f = r.float01();
      expect(f >= 0 && f < 1).toBe(true);
      sum += f;
      const x = r.range(-3, 5);
      expect(x >= -3 && x < 5).toBe(true);
      const k = r.int(2, 4);
      expect(k >= 2 && k <= 4 && Number.isInteger(k)).toBe(true);
    }
    expect(Math.abs(sum / n - 0.5)).toBeLessThan(0.01);
  });

  it('unitVector is unit length and isotropic', () => {
    const r = new FxRng(3);
    const mean = [0, 0, 0];
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const v = r.unitVector();
      expect(Math.hypot(v[0], v[1], v[2])).toBeCloseTo(1, 12);
      for (let k = 0; k < 3; k++) mean[k]! += v[k]! / n;
    }
    for (const m of mean) expect(Math.abs(m)).toBeLessThan(0.02);
  });

  it('cone stays inside the half angle around arbitrary axes', () => {
    const r = new FxRng(11);
    const axes = [
      [0, 1, 0],
      [0, 0, -1],
      [0, 0, 1],
      [1 / Math.sqrt(3), -1 / Math.sqrt(3), 1 / Math.sqrt(3)],
    ];
    const half = (20 * Math.PI) / 180;
    for (const ax of axes) {
      let minCos = 1;
      for (let i = 0; i < 2000; i++) {
        const v = r.cone(ax, half);
        expect(Math.hypot(v[0], v[1], v[2])).toBeCloseTo(1, 10);
        const c = v[0] * ax[0]! + v[1] * ax[1]! + v[2] * ax[2]!;
        minCos = Math.min(minCos, c);
      }
      expect(minCos).toBeGreaterThanOrEqual(Math.cos(half) - 1e-9);
      expect(minCos).toBeLessThan(Math.cos(half * 0.9));
    }
  });
});

describe('orthonormalBasis', () => {
  it('builds an orthonormal frame for many normals', () => {
    const r = new FxRng(5);
    const b = new Float64Array(6);
    for (let i = 0; i < 1000; i++) {
      const n = r.unitVector();
      orthonormalBasis(n[0], n[1], n[2], b);
      const dot = (o1: number, v: readonly number[]): number => b[o1]! * v[0]! + b[o1 + 1]! * v[1]! + b[o1 + 2]! * v[2]!;
      expect(dot(0, n)).toBeCloseTo(0, 9);
      expect(dot(3, n)).toBeCloseTo(0, 9);
      expect(dot(0, [b[3]!, b[4]!, b[5]!])).toBeCloseTo(0, 9);
      expect(Math.hypot(b[0]!, b[1]!, b[2]!)).toBeCloseTo(1, 9);
      expect(Math.hypot(b[3]!, b[4]!, b[5]!)).toBeCloseTo(1, 9);
    }
  });
});
