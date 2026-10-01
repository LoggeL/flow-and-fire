/**
 * Phase 7 Movement (PLAN §3.4, §3.8; G8 kinematics, M7 steering) with the SPK2 parameter set
 * (DECISIONS 22, constants.ts). Per tick:
 *
 *  1. prev = cur (interpolation), group cursors reset.
 *  2. Per mover: steering point — path waypoint (group path + own offset where passable and in
 *     clearance LOS, else the waypoint itself), lazy refinement of the next segment (at most
 *     REFINE_SEGMENTS_PER_TICK per tick), LOS look-ahead every LOOKAHEAD_TICKS, final leg to the
 *     slot; while the path is pending the unit already drives towards its slot. Desired direction
 *     = target direction + separation (≤ 8 nearest neighbours) + gradient away from blocked cells.
 *     Tracked kinematics: turn rate, drive while turning below MOVE_START_ANGLE (slowed), pivot
 *     with creep speed above it, launch kick, accel/brake limits, braking curve to the slot,
 *     slope braking by nav cost level. Idle units brake and perform idle nudges.
 *  3. Fine grid rebuild, positional collision resolution (COLLISION_ITERATIONS passes, pairs once,
 *     shares by mass × priority: moving units weigh MOVING_PRIORITY × more), idle nudge for idle
 *     units pushed by moving ones, sleep.
 *  4. Arrival (final leg within ARRIVAL_RADIUS), arrival contagion per group anchor, stuck
 *     detection (< STUCK_EPSILON progress in STUCK_TICKS ⇒ Stuck flag for the Orders phase),
 *     slot return of pushed-off idle units.
 *  5. Group path cursors advance to the slowest member (nav.advance).
 *
 * Every position change goes through `placeUnit` (class passability + deep water, sliding).
 * Integer math through @faf/fixed only; no allocation.
 */
import { angDiff, angRotateTowards, asAng16, asFx, atan2A, cosA, fxMul, isqrt, rng32, sinA } from '@faf/fixed';
import { navClassOf, WP_END, WP_LAST, WP_NEED_REFINE, WP_NONE, WP_OK, WP_PENDING } from '@faf/nav';
import {
  ARRIVAL_RADIUS,
  CLEARANCE_MARGIN,
  CLEARANCE_STRENGTH,
  COLLISION_ITERATIONS,
  CONTAGION_DISTANCE,
  CONTAGION_GAP,
  CONTAGION_STALL_TICKS,
  FormationState,
  LOOKAHEAD_TICKS,
  MAX_SEPARATION_NEIGHBORS,
  MOVE_LAUNCH_BOOST,
  MOVE_PIVOT_CREEP,
  MOVE_START_ANGLE,
  MOVE_TURN_SLOWDOWN_MIN,
  MoverBits,
  MoverState,
  MOVING_PRIORITY,
  NO_BEST_DIST,
  NUDGE_SPEED,
  NUDGE_TICKS,
  REFINE_SEGMENTS_PER_TICK,
  RETURN_DELAY_TICKS,
  RETURN_DISTANCE,
  SALT_SEPARATION,
  SEPARATION_RANGE_FACTOR,
  SLOPE_SPEED_PERMILLE,
  STUCK_EPSILON,
  STUCK_TICKS,
  UnitBits,
  WAYPOINT_RADIUS,
} from './constants.ts';
import { finalizeSlot, offsetX, offsetZ } from './orders.ts';
import { WH_SEED, WH_TICK } from './schema.ts';
import { SC } from './scratch.ts';
import { rebuildGrid } from './spatial.ts';
import { navCellOf, placeUnit, Placement } from './terrain.ts';
import type { World } from './world.ts';

const NOT_FRESH = ~UnitBits.Fresh;
const NOT_NO_INTERP = ~UnitBits.NoInterp;
/** "No member" marker of Formations.minWp (a small integer, see obstacleGradient on boxing). */
const INT_MAX = 0x3fffffff;
/** Slot counts as taken if a standing unit is closer than ri + rj − this (0.05 WU). */
const SLOT_TAKEN_SLACK = 205;
/** The final-leg shortcut (free LOS to the slot) is tried within this distance (32 WU). */
const FINAL_LEG_LOS_RANGE = 32 * 4096;
/** Extra reach of the collision query for pushes inside the pass (0.25 WU). */
const COLLISION_DRIFT = 1024;
/** Units whose slots are compared by slotShared lie within this distance of the slot (6 WU). */
const SLOT_SHARE_RANGE = 6 * 4096;
/** Failed slot-return checks (every LOOKAHEAD_TICKS) before an idle unit keeps its new position. */
const RETURN_ATTEMPTS = 24;

/** Lazy refinement budget left in the current Movement phase (reset per phase; not state). */
let refineLeft = 0;

function clamp(v: number, max: number): number {
  return v < 0 ? 0 : v > max ? max : v;
}

function dist(dx: number, dz: number): number {
  return isqrt(dx * dx + dz * dz);
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
  const F = w.formations.col;
  const fh = w.formations.highWater;
  const falive = w.formations.alive;
  for (let f = 0; f < fh; f++) if (falive[f] === 1) F.minWp[f] = INT_MAX;
  refineLeft = REFINE_SEGMENTS_PER_TICK;
}

/** Nav LOS between the cells of two Fx positions for class `cls`. */
function los(w: World, cls: number, ax: number, az: number, bx: number, bz: number): boolean {
  return w.nav.lineOfSight(cls, navCellOf(w, ax, az), navCellOf(w, bx, bz));
}

/**
 * Consumes the current waypoint of mover r (own path: nav cursor; group path: own index). Path
 * progress ends the stuck chain.
 */
