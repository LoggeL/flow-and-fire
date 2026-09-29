/**
 * Unit lifecycle: spawn (slot alloc + mover), kill (mark) and release (Cleanup phase).
 */
import { HANDLE_NONE } from '@faf/heap';
import { MoverState, NO_REF, UnitBits, UnitState } from './constants.ts';
import type { World } from './world.ts';

/**
 * Spawns a unit of blueprint `bp` for `army` at (x, z) with `yaw`. Returns the slot or −1 if
 * the unit table, the mover pool or the army's unit cap is exhausted. Caller validates bp/army.
 */
export function spawnUnit(w: World, bp: number, army: number, x: number, z: number, yaw: number): number {
  const A = w.armies.col;
  if (A.unitCount[army]! >= A.unitCap[army]!) return -1;
  const units = w.units;
  const idx = units.alloc();
  if (idx < 0) return -1;
  const row = w.movers.add(idx);
  if (row < 0) {
    units.free(idx);
    return -1;
  }
  const U = units.col;
  const t = w.bp;
  // alloc() zeroed the row; set every non-zero default explicitly.
  U.bp[idx] = bp;
  U.army[idx] = army;
  U.layer[idx] = t.layerCol[bp]!;
  U.state[idx] = UnitState.Idle;
  U.flags[idx] = UnitBits.NoInterp | UnitBits.Fresh;
  U.gen[idx] = units.gen[idx]!;
  U.x[idx] = x;
  U.y[idx] = 0;
  U.z[idx] = z;
  U.px[idx] = x;
  U.py[idx] = 0;
  U.pz[idx] = z;
  U.yaw[idx] = yaw;
  U.pyaw[idx] = yaw;
  U.hp[idx] = t.maxHpCol[bp]!;
  U.lastHitBy[idx] = HANDLE_NONE;
  U.orderHead[idx] = NO_REF;
  U.orderTail[idx] = NO_REF;
  U.formation[idx] = NO_REF;
  U.groupOffset[idx] = NO_REF;
  U.mover[idx] = row;
  U.air[idx] = NO_REF;
  U.builder[idx] = NO_REF;
  U.factory[idx] = NO_REF;
  U.shield[idx] = NO_REF;
  U.intel[idx] = NO_REF;
  U.eco[idx] = NO_REF;
  const M = w.movers.col;
  M.tx[row] = x;
  M.tz[row] = z;
  M.speed[row] = 0;
  M.state[row] = MoverState.Idle;
  M.flags[row] = 0;
  A.unitCount[army] = A.unitCount[army]! + 1;
  return idx;
}

/** Marks a live unit as dead; it stops acting immediately and is released in Cleanup. */
export function killUnit(w: World, idx: number): void {
  const U = w.units.col;
  U.flags[idx] = (U.flags[idx]! | UnitBits.Dead) >>> 0;
  U.state[idx] = UnitState.Idle;
  const row = U.mover[idx]!;
  if (row >= 0) {
    w.movers.col.state[row] = MoverState.Idle;
    w.movers.col.speed[row] = 0;
  }
}

/** True if slot `idx` is live and not marked dead. */
export function isActive(w: World, idx: number): boolean {
  return w.units.isLive(idx) && (w.units.col.flags[idx]! & UnitBits.Dead) === 0;
}

/**
 * Phase 15 Cleanup: releases every dead unit in ascending slot order (slot free → gen++,
 * FIFO reuse; mover swap-remove with back-pointer fix; army unit count).
 */
export function cleanupPhase(w: World): void {
  const units = w.units;
  const U = units.col;
  const flags = U.flags;
  const alive = units.alive;
  const hw = units.highWater;
  const A = w.armies.col;
  for (let i = 0; i < hw; i++) {
    if (alive[i] !== 1 || (flags[i]! & UnitBits.Dead) === 0) continue;
    const row = U.mover[i]!;
    if (row >= 0) {
      const moved = w.movers.removeAt(row);
      if (moved >= 0) U.mover[moved] = row;
      U.mover[i] = NO_REF;
    }
    const army = U.army[i]!;
    A.unitCount[army] = A.unitCount[army]! - 1;
    units.free(i);
  }
}
