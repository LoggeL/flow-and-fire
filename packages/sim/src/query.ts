/**
 * Read-only helpers (tests, tools, headless scenarios) and setup-time configuration.
 * None of these run inside step(); allocating helpers are marked as such.
 */
import { MAX_ARMIES, asHandle, type Handle } from '@faf/fixed';
import { MoverState, UnitBits } from './constants.ts';
import {
  ORD_FORMATION,
  ORD_NEXT,
  ORD_TX,
  ORD_TYPE_FLAGS,
  ORD_TZ,
  ORDER_RECORD_WORDS,
  WH_FOOTPRINT_REJECTED,
  WH_GROUPS_DROPPED,
  WH_ORDERS_DROPPED,
  WH_REQUESTS_FAILED,
  WH_STUCK_GIVEUPS,
  WH_UNITS_EVICTED,
} from './schema.ts';
import type { World } from './world.ts';

/** Position output (Fx raw). */
export interface Vec3Out {
  x: number;
  y: number;
  z: number;
}

/** Slot of a live (not dead) unit handle, or −1. */
export function unitSlot(w: World, handle: Handle | number): number {
  const idx = w.units.resolve(handle);
  if (idx < 0 || (w.units.col.flags[idx]! & UnitBits.Dead) !== 0) return -1;
  return idx;
}

/** True if the handle refers to a live unit. */
export function isUnitAlive(w: World, handle: Handle | number): boolean {
  return unitSlot(w, handle) >= 0;
}

/** Writes the current position of a unit into `out`; returns false for stale/dead handles. */
export function unitPosition(w: World, handle: Handle | number, out: Vec3Out): boolean {
  const i = unitSlot(w, handle);
  if (i < 0) return false;
  const U = w.units.col;
  out.x = U.x[i]!;
  out.y = U.y[i]!;
  out.z = U.z[i]!;
  return true;
}

/** Snapshot of the unit state for tests (allocates). */
export interface UnitInfo {
  readonly handle: Handle;
  readonly slot: number;
  readonly bp: number;
  readonly army: number;
  readonly state: number;
  readonly x: number;
  readonly z: number;
  readonly px: number;
  readonly pz: number;
  readonly yaw: number;
  readonly pyaw: number;
  readonly hp: number;
  readonly flags: number;
  /** Executing a move order (or driving back to its slot). */
  readonly moving: boolean;
  readonly speed: number;
  /** Slot of the active/last move (Fx). */
  readonly targetX: number;
  readonly targetZ: number;
  /** Queued orders (incl. the active one). */
  readonly orders: number;
  /** Mover state (MoverState) and flags (MoverBits). */
  readonly moverState: number;
  readonly moverFlags: number;
  /** Followed path id (−1 none), waypoint index, group record (−1 none). */
  readonly path: number;
  readonly wp: number;
  readonly formation: number;
  /** Current steering point (Fx). */
  readonly steerX: number;
  readonly steerZ: number;
  /** Idle-nudge ticks left. */
  readonly nudge: number;
}

/** Details of a live unit or null (allocates). */
export function unitInfo(w: World, handle: Handle | number): UnitInfo | null {
  const i = unitSlot(w, handle);
  if (i < 0) return null;
  const U = w.units.col;
  const row = U.mover[i]!;
  const M = w.movers.col;
  return {
    handle: w.units.handle(i),
    slot: i,
    bp: U.bp[i]!,
    army: U.army[i]!,
    state: U.state[i]!,
    x: U.x[i]!,
    z: U.z[i]!,
    px: U.px[i]!,
    pz: U.pz[i]!,
    yaw: U.yaw[i]!,
    pyaw: U.pyaw[i]!,
    hp: U.hp[i]!,
    flags: U.flags[i]!,
    moving: row >= 0 && M.state[row] !== MoverState.Idle,
    speed: row >= 0 ? M.speed[row]! : 0,
    targetX: row >= 0 ? M.tx[row]! : U.x[i]!,
    targetZ: row >= 0 ? M.tz[row]! : U.z[i]!,
    orders: row >= 0 ? M.orders[row]! : 0,
    moverState: row >= 0 ? M.state[row]! : 0,
    moverFlags: row >= 0 ? M.flags[row]! : 0,
    path: row >= 0 ? M.path[row]! : -1,
    wp: row >= 0 ? M.wp[row]! : 0,
    formation: U.formation[i]!,
    steerX: row >= 0 ? M.wx[row]! : U.x[i]!,
    steerZ: row >= 0 ? M.wz[row]! : U.z[i]!,
    nudge: row >= 0 ? M.nudge[row]! : 0,
  };
}