function advanceWaypoint(w: World, r: number, own: boolean): void {
  const M = w.movers.col;
  if (own) w.nav.advance(M.path[r]!);
  else M.wp[r] = M.wp[r]! + 1;
  M.flags[r] = M.flags[r]! & ~MoverBits.WpCached;
  M.best[r] = NO_BEST_DIST;
  M.streak[r] = 0;
}

/** Switches mover r to its final leg (steering straight to the slot). */
function toFinalLeg(w: World, r: number): void {
  const M = w.movers.col;
  if ((M.flags[r]! & MoverBits.FinalLeg) === 0) {
    M.flags[r] = (M.flags[r]! | MoverBits.FinalLeg) & ~MoverBits.WpCached;
    M.best[r] = NO_BEST_DIST;
  }
  M.wx[r] = M.tx[r]!;
  M.wz[r] = M.tz[r]!;
}

/**
 * Resolves the steering point of a moving mover into M.wx/wz (see module comment). Updates the
 * waypoint index, FinalLeg and the group minimum.
 */
function resolveTarget(w: World, u: number, r: number, cls: number, tick: number): void {
  const M = w.movers.col;
  const U = w.units.col;
  const F = w.formations.col;
  const nav = w.nav;
  const x = U.x[u]!;
  const z = U.z[u]!;
  let flags = M.flags[r]!;
  if ((flags & MoverBits.SlotPending) !== 0) {
    const f = U.formation[u]!;
    if (f >= 0 && F.state[f] === FormationState.Ready) {
      finalizeSlot(w, u, r, f, U.groupOffset[u]!);
      flags = M.flags[r]!;
      if ((flags & MoverBits.FinalLeg) !== 0) {
        M.wx[r] = M.tx[r]!;
        M.wz[r] = M.tz[r]!;
      }
    }
  }
  if ((flags & MoverBits.Detour) !== 0) {
    if (dist(M.wx[r]! - x, M.wz[r]! - z) >= WAYPOINT_RADIUS) return;
    flags &= ~MoverBits.Detour;
    M.flags[r] = flags;
    M.best[r] = NO_BEST_DIST;
  }
  if ((flags & MoverBits.FinalLeg) !== 0) {
    M.wx[r] = M.tx[r]!;
    M.wz[r] = M.tz[r]!;
    return;
  }
  const p = M.path[r]!;
  if (p < 0) {
    toFinalLeg(w, r);
    return;
  }
  const own = (flags & MoverBits.OwnPath) !== 0;
  const f = U.formation[u]!;
  if (!own) {
    if (f < 0 || F.path[f] !== p) {
      toFinalLeg(w, r);
      return;
    }
    if (M.pgen[r] !== F.gen[f] || M.wp[r]! < F.consumed[f]!) {
      M.pgen[r] = F.gen[f]!;
      M.wp[r] = F.consumed[f]!;
      M.flags[r] = M.flags[r]! & ~MoverBits.WpCached;
      M.best[r] = NO_BEST_DIST;
    }
  }
  const pt = SC.pt;
  const look = (tick + u) % LOOKAHEAD_TICKS === 0;
  if (look && dist(M.tx[r]! - x, M.tz[r]! - z) <= FINAL_LEG_LOS_RANGE && los(w, cls, x, z, M.tx[r]!, M.tz[r]!)) {
    toFinalLeg(w, r);
    return;
  }
  const packed = U.groupOffset[u]!;
  for (let guard = 0; guard < 24; guard++) {
    const k = own ? 0 : M.wp[r]! - F.consumed[f]!;
    const rc = nav.pointAt(p, k, pt);
    if (rc === WP_PENDING) {
      // Path not ready yet: drive towards the (provisional) slot right away.
      M.wx[r] = M.tx[r]!;
      M.wz[r] = M.tz[r]!;
      return;
    }
    if (rc === WP_NONE || rc === WP_END || rc === WP_LAST) {
      toFinalLeg(w, r);
      return;
    }
    if (rc === WP_NEED_REFINE) {
      if (refineLeft > 0) {
        refineLeft--;
        nav.refineNext(p, 1);
        continue;
      }
      // No budget left this tick: head for the next abstract node meanwhile.
      M.wx[r] = pt[0]!;
      M.wz[r] = pt[1]!;
      M.flags[r] = M.flags[r]! & ~MoverBits.WpCached;
      return;
    }
    // WP_OK: a refined waypoint.
    if ((M.flags[r]! & MoverBits.WpCached) === 0) {
      let cx = pt[0]!;
      let cz = pt[1]!;
      if (!own && packed !== 0) {
        const ox = clamp(cx + offsetX(packed), w.mapMax);
        const oz = clamp(cz + offsetZ(packed), w.mapMax);
        // Shifted waypoint only where passable for the unit's class and in clearance LOS
        // (otherwise a shifted leg could cut a cliff or wall), else the waypoint itself.
        if (w.navClear[navCellOf(w, ox, oz)]! >= cls && los(w, cls, x, z, ox, oz)) {
          cx = ox;
          cz = oz;
        }
      }
      M.wx[r] = cx;
      M.wz[r] = cz;
      M.flags[r] = M.flags[r]! | MoverBits.WpCached;
    }
    if (dist(M.wx[r]! - x, M.wz[r]! - z) < WAYPOINT_RADIUS || dist(pt[0]! - x, pt[1]! - z) < WAYPOINT_RADIUS) {
      advanceWaypoint(w, r, own);
      continue;
    }
    if (look) {
      // Look-ahead: skip the current waypoint if the next one is in clearance LOS.
      const rc2 = nav.pointAt(p, k + 1, SC.pt2);
      if ((rc2 === WP_OK || rc2 === WP_LAST) && los(w, cls, x, z, SC.pt2[0]!, SC.pt2[1]!)) {
        advanceWaypoint(w, r, own);
        continue;
      }
    }
    return;
  }
}

