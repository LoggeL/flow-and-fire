import fc from 'fast-check';
import { asArmyId, asHandle, asTick, type Handle } from '@faf/fixed';
import { describe, expect, it } from 'vitest';
import {
  BATCH_HEADER_BYTES,
  COMMAND_BATCH_VERSION,
  CommandBatchEncoder,
  CommandBatchView,
  ENVELOPE_FIXED_BYTES,
  Op,
  batchCount,
  decodeBatch,
  encodeBatch,
  encodeMove,
  readMoveInto,
  setBatchTick,
  validateBatch,
  type CommandEnvelope,
  type MovePayload,
  type Op as OpT,
} from '../src/index.ts';

const envArb: fc.Arbitrary<CommandEnvelope> = fc.record({
  tick: fc.nat({ max: 0xffffffff }).map(asTick),
  army: fc.integer({ min: 0, max: 15 }).map(asArmyId),
  seq: fc.integer({ min: 0, max: 0xffff }),
  op: fc.integer({ min: 0, max: 255 }).map((n) => n as OpT),
  flags: fc.integer({ min: 0, max: 255 }),
  units: fc.array(fc.nat({ max: 0xffffffff }).map(asHandle), { maxLength: 40 }),
  payload: fc.uint8Array({ maxLength: 64 }),
});

function viewToEnvelopes(bytes: Uint8Array, v: CommandBatchView): CommandEnvelope[] {
  v.reset(bytes);
  const out: CommandEnvelope[] = [];
  while (v.next()) {
    const units: Handle[] = [];
    for (let i = 0; i < v.unitCount; i++) units.push(v.unitAt(i));
    const payload = new Uint8Array(v.dataView.buffer, v.dataView.byteOffset + v.payloadOffset, v.payloadLength).slice();
    out.push({
      tick: asTick(v.tick),
      army: asArmyId(v.army),
      seq: v.seq,
      op: v.op as OpT,
      flags: v.flags,
      units,
      payload,
    });
  }
  return out;
}

