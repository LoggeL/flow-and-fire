/** Distribution summaries of tournament and benchmark reports (nearest rank). */
import { describe, expect, it } from 'vitest';
import { EMPTY_SUMMARY, medianOrNull, shareAtMost, summarize } from '../../src/stats/index.ts';

describe('summarize', () => {
  it('n, mean, p50/p95/p99, max by nearest rank', () => {
    const v = Array.from({ length: 100 }, (_, i) => 100 - i);
    expect(summarize(v)).toEqual({ n: 100, mean: 50.5, p50: 50, p95: 95, p99: 99, max: 100 });
    expect(summarize([7])).toEqual({ n: 1, mean: 7, p50: 7, p95: 7, p99: 7, max: 7 });
    expect(summarize([])).toBe(EMPTY_SUMMARY);
  });

  it('median or null, share at most a limit', () => {
    expect(medianOrNull([])).toBeNull();
    expect(medianOrNull([3, 1, 2])).toBe(2);
    expect(shareAtMost([1, 2, null, 4], 2)).toBe(0.5);
    expect(shareAtMost([], 2)).toBe(0);
  });
});
