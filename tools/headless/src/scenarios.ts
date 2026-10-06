/**
 * The L2 golden scenarios (PLAN §3.12, §5.2 "≥ 2 L2-Goldens").
 *
 * MS3 (faf-sim/ms3.0): every move is pathed (HPA*, group orders with offset preservation), land
 * units only stand on nav cells passable for their class. The MS1/MS2 scenarios keep their
 * commands; their asserts follow the MS3 behaviour (e.g. a group sent across the lake is routed
 * over a ford instead of stopping at the bank). New MS3 goldens (see the end of the file):
 * `ridge-group-offset`, `ridge-shift-queue`, `choke-3wu`, `obstacle-repath`.
 *
 * Test plane (MS1):
 * - `cubes-1000-move`: 1,000 cubes (cheat spawn, 2 armies), group moves at 2/300/700/1,100/1,500.
 * - `cubes-churn`: spawn/kill/respawn with FIFO slot reuse, Stop, a second army, a command on
 *   foreign units that must be rejected, a full wipe + regrowth of one army.
 * hollow-ridge (MS2, content/maps/hollow-ridge.rtsmap):
 * - `ridge-1000-move`: 1,000 cubes drive down the plateau cliffs/ramps, up the mesas and back —
 *   y follows the terrain (M1).
 * - `ridge-water-block`: group A is ordered across the deep river/lake, stays on its bank (sliding)
 *   and goes idle; group B crosses at the NE ford and reaches its target, then crosses back and
 *   forth; cheat spawns into the lake are rejected (M2).
 * Both map scenarios check after every tick that no land unit stands in deep water and every
 * 10 ticks that y == rules.sampleHeightRaw for every unit.
 *
 * Tick 1 carries the cheat spawns; the first move group follows in tick 2 because handles only
 * exist after the spawn step (see docs/status/P6-headless.md, deviations).
 */
import { FX_ONE, handleGen, handleIndex, type Handle } from '@faf/fixed';
import { LAND_MAX_WATER_DEPTH_RAW, MotionLayer, sampleHeightRaw } from '@faf/rules';
import { PATH_DIRECT, PATH_F_REPATH, PATH_READY, type PathDebug } from '@faf/nav';
import { clipFootprint, copyNavGraph, corridorCutBrute, type NavGraphCopy } from '@faf/nav/check';
import { offsetX, offsetZ, spawnRejectedCount, surfaceY, unitClass } from '@faf/sim';
import { chokeMap } from './maps.ts';
import { ScenarioBuilder, type BpRef, type Scenario, type ScenarioContext } from './scenario.ts';

const MAP = 512;
/** Repo-relative path of the MS2 reference map (loaded by the caller, see RunOptions.maps). */
export const HOLLOW_RIDGE_PATH = 'content/maps/hollow-ridge.rtsmap';

/** Every `n`-th element starting at `offset`. */
function every<T>(list: readonly T[], n: number, offset = 0): T[] {
  const out: T[] = [];
  for (let i = offset; i < list.length; i += n) out.push(list[i]!);
  return out;
}

/** Slice by fraction of the list length. */
function part<T>(list: readonly T[], from: number, to: number): T[] {
  return list.slice(Math.floor(list.length * from), Math.floor(list.length * to));
}

/** Count of units (of `units`) within `radiusWu` of (x, z). */
function nearCount(ctx: ScenarioContext, units: readonly Handle[], x: number, z: number, radiusWu: number): number {
  const r = radiusWu * FX_ONE;
  const r2 = r * r;
  let n = 0;
  for (const h of units) {
    const u = ctx.info(h);
    if (u === null) continue;
    const dx = u.x - x * FX_ONE;
    const dz = u.z - z * FX_ONE;
    if (dx * dx + dz * dz <= r2) n++;
  }
  return n;
}

function expectEq(what: string, actual: number, expected: number): true | string {
  return actual === expected ? true : `${what}: expected ${expected}, got ${actual}`;
}

/** First failure of several checks, or true. */
function all(...results: (true | string)[]): true | string {
  for (const r of results) if (r !== true) return r;
  return true;
}

function allInsideMap(ctx: ScenarioContext): true | string {
  const max = MAP * FX_ONE;
  for (const h of ctx.handles()) {
    const u = ctx.info(h)!;
    if (u.x < 0 || u.z < 0 || u.x > max || u.z > max) return `unit ${h} outside the map (${u.x}, ${u.z})`;
  }
  return true;
}

function handlesVar(ctx: ScenarioContext, key: string): Handle[] {
  const v = ctx.vars[key];
  if (!Array.isArray(v)) throw new Error(`scenario var '${key}' missing`);
  return v as Handle[];
}

/** Invariant (M2): no land unit stands in water deeper than 0.5 WU. */
export function noLandInDeepWater(ctx: ScenarioContext): true | string {
  const w = ctx.world;
  if (!w.hasWater) return true;
  const U = w.units.col;
  const hw = w.units.highWater;
  for (let i = 0; i < hw; i++) {
    if (w.units.alive[i] !== 1 || U.layer[i] !== MotionLayer.Land) continue;
    const depth = w.waterLevel - sampleHeightRaw(w.terrain, U.x[i]!, U.z[i]!);
    if (depth > LAND_MAX_WATER_DEPTH_RAW) return `slot ${i} in deep water (${depth / FX_ONE} WU) at (${U.x[i]! / FX_ONE}, ${U.z[i]! / FX_ONE})`;
  }
  return true;
}

