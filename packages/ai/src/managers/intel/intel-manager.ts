/**
 * IntelManager (ai.md §5.6, 1 Hz on odd k; Easy every think): threat grid and scout routes.
 *
 * Grid pass (op budget ai.md §2.3; cursor continuation when the budget ends, grid ≤ 2 s old):
 *   1. structures — event-like: known enemy structures (visible or ghost) that are new enter the
 *      structure layers once; structures that left the enemy memory (seen destroyed, ghost cleared)
 *      are removed. 1 op per known structure entry + 1 op per written cell.
 *   2. enemies — every reactable known mobile enemy writes its threat into the live layers of all
 *      cells up to range + 8 WU (full inside the range, half in the rim), blips write the median
 *      threat of the highest seen tech into the 5 × 5 cells around them. Handle order; 1 op per
 *      unit + 1 op per written cell.
 *   3. own sight — every own unit with vision marks the cells within its vision radius as seen
 *      (lastSeen, clears memory where no live threat is). 1 op per unit + 1 op per cell.
 *   4. publish — the new live layers become visible; on the first publish the grid replaces the
 *      blackboard's default `LocalThreatEstimate` (bb.threat).
 * Every chunk is one `ctx.step`: its writes are collected first and only applied in the commit
 * closure (abort ⇒ nothing applied, the cursor stays).
 *
 * Easy (`profile.threatVisibleOnly`): no memory, no blips, no ghosts — visible structures enter the
 * live layers like mobile units.
 *
 * Scouting: land scouts (role `scout`) belong to the IntelManager (`reservations.claimUnit(h,
 * 'intel')`). The first route goes straight to the enemy start, then over the enemy expansion spots
 * with the oldest lastSeen (4, nearest-neighbour order) and back over the contested zone; a new
 * route every 180 s or when the scout has been idle ≥ 2 s. Telemetry `scoutSeenEnemyBase` at the
 * first own sight of the enemy start cell.
 */
import type { ManagerContext, ManagerInitContext } from '../../brain.ts';
import { Prio } from '../../commands/emitter.ts';
import { compareNumbers, distSq } from '../../det.ts';
import { blipThreat, enemyAcuFactor } from '../../threat.ts';
import type { Manager } from '../../brain.ts';
import type { Vec2 } from '../../types.ts';
import {
  BLIP_SMEAR_CELLS,
  GRID_RIM_WU,
  LAYER_AIR,
  LAYER_ANTIAIR,
  LAYER_SURFACE,
  ThreatGrid,
  type GridLayer,
} from './threat-grid.ts';
import { UC, unitClassesFor, type UnitClasses } from './unit-classes.ts';

/** New scout route every 180 s (ai.md §5.6). */
export const SCOUT_ROUTE_TICKS = 1800;
/** A scout idle for this long gets a new route. */
export const SCOUT_IDLE_TICKS = 20;
/** Expansion spots per scout route. */
export const SCOUT_ROUTE_SPOTS = 4;
/** Enemy expansion spots exclude the enemy base ring (d ≤ 40 WU from the enemy start). */
export const SCOUT_BASE_EXCLUDE_WU = 40;

type Phase = 'struct' | 'enemies' | 'own';

interface StructEntry {
  readonly bp: number;
  readonly cells: Int32Array;
  readonly w: Float64Array;
  readonly surface: number;
  readonly antiAir: number;
  readonly valueCell: number;
  readonly value: number;
}

interface ScoutState {
  routeTick: number;
  route: Vec2[];
}

/** Collected writes of one chunk (applied in the commit). */
class WriteBuffer {
  cells = new Int32Array(1024);
  layers = new Uint8Array(1024);
  values = new Float64Array(1024);
  n = 0;

  reset(): void {
    this.n = 0;
  }

  push(cell: number, layer: GridLayer, value: number): void {
    if (this.n === this.cells.length) {
      const grow = this.cells.length * 2;
      const c = new Int32Array(grow);
      c.set(this.cells);
      const l = new Uint8Array(grow);
      l.set(this.layers);
      const v = new Float64Array(grow);
      v.set(this.values);
      this.cells = c;
      this.layers = l;
      this.values = v;
    }
    this.cells[this.n] = cell;
    this.layers[this.n] = layer;
    this.values[this.n] = value;
    this.n++;
  }
}

export interface IntelOptions {
  /** Disable scouting (tests of the grid alone). */
  readonly scouting?: boolean;
}

