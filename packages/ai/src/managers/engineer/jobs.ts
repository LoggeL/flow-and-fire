/**
 * Status of a build order as the perception shows it. A manager never learns directly whether the
 * emitter sent a command (APM, budget) or whether the sim accepted it; it compares the order it
 * issued with the builder's perceived order and the own structures (ai.md §2.4: "Was nicht passt,
 * bleibt im Blackboard und wird im nächsten Think erneut bewertet").
 */
import type { OwnRecord } from '../../blackboard.ts';
import { OrderKind } from '../../types.ts';
import type { BuildShared } from './shared.ts';

export type BuildStatus =
  /** Issued, not yet visible (command in flight, within the confirmation window). */
  | 'pending'
  /** The builder works on it (walking there or building). */
  | 'running'
  /** The construction site exists but nobody builds it (builder idle): resume. */
  | 'stalled'
  /** The structure is complete. */
  | 'done'
  /** Neither order nor site visible after the confirmation window (dropped, rejected, replaced). */
  | 'lost';

export interface BuildOrderRef {
  readonly bp: number;
  readonly x: number;
  readonly z: number;
  readonly issuedTick: number;
  siteHandle: number;
  confirmed: boolean;
}

/** Ticks after issuing within which a missing order is still "in flight": lead + 2 thinks. */
export function confirmTicks(lead: number, thinkEvery: number): number {
  return lead + 2 * thinkEvery;
}

/** True if the builder's current order is the build of `bp` at (x, z). */
export function isBuildingAt(b: OwnRecord, bp: number, x: number, z: number): boolean {
  return b.order === OrderKind.Build && b.orderBp === bp && Math.abs(b.orderX - x) <= 1 && Math.abs(b.orderZ - z) <= 1;
}

/** True if the builder currently works on the site `handle` (build, assist or repair). */
export function isWorkingOn(b: OwnRecord, site: OwnRecord): boolean {
  if (b.order === OrderKind.Build) return b.orderTarget === site.handle || isBuildingAt(b, site.bp, site.x, site.z);
  return (b.order === OrderKind.Assist || b.order === OrderKind.Repair || b.order === OrderKind.Guard) && b.orderTarget === site.handle;
}

/** The structure a build order produced (by handle once known, else by position and blueprint). */
export function siteOf(sh: BuildShared, ref: BuildOrderRef): OwnRecord | null {
  if (ref.siteHandle !== 0) {
    const s = sh.bb.units.get(ref.siteHandle);
    if (s !== undefined) return s;
  }
  const bpRec = sh.static.bps.list[ref.bp]!;
  return sh.structureAt(ref.x, ref.z, (r) => r.bp === ref.bp || (r.blueprint.upgradeFrom >= 0 && chainContains(sh, r.bp, bpRec.index)));
}

function chainContains(sh: BuildShared, bp: number, base: number): boolean {
  let b = sh.static.bps.list[bp];
  while (b !== undefined && b.upgradeFrom >= 0) {
    if (b.upgradeFrom === base) return true;
    b = sh.static.bps.list[b.upgradeFrom];
  }
  return false;
}

/**
 * Evaluates a build order of `builder`. Updates `ref.siteHandle`/`ref.confirmed` in place (pure
 * bookkeeping of the order itself). `window` = confirmTicks(...). The structure index of `sh`
 * must be current.
 */
export function buildStatus(sh: BuildShared, builder: OwnRecord | undefined, ref: BuildOrderRef, tick: number, window: number): BuildStatus {
  const site = siteOf(sh, ref);
  if (site !== null) {
    ref.siteHandle = site.handle;
    ref.confirmed = true;
    if (site.complete) return 'done';
    if (builder !== undefined && isWorkingOn(builder, site)) return 'running';
    return 'stalled';
  }
  // Not started and the place is now known to be taken by an enemy structure (sighted after the
  // decision; ai.md §5.3 R-08 / AI-PERC-02): re-plan in this think instead of walking into the
  // rejection at the site.
  if (knownEnemyOverlap(sh, ref)) return 'lost';
  if (builder !== undefined && isBuildingAt(builder, ref.bp, ref.x, ref.z)) {
    ref.confirmed = true;
    return 'running';
  }
  if (tick <= ref.issuedTick + window) return 'pending';
  return 'lost';
}

/** The footprint of the order overlaps a known (visible or ghost) enemy structure. */
export function knownEnemyOverlap(sh: BuildShared, ref: BuildOrderRef): boolean {
  const list = sh.bb.enemy.structures;
  if (list.length === 0) return false;
  const bp = sh.static.bps.list[ref.bp]!;
  for (const e of list) {
    if (e.bp < 0) continue;
    const eb = sh.static.bps.list[e.bp]!;
    const ox = (bp.footprint[0] + eb.footprint[0]) / 2;
    const oz = (bp.footprint[1] + eb.footprint[1]) / 2;
    if (Math.abs(e.x - ref.x) < ox - 1e-6 && Math.abs(e.z - ref.z) < oz - 1e-6) return true;
  }
  return false;
}

/** True if the unit is idle as far as orders go (no order, empty queue). */
export function isIdle(b: OwnRecord): boolean {
  return b.order === OrderKind.Idle && b.queueLength === 0;
}

/** True if a factory/site/upgrade target has work (construction, production, upgrade). */
export function isWorking(t: OwnRecord): boolean {
  return !t.complete || t.upgradingTo >= 0 || t.factoryBp >= 0;
}
