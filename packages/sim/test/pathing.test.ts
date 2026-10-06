/**
 * MS3 pathing in the sim (M5/M6 integration, PLAN §3.8): one request per group order, single
 * requests, short paths without search, unreachable targets, footprint cheat with corridor repath,
 * units evicted from fresh footprints, the stuck chain, collisions at one point, start-up within
 * 10 ticks, offsets of group moves, snapshot/restore in the middle of paths and queues.
 */
import { describe, expect, it } from 'vitest';
import { asArmyId, asTick, FX_ONE, type Handle } from '@faf/fixed';
import { PATH_DIRECT } from '@faf/nav';
import { CmdFlags, encodeCheatFootprint, Op, type CommandEnvelope } from '@faf/protocol';
import {
  createWorld,
  fullHash,
  MoverBits,
  offsetX,
  offsetZ,
  pathStats,
  restore,
  ruleHash,
  snapshot,
  spawnRejectedCount,
  step,
  unitClass,
  unitHandles,
  unitInfo,
  type World,
} from '../src/index.ts';
import { gameTable, moveCmd, nextSeq, spawnCmd, stopCmd } from './support/fixtures.ts';
import { hollowRidgeSim } from './support/maps.ts';

const TANK = 4; // core:lnd_t1_tank (class 1)
const T2 = 5; // core:lnd_t2_tank (class 2)
const T3 = 6; // core:lnd_t3_heavy (class 3)

function footprintCmd(army: number, x: number, z: number, w: number, h: number, delta: 1 | -1 = 1, seq = nextSeq(army)): CommandEnvelope {
  return { tick: asTick(0), army: asArmyId(army), seq, op: Op.Cheat, flags: 0, units: [], payload: encodeCheatFootprint({ cellX: x, cellZ: z, w, h, delta }) };
}

function run(w: World, n: number, each?: () => void): void {
  for (let i = 0; i < n; i++) {
    step(w);
    each?.();
  }
}

/** Throws if a land unit stands on a nav cell not passable for its class. */
function checkPassable(w: World): void {
  const U = w.units.col;
  for (let i = 0; i < w.units.highWater; i++) {
    if (w.units.alive[i] !== 1) continue;
    const c = w.navClear[((U.z[i]! >> 12) << w.navShift) | (U.x[i]! >> 12)]!;
    if (c < unitClass(w, i)) throw new Error(`tick ${w.tick}: slot ${i} on a blocked cell (${U.x[i]! / FX_ONE}, ${U.z[i]! / FX_ONE})`);
  }
}

/** Spawns units one by one at exact positions (a block with `spacing` WU) and returns the handles. */
function block(w: World, bp: (i: number) => number, n: number, x0: number, z0: number, cols: number, spacing: number, army = 0): Handle[] {
  const before = new Set(unitHandles(w, army));
  const cmds: CommandEnvelope[] = [];
  for (let i = 0; i < n; i++) cmds.push(spawnCmd(army, 1, x0 + (i % cols) * spacing, z0 + Math.floor(i / cols) * spacing, 0, bp(i)));
  step(w, cmds);
  return unitHandles(w, army).filter((h) => !before.has(h));
}

