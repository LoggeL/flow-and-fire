import { XxHash32 } from '@faf/fixed';
import { describe, expect, it } from 'vitest';
import {
  ArenaBuilder,
  defineDense,
  defineRegion,
  defineSlab,
  defineTable,
  fullHash,
  regionHash,
  ruleHash,
} from '../src/index.ts';

function world() {
  const b = new ArenaBuilder();
  const units = b.addTable(defineTable('units', 64, { x: 'i32', z: 'i32', hp: 'u16', m: 'f64s' }));
  const movers = b.addDense(defineDense('movers', 64, { vx: 'i32' }));
  const orders = b.addSlab(defineSlab('orders', 32, 32));
  const armies = b.addRegion(defineRegion('armies', 16 * 64));
  const grid = b.addRegion(defineRegion('grid', 4096, { derived: true }));
  const height = b.addRegion(defineRegion('height', 4096, { area: 'static' }));
  const arena = b.build();
  return { arena, units, movers, orders, armies, grid, height };
}

type World = ReturnType<typeof world>;

function populate(w: World, salt: number): void {
  for (let k = 0; k < 20; k++) {
    const i = w.units.alloc();
    w.units.col.x[i] = k * 1000 + salt;
    w.units.col.z[i] = -k;
    w.units.col.hp[i] = 300;
    w.units.col.m.set(i, k * 2 ** 40);
    const r = w.movers.add(i);
    w.movers.col.vx[r] = k + salt;
    const o = w.orders.alloc();
    w.orders.i32[w.orders.wordOffset(o)] = k;
  }
  for (let k = 0; k < 20; k += 3) w.units.free(k);
  w.movers.removeAt(2);
  w.orders.free(4);
  w.armies.u32[3] = 0xdeadbeef + salt;
  w.grid.u8[100] = 7;
  w.height.u16[5] = 1234;
}

describe('snapshot / restore', () => {
  it('restores the dynamic range bit-exactly and keeps views valid', () => {
    const w = world();
    const h = new XxHash32();
    populate(w, 1);
    const snap = w.arena.snapshot();
    expect(snap.length).toBe(w.arena.snapshotByteLength);
    const rule0 = ruleHash(w.arena, h);
    const full0 = fullHash(w.arena, h);
    const bytes0 = w.arena.bytes.slice(w.arena.dynamicStart, w.arena.dynamicEnd);

    // mutate everything, including allocator state
    populate(w, 2);
    w.units.free(w.units.alloc());
    expect(ruleHash(w.arena, h)).not.toBe(rule0);

    w.arena.restore(snap);
    expect(ruleHash(w.arena, h)).toBe(rule0);
    expect(fullHash(w.arena, h)).toBe(full0);
    expect(w.arena.bytes.slice(w.arena.dynamicStart, w.arena.dynamicEnd)).toEqual(bytes0);
    // allocator state restored: next alloc is identical in a fresh replay
    const fresh = world();
    populate(fresh, 1);
    expect(w.units.alloc()).toBe(fresh.units.alloc());
    expect(w.orders.alloc()).toBe(fresh.orders.alloc());
    expect(w.units.col.x[1]).toBe(1001);
  });

  it('snapshot into a target does not allocate a new buffer; static area is untouched by restore', () => {
    const w = world();
    populate(w, 1);
    const target = new Uint8Array(w.arena.snapshotByteLength + 16);
    expect(w.arena.snapshot(target)).toBe(target);
    w.height.u16[5] = 999;
    w.arena.restore(target);
    expect(w.height.u16[5]).toBe(999);
    expect(() => w.arena.snapshot(new Uint8Array(3))).toThrow(RangeError);
    expect(() => w.arena.restore(new Uint8Array(3))).toThrow(RangeError);
  });

  it('two worlds built and populated identically hash identically', () => {
    const a = world();
    const b = world();
    populate(a, 5);
    populate(b, 5);
    const h = new XxHash32();
    expect(ruleHash(a.arena, h)).toBe(ruleHash(b.arena, h));
    expect(fullHash(a.arena, h)).toBe(fullHash(b.arena, h));
  });

  it('resetDynamic empties all regions', () => {
    const w = world();
    const h = new XxHash32();
    const empty = ruleHash(w.arena, h);
    populate(w, 1);
    w.arena.resetDynamic();
    expect(w.units.highWater).toBe(0);
    expect(w.movers.count).toBe(0);
    expect(ruleHash(w.arena, h)).toBe(empty);
    expect(w.units.alloc()).toBe(0);
  });
});

