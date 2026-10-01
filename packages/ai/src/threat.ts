/**
 * Strength estimate of ai.md §5.5/§5.6: threat(u) = √(DPS_layer · HP_eff) · hpFrac. The sum of
 * roots is linear in the number of equal units (7 vs 10 Punzen ⇒ R = 0.7 exactly).
 *
 * Only knowledge a player has on screen enters (ai.md §1, R-07): positions, types, HP fraction of
 * visible units; the enemy commander factor depends on a SEEN energy storage or the game time, never
 * on the enemy's stored energy; blips count with the median threat of the highest SEEN enemy tech.
 */
import type { AiBlueprint, AiBlueprintTable, ThreatLayer } from './types.ts';

/** Stored energy that enables the own commander's overcharge (ai.md §5.5). */
export const OVERCHARGE_MIN_STORED_E = 7500;
/** Commander multiplier while overcharge is possible. */
export const ACU_OVERCHARGE_FACTOR = 1.5;
/** From this tick the enemy commander counts ×1.5 even without a seen energy storage (5:00). */
export const ENEMY_ACU_FACTOR_TICK = 3000;

/** Threat of one unit: √(DPS_layer · HP_eff) · hpFrac. */
export function threatOf(bp: AiBlueprint, hpFrac: number, layer: ThreatLayer): number {
  const base = layer === 'surface' ? bp.threatSurface : bp.threatAir;
  return base * hpFrac;
}

/** Factor of the OWN commander: ×1.5 while S_E ≥ 7,500 (overcharge possible). */
export function ownAcuFactor(ownStoredEnergy: number): number {
  return ownStoredEnergy >= OVERCHARGE_MIN_STORED_E ? ACU_OVERCHARGE_FACTOR : 1;
}

/**
 * Factor of an ENEMY commander: ×1.5 once an enemy energy storage has been seen (visible or ghost)
 * or from 5:00 on. The enemy's stored energy is never an input (R-07, AI-PERC-03).
 */
export function enemyAcuFactor(enemyEnergyStorageSeen: boolean, tick: number): number {
  return enemyEnergyStorageSeen || tick >= ENEMY_ACU_FACTOR_TICK ? ACU_OVERCHARGE_FACTOR : 1;
}

/**
 * Median blip threat per tech level (index 0..4; index 0 = unknown ⇒ tech 1). Definition: upper
 * median of the surface threat over the direct-fire land combat units of that tech
 * (`LAND & MOBILE & DIRECTFIRE - SCOUT - SNIPER - COMMAND`), sorted ascending, element ⌊n/2⌋.
 * With the current roster: T1 84 (Punze), T2 294 (Meißel), T3 693 — the values of ai.md §5.5.
 * A tech without such units inherits the next lower tech's value.
 */
export function blipThreatTable(table: AiBlueprintTable): Float64Array {
  const expr = table.compile('LAND & MOBILE & DIRECTFIRE - SCOUT - SNIPER - COMMAND');
  const out = new Float64Array(5);
  for (let tech = 1; tech <= 4; tech++) {
    const vals: number[] = [];
    for (const bp of table.list) {
      if (bp.tech === tech && table.matches(bp, expr) && bp.threatSurface > 0) vals.push(bp.threatSurface);
    }
    vals.sort((a, b) => a - b);
    out[tech] = vals.length > 0 ? vals[Math.floor(vals.length / 2)]! : out[tech - 1]!;
  }
  out[0] = out[1]!;
  return out;
}

/** Blip threat for the highest enemy tech seen so far (0/1 ⇒ T1). */
export function blipThreat(blipTable: Float64Array, highestSeenTech: number): number {
  const t = highestSeenTech < 1 ? 1 : highestSeenTech > 4 ? 4 : Math.floor(highestSeenTech);
  return blipTable[t]!;
}

/** A unit entering a strength sum. `bp` −1 = blip. */
export interface ThreatUnit {
  readonly bp: number;
  readonly x: number;
  readonly z: number;
  readonly hpFrac: number;
}

/** Context of a strength sum (explicit inputs only, no fog knowledge). */
export interface StrengthContext {
  readonly table: AiBlueprintTable;
  readonly layer: ThreatLayer;
  readonly tick: number;
  /** Own stored energy (own commander factor). */
  readonly ownStoredEnergy: number;
  /** An enemy energy storage has been seen (visible/ghost). */
  readonly enemyEnergyStorageSeen: boolean;
  /** Highest enemy tech seen (blip threat). */
  readonly highestEnemyTechSeen: number;
  /** blipThreatTable(table). */
  readonly blipTable: Float64Array;
}

function isCommander(bp: AiBlueprint): boolean {
  return bp.categoryNames.includes('COMMAND');
}

/** Threat of one own unit incl. the commander factor. */
export function ownUnitThreat(u: ThreatUnit, ctx: StrengthContext): number {
  if (u.bp < 0) return 0;
  const bp = ctx.table.list[u.bp]!;
  const t = threatOf(bp, u.hpFrac, ctx.layer);
  return isCommander(bp) ? t * ownAcuFactor(ctx.ownStoredEnergy) : t;
}

/** Threat of one known enemy (visible/ghost: blueprint; blip: median threat, surface only). */
export function enemyUnitThreat(u: ThreatUnit, ctx: StrengthContext): number {
  if (u.bp < 0) return ctx.layer === 'surface' ? blipThreat(ctx.blipTable, ctx.highestEnemyTechSeen) : 0;
  const bp = ctx.table.list[u.bp]!;
  const t = threatOf(bp, u.hpFrac, ctx.layer);
  return isCommander(bp) ? t * enemyAcuFactor(ctx.enemyEnergyStorageSeen, ctx.tick) : t;
}

/**
 * Σ threat of the units within radius r of (x, z) (inclusive), in the given iteration order
 * (fixed order ⇒ identical float sums, ai.md §2.5).
 */
export function sumThreatInRadius(
  units: readonly ThreatUnit[],
  x: number,
  z: number,
  r: number,
  threat: (u: ThreatUnit) => number,
): number {
  const r2 = r * r;
  let sum = 0;
  for (let i = 0; i < units.length; i++) {
    const u = units[i]!;
    const dx = u.x - x;
    const dz = u.z - z;
    if (dx * dx + dz * dz <= r2) sum += threat(u);
  }
  return sum;
}

export interface LocalStrength {
  readonly own: number;
  readonly enemy: number;
  /** own / max(1, enemy) (ai.md §5.5 R_lokal). */
  readonly ratio: number;
}

/** R_lokal around (x, z): own vs. enemy threat within r (ai.md §5.5). */
export function localStrength(
  own: readonly ThreatUnit[],
  enemies: readonly ThreatUnit[],
  x: number,
  z: number,
  r: number,
  ctx: StrengthContext,
): LocalStrength {
  const o = sumThreatInRadius(own, x, z, r, (u) => ownUnitThreat(u, ctx));
  const e = sumThreatInRadius(enemies, x, z, r, (u) => enemyUnitThreat(u, ctx));
  return { own: o, enemy: e, ratio: o / Math.max(1, e) };
}

/** Largest weapon range of a group + 20 WU: the strength radius of ai.md §5.5. */
export function strengthRadius(table: AiBlueprintTable, bps: readonly number[]): number {
  let r = 0;
  for (const b of bps) {
    const bp = table.list[b];
    if (bp !== undefined && bp.rangeMax > r) r = bp.rangeMax;
  }
  return r + 20;
}
