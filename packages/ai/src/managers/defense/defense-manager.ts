/**
 * DefenseManager, minimal A8 (ai.md §5.7 MS9; 1 Hz on odd k, Easy every think).
 *
 * - Cluster: ≥ 2 own complete mass extractors linked within 30 WU (single linkage).
 * - Attacked: an `ownDamaged` event (read as delayed stimulus, own cursor) of a structure within
 *   30 WU of a cluster mex, caused by an enemy GROUND unit. Mere presence never counts (R-06,
 *   AI-DEF-03). An attacker the AI cannot see (attackerBp −1) counts as ground attacker: before MS12
 *   there is no enemy air, and a structure without vision (Zapfstelle: vision 0) never sees its
 *   raider (documented).
 * - Reaction: exactly one point defense of tech 1 (role `pd`, Riegel I) at the cluster centroid,
 *   moved 6 WU towards the threat, as task prio 95 (TaskPrio.defense) with key `defense:<cluster>`.
 *   At most one per cluster: no task while an own point defense (built or site) or a live `pd` task
 *   with a fixed site stands within 30 WU of the centroid.
 * - Not before 3:00 unless in defence mode (`bb.opening.defenseMode`); defence spending ≤ 15 % of the
 *   mass spending of the last 3 min (except defence mode; the check uses the spending before the new
 *   order, so the first point defense is always allowed); never in contested/enemy territory without
 *   an own platoon with R ≥ 1 within 60 WU.
 * - Spending: the manager samples the own mass consumption (massDemand × massRatio) every run and
 *   books the cost of every ordered defense into `bb.defense.spend`.
 * The full A8 (AA, shields, artillery, raid thresholds) is MS11 — outside this track.
 */
import type { OwnRecord } from '../../blackboard.ts';
import type { Manager, ManagerContext, ManagerInitContext } from '../../brain.ts';
import { distSq } from '../../det.ts';
import { TaskPrio } from '../../taskboard.ts';
import type { Vec2 } from '../../types.ts';
import { UC, unitClassesFor, type UnitClasses } from '../intel/unit-classes.ts';

export const CLUSTER_LINK_WU = 30;
export const CLUSTER_MIN_MEX = 2;
export const DEFENSE_OFFSET_WU = 6;
export const DEFENSE_MIN_TICK = 1800;
export const DEFENSE_SPEND_WINDOW_TICKS = 1800;
export const DEFENSE_SPEND_MAX_FRAC = 0.15;
export const PLATOON_COVER_WU = 60;
/** A spot belongs to a mex within this distance (cluster key). */
export const SPOT_MATCH_WU = 3;

export interface MexCluster {
  readonly key: string;
  readonly mex: readonly OwnRecord[];
  readonly x: number;
  readonly z: number;
}

interface Trigger {
  readonly x: number;
  readonly z: number;
  readonly attacker: number;
  readonly tick: number;
}

export class DefenseManager implements Manager {
  readonly name = 'defense' as const;
  readonly budgetKey = 'defense' as const;
  private readonly classes: UnitClasses;
  private stimCursor = -1;
  private readonly samples: { tick: number; mass: number }[] = [];
  private lastSampleTick = -1;
  /** Last known positions of own structures (damage events of destroyed structures). */
  private readonly structPos = new Map<number, Vec2>();
  /** Tasks created (diagnostics/tests). */
  readonly created: { tick: number; key: string; taskId: number; x: number; z: number }[] = [];

  constructor(init: ManagerInitContext) {
    this.classes = unitClassesFor(init.roles);
  }

