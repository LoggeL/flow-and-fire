import { beforeAll, expect, test } from 'vitest';
import { compileBlueprints, decodeSimBin, defineUnit, type SimBpTable } from '@faf/blueprints';
import { compileContent, loadDefinitions } from '@faf/blueprints/content';
import { asArmyId, asTick, fx, type Handle } from '@faf/fixed';
import { encodeMove, encodeTarget, EventType, FrameReader, FrameWriter, Op, type CommandEnvelope } from '@faf/protocol';
import { createWorld, fullHash, initializeSkirmish, restore, snapshot, step, writeFrame, type World } from '../src/index.ts';
import { spawnUnit } from '../src/units.ts';

let game: SimBpTable;
let crossing: SimBpTable;
beforeAll(async () => {
  game = decodeSimBin((await compileContent({ includeTest: true })).simBin);
  // Only the stress target is new. The game's weapon, projectile and tank definitions stay intact.
  crossing = decodeSimBin(compileBlueprints([
    ...await loadDefinitions(),
    { source: 'test/combat-dodge-fast-target.ts', def: defineUnit({
      id: 'test:combat_fast_target', extends: 'core:cube',
      sim: { motion: { speed: 50, accel: 1000, brake: 1000, turnRateDeg: 3600 } },
    }) },
  ], { includeTest: true }).simBin);
  const originalWeapon = game.weaponIndexOf('core:wpn_cannon_t1');
  const crossingWeapon = crossing.weaponIndexOf('core:wpn_cannon_t1');
  expect(originalWeapon).toBeGreaterThanOrEqual(0);
  expect(crossingWeapon).toBeGreaterThanOrEqual(0);
  for (const column of ['weaponRangeCol', 'weaponDamageCol', 'weaponDamageRadiusCol',
    'weaponMuzzleVelocityCol', 'weaponReloadTicksCol'] as const) {
    expect(crossing[column][crossingWeapon]).toBe(game[column][originalWeapon]);
  }
  const originalProjectile = game.weaponProjectileCol[originalWeapon]!;
  const crossingProjectile = crossing.weaponProjectileCol[crossingWeapon]!;
  for (const column of ['projectileKindCol', 'projectileSpeedCol', 'projectileLifetimeCol'] as const) {
    expect(crossing[column][crossingProjectile]).toBe(game[column][originalProjectile]);
  }
});

const CASES = 100;
const LAUNCH_BOUND = 20;
const FLIGHT_BOUND = 12;
const HEADINGS = [
  { x: 1, z: 0, yaw: 0 }, { x: 0, z: 1, yaw: 16384 },
  { x: -1, z: 0, yaw: 32768 }, { x: 0, z: -1, yaw: 49152 },
] as const;
let seq = 0;
function command(w: World, u: number, op: Op, payload: Uint8Array): CommandEnvelope {
  return { tick: asTick(w.tick + 1), army: asArmyId(w.units.col.army[u]!), seq: ++seq,
    op, flags: 0, units: [w.units.handle(u) as Handle], payload };
}
function hold(w: World, u: number): CommandEnvelope { return command(w, u, Op.FireState, Uint8Array.of(0)); }
function setup(table: SimBpTable): World {
  const w = createWorld({ bpTable: table, seed: 73, armyCount: 2, mapSizeWu: 128 });
  initializeSkirmish(w, { kind: 'skirmish', faction: 0,
    rules: { unitCap: 20, fog: 'revealed', victory: 'annihilation' } });
  // The original commanders remain alive, keeping match rules active without firing into the fixture.
  step(w, [hold(w, 0), hold(w, 1)]);
  expect(w.projectiles.liveCount).toBe(0);
  return w;
}

/** Read the actual observer Frame, with enough capacity for every fixture record. */
class Events {
  private readonly writer = new FrameWriter({ units: 8, parts: 32, projectiles: 8,
    beams: 0, events: 32, debugBytes: 0, eco: 2, footprints: 8 });
  private readonly bytes = new Uint8Array(this.writer.capacityBytes);
  private readonly reader = new FrameReader();
  read(w: World): FrameReader {
    const length = writeFrame(w, -1, this.writer, this.bytes);
    expect(this.writer.dropped).toBe(0);
    expect(this.reader.reset(this.bytes.subarray(0, length))).toBe(true);
    return this.reader;
  }
}
interface Counts { shots: number; impacts: number; targetImpacts: number }
function record(frame: FrameReader, shooter: number, target: number, counts: Counts): void {
  for (let i = 0; i < frame.eventCount; i++) {
    if (frame.eventType(i) === EventType.Shot) {
      expect(frame.eventHandle(i)).toBe(shooter);
      counts.shots++;
    }
    if (frame.eventType(i) === EventType.Impact) {
      counts.impacts++;
      if (frame.eventHandle(i) === target) counts.targetImpacts++;
    }
  }
}

