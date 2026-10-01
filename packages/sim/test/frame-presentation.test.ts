import { asArmyId, asTick, fx, type Handle } from '@faf/fixed';
import { describe, expect, it } from 'vitest';
import { CmdFlags, encodeBuild, encodeTarget, encodeTogglePause, EventType, FlowFlags, FogState, FrameReader, FrameWriter, Op, type CommandEnvelope } from '@faf/protocol';
import { createWorld, fullHash, initializeSkirmish, restore, snapshot, step, writeFrame, type World } from '../src/index.ts';
import { spawnUnit } from '../src/units.ts';
import { canSeePosition } from '../src/intel.ts';
import { gameTable, nextSeq } from './support/fixtures.ts';

const writer = new FrameWriter(), buffer = new Uint8Array(writer.capacityBytes);
function frame(world: World, viewer = 0): FrameReader {
  const reader = new FrameReader();
  expect(reader.reset(buffer.subarray(0, writeFrame(world, viewer, writer, buffer)))).toBe(true);
  return reader;
}
function command(world: World, unit: number, op: Op, payload: Uint8Array, flags = 0): CommandEnvelope {
  const army = world.units.col.army[unit]!;
  return { tick: asTick(0), army: asArmyId(army), seq: nextSeq(army), op, flags, units: [world.units.handle(unit) as Handle], payload };
}

