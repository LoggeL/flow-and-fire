/**
 * Phase 2 Orders (MS1: Move arrival) and phase 7 Movement (PLAN §3.4, §3.8 MS1 subset):
 * prev = cur, yaw towards the target with the turn rate (angRotateTowards on atan2A), speed
 * ramps with the acceleration (braking distance respected), Fx integration along the heading,
 * then a simple integer separation push against ≤ 8 overlapping neighbors from the fine grid,
 * iterated in dense order (each unit moves only itself, by half the overlap).
 *
 * Everything is integer math through @faf/fixed; no allocation.
 */
import { ANG_QUARTER, angDiff, asAng16, asFx, atan2A, cosA, fxMul, isqrt, rng32, sinA, angRotateTowards } from '@faf/fixed';
import {
  ARRIVE_TOLERANCE,
  CONTAGION_MAX_DIST,
  MAX_SEPARATION_NEIGHBORS,
  MoverBits,
  MoverState,
  SALT_SEPARATION,
  UnitBits,
  UnitState,
} from './constants.ts';
import { WH_SEED, WH_TICK } from './schema.ts';
import type { World } from './world.ts';

const ARRIVE_TOL2 = ARRIVE_TOLERANCE * ARRIVE_TOLERANCE;
const CONTAGION2 = CONTAGION_MAX_DIST * CONTAGION_MAX_DIST;
const NOT_FRESH = ~UnitBits.Fresh;
const NOT_NO_INTERP = ~UnitBits.NoInterp;

/** Phase 2: a moving unit within the arrival tolerance (or touched by contagion) becomes idle. */
export function ordersPhase(w: World): void {
  const movers = w.movers;
  const n = movers.count;
  const owner = movers.owner;
  const M = movers.col;
  const U = w.units.col;
  for (let r = 0; r < n; r++) {
    const f = M.flags[r]!;
    const touched = (f & MoverBits.TouchedArrived) !== 0;
    M.flags[r] = f & MoverBits.Asleep;
    if (M.state[r] !== MoverState.Moving) continue;
    const u = owner[r]!;
    if ((U.flags[u]! & UnitBits.Dead) !== 0) continue;
    const dx = M.tx[r]! - U.x[u]!;
    const dz = M.tz[r]! - U.z[u]!;
    const d2 = dx * dx + dz * dz;
    if (d2 <= ARRIVE_TOL2 || (touched && d2 <= CONTAGION2)) {
      M.state[r] = MoverState.Idle;
      U.state[u] = UnitState.Idle;
    }
  }
}

function clamp(v: number, max: number): number {
  return v < 0 ? 0 : v > max ? max : v;
}

/** prev = cur for every live unit; NoInterp survives exactly the tick of the spawn. */
function beginMovement(w: World): void {
  const units = w.units;
  const alive = units.alive;
  const U = units.col;
  const hw = units.highWater;
  for (let i = 0; i < hw; i++) {
    if (alive[i] !== 1) continue;
    U.px[i] = U.x[i]!;
    U.py[i] = U.y[i]!;
    U.pz[i] = U.z[i]!;
    U.pyaw[i] = U.yaw[i]!;
    const f = U.flags[i]!;
    if ((f & UnitBits.Fresh) !== 0) U.flags[i] = (f & NOT_FRESH) >>> 0;
    else if ((f & UnitBits.NoInterp) !== 0) U.flags[i] = (f & NOT_NO_INTERP) >>> 0;
  }
}

/** Steering + integration of every mover. */
function integrate(w: World): void {
  const movers = w.movers;
  const n = movers.count;
  const owner = movers.owner;
  const M = movers.col;
  const U = w.units.col;
  const t = w.bp;
  const mapMax = w.mapMax;
  for (let r = 0; r < n; r++) {
    const u = owner[r]!;
    if ((U.flags[u]! & UnitBits.Dead) !== 0) continue;
    const bp = U.bp[u]!;
    const acc = t.accel[bp]!;
    let v = M.speed[r]!;
    let yaw = U.yaw[u]!;
    const x = U.x[u]!;
    const z = U.z[u]!;
    let vTarget = 0;
    let maxStep = 0x7fffffff;
    if (M.state[r] === MoverState.Moving) {
      const dx = M.tx[r]! - x;
      const dz = M.tz[r]! - z;
      const dist = isqrt(dx * dx + dz * dz);
      maxStep = dist;
      if (dist > 0) {
        const desired = atan2A(dz, dx);
        yaw = angRotateTowards(asAng16(yaw), desired, t.turnRate[bp]!);
        const err = Math.abs(angDiff(asAng16(yaw), desired));
        if (err < ANG_QUARTER) {
          const maxV = t.speed[bp]!;
          // Slow down while the heading error is large (tracks turn nearly on the spot).
          vTarget = Math.floor((maxV * (ANG_QUARTER - err)) / ANG_QUARTER);
          const vBrake = isqrt(2 * acc * dist);
          if (vBrake < vTarget) vTarget = vBrake;
        }
      }
    }
    if (v < vTarget) v = v + acc > vTarget ? vTarget : v + acc;
    else if (v > vTarget) v = v - acc < vTarget ? vTarget : v - acc;
    M.speed[r] = v;
    U.yaw[u] = yaw;
    const stepLen = v < maxStep ? v : maxStep;
    if (stepLen <= 0) {
      U.vx[u] = 0;
      U.vz[u] = 0;
      continue;
    }
    const a = asAng16(yaw);
    const vx = fxMul(cosA(a), asFx(stepLen));
    const vz = fxMul(sinA(a), asFx(stepLen));
    U.vx[u] = vx;
    U.vz[u] = vz;
    U.x[u] = clamp(x + vx, mapMax);
    U.z[u] = clamp(z + vz, mapMax);
  }
}

