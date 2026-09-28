import { XxHash32 } from '@faf/fixed';
import { describe, expect, it } from 'vitest';
import {
  ArenaBuilder,
  WASM_PAGE_BYTES,
  defineDense,
  defineRegion,
  defineSlab,
  defineTable,
  ruleHash,
} from '../src/index.ts';

const Units = defineTable('units', 100, { bp: 'u16', army: 'u8', x: 'i32', z: 'i32', bank: 'i8', mass: 'f64s', flags: 'u32', t: 'i16' });
const Movers = defineDense('movers', 50, { vx: 'i32', vz: 'i32', speed: 'u16' });
const Orders = defineSlab('orders', 32, 64);
const Grid = defineRegion('spatial', 1001, { derived: true });
const Height = defineRegion('height', 4099, { area: 'static' });

function build() {
  const b = new ArenaBuilder();
  const units = b.addTable(Units);
  const height = b.addRegion(Height);
  const movers = b.addDense(Movers);
  const orders = b.addSlab(Orders);
  const grid = b.addRegion(Grid);
  const arena = b.build();
  return { arena, units, movers, orders, grid, height };
}

describe('arena layout', () => {
  it('is deterministic (same defs → same layout text, hash and offsets)', () => {
    const a = build();
    const b = build();
    expect(a.arena.layoutText).toBe(b.arena.layoutText);
    expect(a.arena.layoutHash).toBe(b.arena.layoutHash);
    expect(a.arena.regions).toEqual(b.arena.regions);
    expect(a.arena.layoutHash >>> 0).toBe(a.arena.layoutHash);
  });

  it('pins the layout hash of a reference layout', () => {
    // Changing the layout scheme must be a conscious decision (update this pin + ARENA_LAYOUT_VERSION).
    const { arena } = build();
    expect(arena.layoutText.split('\n')[0]).toBe(
      `faf-arena v1 bytes=${arena.byteLength} dyn=0..${arena.dynamicEnd}`,
    );
    expect(arena.layoutHash).toBe(0xD7DD082D);
  });

  it('layout hash changes with any schema change', () => {
    const base = build().arena.layoutHash;
    const b = new ArenaBuilder();
    b.addTable(defineTable('units', 100, { bp: 'u16', army: 'u8', x: 'i32', z: 'i32', bank: 'i8', mass: 'f64s', flags: 'u32', t: 'u16' }));
    b.addRegion(Height);
    b.addDense(Movers);
    b.addSlab(Orders);
    b.addRegion(Grid);
    expect(b.build().layoutHash).not.toBe(base);
    const c = new ArenaBuilder();
    c.addTable(defineTable('units', 101, Units.schema));
    c.addRegion(Height);
    c.addDense(Movers);
    c.addSlab(Orders);
    c.addRegion(Grid);
    expect(c.build().layoutHash).not.toBe(base);
  });

  it('places dynamic regions first, static after, all parts 8-byte aligned and non-overlapping', () => {
    const { arena } = build();
    expect(arena.dynamicStart).toBe(0);
    expect(arena.staticStart).toBe(arena.dynamicEnd);
    const names = arena.regions.map((r) => r.name);
    expect(names).toEqual(['units', 'height', 'movers', 'orders', 'spatial']);
    const byOffset = [...arena.regions].sort((p, q) => p.byteOffset - q.byteOffset).map((r) => r.name);
    expect(byOffset).toEqual(['units', 'movers', 'orders', 'spatial', 'height']);
    let prevEnd = 0;
    for (const r of [...arena.regions].sort((p, q) => p.byteOffset - q.byteOffset)) {
      expect(r.byteOffset % 8).toBe(0);
      expect(r.byteOffset).toBeGreaterThanOrEqual(prevEnd);
      let partEnd = r.byteOffset;
      for (const p of r.parts) {
        expect(p.byteOffset % 8).toBe(0);
        expect(p.byteOffset).toBeGreaterThanOrEqual(partEnd);
        partEnd = p.byteOffset + p.byteLength;
      }
      expect(partEnd).toBeLessThanOrEqual(r.byteOffset + r.byteLength);
      prevEnd = r.byteOffset + r.byteLength;
      if (r.area === 'dynamic') expect(prevEnd).toBeLessThanOrEqual(arena.dynamicEnd);
      else expect(r.byteOffset).toBeGreaterThanOrEqual(arena.staticStart);
    }
    expect(arena.staticEnd).toBe(prevEnd);
    expect(arena.byteLength % WASM_PAGE_BYTES).toBe(0);
    expect(arena.byteLength).toBeGreaterThanOrEqual(arena.staticEnd);
  });

  it('computes exact table part sizes and schema-ordered columns', () => {
    const { arena, units } = build();
    const l = arena.regions[0]!;
    expect(l.parts.map((p) => `${p.name}:${p.type}:${p.byteLength}`)).toEqual([
      '$header:raw:32',
      '$free:raw:400',
      '$gen:u16:200',
      '$alive:u8:100',
      'bp:u16:200',
      'army:u8:100',
      'x:i32:400',
      'z:i32:400',
      'bank:i8:100',
      'mass:f64s:800',
      'flags:u32:400',
      't:i16:200',
    ]);
    expect(units.columnNames).toEqual(['bp', 'army', 'x', 'z', 'bank', 'mass', 'flags', 't']);
    // views sit exactly on their parts
    const xPart = l.parts.find((p) => p.name === 'x')!;
    expect(units.col.x.byteOffset).toBe(xPart.byteOffset);
    expect(units.col.x.length).toBe(100);
    expect(units.col.x.buffer).toBe(arena.memory.buffer);
  });

  it('binds typed views per column type', () => {
    const { units, movers, orders, grid, height } = build();
    expect(units.col.bp).toBeInstanceOf(Uint16Array);
    expect(units.col.army).toBeInstanceOf(Uint8Array);
    expect(units.col.x).toBeInstanceOf(Int32Array);
    expect(units.col.bank).toBeInstanceOf(Int8Array);
    expect(units.col.flags).toBeInstanceOf(Uint32Array);
    expect(units.col.t).toBeInstanceOf(Int16Array);
    expect(units.col.mass.length).toBe(100);
    expect(movers.owner).toBeInstanceOf(Int32Array);
    expect(movers.col.speed).toBeInstanceOf(Uint16Array);
    expect(orders.i32.length).toBe(64 * 8);
    expect(grid.u8.length).toBe(1008);
    expect(height.u16.length).toBe(4104 / 2);
    // compile-time mapping (would be a type error otherwise)
    const x: Int32Array = units.col.x;
    const v: Int32Array = movers.col.vx;
    expect(x.length + v.length).toBe(150);
  });

  it('memory never grows (initial == maximum)', () => {
    const { arena, units } = build();
    const len = arena.memory.buffer.byteLength;
    expect(() => arena.memory.grow(1)).toThrow();
    for (let k = 0; k < 1000; k++) {
      const i = units.alloc();
      if (i >= 0 && k % 3 === 0) units.free(i);
    }
    ruleHash(arena, new XxHash32());
    arena.restore(arena.snapshot());
    expect(arena.memory.buffer.byteLength).toBe(len);
    expect(arena.bytes.buffer).toBe(arena.memory.buffer);
  });

  it('honours minBytes and rejects invalid definitions', () => {
    const b = new ArenaBuilder();
    b.addTable(defineTable('a', 4, { x: 'i32' }));
    expect(b.build({ minBytes: 3 * WASM_PAGE_BYTES + 1 }).pages).toBe(4);
    expect(() => defineTable('bad name', 4, { x: 'i32' })).not.toThrow(); // name checked at registration
    expect(() => new ArenaBuilder().addTable(defineTable('bad name', 4, { x: 'i32' }))).toThrow(RangeError);
    expect(() => defineTable('t', 0, { x: 'i32' })).toThrow(RangeError);
    expect(() => defineTable('t', 0x100000, { x: 'i32' })).toThrow(RangeError);
    expect(() => new ArenaBuilder().addTable(defineTable('t', 4, { x: 'f32' as 'i32' }))).toThrow(RangeError);
    expect(() => defineSlab('s', 30, 4)).toThrow(RangeError);
    expect(() => defineRegion('r', 8, { area: 'static', derived: true })).not.toThrow();
    expect(() => new ArenaBuilder().addRegion(defineRegion('r', 8, { area: 'static', derived: true }))).toThrow(RangeError);
    const d = new ArenaBuilder();
    d.addTable(defineTable('t', 4, { x: 'i32' }));
    expect(() => d.addDense(defineDense('t', 4, { x: 'i32' }))).toThrow(/duplicate/);
    d.build();
    expect(() => d.build()).toThrow();
    expect(() => d.addSlab(Orders)).toThrow();
  });

  it('region lookup by name', () => {
    const { arena, movers } = build();
    expect(arena.region('movers')).toBe(movers);
    expect(arena.region('__proto__')).toBeUndefined();
  });
});
