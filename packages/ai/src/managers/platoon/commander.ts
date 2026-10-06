/**
 * Commander (Vogt) control of the PlatoonManager (ai.md §5.5 "Vogt", R-09; handover rule in
 * blackboard.ts). The build managers own the commander; the PlatoonManager claims it
 * (`claimAcu('platoon')`) only for:
 *   - burst retreat: HP / Σ DPS of enemies within their range + 10 WU (bombers/gunships with approach
 *     speed × 5 s) < 20 s ⇒ retreat at once (P0), independent of R_lokal;
 *   - retreat: HP < 50 % or R_lokal < 0.5 with enemies near ⇒ behind the nearest own factory (P0);
 *   - local defence: an enemy combat unit inside the leash (60 WU around the factory nearest to the
 *     commander; Hard with R_lokal ≥ 2 and no enemy bomber/gunship seen: 120 WU) and R_lokal incl.
 *     the commander ≥ 1.0 at the target ⇒ attack it (P1). A lone scout only if it stands within
 *     25 WU of the commander's build site (ai.md §4.3). Targets outside the leash are never chased:
 *     when the attacked target leaves the leash, or the commander stands outside it, it is called
 *     back to the leash centre (P1).
 *   - overcharge (Abstich): S_E ≥ 7,500 and ≥ 3 mobile enemies within 2.5 WU splash or a T2+ tank in
 *     the commander's range, always inside the leash (R-09: "Abstich nur innerhalb der Leine"); Hard's
 *     wider leash (120 WU at R ≥ 2) is its offensive use (P0, at most every 5 s).
 * Release: 15 s without an enemy combat unit in the base area (60 WU around the own start or inside
 * the leash of any own factory) ⇒ `releaseAcu('platoon')`, control returns to the previous owner.
 */
import type { EnemyContact, OwnRecord } from '../../blackboard.ts';
import type { ManagerContext } from '../../brain.ts';
import { Prio } from '../../commands/emitter.ts';
import { distSq } from '../../det.ts';
import { OVERCHARGE_MIN_STORED_E } from '../../threat.ts';
import { OrderKind, type Vec2 } from '../../types.ts';
import { BASE_RADIUS_WU } from '../engineer/shared.ts';
import { UC } from '../intel/unit-classes.ts';
import { RATIO_EPS, type Scene } from './scene.ts';

export const LEASH_WU = 60;
export const LEASH_HARD_WU = 120;
export const LEASH_HARD_MIN_RATIO = 2;
export const BURST_MIN_SECONDS = 20;
export const BURST_RANGE_EXTRA_WU = 10;
export const BURST_AIR_APPROACH_S = 5;
export const ACU_RETREAT_HP = 0.5;
export const ACU_RETREAT_RATIO = 0.5;
export const ACU_DEFEND_RATIO = 1.0;
export const SCOUT_NEAR_SITE_WU = 25;
export const OVERCHARGE_SPLASH_WU = 2.5;
export const OVERCHARGE_MIN_UNITS = 3;
export const OVERCHARGE_COOLDOWN_TICKS = 50;
export const ACU_RELEASE_TICKS = 150;
/** Distance behind the nearest factory for a retreat. */
export const BEHIND_FACTORY_WU = 12;

export type AcuAction = 'none' | 'defend' | 'retreat' | 'burst' | 'leash' | 'overcharge';

export class CommanderControl {
  /** Last tick an enemy combat unit was in the base area. */
  private lastThreatTick = -1;
  private lastOvercharge = -OVERCHARGE_COOLDOWN_TICKS;
  /** Last action (diagnostics/tests). */
  action: AcuAction = 'none';
  /** Leash centre and radius of the last think (tests). */
  leash: { x: number; z: number; r: number } | null = null;

