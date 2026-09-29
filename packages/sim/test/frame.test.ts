import { FrameFlags, FrameReader, FrameWriter, UnitFlags } from '@faf/protocol';
import { describe, expect, it } from 'vitest';
import { createWorld, hpToU8, lastHash, lastHashTick, step, unitHandles, unitInfo, writeFrame } from '../src/index.ts';
import { gameTable, killCmd, moveCmd, spawnCmd } from './support/fixtures.ts';

describe('writeFrame', () => {
  const writer = new FrameWriter();
  const target = new Uint8Array(writer.capacityBytes);
  const reader = new FrameReader();

  it('writes one UnitRecord per live unit matching the state; header carries tick/ack/hash', () => {
    const w = createWorld({ bpTable: gameTable(), seed: 77, armyCount: 2 });
    step(w, [spawnCmd(0, 20, 50, 50, 4, 0, 0, 3), spawnCmd(1, 5, 90, 90, 2, 0, 1, 9)]);
    // Spawn tick: every record is noInterp (prev = cur).
    let len = writeFrame(w, 0, writer, target, { seq: 5, tickTimeUs: 1234, speedPermille: 2000, flags: FrameFlags.Paused });
    expect(reader.reset(target.subarray(0, len))).toBe(true);
    expect(reader.unitCount).toBe(25);
    expect(reader.tick).toBe(1);
    expect(reader.seq).toBe(5);
    expect(reader.tickTimeUs).toBe(1234);
    expect(reader.speedPermille).toBe(2000);
    expect(reader.paused).toBe(true);
    expect(reader.viewer).toBe(0);
    expect(reader.ackSeq).toBe(3);
    for (let i = 0; i < reader.unitCount; i++) expect(reader.unitFlags(i) & UnitFlags.NoInterp).toBe(UnitFlags.NoInterp);

    const hs = unitHandles(w, 0);
    step(w, [moveCmd(0, hs.slice(0, 10), 80, 50, 4), killCmd(0, [hs[19]!], 5)]);
    for (let t = 0; t < 12; t++) step(w);
    len = writeFrame(w, -1, writer, target);
    expect(reader.reset(target.subarray(0, len))).toBe(true);
    expect(reader.unitCount).toBe(24);
    expect(reader.viewer).toBe(-1);
    expect(reader.ackSeq).toBe(0xffffffff);
    expect(reader.hashTick).toBe(lastHashTick(w));
    expect(reader.hashTick).toBe(10);
    expect(reader.hash).toBe(lastHash(w));
    expect(reader.tick).toBe(w.tick);
    const byHandle = new Map<number, number>();
    for (let i = 0; i < reader.unitCount; i++) byHandle.set(reader.unitHandle(i), i);
    for (const h of unitHandles(w)) {
      const u = unitInfo(w, h)!;
      const i = byHandle.get(h)!;
      expect(i).toBeDefined();
      expect([reader.unitPrev(i, 0), reader.unitPrev(i, 1), reader.unitPrev(i, 2)]).toEqual([u.px, 0, u.pz]);
      expect([reader.unitCur(i, 0), reader.unitCur(i, 1), reader.unitCur(i, 2)]).toEqual([u.x, 0, u.z]);
      expect(reader.unitPrevYaw(i)).toBe(u.pyaw);
      expect(reader.unitCurYaw(i)).toBe(u.yaw);
      expect(reader.unitVisual(i)).toBe(u.bp);
      expect(reader.unitArmy(i)).toBe(u.army);
      expect(reader.unitHp(i)).toBe(255);
      expect(reader.unitBuild(i)).toBe(255);
      expect(reader.unitFlags(i) & UnitFlags.NoInterp).toBe(0);
      const idle = (reader.unitFlags(i) & UnitFlags.Idle) !== 0;
      expect(idle).toBe(!u.moving && u.speed === 0);
    }
    // The ten moving cubes are not idle and have moved between prev and cur.
    const moving = hs.slice(0, 10).map((h) => byHandle.get(h)!);
    for (const i of moving) {
      expect(reader.unitFlags(i) & UnitFlags.Idle).toBe(0);
      expect(reader.unitCur(i, 0)).not.toBe(reader.unitPrev(i, 0));
    }
    expect(byHandle.has(hs[19]!)).toBe(false);
  });

  it('scales hp to u8', () => {
    expect(hpToU8(100, 100)).toBe(255);
    expect(hpToU8(50, 100)).toBe(127);
    expect(hpToU8(1, 1000)).toBe(1);
    expect(hpToU8(0, 100)).toBe(0);
  });

  it('is byte-identical for identical worlds', () => {
    const mk = () => {
      const w = createWorld({ bpTable: gameTable(), seed: 5, armyCount: 1 });
      step(w, [spawnCmd(0, 100, 100, 100, 10, 0, 0, 1)]);
      step(w, [moveCmd(0, unitHandles(w), 150, 120, 2)]);
      for (let i = 0; i < 20; i++) step(w);
      const t = new Uint8Array(writer.capacityBytes).fill(0xee);
      const n = writeFrame(w, 0, writer, t);
      return t.slice(0, n);
    };
    expect(Buffer.from(mk()).equals(Buffer.from(mk()))).toBe(true);
  });
});