describe('rule hash vs full hash', () => {
  it('ignores bytes beyond highWater / count', () => {
    const w = world();
    const h = new XxHash32();
    populate(w, 1);
    const rule = ruleHash(w.arena, h);
    const full = fullHash(w.arena, h);
    const hw = w.units.highWater;
    w.units.col.x[hw + 3] = 42;
    w.units.col.m.set(hw, 99);
    w.units.gen[hw + 1] = 5;
    w.units.alive[hw + 2] = 1;
    w.movers.col.vx[w.movers.count + 1] = 42;
    w.movers.owner[w.movers.count] = 42;
    w.orders.u8[w.orders.byteOffset(w.orders.highWater) + 5] = 42;
    expect(ruleHash(w.arena, h)).toBe(rule);
    expect(fullHash(w.arena, h)).toBe(full);
  });

  it('ignores derived and static regions in the rule hash, full hash sees derived only', () => {
    const w = world();
    const h = new XxHash32();
    populate(w, 1);
    const rule = ruleHash(w.arena, h);
    const full = fullHash(w.arena, h);
    w.grid.u8[1] = 1;
    expect(ruleHash(w.arena, h)).toBe(rule);
    expect(fullHash(w.arena, h)).not.toBe(full);
    w.grid.u8[1] = 0;
    expect(fullHash(w.arena, h)).toBe(full);
    w.height.u8[9] = 1;
    expect(ruleHash(w.arena, h)).toBe(rule);
    expect(fullHash(w.arena, h)).toBe(full);
  });

  it('sees every live change (column, gen, freelist order, dense, slab, raw)', () => {
    const w = world();
    const h = new XxHash32();
    populate(w, 1);
    const base = ruleHash(w.arena, h);
    const check = (mut: () => void, undo: () => void) => {
      mut();
      expect(ruleHash(w.arena, h)).not.toBe(base);
      undo();
      expect(ruleHash(w.arena, h)).toBe(base);
    };
    check(() => (w.units.col.z[1] = 5), () => (w.units.col.z[1] = -1));
    check(() => w.units.col.m.set(1, 1), () => w.units.col.m.set(1, 2 ** 40));
    check(() => (w.units.gen[1] = 3), () => (w.units.gen[1] = 0));
    check(() => (w.movers.col.vx[0] = 0), () => (w.movers.col.vx[0] = 1));
    check(() => (w.orders.i32[1] = 1), () => (w.orders.i32[1] = 0));
    check(() => (w.armies.u8[0] = 1), () => (w.armies.u8[0] = 0));
  });

  it('freelist order is part of the rule hash', () => {
    const a = world();
    const b = world();
    for (const w of [a, b]) for (let k = 0; k < 4; k++) w.units.alloc();
    a.units.free(1);
    a.units.free(2);
    b.units.free(2);
    b.units.free(1);
    const h = new XxHash32();
    expect(ruleHash(a.arena, h)).not.toBe(ruleHash(b.arena, h));
  });

  it('regionHash isolates a single table', () => {
    const w = world();
    const h = new XxHash32();
    populate(w, 1);
    const u = regionHash(w.units, w.arena, h);
    const m = regionHash(w.movers, w.arena, h);
    w.movers.col.vx[0] = 1234;
    expect(regionHash(w.units, w.arena, h)).toBe(u);
    expect(regionHash(w.movers, w.arena, h)).not.toBe(m);
  });
});
