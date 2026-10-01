import { UnitBits,UnitState,MoverState } from './constants.ts';
import { clearOrders } from './orders.ts';
import type { World } from './world.ts';
/**
 * Marks a live unit as dead; it stops acting immediately (orders, paths and group references are
 * released now) and is released in Cleanup.
 */
export function killUnit(w: World, idx: number): void {
  const U = w.units.col;
  U.flags[idx] = (U.flags[idx]! | UnitBits.Dead) >>> 0;
  U.state[idx] = UnitState.Idle;
  const row = U.mover[idx]!;
  clearOrders(w, idx, row);
  if (row >= 0) {
    w.movers.col.state[row] = MoverState.Idle;
    w.movers.col.speed[row] = 0;
  }
}
