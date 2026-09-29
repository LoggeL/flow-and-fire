import fc from 'fast-check';
import { asFx, type Fx } from '@faf/fixed';
import { describe, expect, it } from 'vitest';
import {
  CHEAT_KILL_PAYLOAD_BYTES,
  CHEAT_SPAWN_PAYLOAD_BYTES,
  CheatSub,
  MOVE_PAYLOAD_BYTES,
  cheatPayloadBytes,
  decodeCheatSpawn,
  decodeMove,
  encodeCheatKill,
  encodeCheatSpawn,
  encodeMove,
  isCheatKill,
  readCheatSpawnInto,
  readCheatSub,
  readMoveInto,
  type CheatSpawnPayload,
  type MovePayload,
} from '../src/index.ts';

const i32 = fc.integer({ min: -0x80000000, max: 0x7fffffff }).map(asFx);

describe('payload codecs', () => {
  it('Move roundtrips and the allocation-free reader agrees', () => {
    const out: MovePayload = { x: asFx(0), y: asFx(0), z: asFx(0) };
    fc.assert(
      fc.property(fc.record({ x: i32, y: i32, z: i32 }), (p) => {
        const b = encodeMove(p);
        expect(b.length).toBe(MOVE_PAYLOAD_BYTES);
        expect(decodeMove(b)).toEqual(p);
        const padded = new Uint8Array(b.length + 7);
        padded.set(b, 7);
        expect(readMoveInto(new DataView(padded.buffer), 7, out)).toEqual(p);
      }),
      { numRuns: 500 },
    );
  });

  it('CheatSpawn roundtrips with the documented layout', () => {
    const out: CheatSpawnPayload = { bp: 0, army: 0, count: 0, x: asFx(0), z: asFx(0), spread: asFx(0) };
    fc.assert(
      fc.property(
        fc.record({
          bp: fc.integer({ min: 0, max: 0xffff }),
          army: fc.integer({ min: 0, max: 15 }),
          count: fc.integer({ min: 0, max: 0xffff }),
          x: i32,
          z: i32,
          spread: fc.integer({ min: 0, max: 0x7fffffff }).map(asFx),
        }),
        (p) => {
          const b = encodeCheatSpawn(p);
          expect(b.length).toBe(CHEAT_SPAWN_PAYLOAD_BYTES);
          expect(b[0]).toBe(CheatSub.Spawn);
          expect(decodeCheatSpawn(b)).toEqual(p);
          const dv = new DataView(b.buffer);
          expect(readCheatSub(dv, 0)).toBe(CheatSub.Spawn);
          expect(readCheatSpawnInto(dv, 0, out)).toEqual(p);
        },
      ),
      { numRuns: 500 },
    );
    const fixed = encodeCheatSpawn({ bp: 0x0102, army: 3, count: 0x0405, x: asFx(1), z: asFx(-1), spread: asFx(4096) });
    expect(Array.from(fixed)).toEqual([1, 2, 1, 3, 5, 4, 1, 0, 0, 0, 255, 255, 255, 255, 0, 16, 0, 0]);
  });

  it('CheatKill and sub-command sizes', () => {
    const k = encodeCheatKill();
    expect(Array.from(k)).toEqual([CheatSub.Kill]);
    expect(isCheatKill(k)).toBe(true);
    expect(isCheatKill(Uint8Array.of(1))).toBe(false);
    expect(cheatPayloadBytes(CheatSub.Spawn)).toBe(CHEAT_SPAWN_PAYLOAD_BYTES);
    expect(cheatPayloadBytes(CheatSub.Kill)).toBe(CHEAT_KILL_PAYLOAD_BYTES);
    expect(cheatPayloadBytes(99)).toBe(-1);
  });

  it('rejects invalid payloads', () => {
    expect(() => decodeMove(new Uint8Array(11))).toThrow(RangeError);
    expect(() => encodeMove({ x: 0.5 as Fx, y: asFx(0), z: asFx(0) })).toThrow(RangeError);
    expect(() => decodeCheatSpawn(new Uint8Array(CHEAT_SPAWN_PAYLOAD_BYTES))).toThrow(RangeError);
    expect(() =>
      encodeCheatSpawn({ bp: 0, army: 16, count: 1, x: asFx(0), z: asFx(0), spread: asFx(0) }),
    ).toThrow(RangeError);
    expect(() =>
      encodeCheatSpawn({ bp: 0, army: 0, count: 1, x: asFx(0), z: asFx(0), spread: asFx(-1) }),
    ).toThrow(RangeError);
  });
});