/** Invariant (M5, MS3): no land unit stands on a nav cell not passable for its size class. */
export function noLandOnBlockedCell(ctx: ScenarioContext): true | string {
  const w = ctx.world;
  const U = w.units.col;
  const hw = w.units.highWater;
  for (let i = 0; i < hw; i++) {
    if (w.units.alive[i] !== 1 || U.layer[i] !== MotionLayer.Land) continue;
    const c = w.navClear[((U.z[i]! >> 12) << w.navShift) | (U.x[i]! >> 12)]!;
    const cls = unitClass(w, i);
    if (c < cls) return `slot ${i} (class ${cls}) on a blocked cell (${U.x[i]! / FX_ONE}, ${U.z[i]! / FX_ONE}), clearance ${c}`;
  }
  return true;
}

/** Invariant (M1/Sim): every unit stands on the terrain, y == rules.sampleHeightRaw(x, z). */
export function yOnTerrain(ctx: ScenarioContext): true | string {
  const w = ctx.world;
  const U = w.units.col;
  const hw = w.units.highWater;
  for (let i = 0; i < hw; i++) {
    if (w.units.alive[i] !== 1) continue;
    const expected = surfaceY(w, U.layer[i]!, sampleHeightRaw(w.terrain, U.x[i]!, U.z[i]!));
    if (U.y[i] !== expected) return `slot ${i}: y ${U.y[i]} ≠ terrain ${expected}`;
  }
  return true;
}

/** Mean y (WU) of the live units of a list. */
function meanY(ctx: ScenarioContext, units: readonly Handle[]): number {
  let s = 0;
  let n = 0;
  for (const h of units) {
    const i = ctx.world.units.resolve(h);
    if (i < 0) continue;
    s += ctx.world.units.col.y[i]!;
    n++;
  }
  return n === 0 ? 0 : s / n / FX_ONE;
}

/** 1,000 cubes, group moves (L2 golden #1). */
export function cubes1000Move(): Scenario {
  return new ScenarioBuilder('cubes-1000-move')
    .map({ sizeWu: MAP })
    .seed(0x5eed0001)
    .armies(2)
    .ticks(2000)
    .spawn({ army: 0, count: 700, x: 160, z: 256, spread: 48 })
    .spawn({ army: 1, count: 300, x: 352, z: 256, spread: 28 })
    .assert(1, 'spawned 700 + 300', (c) => all(expectEq('army 0', c.count(0), 700), expectEq('army 1', c.count(1), 300)))
    .at(2, (c) => {
      const a0 = c.handles(0);
      c.vars['g0'] = part(a0, 0, 0.25);
      return [
        { kind: 'move', army: 0, units: part(a0, 0, 0.25), x: 120, z: 200 },
        { kind: 'move', army: 0, units: part(a0, 0.25, 0.5), x: 96, z: 416 },
        { kind: 'move', army: 0, units: part(a0, 0.5, 0.75), x: 224, z: 160 },
        { kind: 'move', army: 0, units: part(a0, 0.75, 1), x: 224, z: 352 },
        { kind: 'move', army: 1, units: c.handles(1), x: 420, z: 256 },
      ];
    })
    .assert(290, 'group 0 gathered at (120, 200)', (c) => {
      const g0 = handlesVar(c, 'g0');
      const n = nearCount(c, g0, 120, 200, 24);
      return n * 10 >= g0.length * 9 ? true : `only ${n}/${g0.length} within 24 WU`;
    })
    .at(300, (c) => {
      const a0 = c.handles(0);
      return [
        { kind: 'move', army: 0, units: part(a0, 0, 0.5), x: 300, z: 200 },
        { kind: 'move', army: 1, units: every(c.handles(1), 2), x: 380, z: 120 },
      ];
    })
    .at(700, (c) => [
      { kind: 'move', army: 0, units: every(c.handles(0), 3, 1), x: 128, z: 256 },
      { kind: 'move', army: 1, units: c.handles(1), x: 256, z: 460 },
    ])
    .at(1100, (c) => [{ kind: 'move', army: 0, units: c.handles(0), x: 400, z: 100 }])
    .at(1500, (c) => {
      const a0 = c.handles(0);
      return [
        { kind: 'move', army: 1, units: c.handles(1), x: 100, z: 400 },
        { kind: 'move', army: 0, units: every(a0, 2), x: 256, z: 450 },
        { kind: 'move', army: 0, units: every(a0, 5, 1), x: 480, z: 480, queue: true },
      ];
    })
    .assert(2000, 'all 1,000 cubes alive', (c) => expectEq('units', c.total(), 1000))
    .assert(2000, 'all cubes inside the map', allInsideMap)
    .build();
}

