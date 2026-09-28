import { XxHash32 } from '@faf/fixed';
import { describe, expect, it } from 'vitest';
import { ArenaBuilder, defineDense, defineSlab, defineTable, ruleHash } from '../src/index.ts';

describe('hot paths do not allocate', () => {
  it('alloc/free/resolve/dense/slab/ruleHash/snapshot(target) stay flat on the heap', () => {
    const b = new ArenaBuilder();
    const t = b.addTable(defineTable('units', 4096, { x: 'i32', z: 'i32', m: 'f64s', f: 'u16' }));
    const d = b.addDense(defineDense('movers', 4096, { vx: 'i32' }));
    const s = b.addSlab(defineSlab('orders', 32, 4096));
    const arena = b.build();
    const h = new XxHash32();
    const snap = new Uint8Array(arena.snapshotByteLength);
    const gc = (globalThis as { gc?: () => void }).gc;
    const cycle = (k: number): number => {
      const i = t.alloc();
      t.col.x[i] = k;
      t.col.m.set(i, k);
      const r = d.add(i);
      const o = s.alloc();
      const hd = t.handle(i);
      let acc = t.resolve(hd) + r + o;
      if (t.liveCount > 2000) {
        const victim = d.owner[0]!;
        const moved = d.removeAt(0);
        acc += moved;
        t.free(victim);
        s.free(o);
      }
      return acc;
    };
    for (let k = 0; k < 5000; k++) cycle(k);
    ruleHash(arena, h);
    arena.snapshot(snap);
    gc?.();
    const before = process.memoryUsage().heapUsed;
    let acc = 0;
    for (let k = 0; k < 200_000; k++) {
      acc += cycle(k);
      if ((k & 1023) === 0) {
        acc += ruleHash(arena, h);
        arena.snapshot(snap);
        arena.restore(snap);
      }
    }
    gc?.();
    const grown = process.memoryUsage().heapUsed - before;
    expect(acc).not.toBe(0.5);
    if (gc !== undefined) expect(grown).toBeLessThan(256 * 1024);
  });
});
