/**
 * The six SPK2 scenarios (PLAN §4): cross-map group (200), 3-WU choke (100), factory roll-off,
 * attack-move clump, wall gaps, offset preservation. Each builds a grid, spawns units from the
 * core unit types and issues its orders; `control` runs per tick (spawning, late orders).
 */
import { Spk2Grid } from './grid.ts';
import type { Spk2Params } from './params.ts';
import { rng, Spk2Sim, UnitState, type Spk2UnitType } from './sim.ts';

/**
 * Unit types mirroring the core blueprints (content/blueprints/core/units; a test compares them
 * with the compiled bundle).
 */
export const UNIT_TYPES: readonly Spk2UnitType[] = [
  { name: 'core:lnd_t1_scout', radius: 0.35, speed: 5.0, accel: 5.0, turnRateDeg: 180, sizeClass: 1, mass: 1 },
  { name: 'core:lnd_t1_tank', radius: 0.45, speed: 3.0, accel: 2.5, turnRateDeg: 90, sizeClass: 1 },
  { name: 'core:lnd_t1_arty', radius: 0.45, speed: 2.2, accel: 1.8, turnRateDeg: 70, sizeClass: 1 },
  { name: 'core:lnd_t2_tank', radius: 0.75, speed: 2.8, accel: 2.2, turnRateDeg: 75, sizeClass: 2 },
  { name: 'core:lnd_t3_heavy', radius: 1.2, speed: 1.9, accel: 1.2, turnRateDeg: 45, sizeClass: 3, mass: 24 },
];
export const T_SCOUT = 0;
export const T_T1 = 1;
export const T_ARTY = 2;
export const T_T2 = 3;
export const T_T3 = 4;

export type ScenarioId = 'cross-map' | 'choke' | 'rolloff' | 'clump' | 'wall-gaps' | 'offset';
export const SCENARIO_IDS: readonly ScenarioId[] = ['cross-map', 'choke', 'rolloff', 'clump', 'wall-gaps', 'offset'];

/** A group order whose offsets are checked at the end. */
export interface OffsetCheck {
  readonly units: readonly number[];
  /** Compressed offsets (x, z per unit). */
  readonly offsets: Float64Array;
}

export interface ScenarioRun {
  readonly id: ScenarioId;
  readonly sim: Spk2Sim;
  /** Tick limit. */
  readonly maxTicks: number;
  /** Called before every tick. */
  control(sim: Spk2Sim): void;
  /** True when the scenario goal is reached (all units through/arrived). */
  done(sim: Spk2Sim): boolean;
  /** Units that must reach their goal (metrics). */
  readonly offsetChecks: OffsetCheck[];
  /** Scenario-specific extras (reported). */
  readonly extra: Record<string, number>;
  /** Pass criteria beyond "no deadlock". */
  readonly criteria: { readonly maxSeconds?: number; readonly minNoStuckShare?: number; readonly maxOffsetP95?: number };
}

function mixType(i: number, mix: readonly (readonly [number, number])[]): number {
  let total = 0;
  for (const [, n] of mix) total += n;
  let r = i % total;
  for (const [t, n] of mix) {
    if (r < n) return t;
    r -= n;
  }
  return T_T1;
}

/** Places `n` units on a jittered grid inside the rectangle, skipping cells not passable for their class. */
function placeBlock(
  sim: Spk2Sim,
  n: number,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  typeOf: (i: number) => number,
  rand: () => number,
  yaw: number,
): number[] {
  const out: number[] = [];
  const spacing = 2.6;
  const cols = Math.max(1, Math.floor((x1 - x0) / spacing));
  let slot = 0;
  for (let i = 0; i < n; i++) {
    const t = typeOf(i);
    const type = UNIT_TYPES[t]!;
    for (let guard = 0; guard < 10_000; guard++, slot++) {
      const cx = x0 + (slot % cols) * spacing + spacing / 2 + (rand() - 0.5) * 0.6;
      const cz = z0 + Math.floor(slot / cols) * spacing + spacing / 2 + (rand() - 0.5) * 0.6;
      if (cz > z1) throw new RangeError('spk2: placement area too small');
      if (!sim.grid.passable(type.sizeClass, Math.floor(cx), Math.floor(cz))) continue;
      out.push(sim.spawn(type, t, cx, cz, yaw + (rand() - 0.5) * 0.8));
      slot++;
      break;
    }
  }
  return out;
}