/** Neighbour selection for the separation: ≤ MAX_SEPARATION_NEIGHBORS nearest within range. */
function separation(w: World, u: number, ri: number, out: Int32Array): void {
  const U = w.units.col;
  const X = U.x;
  const Z = U.z;
  const BP = U.bp;
  const flags = U.flags;
  const radius = w.bp.radiusCol;
  const g = w.fine;
  const dim = g.dim;
  const shift = g.shift;
  const start = g.start;
  const items = g.items;
  const xu = X[u]!;
  const zu = Z[u]!;
  const reach = fxMul(asFx(ri + w.maxRadius), asFx(SEPARATION_RANGE_FACTOR)) + 2 * w.maxSpeedPerTick;
  let x0 = (xu - reach) >> shift;
  let x1 = (xu + reach) >> shift;
  let z0 = (zu - reach) >> shift;
  let z1 = (zu + reach) >> shift;
  if (x0 < 0) x0 = 0;
  if (z0 < 0) z0 = 0;
  if (x1 >= dim) x1 = dim - 1;
  if (z1 >= dim) z1 = dim - 1;
  const nbS = SC.nbSlot;
  const nbD = SC.nbDist;
  let n = 0;
  for (let cz = z0; cz <= z1; cz++) {
    const row = cz * dim;
    for (let cx = x0; cx <= x1; cx++) {
      const c = row + cx;
      const end = start[c + 1]!;
      for (let k = start[c]!; k < end; k++) {
        const v = items[k]!;
        if (v === u || (flags[v]! & UnitBits.Dead) !== 0) continue;
        const range = fxMul(asFx(ri + radius[BP[v]!]!), asFx(SEPARATION_RANGE_FACTOR)) | 0;
        const dx = xu - X[v]!;
        if (dx >= range || dx <= -range) continue;
        const dz = zu - Z[v]!;
        if (dz >= range || dz <= -range) continue;
        const d2 = dx * dx + dz * dz;
        if (d2 >= range * range) continue;
        const d = isqrt(d2) | 0;
        if (n < MAX_SEPARATION_NEIGHBORS) {
          nbS[n] = v;
          nbD[n] = d;
          n++;
        } else {
          let worst = 0;
          for (let i = 1; i < n; i++) if (nbD[i]! > nbD[worst]!) worst = i;
          if (d < nbD[worst]!) {
            nbS[worst] = v;
            nbD[worst] = d;
          }
        }
      }
    }
  }
  let sx = 0;
  let sz = 0;
  const seed = w.header.u32[WH_SEED]!;
  const tick = w.header.i32[WH_TICK]!;
  for (let i = 0; i < n; i++) {
    const v = nbS[i]!;
    const d = nbD[i]!;
    const range = fxMul(asFx(ri + radius[BP[v]!]!), asFx(SEPARATION_RANGE_FACTOR)) | 0;
    const wgt = Math.floor(((range - d) * 4096) / range) | 0;
    if (d === 0) {
      const a = asAng16(rng32(seed, tick, u, (SALT_SEPARATION + v) | 0) & 0xffff);
      sx += fxMul(cosA(a), asFx(wgt));
      sz += fxMul(sinA(a), asFx(wgt));
    } else {
      sx += Math.trunc((xu - X[v]!) * wgt / d);
      sz += Math.trunc((zu - Z[v]!) * wgt / d);
    }
  }
  // SPK2 separationStrength 0.5
  out[0] = sx >> 1;
  out[1] = sz >> 1;
}

/** Gradient away from blocked cells (clearance field), weighted like SPK2's distance field. */
function obstacleGradient(w: World, x: number, z: number, cls: number, ri: number, out: Int32Array): void {
  out[0] = 0;
  out[1] = 0;
  const clear = w.navClear;
  const size = w.mapSizeWu;
  const shift = w.navShift;
  const cx = x >> 12;
  const cz = z >> 12;
  if (cx < 1 || cz < 1 || cx >= size - 1 || cz >= size - 1) return;
  const i = (cz << shift) | cx;
  const c = clear[i]!;
  if (c > cls || c === 0) return;
  const gx = clear[i + 1]! - clear[i - 1]!;
  const gz = clear[i + size]! - clear[i - size]!;
  if (gx === 0 && gz === 0) return;
  // Distance to the blocked side: (c − 1) cells plus the offset inside the cell.
  const fxr = x & 4095;
  const fzr = z & 4095;
  const odx = gx > 0 ? fxr : gx < 0 ? 4096 - fxr : 1 << 24;
  const odz = gz > 0 ? fzr : gz < 0 ? 4096 - fzr : 1 << 24;
  const od = (c - 1) * 4096 + (odx < odz ? odx : odz);
  let excess = od - ri;
  if (excess >= CLEARANCE_MARGIN) return;
  if (excess < 0) excess = 0;
  const wgt = Math.floor((CLEARANCE_STRENGTH * (CLEARANCE_MARGIN - excess)) / CLEARANCE_MARGIN) | 0;
  const gl = isqrt(gx * gx + gz * gz) | 0;
  out[0] = Math.trunc((gx * wgt) / gl) | 0;
  out[1] = Math.trunc((gz * wgt) / gl) | 0;
}

const SEP = new Int32Array(2);
const GRAD = new Int32Array(2);