  /** Runs one commander decision as a step; false if the budget/abort stopped it. */
  think(ctx: ManagerContext, scene: Scene): boolean {
    const bb = ctx.bb;
    const acu = bb.units.commander;
    const res = bb.reservations;
    const held = res.acuOwner === 'platoon';
    if (acu === null) {
      if (held) res.releaseAcu('platoon', ctx.tick);
      return true;
    }
    const tick = ctx.tick;
    const a = ctx.analysis;
    const fac = nearestFactory(bb.units.factories, acu.x, acu.z);
    const lc: Vec2 = fac ?? a.ownStart;
    // Enemies around the commander (for burst, retreat, defence): radius covers leash + reach.
    const near: EnemyContact[] = [];
    if (scene.enemiesNear(acu.x, acu.z, LEASH_HARD_WU + 60, UC.mobile | UC.structure, near) === null) return false;
    const local = scene.strengthAt(acu.x, acu.z, acu.blueprint.rangeMax + 20);
    if (local === null) return false;
    const airStrikeSeen = scene.airStrikeSeen;
    const leashR =
      ctx.profile.name === 'hard' && local.ratio >= LEASH_HARD_MIN_RATIO - RATIO_EPS && !airStrikeSeen ? LEASH_HARD_WU : LEASH_WU;
    this.leash = { x: lc.x, z: lc.z, r: leashR };
    const leash2 = leashR * leashR;
    // Base-area threat (release rule).
    let homeThreat = false;
    const base2 = BASE_RADIUS_WU * BASE_RADIUS_WU;
    for (const e of near) {
      if (!scene.isCombatant(e) || e.kind !== 'visible') continue;
      if (distSq(e.x, e.z, a.ownStart.x, a.ownStart.z) <= base2 || this.inAnyLeash(bb.units.factories, e, LEASH_WU)) {
        homeThreat = true;
        break;
      }
    }
    if (homeThreat) this.lastThreatTick = tick;

    // 1. burst check
    const hpAbs = acu.hpFrac * acu.blueprint.hpEff;
    let dps = 0;
    for (const e of near) {
      if (e.kind !== 'visible' || e.bp < 0) continue;
      const b = scene.classes.bp(e.bp);
      if (b.dpsSurface <= 0) continue;
      let reach = b.rangeMax + BURST_RANGE_EXTRA_WU;
      if (scene.classes.has(e.bp, UC.airStrike)) reach += b.speed * BURST_AIR_APPROACH_S;
      if (distSq(e.x, e.z, acu.x, acu.z) <= reach * reach) dps += b.dpsSurface;
    }
    const enemyClose = local.enemy > 0;
    let action: AcuAction = 'none';
    if (dps > 0 && hpAbs / dps < BURST_MIN_SECONDS) action = 'burst';
    else if (enemyClose && (acu.hpFrac < ACU_RETREAT_HP || local.ratio < ACU_RETREAT_RATIO - RATIO_EPS)) action = 'retreat';

    let target: EnemyContact | null = null;
    let ocTarget: EnemyContact | null = null;
    if (action === 'none') {
      // 3. local defence inside the leash
      let best = Infinity;
      const site: Vec2 = acu.order === OrderKind.Build ? { x: acu.orderX, z: acu.orderZ } : { x: acu.x, z: acu.z };
      const nearSite2 = SCOUT_NEAR_SITE_WU * SCOUT_NEAR_SITE_WU;
      for (const e of near) {
        if (e.kind !== 'visible' || e.bp < 0 || !scene.classes.has(e.bp, UC.mobile)) continue;
        if (distSq(e.x, e.z, lc.x, lc.z) > leash2) continue;
        const isScout = scene.classes.has(e.bp, UC.scout);
        if (!isScout && !scene.isCombatant(e)) continue;
        if (isScout && distSq(e.x, e.z, site.x, site.z) > nearSite2) continue;
        const d = distSq(e.x, e.z, acu.x, acu.z);
        if (d < best || (d === best && target !== null && e.id < target.id)) {
          best = d;
          target = e;
        }
      }
      if (target !== null) {
        const r = acu.blueprint.rangeMax + 20;
        const s = scene.strengthAt(target.x, target.z, r);
        if (s === null) return false;
        let own = s.own;
        if (distSq(acu.x, acu.z, target.x, target.z) > r * r) own += scene.ownThreat({ bp: acu.bp, x: acu.x, z: acu.z, hpFrac: acu.hpFrac });
        const ratio = own / Math.max(1, s.enemy);
        if (ratio >= ACU_DEFEND_RATIO - RATIO_EPS) action = 'defend';
        else target = null;
      }
      // overcharge (defensive: inside the leash; Hard also offensive)
      if (ctx.view.eco().energyStored >= OVERCHARGE_MIN_STORED_E && tick - this.lastOvercharge >= OVERCHARGE_COOLDOWN_TICKS) {
        ocTarget = this.overchargeTarget(scene, near, acu, { x: lc.x, z: lc.z, r2: leash2 });
        if (ocTarget !== null) action = 'overcharge';
      }
      if (action === 'none' && held) {
        // outside the leash, or still chasing a target that left it ⇒ back to the leash centre
        let chasing = false;
        if (acu.order === OrderKind.Attack) {
          const c = bb.enemy.contacts.get(acu.orderTarget);
          chasing = c === undefined || distSq(c.x, c.z, lc.x, lc.z) > leash2;
        }
        if (chasing || distSq(acu.x, acu.z, lc.x, lc.z) > leash2) action = 'leash';
      }
    }

    const release = held && action === 'none' && (this.lastThreatTick < 0 || tick - this.lastThreatTick >= ACU_RELEASE_TICKS);
    const decided = action;
    const tgt = target;
    const oc = ocTarget;
    return ctx.step(() => {
      const em = ctx.emitter;
      if (decided === 'burst' || decided === 'retreat') {
        const p = behindFactory(fac, a.ownStart, near, acu);
        em.move([acu.handle], p.x, p.z, Prio.P0, { source: 'platoon' });
      } else if (decided === 'overcharge' && oc !== null) {
        em.overcharge(acu.handle, oc.id, Prio.P0, { source: 'platoon' });
      } else if (decided === 'defend' && tgt !== null) {
        em.attack([acu.handle], tgt.id, Prio.P1, { source: 'platoon' });
      } else if (decided === 'leash') {
        em.move([acu.handle], lc.x, lc.z, Prio.P1, { source: 'platoon' });
      }
      return () => {
        this.action = decided;
        if (decided !== 'none') res.claimAcu('platoon', tick, decided);
        if (decided === 'overcharge') this.lastOvercharge = tick;
        if (release) res.releaseAcu('platoon', tick);
      };
    });
  }

