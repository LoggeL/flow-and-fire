import { beforeAll, describe, expect, it } from 'vitest';
import { asArmyId, asTick, fx, type Handle } from '@faf/fixed';
import { compileContent } from '@faf/blueprints/content';
import { decodeSimBin, type SimBpTable } from '@faf/blueprints/simbin';
import { CmdFlags, encodeTogglePause, FlowFlags, FrameReader, FrameWriter, Op, WatchOrderType, type CommandEnvelope } from '@faf/protocol';
import { createWorld, fullHash, restore, snapshot, step, writeFrame, type World } from '../src/index.ts';
import { spawnUnit } from '../src/units.ts';
import { queueLength } from '../src/orders.ts';
import { canUpgrade } from '../src/upgrade.ts';
import { nextSeq } from './support/fixtures.ts';

let bp: SimBpTable;
const ids = ['core:str_t1_mex', 'core:str_t2_mex', 'core:str_t3_mex'];
beforeAll(async () => { bp = decodeSimBin((await compileContent({ includeTest: true })).simBin); });
function fixture() {
  const w = createWorld({ bpTable: bp, seed: 29, armyCount: 2, mapSizeWu: 128 });
  spawnUnit(w, bp.indexOf('core:cmd_commander'), 0, fx(10), fx(10), 0);
  for (let i = 0; i < 12; i++) spawnUnit(w, bp.indexOf('core:str_t1_pgen'), 0, fx(40 + i * 3), fx(40), 0);
  const u = spawnUnit(w, bp.indexOf(ids[0]!), 0, fx(16), fx(16), 4321);
  w.armies.col.massStored.set(0, 650000); w.armies.col.energyStored.set(0, 3900000);
  return { w, u };
}
function command(w: World, u: number, op: Op, payload: Uint8Array, flags = 0, army = 0): CommandEnvelope {
  return { tick: asTick(0), army: asArmyId(army), seq: nextSeq(army), op, flags, units: [w.units.handle(u) as Handle], payload };
}
function upgrade(w: World, u: number, target = ids[1]!, flags = 0, army = 0) {
  const payload = new Uint8Array(2); new DataView(payload.buffer).setUint16(0, bp.indexOf(target), true);
  return command(w, u, Op.Upgrade, payload, flags, army);
}
function finish(w: World, u: number, target: string, first?: CommandEnvelope) {
  let mass = 0, energy = 0;
  for (let n = 0; w.units.col.bp[u] !== bp.indexOf(target) && n < 20000; n++) {
    const old = w.units.col.bp[u]!;
    step(w, n === 0 && first ? [first] : []);
    mass += w.armies.col.massSpent.get(0);
    let upkeep = 0;
    for (let i = 0; i < w.units.highWater; i++) if (w.units.col.army[i] === 0) {
      const current = i === u ? old : w.units.col.bp[i]!;
      upkeep += Math.floor(bp.energyUpkeepMilliPerTickCol[current]! * w.units.col.ecoRatio[i]! / 65536);
    }
    energy += w.armies.col.energySpent.get(0) - upkeep;
  }
  expect(w.units.col.bp[u], JSON.stringify({ target, tick: w.tick, progress: w.units.col.repairDone.get(u), paidMass: w.units.col.repairPaidMass.get(u), paidEnergy: w.units.col.repairPaidEnergy.get(u), ratio: w.units.col.ecoRatio[u], head: w.units.col.orderHead[u], massStored: w.armies.col.massStored.get(0), massIncome: w.armies.col.massIncome.get(0), energyStored: w.armies.col.energyStored.get(0) })).toBe(bp.indexOf(target));
  return [mass, energy];
}