function rate(reactiveDodge: boolean): { shots: number; hits: number; cases: string[] } {
  const w = setup(game), baseline = snapshot(w), events = new Events();
  const tank = game.indexOf('core:lnd_t1_tank');
  // The fastest production target gives a real reactive sidestep without changing its motion/radius.
  const scout = game.indexOf('core:lnd_t1_scout');
  const damage = game.weaponDamageCol[game.weaponIndexOf('core:wpn_cannon_t1')]!;
  const result = { shots: 0, hits: 0, cases: [] as string[] };
  for (let i = 0; i < CASES; i++) {
    restore(w, baseline);
    const distance = [12, 15, 17][i % 3]!;
    const heading = HEADINGS[Math.floor(i / 3) % HEADINGS.length]!;
    const sign = Math.floor(i / 12) % 2 === 0 ? 1 : -1;
    const lateralX = -heading.z * sign, lateralZ = heading.x * sign;
    const lateralYaw = (heading.yaw + sign * 16384 + 65536) % 65536;
    const shooter = spawnUnit(w, tank, 0, fx(64 - heading.x * distance), fx(96 - heading.z * distance), heading.yaw);
    const target = spawnUnit(w, scout, 1, fx(64), fx(96), lateralYaw);
    expect(shooter).toBeGreaterThanOrEqual(0); expect(target).toBeGreaterThanOrEqual(0);
    step(w, [hold(w, shooter), hold(w, target)]);
    const hp = w.units.col.hp[target]!, shooterHandle = w.units.handle(shooter), targetHandle = w.units.handle(target);
    const counts: Counts = { shots: 0, impacts: 0, targetImpacts: 0 };
    for (let tick = 0; tick < LAUNCH_BOUND && counts.shots === 0; tick++) {
      step(w, tick === 0 ? [command(w, shooter, Op.FireState, Uint8Array.of(2)),
        command(w, shooter, Op.Attack, encodeTarget(targetHandle))] : undefined);
      record(events.read(w), shooterHandle, targetHandle, counts);
    }
    expect(counts.shots, `case ${i}: bounded real Shot`).toBe(1);
    expect(w.projectiles.liveCount).toBe(1);
    expect(w.units.col.x[target]).toBe(fx(64)); expect(w.units.col.z[target]).toBe(fx(96));
    const afterShot = i === 0 ? snapshot(w) : undefined;
    // Replay the same envelopes, including their sequence IDs, for the hash comparison.
    const reaction = [hold(w, shooter)];
    if (reactiveDodge) reaction.push(command(w, target, Op.Move,
      encodeMove({ x: fx(64 + lateralX * 20), y: fx(0), z: fx(96 + lateralZ * 20) })));
    const drain = (): Counts => {
      const tail: Counts = { shots: 0, impacts: 0, targetImpacts: 0 };
      for (let tick = 0; tick < FLIGHT_BOUND && w.projectiles.liveCount > 0; tick++) {
        step(w, tick === 0 ? reaction : undefined);
        record(events.read(w), shooterHandle, targetHandle, tail);
      }
      expect(w.projectiles.liveCount, `case ${i}: bounded projectile resolution`).toBe(0);
      return tail;
    };
    const tail = drain();
    // A representative continuation must be identical after restoring the real launch snapshot.
    if (afterShot !== undefined) {
      const hash = fullHash(w);
      restore(w, afterShot);
      expect(drain()).toEqual(tail);
      expect(fullHash(w)).toBe(hash);
    }
    expect(tail.shots).toBe(0);
    expect(counts.impacts + tail.impacts).toBe(1);
    const lost = hp - w.units.col.hp[target]!;
    expect([0, damage]).toContain(lost);
    const hit = lost === damage;
    expect(counts.targetImpacts + tail.targetImpacts).toBe(hit ? 1 : 0);
    const dx = w.units.col.x[target]! - fx(64), dz = w.units.col.z[target]! - fx(96);
    if (reactiveDodge) {
      expect(dx * lateralX + dz * lateralZ, `case ${i}: actual lateral Move`).toBeGreaterThan(0);
      expect(Math.abs(dx * heading.x + dz * heading.z)).toBeLessThanOrEqual(2);
    } else { expect(dx).toBe(0); expect(dz).toBe(0); }
    result.shots += counts.shots + tail.shots;
    result.hits += hit ? 1 : 0;
    result.cases.push(`${i}:range=${distance},yaw=${heading.yaw},side=${sign},hit=${Number(hit)}`);
  }
  return result;
}

