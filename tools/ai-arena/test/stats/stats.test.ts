import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  eloDiff,
  mapIndexOfSeed,
  mean,
  pairingSchedule,
  passesGate,
  percentile,
  percentiles,
  sampleSide,
  sampledContestant,
  seedRange,
  successesNeeded,
  successesOf,
  wilson,
  wilsonOf,
} from '../../src/stats/index.ts';

describe('wilson', () => {
  it('matches reference values', () => {
    const a = wilson(5, 10);
    expect(a.p).toBe(0.5);
    expect(a.lo).toBeCloseTo(0.236589594, 8);
    expect(a.hi).toBeCloseTo(0.763410406, 8);
    const b = wilson(0, 10);
    expect(b.lo).toBe(0);
    expect(b.hi).toBeCloseTo(0.277540169, 8);
    expect(wilson(10, 10).hi).toBe(1);
    expect(wilson(0, 0)).toEqual({ p: 0, lo: 0, hi: 1 });
  });

  it('is symmetric and contains p', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1000 }), fc.double({ min: 0, max: 1, noNaN: true }), (n, f) => {
        const s = Math.floor(f * n);
        const w = wilson(s, n);
        const m = wilson(n - s, n);
        expect(w.lo).toBeCloseTo(1 - m.hi, 12);
        expect(w.lo).toBeLessThanOrEqual(w.p + 1e-12);
        expect(w.hi).toBeGreaterThanOrEqual(w.p - 1e-12);
      }),
      { numRuns: 200, seed: 7 },
    );
  });

  it('counts draws as half a win (ai.md §7.1)', () => {
    const t = { wins: 100, draws: 20, losses: 80 };
    expect(successesOf(t)).toBe(110);
    expect(wilsonOf(t).p).toBe(0.55);
    expect(wilsonOf(t)).toEqual(wilson(110, 200));
  });

  it('rejects invalid input', () => {
    expect(() => wilson(3, 2)).toThrow(RangeError);
    expect(() => wilson(-1, 2)).toThrow(RangeError);
    expect(() => wilson(1, 2.5)).toThrow(RangeError);
  });
});

describe('successesNeeded (ai.md §7.1 thresholds at n = 200)', () => {
  const table: readonly [number, number][] = [
    [0.55, 124],
    [0.6, 134],
    [0.65, 144],
    [0.7, 153],
    [0.75, 163],
    [0.8, 172],
    [0.9, 189],
  ];
  it.each(table)('gate %f → %i successes', (gate, needed) => {
    expect(successesNeeded(200, gate)).toBe(needed);
    expect(wilson(needed, 200).lo).toBeGreaterThanOrEqual(gate);
    expect(wilson(needed - 1, 200).lo).toBeLessThan(gate);
    expect(passesGate({ wins: needed, draws: 0, losses: 200 - needed }, gate)).toBe(true);
    expect(passesGate({ wins: needed - 1, draws: 0, losses: 201 - needed }, gate)).toBe(false);
    expect(passesGate({ wins: needed - 2, draws: 2, losses: 200 - needed }, gate)).toBe(false);
  });

  it('doubling to n = 400 lowers the required rate by about 2 points', () => {
    for (const [gate, needed200] of table) {
      const n400 = successesNeeded(400, gate) as number;
      const drop = (needed200 / 200 - n400 / 400) * 100;
      expect(drop).toBeGreaterThanOrEqual(1.4);
      expect(drop).toBeLessThanOrEqual(2.5);
    }
  });

  it('returns null for unreachable gates', () => {
    expect(successesNeeded(10, 0.9)).toBeNull();
    expect(() => successesNeeded(0, 0.5)).toThrow(RangeError);
  });
});

describe('eloDiff', () => {
  it('is 0 at 50 %, antisymmetric and clamped at [0.001, 0.999]', () => {
    expect(eloDiff(0.5)).toBe(0);
    expect(eloDiff(0.76)).toBeCloseTo(400 * 0.500602, 2);
    expect(eloDiff(0.25)).toBeCloseTo(-eloDiff(0.75), 9);
    expect(eloDiff(1)).toBe(eloDiff(0.999));
    expect(eloDiff(0)).toBe(eloDiff(0.001));
    expect(eloDiff(1)).toBeCloseTo(1199.826, 2);
    expect(() => eloDiff(Number.NaN)).toThrow(RangeError);
  });
});

