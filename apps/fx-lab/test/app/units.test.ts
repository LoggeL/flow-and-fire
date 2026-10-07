import { describe, expect, it } from 'vitest';
import type { BufH, GpuDevice } from '@faf/render';
import { labGroundHeight } from '../../src/app/ground.ts';
import { LAB_UNIT_CAPACITY, LAB_UNIT_KINDS, LAB_UNIT_STRIDE, LabUnitList, labUnitKindId } from '../../src/app/units.ts';

const flat = (): number => 5;

/** Just enough of a GpuDevice for DynamicInstanceBuffer: records every writeBuffer. */
function recordingDevice(): { dev: GpuDevice; writes: { bytes: number; data: Uint8Array }[] } {
  const writes: { bytes: number; data: Uint8Array }[] = [];
  const dev = {
    createBuffer: (): BufH => 1 as unknown as BufH,
    writeBuffer: (_h: BufH, _off: number, data: ArrayBufferView, srcOff = 0, len?: number): void => {
      const src = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      const n = len ?? src.byteLength - srcOff;
      writes.push({ bytes: n, data: src.slice(srcOff, srcOff + n) });
    },
    destroyBuffer: (): void => {},
  } as unknown as GpuDevice;
  return { dev, writes };
}

describe('LabUnitList', () => {
  it('has capacity 1024 and the 36-byte record', () => {
    const u = new LabUnitList(null, flat);
    expect(u.capacity).toBe(LAB_UNIT_CAPACITY);
    expect(LAB_UNIT_CAPACITY).toBe(1024);
    expect(LAB_UNIT_STRIDE).toBe(36);
  });

  it('keeps indices stable and reuses freed ones (LIFO free list)', () => {
    const u = new LabUnitList(null, flat, 8);
    const ids = [0, 1, 2, 3].map((k) => u.add({ kind: 'tank', army: 0, xWu: k, zWu: 0, yaw: 0 }));
    expect(ids).toEqual([0, 1, 2, 3]);
    expect(u.remove(1)).toBe(true);
    expect(u.remove(2)).toBe(true);
    expect(u.remove(2)).toBe(false);
    expect(u.remove(99)).toBe(false);
    expect(u.count).toBe(2);
    // Survivors keep their index and state.
    expect(u.get(3)?.xWu).toBe(3);
    expect(u.get(1)).toBeNull();
    // Last freed first.
    expect(u.add({ kind: 'bot', army: 1, xWu: 10, zWu: 0, yaw: 0 })).toBe(2);
    expect(u.add({ kind: 'bot', army: 1, xWu: 11, zWu: 0, yaw: 0 })).toBe(1);
    expect(u.add({ kind: 'bot', army: 1, xWu: 12, zWu: 0, yaw: 0 })).toBe(4);
    expect(u.highWater).toBe(5);
    expect(u.get(3)?.xWu).toBe(3);
  });

  it('returns −1 when full and validates input', () => {
    const u = new LabUnitList(null, flat, 2);
    expect(u.add({ kind: 'tank', army: 0, xWu: 0, zWu: 0, yaw: 0 })).toBe(0);
    expect(u.add({ kind: 'tank', army: 0, xWu: 0, zWu: 0, yaw: 0 })).toBe(1);
    expect(u.add({ kind: 'tank', army: 0, xWu: 0, zWu: 0, yaw: 0 })).toBe(-1);
    expect(() => u.add({ kind: 'tank', army: 16, xWu: 0, zWu: 0, yaw: 0 })).toThrow(RangeError);
    expect(() => u.add({ kind: 'tank', army: 0, xWu: Number.NaN, zWu: 0, yaw: 0 })).toThrow();
    expect(() => u.set(5, { hp: 1 })).toThrow(RangeError);
    expect(() => labUnitKindId('ufo' as never)).toThrow(/unknown unit kind/);
  });

  it('get/set: defaults, clamping, y from the ground height', () => {
    const u = new LabUnitList(null, labGroundHeight);
    const i = u.add({ kind: 'wreck', army: 3, xWu: 100, zWu: 200, yaw: 1 });
    const s = u.get(i)!;
    expect(s).toEqual({ kind: 'wreck', army: 3, xWu: 100, yWu: labGroundHeight(100, 200), zWu: 200, yaw: 1, hp: 1, glow: 0 });
    u.set(i, { kind: 'tank', hp: 7, glow: 9, xWu: 50 });
    const t = u.get(i, s)!;
    expect(t).toBe(s);
    expect(t.kind).toBe('tank');
    expect(t.hp).toBe(1);
    expect(t.glow).toBe(4);
    expect(t.xWu).toBe(50);
    expect(t.yWu).toBe(labGroundHeight(50, 200));
    const j = u.add({ kind: 'tank', army: 0, xWu: 0, zWu: 0, yaw: 0 });
    expect(u.get(j)!.glow).toBe(1);
  });

  it('packs live units compactly in index order (prev/cur raw, unwrapped yaw, info bytes)', () => {
    const u = new LabUnitList(null, flat, 16);
    const a = u.add({ kind: 'tank', army: 0, xWu: 1, zWu: 2, yaw: 3.1, hp: 0.5, glow: 2 });
    const b = u.add({ kind: 'bot', army: 1, xWu: 3, zWu: 4, yaw: 0 });
    const c = u.add({ kind: 'acu', army: 2, xWu: -1.5, zWu: 7.25, yaw: 0, glow: 4 });
    u.remove(b);
    u.snapshot();
    // Crossing ±π: the previous yaw is unwrapped next to the current one (no 2π spin).
    u.move(a, 1.5, 2, -3.1);
    const dv = new DataView(new ArrayBuffer(16 * LAB_UNIT_STRIDE));
    expect(u.pack(dv)).toBe(2);
    expect(u.instanceCount).toBe(2);
    // Record 0 = unit a.
    expect(dv.getInt32(0, true)).toBe(4096);
    expect(dv.getInt32(4, true)).toBe(5 * 4096);
    expect(dv.getInt32(8, true)).toBe(2 * 4096);
    expect(dv.getInt32(12, true)).toBe(1.5 * 4096);
    expect(dv.getInt32(20, true)).toBe(2 * 4096);
    const prevYaw = dv.getFloat32(24, true);
    const curYaw = dv.getFloat32(28, true);
    expect(curYaw).toBeCloseTo(-3.1, 6);
    expect(prevYaw).toBeCloseTo(-3.1 - (2 * Math.PI - 6.2), 5);
    expect(dv.getUint8(32)).toBe(labUnitKindId('tank'));
    expect(dv.getUint8(33)).toBe(0);
    expect(dv.getUint8(34)).toBe(128);
    expect(dv.getUint8(35)).toBe(128);
    // Record 1 = unit c (b was removed, compact packing).
    const o = LAB_UNIT_STRIDE;
    expect(dv.getInt32(o + 12, true)).toBe(-1.5 * 4096);
    expect(dv.getInt32(o + 20, true)).toBe(7.25 * 4096);
    expect(dv.getUint8(o + 32)).toBe(LAB_UNIT_KINDS.indexOf('acu'));
    expect(dv.getUint8(o + 33)).toBe(2);
    expect(dv.getUint8(o + 35)).toBe(255);
    expect(c).toBe(2);
  });

  it('GPU packing equals DataView packing; upload is skipped while unchanged', () => {
    const { dev, writes } = recordingDevice();
    const u = new LabUnitList(dev, flat, 32);
    for (let k = 0; k < 10; k++) u.add({ kind: LAB_UNIT_KINDS[k % LAB_UNIT_KINDS.length]!, army: k % 3, xWu: k * 1.25, zWu: 3 - k, yaw: k * 0.7, hp: k / 10 });
    u.remove(4);
    u.snapshot();
    u.move(2, 9, 9, 2);
    expect(u.upload()).toBe(9 * LAB_UNIT_STRIDE);
    expect(u.upload()).toBe(0);
    expect(writes).toHaveLength(1);
    const dv = new DataView(new ArrayBuffer(32 * LAB_UNIT_STRIDE));
    u.pack(dv);
    expect(writes[0]!.data).toEqual(new Uint8Array(dv.buffer, 0, 9 * LAB_UNIT_STRIDE));
    u.setHpGlow(0, 0.2, 3);
    expect(u.upload()).toBe(9 * LAB_UNIT_STRIDE);
    expect(writes).toHaveLength(2);
  });

  it('version and checksum follow every change', () => {
    const u = new LabUnitList(null, flat);
    const v0 = u.version;
    const c0 = u.checksum();
    const i = u.add({ kind: 'tank', army: 0, xWu: 1, zWu: 1, yaw: 0 });
    expect(u.version).toBeGreaterThan(v0);
    const c1 = u.checksum();
    expect(c1).not.toBe(c0);
    u.move(i, 1 + 1 / 4096, 1, 0);
    expect(u.checksum()).not.toBe(c1);
    u.move(i, 1, 1, 0);
    expect(u.checksum()).toBe(c1);
    u.clear();
    expect(u.count).toBe(0);
    expect(u.highWater).toBe(0);
    expect(u.checksum()).toBe(c0);
  });
});
