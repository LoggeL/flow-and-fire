/**
 * Per-think situation picture of the PlatoonManager: own units with threat and the reactable known
 * enemies in bucket indices, plus the local strength estimate of ai.md §5.5 (the only R_lokal of the
 * AI: `strengthAt` sums `sumThreatInRadius` over the bucket candidates, `localStrengthOf`):
 *
 *   R_lokal = Σ threat(own units in r) / max(1, Σ threat(enemy units and structures in r))
 *   threat  = √(DPS_layer · HP_eff) · hpFrac (threat.ts; own commander ×1.5 at S_E ≥ 7,500; enemy
 *             commander ×1.5 once an enemy energy storage was SEEN or t ≥ 5:00; blips = median of the
 *             highest seen tech) — only on-screen knowledge (R-07, AI-PERC-03).
 *
 * Easy (`threatVisibleOnly`): only currently visible enemies count (no ghosts, no blips).
 * Grid mode (`profile.platoonGridMode`, MS11+, default off): the enemy sum is the 3 × 3 window of
 * the IntelManager's threat grid instead of the unit sum.
 */
import type { Blackboard, EnemyContact, OwnRecord } from '../../blackboard.ts';
import type { MapAnalysis } from '../../analysis/map-analysis.ts';
import { distSq } from '../../det.ts';
import type { ManagerContext } from '../../brain.ts';
import {
  enemyUnitThreat,
  localStrengthOf,
  ownUnitThreat,
  sumThreatInRadius,
  type LocalStrength,
  type StrengthContext,
  type ThreatUnit,
} from '../../threat.ts';
import { ThreatGrid } from '../intel/threat-grid.ts';
import { UC, type UnitClasses } from '../intel/unit-classes.ts';
import { SpatialBuckets } from './spatial.ts';

/** Own unit entry of the scene (ThreatUnit + handle). */
export interface OwnEntry extends ThreatUnit {
  readonly handle: number;
  readonly rec: OwnRecord;
}

/** Comparisons against the thresholds use this tolerance so 7 vs 10 Punzen is exactly R = 0.7. */
export const RATIO_EPS = 1e-9;

/** A platoon holds the staging point: state 'staging' within 30 WU and R ≥ 1.0 (ai.md §5.4 rally). */
export const STAGING_HOLD_RADIUS_WU = 30;

/** True if an own platoon (last published `bb.platoons`) holds the staging point with R ≥ 1.0. */
export function stagingHeld(bb: Blackboard, a: MapAnalysis): boolean {
  const r2 = STAGING_HOLD_RADIUS_WU * STAGING_HOLD_RADIUS_WU;
  return bb.platoons.some((p) => p.state === 'staging' && p.ratio >= 1 - RATIO_EPS && distSq(p.x, p.z, a.staging.x, a.staging.z) <= r2);
}

export class Scene {
  readonly own: OwnEntry[] = [];
  readonly enemies: EnemyContact[] = [];
  readonly ownIdx: SpatialBuckets<OwnEntry>;
  readonly enemyIdx: SpatialBuckets<EnemyContact>;
  sctx!: StrengthContext;
  ctx!: ManagerContext;
  /** Threat-weighted shares of the 180-s enemy window (counter-table rules used by the platoons). */
  shareSniper = 0;
  sharePd = 0;
  shareArty = 0;
  /** An enemy bomber/gunship is in the 180-s window (Hard forward leash, ai.md §5.5). */
  airStrikeSeen = false;
  /** An own platoon holds the staging point (forming units gather there, like the factory rally). */
  stagingHeld = false;
  private readonly scratchOwn: OwnEntry[] = [];
  private readonly scratchEnemy: EnemyContact[] = [];

  constructor(
    sizeWu: number,
    readonly classes: UnitClasses,
  ) {
    this.ownIdx = new SpatialBuckets(sizeWu);
    this.enemyIdx = new SpatialBuckets(sizeWu);
  }

