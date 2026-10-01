import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CmdFlags, decodeBatch, Op } from '@faf/protocol';
import {
  APM_WINDOW_TICKS,
  CommandEmitter,
  decodeAiPayload,
  decodeBuild,
  decodeFactoryQueue,
  decodeFactoryRepeat,
  decodePosition,
  decodeTarget,
  decodeUpgrade,
  encodeBuild,
  encodeCommands,
  encodeFactoryQueue,
  encodeFactoryRepeat,
  encodePosition,
  encodeStop,
  encodeTarget,
  encodeUpgrade,
  FixedBudget,
  OrderKind,
  Prio,
  PROFILES,
  type OwnUnit,
  type Priority,
} from '../src/index.ts';

const toFx = (v: number): number => Math.round(v * 4096) / 4096;
const coord = fc.integer({ min: -4096 * 4096, max: 4096 * 4096 }).map((r) => r / 4096);

describe('payloads (AI_PAYLOAD_VERSION 2)', () => {
  it('position roundtrip (protocol Move layout, y = 0)', () => {
    fc.assert(
      fc.property(coord, coord, (x, z) => {
        const b = encodePosition(x, z);
        expect(b.length).toBe(12);
        const p = decodePosition(b);
        expect(p.x).toBe(toFx(x));
        expect(p.z).toBe(toFx(z));
      }),
    );
  });

  it('build roundtrip', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xfffe }), coord, coord, fc.integer({ min: 0, max: 3 }), (bp, x, z, rot) => {
        const d = decodeBuild(encodeBuild(bp, x, z, rot));
        expect(d).toMatchObject({ bp, x: toFx(x), z: toFx(z), rot });
      }),
    );
    expect(() => encodeBuild(0, 0, 0, 4)).toThrow(RangeError);
    expect(() => decodeBuild(new Uint8Array(3))).toThrow(RangeError);
  });

  it('target, factory queue, repeat, upgrade, stop roundtrips', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffffff }), (t) => {
        expect(decodeTarget(encodeTarget(t))).toBe(t);
      }),
    );
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xfffe }), fc.integer({ min: 1, max: 32 }), (bp, count) => {
        expect(decodeFactoryQueue(encodeFactoryQueue(bp, count))).toEqual({ bp, count });
      }),
    );
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 0xffff }), { minLength: 1, maxLength: 255 }), (items) => {
        expect(decodeFactoryRepeat(encodeFactoryRepeat(true, items))).toEqual({ on: true, items });
      }),
    );
    expect(decodeFactoryRepeat(encodeFactoryRepeat(false, []))).toEqual({ on: false, items: [] });
    expect(() => encodeFactoryRepeat(true, [])).toThrow(RangeError);
    expect(() => decodeFactoryRepeat(Uint8Array.of(1, 2, 0))).toThrow(RangeError);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffff }), (bp) => {
        expect(decodeUpgrade(encodeUpgrade(bp))).toBe(bp);
      }),
    );
    expect(encodeStop().length).toBe(0);
  });

  it('generic decode by op', () => {
    expect(decodeAiPayload(Op.AttackMove, encodePosition(3, 4))).toMatchObject({ op: 'position', value: { x: 3, z: 4 } });
    expect(decodeAiPayload(Op.Guard, encodeTarget(9))).toEqual({ op: 'target', value: 9 });
    expect(decodeAiPayload(Op.Stop, encodeStop())).toEqual({ op: 'stop' });
    expect(() => decodeAiPayload(Op.Cheat, new Uint8Array(1))).toThrow(RangeError);
    expect(() => decodeAiPayload(Op.Stop, new Uint8Array(1))).toThrow(RangeError);
  });
});

function unit(handle: number, patch: Partial<OwnUnit> = {}): OwnUnit {
  return {
    handle,
    bp: 0,
    x: 0,
    z: 0,
    hpFrac: 1,
    buildFrac: 1,
    complete: true,
    order: OrderKind.Idle,
    orderTarget: 0,
    orderBp: -1,
    orderX: 0,
    orderZ: 0,
    queueLength: 0,
    factoryBp: -1,
    factoryProgress: 0,
    factoryRepeat: false,
    upgradingTo: -1,
    lastDamagedTick: -1,
    ...patch,
  };
}

const bigBudget = (): FixedBudget => new FixedBudget(1e9);