describe('paid mass extractor self upgrades', () => {
  it('compiles the designed successor chain, same site and actual tier economics', () => {
    const tiers = ids.map(id => bp.indexOf(id));
    expect(tiers.every(i => i >= 0)).toBe(true);
    expect(tiers.map(i => bp.upgradesTo(i))).toEqual([tiers[1], tiers[2], -1]);
    expect(tiers.map(i => bp.maxHpCol[i])).toEqual([400, 2100, 7000]);
    expect(tiers.map(i => bp.massIncomeMilliPerTickCol[i])).toEqual([200, 600, 1800]);
    expect(tiers.map(i => bp.energyUpkeepMilliPerTickCol[i])).toEqual([200, 900, 5400]);
    expect(tiers.map(i => bp.buildPowerQ16PerTickCol[i])).toEqual([65536, 98304, 0]);
    for (const i of tiers) expect([bp.footprintWCol[i], bp.footprintHCol[i], bp.spotKindCol[i], bp.layerCol[i]]).toEqual([bp.footprintWCol[tiers[0]!], bp.footprintHCol[tiers[0]!], bp.spotKindCol[tiers[0]!], bp.layerCol[tiers[0]!]]);
  });
  it('retains damage, handle, pose and old production until fully paid, charging upgrade cost separately from upkeep', () => {
    const { w, u } = fixture(), U = w.units.col, handle = w.units.handle(u), pose = [U.x[u], U.y[u], U.z[u], U.yaw[u]];
    U.hp[u] = 300;
    step(w, [upgrade(w, u)]);
    expect(U.bp[u]).toBe(bp.indexOf(ids[0]!)); expect(U.hp[u]).toBe(300);
    expect(w.armies.col.massIncome.get(0)).toBe(300); // Commander + still-T1 extractor.
    const first = [w.armies.col.massSpent.get(0), w.armies.col.energySpent.get(0) - 200], tail = finish(w, u, ids[1]!);
    expect([first[0]! + tail[0]!, first[1]! + tail[1]!]).toEqual([900000, 5400000]);
    expect(U.hp[u]).toBe(2000); expect(w.units.handle(u)).toBe(handle); expect([U.x[u], U.y[u], U.z[u], U.yaw[u]]).toEqual(pose);
    step(w); expect(w.armies.col.massIncome.get(0)).toBe(700);
    // An upgrading extractor's upkeep ratio also scales its production. Six nominal M/s
    // alone cannot sustain 23.276 M/s T3 work. Real supply actors keep this completion case
    // fully funded; stall semantics remain checked separately below.
    for (let i = 0; i < 16; i++) spawnUnit(w, bp.indexOf(ids[0]!), 0, fx(30 + i * 3), fx(70), 0);
    expect(finish(w, u, ids[2]!, upgrade(w, u, ids[2]!))).toEqual([4500000, 31000000]);
    expect(U.hp[u]).toBe(6900); expect(w.units.handle(u)).toBe(handle); expect([U.x[u], U.y[u], U.z[u], U.yaw[u]]).toEqual(pose);
    step(w); expect(w.armies.col.massIncome.get(0)).toBe(5100); // Commander + T3 +16 T1 supply actors.
  });
  it('pauses, resumes, cancels without refunds, stalls and reproduces a partially paid snapshot', () => {
    const { w, u } = fixture(), U = w.units.col;
    step(w, [upgrade(w, u)]); const progress = U.repairDone.get(u), paid = U.repairPaidMass.get(u);
    step(w, [command(w, u, Op.TogglePause, encodeTogglePause(true))]); step(w);
    expect(U.repairDone.get(u)).toBe(progress); expect(w.armies.col.massSpent.get(0)).toBe(0);
    step(w, [command(w, u, Op.TogglePause, encodeTogglePause(false))]); expect(U.repairDone.get(u)).toBeGreaterThan(progress);
    const other = createWorld({ bpTable: bp, seed: 29, armyCount: 2, mapSizeWu: 128 }); restore(other, snapshot(w));
    for (let i = 0; i < 30; i++) { step(w); step(other); } expect(fullHash(other)).toBe(fullHash(w));
    const stored = w.armies.col.massStored.get(0);
    step(w, [command(w, u, Op.Stop, new Uint8Array(0))]);
    expect(U.bp[u]).toBe(bp.indexOf(ids[0]!)); expect(U.repairDone.get(u)).toBe(0); expect(queueLength(w, u)).toBe(0);
    expect(paid).toBeGreaterThan(0); expect(w.armies.col.massStored.get(0)).toBeLessThanOrEqual(stored + 300);
    const empty = createWorld({ bpTable: bp, seed: 29, armyCount: 2, mapSizeWu: 64 });
    const a = spawnUnit(empty, bp.indexOf(ids[0]!), 0, fx(10), fx(10), 0);
    step(empty, [upgrade(empty, a)]); expect(empty.units.col.ecoRatio[a]).toBeLessThan(65536);
    expect(empty.units.col.bp[a]).toBe(bp.indexOf(ids[0]!)); expect(empty.armies.col.energyStored.get(0)).toBeGreaterThanOrEqual(0);
  });
  it('rejects foreign, skipped, duplicate and incompatible footprint/layer/spot targets authoritatively', () => {
    const { w, u } = fixture();
    step(w, [upgrade(w, u, ids[1]!, 0, 1), upgrade(w, u, ids[2]!), upgrade(w, u, 'core:cmd_commander_engineering')]);
    expect(queueLength(w, u)).toBe(0);
    step(w, [upgrade(w, u), upgrade(w, u, ids[1]!, CmdFlags.Queue), upgrade(w, u, ids[2]!, CmdFlags.Queue)]);
    expect(queueLength(w, u)).toBe(2); const progress = w.units.col.repairDone.get(u);
    step(w, [upgrade(w, u)]); expect(queueLength(w, u)).toBe(2); expect(w.units.col.repairDone.get(u)).toBeGreaterThan(progress);
    const source = bp.indexOf(ids[0]!), target = bp.indexOf(ids[1]!);
    for (const col of [bp.footprintWCol, bp.footprintHCol, bp.layerCol, bp.spotKindCol]) {
      const value = col[target]!; try { col[target] = value + 1; expect(canUpgrade(w, source, target)).toBe(false); } finally { col[target] = value; }
    }
  });
  it('exports the actual target, Upgrade order and paid progress to accepted own frames', () => {
    const { w, u } = fixture(); step(w, [upgrade(w, u)]);
    const writer = new FrameWriter(), bytes = new Uint8Array(writer.capacityBytes), reader = new FrameReader();
    const hash = fullHash(w); reader.reset(bytes.subarray(0, writeFrame(w, 0, writer, bytes, undefined, new Uint32Array([w.units.handle(u)]), 1)));
    expect(reader.watchFactoryBp(0)).toBe(bp.indexOf(ids[1]!)); expect(reader.watchFactoryProgress(0)).toBe(w.units.col.repairDone.get(u));
    expect(reader.watchTargetType(0, 0)).toBe(WatchOrderType.Upgrade);
    const f = Array.from({ length: reader.flowCount }, (_, i) => i).find(i => reader.flowHandle(i) === w.units.handle(u))!;
    expect(reader.flowFlags(f) & FlowFlags.Upgrading).toBe(FlowFlags.Upgrading); expect(fullHash(w)).toBe(hash);
  });
});
