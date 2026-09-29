import { asArmyId, asHandle, asTick, fx, handleGen, handleIndex, makeHandle } from '@faf/fixed';
import { encodeCheatSpawn, Op } from '@faf/protocol';
import { describe, expect, it } from 'vitest';
import {
  ARRIVE_TOLERANCE,
  armyUnitCount,
  createWorld,
  isAllied,
  isUnitAlive,
  lastAckSeq,
  setAlliance,
  step,
  unitCount,
  unitHandles,
  unitInfo,
  UnitState,
  type World,
} from '../src/index.ts';
import { batch, gameTable, killCmd, moveCmd, spawnCmd, stopCmd, testTable } from './support/fixtures.ts';

function world(armyCount = 2, unitCapPerArmy?: number): World {
  return createWorld({ bpTable: gameTable(), seed: 1234, armyCount, ...(unitCapPerArmy === undefined ? {} : { unitCapPerArmy }) });
}

function run(w: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) step(w);
}

describe('CommandApply', () => {
  it('Cheat Spawn creates units around (x, z) within the spread, clamped to the map', () => {
    const w = world();
    step(w, [spawnCmd(0, 50, 100, 100, 5), spawnCmd(1, 3, 0, 0, 10, 0, 1)]);
    expect(unitCount(w)).toBe(53);
    expect(armyUnitCount(w, 0)).toBe(50);
    expect(armyUnitCount(w, 1)).toBe(3);
    for (const h of unitHandles(w, 0)) {
      const u = unitInfo(w, h)!;
      const dx = u.x - fx(100);
      const dz = u.z - fx(100);
      // Spawn spread plus at most one tick of separation push.
      expect(Math.sqrt(dx * dx + dz * dz)).toBeLessThanOrEqual(fx(5) + fx(0.3));
      expect(u.hp).toBe(100);
      expect(u.state).toBe(UnitState.Idle);
      expect(u.bp).toBe(0);
    }
    for (const h of unitHandles(w, 1)) {
      const u = unitInfo(w, h)!;
      expect(u.x).toBeGreaterThanOrEqual(0);
      expect(u.z).toBeGreaterThanOrEqual(0);
    }
    // Invalid blueprint or inactive army: nothing happens.
    step(w, [spawnCmd(0, 5, 10, 10, 1, 7), spawnCmd(5, 5, 10, 10, 1, 0, 0)]);
    expect(unitCount(w)).toBe(53);
  });

  it('Move drives a cube to its target; it arrives within the tolerance and becomes idle', () => {
    const w = world();
    step(w, [spawnCmd(0, 1, 50, 50, 0)]);
    const [h] = unitHandles(w);
    step(w, [moveCmd(0, [h!], 60, 50)]);
    expect(unitInfo(w, h!)!.moving).toBe(true);
    expect(unitInfo(w, h!)!.state).toBe(UnitState.Moving);
    let arrivedAt = -1;
    for (let t = 0; t < 200 && arrivedAt < 0; t++) {
      step(w);
      if (!unitInfo(w, h!)!.moving) arrivedAt = w.tick;
    }
    const u = unitInfo(w, h!)!;
    expect(arrivedAt).toBeGreaterThan(0);
    // 10 WU at 3 WU/s (plus turning/accel) ≈ 4–6 s = 40–60 ticks.
    expect(arrivedAt).toBeLessThan(80);
    expect(u.state).toBe(UnitState.Idle);
    const dx = u.x - fx(60);
    const dz = u.z - fx(50);
    expect(dx * dx + dz * dz).toBeLessThanOrEqual(ARRIVE_TOLERANCE * ARRIVE_TOLERANCE);
    // Facing +x (yaw ≈ 0) after driving along +x.
    expect(Math.min(u.yaw, 65536 - u.yaw)).toBeLessThan(600);
    run(w, 5);
    expect(unitInfo(w, h!)!.speed).toBe(0);
  });

  it('turns towards the target with the blueprint turn rate before accelerating', () => {
    const w = world();
    step(w, [spawnCmd(0, 1, 50, 50, 0)]);
    const [h] = unitHandles(w);
    const yaw0 = unitInfo(w, h!)!.yaw;
    // Target behind the current heading.
    const back = (yaw0 / 65536) * 2 * Math.PI + Math.PI;
    step(w, [moveCmd(0, [h!], 50 + 20 * Math.cos(back), 50 + 20 * Math.sin(back))]);
    const u = unitInfo(w, h!)!;
    const turned = Math.abs((((u.yaw - yaw0) << 16) >> 16));
    expect(turned).toBe(gameTable().turnRatePerTick(0));
    expect(u.speed).toBe(0); // heading error ≥ 90° ⇒ no forward speed yet
  });

  it('Stop halts a moving unit (decelerating) and keeps it idle', () => {
    const w = world();
    step(w, [spawnCmd(0, 1, 50, 50, 0)]);
    const [h] = unitHandles(w);
    step(w, [moveCmd(0, [h!], 150, 50)]);
    run(w, 30);
    expect(unitInfo(w, h!)!.speed).toBeGreaterThan(0);
    step(w, [stopCmd(0, [h!])]);
    expect(unitInfo(w, h!)!.state).toBe(UnitState.Idle);
    run(w, 20);
    const u = unitInfo(w, h!)!;
    expect(u.speed).toBe(0);
    expect(u.moving).toBe(false);
    const x = u.x;
    run(w, 10);
    expect(unitInfo(w, h!)!.x).toBe(x);
  });

  it('a foreign army cannot command units', () => {
    const w = world();
    step(w, [spawnCmd(0, 1, 50, 50, 0)]);
    const [h] = unitHandles(w, 0);
    step(w, [moveCmd(1, [h!], 100, 100)]);
    expect(unitInfo(w, h!)!.moving).toBe(false);
    run(w, 20);
    expect(unitInfo(w, h!)!.x).toBe(unitInfo(w, h!)!.px);
    // Army 1's command was still processed (acknowledged).
    expect(lastAckSeq(w, 1)).toBeGreaterThan(0);
  });

  it('stale handles are ignored; Kill frees the slot, which is reused FIFO with a new generation', () => {
    const w = world();
    step(w, [spawnCmd(0, 3, 50, 50, 2)]);
    const [a, b, c] = unitHandles(w);
    step(w, [killCmd(0, [b!, a!])]);
    expect(isUnitAlive(w, a!)).toBe(false);
    expect(isUnitAlive(w, b!)).toBe(false);
    expect(isUnitAlive(w, c!)).toBe(true);
    expect(unitCount(w)).toBe(1);
    expect(armyUnitCount(w, 0)).toBe(1);
    // Freed in ascending slot order (Cleanup), reused FIFO: first a's slot, then b's.
    step(w, [spawnCmd(0, 2, 60, 60, 1)]);
    const fresh = unitHandles(w).filter((h) => h !== c);
    expect(fresh.map((h) => handleIndex(h))).toEqual([handleIndex(a!), handleIndex(b!)]);
    expect(fresh.map((h) => handleGen(h))).toEqual([handleGen(a!) + 1, handleGen(b!) + 1]);
    // The old handle of slot a must not command the new occupant.
    step(w, [moveCmd(0, [a!], 200, 200)]);
    expect(unitInfo(w, fresh[0]!)!.moving).toBe(false);
    expect(unitInfo(w, a!)).toBeNull();
    // A handle to a never-allocated slot and HANDLE_NONE are ignored as well.
    step(w, [moveCmd(0, [asHandle(0xffffffff), makeHandle(4000, 0)], 10, 10), killCmd(0, [makeHandle(4000, 0)])]);
    expect(unitCount(w)).toBe(3);
  });

  it('applies commands in (army, seq) order independent of arrival order', () => {
    const w = world();
    step(w, [spawnCmd(0, 1, 50, 50, 0, 0, 0, 1)]);
    const [h] = unitHandles(w);
    // seq 11 (later) arrives first, seq 10 second: the target of seq 11 must win.
    step(w, [moveCmd(0, [h!], 90, 50, 11), moveCmd(0, [h!], 10, 50, 10)]);
    expect(unitInfo(w, h!)!.targetX).toBe(fx(90));
    expect(lastAckSeq(w, 0)).toBe(11);
    // The Queue flag replaces the order in MS1.
    step(w, [moveCmd(0, [h!], 70, 70, 12, 1)]);
    expect(unitInfo(w, h!)!.targetX).toBe(fx(70));
  });

  it('drops unknown ops and malformed payloads but acknowledges them', () => {
    const w = world();
    step(w, [spawnCmd(0, 1, 50, 50, 0, 0, 0, 1)]);
    const [h] = unitHandles(w);
    const unknown = { tick: asTick(0), army: asArmyId(0), seq: 2, op: Op.Build, flags: 0, units: [h!], payload: new Uint8Array(3) };
    const badMove = { ...moveCmd(0, [h!], 1, 1, 3), payload: new Uint8Array(5) };
    const badCheat = { tick: asTick(0), army: asArmyId(0), seq: 4, op: Op.Cheat, flags: 0, units: [], payload: Uint8Array.of(99) };
    const shortSpawn = { ...badCheat, seq: 5, payload: encodeCheatSpawn({ bp: 0, army: 0, count: 5, x: fx(1), z: fx(1), spread: fx(0) }).slice(0, 10) };
    step(w, batch([unknown, badMove, badCheat, shortSpawn]));
    expect(unitInfo(w, h!)!.moving).toBe(false);
    expect(unitCount(w)).toBe(1);
    expect(lastAckSeq(w, 0)).toBe(5);
    expect(lastAckSeq(w, 1)).toBe(-1);
  });

  it('enforces the per-army unit cap and the table capacity', () => {
    const w = world(2, 10);
    step(w, [spawnCmd(0, 25, 50, 50, 5), spawnCmd(1, 4, 80, 80, 2, 0, 1)]);
    expect(armyUnitCount(w, 0)).toBe(10);
    expect(armyUnitCount(w, 1)).toBe(4);
    const big = world(1);
    step(big, [spawnCmd(0, 5000, 256, 256, 200), spawnCmd(0, 5000, 256, 256, 200)]);
    expect(unitCount(big)).toBe(8192);
    step(big, [spawnCmd(0, 1, 256, 256, 0)]);
    expect(unitCount(big)).toBe(8192);
  });

  it('keeps positions inside the map and supports blueprints with other speeds', () => {
    const w = createWorld({ bpTable: testTable(), seed: 9, armyCount: 1, mapSizeWu: 64 });
    step(w, [spawnCmd(0, 1, 60, 60, 0, 1)]);
    const [h] = unitHandles(w);
    step(w, [moveCmd(0, [h!], 500, 500)]); // clamped to the map corner
    expect(unitInfo(w, h!)!.targetX).toBe(fx(64));
    run(w, 100);
    const u = unitInfo(w, h!)!;
    expect(u.x).toBeLessThanOrEqual(fx(64));
    expect(u.z).toBeLessThanOrEqual(fx(64));
    expect(u.moving).toBe(false);
  });

  it('crowds sent to one point settle (arrival contagion) and separate without overlap', () => {
    const w = world();
    step(w, [spawnCmd(0, 60, 100, 100, 15)]);
    const hs = unitHandles(w);
    step(w, [moveCmd(0, hs, 150, 100)]);
    run(w, 400);
    const infos = hs.map((h) => unitInfo(w, h)!);
    expect(infos.every((u) => !u.moving)).toBe(true);
    let minD2 = Infinity;
    for (let i = 0; i < infos.length; i++) {
      for (let j = i + 1; j < infos.length; j++) {
        const dx = infos[i]!.x - infos[j]!.x;
        const dz = infos[i]!.z - infos[j]!.z;
        minD2 = Math.min(minD2, dx * dx + dz * dz);
      }
    }
    // Radius 0.3 WU each ⇒ centers ≥ ~0.6 WU apart (small residual overlap tolerated).
    expect(Math.sqrt(minD2)).toBeGreaterThan(fx(0.5));
    // All within a compact clump around the target.
    for (const u of infos) expect(Math.hypot(u.x - fx(150), u.z - fx(100))).toBeLessThan(fx(8));
  });
});

