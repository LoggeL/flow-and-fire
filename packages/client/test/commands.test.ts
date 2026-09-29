import {
  CheatSub,
  CmdFlags,
  Op,
  decodeBatch,
  decodeCheatSpawn,
  decodeMove,
  isCheatKill,
} from '@faf/protocol';
import { describe, expect, it } from 'vitest';
import { CommandBuilder, MAX_PENDING_COMMANDS, seqAcked } from '../src/commands.ts';

class Sink {
  readonly batches: ArrayBuffer[] = [];
  sendCommands(b: ArrayBuffer): void {
    this.batches.push(b);
  }
  last() {
    const envs = decodeBatch(new Uint8Array(this.batches[this.batches.length - 1]!));
    expect(envs).toHaveLength(1);
    return envs[0]!;
  }
}

describe('CommandBuilder bytes (protocol decodeBatch roundtrip)', () => {
  it('Move: units, target, queue flag, tick 0, army, seq', () => {
    const sink = new Sink();
    const cb = new CommandBuilder(sink, 3);
    const seq = cb.move(Uint32Array.of(1, 0x00100002, 0xffffffff), 4096 * 10, 0, -4096 * 3, false, 5);
    expect(seq).toBe(1);
    const e = sink.last();
    expect(e.tick).toBe(0);
    expect(e.army).toBe(3);
    expect(e.seq).toBe(1);
    expect(e.op).toBe(Op.Move);
    expect(e.flags).toBe(0);
    expect(e.units).toEqual([1, 0x00100002, 0xffffffff]);
    expect(decodeMove(e.payload)).toEqual({ x: 40960, y: 0, z: -12288 });
    cb.move([7], 1, 2, 3, true);
    const q = sink.last();
    expect(q.seq).toBe(2);
    expect(q.flags).toBe(CmdFlags.Queue);
    // Each batch is a standalone ArrayBuffer (transferable), not a view into the encoder.
    expect(sink.batches[0]).not.toBe(sink.batches[1]);
    expect(sink.batches[0]!.byteLength).toBe(3 + 13 + 3 * 4 + 12);
  });

  it('Stop, Cheat Spawn and Cheat Kill', () => {
    const sink = new Sink();
    const cb = new CommandBuilder(sink, 0);
    cb.stop([5, 6]);
    let e = sink.last();
    expect(e.op).toBe(Op.Stop);
    expect(e.units).toEqual([5, 6]);
    expect(e.payload.length).toBe(0);

    cb.spawn(2, 1000, 1, 4096 * 256, 4096 * 128, 4096 * 40);
    e = sink.last();
    expect(e.op).toBe(Op.Cheat);
    expect(e.army).toBe(0);
    expect(e.units).toEqual([]);
    expect(e.payload[0]).toBe(CheatSub.Spawn);
    expect(decodeCheatSpawn(e.payload)).toEqual({ bp: 2, army: 1, count: 1000, x: 4096 * 256, z: 4096 * 128, spread: 4096 * 40 });

    cb.kill([9]);
    e = sink.last();
    expect(e.op).toBe(Op.Cheat);
    expect(e.units).toEqual([9]);
    expect(isCheatKill(e.payload)).toBe(true);
    expect(e.seq).toBe(3);
  });

  it('rejects empty unit lists and out-of-range cheat parameters without sending', () => {
    const sink = new Sink();
    const cb = new CommandBuilder(sink, 0);
    expect(cb.move([], 0, 0, 0)).toBe(-1);
    expect(cb.stop([])).toBe(-1);
    expect(cb.kill([])).toBe(-1);
    expect(() => cb.spawn(0, 0, 0, 0, 0, 0)).toThrow(RangeError);
    expect(() => cb.spawn(0, 1, 16, 0, 0, 0)).toThrow(RangeError);
    expect(() => cb.spawn(70000, 1, 0, 0, 0, 0)).toThrow(RangeError);
    expect(sink.batches).toHaveLength(0);
    expect(cb.lastSeq).toBe(0);
  });

  it('seq wraps from 0xFFFF to 1 (0 stays "nothing acknowledged")', () => {
    const sink = new Sink();
    const cb = new CommandBuilder(sink, 0);
    let s = 0;
    for (let i = 0; i < 0xffff; i++) s = cb.stop([1]);
    expect(s).toBe(0xffff);
    expect(cb.stop([1])).toBe(1);
    expect(cb.stop([1])).toBe(2);
  });
});

describe('ack bookkeeping', () => {
  it('seqAcked uses u16 serial arithmetic', () => {
    expect(seqAcked(5, 5)).toBe(true);
    expect(seqAcked(6, 5)).toBe(true);
    expect(seqAcked(4, 5)).toBe(false);
    expect(seqAcked(0, 1)).toBe(false);
    expect(seqAcked(2, 0xfffe)).toBe(true); // after wrap
    expect(seqAcked(0xfffe, 2)).toBe(false);
    expect(seqAcked(0x10005, 5)).toBe(true); // u32 header value, low 16 bits count
  });

  it('confirms pending commands once ackSeq ≥ seq and reports latency', () => {
    const sink = new Sink();
    const cb = new CommandBuilder(sink, 0);
    const acks: [number, number, number][] = [];
    const off = cb.onAck((seq, op, lat) => acks.push([seq, op, lat]));
    const a = cb.move([1], 0, 0, 0, false, 100);
    const b = cb.stop([1], 110);
    const c = cb.kill([1], 120);
    expect(cb.pendingCount).toBe(3);
    expect(cb.isPending(b)).toBe(true);
    expect(cb.acknowledge(0, 150)).toBe(0);
    expect(cb.acknowledge(b, 170)).toBe(2);
    expect(acks).toEqual([
      [a, Op.Move, 70],
      [b, Op.Stop, 60],
    ]);
    expect(cb.isPending(b)).toBe(false);
    expect(cb.isPending(c)).toBe(true);
    expect(cb.lastAckSeq).toBe(b);
    // Repeated ack does nothing.
    expect(cb.acknowledge(b, 180)).toBe(0);
    expect(cb.acknowledge(c + 5, 200)).toBe(1);
    expect(acks[2]).toEqual([c, Op.Cheat, 80]);
    expect(cb.pendingCount).toBe(0);
    expect(cb.confirmed).toBe(3);
    off();
    cb.stop([1], 0);
    cb.acknowledge(0xffff, 1);
    expect(acks).toHaveLength(3);
  });

  it('keeps at most MAX_PENDING_COMMANDS and counts overflow', () => {
    const cb = new CommandBuilder(new Sink(), 0);
    for (let i = 0; i < MAX_PENDING_COMMANDS + 10; i++) cb.stop([1], i);
    expect(cb.pendingCount).toBe(MAX_PENDING_COMMANDS);
    expect(cb.overflowed).toBe(10);
    expect(cb.isPending(1)).toBe(false);
    expect(cb.isPending(11)).toBe(true);
    expect(cb.acknowledge(cb.lastSeq, 0)).toBe(MAX_PENDING_COMMANDS);
  });
});