describe('authoritative presentation observations', () => {
  it('bills the shared site once, exports actual contributing builders and preserves all arena hashes', () => {
    const bp = gameTable(), world = createWorld({ bpTable: bp, seed: 7, armyCount: 2, mapSizeWu: 64 });
    const commander = spawnUnit(world, bp.indexOf('core:cmd_commander'), 0, fx(12.5), fx(10.5), 0);
    const helper = spawnUnit(world, bp.indexOf('core:eng_t1'), 0, fx(12.5), fx(12.5), 0);
    world.armies.col.massStored.set(0, 650000); world.armies.col.energyStored.set(0, 3900000);
    step(world, [command(world, commander, Op.Build, encodeBuild({ bp: bp.indexOf('core:fac_land_t1'), yaw: 0, x: fx(16.5), z: fx(10.5) }))]);
    const target = world.units.col.buildTarget[commander]!;
    expect(world.units.resolve(target)).toBeGreaterThanOrEqual(0);
    step(world, [command(world, helper, Op.Assist, encodeTarget(target))]);
    const before = fullHash(world), reader = frame(world);
    expect(fullHash(world)).toBe(before);
    const indices = Array.from({ length: reader.flowCount }, (_, i) => i);
    const billed = indices.filter(i => (reader.flowFlags(i) & FlowFlags.Billed) !== 0);
    expect(billed).toHaveLength(1);
    expect(reader.flowHandle(billed[0]!)).toBe(target);
    const links = indices.filter(i => (reader.flowFlags(i) & FlowFlags.Contributing) !== 0);
    expect(links.map(i => reader.flowHandle(i)).sort()).toEqual([world.units.handle(commander), world.units.handle(helper)].sort());
    expect(links.every(i => reader.flowTarget(i) === target && reader.flowMassDemand(i) === 0)).toBe(true);
    expect(reader.flowEffectivePower(billed[0]!)).toBe(bp.buildPowerQ16PerTickCol[bp.indexOf('core:cmd_commander')]! + bp.buildPowerQ16PerTickCol[bp.indexOf('core:eng_t1')]!);
    expect(billed.reduce((sum, i) => sum + reader.flowMassDemand(i), 0)).toBe(world.armies.col.massDemand.get(0));
    expect(billed.reduce((sum, i) => sum + reader.flowEnergySpent(i), 0)).toBe(world.armies.col.energySpent.get(0));
    const snap = snapshot(world);
    restore(world, snap);
    const restored = frame(world);
    expect(restored.flowTick).toBe(-1);
    expect(restored.flowCount).toBe(0);
    expect(fullHash(world)).toBe(before);
  });

  it('retains a paused billed storage site with zero real rates and resumes the same site', () => {
    const bp=gameTable(),world=createWorld({bpTable:bp,seed:8,armyCount:2,mapSizeWu:64});
    const builder=spawnUnit(world,bp.indexOf('core:cmd_commander'),0,fx(10),fx(10),0);
    world.armies.col.massStored.set(0,650000);world.armies.col.energyStored.set(0,3900000);
    step(world,[command(world,builder,Op.Build,encodeBuild({bp:bp.indexOf('core:str_t1_estorage'),yaw:0,x:fx(14),z:fx(10)}))]);
    const handle=world.units.col.buildTarget[builder]!,site=world.units.resolve(handle);
    expect(site).toBeGreaterThanOrEqual(0);
    step(world,[command(world,site,Op.TogglePause,encodeTogglePause(true))]);
    const paused=frame(world),row=Array.from({length:paused.flowCount},(_,i)=>i).find(i=>paused.flowHandle(i)===handle)!;
    expect(row).toBeDefined();
    expect(paused.flowFlags(row)&(FlowFlags.Paused|FlowFlags.BuildSite)).toBe(FlowFlags.Paused|FlowFlags.BuildSite);
    expect([paused.flowMassDemand(row),paused.flowEnergyDemand(row),paused.flowMassSpent(row),paused.flowEnergySpent(row)]).toEqual([0,0,0,0]);
    const progress=world.units.col.buildDone.get(site);
    step(world);expect(world.units.col.buildDone.get(site)).toBe(progress);
    step(world,[command(world,site,Op.TogglePause,encodeTogglePause(false))]);
    const resumed=frame(world),active=Array.from({length:resumed.flowCount},(_,i)=>i).find(i=>resumed.flowHandle(i)===handle)!;
    expect(resumed.flowFlags(active)&FlowFlags.Paused).toBe(0);
    expect(resumed.flowMassSpent(active)).toBeGreaterThan(0);
    expect(world.units.col.buildDone.get(site)).toBeGreaterThan(progress);
  });

  it('publishes 32 own queued Build intents without watching or exposing the foreign queue', () => {
    const bp = gameTable(), world = createWorld({ bpTable: bp, seed: 9, armyCount: 2, mapSizeWu: 64 });
    initializeSkirmish(world);
    const own = 0, enemy = 1;
    const builds = Array.from({ length: 32 }, (_, i) => command(world, own, Op.Build, encodeBuild({ bp: bp.indexOf('core:fac_land_t1'), yaw: i * 1024, x: fx(20.5 + i % 4 * 7), z: fx(40.5) }), CmdFlags.Queue));
    builds.push(command(world, enemy, Op.Build, encodeBuild({ bp: bp.indexOf('core:str_t1_pgen'), yaw: 0, x: fx(40), z: fx(20) }), CmdFlags.Queue));
    step(world, builds);
    const reader = frame(world);
    expect(reader.watchCount).toBe(0);
    expect(reader.buildIntentCount).toBe(32);
    for (let i = 0; i < 32; i++) {
      expect(reader.buildIntentBuilder(i)).toBe(world.units.handle(own));
      expect(reader.buildIntentQueueIndex(i)).toBe(i);
      expect(reader.buildIntentYaw(i)).toBe(i * 1024);
      expect(reader.buildIntentArmy(i)).toBe(0);
    }
    expect(frame(world, -1).buildIntentCount).toBe(33);
  });

  it('matches actual vision at every fog cell and retains exploration after vision moves away', () => {
    const world = createWorld({ bpTable: gameTable(), seed: 11, armyCount: 2, mapSizeWu: 64 });
    initializeSkirmish(world);
    const reader = frame(world), oldVisible: number[] = [];
    for (let i = 0; i < reader.fogBytes; i++) {
      const x = (i % reader.fogDim) * 8 + 4, z = Math.floor(i / reader.fogDim) * 8 + 4;
      expect(reader.fogCell(i) === FogState.Visible).toBe(canSeePosition(world, 0, fx(x), fx(z)));
      if (reader.fogCell(i) === FogState.Visible) oldVisible.push(i);
    }
    expect(oldVisible.length).toBeGreaterThan(0);
    world.units.col.x[0] = fx(60); world.units.col.z[0] = fx(0);
    step(world);
    const moved = frame(world);
    expect(oldVisible.some(i => moved.fogCell(i) === FogState.Explored)).toBe(true);
    const rawBefore = fullHash(world);
    const observer = frame(world, -1);
    expect(Array.from({ length: observer.fogBytes }, (_, i) => observer.fogCell(i)).every(state => state === FogState.Visible)).toBe(true);
    expect(fullHash(world)).toBe(rawBefore);
  });

  it('emits an authoritative rising storage event only to the relevant army and preserves the full hash', () => {
    const bp = gameTable(), world = createWorld({ bpTable: bp, seed: 13, armyCount: 2, mapSizeWu: 64 });
    initializeSkirmish(world);
    step(world);
    const before = fullHash(world), own = frame(world);
    const events = Array.from({ length: own.eventCount }, (_, i) => i).filter(i => own.eventType(i) === EventType.StorageFull);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every(i => own.eventVisual(i) === 0)).toBe(true);
    expect(fullHash(world)).toBe(before);
    step(world);
    const ongoing = frame(world);
    expect(Array.from({ length: ongoing.eventCount }, (_, i) => ongoing.eventType(i))).not.toContain(EventType.StorageFull);
  });
});
