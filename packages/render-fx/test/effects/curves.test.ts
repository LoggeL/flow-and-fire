import { describe, expect, it } from 'vitest';
import {
  LUT_WIDTH,
  bakeColorCurve,
  bakeCurve,
  colorCurveError,
  curveError,
  hexColor,
  sampleBaked,
  sampleColorCurve,
  sampleCurve,
} from '../../src/effects/curves.ts';

describe('curves', () => {
  it('samples constants and piecewise-linear keys with clamping', () => {
    expect(sampleCurve(2.5, 0.7)).toBe(2.5);
    const c = [
      [0.2, 1],
      [0.6, 3],
      [1, 0],
    ] as const;
    expect(sampleCurve(c, 0)).toBe(1);
    expect(sampleCurve(c, 0.2)).toBe(1);
    expect(sampleCurve(c, 0.4)).toBeCloseTo(2, 12);
    expect(sampleCurve(c, 0.6)).toBe(3);
    expect(sampleCurve(c, 0.8)).toBeCloseTo(1.5, 12);
    expect(sampleCurve(c, 1)).toBe(0);
    expect(sampleCurve([[0.5, 4]], 0.9)).toBe(4);
  });

  it('bakes keys that lie on sample points exactly and interpolates between', () => {
    const t1 = 21 / (LUT_WIDTH - 1);
    const curve = [
      [0, 0.5],
      [t1, 7.25],
      [1, 2],
    ] as const;
    const baked = bakeCurve(curve);
    expect(baked.length).toBe(LUT_WIDTH);
    expect(baked[0]).toBe(0.5);
    expect(baked[21]).toBe(7.25);
    expect(baked[LUT_WIDTH - 1]).toBe(2);
    expect(baked[10]).toBeCloseTo(0.5 + (7.25 - 0.5) * (10 / 21), 5);
    // LUT sampling between texels reproduces the piecewise-linear curve.
    for (const a of [0, 0.05, t1, 0.5, 0.77, 1]) {
      expect(sampleBaked(baked, 0, LUT_WIDTH, 1, a, 0)).toBeCloseTo(sampleCurve(curve, a), 5);
    }
  });

  it('bakes color curves channel-wise', () => {
    const cc = [
      [0, 4, 2, 1, 1],
      [1, 0, 0, 0, 0],
    ] as const;
    const baked = bakeColorCurve(cc, 5);
    expect(Array.from(baked.subarray(0, 4))).toEqual([4, 2, 1, 1]);
    expect(Array.from(baked.subarray(8, 12))).toEqual([2, 1, 0.5, 0.5]);
    expect(Array.from(baked.subarray(16, 20))).toEqual([0, 0, 0, 0]);
    expect(Array.from(sampleColorCurve(cc, 0.25))).toEqual([3, 1.5, 0.75, 0.75]);
    expect(() => bakeCurve(1, 1)).toThrow(/n=1/);
  });

  it('parses hex colors as linear values with intensity', () => {
    expect(hexColor('#FF8000')).toEqual([1, 128 / 255, 0]);
    expect(hexColor('FFD9A0', 4)[0]).toBe(4);
    expect(() => hexColor('#FFF')).toThrow(/invalid color/);
  });

  it('reports invalid curves', () => {
    expect(curveError(1, 0, 2)).toBeNull();
    expect(curveError(3, 0, 2)).toMatch(/outside/);
    expect(curveError(Number.NaN, 0, 2)).toMatch(/finite/);
    expect(curveError([], 0, 2)).toMatch(/at least one key/);
    expect(curveError([[0.5, 1], [0.5, 1]], 0, 2)).toMatch(/strictly ascending/);
    expect(curveError([[0.8, 1], [0.2, 1]], 0, 2)).toMatch(/strictly ascending/);
    expect(curveError([[1.2, 1]], 0, 2)).toMatch(/outside \[0, 1\]/);
    expect(curveError([[0, -1]], 0, 2)).toMatch(/outside/);
    expect(colorCurveError([[0, 1, 1, 1, 1]])).toBeNull();
    expect(colorCurveError([[0, 17, 1, 1, 1]])).toMatch(/color component/);
    expect(colorCurveError([[0, 1, 1, 1, 1.5]])).toMatch(/alpha/);
    expect(colorCurveError([[0, 1, 1, 1] as unknown as [number, number, number, number, number]])).toMatch(/\[t, r, g, b, a\]/);
  });
});
