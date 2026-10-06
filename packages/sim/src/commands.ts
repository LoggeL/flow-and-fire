/**
 * Phase 1 CommandApply (PLAN §3.4): applies the staged commands of this tick in (army, seq)
 * order. Validation: army active, handle generation (stale handles are ignored), ownership
 * (a foreign army cannot command units), unit cap, payload shape. Unknown ops and malformed
 * payloads are dropped. Every command of an active army advances its lastAckSeq.
 *
 * MS3 (G7, PLAN §3.8 "Gruppen"):
 * - Move: one group record (Formations) per command with the own mobile units (sorted by slot,
 *   duplicates ignored) ⇒ exactly one path request, issued when the first member begins the order
 *   (Orders phase). Offsets = position − centroid, compressed uniformly to R(n) = 2 + 1.1·√n WU but
 *   never tighter than ri + rj + 0.15 WU for any pair that is not a close neighbour already
 *   (SPK2; pairs closer than twice that are exempt). Without CmdFlags.Queue the command
 *   replaces the queue (paths and group references released), with it the order is appended; the
 *   request of a queued group starts at the lead unit's previous slot. A Move with one unit is a
 *   single request (group of one, offset 0). GroupMove (23) stays reserved.
 * - Stop: clears the queue and brakes (with Queue: appended as a stop point).
 * - Cheat Spawn: skips (and counts) units whose point is blocked for their size class (M2/M5).
 * - Cheat Footprint (MS3): stamps/removes an obstacle rectangle in the nav grid (corridor repath
 *   of cut paths in the next PathService phase); units on freshly blocked cells are moved to the
 *   nearest free cell.
 */
import { angToDir, asAng16, asFx, fxMul, isqrt, rng32, rngRange } from '@faf/fixed';
import { NAV_MAX_FOOTPRINT, navClassOf } from '@faf/nav';
import {
  CHEAT_FOOTPRINT_PAYLOAD_BYTES,
  CHEAT_KILL_PAYLOAD_BYTES,
  CHEAT_SPAWN_PAYLOAD_BYTES,
  CheatSub,
  CmdFlags,
  MOVE_PAYLOAD_BYTES,
  Op,
  readCheatFootprintDelta,
  readCheatFootprintH,
  readCheatFootprintW,
  readCheatFootprintX,
  readCheatFootprintZ,
} from '@faf/protocol';
import {
  FormationState,
  NO_BEST_DIST,
  NO_REF,
  OFFSET_MAX_RAW,
  OFFSET_MIN_GAP,
  OFFSET_RADIUS_BASE,
  OFFSET_RADIUS_PER_SQRT_N,
  OrderType,
  SALT_SPAWN_ANGLE,
  SALT_SPAWN_RADIUS,
  SALT_SPAWN_YAW,
  UnitBits,
} from './constants.ts';
import { clearOrders, offsetX, offsetZ, packOffset, pushOrder, unitClass } from './orders.ts';
import {
  ORD_OFFSET,
  ORD_TX,
  ORD_TZ,
  ORDER_RECORD_WORDS,
  WH_FOOTPRINT_REJECTED,
  WH_GROUPS_DROPPED,
  WH_SEED,
  WH_SPAWN_REJECTED,
  WH_SPAWN_SERIAL,
  WH_TICK,
  WH_UNITS_EVICTED,
} from './schema.ts';
import { nextStamp, SC } from './scratch.ts';
import { forEachInRadius, type UnitVisitor } from './spatial.ts';
import { isBlockedFor, navCellOf, setUnitPosition } from './terrain.ts';
import { killUnit, spawnUnit } from './units.ts';
import type { World } from './world.ts';

/** Scratch for angToDir (module-level, reused). */
const DIR = new Int32Array(2);

function clampMap(w: World, v: number): number {
  return v < 0 ? 0 : v > w.mapMax ? w.mapMax : v;
}

/** Resolves a handle to a slot the given army may command, or −1. */
function ownedSlot(w: World, handle: number, army: number): number {
  const idx = w.units.resolve(handle);
  if (idx < 0) return -1;
  const U = w.units.col;
  if ((U.flags[idx]! & UnitBits.Dead) !== 0) return -1;
  return U.army[idx] === army ? idx : -1;
}

