/**
 * EngineerManager (ai.md §5.3, 2 Hz): assigns task-board tasks to free builders, places buildings,
 * keeps engineers safe, gives idle engineers work and publishes the engineer target.
 *
 * - Builders: complete engineers not claimed by another manager (the OpeningRunner claims its plan
 *   engineers until their list is empty) plus the commander once `reservations.acuOwner` is
 *   'engineer' (handover rule, blackboard.ts). The commander only takes base tasks within 60 WU,
 *   ring mex, and assist tasks marked `@acu`.
 * - Assignment in board order (prio ↓, age ↑, id ↑): base tasks only to builders within 80 WU of the
 *   start unless the task is ≥ 20 s old; cost = travel time + remaining time of the current build
 *   (busy builders with ≤ 10 s left get the task queued behind it); tech via `canBuild`; a builder
 *   that just completed an expansion first gets the next expansion near it.
 * - Placement: placement.ts (selector → canPlace → spiral → next template place); a rejected
 *   command (`commandRejected` stimulus) re-plans in the next think around the rejected footprint
 *   (AI-ENG-02); lost orders count as placement failures (3 ⇒ place locked 60 s).
 * - Safety: T_surface ≥ T_eng = 20 without own cover, or damage ⇒ abort, run to the nearest
 *   defended point, task back on the board, spot/site locked 30 s. Scouts near engineers only
 *   raise a hunt request (R-06, AI-ENG-04).
 * - Idle (R-G3): free builders go to build assist (prio 12: site ≥ 150 mass within 80 WU,
 *   S_M/C_M ≥ 0.3, ≤ 4 builders) or guard the nearest working factory (prio 10, re-evaluated every
 *   10 s). Repair tasks (prio 30) for own structures < 70 % HP without enemies within 30 WU.
 *   Reclaim (prio 20) needs wrecks in the perception — not available before MS11.
 * - Engineer target: min(cap(t) × engineerCapFactor, base + ⌈free spots / perFreeSpots⌉) + mass-sink
 *   bonus → `bb.engineerTarget`.
 *
 * Budget: every visited builder, task, structure and spot costs ops; an exhausted budget stores the
 * cursor (update pass: builder index, assignment: task index) and continues in the next think.
 * Every emitted order is a `ctx.step` whose commit adopts the state.
 */
import type { OwnRecord } from '../../blackboard.ts';
import type { Manager, ManagerContext, ManagerInitContext } from '../../brain.ts';
import { Prio } from '../../commands/emitter.ts';
import { TaskPrio, type Task, type TaskSite } from '../../taskboard.ts';
import { OrderKind, type AiBlueprint, type Vec2 } from '../../types.ts';
import { buildStatus, confirmTicks, isIdle, isWorking, type BuildOrderRef } from './jobs.ts';
import { commitPlacement, place, releasePlacement, type Placement, type PlaceContext } from './placement.ts';
import {
  BASE_RADIUS_WU,
  BOARD_ANY_AFTER_TICKS,
  BOARD_NEAR_WU,
  COVER_RADIUS_WU,
  ENEMY_CONTACT_LOCK_TICKS,
  T_ENG,
  buildShared,
  capAt,
  distToStart,
  travelWu,
  type BuildShared,
} from './shared.ts';
import { countFreeSpots, hasCover, ownCoverThreat, pickSpot } from './spots.ts';

export const ENGINEER_OWNER = 'engineer';
/** Idle jobs (not on the board). */
export const PRIO_BUILD_ASSIST = 12;
/** The commander preempts a job for its own (`@acu`) support task at least this much more important. */
export const ACU_PREEMPT_MARGIN = 20;
/**
 * A power task of the balance takes a builder off a lower assist job (tech upgrade, mex-upgrade
 * assist) once the storage runs empty within this many seconds or the task waited this long without
 * a builder (tai-p5 calibration).
 */
export const POWER_PREEMPT_EMPTY_S = 30;
export const POWER_PREEMPT_WAIT_TICKS = 300;
/** Rescue of a base task: all its builders farther than BOARD_NEAR_WU + this from the place. */
export const RESCUE_EXTRA_WU = 20;
export const PRIO_FACTORY_GUARD = 10;
/** Guard/assist targets are re-evaluated every 10 s (ai.md §5.3). */
export const IDLE_RECHECK_TICKS = 100;
/** Build assist: sites ≥ 150 mass, ≤ 4 builders, S_M / C_M ≥ 0.3 (ai.md §5.1 R-04). */
export const BUILD_ASSIST_MIN_MASS = 150;
export const BUILD_ASSIST_MAX_BUILDERS = 4;
export const BUILD_ASSIST_MASS_FRAC = 0.3;
/**
 * Build assist also needs energy headroom (tai-p5 calibration, "Energie zuerst" R-02 applied to R-04):
 * no energy stall and the storage lasts longer than this. Four engineers on a Landwerk draw 140 E/s;
 * assisting while the storage drains turned a mass sink into an energy stall (Setons 8–10 min).
 */
export const BUILD_ASSIST_MIN_EMPTY_S = 60;
/** Busy builders are candidates when their current build ends within 10 s. */
export const QUEUE_BEHIND_MAX_S = 10;
/** Repair structures below 70 % HP without enemies within 30 WU (ai.md §5.3). */
export const REPAIR_BELOW_HP = 0.7;
export const REPAIR_ENEMY_FREE_WU = 30;
/** A fleeing engineer is unavailable for at most 20 s. */
export const FLEE_TICKS = 200;
/** A task without any place is retried after 5 s. */
export const NO_PLACE_RETRY_TICKS = 50;
/**
 * An unstarted, unassigned build task that found no place this many times is failed (its source
 * re-plans it): e.g. a `spot:` hydro task whose spot another builder took meanwhile would otherwise
 * stay open forever and count as running power in the energy balance (tai-p5 calibration).
 */
export const TASK_NOPLACE_LIMIT = 4;
/** Rejected footprints stay excluded for 60 s. */
export const REJECT_MEMORY_TICKS = 600;
/** Damage within this many ticks counts as "nimmt Schaden". */
const DAMAGE_RECENT_TICKS = 20;

export type JobKind = 'build' | 'assist' | 'guard' | 'repair';

export interface Job extends BuildOrderRef {
  readonly kind: JobKind;
  readonly prio: number;
  readonly taskId: number;
  readonly bp: number;
  readonly x: number;
  readonly z: number;
  readonly key: string | null;
  readonly spot: number;
  readonly target: number;
  readonly issuedTick: number;
  readonly queued: boolean;
  readonly untilTick: number;
  readonly selector: TaskSite;
  rejected: boolean;
  /** The rejection was booked (failure count, rejected area, place released). */
  rejectNoted: boolean;
  reissuedTick: number;
}

