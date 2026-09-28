import { describe, expect, it } from 'vitest';
import { ArenaBuilder, defineDense, defineSlab } from '../src/index.ts';

describe('dense components', () => {
  it('adds packed rows and swap-removes with moved owner', () => {
    const b = new ArenaBuilder();
    const d = b.addDense(defineDense('movers', 4, { v: 'i32', s: 'f64s' }));
    b.build();
    expect(d.add(10)).toBe(0);
    expect(d.add(11)).toBe(1);
    expect(d.add(12)).toBe(2);
    d.col.v[0] = 100;
    d.col.v[1] = 101;
    d.col.v[2] = 102;
    d.col.s.set(2, 2 ** 40);
    expect(d.count).toBe(3);
    // remove middle → last row moves into it
    expect(d.removeAt(0)).toBe(12);
    expect(d.count).toBe(2);
    expect(Array.from(d.owner.subarray(0, 2))).toEqual([12, 11]);
    expect(d.col.v[0]).toBe(102);
    expect(d.col.s.get(0)).toBe(2 ** 40);
    expect(d.col.v[2]).toBe(0); // vacated row zeroed
    // remove last → nothing moves
    expect(d.removeAt(1)).toBe(-1);
    expect(d.count).toBe(1);
    expect(() => d.removeAt(1)).toThrow(RangeError);
    expect(d.add(20)).toBe(1);
    expect(d.add(21)).toBe(2);
    expect(d.add(22)).toBe(3);
    expect(d.add(23)).toBe(-1);
  });

  it('keeps back-pointers consistent under random add/remove', () => {
    const b = new ArenaBuilder();
    const d = b.addDense(defineDense('c', 64, { tag: 'i32' }));
    b.build();
    const back = new Int32Array(1000).fill(-1); // owner → row
    let seed = 12345;
    const rnd = (n: number) => {
      seed = (Math.imul(seed, 1103515245) + 12345) | 0;
      return ((seed >>> 8) % n + n) % n;
    };
    let nextOwner = 0;
    for (let step = 0; step < 5000; step++) {
      if (d.count === 0 || (d.count < 64 && rnd(2) === 0)) {
        const o = nextOwner++ % 1000;
        if (back[o] !== -1) continue;
        const r = d.add(o);
        d.col.tag[r] = o * 7;
        back[o] = r;
      } else {
        const r = rnd(d.count);
        const gone = d.owner[r]!;
        const moved = d.removeAt(r);
        back[gone] = -1;
        if (moved >= 0) back[moved] = r;
      }
      for (let r = 0; r < d.count; r++) {
        const o = d.owner[r]!;
        expect(back[o]).toBe(r);
        expect(d.col.tag[r]).toBe(o * 7);
      }
    }
  });
});

describe('slabs', () => {
  it('allocates zeroed fixed-size records FIFO', () => {
    const b = new ArenaBuilder();
    const s = b.addSlab(defineSlab('orders', 32, 3));
    b.build();
    expect(s.recordWords).toBe(8);
    const a = s.alloc();
    const c = s.alloc();
    expect([a, c]).toEqual([0, 1]);
    s.i32.fill(-1, s.wordOffset(a), s.wordOffset(a) + 8);
    s.u8[s.byteOffset(c) + 31] = 5;
    s.free(c);
    s.free(a);
    expect(s.alloc()).toBe(1);
    expect(s.u8[s.byteOffset(1) + 31]).toBe(0);
    expect(s.alloc()).toBe(0);
    expect(Array.from(s.i32.subarray(0, 8))).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(s.alloc()).toBe(2);
    expect(s.alloc()).toBe(-1);
    expect(s.liveCount).toBe(3);
    expect(() => s.free(7)).toThrow(RangeError);
    s.free(2);
    expect(() => s.free(2)).toThrow(RangeError);
    expect(s.isLive(2)).toBe(false);
  });
});