/** Spawn/kill/respawn churn with slot reuse, Stop, second army, foreign command (L2 golden #2). */
export function cubesChurn(): Scenario {
  const b = new ScenarioBuilder('cubes-churn')
    .map({ sizeWu: MAP })
    .seed(0xc4a50002)
    .armies(2)
    .ticks(2000)
    .spawn({ army: 0, count: 200, x: 128, z: 128, spread: 20 })
    .spawn({ army: 1, count: 200, x: 384, z: 384, spread: 20 })
    .at(20, (c) => [
      { kind: 'move', army: 0, units: c.handles(0), x: 256, z: 220 },
      { kind: 'move', army: 1, units: c.handles(1), x: 256, z: 300 },
    ])
    .at(50, (c) => {
      const victims = every(c.handles(0), 4);
      c.vars['killed'] = victims;
      return { kind: 'kill', army: 0, units: victims };
    })
    .assert(50, 'kill removes 50 units, stale handles are dead', (c) => {
      const killed = handlesVar(c, 'killed');
      for (const h of killed) if (c.info(h) !== null) return `killed handle ${h} still alive`;
      return expectEq('army 0', c.count(0), 150);
    })
    .at(60, () => ({ kind: 'spawn', army: 0, count: 50, x: 200, z: 200, spread: 10 }))
    .assert(60, 'respawn reuses the freed slots FIFO with gen + 1', (c) => {
      const killed = handlesVar(c, 'killed');
      const freed = new Set(killed.map((h) => handleIndex(h)));
      const reused = c.handles(0).filter((h) => freed.has(handleIndex(h)));
      if (reused.length !== killed.length) return `expected ${killed.length} reused slots, got ${reused.length}`;
      for (const h of reused) {
        const old = killed.find((k) => handleIndex(k) === handleIndex(h))!;
        if (handleGen(h) !== ((handleGen(old) + 1) & 0xfff)) return `slot ${handleIndex(h)}: gen ${handleGen(h)} after ${handleGen(old)}`;
      }
      return expectEq('army 0', c.count(0), 200);
    })
    .at(100, (c) => {
      c.vars['foreignSeq'] = -2;
      // Army 0 tries to command army 1's units: must be rejected (ownership), but acknowledged.
      return { kind: 'move', army: 0, units: c.handles(1), x: 10, z: 10 };
    })
    .assert(100, 'command on foreign units is rejected but acknowledged', (c) => {
      for (const h of c.handles(1)) {
        const u = c.info(h)!;
        if (u.targetX === 10 * FX_ONE && u.targetZ === 10 * FX_ONE) return `foreign unit ${h} accepted the move`;
      }
      return expectEq('ack seq army 0', c.ackSeq(0), c.lastSeq(0));
    })
    .at(150, (c) => {
      const stopped = part(c.handles(1), 0, 0.5);
      c.vars['stopped'] = stopped;
      return { kind: 'stop', army: 1, units: stopped };
    })
    .assert(151, 'stopped units are no longer moving', (c) => {
      for (const h of handlesVar(c, 'stopped')) {
        const u = c.info(h);
        if (u !== null && u.moving) return `unit ${h} still moving after Stop`;
      }
      return true;
    })
    .at(1000, (c) => ({ kind: 'kill', army: 1, units: c.handles(1) }))
    .assert(1000, 'army 1 wiped', (c) => expectEq('army 1', c.count(1), 0))
    .at(1010, () => ({ kind: 'spawn', army: 1, count: 260, x: 400, z: 120, spread: 30 }))
    .assert(1010, 'army 1 regrown beyond its old size', (c) => expectEq('army 1', c.count(1), 260))
    .at(1200, (c) => ({ kind: 'stop', army: 1, units: every(c.handles(1), 3) }))
    .assert(2000, 'final unit counts', (c) => {
      return all(expectEq('army 0', c.count(0), 200), expectEq('army 1', c.count(1), 260));
    })
    .assert(2000, 'all cubes inside the map', allInsideMap);

  // Rolling churn: every 200 ticks both armies lose every 5th unit (rotating offset) and respawn
  // the same number one tick later elsewhere, then get new targets.
  for (let k = 0; k < 8; k++) {
    const t = 300 + k * 200;
    if (t === 1100 || t === 1000) continue;
    b.at(t, (c) => {
      const cmds: { kind: 'kill'; army: number; units: Handle[] }[] = [];
      for (let army = 0; army < 2; army++) {
        const victims = every(c.handles(army), 5, k % 5);
        c.vars[`churn${army}`] = victims.length;
        if (victims.length > 0) cmds.push({ kind: 'kill', army, units: victims });
      }
      return cmds;
    });
    b.at(t + 1, (c) => [
      { kind: 'spawn', army: 0, count: c.vars['churn0'] as number, x: 64 + k * 48, z: 448 - k * 40, spread: 12 },
      { kind: 'spawn', army: 1, count: c.vars['churn1'] as number, x: 448 - k * 40, z: 64 + k * 48, spread: 12 },
    ]);
    b.at(t + 2, (c) => [
      { kind: 'move', army: 0, units: c.handles(0), x: 96 + k * 40, z: 96 + ((k * 3) % 8) * 40 },
      { kind: 'move', army: 1, units: every(c.handles(1), 2), x: 416 - k * 36, z: 256 },
    ]);
  }
  return b.build();
}