/**
 * Separation push against overlapping neighbors from the fine grid. Idle, resting units without
 * overlap fall asleep and skip their own query; a unit that finds an overlapping sleeper wakes it.
 */
function separate(w: World): void {
  const movers = w.movers;
  const n = movers.count;
  const owner = movers.owner;
  const M = movers.col;
  const MS = M.state;
  const MF = M.flags;
  const MV = M.speed;
  const TX = M.tx;
  const TZ = M.tz;
  const U = w.units.col;
  const X = U.x;
  const Z = U.z;
  const BP = U.bp;
  const MOVER = U.mover;
  const flags = U.flags;
  const radius = w.bp.radiusCol;
  const g = w.fine;
  const dim = g.dim;
  const shift = g.shift;
  const start = g.start;
  const items = g.items;
  const mapMax = w.mapMax;
  const seed = w.header.u32[WH_SEED]!;
  const tick = w.header.i32[WH_TICK]!;
  // Grid positions are one tick old: widen the query by the largest possible displacement.
  const margin = w.maxRadius + 2 * w.maxSpeedPerTick;
  for (let r = 0; r < n; r++) {
    const mf = MF[r]!;
    if ((mf & MoverBits.Asleep) !== 0 && MS[r] !== MoverState.Moving) continue;
    const u = owner[r]!;
    if ((flags[u]! & UnitBits.Dead) !== 0) continue;
    const ri = radius[BP[u]!]!;
    const xu = X[u]!;
    const zu = Z[u]!;
    const reach = ri + margin;
    let x0 = (xu - reach) >> shift;
    let x1 = (xu + reach) >> shift;
    let z0 = (zu - reach) >> shift;
    let z1 = (zu + reach) >> shift;
    if (x0 < 0) x0 = 0;
    if (z0 < 0) z0 = 0;
    if (x1 >= dim) x1 = dim - 1;
    if (z1 >= dim) z1 = dim - 1;
    const moving = MS[r] === MoverState.Moving;
    const tx = TX[r]!;
    const tz = TZ[r]!;
    let sx = 0;
    let sz = 0;
    let found = 0;
    let touched = 0;
    for (let cz = z0; cz <= z1 && found < MAX_SEPARATION_NEIGHBORS; cz++) {
      const row = cz * dim;
      for (let cx = x0; cx <= x1 && found < MAX_SEPARATION_NEIGHBORS; cx++) {
        const c = row + cx;
        const end = start[c + 1]!;
        for (let k = start[c]!; k < end; k++) {
          const v = items[k]!;
          if (v === u) continue;
          const minD = ri + radius[BP[v]!]!;
          const dx = xu - X[v]!;
          if (dx >= minD || dx <= -minD) continue;
          const dz = zu - Z[v]!;
          if (dz >= minD || dz <= -minD) continue;
          const d2 = dx * dx + dz * dz;
          if (d2 >= minD * minD || (flags[v]! & UnitBits.Dead) !== 0) continue;
          const d = isqrt(d2);
          const push = (minD - d + 1) >> 1;
          if (d === 0) {
            // Exactly coincident: deterministic pseudo-random direction per (tick, pair).
            const a = asAng16(rng32(seed, tick, u, (SALT_SEPARATION + v) | 0) & 0xffff);
            sx += fxMul(cosA(a), asFx(push));
            sz += fxMul(sinA(a), asFx(push));
          } else {
            sx += Math.trunc((dx * push) / d);
            sz += Math.trunc((dz * push) / d);
          }
          const rv = MOVER[v]!;
          if (rv >= 0) {
            const vf = MF[rv]!;
            if ((vf & MoverBits.Asleep) !== 0) MF[rv] = vf & ~MoverBits.Asleep;
            if (moving && MS[rv] === MoverState.Idle && TX[rv] === tx && TZ[rv] === tz) touched = MoverBits.TouchedArrived;
          }
          found++;
          if (found >= MAX_SEPARATION_NEIGHBORS) break;
        }
      }
    }
    if (sx !== 0 || sz !== 0) {
      X[u] = clamp(xu + sx, mapMax);
      Z[u] = clamp(zu + sz, mapMax);
    }
    // Fall asleep when idle, at rest and without overlap.
    const sleep = found === 0 && !moving && MV[r] === 0 ? MoverBits.Asleep : 0;
    MF[r] = mf | touched | sleep;
  }
}

/** Phase 7 Movement. */
export function movementPhase(w: World): void {
  beginMovement(w);
  integrate(w);
  separate(w);
}
