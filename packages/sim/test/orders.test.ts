/**
 * G7 order queue (PLAN §3.4 phase 2, §3.5 OrderPool): replace/append (CmdFlags.Queue), Stop,
 * per-unit cap and pool overflow, execution order of queued moves, record/group release.
 */
import { describe, expect, it } from 'vitest';
import { FX_ONE } from '@faf/fixed';
import { CmdFlags } from '@faf/protocol';
import {
  CAP_ORDERS,
  createWorld,
  MAX_ORDERS_PER_UNIT,
  OrderType,
  pathStats,
  step,
  unitHandles,
  unitInfo,
  unitOrders,
  type World,
} from '../src/index.ts';
import { gameTable, moveCmd, spawnCmd, stopCmd } from './support/fixtures.ts';

function world(): World {
  return createWorld({ bpTable: gameTable(), seed: 4321, armyCount: 2 });
}

function run(w: World, n: number): void {
  for (let i = 0; i < n; i++) step(w);
}

const Q = CmdFlags.Queue;

describe('order queue (G7)', () => {
  it('Move without Queue replaces the queue, with Queue appends; queued moves run in order', () => {
    const w = world();
    step(w, [spawnCmd(0, 1, 100, 100, 0)]);
    const [h] = unitHandles(w);
    step(w, [moveCmd(0, [h!], 120, 100)]);
    step(w, [moveCmd(0, [h!], 120, 120, undefined, Q), moveCmd(0, [h!], 100, 120, undefined, Q)]);
    let orders = unitOrders(w, h!);
    expect(orders.map((o) => [o.type, o.x / FX_ONE, o.z / FX_ONE])).toEqual([
      [OrderType.Move, 120, 100],
      [OrderType.Move, 120, 120],
      [OrderType.Move, 100, 120],
    ]);
    expect(unitInfo(w, h!)!.orders).toBe(3);
    // Waypoints are reached in order: the corners of the square, then the queue is empty.
    const reached: number[] = [];
    const corners = [
      [120, 100],
      [120, 120],
      [100, 120],
    ] as const;
    for (let t = 0; t < 500 && reached.length < 3; t++) {
      step(w);
      const u = unitInfo(w, h!)!;
      const [cx, cz] = corners[reached.length]!;
      if (Math.hypot(u.x / FX_ONE - cx, u.z / FX_ONE - cz) < 0.4) reached.push(w.tick);
    }
    expect(reached.length).toBe(3);
    expect(reached[0]!).toBeLessThan(reached[1]!);
    expect(reached[1]!).toBeLessThan(reached[2]!);
    run(w, 5);
    expect(unitInfo(w, h!)!.orders).toBe(0);
    expect(unitInfo(w, h!)!.moving).toBe(false);
    // Every record and group was released.
    expect(pathStats(w).liveOrders).toBe(0);
    expect(pathStats(w).liveGroups).toBe(0);
    expect(pathStats(w).livePaths).toBe(0);
    // Replace: a new Move without Queue drops the queued ones.
    step(w, [moveCmd(0, [h!], 150, 150), moveCmd(0, [h!], 160, 150, undefined, Q)]);
    expect(unitInfo(w, h!)!.orders).toBe(2);
    step(w, [moveCmd(0, [h!], 90, 90)]);
    orders = unitOrders(w, h!);
    expect(orders.map((o) => [o.x / FX_ONE, o.z / FX_ONE])).toEqual([[90, 90]]);
    expect(pathStats(w).liveGroups).toBe(1);
  });

  it('Stop clears the queue and brakes; a queued Stop is a stop point', () => {
    const w = world();
    step(w, [spawnCmd(0, 3, 100, 100, 2)]);
    const hs = unitHandles(w);
    step(w, [moveCmd(0, hs, 200, 100), moveCmd(0, hs, 200, 200, undefined, Q), moveCmd(0, hs, 100, 200, undefined, Q)]);
    run(w, 20);
    expect(unitInfo(w, hs[0]!)!.orders).toBe(3);
    expect(unitInfo(w, hs[0]!)!.speed).toBeGreaterThan(0);
    step(w, [stopCmd(0, hs)]);
    for (const h of hs) {
      const u = unitInfo(w, h)!;
      expect(u.orders).toBe(0);
      expect(u.moving).toBe(false);
    }
    run(w, 20);
    for (const h of hs) expect(unitInfo(w, h)!.speed).toBe(0);
    expect(pathStats(w).liveOrders).toBe(0);
    expect(pathStats(w).liveGroups).toBe(0);
    // Move, then a queued Stop, then a queued Move: the unit stops at the first target, then goes on.
    const [h] = hs;
    step(w, [moveCmd(0, [h!], 110, 110), { ...stopCmd(0, [h!]), flags: Q }, moveCmd(0, [h!], 130, 110, undefined, Q)]);
    expect(unitOrders(w, h!).map((o) => o.type)).toEqual([OrderType.Move, OrderType.Stop, OrderType.Move]);
    let sawTwo = false;
    for (let t = 0; t < 400; t++) {
      step(w);
      if (unitInfo(w, h!)!.orders === 1) sawTwo = true;
      if (unitInfo(w, h!)!.orders === 0 && !unitInfo(w, h!)!.moving) break;
    }
    expect(sawTwo).toBe(true);
    expect(Math.hypot(unitInfo(w, h!)!.x / FX_ONE - 130, unitInfo(w, h!)!.z / FX_ONE - 110)).toBeLessThan(0.5);
  });

  it('caps the queue per unit (MAX_ORDERS_PER_UNIT) and counts dropped orders', () => {
    const w = world();
    step(w, [spawnCmd(0, 2, 100, 100, 1)]);
    const hs = unitHandles(w);
    const cmds = [];
    for (let k = 0; k < MAX_ORDERS_PER_UNIT + 8; k++) cmds.push(moveCmd(0, hs, 110 + k, 100, undefined, k === 0 ? 0 : Q));
    step(w, cmds);
    for (const h of hs) expect(unitInfo(w, h)!.orders).toBe(MAX_ORDERS_PER_UNIT);
    const s = pathStats(w);
    expect(s.ordersDropped).toBe(2 * 8);
    // The groups of the dropped commands were freed at once (no record references them).
    expect(s.liveGroups).toBe(MAX_ORDERS_PER_UNIT);
    expect(s.liveOrders).toBe(2 * MAX_ORDERS_PER_UNIT);
  });

  it('pool overflow: orders beyond CAP_ORDERS are dropped and counted, the sim keeps running', () => {
    const w = createWorld({ bpTable: gameTable(), seed: 5, armyCount: 1, mapSizeWu: 1024 });
    const units = Math.ceil(CAP_ORDERS / MAX_ORDERS_PER_UNIT) + 24; // 1,048 units × 32 > 32,768
    step(w, [spawnCmd(0, units, 512, 512, 60)]);
    const hs = unitHandles(w);
    expect(hs.length).toBe(units);
    const cmds = [];
    for (let k = 0; k < MAX_ORDERS_PER_UNIT; k++) cmds.push(moveCmd(0, hs, 400 + k * 4, 500, undefined, k === 0 ? 0 : Q));
    step(w, cmds);
    const s = pathStats(w);
    expect(s.liveOrders).toBe(CAP_ORDERS);
    expect(s.ordersDropped).toBe(units * MAX_ORDERS_PER_UNIT - CAP_ORDERS);
    run(w, 5);
    // Order records are recycled: after a Stop for everyone the pool is empty again.
    step(w, [stopCmd(0, hs)]);
    run(w, 2);
    expect(pathStats(w).liveOrders).toBe(0);
    expect(pathStats(w).liveGroups).toBe(0);
  });

  it('a group order is one group record referenced by every member; queued groups keep their own record', () => {
    const w = world();
    step(w, [spawnCmd(0, 12, 100, 100, 5)]);
    const hs = unitHandles(w);
    const before = pathStats(w).requestsIssued;
    step(w, [moveCmd(0, hs, 200, 100), moveCmd(0, hs, 200, 160, undefined, Q)]);
    // One request for the active group; the queued group asks when it begins.
    expect(pathStats(w).requestsIssued - before).toBe(1);
    expect(pathStats(w).liveGroups).toBe(2);
    const f0 = unitOrders(w, hs[0]!).map((o) => o.formation);
    for (const h of hs) expect(unitOrders(w, h).map((o) => o.formation)).toEqual(f0);
    expect(w.formations.col.refs[f0[0]!]).toBe(12);
    // After the first leg every member begins the second: exactly one more request.
    let t = 0;
    while (pathStats(w).liveGroups === 2 && t++ < 600) step(w);
    expect(pathStats(w).liveGroups).toBe(1);
    run(w, 3);
    expect(pathStats(w).requestsIssued - before).toBeGreaterThanOrEqual(2);
  });
});