/** Steering + kinematics + integration of every awake mover. */
function steerAndIntegrate(w: World): void {
  const movers = w.movers;
  const n = movers.count;
  const owner = movers.owner;
  const M = movers.col;
  const U = w.units.col;
  const F = w.formations.col;
  const t = w.bp;
  const mapMax = w.mapMax;
  const tick = w.header.i32[WH_TICK]!;
  for (let r = 0; r < n; r++) {
    const u = owner[r]!;
    if ((U.flags[u]! & UnitBits.Dead) !== 0) continue;
    const state = M.state[r]!;
    const mflags = M.flags[r]!;
    if (state === MoverState.Idle && (mflags & MoverBits.Asleep) !== 0) continue;
    const bp = U.bp[u]!;
    const cls = navClassOf(t.sizeClassCol[bp]!);
    const x = U.x[u]!;
    const z = U.z[u]!;
    const v0 = M.speed[r]!;
    const brake = t.brakeCol[bp]!;
    let yaw = U.yaw[u]!;
    let v1: number;
    let ddx = 0;
    let ddz = 0;
    let pivot = false;
    if (state === MoverState.Idle) {
      v1 = v0 - brake > 0 ? v0 - brake : 0;
      const stepLen = (v0 + v1) >> 1;
      if (stepLen > 0) {
        const a = asAng16(yaw);
        ddx = fxMul(cosA(a), asFx(stepLen));
        ddz = fxMul(sinA(a), asFx(stepLen));
      }
      const nl = M.nudge[r]!;
      if (nl > 0) {
        const ns = fxMul(asFx(t.speed[bp]!), asFx(NUDGE_SPEED));
        ddx += fxMul(asFx(M.ndx[r]!), asFx(ns));
        ddz += fxMul(asFx(M.ndz[r]!), asFx(ns));
        M.nudge[r] = nl - 1;
      }
    } else {
      resolveTarget(w, u, r, cls, tick);
      if (state === MoverState.Moving && (M.flags[r]! & (MoverBits.OwnPath | MoverBits.FinalLeg)) === 0) {
        const f = U.formation[u]!;
        if (f >= 0 && M.path[r] === F.path[f] && M.wp[r]! < F.minWp[f]!) F.minWp[f] = M.wp[r]!;
      }
      const final = (M.flags[r]! & MoverBits.FinalLeg) !== 0;
      const tx = M.wx[r]!;
      const tz = M.wz[r]!;
      const ddxT = tx - x;
      const ddzT = tz - z;
      const dT = dist(ddxT, ddzT);
      const ri = t.radiusCol[bp]!;
      let fx = 0;
      let fz = 0;
      if (dT > 0) {
        fx = Math.trunc((ddxT * 4096) / dT);
        fz = Math.trunc((ddzT * 4096) / dT);
      }
      separation(w, u, ri, SEP);
      let sx = SEP[0]!;
      let sz = SEP[1]!;
      if (final && dT < 2 * ri) {
        // Near the slot the separation fades out (settle instead of orbiting).
        sx = Math.trunc((sx * dT) / (2 * ri));
        sz = Math.trunc((sz * dT) / (2 * ri));
      }
      obstacleGradient(w, x, z, cls, ri, GRAD);
      const hx = fx + sx + GRAD[0]!;
      const hz = fz + sz + GRAD[1]!;
      let want = asAng16(yaw);
      if (hx !== 0 || hz !== 0) want = atan2A(hz, hx);
      else if (dT > 0) want = atan2A(fz, fx);
      yaw = angRotateTowards(asAng16(yaw), want, t.turnRate[bp]!);
      const err = Math.abs(angDiff(asAng16(yaw), want));
      // Top speed: blueprint × slope braking (nav cost level of the cell).
      const level = w.navTerrain[navCellOf(w, x, z)]!;
      const vmax = level > 1 ? Math.floor((t.speed[bp]! * SLOPE_SPEED_PERMILLE[level - 1]!) / 1000) : t.speed[bp]!;
      let target: number;
      pivot = err > MOVE_START_ANGLE;
      if (pivot) {
        target = t.turnInPlaceCol[bp] === 1 ? fxMul(asFx(vmax), asFx(MOVE_PIVOT_CREEP)) : fxMul(asFx(vmax), asFx(MOVE_TURN_SLOWDOWN_MIN));
      } else {
        // Linear from 100 % (aligned) to MOVE_TURN_SLOWDOWN_MIN at MOVE_START_ANGLE.
        target = vmax - Math.floor((vmax * (4096 - MOVE_TURN_SLOWDOWN_MIN) * err) / (4096 * MOVE_START_ANGLE));
      }
      if (final) {
        const rest = dT - (ARRIVAL_RADIUS >> 1);
        const vArr = rest > 0 ? isqrt(2 * brake * rest) : 0;
        if (vArr < target) target = vArr;
      }
      let acc = t.accel[bp]!;
      const launch = M.launch[r]!;
      if (launch > 0) {
        acc *= MOVE_LAUNCH_BOOST;
        M.launch[r] = launch - 1;
      }
      const dv = target - v0;
      v1 = v0 + (dv > acc ? acc : dv < -brake ? -brake : dv);
      if (v1 < 0) v1 = 0;
      let stepLen = (v0 + v1) >> 1;
      if (final && stepLen > dT) stepLen = dT;
      if (stepLen > 0) {
        const a = asAng16(yaw);
        ddx = fxMul(cosA(a), asFx(stepLen));
        ddz = fxMul(sinA(a), asFx(stepLen));
      }
    }
    U.yaw[u] = yaw;
    M.speed[r] = v1;
    let fl = M.flags[r]! & ~(MoverBits.Blocked | MoverBits.Pivoting);
    if (pivot) fl |= MoverBits.Pivoting;
    if (ddx !== 0 || ddz !== 0) {
      const p = placeUnit(w, u, x, z, clamp(x + ddx, mapMax) | 0, clamp(z + ddz, mapMax) | 0, cls);
      if (p !== Placement.Full) {
        fl |= MoverBits.Blocked;
        if (p === Placement.Blocked) M.speed[r] = v1 >> 1;
      }
    }
    M.flags[r] = fl;
    U.vx[u] = U.x[u]! - x;
    U.vz[u] = U.z[u]! - z;
  }
}