interface Slot {
  cur: Job | null;
  next: Job | null;
}

interface PoolEntry {
  readonly rec: OwnRecord;
  readonly isAcu: boolean;
}

/** Base task: its place lies in the base (ai.md §5.3 "Aufgaben an der Basis"). */
export function isBaseSelector(sel: TaskSite): boolean {
  if (sel === null) return false;
  if (typeof sel !== 'string') return false;
  return sel.startsWith('slot:') || sel.startsWith('near:') || sel === 'kranz' || sel === 'ring';
}

export class EngineerManager implements Manager {
  readonly name = 'engineer' as const;
  readonly budgetKey = 'engineer' as const;
  private readonly sh: BuildShared;
  private readonly jobs = new Map<number, Slot>();
  private readonly fleeing = new Map<number, number>();
  private readonly damaged = new Map<number, number>();
  private readonly retryAt = new Map<number, number>();
  /** Original selector of a task whose site became a fixed position. */
  private readonly selectorOf = new Map<number, TaskSite>();
  private stimCursor = -1;
  private updateCursor = 0;
  private assignCursor = 0;
  private repairCursor = 0;

  constructor(init: ManagerInitContext) {
    this.sh = buildShared(init);
  }

  /** Current job of a builder (tests/diagnostics). */
  jobOf(handle: number): Job | null {
    return this.jobs.get(handle)?.cur ?? null;
  }

  /**
   * Budget cursors of the passes (tests/diagnostics, AI-DET-02): the builder index of the update
   * pass, the task index of the assignment pass and the structure index of the repair scan where an
   * exhausted think stopped; 0 = the pass completed.
   */
  get cursors(): { readonly update: number; readonly assign: number; readonly repair: number } {
    return { update: this.updateCursor, assign: this.assignCursor, repair: this.repairCursor };
  }

  /** Queued job of a builder (tests/diagnostics). */
  nextJobOf(handle: number): Job | null {
    return this.jobs.get(handle)?.next ?? null;
  }

  think(ctx: ManagerContext): void {
    const sh = this.sh;
    const take = (n: number): boolean => ctx.budget.take(n);
    sh.pruneRejected(ctx.tick);
    this.updateTarget(ctx);
    if (!sh.ensureIndex(take)) return;
    this.readStimuli(ctx);
    const pool = this.pool(ctx);
    this.dropStale(ctx, pool);
    if (!this.updatePass(ctx, pool)) return;
    if (!this.huntScouts(ctx, pool)) return;
    if (!this.postRepairs(ctx)) return;
    if (!this.frontPass(ctx, pool)) return;
    if (!this.followUpPass(ctx, pool)) return;
    if (!this.assignPass(ctx, pool)) return;
    this.idlePass(ctx, pool);
    ctx.bb.taskBoard.prune();
  }

  // ---- engineer target ---------------------------------------------------------------------------

  private updateTarget(ctx: ManagerContext): void {
    const sh = this.sh;
    const fu = sh.opening.followUp.engineers;
    const free = countFreeSpots(sh, ctx.view.freeMassSpots(), ctx.tick, true, (n) => ctx.budget.take(n));
    if (free === null) return;
    const cap = Math.max(1, Math.floor(capAt(fu.cap, ctx.tick / 10) * ctx.profile.timing.engineerCapFactor));
    ctx.bb.engineerTarget = Math.min(cap, fu.base + Math.ceil(free / fu.perFreeSpots)) + sh.engineerBonus;
  }

  // ---- stimuli ---------------------------------------------------------------------------------

  private readStimuli(ctx: ManagerContext): void {
    const bb = ctx.bb;
    bb.stimuli.forEachVisible(this.stimCursor, ctx.tick, (s) => {
      if (s.kind !== 'event') return;
      const e = s.event;
      if (e.kind === 'ownDamaged') {
        if (this.sh.flags.engineer[bb.units.get(e.unit)?.bp ?? 0] === 1) this.damaged.set(e.unit, e.tick);
      } else if (e.kind === 'commandRejected') {
        const slot = this.jobs.get(e.unit);
        if (slot === undefined) return;
        const j = slot.cur !== null && !slot.cur.confirmed ? slot.cur : slot.next !== null && !slot.next.confirmed ? slot.next : null;
        if (j !== null) j.rejected = true;
      }
    });
    this.stimCursor = ctx.tick;
    for (const [h, t] of this.damaged) if (t < ctx.tick - DAMAGE_RECENT_TICKS) this.damaged.delete(h);
  }

  // ---- pool ------------------------------------------------------------------------------------

  private pool(ctx: ManagerContext): PoolEntry[] {
    const bb = ctx.bb;
    const out: PoolEntry[] = [];
    for (const e of bb.units.engineers) {
      const owner = bb.reservations.unitOwner(e.handle);
      if (owner === undefined || owner === ENGINEER_OWNER) out.push({ rec: e, isAcu: false });
    }
    const acu = bb.units.commander;
    if (acu !== null && bb.reservations.acuOwner === ENGINEER_OWNER) out.push({ rec: acu, isAcu: true });
    return out;
  }

  /** Jobs of builders that died or left the pool: tasks back on the board, places released. */
  private dropStale(ctx: ManagerContext, pool: readonly PoolEntry[]): void {
    const inPool = new Set<number>();
    for (const p of pool) inPool.add(p.rec.handle);
    for (const [h, slot] of [...this.jobs]) {
      if (inPool.has(h)) continue;
      const dead = ctx.bb.units.get(h) === undefined;
      for (const j of [slot.cur, slot.next]) {
        if (j === null) continue;
        this.unassign(ctx, j, h);
        const contact = dead && j.kind === 'build' && ctx.budget.take(1) && ctx.bb.threat.threatAt('surface', j.x, j.z) > 0;
        this.releaseJob(j, h, contact ? ctx.tick + ENEMY_CONTACT_LOCK_TICKS : -1);
      }
      this.jobs.delete(h);
    }
    for (const h of [...this.fleeing.keys()]) if (!inPool.has(h)) this.fleeing.delete(h);
  }

  // ---- update pass -----------------------------------------------------------------------------

  private updatePass(ctx: ManagerContext, pool: readonly PoolEntry[]): boolean {
    if (this.updateCursor >= pool.length) this.updateCursor = 0;
    for (let i = this.updateCursor; i < pool.length; i++) {
      if (!ctx.budget.take(1)) {
        this.updateCursor = i;
        return false;
      }
      const ok = this.updateBuilder(ctx, pool[i]!);
      if (ok === 'budget') {
        this.updateCursor = i;
        return false;
      }
      if (ok === 'abort') return false;
    }
    this.updateCursor = 0;
    return true;
  }

