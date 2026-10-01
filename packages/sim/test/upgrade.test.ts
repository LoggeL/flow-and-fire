import { beforeAll, describe, expect, it } from 'vitest';
import { asArmyId, asTick, fx, type Handle } from '@faf/fixed';
import { compileContent } from '@faf/blueprints/content';
import { decodeSimBin, type SimBpTable } from '@faf/blueprints/simbin';
import { CmdFlags, encodeTarget, encodeTogglePause, FlowFlags, FrameReader, FrameWriter, Op, WatchOrderType, type CommandEnvelope } from '@faf/protocol';
import { createWorld, fullHash, restore, snapshot, step, writeFrame, type World } from '../src/index.ts';
import { spawnUnit } from '../src/units.ts';
import { queueLength } from '../src/orders.ts';
import { upgradeTarget } from '../src/upgrade.ts';
import { nextSeq } from './support/fixtures.ts';

let bp: SimBpTable;
const BASE = 'core:cmd_commander', ENGINEERING = 'core:cmd_commander_engineering', ARMORED = 'core:cmd_commander_armored';
beforeAll(async () => { bp = decodeSimBin((await compileContent({ includeTest: true })).simBin); });
function world(): World { return createWorld({ bpTable: bp, seed: 19, armyCount: 2, mapSizeWu: 64 }); }
function spawn(w: World, id = BASE, army = 0, x = 10): number { return spawnUnit(w, bp.indexOf(id), army, fx(x), fx(10), 1234); }
function cmd(w: World, u: number, op: Op, payload: Uint8Array, flags = 0, army = w.units.col.army[u]!): CommandEnvelope {
  return { tick: asTick(0), army: asArmyId(army), seq: nextSeq(army), op, flags, units: [w.units.handle(u) as Handle], payload };
}
function upgrade(w: World, u: number, id = ENGINEERING, flags = 0, army = w.units.col.army[u]!): CommandEnvelope {
  const payload = new Uint8Array(2); new DataView(payload.buffer).setUint16(0, bp.indexOf(id), true);
  return cmd(w, u, Op.Upgrade, payload, flags, army);
}
function bank(w: World): void { w.armies.col.massStored.set(0, 650000); w.armies.col.energyStored.set(0, 3900000); }
function paidUntil(w: World, u: number, id: string): readonly [number, number] {
  let mass = 0, energy = 0;
  for (let guard = 0; w.units.col.bp[u] !== bp.indexOf(id) && guard < 1200; guard++) {
    step(w); mass += w.armies.col.massSpent.get(0); energy += w.armies.col.energySpent.get(0);
  }
  expect(w.units.col.bp[u]).toBe(bp.indexOf(id));
  return [mass, energy];
}
function frame(w: World, u: number, viewer = 0): FrameReader {
  const writer = new FrameWriter(), bytes = new Uint8Array(writer.capacityBytes), reader = new FrameReader();
  const watch = new Uint32Array([w.units.handle(u)]);
  expect(reader.reset(bytes.subarray(0, writeFrame(w, viewer, writer, bytes, undefined, watch, 1)))).toBe(true);
  return reader;
}

