/**
 * MS3 bench driver (tools only, not simulation code: floats and clocks are fine here): a sim world
 * on an RtsMap plus a command queue that is encoded into a real protocol batch per step (Move,
 * Stop, cheat spawn/footprint with a per-army seq), placement of units on cells passable for their
 * class, and the metrics helpers the MS3 benchmarks share (route length, offset error, invariants).
 *
 * Everything here only reads the world between steps (or inside a PhaseProbe callback); the sim is
 * driven exclusively through `step` with command batches, exactly like the host does.
 */
import { asArmyId, asFx, asTick, fx, FX_ONE, rng32, type Fx, type Handle } from '@faf/fixed';
import { mapSimData, type RtsMap } from '@faf/formats';
import { navClassOf, PATH_PENDING, WP_LAST } from '@faf/nav';
import { CmdFlags, CommandBatchEncoder, encodeCheatFootprint, encodeCheatSpawn, encodeMove, Op } from '@faf/protocol';
import { MotionLayer } from '@faf/rules';
import {
  createWorld,
  isBlockedFor,
  MoverBits,
  MoverState,
  offsetX,
  offsetZ,
  step,
  unitClass,
  unitHandles,
  type PhaseProbe,
  type World,
} from '@faf/sim';

/** Blueprints of the MS3 benches (content/blueprints/core/units). */
export const BP_T1 = 'core:lnd_t1_tank'; // class 1, r 0.45, 3.0 WU/s
export const BP_T2 = 'core:lnd_t2_tank'; // class 2, r 0.75, 2.8 WU/s
export const BP_T3 = 'core:lnd_t3_heavy'; // class 3, r 1.2, 1.9 WU/s
export const TANKS: readonly string[] = [BP_T1, BP_T2, BP_T3];

/** Blueprint of unit number i in a mixed set: 40 % T1, 35 % T2, 25 % T3 (deterministic pattern). */
export function mixedTank(i: number): string {
  const k = i % 20;
  return k < 8 ? BP_T1 : k < 15 ? BP_T2 : BP_T3;
}

/** One queued command (coordinates in WU unless noted). */
type Queued =
  | { readonly op: 'move'; readonly army: number; readonly units: readonly Handle[]; readonly x: number; readonly z: number; readonly queue: boolean }
  | { readonly op: 'stop'; readonly army: number; readonly units: readonly Handle[] }
  | { readonly op: 'spawn'; readonly army: number; readonly bp: number; readonly count: number; readonly x: number; readonly z: number; readonly spread: number }
  | { readonly op: 'footprint'; readonly cellX: number; readonly cellZ: number; readonly w: number; readonly h: number; readonly delta: 1 | -1 };

export interface DriverOptions {
  readonly simBin: Uint8Array;
  readonly map: RtsMap;
  readonly seed: number;
  readonly armies?: number;
}

/** A sim world driven through protocol batches. */
export class SimDriver {
  readonly w: World;
  readonly map: RtsMap;
  private readonly enc = new CommandBatchEncoder(1 << 16);
  private readonly seqs = new Int32Array(16);
  private queue: Queued[] = [];

  constructor(o: DriverOptions) {
    this.map = o.map;
    this.w = createWorld({ simBin: o.simBin, seed: o.seed, armyCount: o.armies ?? 2, map: mapSimData(o.map) });
  }

  get tick(): number {
    return this.w.tick;
  }

  bp(id: string): number {
    const i = this.w.bp.indexOf(id);
    if (i < 0) throw new RangeError(`unknown blueprint '${id}'`);
    return i;
  }

  /** Nav class of a blueprint (sizeClass rule of DECISIONS 23). */
  classOfBp(id: string): number {
    return navClassOf(this.w.bp.sizeClassCol[this.bp(id)]!);
  }

  move(army: number, units: readonly Handle[], x: number, z: number, queue = false): void {
    this.queue.push({ op: 'move', army, units, x, z, queue });
  }

  stop(army: number, units: readonly Handle[]): void {
    this.queue.push({ op: 'stop', army, units });
  }

  spawn(army: number, bp: string, count: number, x: number, z: number, spread: number): void {
    this.queue.push({ op: 'spawn', army, bp: this.bp(bp), count, x, z, spread });
  }

  /** Footprint cheat (cells = WU, rectangle [x, x+w) × [z, z+h)). */
  footprint(cellX: number, cellZ: number, w: number, h: number, delta: 1 | -1 = 1): void {
    this.queue.push({ op: 'footprint', cellX, cellZ, w, h, delta });
  }

  /** Number of commands queued for the next step. */
  get queued(): number {
    return this.queue.length;
  }

  /** Encodes the queued commands and advances the world by one tick. */
  step(probe?: PhaseProbe): void {
    const batch = this.encodeQueued();
    step(this.w, batch, probe);
  }