  private updateBuilder(ctx: ManagerContext, p: PoolEntry): 'ok' | 'budget' | 'abort' {
    const h = p.rec.handle;
    const until = this.fleeing.get(h);
    if (until !== undefined) {
      if (ctx.tick < until && distToNearestDefended(this.sh, p.rec) > 10) return 'ok';
      this.fleeing.delete(h);
    }
    if (!p.isAcu) {
      const s = this.safety(ctx, p);
      if (s !== 'ok') return s;
    }
    const slot = this.jobs.get(h);
    if (slot === undefined) return 'ok';
    if (slot.cur === null && slot.next !== null) {
      slot.cur = slot.next;
      slot.next = null;
    }
    const j = slot.cur;
    if (j === null) return 'ok';
    return j.kind === 'build' ? this.updateBuild(ctx, p, slot, j) : this.updateSupport(ctx, p, slot, j);
  }

  private safety(ctx: ManagerContext, p: PoolEntry): 'ok' | 'budget' | 'abort' {
    const sh = this.sh;
    const r = p.rec;
    if (!ctx.budget.take(1)) return 'budget';
    const t = ctx.bb.threat.threatAt('surface', r.x, r.z);
    const damaged = this.damaged.has(r.handle);
    let danger = damaged;
    if (!danger && t >= T_ENG) {
      const own = ownCoverThreat(sh, r.x, r.z, (n) => ctx.budget.take(n));
      if (own === null) return 'budget';
      danger = !hasCover(own, t);
    }
    if (!danger) return 'ok';
    const dest = nearestDefended(sh, r);
    // Already at (or walking to) the defended point: no new record (tai-p5 APM calibration — an
    // engineer standing at an overrun factory re-fled every think).
    const walking = r.order === OrderKind.Move && Math.abs(r.orderX - dest.x) <= 4 && Math.abs(r.orderZ - dest.z) <= 4;
    const there = r.order === OrderKind.Idle && Math.abs(r.x - dest.x) <= 10 && Math.abs(r.z - dest.z) <= 10;
    const ok = ctx.step(() => {
      if (!walking && !there) ctx.emitter.move([r.handle], dest.x, dest.z, Prio.P1, { source: 'engineer' });
      return () => {
        const slot = this.jobs.get(r.handle);
        if (slot !== undefined) {
          for (const j of [slot.cur, slot.next]) {
            if (j === null) continue;
            this.unassign(ctx, j, r.handle);
            this.releaseJob(j, r.handle, ctx.tick + ENEMY_CONTACT_LOCK_TICKS);
          }
          this.jobs.delete(r.handle);
        }
        this.damaged.delete(r.handle);
        this.fleeing.set(r.handle, ctx.tick + FLEE_TICKS);
      };
    });
    return ok ? 'ok' : 'abort';
  }

  private updateBuild(ctx: ManagerContext, p: PoolEntry, slot: Slot, j: Job): 'ok' | 'budget' | 'abort' {
    const sh = this.sh;
    const h = p.rec.handle;
    if (j.rejected) return this.replanRejected(ctx, p, slot, j);
    if (j.queued && slot.cur === j && !j.confirmed && !isIdle(p.rec) && ctx.tick <= j.issuedTick + 600) {
      // Queued behind a job that ended: wait until the builder reaches it (or goes idle).
      const st0 = buildStatus(sh, p.rec, j, ctx.tick, Number.MAX_SAFE_INTEGER);
      if (st0 !== 'done' && st0 !== 'running') return 'ok';
    }
    const st = buildStatus(sh, p.rec, j, ctx.tick, confirmTicks(ctx.profile.lead, ctx.profile.thinkEvery));
    const task = j.taskId !== 0 ? ctx.bb.taskBoard.get(j.taskId) : undefined;
    if (st === 'done') {
      const expansion = j.spot >= 0 && distToStart(sh, j.x, j.z) > BOARD_NEAR_WU;
      return ctx.step(() => () => {
        if (task !== undefined) ctx.bb.taskBoard.complete(task.id);
        this.selectorOf.delete(j.taskId);
        this.releaseJob(j, h, -1);
        if (expansion) sh.expansionDone.set(h, ctx.tick);
        slot.cur = slot.next;
        slot.next = null;
        if (slot.cur === null) this.jobs.delete(h);
      })
        ? 'ok'
        : 'abort';
    }
    if (st === 'running') {
      if (task !== undefined && j.siteHandle !== 0 && task.siteHandle === 0) {
        task.siteHandle = j.siteHandle;
        if (!this.selectorOf.has(task.id)) this.selectorOf.set(task.id, task.site);
        task.site = { x: j.x, z: j.z };
      }
      return 'ok';
    }
    if (st === 'pending') return 'ok';
    if (st === 'stalled') {
      if (!isIdle(p.rec) || ctx.tick <= j.reissuedTick + confirmTicks(ctx.profile.lead, ctx.profile.thinkEvery)) return 'ok';
      return ctx.step(() => {
        ctx.emitter.build(h, j.bp, j.x, j.z, 0, Prio.P2, { source: 'engineer' });
        return () => {
          j.reissuedTick = ctx.tick;
        };
      })
        ? 'ok'
        : 'abort';
    }
    // lost: the order never showed up (APM drop, silent rejection) or the site vanished.
    return ctx.step(() => () => {
      if (j.key !== null) sh.noteFailure(j.key, j.spot, ctx.tick);
      this.unassign(ctx, j, h);
      this.releaseJob(j, h, -1);
      if (task !== undefined) {
        task.failures++;
        const orig = this.selectorOf.get(task.id);
        if (orig !== undefined) {
          task.site = orig;
          task.siteHandle = 0;
          this.selectorOf.delete(task.id);
        }
      }
      slot.cur = slot.next;
      slot.next = null;
      if (slot.cur === null) this.jobs.delete(h);
    })
      ? 'ok'
      : 'abort';
  }

