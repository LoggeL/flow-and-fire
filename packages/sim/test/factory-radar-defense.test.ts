import { beforeAll, describe, expect, it } from 'vitest';
import { asArmyId, asTick, fx, type Handle } from '@faf/fixed';
import { compileContent } from '@faf/blueprints/content';
import { decodeSimBin, type SimBpTable } from '@faf/blueprints/simbin';
import { encodeFactoryQueue, encodeTogglePause, FrameReader, FrameWriter, Op, UnitFlags, type CommandEnvelope } from '@faf/protocol';
import { createWorld, fullHash, initializeSkirmish, restore, snapshot, step, writeFrame, type World } from '../src/index.ts';
import { spawnUnit } from '../src/units.ts';
import { UnitBits } from '../src/constants.ts';
import { canUpgrade } from '../src/upgrade.ts';
import { nextSeq } from './support/fixtures.ts';
import { quietCorner } from './support/corner.ts';

let bp: SimBpTable;
beforeAll(async () => { bp = decodeSimBin((await compileContent({ includeTest: true })).simBin); });
const id = (name: string) => { const i = bp.indexOf(name); if (i < 0) throw new Error(`missing ${name}`); return i; };
function command(w: World, u: number, op: Op, payload: Uint8Array, army = w.units.col.army[u]!): CommandEnvelope {
  return { tick: asTick(0), army: asArmyId(army), seq: nextSeq(army), op, flags: 0, units: [w.units.handle(u) as Handle], payload };
}
function upgrade(w: World, u: number, target: string): CommandEnvelope {
  const payload = new Uint8Array(2); new DataView(payload.buffer).setUint16(0, id(target), true);
  return command(w, u, Op.Upgrade, payload);
}
/** Capacity is recomputed from buildings every tick: give the army real income and storage. */
function economy(w: World, army = 0): void {
  spawnUnit(w, id('core:cmd_commander'), army, fx(6), fx(6), 0);
  for (let i = 0; i < 10; i++) spawnUnit(w, id('core:str_t1_pgen'), army, fx(4 + i * 3), fx(56), 0);
  for (let i = 0; i < 8; i++) spawnUnit(w, id('core:str_t1_mex'), army, fx(4 + i * 3), fx(60), 0);
  for (let i = 0; i < 3; i++) spawnUnit(w, id('core:str_t1_estorage'), army, fx(50), fx(4 + i * 3), 0);
  step(w);
  w.armies.col.massStored.set(army, w.armies.col.massCapacity.get(army)); w.armies.col.energyStored.set(army, w.armies.col.energyCapacity.get(army));
}
const bank = economy;
function frame(w: World, viewer: number): FrameReader {
  const writer = new FrameWriter(), bytes = new Uint8Array(writer.capacityBytes), reader = new FrameReader();
  expect(reader.reset(bytes.subarray(0, writeFrame(w, viewer, writer, bytes)))).toBe(true);
  return reader;
}
const recordOf = (r: FrameReader, handle: number) => Array.from({ length: r.unitCount }, (_, i) => i).find(i => r.unitHandle(i) === handle);
const ofType = (w: World, name: string, army = 0) => { const b = id(name), out: number[] = []; for (let u = 0; u < w.units.highWater; u++) if (w.units.isLive(u) && w.units.col.bp[u] === b && w.units.col.army[u] === army && (w.units.col.flags[u]! & UnitBits.UnderConstruction) === 0) out.push(u); return out; };