/**
 * Collects the owned units (with a mover; `mobileOnly`: speed > 0) of staged command i into
 * SC.units, sorted by slot and without duplicates; returns the count.
 */
function gatherUnits(w: World, i: number, mobileOnly: boolean): number {
  const s = w.stage;
  const army = s.army[i]!;
  const U = w.units.col;
  const us = s.unitStart[i]!;
  const uc = s.unitCount[i]!;
  const stamp = SC.stamp;
  const gen = nextStamp();
  let lo = 0x7fffffff;
  let hi = -1;
  let n = 0;
  for (let k = 0; k < uc; k++) {
    const idx = ownedSlot(w, s.units[us + k]!, army);
    if (idx < 0 || U.mover[idx]! < 0 || stamp[idx] === gen) continue;
    if (mobileOnly && w.bp.speed[U.bp[idx]!]! <= 0) continue;
    stamp[idx] = gen;
    if (idx < lo) lo = idx;
    if (idx > hi) hi = idx;
    n++;
  }
  // Slot order: scan the stamped range (units are few compared to the table, the range is short).
  let k = 0;
  const out = SC.units;
  for (let idx = lo; idx <= hi && k < n; idx++) {
    if (stamp[idx] === gen) {
      SC.indexOf[idx] = k;
      out[k++] = idx;
    }
  }
  return n;
}

/** Visitor of the pair search of the offset compression (smallest allowed scale). */
class MinScaleVisitor implements UnitVisitor {
  w: World | null = null;
  u = 0;
  gen = 0;
  /** Largest need/d so far (Fx, 4096 = 1). */
  sMin = 0;
  visit(v: number): boolean {
    const w = this.w!;
    const u = this.u;
    if (v <= u || SC.stamp[v] !== this.gen) return true;
    const iu = SC.indexOf[u]!;
    const iv = SC.indexOf[v]!;
    const dx = SC.offX[iu]! - SC.offX[iv]!;
    const dz = SC.offZ[iu]! - SC.offZ[iv]!;
    const d = isqrt(dx * dx + dz * dz);
    if (d === 0) return true;
    const U = w.units.col;
    const need = w.bp.radiusCol[U.bp[u]!]! + w.bp.radiusCol[U.bp[v]!]! + OFFSET_MIN_GAP;
    // Pairs that are neighbours anyway (closer than twice the gap they need) do not limit the
    // compression: in a dense or randomly spawned group some pair is always (nearly) touching,
    // which would forbid any compression; such neighbours end up side by side at the target.
    if (d < 2 * need) return true;
    const s = Math.floor((need * 4096 + d - 1) / d);
    if (s > this.sMin) this.sMin = s;
    return true;
  }
}
const MIN_SCALE = new MinScaleVisitor();

/**
 * Offsets of the n gathered units (SC.offX/offZ, Fx) relative to their centroid, compressed
 * uniformly to R(n) (SPK2), never tighter than ri + rj + OFFSET_MIN_GAP for any pair.
 */