  think(ctx: ManagerContext): void {
    const bb = ctx.bb;
    const tick = ctx.tick;
    const structs = bb.units.structures;
    if (!ctx.budget.take(1 + structs.length)) return;
    // 1. spending sample and structure positions
    const eco = ctx.view.eco();
    const dt = this.lastSampleTick < 0 ? 0 : (tick - this.lastSampleTick) / 10;
    const spent = eco.massDemand * eco.massRatio * dt;
    const ok = ctx.step(() => () => {
      this.lastSampleTick = tick;
      if (spent > 0) this.samples.push({ tick, mass: spent });
      while (this.samples.length > 0 && this.samples[0]!.tick <= tick - DEFENSE_SPEND_WINDOW_TICKS) this.samples.shift();
      const d = bb.defense;
      d.spend = d.spend.filter((s) => s.tick > tick - DEFENSE_SPEND_WINDOW_TICKS);
      for (const s of structs) this.structPos.set(s.handle, { x: s.x, z: s.z });
      for (const [key, id] of [...d.clusterDefense]) {
        const t = bb.taskBoard.get(id);
        if (t === undefined || (t.state !== 'open' && t.state !== 'assigned')) d.clusterDefense.delete(key);
      }
    });
    if (!ok) return;

    // 2. new damage stimuli → triggers
    const triggers: Trigger[] = [];
    let visited = 0;
    bb.stimuli.forEachVisible(this.stimCursor, tick, (s) => {
      visited++;
      if (s.kind !== 'event' || s.event.kind !== 'ownDamaged') return;
      const e = s.event;
      const pos = bb.units.get(e.unit) ?? this.structPos.get(e.unit);
      if (pos === undefined) return;
      const rec = bb.units.get(e.unit);
      if (rec !== undefined && !this.classes.has(rec.bp, UC.structure)) return;
      if (rec === undefined && !this.structPos.has(e.unit)) return;
      if (e.attackerBp >= 0) {
        if (this.classes.has(e.attackerBp, UC.air) || this.classes.has(e.attackerBp, UC.structure)) return;
        if (!this.classes.has(e.attackerBp, UC.mobile)) return;
      }
      triggers.push({ x: pos.x, z: pos.z, attacker: e.attacker, tick: e.tick });
    });
    if (!ctx.budget.take(visited)) return;
    if (triggers.length === 0) {
      ctx.step(() => () => {
        this.stimCursor = tick;
      });
      return;
    }
    // 3. clusters (lazy: only with a trigger)
    const clusters = this.clusters(ctx);
    if (clusters === null) return;
    const planned: { key: string; x: number; z: number }[] = [];
    const pd = ctx.roles.tryResolve('pd', 1);
    const defenseMode = bb.opening.defenseMode;
    if (pd !== null && (tick >= DEFENSE_MIN_TICK || defenseMode)) {
      if (!ctx.budget.take(triggers.length * (clusters.length + 4) + bb.taskBoard.size)) return;
      for (const tr of triggers) {
        const c = this.clusterOf(clusters, tr.x, tr.z);
        if (c === null || planned.some((p) => p.key === c.key)) continue;
        if (this.defended(ctx, c)) continue;
        if (!defenseMode && !this.spendAllowed(ctx)) continue;
        const site = this.siteFor(ctx, c, tr);
        const zone = ctx.analysis.zoneAt(site.x, site.z);
        if ((zone === 'contested' || zone === 'enemy') && !this.covered(ctx, site)) continue;
        planned.push({ key: c.key, x: site.x, z: site.z });
      }
    }
    ctx.step(() => () => {
      this.stimCursor = tick;
      if (pd === null) return;
      for (const p of planned) {
        const t = bb.taskBoard.add(
          {
            kind: 'build',
            role: 'pd',
            tech: 1,
            bp: pd.index,
            site: { x: p.x, z: p.z },
            prio: TaskPrio.defense,
            wanted: 1,
            source: 'defense',
            key: `defense:${p.key}`,
          },
          tick,
        );
        bb.defense.clusterDefense.set(p.key, t.id);
        bb.defense.spend.push({ tick, mass: pd.mass });
        this.created.push({ tick, key: p.key, taskId: t.id, x: p.x, z: p.z });
      }
    });
  }

