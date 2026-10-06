/**
 * Spot choice for expansions (ai.md §5.1 "Mex-Expansion", §4.2 `mex:next`/`hydro:next`/`ring`):
 *
 *   score(spot) = d(builder, spot) + 0.5 · d_own(spot) + 200 · min(1, T_surface / 100)
 *                 + 400 · [zone = contested ∧ no cover]
 *
 * T_surface below T_eng = 20 counts 0 (R-06); spots with T_surface > 150 and no own cover are
 * blocked; contested spots only from 6:00 or T2 and only while a platoon holds the staging point.
 * Smallest score wins, ties by spot index. `freeMassSpots()`/`freeHydroSpots()` only know KNOWN
 * occupancy (R-08); reserved and locked spots are skipped.
 */
import { RING_MAX_WU } from '../../analysis/map-analysis.ts';
import type { SpotKind, Vec2 } from '../../types.ts';
import {
  CONTESTED_FROM_TICK,
  COVER_RADIUS_WU,
  SPOT_BLOCK_THREAT,
  T_ENG,
  travelWu,
  type BuildShared,
  type PlaceContext,
} from './shared.ts';

export interface SpotPick {
  readonly spot: number;
  readonly x: number;
  readonly z: number;
  readonly score: number;
}

export interface SpotPickOptions {
  readonly kind: SpotKind;
  readonly builder: Vec2;
  readonly ringOnly: boolean;
  readonly owner: string;
  readonly holder: number;
}

/**
 * A platoon holds the staging point (ai.md §5.1: condition for contested spots): a staging or
 * attacking platoon within COVER_RADIUS_WU of it, or an attacking platoon that already stands beyond
 * it (d_own larger than the staging point's) — a wave pushing into the enemy half covers the area
 * behind it (tai-p5 calibration: without the second case the contested spots of Hollow Ridge were
 * only allowed for the few seconds a wave waited at the staging point).
 */
export function platoonHoldsStaging(sh: BuildShared): boolean {
  const a = sh.analysis;
  const st = a.staging;
  const dSt = a.dOwnAt(st.x, st.z);
  for (const p of sh.bb.platoons) {
    if (p.units.length === 0 || (p.state !== 'staging' && p.state !== 'attack')) continue;
    const dx = p.x - st.x;
    const dz = p.z - st.z;
    if (dx * dx + dz * dz <= COVER_RADIUS_WU * COVER_RADIUS_WU) return true;
    if (p.state === 'attack' && Number.isFinite(dSt) && a.dOwnAt(p.x, p.z) >= dSt) return true;
  }
  return false;
}

/** Contested spots are allowed from 6:00 or T2 while a platoon holds the staging point. */
export function contestedAllowed(sh: BuildShared, tick: number): boolean {
  return (tick >= CONTESTED_FROM_TICK || sh.bb.tech.level >= 2) && platoonHoldsStaging(sh);
}

/**
 * Own surface threat of combat units within 40 WU (perception order); `take` charges one op per
 * visited unit. Null = budget exhausted.
 */
export function ownCoverThreat(sh: BuildShared, x: number, z: number, take: (n: number) => boolean): number | null {
  const army = sh.bb.units.army;
  if (!take(army.length)) return null;
  const r2 = COVER_RADIUS_WU * COVER_RADIUS_WU;
  let sum = 0;
  for (const u of army) {
    if (sh.flags.combat[u.bp] !== 1) continue;
    const dx = u.x - x;
    const dz = u.z - z;
    if (dx * dx + dz * dz <= r2) sum += u.blueprint.threatSurface * u.hpFrac;
  }
  return sum;
}

/** Cover: own combat threat nearby that is positive and at least the enemy threat. */
export function hasCover(ownThreat: number, enemyThreat: number): boolean {
  return ownThreat > 0 && ownThreat >= enemyThreat;
}

/** True if a spot is neither reserved (by anyone but `owner`/`holder`) nor locked. */
export function spotFreeFor(sh: BuildShared, spot: number, tick: number, owner: string, holder: number): boolean {
  const res = sh.bb.reservations;
  const r = res.spotReservation(spot);
  if (r !== undefined) return r.owner === owner && (r.holder === holder || r.holder === 0);
  return res.isSpotAvailable(spot, tick);
}

/** Best spot for a builder by the §5.1 score (see module doc). */
export function pickSpot(pc: PlaceContext, o: SpotPickOptions): SpotPick | null | 'budget' {
  const sh = pc.sh;
  const take = (n: number): boolean => pc.budget.take(n);
  const list = o.kind === 'mass' ? pc.view.freeMassSpots() : pc.view.freeHydroSpots();
  const contestedOk = contestedAllowed(sh, pc.tick);
  let best: SpotPick | null = null;
  for (const sp of list) {
    if (!take(1)) return 'budget';
    const info = sh.analysis.spots[sp.index]!;
    if (info.zone !== 'own' && info.zone !== 'contested') continue;
    if (o.ringOnly && (info.zone !== 'own' || info.dOwn > RING_MAX_WU)) continue;
    const contested = info.zone === 'contested';
    if (contested && !contestedOk) continue;
    if (!spotFreeFor(sh, sp.index, pc.tick, o.owner, o.holder)) continue;
    if (plannedSpot(pc, `spot:${sp.index}`)) continue;
    const t = sh.spotThreatAt(sp.index, take);
    if (t === null) return 'budget';
    let cover = false;
    if (t > SPOT_BLOCK_THREAT || contested) {
      const own = ownCoverThreat(sh, sp.x, sp.z, take);
      if (own === null) return 'budget';
      cover = hasCover(own, t);
      if (t > SPOT_BLOCK_THREAT && !cover) continue;
    }
    const threatTerm = t >= T_ENG ? 200 * Math.min(1, t / 100) : 0;
    const score =
      travelWu(sh, o.builder.x, o.builder.z, sp.x, sp.z) + 0.5 * info.dOwn + threatTerm + (contested && !cover ? 400 : 0);
    if (best === null || score < best.score || (score === best.score && sp.index < best.spot)) {
      best = { spot: sp.index, x: sp.x, z: sp.z, score };
    }
  }
  return best;
}

/** The spot is already a planned place (any builder, also another step of the same builder). */
function plannedSpot(pc: PlaceContext, key: string): boolean {
  if (pc.sh.planned.has(key)) return true;
  if (pc.extra !== undefined) for (const e of pc.extra) if (e.key === key) return true;
  return false;
}

/**
 * Free, reachable, unreserved spots of a kind in the zones own (+ contested if `withContested`),
 * without threat checks — the cheap count used for the engineer target and the number of
 * expansion tasks. One op per listed spot; null = budget exhausted.
 */
export function countFreeSpots(
  sh: BuildShared,
  list: readonly { readonly index: number }[],
  tick: number,
  withContested: boolean,
  take: (n: number) => boolean,
): number | null {
  if (!take(list.length)) return null;
  let n = 0;
  for (const sp of list) {
    const info = sh.analysis.spots[sp.index]!;
    if (info.zone !== 'own' && !(withContested && info.zone === 'contested')) continue;
    if (!sh.bb.reservations.isSpotAvailable(sp.index, tick)) continue;
    n++;
  }
  return n;
}