/** 1,000 cubes over the slopes of hollow-ridge; y follows the terrain (MS2 golden #1). */
export function ridge1000Move(): Scenario {
  return new ScenarioBuilder('ridge-1000-move')
    .map({ path: HOLLOW_RIDGE_PATH })
    .seed(0x5eed0003)
    .armies(2)
    .ticks(2000)
    // NW plateau (24.1 WU) around army 0's start, SE plateau around army 1's.
    .spawn({ army: 0, count: 700, x: 110, z: 110, spread: 34 })
    .spawn({ army: 1, count: 300, x: 402, z: 402, spread: 26 })
    // MS3: points on the plateau cliffs/steep ramps (nav passability) are rejected.
    .assert(1, 'spawned 700 + 300 on the plateaus (cliff points rejected)', (c) => {
      c.vars['n0'] = c.total();
      return all(expectEq('spawned + rejected', c.count(0) + c.count(1) + spawnRejectedCount(c.world), 1000), spawnRejectedCount(c.world) <= 30 ? true : `rejected ${spawnRejectedCount(c.world)}`);
    })
    .assert(1, 'army 0 starts high up (plateau ≈ 24 WU)', (c) => (meanY(c, c.handles(0)) > 22 ? true : `mean y ${meanY(c, c.handles(0))}`))
    .at(2, (c) => {
      const a0 = c.handles(0);
      const a1 = c.handles(1);
      c.vars['q0'] = part(a0, 0, 0.25);
      c.vars['a1'] = a1;
      return [
        // Down the east ramp / cliffs, down the south ramp, up the NW mesa, to the hydro lowland.
        { kind: 'move', army: 0, units: part(a0, 0, 0.25), x: 196, z: 96 },
        { kind: 'move', army: 0, units: part(a0, 0.25, 0.5), x: 96, z: 196 },
        { kind: 'move', army: 0, units: part(a0, 0.5, 0.75), x: 120, z: 244 },
        { kind: 'move', army: 0, units: part(a0, 0.75, 1), x: 200, z: 150 },
        { kind: 'move', army: 1, units: part(a1, 0, 0.5), x: 330, z: 416 },
        { kind: 'move', army: 1, units: part(a1, 0.5, 1), x: 392, z: 262 },
      ];
    })
    .assert(400, 'quarter 0 gathered at the east-ramp foot (196, 96)', (c) => {
      const q0 = handlesVar(c, 'q0');
      const n = nearCount(c, q0, 196, 96, 24);
      return n * 10 >= q0.length * 9 ? true : `only ${n}/${q0.length} within 24 WU`;
    })
    .assert(400, 'y followed the terrain down: quarter 0 left the 24 WU plateau', (c) => {
      const y = meanY(c, handlesVar(c, 'q0'));
      return y < 19 ? true : `mean y ${y.toFixed(2)} WU`;
    })
    .at(700, (c) => [
      { kind: 'move', army: 0, units: every(c.handles(0), 3, 1), x: 230, z: 150 },
      { kind: 'move', army: 1, units: c.handles(1), x: 416, z: 416 },
    ])
    // 300 cubes as one group over the plateau ramps (MS3: pathed, crowding at the ramps).
    .assert(1490, 'army 1 climbed back onto its plateau (y ≈ 24 WU)', (c) => {
      const a1 = handlesVar(c, 'a1');
      let up = 0;
      for (const h of a1) {
        const i = c.world.units.resolve(h);
        if (i >= 0 && c.world.units.col.y[i]! > 20 * FX_ONE) up++;
      }
      return up * 10 >= a1.length * 8 ? true : `only ${up}/${a1.length} above 20 WU`;
    })
    .at(1100, (c) => [{ kind: 'move', army: 0, units: c.handles(0), x: 96, z: 96 }])
    .at(1500, (c) => {
      const a0 = c.handles(0);
      return [
        { kind: 'move', army: 0, units: every(a0, 2), x: 40, z: 250 },
        { kind: 'move', army: 0, units: every(a0, 2, 1), x: 250, z: 40 },
        { kind: 'move', army: 1, units: c.handles(1), x: 470, z: 300 },
      ];
    })
    .invariant(1, 'no land unit in deep water', noLandInDeepWater)
    .invariant(1, 'no land unit on a nav cell blocked for its class', noLandOnBlockedCell)
    .invariant(10, 'y == sampleHeightRaw for every unit', yOnTerrain)
    .assert(2000, 'every spawned cube alive', (c) => expectEq('units', c.total(), c.vars['n0'] as number))
    .assert(2000, 'all cubes inside the map', allInsideMap)
    .build();
}

/**
 * Deep water blocks, fords do not (MS2 golden #2; MS3: pathed). Group A (army 0) at (230, 170) is
 * ordered to (282, 342) straight across the lake — the group path leads over a ford and A arrives;
 * group B (army 1) at (320, 120) drives to (392, 192) through the NE ford (356, 156) and back.
 * Cheat spawns into the lake are rejected. No land unit ever stands in deep water or on a
 * blocked cell.
 */
