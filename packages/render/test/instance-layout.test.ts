import * as protocol from '@faf/protocol';
import { describe, expect, it } from 'vitest';
import {
  UNIT_FLAG_NO_INTERP,
  UNIT_INSTANCE_OFF_ARMY,
  UNIT_INSTANCE_OFF_BANK,
  UNIT_INSTANCE_OFF_BUILD,
  UNIT_INSTANCE_OFF_CUR_POS,
  UNIT_INSTANCE_OFF_CUR_YAW,
  UNIT_INSTANCE_OFF_FLAGS,
  UNIT_INSTANCE_OFF_HANDLE,
  UNIT_INSTANCE_OFF_HP,
  UNIT_INSTANCE_OFF_PART_BASE,
  UNIT_INSTANCE_OFF_PART_COUNT,
  UNIT_INSTANCE_OFF_PREV_POS,
  UNIT_INSTANCE_OFF_PREV_YAW,
  UNIT_INSTANCE_OFF_RESERVED,
  UNIT_INSTANCE_OFF_VISUAL,
  UNIT_INSTANCE_STRIDE,
  UnitRecordWriter,
  VisualBuckets,
} from '../src/instance-layout.ts';

describe('UnitRecord layout', () => {
  it('mirrors the 48-byte frame UnitRecord (PLAN §3.6)', () => {
    expect(UNIT_INSTANCE_STRIDE).toBe(48);
    expect([
      UNIT_INSTANCE_OFF_PREV_POS,
      UNIT_INSTANCE_OFF_CUR_POS,
      UNIT_INSTANCE_OFF_PREV_YAW,
      UNIT_INSTANCE_OFF_CUR_YAW,
      UNIT_INSTANCE_OFF_VISUAL,
      UNIT_INSTANCE_OFF_ARMY,
      UNIT_INSTANCE_OFF_HP,
      UNIT_INSTANCE_OFF_BUILD,
      UNIT_INSTANCE_OFF_BANK,
      UNIT_INSTANCE_OFF_FLAGS,
      UNIT_INSTANCE_OFF_HANDLE,
      UNIT_INSTANCE_OFF_PART_BASE,
      UNIT_INSTANCE_OFF_PART_COUNT,
      UNIT_INSTANCE_OFF_RESERVED,
    ]).toEqual([0, 12, 24, 26, 28, 30, 31, 32, 33, 34, 36, 40, 44, 45]);
    expect(UNIT_FLAG_NO_INTERP).toBe(1024);
  });

  it('UnitRecordWriter writes every field little endian at its offset', () => {
    const w = new UnitRecordWriter(2);
    w.write(1, {
      prevX: -5,
      prevY: 6,
      prevZ: 2 ** 26,
      x: -(2 ** 26),
      y: 8,
      z: 9,
      prevYaw: 65535,
      yaw: 70000,
      visual: 0x1234,
      army: 7,
      hp: 200,
      build: 17,
      bank: -3,
      flags: UNIT_FLAG_NO_INTERP | 1,
      handle: 0xfedcba98,
      partBase: 77,
      partCount: 3,
    });
    const dv = new DataView(w.bytes.buffer, 48);
    expect(dv.getInt32(UNIT_INSTANCE_OFF_PREV_POS, true)).toBe(-5);
    expect(dv.getInt32(UNIT_INSTANCE_OFF_PREV_POS + 8, true)).toBe(2 ** 26);
    expect(dv.getInt32(UNIT_INSTANCE_OFF_CUR_POS, true)).toBe(-(2 ** 26));
    expect(dv.getInt32(UNIT_INSTANCE_OFF_CUR_POS + 8, true)).toBe(9);
    expect(dv.getUint16(UNIT_INSTANCE_OFF_PREV_YAW, true)).toBe(65535);
    expect(dv.getUint16(UNIT_INSTANCE_OFF_CUR_YAW, true)).toBe(70000 & 0xffff);
    expect(dv.getUint16(UNIT_INSTANCE_OFF_VISUAL, true)).toBe(0x1234);
    expect(dv.getUint8(UNIT_INSTANCE_OFF_ARMY)).toBe(7);
    expect(dv.getUint8(UNIT_INSTANCE_OFF_HP)).toBe(200);
    expect(dv.getUint8(UNIT_INSTANCE_OFF_BUILD)).toBe(17);
    expect(dv.getInt8(UNIT_INSTANCE_OFF_BANK)).toBe(-3);
    expect(dv.getUint16(UNIT_INSTANCE_OFF_FLAGS, true)).toBe(1025);
    expect(dv.getUint32(UNIT_INSTANCE_OFF_HANDLE, true)).toBe(0xfedcba98);
    expect(dv.getUint32(UNIT_INSTANCE_OFF_PART_BASE, true)).toBe(77);
    expect(dv.getUint8(UNIT_INSTANCE_OFF_PART_COUNT)).toBe(3);
    // Record 0 untouched.
    expect(w.bytes.subarray(0, 48).every((b) => b === 0)).toBe(true);

    w.advance(1, 100, 101, 102, 5);
    expect(dv.getInt32(UNIT_INSTANCE_OFF_PREV_POS, true)).toBe(-(2 ** 26));
    expect(dv.getInt32(UNIT_INSTANCE_OFF_CUR_POS, true)).toBe(100);
    expect(dv.getUint16(UNIT_INSTANCE_OFF_PREV_YAW, true)).toBe(70000 & 0xffff);
    expect(w.curYaw(1)).toBe(5);
    expect(w.visual(1)).toBe(0x1234);
    expect(w.handle(1)).toBe(0xfedcba98);
  });
});

