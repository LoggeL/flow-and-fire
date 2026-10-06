import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BEAM_RECORD_BYTES,
  DEFAULT_FRAME_CAPS,
  EVENT_RECORD_BYTES,
  FH_ACK_SEQ,
  FH_COUNTS,
  FH_DEBUG_BYTES,
  FH_DEBUG_OFFSET,
  FH_FLAGS,
  FH_FOG_RECT,
  FH_FOOTPRINT_DELTA_COUNT,
  FH_HASH,
  FH_HASH_TICK,
  FH_OFFSETS,
  FH_SPEED_PERMILLE,
  FH_VIEWER,
  FH_PATH_EXPANSIONS,
  FH_PATH_PENDING,
  FH_PATH_REPATHS,
  FH_PATH_REQUESTS,
  FH_STUCK_GIVEUPS,
  FH_VERSION,
  FH_HEADER_BYTES,
  FH_WATCH_COUNT,
  FH_WATCH_OFFSET,
  FRAME_HEADER_BYTES,
  FRAME_HEADER_BYTES_V1,
  FRAME_MAGIC,
  FRAME_VERSION,
  FrameReader,
  FrameSection,
  FrameWriter,
  PART_RECORD_BYTES,
  PROJECTILE_RECORD_BYTES,
  UNIT_OFF_ARMY,
  UNIT_OFF_BANK,
  UNIT_OFF_BUILD,
  UNIT_OFF_CUR_POS,
  UNIT_OFF_CUR_YAW,
  UNIT_OFF_FLAGS,
  UNIT_OFF_HANDLE,
  UNIT_OFF_HP,
  UNIT_OFF_PART_BASE,
  UNIT_OFF_PART_COUNT,
  UNIT_OFF_PREV_POS,
  UNIT_OFF_PREV_YAW,
  UNIT_OFF_RESERVED,
  UNIT_OFF_VISUAL,
  UNIT_RECORD_BYTES,
  UnitFlags,
  WATCH_MAX_POINTS,
  WATCH_MAX_TARGETS,
  WATCH_OFF_POINTS,
  WATCH_OFF_TARGETS,
  WATCH_RECORD_BYTES,
  WatchFlags,
  WatchOrderType,
  frameCapacityBytes,
} from '../src/index.ts';
import { TEST_CAPS, TEST_CAPS_WATCH, writeTestFrame } from './support/frames.ts';

