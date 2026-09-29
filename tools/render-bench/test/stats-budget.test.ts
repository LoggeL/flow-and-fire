import { describe, expect, it } from 'vitest';
import { SHADOW_UNIT_LODS, drawBudget } from '../src/budget.ts';
import { MS2_MAX_DRAWS, SCENARIOS, SPK4_MAX_DRAWS } from '../src/scenarios.ts';
import { Samples, fmt, fmtRange, percentileSorted, summarize } from '../src/stats.ts';

describe('statistics', () => {
  it('nearest-rank percentiles', () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    expect(percentileSorted(xs, 50)).toBe(50);
    expect(percentileSorted(xs, 95)).toBe(95);
    expect(percentileSorted(xs, 99)).toBe(99);
    expect(percentileSorted(xs, 100)).toBe(100);
    expect(percentileSorted(xs, 0)).toBe(1);
    expect(percentileSorted([7], 95)).toBe(7);
    expect(percentileSorted([], 50)).toBeNaN();
    expect(percentileSorted([1, 2, 3, 4], 50)).toBe(2);
    expect(percentileSorted([1, 2, 3, 4], 51)).toBe(3);
  });

  it('summaries skip missing samples (NaN) and respect the count', () => {
    const s = summarize([3, Number.NaN, 1, 2, Number.POSITIVE_INFINITY, 100], 5);
    expect(s.n).toBe(3);
    expect(s.min).toBe(1);
    expect(s.max).toBe(3);
    expect(s.mean).toBe(2);
    expect(s.p50).toBe(2);
    const empty = summarize([]);
    expect(empty.n).toBe(0);
    expect(empty.mean).toBeNaN();
  });

  it('sample buffer grows and supports late writes (GPU results)', () => {
    const b = new Samples(2);
    for (let i = 0; i < 5; i++) b.push(Number.NaN);
    b.set(3, 4);
    b.set(1, 2);
    expect(b.length).toBe(5);
    expect(b.summary().n).toBe(2);
    expect(b.summary().max).toBe(4);
  });

  it('formats German numbers and ranges', () => {
    expect(fmt(1.234)).toBe('1,23');
    expect(fmt(Number.NaN)).toBe('–');
    expect(fmtRange([0.5, 0.25, 0.75])).toBe('0,25–0,75');
    expect(fmtRange([2, 2])).toBe('2,00');
    expect(fmtRange([])).toBe('–');
  });
});

describe('draw budget', () => {
  it('full: CSM + props + HDR post stay far below the SPK4 limit', () => {
    const b = drawBudget(SCENARIOS.full);
    expect(b.units).toBe(12 * 3);
    expect(b.props).toBe(3 * 2);
    expect(b.shadowUnits).toBe(2 * 12 * SHADOW_UNIT_LODS);
    expect(b.shadowStatic).toBe(2 * (1 + 3));
    expect(b.post).toBe(5 + 4 + 1 + 1);
    expect(b.steady).toBe(1 + 1 + 36 + 6 + 48 + 11);
    expect(b.worst).toBe(b.steady + 8);
    expect(b.worst).toBeLessThanOrEqual(SPK4_MAX_DRAWS);
  });

  it('fallback: blob shadows and one impostor draw instead of CSM', () => {
    const b = drawBudget(SCENARIOS.fallback);
    expect(b.shadowUnits).toBe(0);
    expect(b.shadowStatic).toBe(0);
    expect(b.blob).toBe(1);
    expect(b.impostors).toBe(1);
    expect(b.worst).toBe(1 + 1 + 36 + 6 + 1 + 1 + 11);
    expect(b.worst).toBeLessThanOrEqual(SPK4_MAX_DRAWS);
  });

  it('ms2: facade draws = (visual, LOD) buckets + fixed passes ≤ 50', () => {
    const b = drawBudget(SCENARIOS.ms2);
    expect(b.worst).toBe(36 + 4);
    expect(b.worst).toBeLessThanOrEqual(MS2_MAX_DRAWS);
  });

  it('scales with the scene shape (draws per (visual, LOD), not per instance)', () => {
    const shape = { unitVisuals: 40, unitLods: 3, propMeshes: 8, propLods: 2 };
    const b = drawBudget(SCENARIOS.full, shape);
    expect(b.units).toBe(120);
    expect(b.shadowUnits).toBe(160);
    expect(b.worst).toBeGreaterThan(SPK4_MAX_DRAWS); // 40 visuals would need multi-draw or merged casters
  });
});