  /** Encodes and clears the queue (null if empty); the bytes stay valid until the next call. */
  encodeQueued(): Uint8Array | null {
    if (this.queue.length === 0) return null;
    const enc = this.enc.reset();
    const tick = asTick(this.w.tick + 1);
    for (const c of this.queue) {
      const army = c.op === 'footprint' ? 0 : c.army;
      const seq = (this.seqs[army] = (this.seqs[army]! + 1) & 0xffff);
      const a = asArmyId(army);
      switch (c.op) {
        case 'move':
          enc.add({ tick, army: a, seq, op: Op.Move, flags: c.queue ? CmdFlags.Queue : 0, units: c.units, payload: encodeMove({ x: fxW(c.x), y: fx(0), z: fxW(c.z) }) });
          break;
        case 'stop':
          enc.add({ tick, army: a, seq, op: Op.Stop, flags: 0, units: c.units, payload: new Uint8Array(0) });
          break;
        case 'spawn':
          enc.add({ tick, army: a, seq, op: Op.Cheat, flags: 0, units: [], payload: encodeCheatSpawn({ bp: c.bp, army: c.army, count: c.count, x: fxW(c.x), z: fxW(c.z), spread: fxW(c.spread) }) });
          break;
        case 'footprint':
          enc.add({ tick, army: a, seq, op: Op.Cheat, flags: 0, units: [], payload: encodeCheatFootprint({ cellX: c.cellX, cellZ: c.cellZ, w: c.w, h: c.h, delta: c.delta }) });
          break;
      }
    }
    this.queue = [];
    return enc.view();
  }

  /** Live handles of an army in slot order (= spawn order in a fresh world). */
  handles(army: number): Handle[] {
    return unitHandles(this.w, army);
  }

  /** True if a land unit of class `cls` may stand at (x, z) WU (passable nav cell, no deep water). */
  free(x: number, z: number, cls: number): boolean {
    const size = this.w.mapSizeWu;
    if (x < 2 || z < 2 || x > size - 2 || z > size - 2) return false;
    return !isBlockedFor(this.w, MotionLayer.Land, fxW(x), fxW(z), cls);
  }

  /**
   * Queues single spawns of `bps.length` units (one per entry) on a square grid of `spacing` WU,
   * walking outwards from (cx, cz) ring by ring; a point is used when it is free for the unit's
   * class and every cell within `class` WU around it is free for class 1 (no unit touches a cliff).
   * Returns the points (WU). Throws if the area cannot hold all units.
   */
  place(army: number, bps: readonly string[], cx: number, cz: number, spacing: number, maxRing = 40): [number, number][] {
    const pts: [number, number][] = [];
    let k = 0;
    for (let ring = 0; ring <= maxRing && k < bps.length; ring++) {
      for (let dz = -ring; dz <= ring && k < bps.length; dz++) {
        for (let dx = -ring; dx <= ring && k < bps.length; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          const x = cx + dx * spacing;
          const z = cz + dz * spacing;
          const bp = bps[k]!;
          const cls = this.classOfBp(bp);
          if (!this.free(x, z, cls) || !this.areaFree(x, z, cls)) continue;
          this.spawn(army, bp, 1, x, z, 0);
          pts.push([x, z]);
          k++;
        }
      }
    }
    if (k < bps.length) throw new Error(`place: only ${k}/${bps.length} free points around (${cx}, ${cz})`);
    return pts;
  }

  private areaFree(x: number, z: number, r: number): boolean {
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) if (!this.free(x + dx, z + dz, 1)) return false;
    return true;
  }

  /** Random free point (WU, cell centre) for class `cls` (deterministic in (seed, i)). */
  randomFree(seed: number, i: number, cls: number, margin = 8): [number, number] {
    const size = this.w.mapSizeWu;
    for (let t = 0; t < 10_000; t++) {
      const x = margin + (rng32(seed, i, t, 1) % (size - 2 * margin)) + 0.5;
      const z = margin + (rng32(seed, i, t, 2) % (size - 2 * margin)) + 0.5;
      if (this.free(x, z, cls) && this.areaFree(x, z, cls)) return [x, z];
    }
    throw new Error('randomFree: no free point');
  }
}

/** WU (float) → Fx raw (rounded to 1/4096). */
export function fxW(v: number): Fx {
  return asFx(Math.round(v * FX_ONE));
}

/** Slot of a handle (−1 if dead/stale). */
export function slotOf(w: World, h: Handle): number {
  return w.units.resolve(h);
}

/** True if the unit executes an order or drives back to its slot. */
export function isMoving(w: World, slot: number): boolean {
  const r = w.units.col.mover[slot]!;
  return r >= 0 && w.movers.col.state[r] !== MoverState.Idle;
}

/** True if the unit has no queued orders and is not moving (order completed or given up). */
export function isIdle(w: World, slot: number): boolean {
  const r = w.units.col.mover[slot]!;
  return r < 0 || (w.movers.col.state[r] === MoverState.Idle && w.movers.col.orders[r] === 0);
}