/** Moving (order or slot return) ⇒ higher collision priority. */
function isMoving(w: World, v: number): boolean {
  const rv = w.units.col.mover[v]!;
  return rv >= 0 && w.movers.col.state[rv] !== MoverState.Idle;
}

/**
 * Positional collision resolution (PLAN §3.8): every overlapping pair once per pass (from the
 * lower slot, or from the awake unit if the other sleeps), shares by mass × priority, applied
 * immediately through placeUnit (Gauss-Seidel like SPK2). Records pushes of idle units.
 */
function collide(w: World): void {
  const movers = w.movers;
  const n = movers.count;
  const owner = movers.owner;
  const M = movers.col;
  const U = w.units.col;
  const X = U.x;
  const Z = U.z;
  const BP = U.bp;
  const flags = U.flags;
  const MOVER = U.mover;
  const t = w.bp;
  const radius = t.radiusCol;
  const mass = t.massCol;
  const g = w.fine;
  const dim = g.dim;
  const shift = g.shift;
  const start = g.start;
  const items = g.items;
  const mapMax = w.mapMax;
  const seed = w.header.u32[WH_SEED]!;
  const tick = w.header.i32[WH_TICK]!;
  const pushedBy = SC.pushedBy;
  const overlap = SC.overlap;
  for (let r = 0; r < n; r++) {
    const u = owner[r]!;
    pushedBy[u] = -1;
    overlap[u] = 0;
  }
  // The fine grid was rebuilt right before this pass: only the pushes of this pass move units.
  const margin = w.maxRadius + COLLISION_DRIFT;
  const MF = M.flags;
  for (let it = 0; it < COLLISION_ITERATIONS; it++) {
    for (let r = 0; r < n; r++) {
      const u = owner[r]!;
      if ((flags[u]! & UnitBits.Dead) !== 0 || (MF[r]! & MoverBits.Asleep) !== 0) continue;
      const bpu = BP[u]!;
      const ri = radius[bpu]!;
      const clsU = navClassOf(t.sizeClassCol[bpu]!);
      const movingU = M.state[r] !== MoverState.Idle;
      const mu = mass[bpu]! * (movingU ? MOVING_PRIORITY : 1);
      const immU = t.speed[bpu] === 0;
      const reach = ri + margin;
      let xu = X[u]!;
      let zu = Z[u]!;
      let x0 = (xu - reach) >> shift;
      let x1 = (xu + reach) >> shift;
      let z0 = (zu - reach) >> shift;
      let z1 = (zu + reach) >> shift;
      if (x0 < 0) x0 = 0;
      if (z0 < 0) z0 = 0;
      if (x1 >= dim) x1 = dim - 1;
      if (z1 >= dim) z1 = dim - 1;
      let found = 0;
      for (let cz = z0; cz <= z1 && found < MAX_SEPARATION_NEIGHBORS; cz++) {
        const row = cz * dim;
        for (let cx = x0; cx <= x1 && found < MAX_SEPARATION_NEIGHBORS; cx++) {
          const c = row + cx;
          const end = start[c + 1]!;
          for (let k = start[c]!; k < end; k++) {
            const v = items[k]!;
            if (v === u || (flags[v]! & UnitBits.Dead) !== 0) continue;
            const rvq = MOVER[v]!;
            // The pair is handled by v (lower slot, awake), unless u is a structure: structures
            // (radius beyond the mobile maximum) find their contacts themselves.
            if (v < u && !immU && rvq >= 0 && (MF[rvq]! & MoverBits.Asleep) === 0) continue;
            const bpv = BP[v]!;
            const minD = ri + radius[bpv]!;
            const dx = X[v]! - xu;
            if (dx >= minD || dx <= -minD) continue;
            const dz = Z[v]! - zu;
            if (dz >= minD || dz <= -minD) continue;
            const d2 = dx * dx + dz * dz;
            if (d2 >= minD * minD) continue;
            const d = isqrt(d2);
            const pen = minD - d;
            let ux: number;
            let uz: number;
            if (d === 0) {
              const a = asAng16(rng32(seed, tick, u, (SALT_SEPARATION + v) | 0) & 0xffff);
              ux = cosA(a);
              uz = sinA(a);
            } else {
              ux = Math.trunc((dx * 4096) / d);
              uz = Math.trunc((dz * 4096) / d);
            }
            const rv = MOVER[v]!;
            const movingV = rv >= 0 && M.state[rv] !== MoverState.Idle;
            const mv = mass[bpv]! * (movingV ? MOVING_PRIORITY : 1);
            // u moves by pen · mv / (mu + mv) away from v, v by the rest towards the other side;
            // units without speed (structures, MS3 cheat spawns) are never displaced.
            const immV = t.speed[bpv] === 0;
            if (immU && immV) continue;
            const pu = immU ? 0 : immV ? pen : Math.floor((pen * mv) / (mu + mv));
            const pv = pen - pu;
            if (pu > 0) {
              placeUnit(w, u, xu, zu, clamp(xu - fxMul(asFx(ux), asFx(pu)), mapMax) | 0, clamp(zu - fxMul(asFx(uz), asFx(pu)), mapMax) | 0, clsU);
              xu = X[u]!;
              zu = Z[u]!;
            }
            if (pv > 0) {
              const xv = X[v]!;
              const zv = Z[v]!;
              placeUnit(w, v, xv, zv, clamp(xv + fxMul(asFx(ux), asFx(pv)), mapMax) | 0, clamp(zv + fxMul(asFx(uz), asFx(pv)), mapMax) | 0, navClassOf(t.sizeClassCol[bpv]!));
            }
            overlap[u] = 1;
            overlap[v] = 1;
            if (rv >= 0) {
              const vf = M.flags[rv]!;
              if ((vf & MoverBits.Asleep) !== 0) M.flags[rv] = vf & ~MoverBits.Asleep;
              if (movingU && !movingV) pushedBy[v] = u;
            }
            if (movingV && !movingU) pushedBy[u] = v;
            found++;
            if (found >= MAX_SEPARATION_NEIGHBORS) break;
          }
        }
      }
    }
  }
}

