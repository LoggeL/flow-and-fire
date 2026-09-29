import fc from 'fast-check';
import { fx } from '@faf/fixed';
import { describe, expect, it } from 'vitest';
import { createWorld, forEachInRadius, queryRadius, step, type UnitVisitor, type World } from '../src/index.ts';
import { gameTable, killCmd, spawnCmd } from './support/fixtures.ts';

function bruteForce(w: World, x: number, z: number, r: number): number[] {
  const out: number[] = [];
  const U = w.units.col;
  for (let i = 0; i < w.units.highWater; i++) {
    if (!w.units.isLive(i)) continue;
    const dx = U.x[i]! - x;
    const dz = U.z[i]! - z;
    if (dx * dx + dz * dz <= r * r) out.push(i);
  }
  return out;
}

describe('spatial grids (S5)', () => {
  it('radius queries equal brute force on the fine and the coarse grid (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.array(fc.record({ n: fc.integer({ min: 1, max: 120 }), x: fc.integer({ min: 0, max: 256 }), z: fc.integer({ min: 0, max: 256 }), s: fc.integer({ min: 0, max: 60 }) }), { minLength: 1, maxLength: 5 }),
        fc.array(fc.record({ x: fc.integer({ min: -20, max: 276 }), z: fc.integer({ min: -20, max: 276 }), r: fc.integer({ min: 0, max: 200 * 4096 }) }), { minLength: 1, maxLength: 12 }),
        fc.boolean(),
        (seed, spawns, queries, kill) => {
          const w = createWorld({ bpTable: gameTable(), seed, armyCount: 1, mapSizeWu: 256 });
          step(w, spawns.map((s) => spawnCmd(0, s.n, s.x, s.z, s.s)));
          if (kill) {
            // Kill some units, then rebuild: dead slots must disappear from the grid.
            const hs: number[] = [];
            for (let i = 0; i < w.units.highWater; i += 3) hs.push(w.units.handle(i));
            step(w, [killCmd(0, hs as never)]);
          }
          const buf = new Int32Array(10000);
          for (const q of queries) {
            const x = fx(q.x);
            const z = fx(q.z);
            const expected = bruteForce(w, x, z, q.r);
            const n = queryRadius(w, x, z, q.r, buf);
            const got = Array.from(buf.subarray(0, n)).sort((a, b) => a - b);
            expect(got).toEqual(expected);
          }
        },
      ),
      { numRuns: 150 },
    );
  });

  it('visits in cell-major, ascending-slot order and supports early stop', () => {
    const w = createWorld({ bpTable: gameTable(), seed: 3, armyCount: 1 });
    step(w, [spawnCmd(0, 300, 100, 100, 30)]);
    const seen: number[] = [];
    const v: UnitVisitor = { visit: (s) => (seen.push(s), seen.length < 10) };
    const n = forEachInRadius(w, fx(100), fx(100), fx(12), v);
    expect(n).toBe(10);
    expect(seen.length).toBe(10);
    const cells = seen.map((s) => w.fine.cellOf[s]!);
    for (let i = 1; i < seen.length; i++) {
      expect(cells[i]! > cells[i - 1]! || (cells[i] === cells[i - 1] && seen[i]! > seen[i - 1]!)).toBe(true);
    }
    // Result buffer smaller than the hit count: truncated, no overflow.
    const small = new Int32Array(4);
    expect(queryRadius(w, fx(100), fx(100), fx(30), small)).toBe(4);
  });

  it('buckets are consistent (counting sort invariants)', () => {
    const w = createWorld({ bpTable: gameTable(), seed: 5, armyCount: 1 });
    step(w, [spawnCmd(0, 1000, 256, 256, 200)]);
    for (const g of [w.fine, w.coarse]) {
      const cells = g.dim * g.dim;
      expect(g.start[0]).toBe(0);
      expect(g.start[cells]).toBe(1000);
      for (let c = 0; c < cells; c++) {
        for (let k = g.start[c]!; k < g.start[c + 1]!; k++) {
          const s = g.items[k]!;
          expect(g.cellOf[s]).toBe(c);
          if (k > g.start[c]!) expect(s).toBeGreaterThan(g.items[k - 1]!);
        }
      }
    }
  });
});