  /** AI-ENG-02: the sim rejected the placement ⇒ re-plan around the rejected footprint now. */
  private replanRejected(ctx: ManagerContext, p: PoolEntry, slot: Slot, j: Job): 'ok' | 'budget' | 'abort' {
    const sh = this.sh;
    const h = p.rec.handle;
    const bp = sh.static.bps.list[j.bp]!;
    const task = j.taskId !== 0 ? ctx.bb.taskBoard.get(j.taskId) : undefined;
    if (!j.rejectNoted) {
      j.rejectNoted = true;
      sh.rejected.push({ x: j.x, z: j.z, w: bp.footprint[0], d: bp.footprint[1], untilTick: ctx.tick + REJECT_MEMORY_TICKS });
      if (j.key !== null) sh.noteFailure(j.key, j.spot, ctx.tick);
      this.releaseJob(j, h, -1);
    }
    if (task === undefined || task.state === 'done' || task.state === 'cancelled' || task.state === 'failed') {
      slot.cur = slot.next === j ? null : slot.cur === j ? slot.next : slot.cur;
      if (slot.next === j) slot.next = null;
      if (slot.cur === null && slot.next === null) this.jobs.delete(h);
      return 'ok';
    }
    const selector = this.selectorOf.get(task.id) ?? task.site;
    const pc = this.placeContext(ctx);
    const res = place(pc, { selector, bp, builder: p.rec, owner: ENGINEER_OWNER, holder: h, spot: task.spot, ringOnly: p.isAcu });
    if (res === 'budget') return 'budget';
    if (res === null) {
      return ctx.step(() => () => {
        this.unassign(ctx, j, h);
        task.failures++;
        this.retryAt.set(task.id, ctx.tick + NO_PLACE_RETRY_TICKS);
        if (slot.cur === j) slot.cur = slot.next;
        slot.next = null;
        if (slot.cur === null) this.jobs.delete(h);
      })
        ? 'ok'
        : 'abort';
    }
    return ctx.step(() => {
      ctx.emitter.build(h, bp.index, res.x, res.z, 0, Prio.P2, { source: 'engineer', queue: j.queued });
      return () => {
        commitPlacement(sh, res, bp, ENGINEER_OWNER, h, ctx.tick);
        const nj = this.makeBuildJob(task, bp, res, ctx.tick, j.queued, selector);
        if (slot.cur === j) slot.cur = nj;
        else slot.next = nj;
        task.spot = res.spot;
      };
    })
      ? 'ok'
      : 'abort';
  }

  private updateSupport(ctx: ManagerContext, p: PoolEntry, slot: Slot, j: Job): 'ok' | 'budget' | 'abort' {
    const h = p.rec.handle;
    const target = ctx.bb.units.get(j.target);
    const task = j.taskId !== 0 ? ctx.bb.taskBoard.get(j.taskId) : undefined;
    let end = false;
    let completeTask = false;
    if (target === undefined) {
      end = true;
      completeTask = true;
    } else if (j.kind === 'repair') {
      if (target.hpFrac >= 0.99) {
        end = true;
        completeTask = true;
      }
    } else if (task !== undefined) {
      // Board assist (upgrade/tech): done once the target has no work left (after a grace period,
      // the upgrade order may still be in flight).
      if (!isWorking(target) && ctx.tick - task.createdTick >= 30 && ctx.tick - j.issuedTick >= confirmTicks(ctx.profile.lead, ctx.profile.thinkEvery)) {
        end = true;
        completeTask = true;
      }
    } else if (ctx.tick >= j.untilTick || !isWorking(target)) {
      end = true;
    }
    if (task !== undefined && task.state !== 'open' && task.state !== 'assigned') end = true;
    if (end) {
      return ctx.step(() => () => {
        if (task !== undefined && completeTask && (task.state === 'open' || task.state === 'assigned')) ctx.bb.taskBoard.complete(task.id);
        this.unassign(ctx, j, h);
        slot.cur = slot.next;
        slot.next = null;
        if (slot.cur === null) this.jobs.delete(h);
      })
        ? 'ok'
        : 'abort';
    }
    // Re-issue if the order never showed up (APM drop).
    const window = confirmTicks(ctx.profile.lead, ctx.profile.thinkEvery);
    const shown = p.rec.orderTarget === j.target && p.rec.order !== 0;
    if (shown) {
      j.confirmed = true;
      return 'ok';
    }
    if (ctx.tick <= Math.max(j.issuedTick, j.reissuedTick) + window) return 'ok';
    return ctx.step(() => {
      this.emitSupport(ctx, h, j.kind, j.target);
      return () => {
        j.reissuedTick = ctx.tick;
      };
    })
      ? 'ok'
      : 'abort';
  }

  // ---- scouts, repairs ---------------------------------------------------------------------------

  /** Scouts near engineers: hunt request (P1 for the PlatoonManager), no flight (R-06, AI-ENG-04). */
  private huntScouts(ctx: ManagerContext, pool: readonly PoolEntry[]): boolean {
    const bb = ctx.bb;
    const flags = this.sh.flags;
    const r2 = COVER_RADIUS_WU * COVER_RADIUS_WU;
    for (const c of bb.enemy.current) {
      if (!ctx.budget.take(1)) return false;
      if (c.bp < 0 || flags.scout[c.bp] !== 1) continue;
      if (!ctx.budget.take(pool.length)) return false;
      let near = false;
      for (const p of pool) {
        if (p.isAcu) continue;
        const dx = p.rec.x - c.x;
        const dz = p.rec.z - c.z;
        if (dx * dx + dz * dz <= r2) {
          near = true;
          break;
        }
      }
      if (!near) continue;
      const existing = bb.huntRequests.find((r) => r.target === c.id);
      if (existing !== undefined) {
        existing.x = c.x;
        existing.z = c.z;
        continue;
      }
      if (!ctx.step(() => () => {
        bb.huntRequests.add((id) => ({ id, target: c.id, x: c.x, z: c.z, source: 'engineer', createdTick: ctx.tick, hunter: 0 }));
      })) return false;
    }
    return true;
  }

  /** Prio 30: own structures below 70 % HP without enemies within 30 WU (cursor over structures). */
  private postRepairs(ctx: ManagerContext): boolean {
    const bb = ctx.bb;
    const list = bb.units.structures;
    if (this.repairCursor >= list.length) this.repairCursor = 0;
    const r2 = REPAIR_ENEMY_FREE_WU * REPAIR_ENEMY_FREE_WU;
    for (let i = this.repairCursor; i < list.length; i++) {
      if (!ctx.budget.take(1)) {
        this.repairCursor = i;
        return false;
      }
      const s = list[i]!;
      if (!s.complete || s.hpFrac >= REPAIR_BELOW_HP) continue;
      if (bb.taskBoard.byKey(`repair:${s.handle}`) !== undefined) continue;
      if (!ctx.budget.take(bb.enemy.current.length)) {
        this.repairCursor = i;
        return false;
      }
      let enemy = false;
      for (const c of bb.enemy.current) {
        const dx = c.x - s.x;
        const dz = c.z - s.z;
        if (dx * dx + dz * dz <= r2) {
          enemy = true;
          break;
        }
      }
      if (enemy) continue;
      bb.taskBoard.add({ kind: 'repair', target: s.handle, prio: 30, wanted: 1, source: 'engineer', key: `repair:${s.handle}` }, ctx.tick);
    }
    this.repairCursor = 0;
    return true;
  }

