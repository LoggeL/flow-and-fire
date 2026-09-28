import { describe, expect, it } from 'vitest';
import { ArenaBuilder, HANDLE_NONE, defineTable, packHandle, unpackGen, unpackIndex } from '../src/index.ts';

function mk(cap = 8) {
  const b = new ArenaBuilder();
  const t = b.addTable(defineTable('t', cap, { x: 'i32', m: 'f64s', f: 'u8' }));
  const arena = b.build();
  return { t, arena };
}

describe('handles', () => {
  it('packs index:20 | gen:12', () => {
    const h = packHandle(0xabcde, 0x123);
    expect(h).toBe(((0x123 << 20) | 0xabcde) >>> 0);
    expect(unpackIndex(h)).toBe(0xabcde);
    expect(unpackGen(h)).toBe(0x123);
    expect(unpackIndex(packHandle(0xfffff, 0xfff))).toBe(0xfffff);
    expect(HANDLE_NONE).toBe(0xffffffff);
  });
});

describe('table alloc/free', () => {
  it('allocates by highWater, reuses freed slots FIFO, returns −1 when full', () => {
    const { t } = mk(4);
    expect([t.alloc(), t.alloc(), t.alloc()]).toEqual([0, 1, 2]);
    expect(t.highWater).toBe(3);
    t.free(1);
    t.free(0);
    expect(t.liveCount).toBe(1);
    expect(t.freeCount).toBe(2);
    expect(t.alloc()).toBe(1); // freed first → reused first
    expect(t.alloc()).toBe(0);
    expect(t.alloc()).toBe(3); // freelist empty → highWater
    expect(t.alloc()).toBe(-1);
    expect(t.liveCount).toBe(4);
    t.free(2);
    t.free(3);
    t.free(0);
    expect(t.alloc()).toBe(2);
    expect(t.alloc()).toBe(3);
    expect(t.alloc()).toBe(0);
    expect(t.alloc()).toBe(-1);
  });

  it('wraps the freelist ring correctly', () => {
    const { t } = mk(3);
    t.alloc();
    t.alloc();
    t.alloc();
    for (let k = 0; k < 20; k++) {
      const victim = k % 3;
      t.free(victim);
      expect(t.alloc()).toBe(victim);
    }
    expect(t.highWater).toBe(3);
    expect(t.liveCount).toBe(3);
  });

  it('zeroes columns on alloc and keeps generation', () => {
    const { t } = mk();
    const i = t.alloc();
    t.col.x[i] = 77;
    t.col.m.set(i, 2 ** 50);
    t.col.f[i] = 9;
    t.free(i);
    expect(t.alloc()).toBe(i);
    expect(t.col.x[i]).toBe(0);
    expect(t.col.m.get(i)).toBe(0);
    expect(t.col.f[i]).toBe(0);
    expect(t.gen[i]).toBe(1);
  });

  it('rejects double free and free of never-allocated slots', () => {
    const { t } = mk();
    const i = t.alloc();
    t.free(i);
    expect(() => t.free(i)).toThrow(RangeError);
    expect(() => t.free(5)).toThrow(RangeError);
    expect(() => t.free(-1)).toThrow(RangeError);
  });

  it('resolves handles, rejects stale generations, dead slots and HANDLE_NONE', () => {
    const { t } = mk();
    const i = t.alloc();
    const h = t.handle(i);
    expect(t.resolve(h)).toBe(i);
    t.free(i);
    expect(t.resolve(h)).toBe(-1);
    expect(t.alloc()).toBe(i);
    expect(t.resolve(h)).toBe(-1); // same slot, new generation
    expect(t.resolve(t.handle(i))).toBe(i);
    expect(t.resolve(HANDLE_NONE)).toBe(-1);
    expect(t.resolve(packHandle(7, 0))).toBe(-1); // beyond highWater
  });

  it('wraps the 12-bit generation after 4096 frees', () => {
    const { t } = mk(1);
    let i = t.alloc();
    const h0 = t.handle(i);
    for (let k = 0; k < 4095; k++) {
      t.free(i);
      i = t.alloc();
      expect(t.resolve(h0)).toBe(-1);
    }
    expect(t.gen[i]).toBe(4095);
    t.free(i);
    i = t.alloc();
    expect(t.gen[i]).toBe(0);
    // ABA after a full wrap is inherent to 12-bit generations
    expect(t.resolve(h0)).toBe(i);
  });

  it('SafeInt columns normalize −0 and hold 2^53−1', () => {
    const { t, arena } = mk();
    const i = t.alloc();
    t.col.m.set(i, -0);
    expect(Object.is(t.col.m.get(i), 0)).toBe(true);
    const dv = new DataView(arena.memory.buffer);
    const off = arena.regions[0]!.parts.find((p) => p.name === 'm')!.byteOffset + i * 8;
    expect(dv.getUint32(off + 4, true)).toBe(0); // no sign bit
    t.col.m.set(i, Number.MAX_SAFE_INTEGER);
    expect(t.col.m.get(i)).toBe(Number.MAX_SAFE_INTEGER);
    expect(t.col.m.add(i, -1)).toBe(Number.MAX_SAFE_INTEGER - 1);
    t.col.m.set(i, 5);
    expect(Object.is(t.col.m.add(i, -5), 0)).toBe(true);
  });
});
