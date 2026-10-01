import { asArmyId, asTick, fx, type Handle } from '@faf/fixed';
import { createAlertsSection } from '@faf/hud';
import { encodeBuild, encodeTarget, EventType, FrameReader, FrameWriter, Op, type CommandEnvelope } from '@faf/protocol';
import { createWorld, fullHash, initializeSkirmish, restore, snapshot, spawnUnit, step, writeFrame, type World } from '../../../packages/sim/src/index.ts';
import { describe, expect, it } from 'vitest';
import { gameTable } from '../../../packages/sim/test/support/fixtures.ts';
import { FrameHudAlerts } from '../src/hud/alerts.ts';

let sequence = 0;
function fixture(combat = false) {
  const bp = gameTable(), world = createWorld({ bpTable: bp, seed: 47, armyCount: 2, mapSizeWu: 64 });
  if (combat) initializeSkirmish(world, { kind: 'skirmish', faction: 0, rules: { unitCap: 30, fog: 'revealed', victory: 'annihilation' } });
  const section = createAlertsSection();
  const alerts = new FrameHudAlerts(section, index => ({ typeId: bp.ids[index]!, commander: bp.ids[index] === 'core:cmd_commander', structure: bp.ids[index]!.startsWith('core:str_') || bp.ids[index] === 'core:fac_land_t1' }), 64);
  const spawn = (id: string, x = 10, z = 10, army = 0) => spawnUnit(world, bp.indexOf(id), army, fx(x), fx(z), 0);
  return { bp, world, section, alerts, spawn };
}
function cmd(world: World, unit: number, op: Op, payload: Uint8Array): CommandEnvelope {
  return { tick: asTick(0), army: asArmyId(world.units.col.army[unit]!), seq: ++sequence, op, flags: 0,
    units: [world.units.handle(unit) as Handle], payload };
}
function frame(world: World, viewer = 0) {
  const writer = new FrameWriter(), bytes = new Uint8Array(writer.capacityBytes), reader = new FrameReader();
  expect(reader.reset(bytes.subarray(0, writeFrame(world, viewer, writer, bytes)))).toBe(true);
  return reader;
}
function eventIndices(frame: FrameReader, type: number) {
  return Array.from({ length: frame.eventCount }, (_, i) => i).filter(i => frame.eventType(i) === type);
}