describe('real commander self upgrades', () => {
  it('compiles a bounded successor chain with inherited weapons, motion, economy and base builder capability', () => {
    const base = bp.indexOf(BASE), engineering = bp.indexOf(ENGINEERING), armored = bp.indexOf(ARMORED);
    expect(bp.upgradesTo(base)).toBe(engineering); expect(bp.upgradesTo(engineering)).toBe(armored); expect(bp.upgradesTo(armored)).toBe(-1);
    expect([bp.maxHpCol[base], bp.maxHpCol[engineering], bp.maxHpCol[armored]]).toEqual([12000, 16000, 24000]);
    expect([bp.buildPowerQ16PerTickCol[base], bp.buildPowerQ16PerTickCol[engineering], bp.buildPowerQ16PerTickCol[armored]]).toEqual([65536, 131072, 131072]);
    for (const target of [engineering, armored]) {
      expect(bp.speedPerTick(target)).toBe(bp.speedPerTick(base)); expect(bp.mountCount(target)).toBe(bp.mountCount(base));
      expect(bp.mountWeaponCol[bp.firstMount(target)]).toBe(bp.mountWeaponCol[bp.firstMount(base)]);
      expect(bp.massIncomeMilliPerTickCol[target]).toBe(bp.massIncomeMilliPerTickCol[base]);
      expect(bp.energyIncomeMilliPerTickCol[target]).toBe(bp.energyIncomeMilliPerTickCol[base]);
      expect(bp.canBuild(target, bp.indexOf('core:str_t1_pgen'))).toBe(true);
    }
  });
  it('retains old stats until completion and preserves handle, pose and damage while paying each successor exactly', () => {
    const w = world(), u = spawn(w), U = w.units.col, handle = w.units.handle(u), position = [U.x[u], U.y[u], U.z[u], U.yaw[u]];
    U.hp[u] = 11000; bank(w); step(w, [upgrade(w, u)]);
    const first = [w.armies.col.massSpent.get(0), w.armies.col.energySpent.get(0)];
    expect(U.bp[u]).toBe(bp.indexOf(BASE)); expect(U.hp[u]).toBe(11000);
    const rest = paidUntil(w, u, ENGINEERING);
    expect([first[0]! + rest[0], first[1]! + rest[1]]).toEqual([300000, 3000000]);
    expect(U.hp[u]).toBe(15000); expect(w.units.handle(u)).toBe(handle);
    expect([U.x[u], U.y[u], U.z[u], U.yaw[u]]).toEqual(position);
    bank(w); step(w, [upgrade(w, u, ARMORED)]);
    const second = [w.armies.col.massSpent.get(0), w.armies.col.energySpent.get(0)], tail = paidUntil(w, u, ARMORED);
    expect([second[0]! + tail[0], second[1]! + tail[1]]).toEqual([400000, 5000000]);
    expect(U.hp[u]).toBe(23000); expect(w.units.handle(u)).toBe(handle);
  });
  it('pauses, stalls and cancels through native flow without refunding consumed resources or granting partial stats', () => {
    const w = world(), u = spawn(w), U = w.units.col; bank(w);
    step(w, [upgrade(w, u)]); const done = U.repairDone.get(u), paid = U.repairPaidMass.get(u), stored = w.armies.col.massStored.get(0);
    expect(done).toBeGreaterThan(0); expect(paid).toBeGreaterThan(0);
    step(w, [cmd(w, u, Op.TogglePause, encodeTogglePause(true))]); step(w);
    expect(U.repairDone.get(u)).toBe(done); expect(w.armies.col.massSpent.get(0)).toBe(0);
    step(w, [cmd(w, u, Op.TogglePause, encodeTogglePause(false))]); expect(U.repairDone.get(u)).toBeGreaterThan(done);
    step(w, [cmd(w, u, Op.Stop, new Uint8Array(0))]);
    expect(U.bp[u]).toBe(bp.indexOf(BASE)); expect(U.repairDone.get(u)).toBe(0); expect(queueLength(w, u)).toBe(0);
    expect(w.armies.col.massStored.get(0)).toBeLessThanOrEqual(stored + 400); // Income is allowed; consumption is retained.
    const empty = world(), a = spawn(empty); step(empty, [upgrade(empty, a)]);
    expect(empty.units.col.ecoRatio[a]).toBeLessThan(65536); expect(empty.units.col.bp[a]).toBe(bp.indexOf(BASE));
    expect(empty.armies.col.massStored.get(0)).toBeGreaterThanOrEqual(0); expect(empty.armies.col.energyStored.get(0)).toBeGreaterThanOrEqual(0);
  });
  it('rejects wrong armies, skipped prerequisites, malformed payloads and noncommanders; duplicate queued requests cannot reset progress', () => {
    const w = world(), u = spawn(w), engineer = spawn(w, 'core:eng_t1', 0, 15); bank(w);
    step(w, [upgrade(w, u, ENGINEERING, 0, 1), upgrade(w, u, ARMORED), upgrade(w, engineer), cmd(w, u, Op.Upgrade, new Uint8Array(1))]);
    expect(queueLength(w, u)).toBe(0); expect(queueLength(w, engineer)).toBe(0); expect(w.armies.col.massSpent.get(0)).toBe(0);
    step(w, [upgrade(w, u), upgrade(w, u, ENGINEERING, CmdFlags.Queue), upgrade(w, u, ARMORED, CmdFlags.Queue), upgrade(w, u, ARMORED, CmdFlags.Queue)]);
    expect(queueLength(w, u)).toBe(2); const done = w.units.col.repairDone.get(u);
    step(w, [upgrade(w, u)]); expect(queueLength(w, u)).toBe(2); expect(w.units.col.repairDone.get(u)).toBeGreaterThan(done);
    paidUntil(w, u, ENGINEERING); bank(w); paidUntil(w, u, ARMORED); step(w); expect(queueLength(w, u)).toBe(0);
    step(w, [upgrade(w, u, ENGINEERING)]); expect(queueLength(w, u)).toBe(0);
  });
  it('excludes repair power during upgrades and restores durable upgrade progress and billing exactly', () => {
    const w = world(), u = spawn(w), helper = spawn(w, 'core:eng_t1', 0, 12); bank(w); w.units.col.hp[u] = 10000;
    step(w, [upgrade(w, u), cmd(w, helper, Op.Repair, encodeTarget(w.units.handle(u)))]);
    expect(w.frameFlowPower.get(u)).toBe(bp.buildPowerQ16PerTickCol[bp.indexOf(BASE)]); expect(w.units.col.hp[u]).toBe(10000);
    const other = world(); restore(other, snapshot(w)); expect(fullHash(other)).toBe(fullHash(w));
    for (let i = 0; i < 50; i++) { step(w); step(other); }
    expect(fullHash(other)).toBe(fullHash(w)); expect(upgradeTarget(w, u)).toBe(bp.indexOf(ENGINEERING));
  });
  it('exports current successor and real progress with Upgrade12 and flow charges only to authorized viewers', () => {
    const w = world(), u = spawn(w); bank(w); step(w, [upgrade(w, u)]);
    const before = fullHash(w), reader = frame(w, u);
    expect(reader.watchFactoryBp(0)).toBe(bp.indexOf(ENGINEERING)); expect(reader.watchFactoryProgress(0)).toBe(w.units.col.repairDone.get(u));
    expect(reader.watchTargetType(0, 0)).toBe(WatchOrderType.Upgrade);
    const row = Array.from({ length: reader.flowCount }, (_, i) => i).find(i => reader.flowHandle(i) === w.units.handle(u))!;
    expect(reader.flowFlags(row) & FlowFlags.Upgrading).toBe(FlowFlags.Upgrading);
    expect(reader.flowMassSpent(row)).toBe(w.armies.col.massSpent.get(0)); expect(fullHash(w)).toBe(before);
    const foreign = frame(w, u, 1); expect(foreign.watchCount).toBe(0); expect(foreign.flowCount).toBe(0);
  });
});
