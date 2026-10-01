import { expect, it } from 'vitest';
import { FrameReader, FrameWriter, UnitFlags, UNIT_OFF_RESERVED } from '../src/index.ts';
import { TEST_CAPS } from './support/frames.ts';

it('round-trips optional mount observations without changing legacy part semantics or reserved bytes', () => {
  const w = new FrameWriter(TEST_CAPS), bytes = new Uint8Array(w.capacityBytes).fill(255);
  w.beginFrame(bytes, 1, 1, 0, 1000, 0, 0, 0, 0, 0);
  w.writePart(16384, 16384, -100, -100);
  w.writeUnit(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 0, UnitFlags.MountAimParts, 1, 0, 1, 1);
  w.writeUnit(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 0, 0, 2, 0, 1, 255);
  const r = new FrameReader(); expect(r.reset(bytes.subarray(0, w.endFrame()))).toBe(true);
  expect(r.unitMountAimMask(0)).toBe(1); expect(r.unitMountAimMask(1)).toBe(0);
  expect(r.partCurYaw(0)).toBe(16384); expect(r.partCurPitch(0)).toBe(-100);
  expect(r.unitPartBase(1)).toBe(0); expect(r.unitPartCount(1)).toBe(1);
  expect(bytes.slice(r.unitOffset(0) + UNIT_OFF_RESERVED, r.unitOffset(0) + UNIT_OFF_RESERVED + 3)).toEqual(Uint8Array.of(1, 0, 0));
  expect(bytes.slice(r.unitOffset(1) + UNIT_OFF_RESERVED, r.unitOffset(1) + UNIT_OFF_RESERVED + 3)).toEqual(Uint8Array.of(0, 0, 0));
});