  // ---- assignment ------------------------------------------------------------------------------

  /** Energy emergency: the commander takes the flagged power task first (ai.md §4.3/§5.1). */
  private frontPass(ctx: ManagerContext, pool: readonly PoolEntry[]): boolean {
    const sh = this.sh;
    if (sh.acuFrontTask === 0) return true;
    const acu = pool.find((p) => p.isAcu);
    if (acu === undefined) return true;
    const task = ctx.bb.taskBoard.get(sh.acuFrontTask);
    if (task === undefined || task.state !== 'open' || task.kind !== 'build') {
      sh.acuFrontTask = 0;
      return true;
    }
    const slot = this.jobs.get(acu.rec.handle);
    if (slot?.cur !== null && slot?.cur !== undefined && slot.cur.prio >= task.prio) return true;
    const bp = this.taskBlueprint(task);
    if (bp === null) return true;
    const r = this.startTask(ctx, acu, task, bp, false, true);
    if (r === 'budget' || r === 'abort') return false;
    if (r === 'ok') sh.acuFrontTask = 0;
    return true;
  }

  /** A builder that just finished an expansion gets the next expansion near it first. */
  private followUpPass(ctx: ManagerContext, pool: readonly PoolEntry[]): boolean {
    const sh = this.sh;
    if (sh.expansionDone.size === 0) return true;
    for (const [h, t] of [...sh.expansionDone]) {
      if (t < ctx.tick) {
        sh.expansionDone.delete(h);
        continue;
      }
      const p = pool.find((q) => q.rec.handle === h && !q.isAcu);
      const slot = this.jobs.get(h);
      if (p === undefined || (slot !== undefined && slot.cur !== null)) continue;
      const task = ctx.bb.taskBoard.ordered().find((x) => x.kind === 'build' && x.site === 'mex:next' && x.assigned.length < x.wanted);
      if (task === undefined) continue;
      const bp = this.taskBlueprint(task);
      if (bp === null || !sh.static.bps.canBuild(p.rec.blueprint, bp)) continue;
      const r = this.startTask(ctx, p, task, bp, false, false);
      if (r === 'budget' || r === 'abort') return false;
      sh.expansionDone.delete(h);
    }
    return true;
  }

  private taskBlueprint(task: Task): AiBlueprint | null {
    if (task.bp >= 0) return this.sh.static.bps.list[task.bp] ?? null;
    if (task.role === null) return null;
    return this.sh.roles.tryResolve(task.role, task.tech);
  }

  private assignPass(ctx: ManagerContext, pool: readonly PoolEntry[]): boolean {
    const bb = ctx.bb;
    const tasks = bb.taskBoard.ordered();
    if (this.assignCursor >= tasks.length) this.assignCursor = 0;
    for (let i = this.assignCursor; i < tasks.length; i++) {
      if (!ctx.budget.take(1)) {
        this.assignCursor = i;
        return false;
      }
      const task = tasks[i]!;
      if (task.state !== 'open' && task.state !== 'assigned') continue;
      if (task.assigned.length >= task.wanted) {
        const r = this.rescue(ctx, pool, task);
        if (r === 'budget') {
          this.assignCursor = i;
          return false;
        }
        if (r === 'abort') return false;
        continue;
      }
      const retry = this.retryAt.get(task.id);
      if (retry !== undefined && retry > ctx.tick) continue;
      let bp: AiBlueprint | null = null;
      if (task.kind === 'build') {
        bp = this.taskBlueprint(task);
        if (bp === null || (task.failures >= TASK_NOPLACE_LIMIT && task.assigned.length === 0 && task.siteHandle === 0)) {
          bb.taskBoard.fail(task.id);
          continue;
        }
      } else if (task.kind === 'assist' || task.kind === 'guard' || task.kind === 'repair') {
        if (bb.units.get(task.target) === undefined) {
          bb.taskBoard.cancel(task.id);
          continue;
        }
      } else continue;
      while (task.assigned.length < task.wanted) {
        const cand = this.bestBuilder(ctx, pool, task, bp);
        if (cand === 'budget') {
          this.assignCursor = i;
          return false;
        }
        if (cand === null) break;
        const r = this.startTask(ctx, cand.entry, task, bp, cand.queued, false);
        if (r === 'budget') {
          this.assignCursor = i;
          return false;
        }
        if (r === 'abort') return false;
        if (r === 'noplace') {
          task.failures++;
          this.retryAt.set(task.id, ctx.tick + NO_PLACE_RETRY_TICKS);
          break;
        }
      }
    }
    this.assignCursor = 0;
    return true;
  }

  /**
   * Rescue of a base build task whose only builders are still far away (tai-p5 calibration): an old
   * base task goes to any builder (ai.md §5.3, ≥ 20 s), which may walk for minutes from an outer
   * expansion while the commander or a base engineer becomes free meanwhile — Glutkessel tasks sat
   * "assigned" for 3 min with an empty storage. A free builder near the base joins at the same place
   * (co-build, `jointPlace`); the far builder keeps its job and helps or finds the plant finished.
   */
  private rescue(ctx: ManagerContext, pool: readonly PoolEntry[], task: Task): 'ok' | 'budget' | 'abort' {
    if (task.kind !== 'build' || task.siteHandle !== 0 || task.assigned.length === 0) return 'ok';
    if (task.assigned.length > task.wanted) return 'ok';
    const pos = this.taskPos(ctx, task);
    if (pos === null || !this.isBaseTask(ctx, task, pos)) return 'ok';
    const sh = this.sh;
    const far2 = (BOARD_NEAR_WU + RESCUE_EXTRA_WU) * (BOARD_NEAR_WU + RESCUE_EXTRA_WU);
    if (!ctx.budget.take(task.assigned.length)) return 'budget';
    for (const h of task.assigned) {
      const u = ctx.bb.units.get(h);
      if (u === undefined) return 'ok';
      const dx = u.x - pos.x;
      const dz = u.z - pos.z;
      if (dx * dx + dz * dz <= far2) return 'ok';
    }
    const near: PoolEntry[] = [];
    for (const p of pool) if (distToStart(sh, p.rec.x, p.rec.z) <= BOARD_NEAR_WU && !task.assigned.includes(p.rec.handle)) near.push(p);
    if (near.length === 0) return 'ok';
    const bp = this.taskBlueprint(task);
    if (bp === null) return 'ok';
    const cand = this.bestBuilder(ctx, near, task, bp);
    if (cand === 'budget') return 'budget';
    if (cand === null || cand.queued) return 'ok';
    const r = this.startTask(ctx, cand.entry, task, bp, false, false);
    return r === 'budget' ? 'budget' : r === 'abort' ? 'abort' : 'ok';
  }

