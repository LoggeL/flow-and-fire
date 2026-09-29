import * as protocol from '@faf/protocol';
import * as render from '@faf/render';
import { describe, expect, it } from 'vitest';

describe('render instance layout == protocol UnitRecord layout', () => {
  it('has the same stride (48 B)', () => {
    expect(render.UNIT_INSTANCE_STRIDE).toBe(48);
    expect(protocol.UNIT_RECORD_BYTES).toBe(48);
    expect(render.UNIT_INSTANCE_STRIDE).toBe(protocol.UNIT_RECORD_BYTES);
  });

  it('has the same field offsets', () => {
    const pairs: [number, number][] = [
      [render.UNIT_INSTANCE_OFF_PREV_POS, protocol.UNIT_OFF_PREV_POS],
      [render.UNIT_INSTANCE_OFF_CUR_POS, protocol.UNIT_OFF_CUR_POS],
      [render.UNIT_INSTANCE_OFF_PREV_YAW, protocol.UNIT_OFF_PREV_YAW],
      [render.UNIT_INSTANCE_OFF_CUR_YAW, protocol.UNIT_OFF_CUR_YAW],
      [render.UNIT_INSTANCE_OFF_VISUAL, protocol.UNIT_OFF_VISUAL],
      [render.UNIT_INSTANCE_OFF_ARMY, protocol.UNIT_OFF_ARMY],
      [render.UNIT_INSTANCE_OFF_HP, protocol.UNIT_OFF_HP],
      [render.UNIT_INSTANCE_OFF_BUILD, protocol.UNIT_OFF_BUILD],
      [render.UNIT_INSTANCE_OFF_BANK, protocol.UNIT_OFF_BANK],
      [render.UNIT_INSTANCE_OFF_FLAGS, protocol.UNIT_OFF_FLAGS],
      [render.UNIT_INSTANCE_OFF_HANDLE, protocol.UNIT_OFF_HANDLE],
      [render.UNIT_INSTANCE_OFF_PART_BASE, protocol.UNIT_OFF_PART_BASE],
      [render.UNIT_INSTANCE_OFF_PART_COUNT, protocol.UNIT_OFF_PART_COUNT],
      [render.UNIT_INSTANCE_OFF_RESERVED, protocol.UNIT_OFF_RESERVED],
    ];
    for (const [r, p] of pairs) expect(r).toBe(p);
  });

  it('uses the same noInterp flag bit', () => {
    expect(render.UNIT_FLAG_NO_INTERP).toBe(protocol.UnitFlags.NoInterp);
    expect(render.UNIT_FLAG_NO_INTERP).toBe(1 << 10);
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
    const expected = new render.UnitRecordWriter(1);
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
      flags: render.UNIT_FLAG_NO_INTERP,
      handle: 0xabcdef12,
      partBase: 5,
      partCount: 2,
    });
    expect([...rec]).toEqual([...expected.bytes]);
  });
});
