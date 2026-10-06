/**
 * Output of a frame for a viewer (PLAN §3.6) through the protocol FrameWriter.
 * MS1 has no fog: viewer −1 (observer) and every army see all units. Units that are dead are
 * already released by Cleanup and never appear.
 *
 * MS3 (frame v2): the path statistics of the header (pending requests, requests issued, repaths
 * triggered, expansions of the last PathService phase, stuck give-ups) and the Watch section for
 * `ctl.watch` (≤ 64 handles): per unit its queued order targets and the remaining waypoints of
 * its path. Watch entries are only written for units the viewer may see in detail (observer, own
 * or allied army); stale handles are skipped.
 */
import { MAX_ARMIES } from '@faf/fixed';
import { PATH_PENDING, WP_LAST } from '@faf/nav';
import { UnitFlags, WATCH_MAX_POINTS, WATCH_MAX_TARGETS, WatchFlags, type FrameWriter } from '@faf/protocol';
import { MoverBits, MoverState, OrderBits, OrderType, UnitBits, UnitState } from './constants.ts';
import { offsetX, offsetZ } from './orders.ts';
import {
  HL_LAST_HASH,
  HL_LAST_HASH_TICK,
  ORD_NEXT,
  ORD_OFFSET,
  ORD_TX,
  ORD_TYPE_FLAGS,
  ORD_TZ,
  ORDER_RECORD_WORDS,
  WH_STUCK_GIVEUPS,
  WH_TICK,
} from './schema.ts';
import { SC } from './scratch.ts';
import type { World } from './world.ts';

/** Header fields owned by the host (sequence, timing, speed, paused bit). */
export interface FrameMeta {
  /** Frame sequence number (host counter). */
  seq: number;
  /** Duration of the last tick in µs (host measurement). */
  tickTimeUs: number;
  /** Game speed in ‰ (1000 = 1x). */
  speedPermille: number;
  /** FrameFlags (e.g. Paused). */
  flags: number;
}

const DEFAULT_META: FrameMeta = { seq: 0, tickTimeUs: 0, speedPermille: 1000, flags: 0 };

/** Scales hp to u8: 255 = full, ≥ 1 while alive. */
export function hpToU8(hp: number, maxHp: number): number {
  if (hp <= 0) return 0;
  if (hp >= maxHp) return 255;
  const v = Math.floor((hp * 255) / maxHp);
  return v < 1 ? 1 : v;
}

const EMPTY_WATCH = new Uint32Array(0);

/**
 * Writes the frame of `viewer` (−1 = all) into `target` and returns its packed byte length.
 * Header: tick, ackSeq of the viewer (0xFFFFFFFF = none/observer), last hash tick + hash, path
 * statistics. `watch[0..watchCount)` are the handles of `ctl.watch` (Watch section).
 */
export function writeFrame(
  w: World,
  viewer: number,
  writer: FrameWriter,
  target: Uint8Array,
  meta: FrameMeta = DEFAULT_META,
  watch: Uint32Array = EMPTY_WATCH,
  watchCount = 0,
): number {
  const h = w.header;
  const ack = viewer >= 0 && viewer < w.armyCount ? w.armies.col.lastAckSeq[viewer]! : -1;
  writer.beginFrame(
    target,
    meta.seq,
    h.i32[WH_TICK]!,
    meta.tickTimeUs,
    meta.speedPermille,
    viewer,
    meta.flags,
    // Signed values: beginFrame writes them as u32 (no boxed doubles on the call).
    ack,
    w.hashLog.i32[HL_LAST_HASH_TICK]!,
    w.hashLog.i32[HL_LAST_HASH]!,
  );
  const units = w.units;
  const alive = units.alive;
  const U = units.col;
  const M = w.movers.col;
  const maxHp = w.bp.maxHpCol;
  const hw = units.highWater;
  for (let i = 0; i < hw; i++) {
    if (alive[i] !== 1) continue;
    const f = U.flags[i]!;
    if ((f & UnitBits.Dead) !== 0) continue;
    const bp = U.bp[i]!;
    const hp = U.hp[i]!;
    const mhp = maxHp[bp]!;
    let flags = 0;
    if ((f & UnitBits.NoInterp) !== 0) flags |= UnitFlags.NoInterp;
    const row = U.mover[i]!;
    if (
      U.state[i] === UnitState.Idle &&
      (row < 0 || (M.state[row] === MoverState.Idle && M.speed[row] === 0 && M.orders[row] === 0 && M.nudge[row] === 0))
    ) {
      flags |= UnitFlags.Idle;
    }
    if (hp < mhp) flags |= UnitFlags.Damaged;
    writer.writeUnit(
      U.px[i]!,
      U.py[i]!,
      U.pz[i]!,
      U.x[i]!,
      U.y[i]!,
      U.z[i]!,
      U.pyaw[i]!,
      U.yaw[i]!,
      bp,
      U.army[i]!,
      hpToU8(hp, mhp),
      255,
      U.bank[i]!,
      flags,
      units.handle(i),
      0,
      0,
    );
  }
  const nav = w.nav;
  writer.setPathStats(nav.pendingCount, nav.requestsIssued, nav.repathsTriggered, nav.expansionsLastTick, w.header.i32[WH_STUCK_GIVEUPS]!);
  const nw = watchCount < watch.length ? watchCount : watch.length;
  for (let k = 0; k < nw; k++) writeWatch(w, viewer, writer, watch[k]!);
  return writer.endFrame();
}