  /** Position of a task's place for the cost estimate (null = depends on the builder). */
  private taskPos(ctx: ManagerContext, task: Task): Vec2 | null {
    const sh = this.sh;
    if (task.kind !== 'build') {
      const t = ctx.bb.units.get(task.target);
      return t === undefined ? null : { x: t.x, z: t.z };
    }
    const s = task.site;
    if (s === null) return null;
    if (typeof s !== 'string') return s;
    if (task.spot >= 0) {
      const sp = sh.static.spots[task.spot];
      return sp === undefined ? null : { x: sp.x, z: sp.z };
    }
    if (s.startsWith('spot:')) {
      const sp = sh.static.spots[Number(s.slice(5))];
      return sp === undefined ? null : { x: sp.x, z: sp.z };
    }
    if (s.startsWith('slot:fac')) {
      const n = Number(s.slice(8));
      if (Number.isInteger(n)) return sh.slotActual.get(`fac${n}`) ?? sh.analysis.factorySlot(n);
    }
    if (s.startsWith('slot:')) {
      const name = s.slice(5);
      const a = sh.slotActual.get(name);
      if (a !== undefined) return a;
      const t = sh.analysis.slots[name];
      if (t !== undefined) return { x: t.x, z: t.z };
    }
    if (s === 'mex:next' || s === 'hydro:next') return null;
    return sh.analysis.ownStart;
  }

  private isBaseTask(ctx: ManagerContext, task: Task, pos: Vec2 | null): boolean {
    if (task.kind === 'build') {
      if (typeof task.site === 'string') return isBaseSelector(task.site) || (task.site.startsWith('spot:') && pos !== null && distToStart(this.sh, pos.x, pos.z) <= BOARD_NEAR_WU);
      return pos !== null && distToStart(this.sh, pos.x, pos.z) <= BOARD_NEAR_WU;
    }
    const t = ctx.bb.units.get(task.target);
    return t !== undefined && distToStart(this.sh, t.x, t.z) <= BOARD_NEAR_WU;
  }

  private bestBuilder(
    ctx: ManagerContext,
    pool: readonly PoolEntry[],
    task: Task,
    bp: AiBlueprint | null,
  ): { entry: PoolEntry; queued: boolean } | null | 'budget' {
    const sh = this.sh;
    const pos = this.taskPos(ctx, task);
    const base = this.isBaseTask(ctx, task, pos);
    const old = ctx.tick - task.createdTick >= BOARD_ANY_AFTER_TICKS;
    const mexNext = task.kind === 'build' && (task.site === 'mex:next' || task.site === 'hydro:next');
    let best: { entry: PoolEntry; queued: boolean; cost: number } | null = null;
    for (const p of pool) {
      if (!ctx.budget.take(1)) return 'budget';
      const h = p.rec.handle;
      if (this.fleeing.has(h) || task.assigned.includes(h)) continue;
      if (task.builders === 'commander' && !p.isAcu) continue;
      if (task.builders === 'engineers' && p.isAcu) continue;
      if (bp !== null && !sh.static.bps.canBuild(p.rec.blueprint, bp)) continue;
      if (p.isAcu) {
        if (task.kind === 'build') {
          if (task.site === 'hydro:next') continue;
          if (!mexNext && (pos === null || distToStart(sh, pos.x, pos.z) > BASE_RADIUS_WU)) continue;
        } else if (task.builders !== 'commander' && (pos === null || distToStart(sh, pos.x, pos.z) > BASE_RADIUS_WU)) continue;
      }
      if (base && !old && distToStart(sh, p.rec.x, p.rec.z) > BOARD_NEAR_WU) continue;
      const slot = this.jobs.get(h);
      let remaining = 0;
      let from: Vec2 = p.rec;
      let queued = false;
      if (slot !== undefined && slot.cur !== null) {
        const cur = slot.cur;
        if (cur.prio <= PRIO_BUILD_ASSIST && task.prio > cur.prio) {
          remaining = 0;
        } else if (p.isAcu && task.builders === 'commander' && task.kind !== 'build' && task.prio >= cur.prio + ACU_PREEMPT_MARGIN) {
          // The commander drops a much less important job for its own assist task (tech upgrade,
          // tai-p5 calibration: a 30-s factory build delayed the T2 assist by 33 s); the dropped
          // site stays and goes back to the board.
          remaining = 0;
        } else if (
          task.kind === 'build' &&
          task.prio >= TaskPrio.power &&
          cur.kind !== 'build' &&
          task.prio > cur.prio &&
          (ctx.bb.eco.energyEmptyInS <= POWER_PREEMPT_EMPTY_S || ctx.tick - task.createdTick >= POWER_PREEMPT_WAIT_TICKS)
        ) {
          // Power first (tai-p5 calibration, ai.md §5.1 "Energie zuerst"): a builder leaves a lower
          // assist job (tech upgrade 80, mex-upgrade assist 40) for a power task of the balance — the
          // upgrade keeps running with its own build power. Before, the commander assisted the
          // Landwerk II while the power tasks waited without a builder and the storage ran dry.
          remaining = 0;
        } else if (task.kind === 'build' && cur.kind === 'build' && slot.next === null && cur.siteHandle !== 0) {
          const site = ctx.bb.units.get(cur.siteHandle);
          if (site === undefined || site.complete) continue;
          const cbp = site.blueprint;
          const bpow = p.rec.blueprint.buildPower;
          if (bpow <= 0) continue;
          remaining = ((1 - site.buildFrac) * cbp.buildTime) / bpow;
          if (remaining > QUEUE_BEHIND_MAX_S) continue;
          from = site;
          queued = true;
        } else continue;
      } else if (!freeByOrder(p.rec)) {
        // Busy with an order this manager did not give (e.g. leftovers after a handoff).
        continue;
      }
      const speed = p.rec.blueprint.speed > 0 ? p.rec.blueprint.speed : 1;
      let travel: number;
      if (mexNext) {
        const pick = pickSpot(this.placeContext(ctx), {
          kind: task.site === 'mex:next' ? 'mass' : 'hydro',
          builder: from,
          ringOnly: p.isAcu,
          owner: ENGINEER_OWNER,
          holder: h,
        });
        if (pick === 'budget') return 'budget';
        if (pick === null) continue;
        travel = pick.score;
      } else if (pos !== null) travel = travelWu(sh, from.x, from.z, pos.x, pos.z);
      else travel = 0;
      const cost = travel / speed + remaining;
      if (best === null || cost < best.cost || (cost === best.cost && h < best.entry.rec.handle)) best = { entry: p, queued, cost };
    }
    return best === null ? null : { entry: best.entry, queued: best.queued };
  }