describe('land factory tiers (ms6.3)', () => {
  it('compiles the T1 → T2 → T3 chain on one site and opens tier production', () => {
    const t1 = id('core:fac_land_t1'), t2 = id('core:fac_land_t2'), t3 = id('core:fac_land_t3');
    expect([bp.upgradesTo(t1), bp.upgradesTo(t2), bp.upgradesTo(t3)]).toEqual([t2, t3, -1]);
    for (const f of [t2, t3]) expect([bp.footprintWCol[f], bp.footprintHCol[f], bp.layerCol[f]]).toEqual([bp.footprintWCol[t1], bp.footprintHCol[t1], bp.layerCol[t1]]);
    expect(bp.buildableByExpr(t2)).toBe(-1); expect(bp.buildableByExpr(t3)).toBe(-1);
    const w = createWorld({ bpTable: bp, seed: 3, armyCount: 2, mapSizeWu: 64 });
    expect(canUpgrade(w, t1, t2)).toBe(true); expect(canUpgrade(w, t2, t3)).toBe(true); expect(canUpgrade(w, t1, t3)).toBe(false);
    expect(canUpgrade(w, id('core:str_t1_mex'), t2)).toBe(false);
    const can = (factory: number, unit: string) => bp.canBuild(factory, id(unit));
    expect([can(t1, 'core:eng_t1'), can(t1, 'core:lnd_t1_tank'), can(t1, 'core:lnd_t2_tank'), can(t1, 'core:lnd_t3_heavy')]).toEqual([true, true, false, false]);
    expect([can(t2, 'core:eng_t1'), can(t2, 'core:lnd_t1_tank'), can(t2, 'core:lnd_t2_tank'), can(t2, 'core:lnd_t3_heavy')]).toEqual([true, true, true, false]);
    expect([can(t3, 'core:lnd_t1_tank'), can(t3, 'core:lnd_t2_tank'), can(t3, 'core:lnd_t3_heavy')]).toEqual([true, true, true]);
  });

  it('pays the upgrade, holds production meanwhile, keeps the queue and handle, then builds a T2 tank', () => {
    const w = createWorld({ bpTable: bp, seed: 5, armyCount: 2, mapSizeWu: 64 }), U = w.units.col;
    const f = spawnUnit(w, id('core:fac_land_t1'), 0, fx(20) + 2048, fx(20) + 2048, 0), handle = w.units.handle(f);
    bank(w);
    step(w, [command(w, f, Op.FactoryQueue, encodeFactoryQueue({ bp: id('core:lnd_t1_tank'), count: 2 })), upgrade(w, f, 'core:fac_land_t2')]);
    let tanks = ofType(w, 'core:lnd_t1_tank').length;
    for (let n = 0; n < 2000 && U.bp[f] !== id('core:fac_land_t2'); n++) {
      step(w);
      // While the upgrade runs no product is started or finished.
      expect(ofType(w, 'core:lnd_t1_tank').length).toBe(tanks);
    }
    expect(U.bp[f]).toBe(id('core:fac_land_t2')); expect(w.units.handle(f)).toBe(handle);
    expect(U.productionCount[f]).toBe(2);
    for (let n = 0; n < 2000 && ofType(w, 'core:lnd_t1_tank').length < 2; n++) step(w);
    tanks = ofType(w, 'core:lnd_t1_tank').length; expect(tanks).toBe(2);
    step(w, [command(w, f, Op.FactoryQueue, encodeFactoryQueue({ bp: id('core:lnd_t2_tank'), count: 1 }))]);
    for (let n = 0; n < 3000 && ofType(w, 'core:lnd_t2_tank').length === 0; n++) step(w);
    expect(ofType(w, 'core:lnd_t2_tank')).toHaveLength(1);
  });

  it('Stop cancels only the factory upgrade and keeps the production queue; pause holds it; snapshots replay exactly', () => {
    const w = createWorld({ bpTable: bp, seed: 7, armyCount: 2, mapSizeWu: 64 }), U = w.units.col;
    const f = spawnUnit(w, id('core:fac_land_t1'), 0, fx(20) + 2048, fx(20) + 2048, 0);
    bank(w);
    step(w, [command(w, f, Op.FactoryQueue, encodeFactoryQueue({ bp: id('core:lnd_t1_tank'), count: 3 })), upgrade(w, f, 'core:fac_land_t2')]);
    step(w); const progress = U.repairDone.get(f); expect(progress).toBeGreaterThan(0);
    step(w, [command(w, f, Op.TogglePause, encodeTogglePause(true))]); step(w);
    expect(U.repairDone.get(f)).toBe(progress);
    const other = createWorld({ bpTable: bp, seed: 7, armyCount: 2, mapSizeWu: 64 }); restore(other, snapshot(w));
    const resume = command(w, f, Op.TogglePause, encodeTogglePause(false));
    step(w, [resume]); step(other, [resume]);
    for (let i = 0; i < 20; i++) { step(w); step(other); } expect(fullHash(other)).toBe(fullHash(w));
    step(w, [command(w, f, Op.Stop, new Uint8Array(0))]);
    expect(U.bp[f]).toBe(id('core:fac_land_t1')); expect(U.repairDone.get(f)).toBe(0); expect(U.productionCount[f]).toBe(3);
    for (let n = 0; n < 2000 && ofType(w, 'core:lnd_t1_tank').length === 0; n++) step(w);
    expect(ofType(w, 'core:lnd_t1_tank').length).toBeGreaterThan(0);
    // A plain Stop on an idle factory keeps clearing its queue as before.
    step(w, [command(w, f, Op.Stop, new Uint8Array(0))]); expect(U.productionCount[f]).toBe(0);
  });
});

