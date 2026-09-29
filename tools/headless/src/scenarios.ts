/**
 * The L2 golden scenarios of MS1 (PLAN §3.12, §5.2 "≥ 2 L2-Goldens").
 *
 * - `cubes-1000-move`: 1,000 cubes (cheat spawn, 2 armies), group moves at 2/300/700/1,100/1,500.
 * - `cubes-churn`: spawn/kill/respawn with FIFO slot reuse, Stop, a second army, a command on
 *   foreign units that must be rejected, a full wipe + regrowth of one army.
 *
 * Tick 1 carries the cheat spawns; the first move group follows in tick 2 because handles only
 * exist after the spawn step (see docs/status/P6-headless.md, deviations).
 */
import { FX_ONE, handleGen, handleIndex, type Handle } from '@faf/fixed';
import { ScenarioBuilder, type Scenario, type ScenarioContext } from './scenario.ts';

const MAP = 512;

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

/** All golden scenarios by name. */
export const SCENARIOS: Readonly<Record<string, () => Scenario>> = {
  'cubes-1000-move': cubes1000Move,
  'cubes-churn': cubesChurn,
};

export const SCENARIO_NAMES: readonly string[] = Object.keys(SCENARIOS);

export function scenarioByName(name: string): Scenario {
  const f = SCENARIOS[name];
  if (f === undefined) throw new RangeError(`unknown scenario '${name}'`);
  return f();
}
