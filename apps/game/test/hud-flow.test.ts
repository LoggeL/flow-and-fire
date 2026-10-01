import { asArmyId, asTick, fx, type Handle } from '@faf/fixed';
import { EcoField, encodeBuild, encodeFactoryQueue, encodeTarget, encodeTogglePause, FH_FLOW_TICK, FlowFlags, FrameReader, FrameWriter, Op, type CommandEnvelope } from '@faf/protocol';
import { createWorld, fullHash, restore, setAlliance, snapshot, spawnUnit, step, writeFrame, type World } from '../../../packages/sim/src/index.ts';
import { describe, expect, it } from 'vitest';
import { gameTable } from '../../../packages/sim/test/support/fixtures.ts';
import { frameFactoryAssistance, frameFlowConsumers } from '../src/hud/flow.ts';

let sequence = 0;
function fixture() {
  const bp = gameTable(), world = createWorld({ bpTable: bp, seed: 31, armyCount: 2, mapSizeWu: 64 });
  const spawn = (id: string, x = 10, z = 10, army = 0) => spawnUnit(world, bp.indexOf(id), army, fx(x), fx(z), 0);
  const subject = (index: number) => ({ typeId: bp.ids[index]!, factory: bp.ids[index] === 'core:fac_land_t1' });
  const bank = () => { world.armies.col.massStored.set(0, 650000); world.armies.col.energyStored.set(0, 3900000); };
  return { bp, world, spawn, subject, bank };
}
function cmd(world: World, unit: number, op: Op, payload: Uint8Array): CommandEnvelope {
  return { tick: asTick(0), army: asArmyId(world.units.col.army[unit]!), seq: ++sequence,
    op, flags: 0, units: [world.units.handle(unit) as Handle], payload };
}
function read(world: World): FrameReader {
  const writer = new FrameWriter(), bytes = new Uint8Array(writer.capacityBytes), reader = new FrameReader();
  expect(reader.reset(bytes.subarray(0, writeFrame(world, 0, writer, bytes)))).toBe(true);
  return reader;
}
function assertRates(world: World, frame: FrameReader, subject: ReturnType<typeof fixture>['subject']) {
  const before = fullHash(world), rows = frameFlowConsumers(frame, subject);
  for (const [column, field, key] of [
    [world.armies.col.massDemand, EcoField.massDemand, 'massReq'],
    [world.armies.col.energyDemand, EcoField.energyDemand, 'energyReq'],
    [world.armies.col.massSpent, EcoField.massSpent, 'massGot'],
    [world.armies.col.energySpent, EcoField.energySpent, 'energyGot'],
  ] as const) {
    expect(rows.reduce((sum, row) => sum + row[key], 0)).toBeCloseTo(column.get(0) / 100, 10);
    expect(frame.ecoValue(0, field)).toBe(column.get(0));
  }
  expect(fullHash(world)).toBe(before);
  return rows;
}