export class IntelManager implements Manager {
  readonly name = 'intel' as const;
  readonly budgetKey = 'intel' as const;
  readonly grid: ThreatGrid;
  private readonly classes: UnitClasses;
  private readonly visibleOnly: boolean;
  private readonly scouting: boolean;
  private phase: Phase = 'struct';
  /** Handle of the last processed unit of the current phase (−1 = none). */
  private cursor = -1;
  private readonly structs = new Map<number, StructEntry>();
  private readonly scouts = new Map<number, ScoutState>();
  private baseSeenReported = false;
  /** Number of completed passes. */
  passes = 0;
  /** Ops of the last completed pass (sum over its chunks). */
  lastPassOps = 0;
  private passOps = 0;
  private readonly scratchCells = new Int32Array(4096);
  private readonly scratchW = new Float64Array(4096);
  private readonly buf = new WriteBuffer();

  constructor(init: ManagerInitContext, opts: IntelOptions = {}) {
    this.classes = unitClassesFor(init.roles);
    this.visibleOnly = init.profile.threatVisibleOnly;
    this.scouting = opts.scouting ?? true;
    const bb = init.bb;
    this.grid = new ThreatGrid(init.static.map.sizeWu, () => bb.tick, { useMemory: !this.visibleOnly });
  }

  think(ctx: ManagerContext): void {
    this.gridPass(ctx);
    if (this.scouting) this.scout(ctx);
  }

  // ---- grid pass --------------------------------------------------------------------------------

  private gridPass(ctx: ManagerContext): void {
    const g = this.grid;
    if (!g.isBuilding) {
      g.beginPass();
      this.phase = 'struct';
      this.cursor = -1;
      this.passOps = 0;
    }
    if (this.phase === 'struct') {
      if (!this.structPhase(ctx)) return;
    }
    if (this.phase === 'enemies') {
      if (!this.unitPhase(ctx, 'enemies')) return;
    }
    if (this.phase === 'own') {
      if (!this.unitPhase(ctx, 'own')) return;
    }
    // publish
    ctx.step(() => () => {
      g.publish(ctx.tick);
      this.passes++;
      this.lastPassOps = this.passOps;
      this.phase = 'struct';
      this.cursor = -1;
      if (ctx.bb.threat !== g) ctx.bb.threat = g;
      if (!this.baseSeenReported && g.lastSeenAt(ctx.analysis.enemyStart.x, ctx.analysis.enemyStart.z) >= 0) {
        this.baseSeenReported = true;
        ctx.bb.telemetry.push({ kind: 'scoutSeenEnemyBase', tick: ctx.tick });
      }
    });
  }

  /** Structure layer: removals then additions. Returns true when the phase completed. */
  private structPhase(ctx: ManagerContext): boolean {
    const bb = ctx.bb;
    const g = this.grid;
    if (this.visibleOnly) {
      this.phase = 'enemies';
      return true;
    }
    const known = bb.enemy.structures;
    const cost = this.structs.size + known.length;
    if (!ctx.budget.take(cost)) return false;
    this.passOps += cost;
    const removals: number[] = [];
    for (const [id, e] of this.structs) {
      const c = bb.enemy.contacts.get(id);
      if (c === undefined || c.bp !== e.bp) removals.push(id);
    }
    const additions: { id: number; entry: StructEntry }[] = [];
    let cells = 0;
    for (const c of known) {
      if (c.bp < 0) continue;
      const cur = this.structs.get(c.id);
      if (cur !== undefined && cur.bp === c.bp && !removals.includes(c.id)) continue;
      const b = this.classes.bp(c.bp);
      const n = g.discCells(c.x, c.z, b.rangeMax, b.rangeMax > 0 ? GRID_RIM_WU : 0, this.scratchCells, this.scratchW);
      const entry: StructEntry = {
        bp: c.bp,
        cells: this.scratchCells.slice(0, n),
        w: this.scratchW.slice(0, n),
        surface: b.threatSurface,
        antiAir: b.threatAir,
        valueCell: g.cellOf(c.x, c.z),
        value: Math.max(0, this.classes.value[c.bp]!),
      };
      additions.push({ id: c.id, entry });
      cells += n;
    }
    for (const id of removals) cells += this.structs.get(id)!.cells.length;
    if (!ctx.budget.take(cells)) return false;
    this.passOps += cells;
    return ctx.step(() => () => {
      for (const id of removals) {
        const e = this.structs.get(id)!;
        this.applyStruct(e, -1);
        this.structs.delete(id);
      }
      for (const a of additions) {
        this.applyStruct(a.entry, 1);
        this.structs.set(a.id, a.entry);
      }
      this.phase = 'enemies';
      this.cursor = -1;
    });
  }