describe('command emitter (ai.md §2.4)', () => {
  it('stamps tick N + lead, army and seq (u16 without 0), charges 10 ops per command', () => {
    const e = new CommandEmitter({ army: 3, apm: PROFILES.hard.apm, lead: 3, firstSeq: 0xfffe });
    e.beginThink(100, () => undefined);
    for (let i = 0; i < 4; i++) e.move([10 + i], i, i, Prio.P1);
    const b = bigBudget();
    const r = e.flush(b);
    expect(r.commands.map((c) => c.seq)).toEqual([0xfffe, 0xffff, 1, 2]);
    expect(r.commands.every((c) => c.tick === 103 && c.army === 3)).toBe(true);
    expect(b.used).toBe(40);
    const batch = decodeBatch(encodeCommands(r.commands));
    expect(batch).toHaveLength(4);
    expect(batch[0]!.op).toBe(Op.Move);
  });

  it('orders by priority, keeps groups together, burst and P0 overdraft', () => {
    const e = new CommandEmitter({ army: 0, apm: PROFILES.normal.apm, lead: 3 });
    e.beginThink(0, () => undefined);
    for (let i = 0; i < 18; i++) e.move([100 + i], i, 0, Prio.P3);
    e.group(() => {
      for (let i = 0; i < 4; i++) e.build(1, 5, 10 + 3 * i, 10, 0, Prio.P2, { queue: i > 0 });
    });
    e.move([7], 1, 1, Prio.P1);
    const r = e.flush(bigBudget());
    // burst 20: P1 (1) + group P2 (4) + 15 of the P3 moves.
    expect(r.commands).toHaveLength(20);
    expect(r.commands[0]!.units).toEqual([7]);
    expect(r.commands.slice(1, 5).map((c) => c.op)).toEqual([Op.Build, Op.Build, Op.Build, Op.Build]);
    expect(r.commands[2]!.flags & CmdFlags.Queue).toBe(CmdFlags.Queue);
    expect(r.dropped.filter((d) => d.reason === 'apm')).toHaveLength(3);
    // Bucket empty now: P2 is refused, P0 may overdraw by 5.
    e.beginThink(0, () => undefined);
    e.move([1], 5, 5, Prio.P2);
    for (let i = 0; i < 6; i++) e.move([200 + i], i, 9, Prio.P0);
    const r2 = e.flush(bigBudget());
    expect(r2.commands).toHaveLength(5);
    expect(r2.commands.every((c) => c.units[0]! >= 200)).toBe(true);
    // A group that does not fit is dropped whole.
    e.beginThink(5, () => undefined); // +1 token
    e.group(() => {
      e.move([300], 1, 1, Prio.P2);
      e.move([301], 1, 1, Prio.P2);
    });
    const r3 = e.flush(bigBudget());
    expect(r3.commands).toHaveLength(0);
    expect(r3.dropped).toHaveLength(2);
  });

  it('never exceeds the APM cap in any 60-s window over 10 simulated minutes', () => {
    for (const d of ['easy', 'normal', 'hard'] as const) {
      const p = PROFILES[d];
      const e = new CommandEmitter({ army: 0, apm: p.apm, lead: p.lead });
      const ticks: number[] = [];
      let n = 0;
      for (let t = 0; t <= 6000; t += p.thinkEvery) {
        e.beginThink(t, () => undefined);
        const k = t / p.thinkEvery;
        const want = k % 7 === 0 ? 30 : 4;
        for (let i = 0; i < want; i++) e.move([1 + (n++ % 997)], n, k, (i % 5) as Priority);
        for (const c of e.flush(bigBudget()).commands) ticks.push(c.tick);
      }
      let lo = 0;
      let max = 0;
      for (let hi = 0; hi < ticks.length; hi++) {
        while (ticks[lo]! <= ticks[hi]! - APM_WINDOW_TICKS) lo++;
        max = Math.max(max, hi - lo + 1);
      }
      expect(max).toBeLessThanOrEqual(p.apm.cap);
      // The cap is actually used (bucket refills at cap/min).
      expect(max).toBeGreaterThan(p.apm.cap * 0.8);
    }
  });

  it('dedup: unchanged orders, in-flush duplicates, repeat/rally memory', () => {
    const units = new Map<number, OwnUnit>([
      [1, unit(1, { order: OrderKind.Move, orderX: 10, orderZ: 20 })],
      [2, unit(2, { order: OrderKind.Build, orderBp: 5, orderX: 30, orderZ: 30 })],
      [3, unit(3, { order: OrderKind.Guard, orderTarget: 77 })],
      [4, unit(4, { upgradingTo: 9 })],
      [5, unit(5)],
      [6, unit(6, { order: OrderKind.Move, orderX: 10, orderZ: 20, queueLength: 2 })],
    ]);
    const e = new CommandEmitter({ army: 0, apm: PROFILES.hard.apm, lead: 3 });
    e.beginThink(0, (h) => units.get(h));
    e.move([1], 10, 20, Prio.P1); // same order ⇒ dedup
    e.move([1], 10, 20, Prio.P1, { queue: true }); // queued ⇒ kept
    e.build(2, 5, 30, 30, 0, Prio.P2); // same build ⇒ dedup
    e.guard([3], 77, Prio.P2); // same guard ⇒ dedup
    e.guard([3], 78, Prio.P2); // other target ⇒ kept
    e.upgrade(4, 9, Prio.P2); // already upgrading ⇒ dedup
    e.stop([5], Prio.P2); // already idle ⇒ dedup
    e.move([6], 10, 20, Prio.P1); // would clear the queue ⇒ kept
    e.move([5], 1, 1, Prio.P1);
    e.move([5], 1, 1, Prio.P1); // exact duplicate in the same flush ⇒ dedup
    e.factoryRepeat(5, [1, 2], Prio.P3);
    e.setRally([5], 4, 4, Prio.P4);
    const r = e.flush(bigBudget());
    expect(r.dropped.filter((d) => d.reason === 'dedup')).toHaveLength(6);
    expect(r.commands.map((c) => c.op)).toEqual([Op.Move, Op.Move, Op.Move, Op.Guard, Op.FactoryRepeat, Op.SetRally]);
    // Repeat/rally: same payload again is dropped while the factory reports repeat on.
    units.set(5, unit(5, { factoryRepeat: true }));
    e.beginThink(5, (h) => units.get(h));
    e.factoryRepeat(5, [1, 2], Prio.P3);
    e.setRally([5], 4, 4, Prio.P4);
    e.factoryRepeat(5, [2, 1], Prio.P3);
    const r2 = e.flush(bigBudget());
    expect(r2.commands.map((c) => c.op)).toEqual([Op.FactoryRepeat]);
    // After forget() the memory is gone.
    e.forget(5);
    e.beginThink(10, (h) => units.get(h));
    e.setRally([5], 4, 4, Prio.P4);
    expect(e.flush(bigBudget()).commands).toHaveLength(1);
  });

  it('budget: non-P0 commands wait when the reserve is empty, P0 is charged anyway', () => {
    const e = new CommandEmitter({ army: 0, apm: PROFILES.hard.apm, lead: 3 });
    e.beginThink(0, () => undefined);
    e.move([1], 1, 1, Prio.P2);
    e.move([2], 1, 1, Prio.P2);
    e.move([3], 1, 1, Prio.P0);
    const b = new FixedBudget(25);
    const r = e.flush(b);
    expect(r.commands.map((c) => c.units[0])).toEqual([3, 1]);
    expect(r.dropped.map((d) => d.reason)).toEqual(['budget']);
    // Empty reserve: P0 still goes out and is charged.
    e.beginThink(5, () => undefined);
    e.move([4], 2, 2, Prio.P0);
    e.move([5], 2, 2, Prio.P1);
    const empty = new FixedBudget(0);
    const r2 = e.flush(empty);
    expect(r2.commands.map((c) => c.units[0])).toEqual([4]);
    expect(empty.used).toBe(10);
  });

  it('rollback discards the requests of an aborted step', () => {
    const e = new CommandEmitter({ army: 0, apm: PROFILES.hard.apm, lead: 3 });
    e.beginThink(0, () => undefined);
    e.move([1], 1, 1, Prio.P2);
    const m = e.mark();
    e.move([2], 1, 1, Prio.P2);
    e.move([3], 1, 1, Prio.P2);
    expect(e.rollback(m).map((d) => d.reason)).toEqual(['aborted', 'aborted']);
    expect(e.flush(bigBudget()).commands.map((c) => c.units[0])).toEqual([1]);
  });
});