export function ridgeWaterBlock(): Scenario {
  const A_TARGET = [282, 342] as const;
  const B_FROM = [320, 120] as const;
  const B_TO = [392, 192] as const;
  const groupAt = (c: ScenarioContext, key: string, x: number, z: number, r: number): true | string => {
    const g = handlesVar(c, key);
    const n = nearCount(c, g, x, z, r);
    return n === g.length ? true : `only ${n}/${g.length} within ${r} WU of (${x}, ${z})`;
  };
  const allIdle = (c: ScenarioContext, key: string): true | string => {
    for (const h of handlesVar(c, key)) {
      const u = c.info(h);
      if (u !== null && u.moving) return `unit ${h} still moving at (${u.x / FX_ONE}, ${u.z / FX_ONE})`;
    }
    return true;
  };
  /** Every unit of the group is on the far (SE) side of the river centre line (x + z > 512). */
  const crossed = (c: ScenarioContext, key: string): true | string => {
    for (const h of handlesVar(c, key)) {
      const u = c.info(h)!;
      if (u.x + u.z <= 512 * FX_ONE) return `unit ${h} still NW of the river (x+z = ${(u.x + u.z) / FX_ONE})`;
    }
    return true;
  };
  return new ScenarioBuilder('ridge-water-block')
    .map({ path: HOLLOW_RIDGE_PATH })
    .seed(0x5eed0004)
    .armies(2)
    .ticks(2000)
    .spawn({ army: 0, count: 40, x: 230, z: 170, spread: 6 })
    .spawn({ army: 1, count: 30, x: B_FROM[0], z: B_FROM[1], spread: 4 })
    .at(2, (c) => {
      c.vars['A'] = c.handles(0);
      c.vars['B'] = c.handles(1);
      c.vars['req0'] = c.world.nav.requestsIssued;
      return [
        { kind: 'move', army: 0, units: c.handles(0), x: A_TARGET[0], z: A_TARGET[1] },
        { kind: 'move', army: 1, units: c.handles(1), x: B_TO[0], z: B_TO[1] },
      ];
    })
    .assert(2, 'two group orders ⇒ exactly two path requests', (c) => expectEq('requests', c.world.nav.requestsIssued - (c.vars['req0'] as number), 2))
    // Cheat spawns into the lake (3.5 WU deep) and the river bed are rejected and counted.
    .at(5, () => [
      { kind: 'spawn', army: 0, count: 5, x: 256, z: 256, spread: 0 },
      { kind: 'spawn', army: 1, count: 5, x: 300, z: 212, spread: 2 },
    ])
    .assert(5, 'spawns into deep water are rejected', (c) =>
      all(expectEq('rejected', spawnRejectedCount(c.world), 10), expectEq('army 0', c.count(0), 40), expectEq('army 1', c.count(1), 30)),
    )
    .assert(600, 'group B crossed the ford and reached its target', (c) => all(groupAt(c, 'B', B_TO[0], B_TO[1], 10), allIdle(c, 'B')))
    .at(700, (c) => [{ kind: 'move', army: 1, units: handlesVar(c, 'B'), x: B_FROM[0], z: B_FROM[1] }])
    .assert(1290, 'group B is back on the NW side of the ford', (c) => groupAt(c, 'B', B_FROM[0], B_FROM[1], 10))
    .assert(1600, 'group A was routed around the lake (over a ford) and reached its target', (c) =>
      all(crossed(c, 'A'), groupAt(c, 'A', A_TARGET[0], A_TARGET[1], 12), allIdle(c, 'A')),
    )
    .at(1300, (c) => [{ kind: 'move', army: 1, units: handlesVar(c, 'B'), x: B_TO[0], z: B_TO[1] }])
    .assert(2000, 'group B crossed the ford again and reached its target', (c) => groupAt(c, 'B', B_TO[0], B_TO[1], 10))
    .invariant(1, 'no land unit in deep water', noLandInDeepWater)
    .invariant(1, 'no land unit on a nav cell blocked for its class', noLandOnBlockedCell)
    .invariant(10, 'y == sampleHeightRaw for every unit', yOnTerrain)
    .assert(2000, 'unit counts', (c) => all(expectEq('army 0', c.count(0), 40), expectEq('army 1', c.count(1), 30)))
    .build();
}

// ---- MS3 goldens -----------------------------------------------------------------------------

/** core blueprints of the MS3 goldens (content/blueprints/core/units). */
const T1 = 'core:lnd_t1_tank'; // class 1, r 0.45
const T2 = 'core:lnd_t2_tank'; // class 2, r 0.75
const T3 = 'core:lnd_t3_heavy'; // class 3, r 1.2

/** Spawns `n` units one by one at exact points of a block (cols × rows, `spacing` WU). */
function spawnBlock(b: ScenarioBuilder, army: number, bp: (i: number) => BpRef, n: number, x0: number, z0: number, cols: number, spacing: number): ScenarioBuilder {
  for (let i = 0; i < n; i++) b.spawn({ army, count: 1, x: x0 + (i % cols) * spacing, z: z0 + Math.floor(i / cols) * spacing, spread: 0, bp: bp(i) });
  return b;
}