describe('path requests (M6 integration)', () => {
  it('a group order issues exactly one request, a single move one, a short move needs no search', () => {
    const w = createWorld({ bpTable: gameTable(), seed: 1, armyCount: 2, map: hollowRidgeSim() });
    const g = block(w, (i) => [TANK, T2, T3][i % 3]!, 30, 100, 100, 6, 3.2);
    expect(g.length).toBe(30);
    const r0 = pathStats(w).requestsIssued;
    step(w, [moveCmd(0, g, 400, 400)]);
    expect(pathStats(w).requestsIssued - r0).toBe(1);
    // The group path is planned for the largest class of the group.
    const p = unitInfo(w, g[0]!)!.path;
    expect(w.nav.pathClass(p)).toBe(3);
    for (const h of g) expect(unitInfo(w, h)!.path).toBe(p);
    // Single move: one request of its own.
    const [single] = block(w, () => TANK, 1, 90, 120, 1, 1);
    const r1 = pathStats(w).requestsIssued;
    step(w, [moveCmd(0, [single!], 400, 120)]);
    expect(pathStats(w).requestsIssued - r1).toBe(1);
    // Short move in free LOS: Direct path, one expansion counted, no A*/HPA*.
    const [near] = block(w, () => TANK, 1, 120, 90, 1, 1);
    const r2 = pathStats(w).requestsIssued;
    const e2 = w.nav.expansionsTotal;
    step(w, [moveCmd(0, [near!], 128, 96)]);
    expect(pathStats(w).requestsIssued - r2).toBe(1);
    const pn = unitInfo(w, near!)!.path;
    expect(w.nav.pathState(pn)).toBe(PATH_DIRECT);
    expect(w.nav.expansionsTotal - e2).toBe(1);
  });

  it('units drive off before their path is ready and all of them start within 10 ticks', () => {
    const w = createWorld({ bpTable: gameTable(), seed: 2, armyCount: 2, map: hollowRidgeSim() });
    const g = block(w, (i) => [TANK, TANK, T2, T3][i % 4]!, 200, 80, 80, 20, 2.6);
    expect(g.length).toBeGreaterThan(190);
    const p0 = g.map((h) => [unitInfo(w, h)!.x, unitInfo(w, h)!.z, unitInfo(w, h)!.yaw] as const);
    step(w, [moveCmd(0, g, 402, 402)]);
    const started = new Int32Array(g.length).fill(-1);
    for (let t = 1; t <= 10; t++) {
      if (t > 1) step(w);
      g.forEach((h, i) => {
        const u = unitInfo(w, h)!;
        if (started[i]! < 0 && (u.x !== p0[i]![0] || u.z !== p0[i]![1])) started[i] = t;
      });
    }
    const late = g.filter((_, i) => started[i]! < 0).length;
    expect(late, 'units without a position change within 10 ticks').toBe(0);
    expect(Math.max(...started)).toBeLessThanOrEqual(10);
  });

  it('an unreachable target is replaced by the nearest reachable point (retargeted)', () => {
    const w = createWorld({ bpTable: gameTable(), seed: 3, armyCount: 2, mapSizeWu: 128 });
    // A closed 20×20 box of footprints (four walls): its inside is a separate component.
    step(w, [footprintCmd(0, 50, 50, 20, 2), footprintCmd(0, 50, 68, 20, 2), footprintCmd(0, 50, 52, 2, 16), footprintCmd(0, 68, 52, 2, 16)]);
    const [h] = block(w, () => TANK, 1, 20, 60, 1, 1);
    step(w, [moveCmd(0, [h!], 60, 60)]);
    let retargeted = false;
    run(w, 400, () => {
      checkPassable(w);
      if ((unitInfo(w, h!)!.moverFlags & MoverBits.Retargeted) !== 0) retargeted = true;
    });
    const u = unitInfo(w, h!)!;
    expect(retargeted).toBe(true);
    expect(u.moving).toBe(false);
    // Nearest cell of the outer component to the cell (60, 60): 10 cells away, just outside the
    // east (x = 70) or south (z = 70) wall — the spiral order decides ties.
    const tx = u.targetX >> 12;
    const tz = u.targetZ >> 12;
    expect((tx - 60) * (tx - 60) + (tz - 60) * (tz - 60)).toBe(100);
    expect(u.targetX & 4095).toBe(2048);
    expect(Math.hypot(u.x - u.targetX, u.z - u.targetZ)).toBeLessThan(0.5 * FX_ONE);
  });
});