function groupOffsets(w: World, n: number, cx: number, cz: number): void {
  // Runs once per command (cold code): intermediate values are kept in the small-integer range
  // so the unoptimised code does not box numbers (allocation-free tick path, PLAN §3.4).
  const U = w.units.col;
  const units = SC.units;
  let max2 = 0;
  for (let k = 0; k < n; k++) {
    const u = units[k]!;
    const ox = (U.x[u]! - cx) | 0;
    const oz = (U.z[u]! - cz) | 0;
    SC.offX[k] = ox;
    SC.offZ[k] = oz;
    // Largest offset in 1/4 WU (squares stay below 2^30).
    const qx = ox >> 10;
    const qz = oz >> 10;
    const d2 = qx * qx + qz * qz;
    if (d2 > max2) max2 = d2;
  }
  const maxOff = (isqrt(max2) << 10) | 0;
  // R(n) = base + perSqrtN · √n  (√n in Fx: isqrt(n · 2^24)).
  const R = (OFFSET_RADIUS_BASE + fxMul(asFx(OFFSET_RADIUS_PER_SQRT_N), asFx(isqrt(n * 16777216)))) | 0;
  if (maxOff <= R) return;
  const s0 = Math.floor((R * 4096) / maxOff) | 0;
  // Pairs closer than (2·maxRadius + gap)/s0 could need a larger scale: search them in the grid
  // (the grid holds the positions of the last rebuild = current positions at tick start).
  let rMax = 0;
  for (let k = 0; k < n; k++) {
    const r = w.bp.radiusCol[U.bp[units[k]!]!]!;
    if (r > rMax) rMax = r;
  }
  const q = (Math.floor(((2 * rMax + OFFSET_MIN_GAP) * 4096) / (s0 > 0 ? s0 : 1)) + 1) | 0;
  const vis = MIN_SCALE;
  vis.w = w;
  vis.gen = SC.stampGen;
  vis.sMin = 0;
  for (let k = 0; k < n; k++) {
    const u = units[k]!;
    vis.u = u;
    forEachInRadius(w, U.x[u]!, U.z[u]!, q, vis);
  }
  vis.w = null;
  let s = vis.sMin > s0 ? vis.sMin : s0;
  if (s >= 4096) return;
  if (s < 1) s = 1;
  for (let k = 0; k < n; k++) {
    SC.offX[k] = scaleOffset(SC.offX[k]!, s);
    SC.offZ[k] = scaleOffset(SC.offZ[k]!, s);
  }
}

/** trunc(v · s / 4096) for |v| < 2^24, s ≤ 4096 without leaving the small-integer range. */
function scaleOffset(v: number, s: number): number {
  const a = (v / 4096) | 0;
  const b = v - a * 4096;
  return (a * s + ((b * s) / 4096 | 0)) | 0;
}

function clampOffset(v: number): number {
  return v < -OFFSET_MAX_RAW ? -OFFSET_MAX_RAW : v > OFFSET_MAX_RAW ? OFFSET_MAX_RAW : v;
}

function applyMove(w: World, i: number): void {
  const s = w.stage;
  if (s.payLen[i] !== MOVE_PAYLOAD_BYTES) return;
  const dv = s.dv;
  const po = s.payStart[i]!;
  const tx = clampMap(w, dv.getInt32(po, true));
  const tz = clampMap(w, dv.getInt32(po + 8, true));
  const queue = (s.flags[i]! & CmdFlags.Queue) !== 0;
  const n = gatherUnits(w, i, true);
  if (n === 0) return;
  const U = w.units.col;
  const units = SC.units;
  // Centroid in 1/16 WU (sums of ≤ 8,192 values < 2^16 stay small integers: no boxing in this
  // cold per-command code) and the unit nearest to it in 1/4 WU (lowest slot on ties).
  let sx = 0;
  let sz = 0;
  let cls = 1;
  for (let k = 0; k < n; k++) {
    const u = units[k]!;
    sx += U.x[u]! >> 8;
    sz += U.z[u]! >> 8;
    const c = unitClass(w, u);
    if (c > cls) cls = c;
  }
  const cx = (((sx / n) | 0) << 8) | 0;
  const cz = (((sz / n) | 0) << 8) | 0;
  let lead = units[0]!;
  let best = -1;
  for (let k = 0; k < n; k++) {
    const u = units[k]!;
    const dx = (U.x[u]! - cx) >> 10;
    const dz = (U.z[u]! - cz) >> 10;
    const d2 = dx * dx + dz * dz;
    if (best < 0 || d2 < best) {
      best = d2;
      lead = u;
    }
  }
  if (n > 1) groupOffsets(w, n, cx, cz);
  else {
    SC.offX[0] = 0;
    SC.offZ[0] = 0;
  }
  const formations = w.formations;
  const f = formations.alloc();
  if (f < 0) {
    const h = w.header.i32;
    h[WH_GROUPS_DROPPED] = (h[WH_GROUPS_DROPPED]! + 1) | 0;
    return;
  }
  // Request start: the lead unit, or — queued behind other orders — its previous slot.
  let startX = U.x[lead]!;
  let startZ = U.z[lead]!;
  const leadTail = U.orderTail[lead]!;
  if (queue && leadTail >= 0) {
    const O = w.orders.i32;
    const b = leadTail * ORDER_RECORD_WORDS;
    startX = clampMap(w, O[b + ORD_TX]! + offsetX(O[b + ORD_OFFSET]!));
    startZ = clampMap(w, O[b + ORD_TZ]! + offsetZ(O[b + ORD_OFFSET]!));
  }
  const F = formations.col;
  F.army[f] = s.army[i]!;
  F.cls[f] = navClassOf(cls);
  F.state[f] = FormationState.Waiting;
  F.flags[f] = 0;
  F.count[f] = n;
  F.refs[f] = 0;
  F.tx[f] = tx;
  F.tz[f] = tz;
  F.gx[f] = tx;
  F.gz[f] = tz;
  F.sx[f] = startX;
  F.sz[f] = startZ;
  F.path[f] = NO_REF;
  F.consumed[f] = 0;
  F.minWp[f] = 0;
  let refs = 0;
  for (let k = 0; k < n; k++) {
    const u = units[k]!;
    const r = U.mover[u]!;
    if (!queue) clearOrders(w, u, r);
    const packed = packOffset(clampOffset(SC.offX[k]!), clampOffset(SC.offZ[k]!));
    if (pushOrder(w, u, r, OrderType.Move, tx, tz, f, packed)) refs++;
  }
  F.refs[f] = refs;
  if (refs === 0) formations.free(f);
}