describe('frame layout constants', () => {
  it('pins record sizes and UnitRecord offsets (48 B)', () => {
    expect(UNIT_RECORD_BYTES).toBe(48);
    expect(PART_RECORD_BYTES).toBe(8);
    expect(PROJECTILE_RECORD_BYTES).toBe(28);
    expect(BEAM_RECORD_BYTES).toBe(12);
    expect(EVENT_RECORD_BYTES).toBe(32);
    expect([
      UNIT_OFF_PREV_POS, UNIT_OFF_CUR_POS, UNIT_OFF_PREV_YAW, UNIT_OFF_CUR_YAW, UNIT_OFF_VISUAL, UNIT_OFF_ARMY,
      UNIT_OFF_HP, UNIT_OFF_BUILD, UNIT_OFF_BANK, UNIT_OFF_FLAGS, UNIT_OFF_HANDLE, UNIT_OFF_PART_BASE,
      UNIT_OFF_PART_COUNT, UNIT_OFF_RESERVED,
    ]).toEqual([0, 12, 24, 26, 28, 30, 31, 32, 33, 34, 36, 40, 44, 45]);
    expect(UNIT_OFF_RESERVED + 3).toBe(UNIT_RECORD_BYTES);
  });

  it('pins header offsets and unit flags', () => {
    expect(FRAME_VERSION).toBe(2);
    expect(FRAME_HEADER_BYTES).toBe(128);
    expect(FRAME_HEADER_BYTES_V1).toBe(96);
    expect([FH_WATCH_OFFSET, FH_WATCH_COUNT, FH_PATH_PENDING, FH_PATH_REQUESTS, FH_PATH_REPATHS, FH_PATH_EXPANSIONS, FH_STUCK_GIVEUPS]).toEqual([
      96, 100, 104, 108, 112, 116, 120,
    ]);
    expect([WATCH_OFF_TARGETS, WATCH_OFF_POINTS, WATCH_RECORD_BYTES]).toEqual([12, 204, 332]);
    expect(WATCH_RECORD_BYTES % 4).toBe(0);
    expect(FRAME_MAGIC).toBe(0x4d524649);
    expect(String.fromCharCode(0x49, 0x46, 0x52, 0x4d)).toBe('IFRM');
    expect([FH_SPEED_PERMILLE, FH_VIEWER, FH_FLAGS, FH_ACK_SEQ, FH_HASH_TICK, FH_HASH]).toEqual([20, 22, 23, 24, 28, 32]);
    expect([FH_COUNTS, FH_OFFSETS, FH_FOG_RECT, FH_FOOTPRINT_DELTA_COUNT, FH_DEBUG_OFFSET, FH_DEBUG_BYTES]).toEqual([
      36, 56, 76, 84, 88, 92,
    ]);
    expect(UnitFlags).toEqual({
      Building: 1,
      Wreck: 2,
      Ghost: 4,
      Blip: 8,
      VetShift: 4,
      VetMask: 0x30,
      ShieldUp: 0x40,
      Stalled: 0x80,
      Damaged: 0x100,
      Idle: 0x200,
      NoInterp: 0x400,
    });
  });

  it('frameCapacityBytes follows the caps (PLAN §3.4 defaults)', () => {
    expect(DEFAULT_FRAME_CAPS.units).toBe(8192);
    expect(DEFAULT_FRAME_CAPS.projectiles).toBe(16384);
    expect(frameCapacityBytes(TEST_CAPS)).toBe(128 + 64 * 48 + 128 * 8 + 32 * 28 + 8 * 12 + 16 * 32 + 64);
    expect(DEFAULT_FRAME_CAPS.watch).toBe(64);
    expect(frameCapacityBytes()).toBe(
      128 + 8192 * 48 + 65536 * 8 + 16384 * 28 + 2048 * 12 + 4096 * 32 + 64 * 332 + 65536,
    );
    expect(frameCapacityBytes({ ...TEST_CAPS, watch: 3 })).toBe(frameCapacityBytes(TEST_CAPS) + 3 * 332);
    expect(() => frameCapacityBytes({ ...TEST_CAPS, units: -1 })).toThrow(RangeError);
  });
});

