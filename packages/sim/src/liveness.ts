import { UnitBits } from './constants.ts';
import type { World } from './world.ts';
/** True if slot `idx` is live and not marked dead. */
export function isActive(w: World, idx: number): boolean {
  return w.units.isLive(idx) && (w.units.col.flags[idx]! & UnitBits.Dead) === 0;
}