  private applyStruct(e: StructEntry, sign: 1 | -1): void {
    const g = this.grid;
    for (let i = 0; i < e.cells.length; i++) {
      const w = e.w[i]!;
      g.addStructure(e.cells[i]!, e.surface * w, e.antiAir * w, sign);
    }
    if (e.value > 0) g.addStructureValue(e.valueCell, e.value, sign);
  }

  /** Enemy entry or own sight, continued by handle cursor. True when the phase completed. */
  private unitPhase(ctx: ManagerContext, phase: 'enemies' | 'own'): boolean {
    const bb = ctx.bb;
    const g = this.grid;
    const tick = ctx.tick;
    const items: { id: number; x: number; z: number; bp: number; hp: number; blip: boolean }[] = [];
    if (phase === 'enemies') {
      for (const c of bb.enemy.current) {
        if (c.id <= this.cursor) continue;
        if (c.bp < 0) {
          if (this.visibleOnly) continue;
          items.push({ id: c.id, x: c.x, z: c.z, bp: -1, hp: 1, blip: true });
          continue;
        }
        const isStruct = this.classes.has(c.bp, UC.structure);
        if (this.visibleOnly) {
          if (c.kind !== 'visible') continue;
        } else if (isStruct) continue;
        items.push({ id: c.id, x: c.x, z: c.z, bp: c.bp, hp: c.kind === 'visible' ? c.hpFrac : 1, blip: false });
      }
    } else {
      for (const u of bb.units.all) {
        if (u.handle <= this.cursor || u.blueprint.vision <= 0) continue;
        items.push({ id: u.handle, x: u.x, z: u.z, bp: u.bp, hp: 1, blip: false });
      }
    }
    items.sort((a, b) => compareNumbers(a.id, b.id));
    const buf = this.buf;
    buf.reset();
    let last = this.cursor;
    let complete = true;
    const blipValue = blipThreat(bb.blipTable, bb.enemy.highestTechSeen);
    const acu = enemyAcuFactor(bb.enemy.estoreSeen, tick);
    for (const it of items) {
      let n: number;
      if (phase === 'own') {
        const b = this.classes.bp(it.bp);
        n = g.discCells(it.x, it.z, b.vision, 0, this.scratchCells, this.scratchW);
        if (!ctx.budget.take(1 + n)) {
          complete = false;
          break;
        }
        for (let i = 0; i < n; i++) buf.push(this.scratchCells[i]!, 0, 0);
      } else if (it.blip) {
        n = g.squareCells(it.x, it.z, BLIP_SMEAR_CELLS, this.scratchCells);
        if (!ctx.budget.take(1 + n)) {
          complete = false;
          break;
        }
        for (let i = 0; i < n; i++) buf.push(this.scratchCells[i]!, LAYER_SURFACE, blipValue);
      } else {
        const b = this.classes.bp(it.bp);
        n = g.discCells(it.x, it.z, b.rangeMax, GRID_RIM_WU, this.scratchCells, this.scratchW);
        if (!ctx.budget.take(1 + n)) {
          complete = false;
          break;
        }
        let surf = b.threatSurface * it.hp;
        if (this.classes.has(it.bp, UC.commander)) surf *= acu;
        const air = this.classes.has(it.bp, UC.air) ? Math.max(b.threatSurface, b.threatAir) * it.hp : 0;
        const aa = b.threatAir * it.hp;
        for (let i = 0; i < n; i++) {
          const c = this.scratchCells[i]!;
          const w = this.scratchW[i]!;
          if (surf > 0) buf.push(c, LAYER_SURFACE, surf * w);
          if (air > 0) buf.push(c, LAYER_AIR, air * w);
          if (aa > 0) buf.push(c, LAYER_ANTIAIR, aa * w);
        }
      }
      this.passOps += 1 + n;
      last = it.id;
    }
    const writes = buf.n;
    const cells = buf.cells;
    const layers = buf.layers;
    const values = buf.values;
    const ok = ctx.step(() => () => {
      if (phase === 'own') for (let i = 0; i < writes; i++) g.markSeen(cells[i]!, tick);
      else for (let i = 0; i < writes; i++) g.addLive(cells[i]!, layers[i] as GridLayer, values[i]!, tick);
      if (complete) {
        this.phase = phase === 'enemies' ? 'own' : 'struct';
        this.cursor = -1;
      } else this.cursor = last;
    });
    return ok && complete;
  }