/** Sim-wide pathfinding and order counters (Stats/Debug, PLAN §3.6). */
export interface PathStats {
  /** Requests waiting in the PathService FIFO. */
  readonly pending: number;
  /** Requests issued since the start (group/single requests, stuck and corridor repaths). */
  readonly requestsIssued: number;
  readonly requestsDone: number;
  /** Paths marked by new footprints (corridor rule). */
  readonly repathsTriggered: number;
  readonly expansionsLastTick: number;
  readonly expansionsTotal: number;
  /** Move orders given up by the stuck chain. */
  readonly stuckGiveUps: number;
  /** Dropped orders (queue/pool full), dropped groups (Formations full), failed requests (path table full). */
  readonly ordersDropped: number;
  readonly groupsDropped: number;
  readonly requestsFailed: number;
  /** Rejected footprint cheats, units evicted from freshly blocked cells. */
  readonly footprintsRejected: number;
  readonly unitsEvicted: number;
  /** Live nav paths, group records and order records. */
  readonly livePaths: number;
  readonly liveGroups: number;
  readonly liveOrders: number;
}

/** Current counters (allocates the result object; tools/tests/host stats). */
export function pathStats(w: World): PathStats {
  const nav = w.nav;
  const h = w.header.i32;
  return {
    pending: nav.pendingCount,
    requestsIssued: nav.requestsIssued,
    requestsDone: nav.requestsDone,
    repathsTriggered: nav.repathsTriggered,
    expansionsLastTick: nav.expansionsLastTick,
    expansionsTotal: nav.expansionsTotal,
    stuckGiveUps: h[WH_STUCK_GIVEUPS]!,
    ordersDropped: h[WH_ORDERS_DROPPED]!,
    groupsDropped: h[WH_GROUPS_DROPPED]!,
    requestsFailed: h[WH_REQUESTS_FAILED]!,
    footprintsRejected: h[WH_FOOTPRINT_REJECTED]!,
    unitsEvicted: h[WH_UNITS_EVICTED]!,
    livePaths: nav.st.paths.liveCount,
    liveGroups: w.formations.liveCount,
    liveOrders: w.orders.liveCount,
  };
}

/** Order records of a unit's queue as {type, x, z} (allocates; tools/tests). */
export function unitOrders(w: World, handle: Handle | number): { type: number; x: number; z: number; formation: number }[] {
  const i = unitSlot(w, handle);
  if (i < 0) return [];
  const out: { type: number; x: number; z: number; formation: number }[] = [];
  const O = w.orders.i32;
  for (let rec = w.units.col.orderHead[i]!; rec >= 0; rec = O[rec * ORDER_RECORD_WORDS + ORD_NEXT]!) {
    const b = rec * ORDER_RECORD_WORDS;
    out.push({ type: O[b + ORD_TYPE_FLAGS]! & 0xff, x: O[b + ORD_TX]!, z: O[b + ORD_TZ]!, formation: O[b + ORD_FORMATION]! });
  }
  return out;
}

/** Handles of all live units in slot order, optionally of one army (allocates). */
export function unitHandles(w: World, army = -1): Handle[] {
  const out: Handle[] = [];
  const units = w.units;
  const U = units.col;
  const hw = units.highWater;
  for (let i = 0; i < hw; i++) {
    if (units.alive[i] !== 1 || (U.flags[i]! & UnitBits.Dead) !== 0) continue;
    if (army >= 0 && U.army[i] !== army) continue;
    out.push(asHandle(units.handle(i)));
  }
  return out;
}

/** Number of live units (all armies). */
export function unitCount(w: World): number {
  return w.units.liveCount;
}

/** Number of live units of an army. */
export function armyUnitCount(w: World, army: number): number {
  return w.armies.col.unitCount[army]!;
}

/** Last processed command seq of an army (−1 = none yet). */
export function lastAckSeq(w: World, army: number): number {
  return w.armies.col.lastAckSeq[army]!;
}

/** True if army `a` treats army `b` as allied (self is always allied). */
export function isAllied(w: World, a: number, b: number): boolean {
  return w.alliance.u8[a * MAX_ARMIES + b] === 1;
}

/**
 * Setup-time alliance configuration (symmetric). Part of the state (hashed); in MS1 there is no
 * command for it, so call it only before the first step (match setup).
 */
export function setAlliance(w: World, a: number, b: number, allied: boolean): void {
  if (a < 0 || b < 0 || a >= MAX_ARMIES || b >= MAX_ARMIES) throw new RangeError('setAlliance: army out of range');
  if (a === b) {
    if (!allied) throw new RangeError('setAlliance: an army is always allied with itself');
    return;
  }
  const v = allied ? 1 : 0;
  w.alliance.u8[a * MAX_ARMIES + b] = v;
  w.alliance.u8[b * MAX_ARMIES + a] = v;
}
