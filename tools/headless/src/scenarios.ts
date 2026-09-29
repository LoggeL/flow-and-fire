/**
 * The L2 golden scenarios (PLAN §3.12, §5.2 "≥ 2 L2-Goldens").
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
 * Setons (default map, content/maps/setons.rtsmap, 1,024 WU):
 * - `setons-bridge-move`: both mid armies drive over the land bridge to the enemy mid start and
 *   push through each other in the centre; a group ordered into the NW lake stops at the shore.
 * All map scenarios check after every tick that no land unit stands in deep water and every
 * 10 ticks that y == rules.sampleHeightRaw for every unit.
 *
 * Tick 1 carries the cheat spawns; the first move group follows in tick 2 because handles only
 * exist after the spawn step (see docs/status/P6-headless.md, deviations).
 */
import { FX_ONE, handleGen, handleIndex, type Handle } from '@faf/fixed';
import { LAND_MAX_WATER_DEPTH_RAW, MotionLayer, sampleHeightRaw } from '@faf/rules';
import { spawnRejectedCount, surfaceY } from '@faf/sim';
import { ScenarioBuilder, type Scenario, type ScenarioContext } from './scenario.ts';

const MAP = 512;
/** Repo-relative path of the MS2 reference map (loaded by the caller, see RunOptions.maps). */
export const HOLLOW_RIDGE_PATH = 'content/maps/hollow-ridge.rtsmap';
/** Repo-relative path of the default map Setons (1,024 WU, 8 starts). */
export const SETONS_PATH = 'content/maps/setons.rtsmap';

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
function noLandInDeepWater(ctx: ScenarioContext): true | string {
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

/** Invariant (M1/Sim): every unit stands on the terrain, y == rules.sampleHeightRaw(x, z). */
function yOnTerrain(ctx: ScenarioContext): true | string {
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
    .assert(1, 'spawned 700 + 300 on the plateaus', (c) =>
      all(expectEq('army 0', c.count(0), 700), expectEq('army 1', c.count(1), 300), expectEq('rejected', spawnRejectedCount(c.world), 0)),
    )
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
    .assert(1090, 'army 1 climbed back onto its plateau (y ≈ 24 WU)', (c) => {
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
    .invariant(10, 'y == sampleHeightRaw for every unit', yOnTerrain)
    .assert(2000, 'all 1,000 cubes alive', (c) => expectEq('units', c.total(), 1000))
    .assert(2000, 'all cubes inside the map', allInsideMap)
    .build();
}

/**
 * Deep water blocks, fords do not (MS2 golden #2). Group A (army 0) at (230, 170) is ordered to
 * (282, 342) straight across the lake; group B (army 1) at (320, 120) to (392, 192) through the
 * NE ford (356, 156) — the proposal of docs/status/ms2-p0-formats.md.
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
  /** Group A stayed on the NW side (x + z < 512, the river centre line) and far from its target. */
  const aOnBank = (c: ScenarioContext): true | string => {
    for (const h of handlesVar(c, 'A')) {
      const u = c.info(h)!;
      if (u.x + u.z >= 512 * FX_ONE) return `unit ${h} crossed the river centre line (x+z = ${(u.x + u.z) / FX_ONE})`;
    }
    return nearCount(c, handlesVar(c, 'A'), A_TARGET[0], A_TARGET[1], 60) === 0 ? true : 'a unit of group A got near its target';
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
      return [
        { kind: 'move', army: 0, units: c.handles(0), x: A_TARGET[0], z: A_TARGET[1] },
        { kind: 'move', army: 1, units: c.handles(1), x: B_TO[0], z: B_TO[1] },
      ];
    })
    // Cheat spawns into the lake (3.5 WU deep) and the river bed are rejected and counted.
    .at(5, () => [
      { kind: 'spawn', army: 0, count: 5, x: 256, z: 256, spread: 0 },
      { kind: 'spawn', army: 1, count: 5, x: 300, z: 212, spread: 2 },
    ])
    .assert(5, 'spawns into deep water are rejected', (c) =>
      all(expectEq('rejected', spawnRejectedCount(c.world), 10), expectEq('army 0', c.count(0), 40), expectEq('army 1', c.count(1), 30)),
    )
    .assert(600, 'group A stopped at the bank and is idle', (c) => all(allIdle(c, 'A'), aOnBank(c)))
    .assert(600, 'group B crossed the ford and reached its target', (c) => all(groupAt(c, 'B', B_TO[0], B_TO[1], 10), allIdle(c, 'B')))
    // Keep both groups busy: A along its bank and across again, B back and forth over the ford.
    .at(700, (c) => [
      { kind: 'move', army: 0, units: handlesVar(c, 'A'), x: 140, z: 290 },
      { kind: 'move', army: 1, units: handlesVar(c, 'B'), x: B_FROM[0], z: B_FROM[1] },
    ])
    .assert(1290, 'group B is back on the NW side of the ford', (c) => groupAt(c, 'B', B_FROM[0], B_FROM[1], 10))
    .at(1300, (c) => [
      { kind: 'move', army: 0, units: handlesVar(c, 'A'), x: 300, z: 380 },
      { kind: 'move', army: 1, units: handlesVar(c, 'B'), x: B_TO[0], z: B_TO[1] },
    ])
    .assert(2000, 'group A is again stuck on the NW bank', (c) => {
      for (const h of handlesVar(c, 'A')) {
        const u = c.info(h)!;
        if (u.x + u.z >= 512 * FX_ONE) return `unit ${h} crossed the river centre line (x+z = ${(u.x + u.z) / FX_ONE})`;
      }
      return allIdle(c, 'A');
    })
    .assert(2000, 'group B crossed the ford again and reached its target', (c) => groupAt(c, 'B', B_TO[0], B_TO[1], 10))
    .invariant(1, 'no land unit in deep water', noLandInDeepWater)
    .invariant(10, 'y == sampleHeightRaw for every unit', yOnTerrain)
    .assert(2000, 'unit counts', (c) => all(expectEq('army 0', c.count(0), 40), expectEq('army 1', c.count(1), 30)))
    .build();
}

/**
 * Setons golden: the two mid armies (starts 0 and 1, 458 WU apart) drive straight at each other's
 * start over the land bridge (the only ground route), meet in the centre and push through; a
 * quarter of army 0 is sent straight into the NW lake and must stop at the shore.
 */
export function setonsBridgeMove(): Scenario {
  const SW = [354, 678] as const;
  const NO = [670, 346] as const;
  const LAKE = [250, 250] as const;
  const MAP_EDGE = 1024;
  /** Units of `key` on the NO side of the team line x = z. */
  const onNoSide = (c: ScenarioContext, key: string): number => {
    let n = 0;
    for (const h of handlesVar(c, key)) {
      const u = c.info(h);
      if (u !== null && u.x > u.z) n++;
    }
    return n;
  };
  return new ScenarioBuilder('setons-bridge-move')
    .map({ path: SETONS_PATH })
    .seed(0x5eed0005)
    .armies(2)
    .ticks(2000)
    .spawn({ army: 0, count: 200, x: SW[0], z: SW[1], spread: 18 })
    .spawn({ army: 1, count: 200, x: NO[0], z: NO[1], spread: 18 })
    .assert(1, 'spawned 200 + 200 at the mid starts', (c) =>
      all(expectEq('army 0', c.count(0), 200), expectEq('army 1', c.count(1), 200), expectEq('rejected', spawnRejectedCount(c.world), 0)),
    )
    .at(2, (c) => {
      const a0 = c.handles(0);
      c.vars['main'] = part(a0, 0, 0.75);
      c.vars['lake'] = part(a0, 0.75, 1);
      c.vars['a1'] = c.handles(1);
      return [
        { kind: 'move', army: 0, units: part(a0, 0, 0.75), x: NO[0], z: NO[1] },
        { kind: 'move', army: 0, units: part(a0, 0.75, 1), x: LAKE[0], z: LAKE[1] },
        { kind: 'move', army: 1, units: c.handles(1), x: SW[0], z: SW[1] },
      ];
    })
    .assert(900, 'the lake group stopped at the NW-lake shore and is idle', (c) => {
      for (const h of handlesVar(c, 'lake')) {
        const u = c.info(h);
        if (u !== null && u.moving) return `unit ${h} still moving`;
      }
      return nearCount(c, handlesVar(c, 'lake'), LAKE[0], LAKE[1], 150) === 0 ? true : 'a unit got into the lake';
    })
    .assert(1000, 'both armies crossed the bridge centre', (c) => {
      const n0 = onNoSide(c, 'main');
      const n1 = 200 - onNoSide(c, 'a1');
      return n0 >= 120 && n1 >= 160 ? true : `crossed: army 0 ${n0}/150, army 1 ${n1}/200`;
    })
    .assert(1990, 'army 0 reached the NO mid start, army 1 the SW mid start', (c) => {
      const n0 = nearCount(c, handlesVar(c, 'main'), NO[0], NO[1], 80);
      const n1 = nearCount(c, handlesVar(c, 'a1'), SW[0], SW[1], 80);
      return n0 >= 120 && n1 >= 160 ? true : `at the target: army 0 ${n0}/150, army 1 ${n1}/200`;
    })
    .invariant(1, 'no land unit in deep water', noLandInDeepWater)
    .invariant(10, 'y == sampleHeightRaw for every unit', yOnTerrain)
    .assert(2000, 'all 400 cubes alive', (c) => expectEq('units', c.total(), 400))
    .assert(2000, 'all cubes inside the map', (c) => {
      const max = MAP_EDGE * FX_ONE;
      for (const h of c.handles()) {
        const u = c.info(h)!;
        if (u.x < 0 || u.z < 0 || u.x > max || u.z > max) return `unit ${h} outside the map`;
      }
      return true;
    })
    .build();
}

/** All golden scenarios by name. */
export const SCENARIOS: Readonly<Record<string, () => Scenario>> = {
  'cubes-1000-move': cubes1000Move,
  'cubes-churn': cubesChurn,
  'ridge-1000-move': ridge1000Move,
  'ridge-water-block': ridgeWaterBlock,
  'setons-bridge-move': setonsBridgeMove,
};

export const SCENARIO_NAMES: readonly string[] = Object.keys(SCENARIOS);

export function scenarioByName(name: string): Scenario {
  const f = SCENARIOS[name];
  if (f === undefined) throw new RangeError(`unknown scenario '${name}'`);
  return f();
}