/** Idle nudge (SPK2): an idle unit pushed by a moving one steps aside out of its lane. */
function nudges(w: World): void {
  const movers = w.movers;
  const n = movers.count;
  const owner = movers.owner;
  const M = movers.col;
  const U = w.units.col;
  const tick = w.header.i32[WH_TICK]!;
  const pushedBy = SC.pushedBy;
  const DIRV = SC.pt;
  for (let r = 0; r < n; r++) {
    const u = owner[r]!;
    const m = pushedBy[u]!;
    if (m < 0 || M.state[r] !== MoverState.Idle || w.bp.speed[U.bp[u]!] === 0) continue;
    M.pushTick[r] = tick;
    M.flags[r] = M.flags[r]! & ~MoverBits.Asleep;
    if (M.nudge[r]! > 0) continue;
    const a = asAng16(U.yaw[m]!);
    DIRV[0] = cosA(a);
    DIRV[1] = sinA(a);
    const hx = DIRV[0]!;
    const hz = DIRV[1]!;
    // Side of the pusher's lane (positions in 1/16 WU: products stay small integers, no −0).
    const side = ((U.x[u]! - U.x[m]!) >> 8) * (0 - hz) + ((U.z[u]! - U.z[m]!) >> 8) * hx >= 0 ? 1 : -1;
    M.ndx[r] = side > 0 ? 0 - hz : hz;
    M.ndz[r] = side > 0 ? hx : 0 - hx;
    M.nudge[r] = NUDGE_TICKS;
  }
}

/**
 * True if the slot (sx, sz) of u (radius ri) is taken for good: a standing unit near it either
 * holds a slot that conflicts with u's (e.g. many units sent to one point) or has no slot of its
 * own (stopped there). A unit that is only pushed onto u's slot keeps its own slot elsewhere and
 * does not count (it drives back, or gets pushed aside).
 */
function slotTaken(w: World, u: number, ri: number, sx: number, sz: number): boolean {
  const U = w.units.col;
  const M = w.movers.col;
  const X = U.x;
  const Z = U.z;
  const radius = w.bp.radiusCol;
  const g = w.fine;
  const dim = g.dim;
  const shift = g.shift;
  const reach = ri + w.maxRadius + 2 * w.maxSpeedPerTick;
  const x0 = clamp((sx - reach) >> shift, dim - 1);
  const x1 = clamp((sx + reach) >> shift, dim - 1);
  const z0 = clamp((sz - reach) >> shift, dim - 1);
  const z1 = clamp((sz + reach) >> shift, dim - 1);
  for (let cz = z0; cz <= z1; cz++) {
    for (let cx = x0; cx <= x1; cx++) {
      const c = cz * dim + cx;
      const end = g.start[c + 1]!;
      for (let k = g.start[c]!; k < end; k++) {
        const v = g.items[k]!;
        if (v === u || isMoving(w, v) || (U.flags[v]! & UnitBits.Dead) !== 0) continue;
        const lim = ri + radius[U.bp[v]!]! - SLOT_TAKEN_SLACK;
        const dx = X[v]! - sx;
        const dz = Z[v]! - sz;
        if (lim <= 0 || dx * dx + dz * dz >= lim * lim) continue;
        const rv = U.mover[v]!;
        if (rv < 0) return true;
        // A unit without a slot of its own counts once it has settled there (asleep).
        if ((M.flags[rv]! & MoverBits.HasSlot) === 0) {
          if ((M.flags[rv]! & MoverBits.Asleep) !== 0) return true;
          continue;
        }
        const ex = M.tx[rv]! - sx;
        const ez = M.tz[rv]! - sz;
        if (ex * ex + ez * ez < lim * lim) return true;
      }
    }
  }
  return false;
}

/**
 * True if another unit (idle or returning) near the slot (sx, sz) of u holds a slot that
 * conflicts with it (units sent to one point share their slot): nobody should drive back there.
 */
function slotShared(w: World, u: number, ri: number, sx: number, sz: number): boolean {
  const U = w.units.col;
  const M = w.movers.col;
  const radius = w.bp.radiusCol;
  const g = w.fine;
  const dim = g.dim;
  const shift = g.shift;
  const reach = SLOT_SHARE_RANGE;
  const x0 = clamp((sx - reach) >> shift, dim - 1);
  const x1 = clamp((sx + reach) >> shift, dim - 1);
  const z0 = clamp((sz - reach) >> shift, dim - 1);
  const z1 = clamp((sz + reach) >> shift, dim - 1);
  for (let cz = z0; cz <= z1; cz++) {
    for (let cx = x0; cx <= x1; cx++) {
      const c = cz * dim + cx;
      const end = g.start[c + 1]!;
      for (let k = g.start[c]!; k < end; k++) {
        const v = g.items[k]!;
        const rv = U.mover[v]!;
        if (v === u || rv < 0 || (U.flags[v]! & UnitBits.Dead) !== 0) continue;
        const st = M.state[rv]!;
        if (st === MoverState.Moving || (st === MoverState.Idle && (M.flags[rv]! & MoverBits.HasSlot) === 0)) continue;
        const lim = ri + radius[U.bp[v]!]! - SLOT_TAKEN_SLACK;
        const ex = M.tx[rv]! - sx;
        const ez = M.tz[rv]! - sz;
        if (lim > 0 && ex * ex + ez * ez < lim * lim) return true;
      }
    }
  }
  return false;
}