describe('footprints (CheatSub.Footprint, basis of MS4 buildings)', () => {
  it('a footprint repaths only the paths whose corridor it cuts; units drive around it', () => {
    const w = createWorld({ bpTable: gameTable(), seed: 4, armyCount: 2, mapSizeWu: 256 });
    const a = block(w, () => TANK, 1, 20, 60, 1, 1);
    const b = block(w, () => TANK, 1, 20, 190, 1, 1);
    step(w, [moveCmd(0, a, 230, 60), moveCmd(0, b, 230, 190)]);
    run(w, 5);
    const rep0 = pathStats(w).repathsTriggered;
    const req0 = pathStats(w).requestsIssued;
    // A wall across a's corridor (z 40..80 at x 120), far from b's.
    step(w, [footprintCmd(0, 120, 40, 4, 41)]);
    expect(pathStats(w).repathsTriggered - rep0).toBe(1);
    // The repath is a new request, serviced in the same tick's PathService phase.
    expect(pathStats(w).requestsIssued - req0).toBe(1);
    run(w, 1100, () => checkPassable(w));
    const ua = unitInfo(w, a[0]!)!;
    const ub = unitInfo(w, b[0]!)!;
    expect(Math.hypot(ua.x / FX_ONE - 230, ua.z / FX_ONE - 60)).toBeLessThan(0.5);
    expect(Math.hypot(ub.x / FX_ONE - 230, ub.z / FX_ONE - 190)).toBeLessThan(0.5);
    // Removing never repaths.
    const rep1 = pathStats(w).repathsTriggered;
    step(w, [footprintCmd(0, 120, 40, 4, 41, -1)]);
    expect(pathStats(w).repathsTriggered).toBe(rep1);
  });

  it('units on freshly blocked cells are moved to the nearest free cell; invalid footprints are rejected', () => {
    const w = createWorld({ bpTable: gameTable(), seed: 5, armyCount: 2, mapSizeWu: 128 });
    const hs = block(w, (i) => (i % 2 === 0 ? TANK : T3), 12, 60, 60, 4, 2.5);
    step(w, [footprintCmd(1, 59, 59, 10, 8)]);
    checkPassable(w);
    expect(pathStats(w).unitsEvicted).toBeGreaterThan(0);
    for (const h of hs) expect(unitInfo(w, h)).not.toBeNull();
    run(w, 30, () => checkPassable(w));
    step(w, [footprintCmd(0, 10, 10, 0, 3), footprintCmd(0, 10, 10, 65, 3), footprintCmd(0, 200, 10, 3, 3)]);
    expect(pathStats(w).footprintsRejected).toBe(3);
    // A footprint over a spawn point rejects the spawn (class passability, M5).
    const rej = spawnRejectedCount(w);
    step(w, [spawnCmd(0, 1, 62, 62, 0, TANK)]);
    expect(spawnRejectedCount(w)).toBe(rej + 1);
  });
});

