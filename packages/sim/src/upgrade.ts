/** Upgrade work shares the mutually exclusive repair counters; the active order owns its target. */
import { OrderBits, OrderType, UnitBits } from './constants.ts';
import { ORD_OFFSET, ORD_TYPE_FLAGS, ORDER_RECORD_WORDS } from './schema.ts';
import { hasCategory } from './intel.ts';
import type { World } from './world.ts';

/** Only a begun, valid upgrade bills resources. Queued requests have no economic effect. */
export function upgradeTarget(w: World, u: number): number {
  const U = w.units.col, head = U.orderHead[u]!;
  if (head < 0 || (U.flags[u]! & (UnitBits.Dead | UnitBits.UnderConstruction)) !== 0) return -1;
  const o = head * ORDER_RECORD_WORDS, tf = w.orders.i32[o + ORD_TYPE_FLAGS]!;
  if ((tf & 255) !== OrderType.Upgrade || ((tf >> 8) & OrderBits.Begun) === 0) return -1;
  const target = w.orders.i32[o + ORD_OFFSET]!;
  return target >= 0 && target < w.bp.count && canUpgrade(w, U.bp[u]!, target) ? target : -1;
}

export function clearUpgradeWork(w: World, u: number): void {
  const U = w.units.col;
  U.repairDone.zero(u); U.repairPaidMass.zero(u); U.repairPaidEnergy.zero(u);
  U.buildRemainder.zero(u);
}

/** Commander successors and compatible stationary extractors retain their occupied site. */
export function canUpgrade(w: World, source: number, target: number): boolean {
  if (source < 0 || source >= w.bp.count || target < 0 || target >= w.bp.count || w.bp.upgradesTo(source) !== target) return false;
  if (hasCategory(w, source, 'COMMAND') && hasCategory(w, target, 'COMMAND')) return true;
  const bp = w.bp;
  return hasCategory(w, source, 'MASSEXTRACTION') && hasCategory(w, target, 'MASSEXTRACTION') &&
    hasCategory(w, source, 'STRUCTURE') && hasCategory(w, target, 'STRUCTURE') &&
    bp.speed[source] === 0 && bp.speed[target] === 0 && bp.layerCol[source] === bp.layerCol[target] &&
    bp.footprintWCol[source] === bp.footprintWCol[target] && bp.footprintHCol[source] === bp.footprintHCol[target] &&
    bp.spotKindCol[source] === bp.spotKindCol[target];
}

/** Commit only after full payment; damage remains the same absolute amount. */
export function completeUpgrade(w: World, u: number, target: number): void {
  const U = w.units.col, previous = U.bp[u]!;
  U.hp[u] = Math.min(w.bp.maxHpCol[target]!, U.hp[u]! + w.bp.maxHpCol[target]! - w.bp.maxHpCol[previous]!);
  U.bp[u] = target;
  // Commander successors retain their weapons; extractor successors retain their footprint. Reset mount pose.
  w.weapons.i32.fill(0, u * 80, (u + 1) * 80);
  clearUpgradeWork(w, u);
}