function makeRecords(visuals: readonly number[], offset = 0): { bytes: Uint8Array; w: UnitRecordWriter } {
  const buf = new Uint8Array(offset + visuals.length * UNIT_INSTANCE_STRIDE + 8);
  const bytes = buf.subarray(offset, offset + visuals.length * UNIT_INSTANCE_STRIDE);
  // The writer needs alignment; build aligned, then copy (possibly to an unaligned view).
  const w = new UnitRecordWriter(visuals.length);
  visuals.forEach((v, i) => {
    w.write(i, { prevX: i, prevY: 0, prevZ: -i, x: i * 10, y: 1, z: i * -10, prevYaw: i, yaw: i + 1, visual: v, army: i & 1, handle: 1000 + i });
  });
  bytes.set(w.bytes);
  return { bytes, w };
}

function handleAt(sorted: Uint8Array, j: number): number {
  return new DataView(sorted.buffer, sorted.byteOffset).getUint32(j * UNIT_INSTANCE_STRIDE + UNIT_INSTANCE_OFF_HANDLE, true);
}

describe('VisualBuckets', () => {
  const visuals = [2, 0, 1, 2, 2, 0, 5, 1, 0, 9];

  for (const offset of [0, 2]) {
    it(`counting-sorts records by visual, stable, drops unknown visuals (source offset ${offset})`, () => {
      const { bytes } = makeRecords(visuals, offset);
      const hl = Uint8Array.from(visuals.map((_, i) => (i % 3 === 0 ? 1 : 0)));
      const b = new VisualBuckets();
      b.ensure(4, 6);
      b.sort(bytes, visuals.length, hl);
      expect(b.total).toBe(9);
      expect(b.dropped).toBe(1); // visual 9 ≥ 6
      expect(Array.from(b.count.subarray(0, 6))).toEqual([3, 2, 3, 0, 0, 1]);
      expect(Array.from(b.start.subarray(0, 6))).toEqual([0, 3, 5, 8, 8, 8]);
      // Stable order within each visual (source index order).
      const order = Array.from({ length: b.total }, (_, j) => handleAt(b.sorted, j) - 1000);
      expect(order).toEqual([1, 5, 8, 2, 7, 0, 3, 4, 6]);
      // Records are copied unchanged.
      for (let j = 0; j < b.total; j++) {
        const i = order[j]!;
        expect(Array.from(b.sorted.subarray(j * 48, j * 48 + 48))).toEqual(Array.from(bytes.subarray(i * 48, i * 48 + 48)));
        expect(b.highlight[j]).toBe(hl[i]);
      }
    });
  }

  it('grows on demand and does not allocate in steady state', () => {
    const n = 1000;
    const vis = Array.from({ length: n }, (_, i) => (i * 7) % 5);
    const { bytes } = makeRecords(vis);
    const b = new VisualBuckets();
    b.ensure(16, 5);
    b.sort(bytes, n);
    expect(b.capacity).toBeGreaterThanOrEqual(n);
    expect(b.total).toBe(n);
    const sortedRef = b.sorted;
    for (let k = 0; k < 50; k++) b.sort(bytes, n);
    expect(b.sorted).toBe(sortedRef);
    expect(Array.from(b.count.subarray(0, 5))).toEqual([200, 200, 200, 200, 200]);
    expect(b.highlight.subarray(0, n).every((h) => h === 0)).toBe(true);
  });

  it('rejects counts beyond the source', () => {
    const { bytes } = makeRecords([0, 0]);
    const b = new VisualBuckets();
    b.ensure(2, 1);
    expect(() => b.sort(bytes, 3)).toThrow(/exceeds/);
  });
});

describe('UnitRecord layout == protocol FrameWriter output', () => {
  it('takes stride, offsets and the noInterp bit from @faf/protocol', () => {
    expect(UNIT_INSTANCE_STRIDE).toBe(protocol.UNIT_RECORD_BYTES);
    expect(UNIT_FLAG_NO_INTERP).toBe(protocol.UnitFlags.NoInterp);
  });

  it('a record written by the protocol FrameWriter reads back identically with the render writer layout', () => {
    const w = new protocol.FrameWriter({ units: 2, parts: 0, projectiles: 0, beams: 0, events: 0, debugBytes: 0 });
    const buf = new Uint8Array(w.capacityBytes);
    w.beginFrame(buf, 1, 7, 0, 1000, 0, 0, 0, 0, 0);
    w.writeUnit(-5, 6, 7, 8, -9, 10, 100, 200, 3, 4, 250, 128, -3, protocol.UnitFlags.NoInterp, 0xabcdef12, 5, 2);
    const len = w.endFrame();
    const r = new protocol.FrameReader();
    expect(r.reset(buf.subarray(0, len))).toBe(true);
    const rec = buf.subarray(r.unitOffset(0), r.unitOffset(0) + 48);
    const expected = new UnitRecordWriter(1);
    expected.write(0, {
      prevX: -5,
      prevY: 6,
      prevZ: 7,
      x: 8,
      y: -9,
      z: 10,
      prevYaw: 100,
      yaw: 200,
      visual: 3,
      army: 4,
      hp: 250,
      build: 128,
      bank: -3,
      flags: UNIT_FLAG_NO_INTERP,
      handle: 0xabcdef12,
      partBase: 5,
      partCount: 2,
    });
    expect([...rec]).toEqual([...expected.bytes]);
  });
});
