/**
 * Phase 3 PathService (PLAN §3.4, §3.8, M6): corridor repaths first (paths whose remaining
 * corridor a new footprint cut, flag set by nav.stampFootprint in CommandApply, or whose lazy
 * refinement failed), then `nav.serviceTick` with the fixed expansion budget
 * PATH_BUDGET_EXPANSIONS (FIFO by (issueTick, entityIdx)), then the group records whose path just
 * finished learn their effective anchor (retargeted goal of an unreachable target).
 *
 * A group path is re-planned from its previous waypoint (the last point every member passed);
 * the members restart their waypoint index with the new generation. An own path (stuck chain)
 * is re-planned from the unit's position.
 */
import { PATH_DIRECT, PATH_F_REPATH, PATH_PENDING, PATH_READY } from '@faf/nav';
import { FormationState, NO_REF, PATH_BUDGET_EXPANSIONS } from './constants.ts';
import { WH_TICK } from './schema.ts';
import { SC } from './scratch.ts';
import type { World } from './world.ts';

export function pathServicePhase(w: World): void {
  const nav = w.nav;
  const tick = w.header.i32[WH_TICK]!;
  const paths = nav.st.paths;
  const pflags = paths.col.flags;
  const palive = paths.alive;
  const owner = w.pathOwner;
  const F = w.formations.col;
  const U = w.units.col;
  const M = w.movers.col;
  const hw = paths.highWater;
  const pt = SC.pt;
  for (let p = 0; p < hw; p++) {
    if (palive[p] !== 1 || (pflags[p]! & PATH_F_REPATH) === 0) continue;
    const o = owner[p]!;
    if (o >= 0) {
      nav.pathPrev(p, pt);
      nav.repath(p, pt[0]!, pt[1]!, tick);
      F.consumed[o] = 0;
      F.gen[o] = (F.gen[o]! + 1) & 0xffff;
      F.state[o] = FormationState.Requested;
    } else if (o <= -2) {
      const u = -2 - o;
      nav.repath(p, U.x[u]!, U.z[u]!, tick);
      const r = U.mover[u]!;
      if (r >= 0 && M.path[r] === p) M.wp[r] = 0;
    } else {
      // Orphaned path (no owner): nothing follows it any more.
      nav.release(p);
    }
  }
  nav.serviceTick(PATH_BUDGET_EXPANSIONS);
  const fh = w.formations.highWater;
  const falive = w.formations.alive;
  for (let f = 0; f < fh; f++) {
    if (falive[f] !== 1 || F.state[f] !== FormationState.Requested) continue;
    const p = F.path[f]!;
    if (p === NO_REF) {
      F.state[f] = FormationState.Ready;
      continue;
    }
    const s = nav.pathState(p);
    if (s === PATH_PENDING) continue;
    F.state[f] = FormationState.Ready;
    if (s === PATH_READY || s === PATH_DIRECT) {
      nav.pathGoal(p, pt);
      F.gx[f] = pt[0]!;
      F.gz[f] = pt[1]!;
    } else {
      F.gx[f] = F.tx[f]!;
      F.gz[f] = F.tz[f]!;
    }
  }
}
