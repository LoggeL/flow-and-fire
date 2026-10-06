/**
 * Remaining orders and cheats of the arena world: repair, guard, stop, patrol, air movement,
 * test consumer (AI-ECO-01 replacement) and extra income.
 */
import { describe, expect, it } from 'vitest';
import { OrderKind } from '@faf/ai';
import { Op } from '@faf/protocol';
import { Cmds, localFrame, run, runUntil, setonsWorld } from './support.ts';

const ENG = 'core:lnd_t1_engineer';
const FAC = 'core:str_t1_fac_land';
const TANK = 'core:lnd_t1_tank';

describe('arena orders', () => {
  it('repair restores HP at BP × ratio and costs a share of the price', () => {
    const w = setonsWorld();
    const c = new Cmds();
    const at = localFrame(w, 0, 1);
    const f = at(12, 0);
    const fac = w.spawn(0, FAC, f.x, f.z);
    const e = w.spawn(0, ENG, f.x, f.z + 6);
    w.setHp(fac, 0.5);
    const m0 = w.eco.statsOf(0).consumedMassMilli;
    w.step([c.target(0, Op.Repair, [e], fac)]);
    const t0 = w.tick;
    runUntil(w, () => w.unit(e)!.orders.length === 0, 3000);
    // half of 4,200 HP at 4,200 · 5 / 300 HP/s = 70 HP/s ⇒ 30 s
    expect(Math.abs(w.tick - t0 - 300)).toBeLessThanOrEqual(2);
    expect(w.unit(fac)!.hp).toBe(w.unit(fac)!.info.maxHp);
    const paid = w.eco.statsOf(0).consumedMassMilli - m0;
    expect(paid).toBeGreaterThan(115_000);
    expect(paid).toBeLessThan(125_000);
  });

  it('guard on a factory assists its production and counts as idle while the factory is idle', () => {
    const w = setonsWorld();
    const c = new Cmds();
    const at = localFrame(w, 0, 1);
    const f = at(12, 0);
    const fac = w.spawn(0, FAC, f.x, f.z);
    const e = w.spawn(0, ENG, f.x + 8, f.z);
    w.step([c.target(0, Op.Guard, [e], fac)]);
    run(w, 30);
    expect(w.counters[0]!.engineerIdleTicks).toBe(31);
    w.addIncome(0, 10, 200);
    const q = w.tick;
    w.step([c.factoryQueue(0, [fac], w.bpIndex(ENG), 1, false)]);
    const idle = w.counters[0]!.engineerIdleTicks;
    const spawned: number[] = [];
    w.observers.push({ onCompleted: (_w, u, how, tick) => how === 'produced' && spawned.push(tick) });
    runUntil(w, () => spawned.length > 0, 400);
    // 260 bt / (20 + 5) BP = 10.4 s + 2 s roll-off (instead of 13 s + 2 s)
    expect(Math.abs(spawned[0]! - q - 125)).toBeLessThanOrEqual(1);
    expect(w.counters[0]!.engineerIdleTicks - idle).toBeLessThanOrEqual(21);
    expect(w.unit(e)!.orders[0]!.kind).toBe(OrderKind.Guard);
  });

  it('stop clears orders, factory queues/loops and upgrades', () => {
    const w = setonsWorld();
    const c = new Cmds();
    const at = localFrame(w, 0, 1);
    const f = at(12, 0);
    const fac = w.spawn(0, FAC, f.x, f.z);
    const v = w.commander(0)!;
    w.step([
      c.move(0, [v.handle], v.x + 30, v.z),
      c.factoryQueue(0, [fac], w.bpIndex(ENG), 3, false),
      c.factoryRepeat(0, [fac], [w.bpIndex(TANK)]),
    ]);
    run(w, 5);
    w.step([c.stop(0, [v.handle, fac])]);
    const u = w.unit(fac)!;
    expect(v.orders.length).toBe(0);
    expect(u.queueBp.length).toBe(0);
    expect(u.repeat.length).toBe(0);
    expect(u.prodBp).toBe(-1);
  });

  it('patrol shuttles between the origin and the target point', () => {
    const w = setonsWorld();
    const c = new Cmds();
    const at = localFrame(w, 0, 1);
    const p0 = at(30, 30);
    const p1 = at(30, 50);
    const t = w.spawn(0, TANK, p0.x, p0.z);
    w.step([c.patrol(0, [t], p1.x, p1.z)]);
    let farthest = 0;
    let returned = false;
    for (let i = 0; i < 200; i++) {
      w.step([]);
      const u = w.unit(t)!;
      const d = Math.sqrt((u.x - p0.x) ** 2 + (u.z - p0.z) ** 2);
      if (d > farthest) farthest = d;
      if (farthest > 19 && d < 1) returned = true;
    }
    expect(farthest).toBeGreaterThan(19.4);
    expect(returned).toBe(true);
    expect(w.unit(t)!.orders[0]!.kind).toBe(OrderKind.Patrol);
  });

  it('air units fly straight lines at motion.speed', () => {
    const w = setonsWorld();
    const c = new Cmds();
    const a = w.startOf(0);
    const lark = w.spawn(0, 'core:air_t1_scout', a.x, a.z);
    const goal = { x: a.x + 180, z: a.z - 240 };
    w.step([c.move(0, [lark], goal.x, goal.z)]);
    runUntil(w, () => w.unit(lark)!.orders.length === 0, 1000);
    // 300 WU at 18 WU/s ≈ 16.7 s
    expect(Math.abs(w.tick - 167)).toBeLessThanOrEqual(2);
  });

  it('test consumer (AI-ECO-01): +100 E/s demand stalls the energy; extra income lifts it', () => {
    const w = setonsWorld();
    w.setStorage(0, 650, 0);
    const d = w.addDemand(0, 0, 100);
    run(w, 20);
    expect(w.ecoOf(0).energyRatio).toBeLessThan(0.25);
    expect(w.ecoOf(0).energyDemand).toBe(100);
    const inc = w.addIncome(0, 0, 100);
    run(w, 5);
    expect(w.ecoOf(0).energyRatio).toBe(1);
    w.removeDemand(d);
    w.removeIncome(inc);
    run(w, 5);
    expect(w.ecoOf(0).energyDemand).toBe(0);
    expect(w.cheatLog.map((r) => r.kind)).toEqual(['setStorage', 'addDemand', 'addIncome', 'removeDemand', 'removeIncome']);
  });
});