/**
 * `ridge-group-offset` (MS3): 40 blueprint tanks of classes 1–3 as one group from the NW plateau
 * to the SE plateau over a ford (one path request). Asserts: never a unit on a blocked cell or in
 * deep water, all arrived, every unit's deviation from its compressed offset (relative to the
 * final centroid) ≤ 1.5 WU.
 */
export function ridgeGroupOffset(): Scenario {
  const b = new ScenarioBuilder('ridge-group-offset').map({ path: HOLLOW_RIDGE_PATH }).seed(0x5eed0005).armies(2).ticks(3600);
  spawnBlock(b, 0, (i) => [T1, T2, T3][i % 3]!, 40, 95, 95, 8, 3.2);
  return b
    .assert(1, '40 tanks on the NW plateau', (c) => all(expectEq('army 0', c.count(0), 40), expectEq('rejected', spawnRejectedCount(c.world), 0)))
    .at(2, (c) => {
      c.vars['g'] = c.handles(0);
      c.vars['req0'] = c.world.nav.requestsIssued;
      return { kind: 'move', army: 0, units: c.handles(0), x: 405, z: 405 };
    })
    .assert(2, 'one group order ⇒ one path request (class 3 = largest of the group)', (c) => {
      const p = c.info(handlesVar(c, 'g')[0]!)!.path;
      return all(expectEq('requests', c.world.nav.requestsIssued - (c.vars['req0'] as number), 1), expectEq('path class', c.world.nav.pathClass(p), 3));
    })
    .assert(3600, 'all 40 arrived on the SE plateau and are idle', (c) => {
      const g = handlesVar(c, 'g');
      for (const h of g) {
        const u = c.info(h)!;
        if (u.moving || u.orders > 0) return `unit ${h} not idle at (${u.x / FX_ONE}, ${u.z / FX_ONE})`;
      }
      const n = nearCount(c, g, 405, 405, 15);
      return n === g.length ? true : `only ${n}/${g.length} within 15 WU of (405, 405)`;
    })
    .assert(3600, 'arrangement kept: every unit within 1.5 WU of centroid + compressed offset', (c) => {
      const g = handlesVar(c, 'g');
      const U = c.world.units.col;
      let cx = 0;
      let cz = 0;
      for (const h of g) {
        const i = c.world.units.resolve(h);
        cx += U.x[i]!;
        cz += U.z[i]!;
      }
      cx = Math.floor(cx / g.length);
      cz = Math.floor(cz / g.length);
      let worst = 0;
      let worstH = 0;
      for (const h of g) {
        const i = c.world.units.resolve(h);
        const packed = U.groupOffset[i]!;
        const ex = U.x[i]! - cx - offsetX(packed);
        const ez = U.z[i]! - cz - offsetZ(packed);
        const e = Math.floor((ex * ex + ez * ez) / FX_ONE);
        if (e > worst) {
          worst = e;
          worstH = h;
        }
      }
      // worst = e² / FX_ONE in Fx units: compare with (1.5 WU)² = 2.25 · FX_ONE².
      return worst <= Math.floor((9 * FX_ONE) / 4) ? true : `unit ${worstH}: offset error² ${(worst / FX_ONE).toFixed(3)} WU² > 2.25`;
    })
    .invariant(1, 'no land unit in deep water', noLandInDeepWater)
    .invariant(1, 'no land unit on a nav cell blocked for its class', noLandOnBlockedCell)
    .build();
}

/**
 * `ridge-shift-queue` (MS3, G7): a group of 12 tanks gets three waypoints with Shift (queue); the
 * units complete them in order (each completion near its waypoint). Then three new queued
 * waypoints and a Stop: the queue is empty and the units stand still.
 */