function applyStop(w: World, i: number): void {
  const s = w.stage;
  const queue = (s.flags[i]! & CmdFlags.Queue) !== 0;
  const n = gatherUnits(w, i, false);
  const U = w.units.col;
  for (let k = 0; k < n; k++) {
    const u = SC.units[k]!;
    const r = U.mover[u]!;
    if (!queue) clearOrders(w, u, r);
    pushOrder(w, u, r, OrderType.Stop, U.x[u]!, U.z[u]!, NO_REF, 0);
  }
}

function applyCheatSpawn(w: World, i: number, tick: number): void {
  const s = w.stage;
  const dv = s.dv;
  const po = s.payStart[i]!;
  const bp = dv.getUint16(po + 1, true);
  const army = dv.getUint8(po + 3);
  const count = dv.getUint16(po + 4, true);
  const cx = clampMap(w, dv.getInt32(po + 6, true));
  const cz = clampMap(w, dv.getInt32(po + 10, true));
  const spread = dv.getInt32(po + 14, true);
  if (bp >= w.bp.count || army >= w.armyCount || spread < 0) return;
  const h = w.header.i32;
  const seed = w.header.u32[WH_SEED]!;
  const cls = navClassOf(w.bp.sizeClassCol[bp]!);
  for (let n = 0; n < count; n++) {
    const serial = h[WH_SPAWN_SERIAL]!;
    h[WH_SPAWN_SERIAL] = (serial + 1) | 0;
    // Uniform point in the disc of radius `spread` around (cx, cz): angle from one draw,
    // radius = spread · sqrt(u) with u uniform in [0, 1] (as 16.16 fixed point).
    const ang = rng32(seed, tick, serial, SALT_SPAWN_ANGLE) & 0xffff;
    const u = rngRange(rng32(seed, tick, serial, SALT_SPAWN_RADIUS), 65537);
    const r = Math.floor((spread * isqrt(u * 65536)) / 65536);
    angToDir(asAng16(ang), DIR, 0);
    const x = clampMap(w, cx + fxMul(asFx(DIR[0]!), asFx(r)));
    const z = clampMap(w, cz + fxMul(asFx(DIR[1]!), asFx(r)));
    const yaw = rng32(seed, tick, serial, SALT_SPAWN_YAW) & 0xffff;
    if (isBlockedFor(w, w.bp.layerCol[bp]!, x, z, cls)) {
      // M2/M5: a land unit is never placed where its class may not stand; the draw is consumed.
      h[WH_SPAWN_REJECTED] = (h[WH_SPAWN_REJECTED]! + 1) | 0;
      continue;
    }
    if (spawnUnit(w, bp, army, x, z, yaw) < 0) return; // cap reached
  }
}

function applyCheatKill(w: World, i: number): void {
  const s = w.stage;
  const us = s.unitStart[i]!;
  const uc = s.unitCount[i]!;
  const U = w.units.col;
  for (let k = 0; k < uc; k++) {
    const idx = w.units.resolve(s.units[us + k]!);
    if (idx < 0 || (U.flags[idx]! & UnitBits.Dead) !== 0) continue;
    killUnit(w, idx);
  }
}

