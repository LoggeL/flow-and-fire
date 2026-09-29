/**
 * Read-only helpers (tests, tools, headless scenarios) and setup-time configuration.
 * None of these run inside step(); allocating helpers are marked as such.
 */
import { MAX_ARMIES, asHandle, type Handle } from '@faf/fixed';
import { MoverState, UnitBits } from './constants.ts';
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
  readonly moving: boolean;
  readonly speed: number;
  readonly targetX: number;
  readonly targetZ: number;
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
    moving: row >= 0 && M.state[row] === MoverState.Moving,
    speed: row >= 0 ? M.speed[row]! : 0,
    targetX: row >= 0 ? M.tx[row]! : U.x[i]!,
    targetZ: row >= 0 ? M.tz[row]! : U.z[i]!,
  };
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