export function ridgeShiftQueue(): Scenario {
  // Open lowland on the NW side of the river (every cell passable for all classes around them).
  const W = [
    [205, 110],
    [230, 215],
    [180, 240],
  ] as const;
  const b = new ScenarioBuilder('ridge-shift-queue').map({ path: HOLLOW_RIDGE_PATH }).seed(0x5eed0006).armies(2).ticks(1600);
  spawnBlock(b, 0, (i) => (i % 4 === 3 ? T2 : T1), 12, 100, 100, 4, 3);
  return b
    .at(2, (c) => {
      const g = c.handles(0);
      c.vars['g'] = g;
      c.vars['done'] = g.map(() => [] as number[]);
      c.vars['prev'] = g.map(() => 0);
      return [
        { kind: 'move', army: 0, units: g, x: W[0][0], z: W[0][1] },
        { kind: 'move', army: 0, units: g, x: W[1][0], z: W[1][1], queue: true },
        { kind: 'move', army: 0, units: g, x: W[2][0], z: W[2][1], queue: true },
      ];
    })
    .assert(2, 'three orders queued per unit', (c) => {
      for (const h of handlesVar(c, 'g')) if (c.info(h)!.orders !== 3) return `unit ${h}: ${c.info(h)!.orders} orders`;
      return true;
    })
    .invariant(1, 'queued waypoints are completed in order, each near its waypoint', (c) => {
      if (c.tick < 2 || c.tick > 1100) return true;
      const g = handlesVar(c, 'g');
      const done = c.vars['done'] as number[][];
      const prev = c.vars['prev'] as number[];
      for (let k = 0; k < g.length; k++) {
        const u = c.info(g[k]!)!;
        if (c.tick === 2) {
          prev[k] = u.orders;
          continue;
        }
        if (u.orders < prev[k]!) {
          const wp = 3 - prev[k]!; // index of the waypoint just completed
          if (wp < 0 || wp > 2) return `unit ${g[k]}: unexpected completion (${prev[k]} → ${u.orders})`;
          const d = Math.hypot(u.x / FX_ONE - W[wp]![0], u.z / FX_ONE - W[wp]![1]);
          if (d > 8) return `unit ${g[k]}: completed waypoint ${wp} ${d.toFixed(1)} WU away from it`;
          done[k]!.push(wp);
        }
        prev[k] = u.orders;
      }
      return true;
    })
    .assert(1100, 'every unit completed the three waypoints in order', (c) => {
      const done = c.vars['done'] as number[][];
      for (let k = 0; k < done.length; k++) if (done[k]!.join(',') !== '0,1,2') return `unit ${k}: order ${done[k]!.join(',')}`;
      for (const h of handlesVar(c, 'g')) if (c.info(h)!.orders !== 0) return `unit ${h} still has orders`;
      return true;
    })
    .at(1200, (c) => {
      const g = handlesVar(c, 'g');
      return [
        { kind: 'move', army: 0, units: g, x: 205, z: 150, queue: false },
        { kind: 'move', army: 0, units: g, x: 150, z: 200, queue: true },
        { kind: 'move', army: 0, units: g, x: 205, z: 110, queue: true },
      ];
    })
    .assert(1240, 'the new queue is running', (c) => {
      for (const h of handlesVar(c, 'g')) {
        const u = c.info(h)!;
        if (u.orders !== 3 || !u.moving) return `unit ${h}: ${u.orders} orders, moving ${u.moving}`;
      }
      return true;
    })
    .at(1241, (c) => ({ kind: 'stop', army: 0, units: handlesVar(c, 'g') }))
    .assert(1241, 'Stop empties the queue', (c) => {
      for (const h of handlesVar(c, 'g')) if (c.info(h)!.orders !== 0 || c.info(h)!.moving) return `unit ${h} still has orders or moves`;
      return true;
    })
    .assert(1300, 'after the Stop everyone stands still', (c) => {
      for (const h of handlesVar(c, 'g')) if (c.info(h)!.speed !== 0) return `unit ${h} speed ${c.info(h)!.speed}`;
      return true;
    })
    .invariant(1, 'no land unit on a nav cell blocked for its class', noLandOnBlockedCell)
    .build();
}

/**
 * `choke-3wu` (MS3 acceptance "Engstelle mit 3 WU: 100 Units in ≤ 60 s ohne Deadlock"): the
 * @faf/nav test map 'choke' (128 WU, a cliff wall with exactly one 3-WU gap), 100 T1 tanks as one
 * group through the gap. Deadlock = no further unit through for 150 ticks before all are.
 */
export function choke3wu(): Scenario {
  const { map, nav } = chokeMap();
  const gap = nav.choke!;
  const wallZ = gap.z; // blocked cell rows wallZ − 1 and wallZ
  const b = new ScenarioBuilder('choke-3wu').map({ rtsMap: map }).seed(0x5eed0007).armies(2).ticks(600);
  const cols = 14;
  spawnBlock(b, 0, () => T1, 100, gap.x + 1.5 - (cols * 2.6) / 2 + 1.3, wallZ - 8 - 7 * 2.6, cols, 2.6);
  const through = (c: ScenarioContext): number => {
    let n = 0;
    for (const h of handlesVar(c, 'g')) if (c.info(h)!.z > (wallZ + 1) * FX_ONE + 1843) n++;
    return n;
  };
  return b
    .assert(1, '100 tanks north of the wall', (c) => expectEq('army 0', c.count(0), 100))
    .at(2, (c) => {
      c.vars['g'] = c.handles(0);
      c.vars['best'] = 0;
      c.vars['bestTick'] = 2;
      c.vars['allAt'] = -1;
      return { kind: 'move', army: 0, units: c.handles(0), x: gap.x + 1.5, z: wallZ + 30 };
    })
    .invariant(1, 'no deadlock: some unit gets through at least every 150 ticks until all are through', (c) => {
      if (c.tick < 3 || (c.vars['allAt'] as number) >= 0) return true;
      const n = through(c);
      if (n > (c.vars['best'] as number)) {
        c.vars['best'] = n;
        c.vars['bestTick'] = c.tick;
      }
      if (n === 100) c.vars['allAt'] = c.tick;
      return c.tick - (c.vars['bestTick'] as number) <= 150 ? true : `deadlock: ${n}/100 through, no progress since tick ${c.vars['bestTick']}`;
    })
    .assert(600, 'all 100 through the 3-WU gap within 600 ticks (60 s)', (c) => {
      const at = c.vars['allAt'] as number;
      return at >= 0 && at <= 600 ? true : `only ${through(c)}/100 through`;
    })
    .invariant(1, 'no land unit on a nav cell blocked for its class', noLandOnBlockedCell)
    .build();
}