describe('percentile (nearest rank)', () => {
  const v = [35, 20, 15, 50, 40];
  it('follows the nearest-rank definition', () => {
    expect(percentile(v, 0)).toBe(15);
    expect(percentile(v, 5)).toBe(15);
    expect(percentile(v, 30)).toBe(20);
    expect(percentile(v, 40)).toBe(20);
    expect(percentile(v, 50)).toBe(35);
    expect(percentile(v, 100)).toBe(50);
    expect(percentiles(v, [0, 30, 50, 100])).toEqual([15, 20, 35, 50]);
    expect(v).toEqual([35, 20, 15, 50, 40]); // input untouched
  });

  it('p95 of 1..20 is 19, p99 of 1..100 is 99', () => {
    expect(percentile(seedRange(1, 20), 95)).toBe(19);
    expect(percentile(seedRange(1, 100), 99)).toBe(99);
    expect(percentile(new Float64Array([3, -1, 2]), 50)).toBe(2);
  });

  it('is independent of input order and always returns an input value', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: -1000, max: 1000 }), { minLength: 1, maxLength: 60 }), fc.integer({ min: 0, max: 100 }), (xs, p) => {
        const r = percentile(xs, p);
        expect(xs).toContain(r);
        expect(percentile([...xs].reverse(), p)).toBe(r);
      }),
      { numRuns: 200, seed: 3 },
    );
  });

  it('rejects empty input, NaN and bad percentages', () => {
    expect(() => percentile([], 50)).toThrow(RangeError);
    expect(() => percentile([1, Number.NaN], 50)).toThrow(RangeError);
    expect(() => percentile([1], 101)).toThrow(RangeError);
  });

  it('mean sums left to right', () => {
    expect(mean([])).toBe(0);
    expect(mean([1, 2, 3, 4])).toBe(2.5);
  });
});

describe('pairingSchedule', () => {
  const maps = ['setons', 'hollow-ridge', 'tessera'];

  it('seeds 1–105 × 3 maps × swapped armies = 210 games, 70 per map', () => {
    const games = pairingSchedule({ seeds: seedRange(1, 105), maps, swap: true });
    expect(games.length).toBe(210);
    games.forEach((g, i) => expect(g.game).toBe(i));
    for (const m of maps) expect(games.filter((g) => g.map === m).length).toBe(70);
    for (const g of games) {
      expect(g.mapIndex).toBe(g.seed % 3);
      expect(g.map).toBe(maps[g.seed % 3]);
      expect(g.armyA).toBe(g.swapped ? 1 : 0);
      expect(g.armyB).toBe(g.swapped ? 0 : 1);
    }
    // Every seed exactly twice, once per army assignment, next to each other.
    for (let s = 1; s <= 105; s++) {
      const pair = games.filter((g) => g.seed === s);
      expect(pair.map((g) => g.swapped)).toEqual([false, true]);
      expect((pair[1]?.game ?? 0) - (pair[0]?.game ?? 0)).toBe(1);
    }
    expect(games[0]).toEqual({ game: 0, seed: 1, map: 'hollow-ridge', mapIndex: 1, swapped: false, armyA: 0, armyB: 1 });
  });

  it('without swap every seed is played once; seeds 1…100 give 200 games with swap', () => {
    expect(pairingSchedule({ seeds: seedRange(1, 105), maps, swap: false }).length).toBe(105);
    expect(pairingSchedule({ seeds: seedRange(1, 100), maps }).length).toBe(200);
  });

  it('rejects duplicate seeds and empty map lists', () => {
    expect(() => pairingSchedule({ seeds: [1, 1], maps })).toThrow(/duplicate/);
    expect(() => pairingSchedule({ seeds: [1], maps: [] })).toThrow(/no maps/);
    expect(mapIndexOfSeed(-1, 3)).toBe(2);
  });
});

describe('sampleSide (mirror tournaments, ai.md §7.1)', () => {
  it('samples the army with the parity of the seed', () => {
    expect(sampleSide(0)).toBe(0);
    expect(sampleSide(1)).toBe(1);
    expect(sampleSide(104)).toBe(0);
    expect(sampleSide(105)).toBe(1);
    expect(sampleSide(-3)).toBe(1);
    expect(() => sampleSide(1.5)).toThrow(RangeError);
  });

  it('takes exactly one sample per game and splits a swapped schedule evenly between the contestants', () => {
    const games = pairingSchedule({ seeds: seedRange(1, 105), maps: ['a', 'b', 'c'] });
    const a = games.filter((g) => sampledContestant(g) === 'A').length;
    expect(a).toBe(105);
    // Per seed: once A, once B (the two games of a seed have exchanged armies).
    for (let s = 1; s <= 105; s++) {
      const who = games.filter((g) => g.seed === s).map(sampledContestant);
      expect([...who].sort()).toEqual(['A', 'B']);
    }
    // Army 0 and army 1 are sampled equally often over seeds 1..104.
    const sides = seedRange(1, 104).map(sampleSide);
    expect(sides.filter((x) => x === 0).length).toBe(52);
  });
});