describe('authoritative Frame HUD alerts', () => {
  it('presents actual rising stall/overflow events once, filtering the relevant army', () => {
    const f = fixture(), builder = f.spawn('core:cmd_commander'); f.spawn('core:cmd_commander', 50, 50, 1);
    step(f.world, [cmd(f.world, builder, Op.Build, encodeBuild({ bp: f.bp.indexOf('core:str_t1_pgen'), yaw: 0, x: fx(14), z: fx(10) }))]);
    const current = frame(f.world), before = fullHash(f.world);
    expect(eventIndices(current, EventType.MassStall)).toHaveLength(1);
    expect(eventIndices(current, EventType.EnergyStall)).toHaveLength(1);
    f.alerts.present(current, 0);
    expect(f.section.items.peek().map(item => item.type).sort()).toEqual(['energyStall', 'massStall']);
    expect(f.section.items.peek().every(item => item.location === null && item.flow! < 1)).toBe(true);
    f.alerts.present(current, 0); f.alerts.present(frame(f.world), 0);
    expect(f.section.items.peek().every(item => item.count === 1)).toBe(true);
    expect(fullHash(f.world)).toBe(before);
    step(f.world);
    expect(eventIndices(frame(f.world), EventType.MassStall)).toHaveLength(0);

    const overflow = fixture(); initializeSkirmish(overflow.world); step(overflow.world);
    const observed = frame(overflow.world, -1);
    expect(eventIndices(observed, EventType.StorageFull)).toHaveLength(4);
    overflow.alerts.present(observed, 0);
    expect(overflow.section.items.peek()).toEqual([expect.objectContaining({ type: 'storageFull', count: 2, location: null })]);
    overflow.alerts.present(observed, 0);
    expect(overflow.section.items.peek()[0]!.count).toBe(2);
    // The observer's selected army changes without changing the frame's viewer (-1).
    overflow.alerts.present(observed, 1);
    expect(overflow.section.items.peek()).toEqual([expect.objectContaining({ type: 'storageFull', count: 2, id: 1 })]);
  });

  it('build completion carries the actual subject/location and replay rewind clears future alerts', () => {
    const f = fixture(), builder = f.spawn('core:cmd_commander');
    f.world.armies.col.massStored.set(0, 650000); f.world.armies.col.energyStored.set(0, 3900000);
    const start = snapshot(f.world);
    step(f.world, [cmd(f.world, builder, Op.Build, encodeBuild({ bp: f.bp.indexOf('core:str_t1_pgen'), yaw: 0, x: fx(14), z: fx(10) }))]);
    let completed: FrameReader | null = null;
    for (let tick = 0; tick < 150 && completed === null; tick++) {
      const current = frame(f.world); f.alerts.present(current, 0);
      if (eventIndices(current, EventType.BuildComplete).length) completed = current;
      else step(f.world);
    }
    expect(completed).not.toBeNull();
    const item = f.section.items.peek().find(item => item.type === 'buildComplete')!;
    expect(item).toMatchObject({ count: 1, subjectTypeId: 'core:str_t1_pgen', location: { x: 14, z: 10 }, region: 'northWest' });
    expect(f.alerts.find(item.id)).toBe(item);
    f.alerts.present(completed!, 0); expect(f.alerts.find(item.id)?.count).toBe(1);
    restore(f.world, start); f.alerts.present(frame(f.world), 0);
    expect(f.section.items.peek()).toEqual([]); expect(f.section.historyCount.peek()).toBe(0); expect(f.alerts.find(item.id)).toBeUndefined();
  });

  it.each([
    ['core:cmd_commander', 'commanderDanger'],
    ['core:fac_land_t1', 'baseAttacked'],
    ['core:lnd_t2_tank', 'unitAttacked'],
  ])('presents real projectile damage to %s as %s with the impact location', (id, type) => {
    const f = fixture(true), target = f.spawn(id, 20, 20), enemy = f.spawn('core:lnd_t1_tank', 26, 20, 1);
    step(f.world, [cmd(f.world, target, Op.FireState, Uint8Array.of(0)), cmd(f.world, 0, Op.FireState, Uint8Array.of(0)),
      cmd(f.world, 1, Op.FireState, Uint8Array.of(0)), cmd(f.world, enemy, Op.Attack, encodeTarget(f.world.units.handle(target)))]);
    let impact: FrameReader | null = null, index = -1;
    for (let ticks = 0; ticks < 35 && impact === null; ticks++) {
      const current = frame(f.world);
      index = eventIndices(current, EventType.Impact).find(i => current.eventHandle(i) === f.world.units.handle(target)) ?? -1;
      f.alerts.present(current, 0);
      if (index >= 0) impact = current; else step(f.world);
    }
    expect(impact).not.toBeNull(); expect(f.world.units.col.hp[target]).toBeLessThan(f.bp.maxHp(f.world.units.col.bp[target]!));
    const item = f.section.items.peek().find(item => item.type === type)!;
    expect(item).toMatchObject({ count: 1, subjectTypeId: id, location: { x: impact!.eventPos(index, 0) / 4096, z: impact!.eventPos(index, 2) / 4096 } });
    f.alerts.present(impact!, 0); expect(f.alerts.find(item.id)?.count).toBe(1);
    // Viewer change cannot retain the other army's danger/location history.
    f.alerts.present(frame(f.world, 1), 1);
    expect(f.section.items.peek().some(item => item.subjectTypeId === id)).toBe(false);
  });

  it('expired actual alerts retain jump locations and can be cycled in history', () => {
    const f = fixture(), builder = f.spawn('core:cmd_commander');
    f.world.armies.col.massStored.set(0, 650000); f.world.armies.col.energyStored.set(0, 3900000);
    step(f.world, [cmd(f.world, builder, Op.Build, encodeBuild({ bp: f.bp.indexOf('core:str_t1_pgen'), yaw: 0, x: fx(14), z: fx(10) }))]);
    let id = -1;
    for (let tick = 0; tick < 150 && id < 0; tick++) {
      f.alerts.present(frame(f.world), 0);
      id = f.section.items.peek().find(item => item.type === 'buildComplete')?.id ?? -1;
      if (id < 0) step(f.world);
    }
    expect(id).toBeGreaterThan(0);
    for (let tick = 0; tick < 601; tick++) step(f.world);
    f.alerts.present(frame(f.world), 0);
    expect(f.section.historyCount.peek()).toBeGreaterThan(0);
    expect(f.section.items.peek().some(item => item.id === id)).toBe(false);
    expect(f.alerts.find(id)?.location).toEqual({ x: 14, z: 10 });
    const cycled = Array.from({ length: f.section.historyCount.peek() + 2 }, () => f.alerts.cycle());
    expect(cycled.some(item => item?.id === id && item.location?.x === 14)).toBe(true);
  });
});