  /** Place of a build task another builder already works on (its site, or its decided job place). */
  private jointPlace(ctx: ManagerContext, task: Task): Vec2 | null {
    if (task.assigned.length === 0 && task.siteHandle === 0) return null;
    if (task.siteHandle !== 0) {
      const site = ctx.bb.units.get(task.siteHandle);
      if (site !== undefined && !site.complete) return { x: site.x, z: site.z };
    }
    for (const b of task.assigned) {
      const slot = this.jobs.get(b);
      if (slot === undefined) continue;
      for (const j of [slot.cur, slot.next]) {
        if (j !== null && j.kind === 'build' && j.taskId === task.id) return { x: j.x, z: j.z };
      }
    }
    return null;
  }

  private placeContext(ctx: ManagerContext): PlaceContext {
    return { sh: this.sh, view: ctx.view, tick: ctx.tick, budget: ctx.budget };
  }

  private makeBuildJob(task: Task | null, bp: AiBlueprint, p: Placement, tick: number, queued: boolean, selector: TaskSite): Job {
    return {
      kind: 'build',
      prio: task?.prio ?? 0,
      taskId: task?.id ?? 0,
      bp: bp.index,
      x: p.x,
      z: p.z,
      key: p.key,
      spot: p.spot,
      target: 0,
      issuedTick: tick,
      queued,
      untilTick: -1,
      selector,
      rejected: false,
      rejectNoted: false,
      reissuedTick: -1,
      siteHandle: 0,
      confirmed: false,
    };
  }

  private supportJob(kind: JobKind, prio: number, taskId: number, target: OwnRecord, tick: number, untilTick: number): Job {
    return {
      kind,
      prio,
      taskId,
      bp: -1,
      x: target.x,
      z: target.z,
      key: null,
      spot: -1,
      target: target.handle,
      issuedTick: tick,
      queued: false,
      untilTick,
      selector: null,
      rejected: false,
      rejectNoted: false,
      reissuedTick: -1,
      siteHandle: 0,
      confirmed: false,
    };
  }

  private emitSupport(ctx: ManagerContext, h: number, kind: JobKind, target: number): void {
    if (kind === 'assist') ctx.emitter.assist([h], target, Prio.P2, { source: 'engineer' });
    else if (kind === 'guard') ctx.emitter.guard([h], target, Prio.P2, { source: 'engineer' });
    else ctx.emitter.repair([h], target, Prio.P2, { source: 'engineer' });
  }

  /**
   * Starts (or queues) a task on a builder. `preempt` drops the builder's current job (commander
   * energy emergency).
   */
  private startTask(
    ctx: ManagerContext,
    p: PoolEntry,
    task: Task,
    bp: AiBlueprint | null,
    queued: boolean,
    preempt: boolean,
  ): 'ok' | 'budget' | 'noplace' | 'abort' {
    const sh = this.sh;
    const h = p.rec.handle;
    if (task.kind === 'build') {
      if (bp === null) return 'noplace';
      const selector = task.site;
      // A further builder of a multi-builder task (Glutkessel II: 3) builds at the place the first one
      // chose — the same kind at the same place is co-built — instead of placing a second site
      // (tai-p5 calibration: two Glutkessel II sites of 12.000 E each drained the storage).
      const joint = this.jointPlace(ctx, task);
      if (joint !== null) {
        const ok = ctx.step(() => {
          ctx.emitter.build(h, bp.index, joint.x, joint.z, 0, Prio.P2, { source: 'engineer', queue: queued });
          return () => {
            const slot = this.slotFor(h);
            if (preempt && slot.cur !== null) {
              this.unassign(ctx, slot.cur, h);
              this.releaseJob(slot.cur, h, -1);
              slot.cur = null;
            }
            ctx.bb.taskBoard.assign(task.id, h);
            const j = this.makeBuildJob(task, bp, { x: joint.x, z: joint.z, key: '', spot: task.spot ?? -1, slot: null, w: 0, d: 0 }, ctx.tick, queued, selector);
            if (queued) slot.next = j;
            else slot.cur = j;
          };
        });
        return ok ? 'ok' : 'abort';
      }
      const slot0 = this.jobs.get(h);
      const from: Vec2 = queued && slot0?.cur !== null && slot0?.cur !== undefined ? { x: slot0.cur.x, z: slot0.cur.z } : p.rec;
      const res = place(this.placeContext(ctx), {
        selector,
        bp,
        builder: from,
        owner: ENGINEER_OWNER,
        holder: h,
        spot: task.spot,
        ringOnly: p.isAcu,
      });
      if (res === 'budget') return 'budget';
      if (res === null) return 'noplace';
      const ok = ctx.step(() => {
        ctx.emitter.build(h, bp.index, res.x, res.z, 0, Prio.P2, { source: 'engineer', queue: queued });
        return () => {
          const slot = this.slotFor(h);
          if (preempt && slot.cur !== null) {
            this.unassign(ctx, slot.cur, h);
            this.releaseJob(slot.cur, h, -1);
            slot.cur = null;
          }
          ctx.bb.taskBoard.assign(task.id, h);
          commitPlacement(sh, res, bp, ENGINEER_OWNER, h, ctx.tick);
          task.spot = res.spot;
          task.bp = bp.index;
          const j = this.makeBuildJob(task, bp, res, ctx.tick, queued, selector);
          if (queued) slot.next = j;
          else slot.cur = j;
        };
      });
      return ok ? 'ok' : 'abort';
    }
    const target = ctx.bb.units.get(task.target);
    if (target === undefined) return 'noplace';
    const kind: JobKind = task.kind === 'guard' ? 'guard' : task.kind === 'repair' ? 'repair' : 'assist';
    const ok = ctx.step(() => {
      this.emitSupport(ctx, h, kind, target.handle);
      return () => {
        const slot = this.slotFor(h);
        for (const old of [slot.cur, slot.next]) {
          if (old === null) continue;
          this.unassign(ctx, old, h);
          this.releaseJob(old, h, -1);
        }
        ctx.bb.taskBoard.assign(task.id, h);
        slot.cur = this.supportJob(kind, task.prio, task.id, target, ctx.tick, -1);
        slot.next = null;
      };
    });
    return ok ? 'ok' : 'abort';
  }

  // ---- idle ----------------------------------------------------------------------------------