describe('command batch codec', () => {
  it('encodes the documented byte layout', () => {
    const env: CommandEnvelope = {
      tick: asTick(0x01020304),
      army: asArmyId(3),
      seq: 0xabcd,
      op: Op.Move,
      flags: 1,
      units: [asHandle(0x11223344)],
      payload: Uint8Array.of(9, 8),
    };
    const b = encodeBatch([env]);
    expect(b.length).toBe(BATCH_HEADER_BYTES + ENVELOPE_FIXED_BYTES + 4 + 2);
    expect(Array.from(b)).toEqual([
      COMMAND_BATCH_VERSION, 1, 0, // version, count
      4, 3, 2, 1, // tick
      3, // army
      0xcd, 0xab, // seq
      1, // op
      1, // flags
      1, 0, // unitCount
      0x44, 0x33, 0x22, 0x11, // unit
      2, 0, // payloadLen
      9, 8,
    ]);
  });

  it('roundtrips (fast-check) and the view equals decodeBatch', () => {
    const view = new CommandBatchView();
    fc.assert(
      fc.property(fc.array(envArb, { maxLength: 30 }), (envs) => {
        const bytes = encodeBatch(envs);
        expect(validateBatch(bytes)).toBe(envs.length);
        const dec = decodeBatch(bytes);
        expect(dec).toEqual(envs);
        expect(viewToEnvelopes(bytes, view)).toEqual(dec);
      }),
      { numRuns: 300 },
    );
  });

  it('encoder is reusable, grows, and handles payload sub-ranges', () => {
    const e = new CommandBatchEncoder(16);
    const units = new Uint32Array(1000);
    for (let i = 0; i < units.length; i++) units[i] = i * 7;
    e.addRaw(5, 1, 2, Op.Stop, 0, units, Uint8Array.of(1, 2, 3, 4, 5), 1, 3);
    const d = decodeBatch(e.view());
    expect(d).toHaveLength(1);
    expect(d[0]!.units).toHaveLength(1000);
    expect(d[0]!.units[999]).toBe(999 * 7);
    expect(Array.from(d[0]!.payload)).toEqual([2, 3, 4]);
    e.reset();
    expect(e.count).toBe(0);
    expect(decodeBatch(e.view())).toEqual([]);
    const ab = e.addRaw(1, 0, 0, Op.Move, 0, [], new Uint8Array(0)).toArrayBuffer();
    expect(batchCount(new Uint8Array(ab))).toBe(1);
  });

  it('rejects out-of-range fields', () => {
    const e = new CommandBatchEncoder();
    expect(() => e.addRaw(0, 16, 0, 1, 0, [], new Uint8Array(0))).toThrow(RangeError);
    expect(() => e.addRaw(0, 0, 0x10000, 1, 0, [], new Uint8Array(0))).toThrow(RangeError);
    expect(() => e.addRaw(-1, 0, 0, 1, 0, [], new Uint8Array(0))).toThrow(RangeError);
    expect(() => e.addRaw(0, 0, 0, 256, 0, [], new Uint8Array(0))).toThrow(RangeError);
    expect(() => e.addRaw(0, 0, 0, 1, 0, [], new Uint8Array(0x10000))).toThrow(RangeError);
    expect(e.count).toBe(0);
  });

  it('detects malformed batches (truncation, trailing bytes, version)', () => {
    fc.assert(
      fc.property(fc.array(envArb, { minLength: 1, maxLength: 8 }), fc.nat(), (envs, cut) => {
        const bytes = encodeBatch(envs);
        const n = cut % bytes.length;
        expect(validateBatch(bytes.subarray(0, n))).toBe(-1);
        const longer = new Uint8Array(bytes.length + 1);
        longer.set(bytes);
        expect(validateBatch(longer)).toBe(-1);
        const badVer = bytes.slice();
        badVer[0] = 99;
        expect(validateBatch(badVer)).toBe(-1);
        expect(() => new CommandBatchView().reset(badVer)).toThrow(RangeError);
      }),
      { numRuns: 200 },
    );
  });

  it('setBatchTick stamps every envelope in place', () => {
    fc.assert(
      fc.property(fc.array(envArb, { maxLength: 10 }), fc.nat({ max: 0xffffffff }), (envs, tick) => {
        const bytes = encodeBatch(envs);
        expect(setBatchTick(bytes, tick)).toBe(envs.length);
        const dec = decodeBatch(bytes);
        expect(dec).toEqual(envs.map((e) => ({ ...e, tick })));
      }),
      { numRuns: 100 },
    );
  });

  it('works on a batch that sits at an offset inside a larger buffer', () => {
    const env: CommandEnvelope = {
      tick: asTick(7),
      army: asArmyId(1),
      seq: 3,
      op: Op.Move,
      flags: 0,
      units: [asHandle(42)],
      payload: encodeMove({ x: 4096 as never, y: 0 as never, z: -8192 as never }),
    };
    const b = encodeBatch([env]);
    const big = new Uint8Array(b.length + 13);
    big.set(b, 5);
    const sub = big.subarray(5, 5 + b.length);
    const v = new CommandBatchView();
    expect(v.reset(sub)).toBe(1);
    expect(v.next()).toBe(true);
    const out: MovePayload = { x: 0 as never, y: 0 as never, z: 0 as never };
    readMoveInto(v.dataView, v.payloadOffset, out);
    expect(out).toEqual({ x: 4096, y: 0, z: -8192 });
    expect(v.next()).toBe(false);
    expect(decodeBatch(sub)).toEqual([env]);
  });

  it('CommandBatchView iterates without allocating', () => {
    const e = new CommandBatchEncoder();
    for (let i = 0; i < 64; i++) e.addRaw(i, i & 15, i, Op.Move, 0, [i, i + 1, i + 2], encodeMove({ x: i as never, y: 0 as never, z: i as never }));
    const bytes = e.view().slice();
    const v = new CommandBatchView();
    const out: MovePayload = { x: 0 as never, y: 0 as never, z: 0 as never };
    const run = (): number => {
      let acc = 0;
      v.reset(bytes);
      while (v.next()) {
        acc += v.unitAt(v.unitCount - 1) + readMoveInto(v.dataView, v.payloadOffset, out).x;
      }
      return acc;
    };
    for (let i = 0; i < 1000; i++) run();
    const gc = (globalThis as { gc?: () => void }).gc;
    gc?.();
    const before = process.memoryUsage().heapUsed;
    let acc = 0;
    for (let i = 0; i < 50_000; i++) acc += run();
    gc?.();
    const grown = process.memoryUsage().heapUsed - before;
    expect(acc).toBeGreaterThan(0);
    if (gc !== undefined) expect(grown).toBeLessThan(256 * 1024);
  });
});