describe('FrameWriter / FrameReader', () => {
  it('roundtrips a unit record byte-exactly at the documented offsets', () => {
    const w = new FrameWriter(TEST_CAPS);
    const buf = new Uint8Array(w.capacityBytes);
    w.beginFrame(buf, 5, 1234, 777, 1500, 3, 1, 42, 1230, 0xdeadbeef);
    w.writePart(1, 2, -3, 4);
    const idx = w.writeUnit(-1, 2, 3, 4096, 8192, -4096, 100, 200, 7, 3, 255, 128, -5, UnitFlags.Idle | (2 << UnitFlags.VetShift), 0x00100005, 0, 1);
    expect(idx).toBe(0);
    const len = w.endFrame();
    expect(len).toBe(128 + 48 + 8);

    const r = new FrameReader();
    expect(r.reset(buf.subarray(0, len))).toBe(true);
    expect([r.seq, r.tick, r.tickTimeUs, r.speedPermille, r.viewer, r.flags, r.paused, r.ackSeq, r.hashTick, r.hash]).toEqual([
      5, 1234, 777, 1500, 3, 1, true, 42, 1230, 0xdeadbeef,
    ]);
    expect(r.unitCount).toBe(1);
    expect(r.partCount).toBe(1);
    expect(r.unitsOffset).toBe(128);
    expect(r.offset(FrameSection.Parts)).toBe(128 + 48);
    expect([r.version, r.headerBytes, r.watchCount, r.pathPending, r.requestsIssued]).toEqual([2, 128, 0, 0, 0]);
    const o = r.unitOffset(0);
    const dv = new DataView(buf.buffer);
    expect(dv.getInt32(o + UNIT_OFF_CUR_POS + 4, true)).toBe(8192);
    expect(dv.getUint32(o + UNIT_OFF_HANDLE, true)).toBe(0x00100005);
    expect([r.unitPrev(0, 0), r.unitPrev(0, 1), r.unitPrev(0, 2)]).toEqual([-1, 2, 3]);
    expect([r.unitCur(0, 0), r.unitCur(0, 1), r.unitCur(0, 2)]).toEqual([4096, 8192, -4096]);
    expect([r.unitPrevYaw(0), r.unitCurYaw(0), r.unitVisual(0), r.unitArmy(0), r.unitHp(0), r.unitBuild(0), r.unitBank(0)]).toEqual([
      100, 200, 7, 3, 255, 128, -5,
    ]);
    expect((r.unitFlags(0) & UnitFlags.VetMask) >> UnitFlags.VetShift).toBe(2);
    expect([r.unitHandle(0), r.unitPartBase(0), r.unitPartCount(0)]).toEqual([0x00100005, 0, 1]);
    expect([r.partPrevYaw(0), r.partCurYaw(0), r.partPrevPitch(0), r.partCurPitch(0)]).toEqual([1, 2, -3, 4]);
    expect(Array.from(buf.subarray(o + 45, o + 48))).toEqual([0, 0, 0]);
  });

  it('packs every section in order; the reader sees the written values (fast-check)', () => {
    const w = new FrameWriter(TEST_CAPS);
    const buf = new Uint8Array(w.capacityBytes);
    const r = new FrameReader();
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -1000, max: 1000 }), { maxLength: 40 }),
        fc.array(fc.integer({ min: 0, max: 255 }), { maxLength: 20 }),
        fc.array(fc.nat({ max: 0xffff }), { maxLength: 10 }),
        fc.uint8Array({ maxLength: 64 }),
        (units, projs, events, dbg) => {
          w.beginFrame(buf, 1, 2, 3, 1000, -1, 0, 0, 0, 0);
          // Interleave sections on purpose.
          const n = Math.max(units.length, projs.length, events.length);
          for (let i = 0; i < n; i++) {
            if (i < units.length) w.writeUnit(units[i]!, 0, 0, 0, 0, units[i]!, 0, 0, i, 0, 0, 0, 0, 0, i, 0, 0);
            if (i < projs.length) w.writeProjectile(0, 0, 0, 0, 0, i, 0, 0, projs[i]!);
            if (i < events.length) w.writeEvent(events[i]!, 0, 0, 0, 0, 0, 0, 0, i, 0);
          }
          w.setDebugSection(dbg);
          const len = w.endFrame();
          expect(len % 4).toBe(0);
          expect(r.reset(buf.subarray(0, len))).toBe(true);
          expect(r.unitCount).toBe(units.length);
          expect(r.projectileCount).toBe(projs.length);
          expect(r.eventCount).toBe(events.length);
          expect(r.offset(FrameSection.Parts)).toBe(128 + units.length * 48);
          expect(r.offset(FrameSection.Projectiles)).toBe(128 + units.length * 48);
          expect(r.offset(FrameSection.Beams)).toBe(128 + units.length * 48 + projs.length * 28);
          for (let i = 0; i < units.length; i++) {
            expect(r.unitPrev(i, 0)).toBe(units[i]);
            expect(r.unitCur(i, 2)).toBe(units[i]);
            expect(r.unitHandle(i)).toBe(i);
          }
          for (let i = 0; i < projs.length; i++) {
            expect(r.projectileFlags(i)).toBe(projs[i]);
            expect(r.projectileCur(i, 2)).toBe(i);
          }
          for (let i = 0; i < events.length; i++) {
            expect(r.eventType(i)).toBe(events[i]);
            expect(r.eventAux(i)).toBe(i);
          }
          expect(Array.from(r.debugSection())).toEqual(Array.from(dbg));
          expect(r.debugOffset + r.debugBytes).toBeLessThanOrEqual(len);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('watch section and path statistics roundtrip (v2); watch sits between events and debug', () => {
    const caps = { ...TEST_CAPS, watch: 3 };
    const w = new FrameWriter(caps);
    const buf = new Uint8Array(w.capacityBytes).fill(0x5a);
    const r = new FrameReader();
    w.beginFrame(buf, 9, 99, 0, 1000, 0, 0, 0, 0, 0);
    w.writeUnit(1, 2, 3, 4, 5, 6, 0, 0, 0, 0, 255, 0, 0, 0, 77, 0, 0);
    w.writeEvent(3, 0, 99, 0, 0, 0, 0, 0, 0, 0);
    w.setPathStats(4, 1000, 17, 20_001, 3);
    expect(w.beginWatch(77, 5, WatchFlags.Stuck | WatchFlags.Group)).toBe(0);
    for (let k = 0; k < WATCH_MAX_TARGETS + 2; k++) {
      expect(w.addWatchTarget(k % 2 === 0 ? WatchOrderType.Move : WatchOrderType.Stop, k * 4096, -k | 0)).toBe(k < WATCH_MAX_TARGETS);
    }
    for (let k = 0; k < WATCH_MAX_POINTS + 1; k++) expect(w.addWatchPoint((-k * 10) | 0, k)).toBe(k < WATCH_MAX_POINTS);
    expect(w.beginWatch(0x00200007, 0, 0)).toBe(1);
    expect(w.addWatchPoint(5, 6)).toBe(true);
    expect(w.beginWatch(3, 1, WatchFlags.Retargeted)).toBe(2);
    expect(w.beginWatch(4, 1, 0)).toBe(-1);
    expect(w.addWatchTarget(1, 0, 0)).toBe(false);
    w.setDebugSection(Uint8Array.of(1, 2, 3));
    const len = w.endFrame();
    expect(r.reset(buf.subarray(0, len))).toBe(true);
    expect([r.pathPending, r.requestsIssued, r.repathsTriggered, r.expansionsLastTick, r.stuckGiveUps]).toEqual([4, 1000, 17, 20_001, 3]);
    expect(r.watchCount).toBe(3);
    expect(r.watchOffset).toBe(r.offset(FrameSection.Events) + 32);
    expect(r.debugOffset).toBe(r.watchOffset + 3 * WATCH_RECORD_BYTES);
    expect([r.watchHandle(0), r.watchOrderCount(0), r.watchFlags(0), r.watchTargetCount(0), r.watchPointCount(0)]).toEqual([
      77, 5, WatchFlags.Stuck | WatchFlags.Group, WATCH_MAX_TARGETS, WATCH_MAX_POINTS,
    ]);
    for (let k = 0; k < WATCH_MAX_TARGETS; k++) {
      expect([r.watchTargetType(0, k), r.watchTargetX(0, k), r.watchTargetZ(0, k)]).toEqual([k % 2 === 0 ? 1 : 2, k * 4096, -k | 0]);
    }
    for (let k = 0; k < WATCH_MAX_POINTS; k++) expect([r.watchPointX(0, k), r.watchPointZ(0, k)]).toEqual([(-k * 10) | 0, k]);
    expect([r.watchHandle(1), r.watchOrderCount(1), r.watchTargetCount(1), r.watchPointCount(1), r.watchPointX(1, 0)]).toEqual([0x00200007, 0, 0, 1, 5]);
    expect([r.watchHandle(2), r.watchFlags(2)]).toEqual([3, WatchFlags.Retargeted]);
    // Unused entries of a record are zero (stale buffer bytes never leak).
    expect(r.watchPointX(1, 1)).toBe(0);
    expect(Array.from(r.debugSection())).toEqual([1, 2, 3]);
    expect(w.dropped).toBe(1);
    // The next frame starts without watch records and with zeroed statistics.
    w.beginFrame(buf, 10, 100, 0, 1000, 0, 0, 0, 0, 0);
    const len2 = w.endFrame();
    expect(r.reset(buf.subarray(0, len2))).toBe(true);
    expect([r.watchCount, r.requestsIssued, r.stuckGiveUps]).toEqual([0, 0, 0]);
    // A watch section out of bounds is rejected.
    const bad = buf.slice(0, len);
    new DataView(bad.buffer).setUint32(FH_WATCH_COUNT, 1000, true);
    expect(r.reset(bad)).toBe(false);
  });

  it('reads v1 frames (96-byte header, MS1/MS2): no watch section, statistics read as 0', () => {
    // Build a v1 frame by hand: header 96 B + one unit record.
    const buf = new Uint8Array(FRAME_HEADER_BYTES_V1 + UNIT_RECORD_BYTES);
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, FRAME_MAGIC, true);
    dv.setUint16(FH_VERSION, 1, true);
    dv.setUint16(FH_HEADER_BYTES, FRAME_HEADER_BYTES_V1, true);
    dv.setUint32(FH_COUNTS, 1, true);
    for (let s = 0; s < 5; s++) dv.setUint32(FH_OFFSETS + s * 4, s === 0 ? 96 : 96 + 48, true);
    dv.setUint32(FH_DEBUG_OFFSET, 96 + 48, true);
    dv.setUint32(96 + UNIT_OFF_HANDLE, 1234, true);
    const r = new FrameReader();
    expect(r.reset(buf)).toBe(true);
    expect([r.version, r.headerBytes, r.unitCount, r.unitHandle(0), r.watchCount, r.requestsIssued, r.pathPending]).toEqual([1, 96, 1, 1234, 0, 0, 0]);
  });

  it('same content ⇒ same bytes (independent of stale buffer contents)', () => {
    const w = new FrameWriter(TEST_CAPS_WATCH);
    const a = new Uint8Array(w.capacityBytes);
    const b = new Uint8Array(w.capacityBytes).fill(0xaa);
    for (let n = 0; n < 50; n++) {
      const la = writeTestFrame(w, a, n);
      const lb = writeTestFrame(w, b, n);
      expect(lb).toBe(la);
      expect(Buffer.compare(a.subarray(0, la), b.subarray(0, lb))).toBe(0);
    }
  });

  it('drops records beyond capacity and rejects small targets', () => {
    const caps = { units: 2, parts: 1, projectiles: 1, beams: 1, events: 1, debugBytes: 4 };
    const w = new FrameWriter(caps);
    const buf = new Uint8Array(w.capacityBytes);
    w.beginFrame(buf, 1, 1, 0, 1000, 0, 0, 0, 0, 0);
    for (let i = 0; i < 3; i++) w.writeUnit(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, i, 0, 0);
    expect(w.unitCount).toBe(2);
    expect(w.dropped).toBe(1);
    expect(() => w.setDebugSection(new Uint8Array(5))).toThrow(RangeError);
    w.endFrame();
    expect(() => w.endFrame()).toThrow();
    expect(() => w.beginFrame(new Uint8Array(10), 1, 1, 0, 1000, 0, 0, 0, 0, 0)).toThrow(RangeError);
  });

  it('reader rejects corrupt frames', () => {
    const w = new FrameWriter(TEST_CAPS);
    const buf = new Uint8Array(w.capacityBytes);
    const len = writeTestFrame(w, buf, 3);
    const r = new FrameReader();
    expect(r.reset(buf.subarray(0, len))).toBe(true);
    expect(r.reset(buf.subarray(0, 50))).toBe(false);
    const bad = buf.slice(0, len);
    bad[0] = 0;
    expect(r.reset(bad)).toBe(false);
    const bad2 = buf.slice(0, len);
    new DataView(bad2.buffer).setUint32(FH_COUNTS, 1_000_000, true);
    expect(r.reset(bad2)).toBe(false);
  });

  it('writes frames without allocating', () => {
    const w = new FrameWriter(TEST_CAPS);
    const buf = new Uint8Array(w.capacityBytes);
    const r = new FrameReader();
    const run = (n: number): number => {
      w.beginFrame(buf, n, n, 0, 1000, 0, 0, 0, 0, 0);
      for (let i = 0; i < 64; i++) w.writeUnit(i, 0, i, i, 0, i, 0, 0, 1, 0, 255, 0, 0, 0, i, 0, 0);
      const len = w.endFrame();
      r.reset(buf.subarray(0, len));
      return r.unitCur(63, 0);
    };
    for (let n = 0; n < 1000; n++) run(n);
    const gc = (globalThis as { gc?: () => void }).gc;
    gc?.();
    const before = process.memoryUsage().heapUsed;
    let acc = 0;
    for (let n = 0; n < 20_000; n++) {
      w.beginFrame(buf, n, n, 0, 1000, 0, 0, 0, 0, 0);
      for (let i = 0; i < 64; i++) w.writeUnit(i, 0, i, i, 0, i, 0, 0, 1, 0, 255, 0, 0, 0, i, 0, 0);
      acc += w.endFrame();
    }
    gc?.();
    const grown = process.memoryUsage().heapUsed - before;
    expect(acc).toBeGreaterThan(0);
    if (gc !== undefined) expect(grown).toBeLessThan(256 * 1024);
  });
});