describe('HUD flow from actual EcoPhase and viewer Frame', () => {
  it('bills a shared construction site once alongside upkeep and displays real resource rates', () => {
    const f = fixture(), builder = f.spawn('core:cmd_commander'), helper = f.spawn('core:eng_t1', 11, 10);
    f.spawn('core:str_t1_mex', 25, 25); f.bank();
    step(f.world, [cmd(f.world, builder, Op.Build, encodeBuild({ bp: f.bp.indexOf('core:str_t1_pgen'), yaw: 0, x: fx(14), z: fx(10) }))]);
    const target = f.world.units.col.buildTarget[builder]!;
    step(f.world, [cmd(f.world, helper, Op.Assist, encodeTarget(target))]);
    const rows = assertRates(f.world, read(f.world), f.subject);
    expect(rows).toHaveLength(2);
    expect(rows.filter(row => row.id === target)).toEqual([expect.objectContaining({ typeId: 'core:cmd_commander', kind: 'engineer', targetTypeId: 'core:str_t1_pgen', paused: false })]);
    expect(rows.some(row => row.id === f.world.units.handle(builder) || row.id === f.world.units.handle(helper))).toBe(false);
    expect(rows.find(row => row.typeId === 'core:str_t1_mex')?.kind).toBe('upkeep');
  });

  it('pauseConsumer on the billed site pauses zero rates and resumes that same paid site', () => {
    const f = fixture(), builder = f.spawn('core:cmd_commander'); f.bank();
    step(f.world, [cmd(f.world, builder, Op.Build, encodeBuild({ bp: f.bp.indexOf('core:str_t1_estorage'), yaw: 0, x: fx(14), z: fx(10) }))]);
    const row = frameFlowConsumers(read(f.world), f.subject)[0]!, site = f.world.units.resolve(row.id);
    const progress = f.world.units.col.buildDone.get(site), paid = f.world.units.col.buildPaidMass.get(site);
    step(f.world, [cmd(f.world, site, Op.TogglePause, encodeTogglePause(true))]);
    expect(assertRates(f.world, read(f.world), f.subject)).toEqual([expect.objectContaining({ id: row.id, paused: true, massReq: 0, massGot: 0, energyReq: 0, energyGot: 0 })]);
    step(f.world); expect(f.world.units.col.buildDone.get(site)).toBe(progress);
    step(f.world, [cmd(f.world, site, Op.TogglePause, encodeTogglePause(false))]);
    const resumed = assertRates(f.world, read(f.world), f.subject)[0]!;
    expect(resumed.id).toBe(row.id); expect(resumed.paused).toBe(false);
    expect(f.world.units.col.buildDone.get(site)).toBeGreaterThan(progress);
    expect(f.world.units.col.buildPaidMass.get(site)).toBeGreaterThan(paid);
  });

  it('counts allied assist in total product power without inventing private helper identities', () => {
    const f = fixture(); f.spawn('core:cmd_commander', 8, 8); const factory = f.spawn('core:fac_land_t1', 14, 12);
    const own = f.spawn('core:eng_t1', 18, 14), ally = f.spawn('core:cmd_commander', 18, 10, 1);
    setAlliance(f.world, 0, 1, true); f.bank();
    step(f.world, [cmd(f.world, factory, Op.FactoryQueue, encodeFactoryQueue({ bp: f.bp.indexOf('core:lnd_t1_tank'), count: 1 }))]);
    const handle = f.world.units.handle(factory), product = f.world.units.col.buildTarget[factory]!;
    step(f.world, [cmd(f.world, own, Op.Assist, encodeTarget(handle)), cmd(f.world, ally, Op.Assist, encodeTarget(handle))]);
    const frame = read(f.world), actual = frameFactoryAssistance(frame, handle, product, f.subject);
    const factoryPower = f.bp.buildPowerQ16PerTickCol[f.bp.indexOf('core:fac_land_t1')]!;
    const helperPower = f.bp.buildPowerQ16PerTickCol[f.bp.indexOf('core:eng_t1')]! + f.bp.buildPowerQ16PerTickCol[f.bp.indexOf('core:cmd_commander')]!;
    expect(actual).toEqual({ available: true, bpAssist: helperPower * 10 / 65536,
      bpEffective: (factoryPower + helperPower) * 10 / 65536, paused: false, helpers: [{ typeId: 'core:eng_t1', count: 1 }] });
    expect(Array.from({ length: frame.flowCount }, (_, i) => frame.flowArmy(i))).not.toContain(1);
    expect(assertRates(f.world, frame, f.subject)).toEqual([expect.objectContaining({ id: product, kind: 'factory', targetTypeId: 'core:lnd_t1_tank' })]);
    step(f.world, [cmd(f.world, own, Op.TogglePause, encodeTogglePause(true))]);
    const noOwn = frameFactoryAssistance(read(f.world), handle, product, f.subject);
    expect(noOwn.helpers).toEqual([]);
    expect(noOwn.bpAssist).toBe(f.bp.buildPowerQ16PerTickCol[f.bp.indexOf('core:cmd_commander')]! * 10 / 65536);
  });

  it('factory and child pause reflect the actual product, including allies continuing an unpaused child', () => {
    const f = fixture(); f.spawn('core:cmd_commander', 8, 8); const factory = f.spawn('core:fac_land_t1', 14, 12), ally = f.spawn('core:eng_t1', 18, 10, 1);
    setAlliance(f.world, 0, 1, true); f.bank();
    step(f.world, [cmd(f.world, factory, Op.FactoryQueue, encodeFactoryQueue({ bp: f.bp.indexOf('core:lnd_t1_tank'), count: 1 }))]);
    const handle = f.world.units.handle(factory), product = f.world.units.col.buildTarget[factory]!, site = f.world.units.resolve(product);
    step(f.world, [cmd(f.world, ally, Op.Assist, encodeTarget(handle)), cmd(f.world, factory, Op.TogglePause, encodeTogglePause(true))]);
    const done = f.world.units.col.buildDone.get(site);
    expect(frameFactoryAssistance(read(f.world), handle, product, f.subject)).toEqual({ available: true, bpAssist: 0, bpEffective: 0, paused: true, helpers: [] });
    step(f.world); expect(f.world.units.col.buildDone.get(site)).toBe(done);
    step(f.world, [cmd(f.world, site, Op.TogglePause, encodeTogglePause(false))]);
    const childActive = frameFactoryAssistance(read(f.world), handle, product, f.subject);
    expect(childActive.paused).toBe(true);
    expect(childActive.bpAssist).toBe(f.bp.buildPowerQ16PerTickCol[f.bp.indexOf('core:eng_t1')]! * 10 / 65536);
    expect(childActive.bpEffective).toBe(childActive.bpAssist);
    expect(f.world.units.col.buildDone.get(site)).toBeGreaterThan(done);
    step(f.world, [cmd(f.world, factory, Op.TogglePause, encodeTogglePause(false))]);
    expect(frameFactoryAssistance(read(f.world), handle, product, f.subject).paused).toBe(false);
  });

  it('ETA power follows the exact tier allocation during partial and complete stalls', () => {
    const f = fixture(), commander = f.spawn('core:cmd_commander', 8, 8), factory = f.spawn('core:fac_land_t1', 14, 12);
    step(f.world, [cmd(f.world, factory, Op.FactoryQueue, encodeFactoryQueue({ bp: f.bp.indexOf('core:lnd_t1_tank'), count: 1 }))]);
    const handle = f.world.units.handle(factory), product = f.world.units.col.buildTarget[factory]!, site = f.world.units.resolve(product), frame = read(f.world);
    const row = Array.from({ length: frame.flowCount }, (_, i) => i).find(i => frame.flowHandle(i) === product)!;
    const raw = frame.flowEffectivePower(row), ratio = frame.ecoRatio(0, frame.flowPriority(row));
    expect(ratio).toBeGreaterThan(0); expect(ratio).toBeLessThan(65536);
    expect(frameFactoryAssistance(frame, handle, product, f.subject).bpEffective).toBe(Math.floor(raw * ratio / 65536) * 10 / 65536);
    assertRates(f.world, frame, f.subject);
    f.bp.massIncomeMilliPerTickCol[f.world.units.col.bp[commander]!] = 0;
    f.world.armies.col.massStored.set(0, 0);
    const done = f.world.units.col.buildDone.get(site);
    step(f.world);
    const stalled = frameFactoryAssistance(read(f.world), handle, product, f.subject);
    expect(stalled.available).toBe(true); expect(stalled.paused).toBe(false); expect(stalled.bpEffective).toBe(0);
    expect(f.world.units.col.buildDone.get(site)).toBe(done);
  });

  it('restore and noncurrent flow ticks stay unavailable until a fresh actual economy phase', () => {
    const f = fixture(); f.spawn('core:cmd_commander', 8, 8); const factory = f.spawn('core:fac_land_t1', 14, 12); f.bank();
    step(f.world, [cmd(f.world, factory, Op.FactoryQueue, encodeFactoryQueue({ bp: f.bp.indexOf('core:lnd_t1_tank'), count: 1 }))]);
    const handle = f.world.units.handle(factory), product = f.world.units.col.buildTarget[factory]!, hash = fullHash(f.world), saved = snapshot(f.world);
    restore(f.world, saved);
    const restored = read(f.world);
    expect(restored.flowTick).toBe(-1); expect(frameFlowConsumers(restored, f.subject)).toEqual([]);
    expect(frameFactoryAssistance(restored, handle, product, f.subject)).toEqual({ available: false, bpAssist: 0, bpEffective: 0, paused: false, helpers: [] });
    expect(fullHash(f.world)).toBe(hash);
    step(f.world);
    const fresh = read(f.world);
    expect(fresh.flowTick).toBe(fresh.tick); expect(frameFactoryAssistance(fresh, handle, product, f.subject).available).toBe(true);
    expect(frameFlowConsumers(fresh, f.subject)).toHaveLength(1);
    const writer = new FrameWriter(), bytes = new Uint8Array(writer.capacityBytes), len = writeFrame(f.world, 0, writer, bytes);
    new DataView(bytes.buffer).setInt32(FH_FLOW_TICK, f.world.tick - 1, true);
    const stale = new FrameReader(); expect(stale.reset(bytes.subarray(0, len))).toBe(true);
    expect(frameFlowConsumers(stale, f.subject)).toEqual([]);
    expect(frameFactoryAssistance(stale, handle, product, f.subject).available).toBe(false);
    expect(fresh.flowFlags(0) & FlowFlags.Contributing).toBeTruthy();
  });
});