  // ---- scouting ---------------------------------------------------------------------------------

  private scout(ctx: ManagerContext): void {
    const bb = ctx.bb;
    const tick = ctx.tick;
    const res = bb.reservations;
    for (const h of [...this.scouts.keys()]) if (bb.units.get(h) === undefined) this.scouts.delete(h);
    const scouts = bb.units.army.filter((u) => {
      if (!this.classes.has(u.bp, UC.scout) || this.classes.has(u.bp, UC.air)) return false;
      const owner = res.unitOwner(u.handle);
      return owner === undefined || owner === 'intel';
    });
    scouts.sort((a, b) => a.handle - b.handle);
    for (const u of scouts) {
      const st = this.scouts.get(u.handle);
      const idle = u.idleSinceTick >= 0 && tick - u.idleSinceTick >= SCOUT_IDLE_TICKS;
      const due = st === undefined || tick - st.routeTick >= SCOUT_ROUTE_TICKS || idle;
      if (!due) {
        res.claimUnit(u.handle, 'intel');
        continue;
      }
      const spots = ctx.analysis.spots;
      if (!ctx.budget.take(spots.length + 1)) return;
      const route = this.route(ctx, u.x, u.z);
      ctx.step(() => {
        const em = ctx.emitter;
        em.group(() => {
          route.forEach((p, i) => em.move([u.handle], p.x, p.z, Prio.P1, { queue: i > 0, source: 'intel' }));
        });
        return () => {
          res.claimUnit(u.handle, 'intel');
          this.scouts.set(u.handle, { routeTick: tick, route });
        };
      });
    }
  }

  /** Scout route (ai.md §5.6): enemy start (until seen), oldest enemy expansions, contested zone. */
  route(ctx: ManagerContext, fromX: number, fromZ: number): Vec2[] {
    const a = ctx.analysis;
    const g = this.grid;
    const out: Vec2[] = [];
    const es = a.enemyStart;
    if (g.lastSeenAt(es.x, es.z) < 0) out.push({ x: es.x, z: es.z });
    const ex2 = SCOUT_BASE_EXCLUDE_WU * SCOUT_BASE_EXCLUDE_WU;
    const cand = a.spots.filter((s) => s.zone === 'enemy' && s.kind === 'mass' && distSq(s.x, s.z, es.x, es.z) > ex2);
    cand.sort((p, q) => {
      const c = compareNumbers(g.lastSeenAt(p.x, p.z), g.lastSeenAt(q.x, q.z));
      return c !== 0 ? c : p.index - q.index;
    });
    const pick = cand.slice(0, SCOUT_ROUTE_SPOTS);
    let px = out.length > 0 ? out[out.length - 1]!.x : fromX;
    let pz = out.length > 0 ? out[out.length - 1]!.z : fromZ;
    while (pick.length > 0) {
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < pick.length; i++) {
        const d = distSq(px, pz, pick[i]!.x, pick[i]!.z);
        if (d < bestD || (d === bestD && pick[i]!.index < pick[best]!.index)) {
          best = i;
          bestD = d;
        }
      }
      const s = pick.splice(best, 1)[0]!;
      out.push({ x: s.x, z: s.z });
      px = s.x;
      pz = s.z;
    }
    const contested = a.spots.filter((s) => s.zone === 'contested');
    if (contested.length > 0) {
      contested.sort((p, q) => {
        const c = compareNumbers(g.lastSeenAt(p.x, p.z), g.lastSeenAt(q.x, q.z));
        return c !== 0 ? c : p.index - q.index;
      });
      out.push({ x: contested[0]!.x, z: contested[0]!.z });
    } else if (a.chokepoint !== null) out.push({ x: a.chokepoint.x, z: a.chokepoint.z });
    else out.push({ x: (a.ownStart.x + es.x) / 2, z: (a.ownStart.z + es.z) / 2 });
    return out;
  }

  /** Current scout routes (diagnostics/tests). */
  scoutRoute(handle: number): readonly Vec2[] | undefined {
    return this.scouts.get(handle)?.route;
  }
}