function unitsThrough(sim: Spk2Sim, pred: (k: number) => boolean): boolean {
  for (let k = 0; k < sim.count; k++) if (!pred(k)) return false;
  return true;
}

function allSettled(sim: Spk2Sim): boolean {
  for (let k = 0; k < sim.count; k++) if (sim.state[k] === UnitState.Moving) return false;
  return true;
}

/** Builds scenario `id`. `quick` shortens nothing that the acceptance depends on (unit counts stay). */
export function buildScenario(id: ScenarioId, params: Spk2Params, seed: number): ScenarioRun {
  const rand = rng(seed * 7919 + id.length);
  switch (id) {
    case 'cross-map': {
      // 256 WU map: ridge with two passes, a lake, scattered rocks; 200 mixed units SW → NE.
      const g = new Spk2Grid(256, 256);
      g.fillRect(40, 124, 176, 6);
      g.fillRect(90, 124, 14, 6, 0);
      g.fillRect(160, 124, 12, 6, 0);
      g.fillDisc(190, 70, 24);
      g.fillDisc(70, 190, 18);
      for (let i = 0; i < 40; i++) {
        const x = 20 + rand() * 216;
        const z = 20 + rand() * 216;
        if ((x < 70 && z < 70) || (x > 200 && z > 200)) continue;
        g.fillDisc(x, z, 1 + rand() * 2.5);
      }
      g.rebuild();
      const sim = new Spk2Sim(g, params, 200);
      const mix = [
        [T_T1, 12],
        [T_SCOUT, 2],
        [T_ARTY, 2],
        [T_T2, 3],
        [T_T3, 1],
      ] as const;
      const units = placeBlock(sim, 200, 14, 14, 64, 64, (i) => mixType(i, mix), rand, 0);
      const offsets = sim.moveGroup(units, 224, 224);
      return {
        id,
        sim,
        maxTicks: 3000,
        control: () => undefined,
        done: allSettled,
        offsetChecks: [{ units, offsets }],
        extra: {},
        criteria: { minNoStuckShare: 0.95 },
      };
    }
    case 'choke': {
      // Wall across the map with one 3-WU gap; 100 T1 tanks pass it.
      const g = new Spk2Grid(96, 64);
      g.fillRect(47, 0, 3, 64);
      g.fillRect(47, 30, 3, 3, 0);
      g.rebuild();
      const sim = new Spk2Sim(g, params, 100);
      const units = placeBlock(sim, 100, 4, 6, 40, 60, () => T_T1, rand, 0);
      const offsets = sim.moveGroup(units, 78, 32);
      return {
        id,
        sim,
        maxTicks: 1200,
        control: () => undefined,
        done: (s) => unitsThrough(s, (k) => s.x[k]! > 50 + s.radius[k]!),
        offsetChecks: [{ units, offsets }],
        extra: {},
        criteria: { maxSeconds: 60 },
      };
    }
    case 'rolloff': {
      // Factory (7×7) with its gate on the south face; a unit rolls off every 12 ticks when the
      // gate is free and drives to the shared rally point. Waiting units block the gate.
      const g = new Spk2Grid(96, 96);
      g.fillRect(40, 40, 7, 7);
      g.rebuild();
      const total = 40;
      const sim = new Spk2Sim(g, params, total);
      const gateX = 43.5;
      const gateZ = 48.4;
      const rally = sim.newOrder();
      let spawned = 0;
      let nextSpawn = 1;
      const extra = { gateWaitMaxTicks: 0, spawned: 0 };
      let waitStart = -1;
      return {
        id,
        sim,
        maxTicks: 1500,
        control: (s) => {
          if (spawned >= total || s.tick + 1 < nextSpawn) return;
          const t = spawned % 5 === 4 ? T_T2 : T_T1;
          const r = UNIT_TYPES[t]!.radius;
          let free = true;
          for (let k = 0; k < s.count; k++) {
            if (Math.hypot(s.x[k]! - gateX, s.z[k]! - (gateZ + r)) < r + s.radius[k]! + 0.1) free = false;
          }
          if (!free) {
            if (waitStart < 0) waitStart = s.tick;
            extra.gateWaitMaxTicks = Math.max(extra.gateWaitMaxTicks, s.tick - waitStart);
            return;
          }
          waitStart = -1;
          const k = s.spawn(UNIT_TYPES[t]!, t, gateX, gateZ + r, Math.PI / 2);
          s.moveEach([k], gateX, 64, rally);
          spawned++;
          extra.spawned = spawned;
          nextSpawn = s.tick + 12;
        },
        done: (s) => spawned >= total && allSettled(s),
        offsetChecks: [],
        extra,
        criteria: {},
      };
    }
    case 'clump': {
      // Attack-move clump: 100 mixed units from a wide area onto one point (no offsets).
      const g = new Spk2Grid(128, 128);
      for (let i = 0; i < 12; i++) g.fillDisc(10 + rand() * 108, 10 + rand() * 108, 1 + rand() * 1.5);
      g.fillRect(58, 58, 12, 12, 0);
      g.rebuild();
      const sim = new Spk2Sim(g, params, 100);
      const mix = [
        [T_T1, 6],
        [T_SCOUT, 1],
        [T_T2, 2],
        [T_T3, 1],
      ] as const;
      const units: number[] = [];
      for (let i = 0; i < 100; i++) {
        const t = mixType(i, mix);
        const type = UNIT_TYPES[t]!;
        for (;;) {
          const x = 14 + rand() * 100;
          const z = 14 + rand() * 100;
          if (Math.hypot(x - 64, z - 64) < 20 || !g.passable(type.sizeClass, Math.floor(x), Math.floor(z))) continue;
          units.push(sim.spawn(type, t, x, z, rand() * Math.PI * 2));
          break;
        }
      }
      const order = sim.newOrder();
      sim.moveEach(units, 64, 64, order);
      return {
        id,
        sim,
        maxTicks: 1500,
        control: () => undefined,
        done: allSettled,
        offsetChecks: [],
        extra: {},
        criteria: {},
      };
    }
    case 'wall-gaps': {
      // Wall with gaps of 2, 4 and 6 WU; a mixed group (classes 1–3) passes north → south.
      const g = new Spk2Grid(128, 96);
      g.fillRect(0, 46, 128, 3);
      g.fillRect(20, 46, 2, 3, 0);
      g.fillRect(60, 46, 4, 3, 0);
      g.fillRect(100, 46, 6, 3, 0);
      g.rebuild();
      const sim = new Spk2Sim(g, params, 80);
      const mix = [
        [T_T1, 14],
        [T_T2, 4],
        [T_T3, 2],
      ] as const;
      const units = placeBlock(sim, 80, 40, 4, 90, 40, (i) => mixType(i, mix), rand, Math.PI / 2);
      const offsets = sim.moveGroup(units, 64, 78);
      return {
        id,
        sim,
        maxTicks: 1800,
        control: () => undefined,
        done: allSettled,
        offsetChecks: [{ units, offsets }],
        extra: {},
        criteria: {},
      };
    }
    case 'offset': {
      // Offset preservation: 60 units in three staggered rows, 40 WU wide, move 100 WU east.
      const g = new Spk2Grid(192, 128);
      g.rebuild();
      const sim = new Spk2Sim(g, params, 60);
      const units: number[] = [];
      for (let i = 0; i < 60; i++) {
        const row = Math.floor(i / 20);
        const col = i % 20;
        const t = row === 1 && col % 4 === 0 ? T_T2 : T_T1;
        units.push(sim.spawn(UNIT_TYPES[t]!, t, 30 + row * 3 + (col % 2) * 0.8, 44 + col * 2 + (rand() - 0.5) * 0.3, 0));
      }
      const offsets = sim.moveGroup(units, 140, 64);
      return {
        id,
        sim,
        maxTicks: 1200,
        control: () => undefined,
        done: allSettled,
        offsetChecks: [{ units, offsets }],
        extra: {},
        criteria: { maxOffsetP95: 1.5 },
      };
    }
  }
}