/**
 * `obstacle-repath` (MS3 acceptance "Repath-Sturm"): 200 tanks drive across hollow-ridge with 200
 * single path requests; 20 footprints are stamped by cheat near their routes. After every stamp
 * the number of paths marked for a repath (`repathsTriggered`) equals the brute-force corridor
 * rule (@faf/nav/check, independent of the nav implementation) evaluated on the state right
 * before the stamp.
 */
export function obstacleRepath(): Scenario {
  const STAMPS = 20;
  const b = new ScenarioBuilder('obstacle-repath')
    .map({ path: HOLLOW_RIDGE_PATH })
    .seed(0x5eed0008)
    .armies(2)
    .ticks(300)
    .spawn({ army: 0, count: 100, x: 100, z: 100, spread: 20, bp: T1 })
    .spawn({ army: 0, count: 100, x: 412, z: 412, spread: 20, bp: T1 });
  const targets = [
    [400, 300],
    [300, 400],
    [380, 150],
    [150, 380],
    [256, 120],
    [120, 256],
    [200, 180],
    [330, 330],
  ] as const;
  b.assert(1, '200 tanks spawned', (c) => expectEq('army 0', c.count(0), 200));
  b.at(2, (c) => {
    const hs = c.handles(0);
    c.vars['req0'] = c.world.nav.requestsIssued;
    c.vars['marked'] = 0;
    // One order per unit: 200 single requests.
    return hs.map((h, i) => {
      const [x, z] = targets[(i * 5 + (i >> 3)) % targets.length]!;
      return { kind: 'move' as const, army: 0, units: [h], x: x + (i % 7) - 3, z: z + ((i >> 2) % 7) - 3 };
    });
  });
  b.assert(2, '200 single orders ⇒ 200 path requests', (c) => expectEq('requests', c.world.nav.requestsIssued - (c.vars['req0'] as number), 200));
  for (let k = 0; k < STAMPS; k++) {
    const t = 20 + k * 10;
    b.at(t, (c) => {
      const w = c.world;
      const nav = w.nav;
      const hs = c.handles(0);
      // Footprint on the route of a unit: around its current steering point.
      const u = c.info(hs[(k * 37) % hs.length]!)!;
      const fw = 3 + (k % 6);
      const fh = 3 + ((k * 5) % 6);
      const x = (u.steerX >> 12) - (fw >> 1) + (k % 5) - 2;
      const z = (u.steerZ >> 12) - (fh >> 1) + ((k * 3) % 5) - 2;
      // Brute-force input: every live path as it is right before the stamp.
      const paths = nav.st.paths;
      const before: { p: number; d: PathDebug; eligible: boolean }[] = [];
      for (let p = 0; p < paths.highWater; p++) {
        if (paths.alive[p] !== 1) continue;
        const d = nav.pathDebug(p);
        before.push({ p, d, eligible: (d.state === PATH_READY || d.state === PATH_DIRECT) && (d.flags & PATH_F_REPATH) === 0 });
      }
      c.vars['stamp'] = { rect: clipFootprint(w.mapSizeWu, x, z, fw, fh), before, graph: copyNavGraph(nav), counter: nav.repathsTriggered };
      return { kind: 'footprint', army: 0, x, z, w: fw, h: fh };
    });
    b.assert(t, `stamp ${k + 1}: repathsTriggered == brute-force corridor cut`, (c) => {
      const st = c.vars['stamp'] as { rect: [number, number, number, number]; before: { p: number; d: PathDebug; eligible: boolean }[]; graph: NavGraphCopy; counter: number };
      const nav = c.world.nav;
      const after = copyNavGraph(nav);
      let expected = 0;
      for (const e of st.before) if (e.eligible && corridorCutBrute(nav, e.d, st.rect, st.graph, after)) expected++;
      const got = nav.repathsTriggered - st.counter;
      c.vars['marked'] = (c.vars['marked'] as number) + got;
      return expectEq('marked paths', got, expected);
    });
  }
  return b
    .assert(300, 'the storm is meaningful: some stamps cut corridors, most paths stay untouched', (c) => {
      const m = c.vars['marked'] as number;
      return m > 0 && m < STAMPS * 100 ? true : `marked ${m}`;
    })
    .invariant(1, 'no land unit on a nav cell blocked for its class', noLandOnBlockedCell)
    .invariant(1, 'no land unit in deep water', noLandInDeepWater)
    .build();
}

/** All golden scenarios by name. */
export const SCENARIOS: Readonly<Record<string, () => Scenario>> = {
  'cubes-1000-move': cubes1000Move,
  'cubes-churn': cubesChurn,
  'ridge-1000-move': ridge1000Move,
  'ridge-water-block': ridgeWaterBlock,
  'ridge-group-offset': ridgeGroupOffset,
  'ridge-shift-queue': ridgeShiftQueue,
  'choke-3wu': choke3wu,
  'obstacle-repath': obstacleRepath,
};

export const SCENARIO_NAMES: readonly string[] = Object.keys(SCENARIOS);

export function scenarioByName(name: string): Scenario {
  const f = SCENARIOS[name];
  if (f === undefined) throw new RangeError(`unknown scenario '${name}'`);
  return f();
}