const ROUTE_PTS = new Int32Array(2 * 256);
const PT = new Int32Array(2);

/**
 * Remaining route length (WU) of a moving unit: current position → side-step point (if any) →
 * the remaining points of its path (group path: from its own index, shifted by its offset) →
 * its slot. Units on the final leg or with a pending path: straight distance to the slot.
 */
export function routeLength(w: World, slot: number): number {
  const U = w.units.col;
  const r = U.mover[slot]!;
  if (r < 0) return 0;
  const M = w.movers.col;
  if (M.state[r] === MoverState.Idle) return 0;
  let x = U.x[slot]! / FX_ONE;
  let z = U.z[slot]! / FX_ONE;
  const tx = M.tx[r]! / FX_ONE;
  const tz = M.tz[r]! / FX_ONE;
  let len = 0;
  const mf = M.flags[r]!;
  if ((mf & MoverBits.Detour) !== 0) {
    const dx = M.wx[r]! / FX_ONE;
    const dz = M.wz[r]! / FX_ONE;
    len += Math.hypot(dx - x, dz - z);
    x = dx;
    z = dz;
  }
  const p = M.path[r]!;
  const nav = w.nav;
  if ((mf & MoverBits.FinalLeg) === 0 && p >= 0 && nav.pathState(p) !== PATH_PENDING) {
    const f = U.formation[slot]!;
    const own = (mf & MoverBits.OwnPath) !== 0;
    const group = !own && f >= 0 && w.formations.col.path[f] === p;
    let skip = 0;
    let ox = 0;
    let oz = 0;
    if (group) {
      const d = M.wp[r]! - w.formations.col.consumed[f]!;
      skip = d > 0 ? d : 0;
      ox = offsetX(U.groupOffset[slot]!) / FX_ONE;
      oz = offsetZ(U.groupOffset[slot]!) / FX_ONE;
    }
    const n = nav.remainingPoints(p, ROUTE_PTS, 256, skip);
    for (let k = 0; k < n; k++) {
      if (k === n - 1 && nav.pointAt(p, skip + k, PT) === WP_LAST) break; // the anchor: the slot follows
      const px = ROUTE_PTS[2 * k]! / FX_ONE + ox;
      const pz = ROUTE_PTS[2 * k + 1]! / FX_ONE + oz;
      len += Math.hypot(px - x, pz - z);
      x = px;
      z = pz;
    }
  }
  return len + Math.hypot(tx - x, tz - z);
}

/** First violated land invariant (blocked cell for the class or deep water) or null. */
export function landViolation(w: World): string | null {
  const U = w.units.col;
  const hw = w.units.highWater;
  for (let i = 0; i < hw; i++) {
    if (w.units.alive[i] !== 1 || U.layer[i] !== MotionLayer.Land) continue;
    const cls = unitClass(w, i);
    if (isBlockedFor(w, MotionLayer.Land, U.x[i]!, U.z[i]!, cls)) {
      return `tick ${w.tick}: slot ${i} (class ${cls}) on a blocked cell or in deep water at (${(U.x[i]! / FX_ONE).toFixed(2)}, ${(U.z[i]! / FX_ONE).toFixed(2)})`;
    }
  }
  return null;
}

/**
 * Offset errors (WU) of a group: distance of each unit from centroid + its compressed offset
 * (Units.groupOffset of the last group order), the metric of the offset golden.
 */
export function offsetErrors(w: World, units: readonly Handle[]): number[] {
  const U = w.units.col;
  let cx = 0;
  let cz = 0;
  let n = 0;
  for (const h of units) {
    const i = slotOf(w, h);
    if (i < 0) continue;
    cx += U.x[i]!;
    cz += U.z[i]!;
    n++;
  }
  if (n === 0) return [];
  cx /= n;
  cz /= n;
  const out: number[] = [];
  for (const h of units) {
    const i = slotOf(w, h);
    if (i < 0) continue;
    const packed = U.groupOffset[i]!;
    out.push(Math.hypot(U.x[i]! - cx - offsetX(packed), U.z[i]! - cz - offsetZ(packed)) / FX_ONE);
  }
  return out;
}

/** p-quantile (nearest rank) of a number list. */
export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const s = values.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))]!;
}

/** Distribution summary of a number list (p50/p95/max, mean). */
export interface Dist {
  readonly n: number;
  readonly mean: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
}

export function dist(values: readonly number[]): Dist {
  if (values.length === 0) return { n: 0, mean: 0, p50: 0, p95: 0, max: 0 };
  let s = 0;
  let m = -Infinity;
  for (const v of values) {
    s += v;
    if (v > m) m = v;
  }
  const r = (v: number): number => Math.round(v * 10000) / 10000;
  return { n: values.length, mean: r(s / values.length), p50: r(quantile(values, 0.5)), p95: r(quantile(values, 0.95)), max: r(m) };
}
