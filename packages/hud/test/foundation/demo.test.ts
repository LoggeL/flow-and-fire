import { describe, expect, test } from 'vitest';
import { DEMO_SEED, chance, createDemoRng, int, mulberry32, pick, range, shuffle } from '../../src/demo/index.ts';

describe('demo PRNG', () => {
  test('mulberry32 is deterministic and in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const xs = Array.from({ length: 1000 }, () => a());
    expect(xs).toEqual(Array.from({ length: 1000 }, () => b()));
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
    // Pinned first values: changing the generator would silently change every demo/story.
    const r = mulberry32(DEMO_SEED);
    expect([r(), r(), r()].map((x) => Math.round(x * 1e6))).toEqual([428359, 962429, 941235]);
    expect(createDemoRng()()).toBe(mulberry32(DEMO_SEED)());
  });

  test('helpers', () => {
    const r = createDemoRng(7);
    for (let i = 0; i < 200; i++) {
      const n = int(r, 3, 5);
      expect([3, 4, 5]).toContain(n);
      const f = range(r, -2, 2);
      expect(f).toBeGreaterThanOrEqual(-2);
      expect(f).toBeLessThan(2);
    }
    expect(['a', 'b']).toContain(pick(r, ['a', 'b']));
    expect(() => pick(r, [])).toThrow();
    const list = [1, 2, 3, 4, 5, 6];
    const s = shuffle(createDemoRng(9), list);
    expect(s.slice().sort()).toEqual(list);
    expect(list).toEqual([1, 2, 3, 4, 5, 6]);
    expect(shuffle(createDemoRng(9), list)).toEqual(s);
    expect(chance(r, 0)).toBe(false);
    expect(chance(r, 1)).toBe(true);
  });
});