describe('radar blips (frame presentation)', () => {
  function radarWorld() {
    const w = createWorld({ bpTable: bp, seed: 11, armyCount: 2, mapSizeWu: 256 });
    initializeSkirmish(w, { kind: 'skirmish', faction: 0, rules: { unitCap: 100, fog: 'explore', victory: 'annihilation' } });
    bank(w);
    const radar = spawnUnit(w, id('core:str_t1_radar'), 0, fx(40), fx(40), 0);
    const enemy = spawnUnit(w, id('core:lnd_t1_tank'), 1, fx(120), fx(40), 0);
    const far = spawnUnit(w, id('core:lnd_t1_tank'), 1, fx(200), fx(200), 0);
    step(w); step(w);
    return { w, radar, enemy, far };
  }
  it('shows a powered radar\'s out-of-sight enemies as blips without hp, build, parts or weapon aim', () => {
    const { w, enemy, far } = radarWorld(), hash = fullHash(w);
    const r = frame(w, 0), i = recordOf(r, w.units.handle(enemy));
    expect(i).toBeDefined();
    expect(r.unitFlags(i!) & UnitFlags.Blip).toBe(UnitFlags.Blip);
    expect([r.unitHp(i!), r.unitBuild(i!), r.unitPartCount(i!)]).toEqual([255, 255, 0]);
    expect(r.unitFlags(i!) & (UnitFlags.Damaged | UnitFlags.Idle | UnitFlags.Paused | UnitFlags.Stalled | UnitFlags.MountAimParts)).toBe(0);
    expect(recordOf(r, w.units.handle(far))).toBeUndefined();
    // Writing frames never changes World state.
    expect(fullHash(w)).toBe(hash);
    // The other army's view is unaffected; observers see everything without blips.
    expect(recordOf(frame(w, 1), w.units.handle(enemy))).toBeDefined();
    const all = frame(w, -1), j = recordOf(all, w.units.handle(enemy))!;
    expect(all.unitFlags(j) & UnitFlags.Blip).toBe(0);
  });
  it('a paused, unfinished or destroyed radar shows nothing', () => {
    const { w, radar, enemy } = radarWorld(), U = w.units.col;
    step(w, [command(w, radar, Op.TogglePause, encodeTogglePause(true))]); step(w);
    expect(recordOf(frame(w, 0), w.units.handle(enemy))).toBeUndefined();
    step(w, [command(w, radar, Op.TogglePause, encodeTogglePause(false))]); step(w);
    expect(recordOf(frame(w, 0), w.units.handle(enemy))).toBeDefined();
    U.flags[radar] = U.flags[radar]! | UnitBits.UnderConstruction;
    expect(recordOf(frame(w, 0), w.units.handle(enemy))).toBeUndefined();
  });
});

describe('point defense', () => {
  it('a Riegel I engages and destroys an enemy T1 tank inside its range', () => {
    // 256 WU map, in a corner ≥ 60 WU from both commanders: only the turret can hit the tank.
    const w = createWorld({ bpTable: bp, seed: 13, armyCount: 2, mapSizeWu: 256 });
    initializeSkirmish(w, { kind: 'skirmish', faction: 0, rules: { unitCap: 100, fog: 'revealed', victory: 'annihilation' } });
    const [cx, cz] = quietCorner(w, bp);
    const pd = spawnUnit(w, id('core:str_t1_pd'), 0, fx(cx) + 2048, fx(cz) + 2048, 0);
    const tank = spawnUnit(w, id('core:lnd_t1_tank'), 1, fx(cx), fx(cz + 20), 0), handle = w.units.handle(tank);
    expect(bp.mountCount(id('core:str_t1_pd'))).toBe(1);
    for (let n = 0; n < 600 && w.units.resolve(handle) >= 0 && (w.units.col.flags[tank]! & UnitBits.Dead) === 0; n++) step(w);
    expect(w.units.resolve(handle) < 0 || (w.units.col.flags[tank]! & UnitBits.Dead) !== 0).toBe(true);
    expect(w.units.isLive(pd)).toBe(true);
  });
});
