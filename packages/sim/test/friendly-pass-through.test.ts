import { beforeAll, expect, test } from 'vitest';
import { compileContent } from '@faf/blueprints/content';
import { decodeSimBin, type SimBpTable } from '@faf/blueprints/simbin';
import { asArmyId, asTick, fx, type Handle } from '@faf/fixed';
import { createTestPlaneMap, mapSimData } from '@faf/formats';
import { encodeTarget, EventType, FrameReader, FrameWriter, Op, type CommandEnvelope } from '@faf/protocol';
import { createWorld, fullHash, initializeSkirmish, restore, setAlliance, snapshot, step, writeFrame, type World } from '../src/index.ts';
import { killUnit, spawnUnit } from '../src/units.ts';

let bp: SimBpTable;
beforeAll(async () => { bp = decodeSimBin((await compileContent({ includeTest: true })).simBin); });
let seq = 0;
function command(w: World, unit: number, op: Op, payload: Uint8Array): CommandEnvelope {
  return { tick: asTick(w.tick + 1), army: asArmyId(w.units.col.army[unit]!), seq: ++seq,
    op, flags: 0, units: [w.units.handle(unit) as Handle], payload };
}
function hold(w: World, unit: number): CommandEnvelope { return command(w, unit, Op.FireState, Uint8Array.of(0)); }
function world(): World {
  const map = { ...mapSimData(createTestPlaneMap(128)), starts: [
    { army: 0, x: fx(8), z: fx(8) }, { army: 1, x: fx(116), z: fx(8) },
    { army: 2, x: fx(8), z: fx(116) },
  ] };
  const w = createWorld({ bpTable: bp, seed: 73, armyCount: 3, map });
  initializeSkirmish(w, { kind: 'skirmish', faction: 0,
    rules: { unitCap: 30, fog: 'revealed', victory: 'annihilation' } });
  setAlliance(w, 0, 2, true);
  step(w, [hold(w, 0), hold(w, 1), hold(w, 2)]);
  return w;
}
function spawn(w: World, id: string, army: number, x: number, z = 96): number {
  const u = spawnUnit(w, bp.indexOf(id), army, fx(x), fx(z), 0);
  expect(u).toBeGreaterThanOrEqual(0);
  return u;
}
function events(w: World): FrameReader {
  const writer = new FrameWriter(), bytes = new Uint8Array(writer.capacityBytes);
  const n = writeFrame(w, -1, writer, bytes), reader = new FrameReader();
  expect(reader.reset(bytes.subarray(0, n))).toBe(true);
  return reader;
}
function launch(w: World, shooter: number, target: number, op: Op = Op.Attack): void {
  for (let n = 0; n < 30 && w.projectiles.liveCount === 0; n++) {
    step(w, n === 0 ? [command(w, shooter, Op.FireState, Uint8Array.of(op === Op.Overcharge ? 0 : 2)),
      command(w, shooter, op, encodeTarget(w.units.handle(target)))] : undefined);
  }
  expect(w.projectiles.liveCount).toBe(1);
}
function drain(w: World, stop: CommandEnvelope[]): number[] {
  const impacts: number[] = [];
  for (let n = 0; n < 45 && w.projectiles.liveCount > 0; n++) {
    step(w, n === 0 ? stop : undefined);
    const f = events(w);
    for (let e = 0; e < f.eventCount; e++) if (f.eventType(e) === EventType.Impact) impacts.push(f.eventHandle(e));
  }
  expect(w.projectiles.liveCount).toBe(0);
  return impacts;
}

// The original weapon, hitboxes, movement, projectile flight and impact events are used unchanged.
test.each(['core:lnd_t1_tank', 'core:fac_land_t1'])('actual cannon passes through own and teammate %s to damage the enemy behind them', blocker => {
  const w = world(), shooter = spawn(w, 'core:lnd_t1_tank', 0, 32);
  const own = spawn(w, blocker, 0, 37), ally = spawn(w, blocker, 2, 42);
  const enemy = spawn(w, 'core:str_t1_mex', 1, 48);
  step(w, [hold(w, shooter), hold(w, own), hold(w, ally)]);
  const hp = [own, ally, enemy].map(u => w.units.col.hp[u]!);
  launch(w, shooter, enemy);
  const impacts = drain(w, [hold(w, shooter)]);
  expect(w.units.col.hp[own]).toBe(hp[0]); expect(w.units.col.hp[ally]).toBe(hp[1]);
  expect(w.units.col.hp[enemy]).toBe(hp[2]! - 30);
  expect(impacts).toEqual([w.units.handle(enemy)]);
});

test('the nearest hostile unit still intercepts a shot aimed behind it', () => {
  const w = world(), shooter = spawn(w, 'core:lnd_t1_tank', 0, 32);
  const enemyBlocker = spawn(w, 'core:str_t1_mex', 1, 40), target = spawn(w, 'core:str_t1_mex', 1, 48);
  step(w, [hold(w, shooter)]); const hp = [enemyBlocker, target].map(u => w.units.col.hp[u]!);
  launch(w, shooter, target);
  expect(drain(w, [hold(w, shooter)])).toEqual([w.units.handle(enemyBlocker)]);
  expect(w.units.col.hp[enemyBlocker]).toBe(hp[0]! - 30); expect(w.units.col.hp[target]).toBe(hp[1]);
});

test.each(['core:lnd_t1_arty', 'core:cmd_commander'])('actual %s area impact damages enemies without harming own or allied neighbors', id => {
  const w = world(), shooter = spawn(w, id, 0, 32);
  spawn(w, 'core:str_t1_estorage', 0, 20, 80);
  const own = spawn(w, 'core:str_t1_mex', 0, 48, 97), ally = spawn(w, 'core:str_t1_mex', 2, 49);
  const target = spawn(w, 'core:str_t1_mex', 1, 48), neighbor = spawn(w, 'core:str_t1_mex', 1, 48, 95);
  step(w, [hold(w, shooter)]);
  const hp = [own, ally, target, neighbor].map(u => w.units.col.hp[u]!);
  if (id === 'core:cmd_commander') w.armies.col.energyStored.set(0, 8800000);
  launch(w, shooter, target, id === 'core:cmd_commander' ? Op.Overcharge : Op.Attack);
  drain(w, [hold(w, shooter)]);
  expect(w.units.col.hp[own]).toBe(hp[0]); expect(w.units.col.hp[ally]).toBe(hp[1]);
  expect(w.units.col.hp[target]).toBeLessThan(hp[2]!); expect(w.units.col.hp[neighbor]).toBeLessThan(hp[3]!);
});

test('in-flight allegiance survives source death and snapshot continuation exactly', () => {
  const w = world(), shooter = spawn(w, 'core:lnd_t1_tank', 0, 32);
  const own = spawn(w, 'core:fac_land_t1', 0, 40), ally = spawn(w, 'core:lnd_t1_tank', 2, 44);
  const target = spawn(w, 'core:str_t1_mex', 1, 48);
  step(w, [hold(w, shooter), hold(w, ally)]); launch(w, shooter, target);
  const saved = snapshot(w), hp = [own, ally, target].map(u => w.units.col.hp[u]!);
  const continued = () => { killUnit(w, shooter); const impacts = drain(w, []); return { impacts, hash: fullHash(w) }; };
  const first = continued(); restore(w, saved); expect(continued()).toEqual(first);
  expect(w.units.col.hp[own]).toBe(hp[0]); expect(w.units.col.hp[ally]).toBe(hp[1]);
  expect(w.units.col.hp[target]).toBe(hp[2]! - 30);
  expect(first.impacts).toEqual([w.units.handle(target)]);
});