/**
 * SPK2 slot occupancy (slot return): a standing unit (not u) stands on the slot (sx, sz) of u and
 * stays there — it has no slot of its own or is settled at it. A unit that was itself pushed off
 * its slot does not block: it drives back to its own slot (units that swapped places both return).
 */
function slotOccupied(w: World, u: number, ri: number, sx: number, sz: number): boolean {
  const M = w.movers.col;
  const U = w.units.col;
  const X = U.x;
  const Z = U.z;
  const radius = w.bp.radiusCol;
  const g = w.fine;
  const dim = g.dim;
  const shift = g.shift;
  const reach = ri + w.maxRadius + 2 * w.maxSpeedPerTick;
  const x0 = clamp((sx - reach) >> shift, dim - 1);
  const x1 = clamp((sx + reach) >> shift, dim - 1);
  const z0 = clamp((sz - reach) >> shift, dim - 1);
  const z1 = clamp((sz + reach) >> shift, dim - 1);
  for (let cz = z0; cz <= z1; cz++) {
    for (let cx = x0; cx <= x1; cx++) {
      const c = cz * dim + cx;
      const end = g.start[c + 1]!;
      for (let k = g.start[c]!; k < end; k++) {
        const v = g.items[k]!;
        if (v === u || isMoving(w, v) || (U.flags[v]! & UnitBits.Dead) !== 0) continue;
        const lim = ri + radius[U.bp[v]!]! - SLOT_TAKEN_SLACK;
        const dx = X[v]! - sx;
        const dz = Z[v]! - sz;
        if (lim <= 0 || dx * dx + dz * dz >= lim * lim) continue;
        const rv = U.mover[v]!;
        if (rv >= 0 && (M.flags[rv]! & MoverBits.HasSlot) !== 0) {
          // Settled = within twice the arrival radius of its own slot; otherwise it gets pushed
          // back towards it by the returning unit.
          const ex = X[v]! - M.tx[rv]!;
          const ez = Z[v]! - M.tz[rv]!;
          if (ex * ex + ez * ez > 4 * ARRIVAL_RADIUS * ARRIVAL_RADIUS) continue;
        }
        return true;
      }
    }
  }
  return false;
}

/** True if u touches an arrived (idle, slot-holding) unit of the same group anchor. */
function touchesArrived(w: World, u: number, r: number, ri: number): boolean {
  const U = w.units.col;
  const M = w.movers.col;
  const X = U.x;
  const Z = U.z;
  const radius = w.bp.radiusCol;
  const g = w.fine;
  const dim = g.dim;
  const shift = g.shift;
  const xu = X[u]!;
  const zu = Z[u]!;
  const ax = M.ax[r]!;
  const az = M.az[r]!;
  const reach = ri + w.maxRadius + CONTAGION_GAP + 2 * w.maxSpeedPerTick;
  const x0 = clamp((xu - reach) >> shift, dim - 1);
  const x1 = clamp((xu + reach) >> shift, dim - 1);
  const z0 = clamp((zu - reach) >> shift, dim - 1);
  const z1 = clamp((zu + reach) >> shift, dim - 1);
  for (let cz = z0; cz <= z1; cz++) {
    for (let cx = x0; cx <= x1; cx++) {
      const c = cz * dim + cx;
      const end = g.start[c + 1]!;
      for (let k = g.start[c]!; k < end; k++) {
        const v = g.items[k]!;
        if (v === u) continue;
        const rv = U.mover[v]!;
        if (rv < 0 || M.state[rv] !== MoverState.Idle || (M.flags[rv]! & MoverBits.HasSlot) === 0) continue;
        if (M.ax[rv] !== ax || M.az[rv] !== az || (U.flags[v]! & UnitBits.Dead) !== 0) continue;
        const lim = ri + radius[U.bp[v]!]! + CONTAGION_GAP;
        const dx = X[v]! - xu;
        const dz = Z[v]! - zu;
        if (dx * dx + dz * dz <= lim * lim) return true;
      }
    }
  }
  return false;
}