  private inAnyLeash(factories: readonly OwnRecord[], e: EnemyContact, r: number): boolean {
    const r2 = r * r;
    for (const f of factories) if (distSq(f.x, f.z, e.x, e.z) <= r2) return true;
    return false;
  }

  /** Overcharge target: a cluster of ≥ 3 mobile enemies within the splash, or a T2+ tank, in range. */
  private overchargeTarget(
    scene: Scene,
    near: readonly EnemyContact[],
    acu: OwnRecord,
    within: { x: number; z: number; r2: number },
  ): EnemyContact | null {
    const range = acu.blueprint.rangeMax;
    const r2 = range * range;
    const s2 = OVERCHARGE_SPLASH_WU * OVERCHARGE_SPLASH_WU;
    const mobile = near.filter((e) => e.kind === 'visible' && e.bp >= 0 && scene.classes.has(e.bp, UC.mobile) && !scene.classes.has(e.bp, UC.air));
    let best: EnemyContact | null = null;
    let bestN = 0;
    for (const e of mobile) {
      if (distSq(e.x, e.z, acu.x, acu.z) > r2) continue;
      if (distSq(e.x, e.z, within.x, within.z) > within.r2) continue;
      let n = 0;
      for (const o of mobile) if (distSq(o.x, o.z, e.x, e.z) <= s2) n++;
      const heavy = scene.classes.has(e.bp, UC.heavyTank);
      const score = heavy ? Math.max(n, OVERCHARGE_MIN_UNITS) : n;
      if (score >= OVERCHARGE_MIN_UNITS && (score > bestN || (score === bestN && best !== null && e.id < best.id))) {
        best = e;
        bestN = score;
      }
    }
    return best;
  }
}

export function nearestFactory(factories: readonly OwnRecord[], x: number, z: number): OwnRecord | null {
  let best: OwnRecord | null = null;
  let bd = Infinity;
  for (const f of factories) {
    const d = distSq(f.x, f.z, x, z);
    if (d < bd || (d === bd && best !== null && f.handle < best.handle)) {
      best = f;
      bd = d;
    }
  }
  return best;
}

/** Point behind the nearest factory as seen from the enemies near the commander. */
export function behindFactory(fac: OwnRecord | null, ownStart: Vec2, enemies: readonly EnemyContact[], acu: OwnRecord): Vec2 {
  const anchor: Vec2 = fac ?? ownStart;
  let ex = 0;
  let ez = 0;
  let n = 0;
  for (const e of enemies) {
    if (e.kind !== 'visible') continue;
    ex += e.x;
    ez += e.z;
    n++;
  }
  let dx: number;
  let dz: number;
  if (n > 0) {
    dx = anchor.x - ex / n;
    dz = anchor.z - ez / n;
  } else {
    dx = anchor.x - acu.x;
    dz = anchor.z - acu.z;
  }
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len < 1e-6) return { x: anchor.x, z: anchor.z };
  return { x: anchor.x + (dx / len) * BEHIND_FACTORY_WU, z: anchor.z + (dz / len) * BEHIND_FACTORY_WU };
}