test('MS5 unchanged T1 cannon/scout: stationary targets receive at least 90 of 100 actual shots', () => {
  const result = rate(false);
  expect(result.shots).toBe(CASES);
  expect(result.hits, result.cases.join('\n')).toBeGreaterThanOrEqual(CASES * 0.9);
}, 30_000);
test('MS5 unchanged T1 cannon/scout: reactive lateral Move receives at most 50 of the same 100 shots', () => {
  const result = rate(true);
  expect(result.shots).toBe(CASES);
  expect(result.hits, result.cases.join('\n')).toBeLessThanOrEqual(CASES * 0.5);
}, 30_000);

test.each([1, -1])('MS5 Golden: actual 5 WU/tick crossing is swept between disjoint endpoints (side %i)', sign => {
  const w = setup(crossing), events = new Events();
  const shooter = spawnUnit(w, crossing.indexOf('core:lnd_t1_tank'), 0, fx(32), fx(96), 0);
  const target = spawnUnit(w, crossing.indexOf('test:combat_fast_target'), 1, fx(42.5), fx(96 - sign * 10), sign === 1 ? 16384 : 49152);
  step(w, [hold(w, shooter), hold(w, target)]);
  const shooterHandle = w.units.handle(shooter), targetHandle = w.units.handle(target), hp = w.units.col.hp[target]!;
  const counts: Counts = { shots: 0, impacts: 0, targetImpacts: 0 };
  // Return-fire state prevents automatic unit targeting while permitting the ground order.
  step(w, [command(w, shooter, Op.FireState, Uint8Array.of(1)), command(w, shooter, Op.AttackGround,
    encodeMove({ x: fx(47), y: fx(0), z: fx(96) }))]);
  const launch = events.read(w);
  record(launch, shooterHandle, targetHandle, counts);
  expect(counts.shots).toBe(1);
  for (let i = 0; i < launch.eventCount; i++) if (launch.eventType(i) === EventType.Shot) expect(launch.eventAux(i)).toBe(0xffffffff);
  step(w, [hold(w, shooter), command(w, target, Op.Move,
    encodeMove({ x: fx(42.5), y: fx(0), z: fx(96 + sign * 20) }))]);
  record(events.read(w), shooterHandle, targetHandle, counts);
  step(w); record(events.read(w), shooterHandle, targetHandle, counts);
  expect(w.projectiles.liveCount).toBe(1);
  expect(w.units.col.hp[target]).toBe(hp);
  let p = -1;
  for (let row = 0; row < w.projectiles.highWater; row++) if (w.projectiles.isLive(row)) p = row;
  expect(p).toBeGreaterThanOrEqual(0);
  const shellStartX = w.projectiles.col.x[p]!, shellEndX = shellStartX + w.projectiles.col.vx[p]!;
  expect([shellStartX, shellEndX]).toEqual([fx(41), fx(44)]);
  step(w);
  const impactFrame = events.read(w);
  record(impactFrame, shooterHandle, targetHandle, counts);
  expect(w.units.col.x[target]).toBe(fx(42.5));
  expect(w.units.col.z[target]! - w.units.col.pz[target]!).toBe(sign * fx(5));
  const radius = crossing.radiusCol[crossing.indexOf('test:combat_fast_target')]!;
  expect(Math.abs(w.units.col.pz[target]! - fx(96))).toBeGreaterThan(radius);
  expect(Math.abs(w.units.col.z[target]! - fx(96))).toBeGreaterThan(radius);
  expect(w.units.col.x[target]!).toBeGreaterThan(shellStartX);
  expect(w.units.col.x[target]!).toBeLessThan(shellEndX);
  const damage = crossing.weaponDamageCol[crossing.weaponIndexOf('core:wpn_cannon_t1')]!;
  expect(w.units.col.hp[target]).toBe(hp - damage);
  expect(counts).toEqual({ shots: 1, impacts: 1, targetImpacts: 1 });
  expect(w.projectiles.liveCount).toBe(0);
  for (let i = 0; i < impactFrame.eventCount; i++) if (impactFrame.eventType(i) === EventType.Impact) {
    expect(impactFrame.eventHandle(i)).toBe(targetHandle);
    expect(impactFrame.eventPos(i, 0)).toBe(fx(42.5));
    expect(impactFrame.eventPos(i, 2)).toBe(fx(96));
  }
});