/**
 * Moves every land unit that stands on a cell no longer passable for its class to the centre of
 * the nearest passable cell (after a footprint stamp; the rectangle expanded by the largest class).
 */
function evictUnits(w: World, x0: number, z0: number, x1: number, z1: number): void {
  const units = w.units;
  const U = units.col;
  const hw = units.highWater;
  const nav = w.nav;
  const mask = w.mapSizeWu - 1;
  const shift = w.navShift;
  const h = w.header.i32;
  for (let u = 0; u < hw; u++) {
    if (units.alive[u] !== 1 || (U.flags[u]! & UnitBits.Dead) !== 0 || U.mover[u]! < 0) continue;
    const cxu = U.x[u]! >> 12;
    const czu = U.z[u]! >> 12;
    if (cxu < x0 || cxu >= x1 || czu < z0 || czu >= z1) continue;
    const cls = unitClass(w, u);
    const cell = navCellOf(w, U.x[u]!, U.z[u]!);
    if (w.navClear[cell]! >= cls) continue;
    const c = nav.nearestPassable(cls, cell & mask, cell >> shift);
    if (c < 0) continue;
    setUnitPosition(w, u, ((c & mask) << 12) + 2048, ((c >> shift) << 12) + 2048);
    h[WH_UNITS_EVICTED] = (h[WH_UNITS_EVICTED]! + 1) | 0;
    const r = U.mover[u]!;
    if (r >= 0) w.movers.col.best[r] = NO_BEST_DIST;
  }
}

function applyCheatFootprint(w: World, i: number): void {
  const s = w.stage;
  const dv = s.dv;
  const po = s.payStart[i]!;
  const x = readCheatFootprintX(dv, po);
  const z = readCheatFootprintZ(dv, po);
  const fw = readCheatFootprintW(dv, po);
  const fh = readCheatFootprintH(dv, po);
  const delta = readCheatFootprintDelta(dv, po);
  const size = w.mapSizeWu;
  if (fw < 1 || fh < 1 || fw > NAV_MAX_FOOTPRINT || fh > NAV_MAX_FOOTPRINT || (delta !== 1 && delta !== -1) || x + fw <= 0 || z + fh <= 0 || x >= size || z >= size) {
    const h = w.header.i32;
    h[WH_FOOTPRINT_REJECTED] = (h[WH_FOOTPRINT_REJECTED]! + 1) | 0;
    return;
  }
  w.nav.stampFootprint(x, z, fw, fh, delta);
  if (delta === 1) evictUnits(w, x - 3, z - 3, x + fw + 3, z + fh + 3);
}

/** Applies the staged, sorted commands. */
export function commandApplyPhase(w: World): void {
  const s = w.stage;
  const n = s.count;
  if (n === 0) return;
  const ack = w.armies.col.lastAckSeq;
  s.sortByArmySeq(ack);
  const tick = w.header.i32[WH_TICK]!;
  const armyCount = w.armyCount;
  const order = s.order;
  for (let o = 0; o < n; o++) {
    const i = order[o]!;
    const army = s.army[i]!;
    if (army < 0 || army >= armyCount) continue;
    ack[army] = s.seq[i]!;
    switch (s.op[i]) {
      case Op.Move:
        applyMove(w, i);
        break;
      case Op.Stop:
        applyStop(w, i);
        break;
      case Op.Cheat: {
        const len = s.payLen[i]!;
        if (len < 1) break;
        const sub = s.payload[s.payStart[i]!]!;
        if (sub === CheatSub.Spawn && len === CHEAT_SPAWN_PAYLOAD_BYTES) applyCheatSpawn(w, i, tick);
        else if (sub === CheatSub.Kill && len === CHEAT_KILL_PAYLOAD_BYTES) applyCheatKill(w, i);
        else if (sub === CheatSub.Footprint && len === CHEAT_FOOTPRINT_PAYLOAD_BYTES) applyCheatFootprint(w, i);
        break;
      }
      default:
        // Unknown or not-yet-implemented op (incl. the reserved GroupMove): dropped, acknowledged.
        break;
    }
  }
}