describe('stuck chain (PLAN §3.8: repath → side-step / nearest point → give up)', () => {
  const FACTORY = 1; // core:fac_land_t1: no speed ⇒ never displaced by collisions (not a nav footprint)

  it('an obstacle the nav does not know (a structure) is steered around by separation', () => {
    const w = createWorld({ bpTable: gameTable(), seed: 6, armyCount: 2, mapSizeWu: 64 });
    step(w, [spawnCmd(1, 1, 32, 32, 0, FACTORY)]);
    const [h] = block(w, () => TANK, 1, 20, 32, 1, 1);
    step(w, [moveCmd(0, [h!], 44, 32)]);
    let arrived = -1;
    run(w, 300, () => {
      checkPassable(w);
      if (arrived < 0 && !unitInfo(w, h!)!.moving) arrived = w.tick;
    });
    expect(arrived).toBeGreaterThan(0);
    expect(pathStats(w).stuckGiveUps).toBe(0);
    const u = unitInfo(w, h!)!;
    expect(Math.hypot(u.x / FX_ONE - 44, u.z / FX_ONE - 32)).toBeLessThan(0.5);
  });

  it('a unit walled in by structures: 1. repath, 2. side-step, 3. give up (stuckGiveUps)', () => {
    const w = createWorld({ bpTable: gameTable(), seed: 7, armyCount: 2, mapSizeWu: 64 });
    // Eight factories (radius 2.5 WU) on a circle of 5 WU: the chords (3.8 WU) leave no gap.
    const ring: CommandEnvelope[] = [];
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      ring.push(spawnCmd(1, 1, 32 + 5 * Math.cos(a), 32 + 5 * Math.sin(a), 0, FACTORY));
    }
    step(w, ring);
    expect(unitHandles(w, 1).length).toBe(8);
    const [h] = block(w, () => TANK, 1, 32, 32, 1, 1);
    const req0 = pathStats(w).requestsIssued;
    step(w, [moveCmd(0, [h!], 55, 40)]);
    let sawDetour = false;
    run(w, 600, () => {
      checkPassable(w);
      if ((unitInfo(w, h!)!.moverFlags & MoverBits.Detour) !== 0) sawDetour = true;
    });
    const u = unitInfo(w, h!)!;
    // Order request + own path after the 1st stuck + path from the side-step point after the 2nd.
    expect(pathStats(w).requestsIssued - req0).toBe(3);
    expect(sawDetour).toBe(true);
    expect(pathStats(w).stuckGiveUps).toBe(1);
    expect(u.moving).toBe(false);
    expect(u.orders).toBe(0);
    expect(Math.hypot(u.x / FX_ONE - 32, u.z / FX_ONE - 32)).toBeLessThan(3);
    // The structures did not move.
    for (const f of unitHandles(w, 1)) expect(unitInfo(w, f)!.x).toBe(unitInfo(w, f)!.px);
  });
});

describe('collisions and groups (G8/M7)', () => {
  it('100 units sent to one point: after arrival no overlap > 0.1 WU', () => {
    const w = createWorld({ bpTable: gameTable(), seed: 7, armyCount: 2, mapSizeWu: 256 });
    step(w, [spawnCmd(0, 100, 128, 128, 50, TANK)]);
    const hs = unitHandles(w, 0);
    expect(hs.length).toBe(100);
    step(w, hs.map((h) => moveCmd(0, [h], 128, 128)));
    let idleAt = -1;
    run(w, 800, () => {
      if (idleAt < 0 && hs.every((h) => !unitInfo(w, h)!.moving)) idleAt = w.tick;
    });
    expect(idleAt).toBeGreaterThan(0);
    const us = hs.map((h) => unitInfo(w, h)!);
    let maxOverlap = 0;
    for (let i = 0; i < us.length; i++) {
      for (let j = i + 1; j < us.length; j++) {
        const need = w.bp.radiusCol[us[i]!.bp]! + w.bp.radiusCol[us[j]!.bp]!;
        const d = Math.hypot(us[i]!.x - us[j]!.x, us[i]!.z - us[j]!.z);
        maxOverlap = Math.max(maxOverlap, need - d);
      }
    }
    expect(maxOverlap / FX_ONE).toBeLessThanOrEqual(0.1);
  });

  it('a group keeps its (compressed) arrangement: every unit ends within 1.5 WU of centroid + offset', () => {
    const w = createWorld({ bpTable: gameTable(), seed: 8, armyCount: 2, mapSizeWu: 256 });
    const g = block(w, (i) => [TANK, TANK, T2][i % 3]!, 30, 40, 100, 10, 3);
    step(w, [moveCmd(0, g, 180, 140)]);
    run(w, 900);
    const U = w.units.col;
    let cx = 0;
    let cz = 0;
    for (const h of g) {
      const i = w.units.resolve(h);
      cx += U.x[i]!;
      cz += U.z[i]!;
    }
    cx /= g.length;
    cz /= g.length;
    let maxErr = 0;
    for (const h of g) {
      const u = unitInfo(w, h)!;
      expect(u.moving).toBe(false);
      const i = w.units.resolve(h);
      const packed = U.groupOffset[i]!;
      const e = Math.hypot(u.x - cx - offsetX(packed), u.z - cz - offsetZ(packed)) / FX_ONE;
      maxErr = Math.max(maxErr, e);
    }
    expect(maxErr).toBeLessThanOrEqual(1.5);
  });
});