/** Arrival, contagion, stuck detection, slot return and sleep (after the collision passes). */
function arrivalAndStuck(w: World): void {
  const movers = w.movers;
  const n = movers.count;
  const owner = movers.owner;
  const M = movers.col;
  const U = w.units.col;
  const t = w.bp;
  const tick = w.header.i32[WH_TICK]!;
  const overlap = SC.overlap;
  for (let r = 0; r < n; r++) {
    const u = owner[r]!;
    if ((U.flags[u]! & UnitBits.Dead) !== 0) continue;
    const state = M.state[r]!;
    const x = U.x[u]!;
    const z = U.z[u]!;
    const ri = t.radiusCol[U.bp[u]!]!;
    let fl = M.flags[r]!;
    if (state === MoverState.Idle) {
      if ((fl & MoverBits.Asleep) !== 0) continue;
      let far = false;
      if ((fl & MoverBits.HasSlot) !== 0 && M.nudge[r] === 0 && dist(M.tx[r]! - x, M.tz[r]! - z) > RETURN_DISTANCE) {
        far = true;
        if (tick - M.pushTick[r]! > RETURN_DELAY_TICKS && (tick + u) % LOOKAHEAD_TICKS === 0) {
          const cls = navClassOf(t.sizeClassCol[U.bp[u]!]!);
          if (slotShared(w, u, ri, M.tx[r]!, M.tz[r]!)) {
            // The slot is shared (units sent to one point): the current position is as good as
            // any, keep it.
            fl &= ~MoverBits.HasSlot;
            far = false;
          } else if (!slotOccupied(w, u, ri, M.tx[r]!, M.tz[r]!) && w.nav.lineOfSight(cls, navCellOf(w, x, z), navCellOf(w, M.tx[r]!, M.tz[r]!))) {
            // Slot return (SPK2): drive back to the slot, no order, no path request.
            M.state[r] = MoverState.Returning;
            M.wx[r] = M.tx[r]!;
            M.wz[r] = M.tz[r]!;
            M.best[r] = NO_BEST_DIST;
            M.stuck[r] = 0;
            M.launch[r] = 0;
            fl = (fl | MoverBits.FinalLeg) & ~MoverBits.Asleep;
          } else {
            // The slot is taken or out of sight for now: retry at the next check, give up (keep
            // the new position, fall asleep) after RETURN_ATTEMPTS failed checks.
            const n = M.streak[r]! + 1;
            M.streak[r] = n;
            if (n >= RETURN_ATTEMPTS) {
              fl &= ~MoverBits.HasSlot;
              far = false;
            }
          }
        }
      }
      // Structures (no speed) stay awake: they scan for their own contacts (see collide).
      if (M.state[r] === MoverState.Idle && M.speed[r] === 0 && M.nudge[r] === 0 && overlap[u] === 0 && !far && t.speed[U.bp[u]!]! > 0) fl |= MoverBits.Asleep;
      M.flags[r] = fl;
      continue;
    }
    const dSlot = dist(M.tx[r]! - x, M.tz[r]! - z);
    if (state === MoverState.Returning) {
      if (dSlot <= ARRIVAL_RADIUS) {
        M.state[r] = MoverState.Idle;
        M.streak[r] = 0;
        M.flags[r] = fl & ~MoverBits.FinalLeg;
        continue;
      }
    } else if ((fl & MoverBits.SlotPending) === 0) {
      if ((fl & MoverBits.FinalLeg) !== 0 && dSlot <= ARRIVAL_RADIUS) {
        M.flags[r] = fl | MoverBits.Arrived;
        continue;
      }
      if (dSlot < CONTAGION_DISTANCE) {
        const taken = slotTaken(w, u, ri, M.tx[r]!, M.tz[r]!);
        if ((taken || M.stuck[r]! >= CONTAGION_STALL_TICKS) && touchesArrived(w, u, r, ri)) {
          // Arrival contagion. A slot taken for good (e.g. many units sent to one point) or the
          // shared target of a single-unit order is given up: where the unit stopped is its new
          // slot (SPK2). The own offset slot of a group member that is only blocked by the crowd
          // for now is kept: the unit returns to it once the others have settled.
          const f = U.formation[u]!;
          const groupSlot = f >= 0 && w.formations.col.count[f]! > 1;
          if (taken || !groupSlot) {
            M.tx[r] = x;
            M.tz[r] = z;
          }
          M.flags[r] = fl | MoverBits.Arrived;
          continue;
        }
      }
    }
    // The stuck chain ends with real progress: a consumed waypoint (advanceWaypoint) or a new
    // best distance to the slot (by WAYPOINT_RADIUS) — not the way to a side-step point.
    if (state === MoverState.Moving && dSlot + WAYPOINT_RADIUS <= M.sbest[r]!) {
      M.sbest[r] = dSlot;
      M.streak[r] = 0;
    }
    // Stuck rule: progress towards the steering point.
    const d = dist(M.wx[r]! - x, M.wz[r]! - z);
    const best = M.best[r]!;
    if (best === NO_BEST_DIST) {
      M.best[r] = d;
      M.stuck[r] = 0;
    } else if (d + STUCK_EPSILON <= best) {
      M.best[r] = d;
      M.stuck[r] = 0;
    } else if ((fl & MoverBits.Pivoting) === 0) {
      // Turning on the spot is not being stuck (tracks pivot towards a waypoint behind them).
      const s = M.stuck[r]! + 1;
      if (s >= STUCK_TICKS) {
        M.stuck[r] = 0;
        M.best[r] = NO_BEST_DIST;
        if (state === MoverState.Returning) {
          // The return got stuck: idle again, retry later (counts as a failed attempt).
          M.state[r] = MoverState.Idle;
          fl &= ~MoverBits.FinalLeg;
          const a = M.streak[r]! + 1;
          M.streak[r] = a;
          if (a >= RETURN_ATTEMPTS) fl &= ~MoverBits.HasSlot;
        } else {
          fl |= MoverBits.Stuck;
        }
        M.flags[r] = fl;
      } else {
        M.stuck[r] = s;
      }
    }
  }
}

/** Moves every group path's nav cursor up to the slowest member following it. */
function advanceGroupPaths(w: World): void {
  const F = w.formations.col;
  const fh = w.formations.highWater;
  const alive = w.formations.alive;
  const nav = w.nav;
  for (let f = 0; f < fh; f++) {
    if (alive[f] !== 1) continue;
    const p = F.path[f]!;
    const target = F.minWp[f]!;
    if (p < 0 || target === INT_MAX) continue;
    let c = F.consumed[f]!;
    while (c < target && nav.refinedLeft(p) > 0) {
      nav.advance(p);
      c++;
    }
    F.consumed[f] = c;
  }
}

/** Phase 7 Movement. */
export function movementPhase(w: World): void {
  beginMovement(w);
  steerAndIntegrate(w);
  rebuildGrid(w, w.fine);
  collide(w);
  nudges(w);
  arrivalAndStuck(w);
  advanceGroupPaths(w);
}