  /** Free builders without a board task: build assist (prio 12) or factory guard (prio 10). */
  private idlePass(ctx: ManagerContext, pool: readonly PoolEntry[]): void {
    const eco = ctx.view.eco();
    const massFrac = eco.massCapacity > 0 ? eco.massStored / eco.massCapacity : 0;
    const energyOk = eco.energyRatio >= 1 - 1e-9 && !(ctx.bb.eco.energyEmptyInS <= BUILD_ASSIST_MIN_EMPTY_S);
    for (const p of pool) {
      const h = p.rec.handle;
      if (this.fleeing.has(h)) continue;
      const slot = this.jobs.get(h);
      if (slot !== undefined && slot.cur !== null) continue;
      if (!freeByOrder(p.rec)) continue;
      if (!ctx.budget.take(1)) return;
      let target: OwnRecord | null = null;
      let kind: JobKind = 'guard';
      let prio: number = PRIO_FACTORY_GUARD;
      if (!energyOk || ctx.bb.eco.deficitE > 0) {
        // Power assist (tai-p5 calibration, R-04 applied to energy): while the balance shows a deficit,
        // free builders help the power plants under construction near the base before guarding a
        // factory — the base has only a few builders, and a sustained deficit otherwise stalled for
        // minutes (AI-ECO-01).
        const site = this.bestAssistSite(ctx, p.rec, true);
        if (site === 'budget') return;
        if (site !== null) {
          target = site;
          kind = 'assist';
          prio = PRIO_BUILD_ASSIST;
        }
      }
      if (target === null && !p.isAcu && massFrac >= BUILD_ASSIST_MASS_FRAC && energyOk) {
        const site = this.bestAssistSite(ctx, p.rec, false);
        if (site === 'budget') return;
        if (site !== null) {
          target = site;
          kind = 'assist';
          prio = PRIO_BUILD_ASSIST;
        }
      }
      if (target === null) {
        const fac = this.nearestFactory(ctx, p.rec);
        if (fac === 'budget') return;
        target = fac;
      }
      if (target === null) continue;
      const t = target;
      const k = kind;
      const pr = prio;
      // Re-evaluation that keeps the same target: no command (the order already stands).
      const same = p.rec.orderTarget === t.handle && p.rec.order === (k === 'assist' ? OrderKind.Assist : OrderKind.Guard);
      if (!ctx.step(() => {
        if (!same) this.emitSupport(ctx, h, k, t.handle);
        return () => {
          this.slotFor(h).cur = this.supportJob(k, pr, 0, t, ctx.tick, ctx.tick + IDLE_RECHECK_TICKS);
        };
      })) return;
    }
  }

  /** Site to assist near the base: big sites (≥ 150 mass, R-04) or, with `power`, power plants. */
  private bestAssistSite(ctx: ManagerContext, b: OwnRecord, power: boolean): OwnRecord | null | 'budget' {
    const sh = this.sh;
    const sites = ctx.bb.units.sites;
    if (!ctx.budget.take(sites.length)) return 'budget';
    let best: OwnRecord | null = null;
    let bestD = Infinity;
    for (const s of sites) {
      if (power ? sh.flags.power[s.bp] !== 1 : s.blueprint.mass < BUILD_ASSIST_MIN_MASS) continue;
      if (distToStart(sh, s.x, s.z) > BOARD_NEAR_WU) continue;
      if (this.buildersOn(s.handle) >= BUILD_ASSIST_MAX_BUILDERS) continue;
      const d = travelWu(sh, b.x, b.z, s.x, s.z);
      if (d < bestD || (d === bestD && best !== null && s.handle < best.handle)) {
        best = s;
        bestD = d;
      }
    }
    return best;
  }

  private buildersOn(site: number): number {
    let n = 0;
    for (const slot of this.jobs.values()) {
      const j = slot.cur;
      if (j !== null && (j.target === site || j.siteHandle === site)) n++;
    }
    return n;
  }

  /** Nearest working factory, else the nearest factory at all (it will pick up work). */
  private nearestFactory(ctx: ManagerContext, b: OwnRecord): OwnRecord | null | 'budget' {
    const facs = ctx.bb.units.factories;
    if (!ctx.budget.take(facs.length)) return 'budget';
    let best: OwnRecord | null = null;
    let bestD = Infinity;
    let bestWorking = false;
    for (const f of facs) {
      const working = isWorking(f);
      const d = travelWu(this.sh, b.x, b.z, f.x, f.z);
      const better =
        best === null ||
        (working && !bestWorking) ||
        (working === bestWorking && (d < bestD || (d === bestD && f.handle < best.handle)));
      if (better) {
        best = f;
        bestD = d;
        bestWorking = working;
      }
    }
    return best;
  }

  // ---- helpers -------------------------------------------------------------------------------

  private slotFor(h: number): Slot {
    let s = this.jobs.get(h);
    if (s === undefined) {
      s = { cur: null, next: null };
      this.jobs.set(h, s);
    }
    return s;
  }

  /** Removes the builder from the job's board task (the task goes back to 'open' when empty). */
  private unassign(ctx: ManagerContext, j: Job, h: number): void {
    if (j.taskId === 0) return;
    const t = ctx.bb.taskBoard.get(j.taskId);
    if (t === undefined) return;
    const i = t.assigned.indexOf(h);
    if (i >= 0) t.assigned.splice(i, 1);
    if (t.state === 'assigned' && t.assigned.length === 0) t.state = 'open';
  }

  private releaseJob(j: Job, h: number, lockUntil: number): void {
    if (j.kind !== 'build') return;
    releasePlacement(this.sh, j.key, j.spot, h, lockUntil);
  }
}

/** No job of this manager: free if idle or only guarding/assisting (a leftover idle job). */
function freeByOrder(b: OwnRecord): boolean {
  return isIdle(b) || ((b.order === OrderKind.Guard || b.order === OrderKind.Assist) && b.queueLength === 0);
}

/** Defended points: own factories, own point defences, platoons; fallback the own start. */
function nearestDefended(sh: BuildShared, from: Vec2): Vec2 {
  let best: Vec2 = sh.analysis.ownStart;
  let bestD = Infinity;
  const consider = (x: number, z: number): void => {
    const dx = x - from.x;
    const dz = z - from.z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = { x, z };
    }
  };
  for (const f of sh.bb.units.factories) consider(f.x, f.z);
  for (const s of sh.bb.units.structures) if (s.complete && sh.flags.pd[s.bp] === 1) consider(s.x, s.z);
  for (const p of sh.bb.platoons) if (p.units.length > 0) consider(p.x, p.z);
  if (bestD === Infinity) consider(sh.analysis.ownStart.x, sh.analysis.ownStart.z);
  return best;
}

function distToNearestDefended(sh: BuildShared, from: Vec2): number {
  const p = nearestDefended(sh, from);
  const dx = p.x - from.x;
  const dz = p.z - from.z;
  return Math.sqrt(dx * dx + dz * dz);
}