describe('group slots next to walls (ms3.1, MS3 bench)', () => {
  it('slots behind a thin wall next to the target are pulled back into LOS of the anchor', () => {
    const w = createWorld({ bpTable: gameTable(), seed: 11, armyCount: 2, mapSizeWu: 256 });
    // A thin wall (2 × 41 cells) 3 WU east of the group target: offsets of the right half of the
    // group land behind it; its ends are open, so those cells are reachable — by a long detour.
    step(w, [footprintCmd(0, 150, 100, 2, 41)]);
    const g = block(w, (i) => [TANK, T2, TANK, T3][i % 4]!, 24, 40, 108, 6, 3.2);
    step(w, [moveCmd(0, g, 147, 120)]);
    run(w, 1200, () => checkPassable(w));
    for (const h of g) {
      const u = unitInfo(w, h)!;
      expect(u.moving).toBe(false);
      // every unit stopped on the target side of the wall, none drove around it
      expect(u.x / FX_ONE).toBeLessThan(150);
      expect(Math.hypot(u.x / FX_ONE - 147, u.z / FX_ONE - 120)).toBeLessThan(14);
    }
  });
});

describe('L4 restore in the middle of paths and queues', () => {
  it('snapshot while requests are pending and queues are full ⇒ same end full hash as the direct run', () => {
    const map = hollowRidgeSim();
    const table = gameTable();
    const script = (w: World, t: number): CommandEnvelope[] => {
      if (t === 1) return [spawnCmd(0, 120, 110, 110, 30, TANK, 0, 1), spawnCmd(1, 80, 400, 400, 25, T2, 1, 1)];
      if (t === 2) {
        const a = unitHandles(w, 0);
        const b = unitHandles(w, 1);
        return [
          moveCmd(0, a.slice(0, 60), 200, 96, 2),
          moveCmd(0, a.slice(0, 60), 250, 150, 3, CmdFlags.Queue),
          moveCmd(0, a.slice(60), 120, 240, 4),
          moveCmd(1, b, 330, 416, 2),
          moveCmd(1, b, 392, 262, 3, CmdFlags.Queue),
        ];
      }
      if (t === 150) return [footprintCmd(0, 150, 90, 6, 20, 1, 5)];
      if (t === 300) return [stopCmd(1, unitHandles(w, 1).slice(0, 20), 4)];
      return [];
    };
    const runTo = (w: World, until: number): void => {
      while (w.tick < until) step(w, script(w, w.tick + 1));
    };
    const direct = createWorld({ bpTable: table, seed: 9, armyCount: 2, map });
    runTo(direct, 600);
    const first = createWorld({ bpTable: table, seed: 9, armyCount: 2, map });
    runTo(first, 2);
    // Right after the commands: queues of 2 orders (the queued groups have not asked yet).
    expect(unitInfo(first, unitHandles(first, 0)[0]!)!.orders).toBe(2);
    expect(pathStats(first).liveGroups).toBe(5);
    runTo(first, 151);
    expect(pathStats(first).liveOrders).toBeGreaterThan(100);
    const snap = snapshot(first);
    const fresh = createWorld({ bpTable: table, seed: 9, armyCount: 2, map });
    restore(fresh, snap);
    expect(ruleHash(fresh)).toBe(ruleHash(first));
    expect(fullHash(fresh)).toBe(fullHash(first));
    runTo(fresh, 600);
    expect(ruleHash(fresh)).toBe(ruleHash(direct));
    expect(fullHash(fresh)).toBe(fullHash(direct));
  });
});