/** True if `viewer` may see the orders of units of `army` (observer, own or allied). */
function seesDetails(w: World, viewer: number, army: number): boolean {
  if (viewer < 0) return true;
  if (viewer >= MAX_ARMIES) return false;
  return w.alliance.u8[viewer * MAX_ARMIES + army] === 1;
}

/** One WatchRecord: queued order targets and the remaining path points of the unit. */
function writeWatch(w: World, viewer: number, writer: FrameWriter, handle: number): void {
  const idx = w.units.resolve(handle);
  if (idx < 0) return;
  const U = w.units.col;
  if ((U.flags[idx]! & UnitBits.Dead) !== 0 || !seesDetails(w, viewer, U.army[idx]!)) return;
  const r = U.mover[idx]!;
  if (r < 0) {
    writer.beginWatch(handle, 0, 0);
    return;
  }
  const M = w.movers.col;
  const nav = w.nav;
  const mf = M.flags[r]!;
  const p = M.path[r]!;
  const f = U.formation[idx]!;
  const moving = M.state[r] !== MoverState.Idle;
  const own = (mf & MoverBits.OwnPath) !== 0;
  const group = moving && !own && p >= 0 && f >= 0 && w.formations.col.path[f] === p;
  let wf = 0;
  if (moving && (M.streak[r]! > 0 || M.stuck[r]! >= 10 || (mf & MoverBits.Detour) !== 0)) wf |= WatchFlags.Stuck;
  if ((mf & MoverBits.Retargeted) !== 0) wf |= WatchFlags.Retargeted;
  if (moving && p >= 0 && nav.pathState(p) === PATH_PENDING) wf |= WatchFlags.PathPending;
  if (group) wf |= WatchFlags.Group;
  if (writer.beginWatch(handle, M.orders[r]!, wf) < 0) return;
  // Order targets (active move: its slot; queued moves: anchor + offset; stops: their point).
  const O = w.orders.i32;
  let rec = U.orderHead[idx]!;
  for (let n = 0; rec >= 0 && n < WATCH_MAX_TARGETS; n++) {
    const b = rec * ORDER_RECORD_WORDS;
    const tf = O[b + ORD_TYPE_FLAGS]!;
    const type = tf & 0xff;
    if (type === OrderType.Move && ((tf >> 8) & OrderBits.Begun) !== 0) writer.addWatchTarget(type, M.tx[r]!, M.tz[r]!);
    else if (type === OrderType.Move) writer.addWatchTarget(type, O[b + ORD_TX]! + offsetX(O[b + ORD_OFFSET]!), O[b + ORD_TZ]! + offsetZ(O[b + ORD_OFFSET]!));
    else writer.addWatchTarget(type, O[b + ORD_TX]!, O[b + ORD_TZ]!);
    rec = O[b + ORD_NEXT]!;
  }
  if (!moving) return;
  // Remaining route: side-step point, then the path (group: from the unit's own index, shifted by
  // its offset for display), unless the unit is on its final leg.
  let left = WATCH_MAX_POINTS;
  if ((mf & MoverBits.Detour) !== 0) {
    writer.addWatchPoint(M.wx[r]!, M.wz[r]!);
    left--;
  }
  if ((mf & MoverBits.FinalLeg) !== 0 || p < 0) return;
  const s = nav.pathState(p);
  if (s === PATH_PENDING) return;
  let skip = 0;
  let ox = 0;
  let oz = 0;
  if (group) {
    const d = M.wp[r]! - w.formations.col.consumed[f]!;
    skip = d > 0 ? d : 0;
    ox = offsetX(U.groupOffset[idx]!);
    oz = offsetZ(U.groupOffset[idx]!);
  }
  const pts = SC.points;
  const n = nav.remainingPoints(p, pts, left, skip);
  for (let k = 0; k < n; k++) {
    // The final point of the route is the anchor; the unit's own target is its slot (targets).
    const last = k === n - 1 && nav.pointAt(p, skip + k, SC.pt2) === WP_LAST;
    if (last) writer.addWatchPoint(M.tx[r]!, M.tz[r]!);
    else writer.addWatchPoint(pts[2 * k]! + ox, pts[2 * k + 1]! + oz);
  }
}