  /** Rebuilds the scene; returns false if the budget does not cover the unit visits. */
  build(ctx: ManagerContext): boolean {
    const bb = ctx.bb;
    let windowSize = 0;
    bb.enemy.forEachWindow(() => windowSize++);
    const cost = bb.units.all.length + bb.enemy.current.length + windowSize;
    if (!ctx.budget.take(cost)) return false;
    let total = 0;
    let sniper = 0;
    let pd = 0;
    let arty = 0;
    let air = false;
    const cl = this.classes;
    bb.enemy.forEachWindow((bp, w) => {
      total += w;
      if (bp < 0) return;
      if (cl.bp(bp).categoryNames.includes('SNIPER')) sniper += w;
      if (cl.has(bp, UC.pd)) pd += w;
      if (cl.has(bp, UC.arty)) arty += w;
      if (cl.has(bp, UC.airStrike)) air = true;
    });
    this.shareSniper = total > 0 ? sniper / total : 0;
    this.sharePd = total > 0 ? pd / total : 0;
    this.shareArty = total > 0 ? arty / total : 0;
    this.airStrikeSeen = air;
    this.stagingHeld = stagingHeld(bb, ctx.analysis);
    this.ctx = ctx;
    this.own.length = 0;
    this.enemies.length = 0;
    this.ownIdx.clear();
    this.enemyIdx.clear();
    for (const u of bb.units.all) {
      if (!u.complete) continue;
      const b = u.blueprint;
      if (b.threatSurface <= 0) continue;
      const e: OwnEntry = { handle: u.handle, bp: u.bp, x: u.x, z: u.z, hpFrac: u.hpFrac, rec: u };
      this.own.push(e);
      this.ownIdx.add(e);
    }
    const visibleOnly = ctx.profile.threatVisibleOnly;
    for (const c of bb.enemy.current) {
      if (visibleOnly && c.kind !== 'visible') continue;
      this.enemies.push(c);
      this.enemyIdx.add(c);
    }
    this.sctx = {
      table: ctx.static.bps,
      layer: 'surface',
      tick: ctx.tick,
      ownStoredEnergy: ctx.view.eco().energyStored,
      enemyEnergyStorageSeen: bb.enemy.estoreSeen,
      highestEnemyTechSeen: bb.enemy.highestTechSeen,
      blipTable: bb.blipTable,
    };
    return true;
  }

  ownThreat(u: ThreatUnit): number {
    return ownUnitThreat(u, this.sctx);
  }

  enemyThreat(u: ThreatUnit): number {
    return enemyUnitThreat(u, this.sctx);
  }

  private readonly ownThreatFn = (u: ThreatUnit): number => ownUnitThreat(u, this.sctx);
  private readonly enemyThreatFn = (u: ThreatUnit): number => enemyUnitThreat(u, this.sctx);

  /** Σ enemy threat within r of (x, z); null if the budget is exhausted. */
  enemyNear(x: number, z: number, r: number): number | null {
    const ctx = this.ctx;
    if (ctx.profile.platoonGridMode && ctx.bb.threat instanceof ThreatGrid) {
      if (!ctx.budget.take(9)) return null;
      return ctx.bb.threat.sumWindow('surface', x, z, 1);
    }
    const list = this.enemyIdx.gather(x, z, r, this.scratchEnemy);
    const n = list.length;
    if (!ctx.budget.take(n)) {
      list.length = 0;
      return null;
    }
    const s = sumThreatInRadius(list, x, z, r, this.enemyThreatFn);
    list.length = 0;
    return s;
  }

  /** Σ own threat within r of (x, z); null if the budget is exhausted. */
  ownNear(x: number, z: number, r: number): number | null {
    const list = this.ownIdx.gather(x, z, r, this.scratchOwn);
    const n = list.length;
    if (!this.ctx.budget.take(n)) {
      list.length = 0;
      return null;
    }
    const s = sumThreatInRadius(list, x, z, r, this.ownThreatFn);
    list.length = 0;
    return s;
  }

  /** R_lokal at (x, z) with radius r; null if the budget is exhausted. */
  strengthAt(x: number, z: number, r: number): LocalStrength | null {
    const o = this.ownNear(x, z, r);
    if (o === null) return null;
    const e = this.enemyNear(x, z, r);
    if (e === null) return null;
    return localStrengthOf(o, e);
  }

  /** Enemies within r of (x, z) matching `flag` (visible only unless `withGhosts`); charges visits. */
  enemiesNear(x: number, z: number, r: number, flag: number, out: EnemyContact[]): EnemyContact[] | null {
    const list = this.enemyIdx.gather(x, z, r, this.scratchEnemy);
    if (!this.ctx.budget.take(list.length)) {
      list.length = 0;
      return null;
    }
    const r2 = r * r;
    for (const e of list) {
      if (e.bp < 0 || !this.classes.has(e.bp, flag)) continue;
      const dx = e.x - x;
      const dz = e.z - z;
      if (dx * dx + dz * dz <= r2) out.push(e);
    }
    list.length = 0;
    return out;
  }

  /** True if the unit is a mobile enemy combat unit (not a scout). */
  isCombatant(e: EnemyContact): boolean {
    return e.bp >= 0 && this.classes.has(e.bp, UC.combatant);
  }
}