describe('armies (G11)', () => {
  it('has 16 rows, FFA alliances with self allied, and symmetric setup-time alliances', () => {
    const w = world(4);
    expect(w.armyCount).toBe(4);
    for (let a = 0; a < 16; a++) expect(isAllied(w, a, a)).toBe(true);
    expect(isAllied(w, 0, 1)).toBe(false);
    setAlliance(w, 0, 2, true);
    expect(isAllied(w, 0, 2)).toBe(true);
    expect(isAllied(w, 2, 0)).toBe(true);
    expect(() => setAlliance(w, 1, 1, false)).toThrow(/always allied/);
    expect(w.armies.liveCount).toBe(16);
    expect(Array.from(w.armies.col.active)).toEqual([1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('validates createWorld options', () => {
    expect(() => createWorld({ bpTable: gameTable(), seed: 1, armyCount: 0 })).toThrow(/armyCount/);
    expect(() => createWorld({ bpTable: gameTable(), seed: 1, armyCount: 17 })).toThrow(/armyCount/);
    expect(() => createWorld({ bpTable: gameTable(), seed: 1, armyCount: 2, mapSizeWu: 100 })).toThrow(/mapSizeWu/);
    expect(() => createWorld({ seed: 1, armyCount: 2 })).toThrow(/simBin or bpTable/);
  });
});