  /** Mex clusters (≥ 2 complete mex linked within 30 WU), in handle order. Null = budget exhausted. */
  clusters(ctx: ManagerContext): MexCluster[] | null {
    const mex = ctx.bb.units.structures.filter((s) => s.complete && this.classes.has(s.bp, UC.mex));
    mex.sort((a, b) => a.handle - b.handle);
    const n = mex.length;
    if (!ctx.budget.take(n + (n * (n - 1)) / 2)) return null;
    const parent = new Int32Array(n);
    for (let i = 0; i < n; i++) parent[i] = i;
    const find = (i: number): number => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]!]!;
        i = parent[i]!;
      }
      return i;
    };
    const l2 = CLUSTER_LINK_WU * CLUSTER_LINK_WU;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (distSq(mex[i]!.x, mex[i]!.z, mex[j]!.x, mex[j]!.z) > l2) continue;
        const a = find(i);
        const b = find(j);
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
      }
    }
    const groups = new Map<number, OwnRecord[]>();
    for (let i = 0; i < n; i++) {
      const r = find(i);
      let g = groups.get(r);
      if (g === undefined) {
        g = [];
        groups.set(r, g);
      }
      g.push(mex[i]!);
    }
    const out: MexCluster[] = [];
    const spots = ctx.static.spots;
    const m2 = SPOT_MATCH_WU * SPOT_MATCH_WU;
    for (const g of groups.values()) {
      if (g.length < CLUSTER_MIN_MEX) continue;
      let sx = 0;
      let sz = 0;
      let minSpot = -1;
      for (const u of g) {
        sx += u.x;
        sz += u.z;
        for (const s of spots) {
          if (s.kind === 'mass' && distSq(s.x, s.z, u.x, u.z) <= m2 && (minSpot < 0 || s.index < minSpot)) minSpot = s.index;
        }
      }
      const key = minSpot >= 0 ? `s${minSpot}` : `h${g[0]!.handle}`;
      out.push({ key, mex: g, x: sx / g.length, z: sz / g.length });
    }
    return out;
  }

  private clusterOf(clusters: readonly MexCluster[], x: number, z: number): MexCluster | null {
    const l2 = CLUSTER_LINK_WU * CLUSTER_LINK_WU;
    let best: MexCluster | null = null;
    let bd = Infinity;
    for (const c of clusters) {
      for (const m of c.mex) {
        const d = distSq(m.x, m.z, x, z);
        if (d <= l2 && d < bd) {
          bd = d;
          best = c;
        }
      }
    }
    return best;
  }

  /** Point defense (built, site or live fixed-site task) within 30 WU of the cluster centroid. */
  private defended(ctx: ManagerContext, c: MexCluster): boolean {
    const bb = ctx.bb;
    const r2 = CLUSTER_LINK_WU * CLUSTER_LINK_WU;
    if (bb.defense.clusterDefense.has(c.key)) return true;
    for (const s of bb.units.structures) {
      if (this.classes.has(s.bp, UC.pd) && distSq(s.x, s.z, c.x, c.z) <= r2) return true;
    }
    for (const t of bb.taskBoard.ordered()) {
      if (t.role !== 'pd' || t.site === null || typeof t.site === 'string') continue;
      if (distSq(t.site.x, t.site.z, c.x, c.z) <= r2) return true;
    }
    return false;
  }

  /** Defence spending of the last 3 min ≤ 15 % of the total mass spending (before the new order). */
  private spendAllowed(ctx: ManagerContext): boolean {
    let total = 0;
    for (const s of this.samples) total += s.mass;
    let def = 0;
    for (const s of ctx.bb.defense.spend) def += s.mass;
    return def <= DEFENSE_SPEND_MAX_FRAC * total;
  }

  /** Centroid moved 6 WU towards the threat (attacker, else the damaged structure, else the enemy start). */
  private siteFor(ctx: ManagerContext, c: MexCluster, tr: Trigger): Vec2 {
    const contact = tr.attacker !== 0 ? ctx.bb.enemy.contacts.get(tr.attacker) : undefined;
    let tx = contact !== undefined ? contact.x : tr.x;
    let tz = contact !== undefined ? contact.z : tr.z;
    let dx = tx - c.x;
    let dz = tz - c.z;
    let len = Math.sqrt(dx * dx + dz * dz);
    if (len < 1e-6) {
      tx = ctx.analysis.enemyStart.x;
      tz = ctx.analysis.enemyStart.z;
      dx = tx - c.x;
      dz = tz - c.z;
      len = Math.sqrt(dx * dx + dz * dz);
    }
    if (len < 1e-6) return { x: c.x, z: c.z };
    return { x: c.x + (dx / len) * DEFENSE_OFFSET_WU, z: c.z + (dz / len) * DEFENSE_OFFSET_WU };
  }

  /** An own platoon with R ≥ 1 within 60 WU. */
  private covered(ctx: ManagerContext, p: Vec2): boolean {
    const r2 = PLATOON_COVER_WU * PLATOON_COVER_WU;
    return ctx.bb.platoons.some((pl) => pl.units.length > 0 && pl.ratio >= 1 && distSq(pl.x, pl.z, p.x, p.z) <= r2);
  }
}
