/**
 * OpeningRunner (ai.md §4.1–§4.4, A1): executes the opening chosen in `init`.
 *
 * - Commander: ONE shift queue (group of Build records, P2) with every step whose place is already
 *   fixed; `mex:next`/`hydro:next` steps are appended when the commander reaches them. Ring steps
 *   use the ring spots reserved at creation (as many as the queue has ring steps, AI-OPEN-03), so
 *   engineers pick outer spots from the start. Easy (Denkpause ≥ one think) issues step by step.
 * - Factories (`fac1`, `fac2`, `fac_air`): once the factory stands, rally + production queue
 *   (`produce` with count) + repeat loop (`loop` → FactoryRepeat with the highest buildable tech
 *   of each role), one group (P3). Handoff to the FactoryManager when the loop runs, at 5:00 at
 *   the latest.
 * - Engineers get the plans in spawn order; a builder with an empty list goes to the
 *   EngineerManager (handoff).
 * - Local defence (enemy combat unit in the 60-WU base radius or damage to the commander): the
 *   opening pauses (not discarded): a Punze/Stichel is pulled forward (productionRequest, fulfilled
 *   at once on an opening factory), lone scouts get a hunt request; commander fighting follows the
 *   handover rule (PlatoonManager claims it, the queue is re-issued when control returns); resume
 *   15 s after the last contact.
 * - Abort → defence mode (before 5:00): enemy ground threat in the own zone ≥ max(160, 0.5 × own
 *   mobile ground threat without commander) for 5 s, or ≥ 2 own structures lost within 30 s, or
 *   commander HP < 80 %. Then factories/commander/engineers are handed over, Punze/Stichel
 *   requests, a Riegel I task (prio 95) at the threatened ring mex, the rest is discarded.
 * - Scout switch: `tech_greed` → `eco_standard` if the first sighting of the enemy base (≤ 4:00)
 *   shows ≥ 2 land factories or ≥ 6 combat units.
 * - difficultyTiming: stepDelayS, skipChance, engineerCapFactor (EngineerManager), techDelayS
 *   (Tech/Economy), waveExtra (bb.opening.waveExtra for the PlatoonManager).
 */
import type { OwnRecord } from '../../blackboard.ts';
import type { Manager, ManagerContext, ManagerInitContext } from '../../brain.ts';
import { Prio } from '../../commands/emitter.ts';
import { enemyAcuFactor, blipThreat } from '../../threat.ts';
import { TaskPrio } from '../../taskboard.ts';
import type { Opening } from '../../openings.ts';
import { OrderKind, type AiBlueprint, type Vec2 } from '../../types.ts';
import { buildStatus, confirmTicks, isIdle, isWorking, siteOf, type BuildOrderRef } from '../engineer/jobs.ts';
import {
  commitPlacement,
  place,
  plannedOf,
  releasePlacement,
  slotPosition,
  type Placement,
  type PlaceContext,
} from '../engineer/placement.ts';
import {
  BASE_RADIUS_WU,
  ENEMY_CONTACT_LOCK_TICKS,
  OPENING_DEADLINE_TICK,
  PLACE_FAIL_LIMIT,
  ROLE,
  buildShared,
  type BuildShared,
  type PlannedSite,
} from '../engineer/shared.ts';
import { expandBuilderSteps, expandFallback, factoryPlans, isDeferredSelector, type FactoryPlan, type PlanStep } from './plan.ts';

export const OPENING_OWNER = 'opening';
/**
 * Reservation owner of the commander's steps (ring spots reserved at the start, commander places);
 * distinct from the plan engineers ('opening') so they never take the commander's ring spots.
 */
export const ACU_PLAN_OWNER = 'opening:acu';
/** Resume 15 s after the last contact (ai.md §4.3). */
export const LOCAL_DEFENSE_RESUME_TICKS = 150;
/** Defence-mode thresholds (ai.md §4.3, R-05). */
export const DEFENSE_MIN_THREAT = 160;
export const DEFENSE_OWN_FACTOR = 0.5;
export const DEFENSE_HOLD_TICKS = 50;
export const DEFENSE_LOST_STRUCTURES = 2;
export const DEFENSE_LOST_WINDOW_TICKS = 300;
export const DEFENSE_ACU_HP = 0.8;
/** Riegel offset towards the threat (ai.md §5.7). */
export const DEFENSE_PD_OFFSET_WU = 6;
/** Scout switch (ai.md §4.3). */
export const SWITCH_DEADLINE_TICK = 2400;
export const SWITCH_MIN_LAND_FACTORIES = 2;
export const SWITCH_MIN_COMBAT_UNITS = 6;
/** New units within this distance of a factory count as its production. */
const SPAWN_ATTRIBUTION_WU = 20;

type StepStatus = 'pending' | 'issued' | 'done' | 'skipped' | 'dropped';

interface AcuStep {
  plan: PlanStep;
  status: StepStatus;
  place: Placement | null;
  ringSpot: number;
  failures: number;
  ref: BuildOrderRef | null;
}

interface EngPlan {
  readonly handle: number;
  steps: PlanStep[];
  idx: number;
  job: { ref: BuildOrderRef; place: Placement; bp: AiBlueprint; reissued: number } | null;
  assistTarget: number;
  assistUntil: number;
  nextAt: number;
  failures: number;
  handedOff: boolean;
}

interface FacState {
  readonly plan: FactoryPlan;
  handle: number;
  issuedTick: number;
  remaining: number[];
  loopBps: number[];
  handedOff: boolean;
}

export class OpeningRunner implements Manager {
  readonly name = 'opening' as const;
  readonly budgetKey = 'reserve' as const;
  private readonly sh: BuildShared;
  private readonly init: ManagerInitContext;
  private acuSteps: AcuStep[] = [];
  private batchTick = -1;
  private rejectedSince = new Map<number, number>();
  private acuPaused = false;
  private nextAcuStepTick = 0;
  private engPlans: PlanStep[][] = [];
  private nextPlan = 0;
  private readonly engineers: EngPlan[] = [];
  private readonly knownEngineers = new Set<number>();
  private facs: FacState[] = [];
  private stimCursor = -1;
  private lastScanTick = -1;
  // local defence / defence mode / scout switch
  private lastContactTick = -1;
  private pulledForward = false;
  private overSince = -1;
  private lostTicks: number[] = [];
  private switchChecked = false;
  private started = false;
  private finished = false;

  constructor(init: ManagerInitContext) {
    this.init = init;
    this.sh = buildShared(init);
    const o = this.sh.opening;
    const skip = init.profile.timing.skipChance;
    const acu = expandBuilderSteps(o.acu, init.rng, skip);
    this.engPlans = o.engineers.map((p) => expandBuilderSteps(p, init.rng, skip));
    this.facs = factoryPlans(o).map((plan) => ({ plan, handle: 0, issuedTick: -1, remaining: [], loopBps: [], handedOff: false }));
    // Ring reservation at the start (AI-OPEN-03): as many ring spots as the queue has ring steps.
    const ringSteps = acu.filter((s) => s.kind === 'build' && s.at === 'ring').length;
    const ring = this.sh.analysis.ringSpots.slice(0, ringSteps);
    let r = 0;
    this.acuSteps = acu.map((plan) => {
      let ringSpot = -1;
      if (plan.kind === 'build' && plan.at === 'ring' && r < ring.length) {
        ringSpot = ring[r++]!;
        init.bb.reservations.reserveSpot(ringSpot, ACU_PLAN_OWNER, 0, 0);
      }
      return { plan, status: 'pending', place: null, ringSpot, failures: 0, ref: null };
    });
    init.bb.opening.id = o.id;
    init.bb.opening.waveExtra = init.profile.timing.waveExtra;
  }

  /** Commander steps with status (tests/diagnostics). */
  get commanderSteps(): readonly { readonly role: string; readonly at: string; readonly status: string; readonly ringSpot: number }[] {
    return this.acuSteps.map((s) => ({ role: s.plan.role, at: s.plan.at, status: s.status, ringSpot: s.ringSpot }));
  }

  /** Handles of the engineers running an opening plan (spawn order). */
  get planEngineers(): readonly number[] {
    return this.engineers.map((e) => e.handle);
  }

  think(ctx: ManagerContext): void {
    const bb = ctx.bb;
    if (!this.started) {
      this.started = true;
      bb.opening.active = true;
    }
    if (this.finished) return;
    const take = (n: number): boolean => ctx.budget.take(n);
    this.sh.pruneRejected(ctx.tick);
    if (!this.sh.ensureIndex(take)) return;
    this.readStimuli(ctx);
    if (this.checkDefenseMode(ctx)) return;
    if (!this.scoutSwitch(ctx)) return;
    if (!this.localDefense(ctx)) return;
    if (!this.commander(ctx)) return;
    if (!this.engineerPlans(ctx)) return;
    if (!this.factories(ctx)) return;
    this.publish(ctx);
    this.checkFinished(ctx);
  }

  // ---- stimuli -----------------------------------------------------------------------------------

  private readStimuli(ctx: ManagerContext): void {
    const bb = ctx.bb;
    const acu = bb.units.commander;
    bb.stimuli.forEachVisible(this.stimCursor, ctx.tick, (s) => {
      if (s.kind !== 'event') return;
      const e = s.event;
      if (e.kind === 'commandRejected') this.rejectedSince.set(e.unit, e.tick);
      else if (e.kind === 'ownDestroyed') {
        const b = this.sh.static.bps.list[e.bp];
        if (b !== undefined && b.isStructure) this.lostTicks.push(e.tick);
      } else if (e.kind === 'ownDamaged' && acu !== null && e.unit === acu.handle) this.lastContactTick = Math.max(this.lastContactTick, e.tick);
    });
    this.stimCursor = ctx.tick;
    this.lostTicks = this.lostTicks.filter((t) => t > ctx.tick - DEFENSE_LOST_WINDOW_TICKS);
  }

  // ---- defence mode ------------------------------------------------------------------------------

  private checkDefenseMode(ctx: ManagerContext): boolean {
    const bb = ctx.bb;
    if (bb.opening.defenseMode || ctx.tick >= OPENING_DEADLINE_TICK) return false;
    const sh = this.sh;
    let enemy = 0;
    let cx = 0;
    let cz = 0;
    let wsum = 0;
    for (const c of bb.enemy.current) {
      if (!ctx.budget.take(1)) return false;
      if (sh.analysis.zoneAt(c.x, c.z) !== 'own') continue;
      let t: number;
      if (c.bp < 0) t = blipThreat(bb.blipTable, bb.enemy.highestTechSeen);
      else {
        const b = sh.static.bps.list[c.bp]!;
        if (b.isStructure || b.layer === 'air') continue;
        t = b.threatSurface * (c.kind === 'visible' ? c.hpFrac : 1);
        if (sh.flags.commander[c.bp] === 1) t *= enemyAcuFactor(bb.enemy.estoreSeen, ctx.tick);
      }
      if (t <= 0) continue;
      enemy += t;
      cx += c.x * t;
      cz += c.z * t;
      wsum += t;
    }
    let own = 0;
    if (!ctx.budget.take(bb.units.army.length)) return false;
    for (const u of bb.units.army) if (u.blueprint.layer !== 'air') own += u.blueprint.threatSurface * u.hpFrac;
    let reason: string | null = null;
    if (enemy > 0 && enemy >= Math.max(DEFENSE_MIN_THREAT, DEFENSE_OWN_FACTOR * own)) {
      if (this.overSince < 0) this.overSince = ctx.tick;
      if (ctx.tick - this.overSince >= DEFENSE_HOLD_TICKS) reason = 'threat';
    } else this.overSince = -1;
    if (reason === null && this.lostTicks.length >= DEFENSE_LOST_STRUCTURES) reason = 'structuresLost';
    const acu = bb.units.commander;
    if (reason === null && acu !== null && acu.hpFrac < DEFENSE_ACU_HP) reason = 'commanderHp';
    if (reason === null) return false;
    const threatAt: Vec2 | null = wsum > 0 ? { x: cx / wsum, z: cz / wsum } : acu !== null ? { x: acu.x, z: acu.z } : null;
    const why = reason;
    ctx.step(() => () => this.enterDefenseMode(ctx, why, threatAt));
    return true;
  }

  private enterDefenseMode(ctx: ManagerContext, reason: string, threatAt: Vec2 | null): void {
    const bb = ctx.bb;
    const sh = this.sh;
    const tick = ctx.tick;
    bb.opening.defenseMode = true;
    bb.opening.defenseModeTick = tick;
    bb.telemetry.push({ kind: 'defenseMode', tick, reason });
    for (const role of [ROLE.tank, ROLE.bot]) {
      bb.productionRequests.add((id) => ({ id, role, tech: 1, count: 2, prio: TaskPrio.defense, source: OPENING_OWNER, createdTick: tick }));
    }
    // Riegel I at the threatened ring mex, 6 WU towards the threat.
    const mex = this.threatenedRingMex(threatAt);
    if (mex !== null) {
      let x = mex.x;
      let z = mex.z;
      if (threatAt !== null) {
        const dx = threatAt.x - mex.x;
        const dz = threatAt.z - mex.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > 0) {
          x += (dx / d) * DEFENSE_PD_OFFSET_WU;
          z += (dz / d) * DEFENSE_PD_OFFSET_WU;
        }
      }
      bb.taskBoard.add(
        { kind: 'build', role: ROLE.pd, tech: 1, site: { x, z }, prio: TaskPrio.defense, wanted: 1, source: OPENING_OWNER, key: 'opening:defense-pd' },
        tick,
      );
    }
    // Discard the rest of the opening: release every open place, hand everything over.
    for (const s of this.acuSteps) {
      if (s.status === 'pending' || s.status === 'issued') {
        if (s.place !== null) releasePlacement(sh, s.place.key, s.place.spot, bb.units.commander?.handle ?? 0);
        s.status = 'dropped';
      }
      if (s.ringSpot >= 0) {
        const r = bb.reservations.spotReservation(s.ringSpot);
        if (r !== undefined && r.owner === ACU_PLAN_OWNER && s.status === 'dropped') bb.reservations.releaseSpot(s.ringSpot);
      }
    }
    this.handoffAcu(ctx);
    for (const e of this.engineers) if (!e.handedOff) this.handoffEngineer(ctx, e);
    this.nextPlan = this.engPlans.length;
    for (const f of this.facs) if (f.handle !== 0 && !f.handedOff) this.handoffFactory(ctx, f);
    this.finish(ctx);
  }

  private threatenedRingMex(threatAt: Vec2 | null): Vec2 | null {
    const sh = this.sh;
    let best: Vec2 | null = null;
    let bestHandle = 0;
    let bestD = Infinity;
    const ring = new Set(sh.analysis.ringSpots);
    for (const s of sh.bb.units.structures) {
      if (sh.flags.mex[s.bp] !== 1) continue;
      let onRing = false;
      for (const i of ring) {
        const sp = sh.static.spots[i]!;
        if (Math.abs(sp.x - s.x) <= 1 && Math.abs(sp.z - s.z) <= 1) {
          onRing = true;
          break;
        }
      }
      if (!onRing) continue;
      const ref = threatAt ?? sh.analysis.enemyStart;
      const dx = s.x - ref.x;
      const dz = s.z - ref.z;
      const d = dx * dx + dz * dz;
      if (d < bestD || (d === bestD && best !== null && s.handle < bestHandle)) {
        best = { x: s.x, z: s.z };
        bestHandle = s.handle;
        bestD = d;
      }
    }
    if (best === null) {
      // No ring mex yet: the ring spot nearest to the threat.
      for (const i of sh.analysis.ringSpots) {
        const sp = sh.static.spots[i]!;
        const ref = threatAt ?? sh.analysis.enemyStart;
        const d = (sp.x - ref.x) * (sp.x - ref.x) + (sp.z - ref.z) * (sp.z - ref.z);
        if (d < bestD) {
          bestD = d;
          best = { x: sp.x, z: sp.z };
        }
      }
    }
    return best;
  }

  // ---- scout switch ------------------------------------------------------------------------------

  private scoutSwitch(ctx: ManagerContext): boolean {
    const sh = this.sh;
    if (this.switchChecked || sh.opening.id !== 'tech_greed') return true;
    if (ctx.tick > SWITCH_DEADLINE_TICK) {
      this.switchChecked = true;
      return true;
    }
    const bb = ctx.bb;
    const es = sh.analysis.enemyStart;
    let seen = bb.telemetry.first('scoutSeenEnemyBase') !== undefined;
    let combat = 0;
    for (const c of bb.enemy.current) {
      if (!ctx.budget.take(1)) return false;
      const dx = c.x - es.x;
      const dz = c.z - es.z;
      if (dx * dx + dz * dz <= BASE_RADIUS_WU * BASE_RADIUS_WU) seen = true;
      if (c.bp >= 0 && sh.flags.combat[c.bp] === 1) combat++;
    }
    if (!seen) return true;
    this.switchChecked = true;
    if (bb.enemy.landFactories < SWITCH_MIN_LAND_FACTORIES && combat < SWITCH_MIN_COMBAT_UNITS) return true;
    const eco = this.init.openings.openings.find((o) => o.id === 'eco_standard');
    if (eco === undefined) return true;
    return ctx.step(() => {
      const loops = this.switchLoops(ctx, eco);
      for (const l of loops) ctx.emitter.factoryRepeat(l.fac.handle, l.loop, Prio.P3, { source: OPENING_OWNER });
      return () => {
        this.switchTo(ctx, eco);
        for (const l of loops) l.fac.loopBps = l.loop;
      };
    });
  }

  /** New repeat loops of the opening factories under `o` (scout switch). */
  private switchLoops(ctx: ManagerContext, o: Opening): { fac: FacState; loop: number[] }[] {
    const out: { fac: FacState; loop: number[] }[] = [];
    const plans = factoryPlans(o);
    for (const f of this.facs) {
      const np = plans.find((p) => p.slot === f.plan.slot);
      if (np === undefined || f.handedOff || f.handle === 0) continue;
      const rec = ctx.bb.units.get(f.handle);
      if (rec === undefined) continue;
      const loop = this.loopBps(np, rec.blueprint);
      if (loop.length > 0) out.push({ fac: f, loop });
    }
    return out;
  }

  /** Continues with `o` from the current step (commander steps by index, later engineer plans, loop). */
  private switchTo(ctx: ManagerContext, o: Opening): void {
    const sh = this.sh;
    const bb = ctx.bb;
    sh.opening = o;
    bb.opening.id = o.id;
    bb.telemetry.push({ kind: 'openingSelected', tick: ctx.tick, id: o.id });
    const skip = ctx.profile.timing.skipChance;
    const acu = expandBuilderSteps(o.acu, null, skip);
    const head = this.acuSteps.findIndex((s) => s.status === 'pending');
    if (head >= 0) {
      const ringLeft: number[] = [];
      for (const s of this.acuSteps.slice(head)) if (s.status === 'pending' && s.ringSpot >= 0) ringLeft.push(s.ringSpot);
      const kept = this.acuSteps.slice(0, head);
      for (const s of this.acuSteps.slice(head)) if (s.status !== 'pending') kept.push(s);
      const tail = acu.slice(Math.min(head, acu.length)).map((plan): AcuStep => {
        let ringSpot = -1;
        if (plan.kind === 'build' && plan.at === 'ring' && ringLeft.length > 0) ringSpot = ringLeft.shift()!;
        return { plan, status: 'pending', place: null, ringSpot, failures: 0, ref: null };
      });
      for (const s of ringLeft) bb.reservations.releaseSpot(s);
      this.acuSteps = [...kept, ...tail];
    }
    this.engPlans = o.engineers.map((p) => expandBuilderSteps(p, null, skip));
  }

  // ---- local defence -----------------------------------------------------------------------------

  private localDefense(ctx: ManagerContext): boolean {
    const bb = ctx.bb;
    const sh = this.sh;
    const r2 = BASE_RADIUS_WU * BASE_RADIUS_WU;
    const st = sh.analysis.ownStart;
    let contact = false;
    for (const c of bb.enemy.current) {
      if (!ctx.budget.take(1)) return false;
      if (c.bp < 0) continue;
      const dx = c.x - st.x;
      const dz = c.z - st.z;
      if (dx * dx + dz * dz > r2) continue;
      if (sh.flags.scout[c.bp] === 1) {
        const existing = bb.huntRequests.find((r) => r.target === c.id);
        if (existing !== undefined) {
          existing.x = c.x;
          existing.z = c.z;
        } else {
          const id = c.id;
          const x = c.x;
          const z = c.z;
          if (!ctx.step(() => () => {
            bb.huntRequests.add((rid) => ({ id: rid, target: id, x, z, source: OPENING_OWNER, createdTick: ctx.tick, hunter: 0 }));
          })) return false;
        }
      } else if (sh.flags.combat[c.bp] === 1 || sh.flags.commander[c.bp] === 1) contact = true;
    }
    if (contact) this.lastContactTick = ctx.tick;
    const active = this.lastContactTick >= 0 && ctx.tick - this.lastContactTick < LOCAL_DEFENSE_RESUME_TICKS;
    if (!active) {
      bb.opening.localDefense = false;
      this.pulledForward = false;
      return true;
    }
    bb.opening.localDefense = true;
    if (this.pulledForward) return true;
    return this.pullForward(ctx);
  }

  /** Pulls a Punze (else a Stichel) forward on the nearest opening factory or requests it. */
  private pullForward(ctx: ManagerContext): boolean {
    const bb = ctx.bb;
    const sh = this.sh;
    const fac = this.facs.find((f) => f.handle !== 0 && !f.handedOff && bb.units.get(f.handle) !== undefined) ?? null;
    let role: string = ROLE.tank;
    let bp: AiBlueprint | null = null;
    if (fac !== null) {
      const rec = bb.units.get(fac.handle)!;
      bp = sh.roles.bestFor(ROLE.tank, 1, rec.blueprint);
      if (bp === null) {
        role = ROLE.bot;
        bp = sh.roles.bestFor(ROLE.bot, 1, rec.blueprint);
      }
    }
    const tick = ctx.tick;
    if (fac === null || bp === null) {
      return ctx.step(() => () => {
        bb.productionRequests.add((id) => ({ id, role, tech: 1, count: 1, prio: TaskPrio.defense, source: OPENING_OWNER, createdTick: tick }));
        this.pulledForward = true;
      });
    }
    const unit = bp;
    return ctx.step(() => {
      ctx.emitter.group(() => {
        ctx.emitter.factoryQueue(fac.handle, unit.index, 1, Prio.P3, { source: OPENING_OWNER });
        let i = 0;
        while (i < fac.remaining.length) {
          const b = fac.remaining[i]!;
          let n = 1;
          while (i + n < fac.remaining.length && fac.remaining[i + n] === b) n++;
          ctx.emitter.factoryQueue(fac.handle, b, n, Prio.P3, { source: OPENING_OWNER, queue: true });
          i += n;
        }
      });
      return () => {
        // Posted and fulfilled at once (the FactoryManager runs later in this think and only sees
        // requests that are still open).
        const req = bb.productionRequests.add((id) => ({ id, role, tech: 1, count: 1, prio: TaskPrio.defense, source: OPENING_OWNER, createdTick: tick }));
        bb.productionRequests.remove(req.id);
        fac.remaining = [unit.index, ...fac.remaining];
        this.pulledForward = true;
      };
    });
  }

  // ---- commander queue -------------------------------------------------------------------------

  private sequential(ctx: ManagerContext): boolean {
    return ctx.profile.timing.stepDelayS * 10 > ctx.profile.thinkEvery;
  }

  private commander(ctx: ManagerContext): boolean {
    const bb = ctx.bb;
    if (bb.opening.handedOffAcu) return true;
    const acu = bb.units.commander;
    if (acu === null) {
      this.handoffAcu(ctx);
      return true;
    }
    if (bb.reservations.acuOwner !== OPENING_OWNER) {
      this.acuPaused = true;
      return true;
    }
    if (this.acuPaused) {
      // Control came back: re-issue everything that is not finished, at the same step.
      this.acuPaused = false;
      for (const s of this.acuSteps) if (s.status === 'issued') this.finalizeStep(ctx, s, acu, true);
    }
    if (!this.energyFront(ctx, acu)) return false;
    this.trackQueue(ctx, acu);
    const open = this.acuSteps.filter((s) => s.status === 'issued');
    if (open.length === 0) {
      if (this.acuSteps.every((s) => s.status === 'done' || s.status === 'skipped' || s.status === 'dropped')) {
        this.handoffAcu(ctx);
        return true;
      }
      if (ctx.tick < this.nextAcuStepTick) return true;
      return this.issueBatch(ctx, acu, false);
    }
    // Append the next (deferred) steps once the commander works on the last issued step.
    if (this.sequential(ctx)) return true;
    const last = open[open.length - 1]!;
    const onLast = open.length === 1 && last.ref !== null && last.ref.confirmed;
    const hasPending = this.acuSteps.some((s) => s.status === 'pending');
    if (onLast && hasPending) return this.issueBatch(ctx, acu, true);
    return true;
  }

  /** Energy emergency: the flagged power task goes to the front of the commander queue. */
  private energyFront(ctx: ManagerContext, acu: OwnRecord): boolean {
    const sh = this.sh;
    if (sh.acuFrontTask === 0) return true;
    const task = ctx.bb.taskBoard.get(sh.acuFrontTask);
    if (task === undefined || task.state !== 'open' || task.kind !== 'build' || task.role === null || typeof task.site !== 'string') {
      sh.acuFrontTask = 0;
      return true;
    }
    // ecosim rule (economy_manager): no emergency insertion while the commander's next step already is
    // a power plant — otherwise every emergency second queued one more Glutkessel in front of the ring
    // mex (tai-p5 calibration: tech_greed Setons built 4 instead of 2 before ring mex 3).
    const live = this.acuSteps.filter((s) => s.status === 'issued' || s.status === 'pending');
    const next = live[acu.order === OrderKind.Build ? 1 : 0];
    if (next !== undefined && next.plan.kind === 'build' && (next.plan.role === ROLE.pgen || next.plan.role === ROLE.hydro)) {
      return ctx.step(() => () => {
        task.prio = TaskPrio.power;
        sh.acuFrontTask = 0;
      });
    }
    const step: AcuStep = {
      plan: { kind: 'build', role: task.role, tech: task.tech, at: task.site, fallback: null, skip: false },
      status: 'pending',
      place: null,
      ringSpot: -1,
      failures: 0,
      ref: null,
    };
    const id = task.id;
    return ctx.step(() => () => {
      ctx.bb.taskBoard.cancel(id);
      sh.acuFrontTask = 0;
      for (const s of this.acuSteps) if (s.status === 'issued') this.finalizeStep(ctx, s, acu, true);
      const head = this.acuSteps.findIndex((s) => s.status === 'pending');
      if (head < 0) this.acuSteps.push(step);
      else this.acuSteps.splice(head, 0, step);
      this.batchTick = -1;
    });
  }

  private trackQueue(ctx: ManagerContext, acu: OwnRecord): void {
    const issued = this.acuSteps.filter((s) => s.status === 'issued');
    if (issued.length === 0) return;
    if (ctx.tick <= this.batchTick + ctx.profile.lead) return;
    const window = confirmTicks(ctx.profile.lead, ctx.profile.thinkEvery);
    let cur = -1;
    for (let i = 0; i < issued.length; i++) {
      const r = issued[i]!.ref!;
      if (acu.order === OrderKind.Build && acu.orderBp === r.bp && Math.abs(acu.orderX - r.x) <= 1 && Math.abs(acu.orderZ - r.z) <= 1) {
        cur = i;
        break;
      }
    }
    if (cur >= 0) {
      issued[cur]!.ref!.confirmed = true;
      for (let i = 0; i < cur; i++) this.finalizeStep(ctx, issued[i]!, acu, false);
      return;
    }
    const anyConfirmed = issued.some((s) => s.ref!.confirmed);
    if (isIdle(acu) && (anyConfirmed || ctx.tick > this.batchTick + window)) {
      for (const s of issued) this.finalizeStep(ctx, s, acu, false);
    }
  }

  /** A step the commander passed: done if its structure exists, else a failure (re-plan). */
  private finalizeStep(ctx: ManagerContext, s: AcuStep, acu: OwnRecord, resume: boolean): void {
    const sh = this.sh;
    const ref = s.ref;
    s.status = 'pending';
    if (ref === null || s.place === null) return;
    const site = siteOf(sh, ref);
    if (site !== null && site.complete) {
      s.status = 'done';
      releasePlacement(sh, s.place.key, s.place.spot, acu.handle);
      if (s.ringSpot >= 0 && s.place.spot !== s.ringSpot) ctx.bb.reservations.releaseSpot(s.ringSpot);
      this.nextAcuStepTick = ctx.tick + Math.round(ctx.profile.timing.stepDelayS * 10);
      return;
    }
    if (site !== null) {
      // Started but not finished: resume at the same place.
      s.place = { ...s.place, x: site.x, z: site.z };
      return;
    }
    if (resume) return;
    s.failures++;
    const rej = this.rejectedSince.get(acu.handle);
    const bp = sh.static.bps.list[ref.bp]!;
    if (rej !== undefined && rej >= ref.issuedTick) {
      sh.rejected.push({ x: ref.x, z: ref.z, w: bp.footprint[0], d: bp.footprint[1], untilTick: ctx.tick + 600 });
    }
    sh.noteFailure(s.place.key, s.place.spot, ctx.tick);
    releasePlacement(sh, s.place.key, s.place.spot === s.ringSpot ? -1 : s.place.spot, acu.handle);
    s.place = null;
    s.ref = null;
    if (s.failures >= PLACE_FAIL_LIMIT) {
      s.status = 'dropped';
      if (s.ringSpot >= 0) ctx.bb.reservations.releaseSpot(s.ringSpot);
    }
  }

  private placeContext(ctx: ManagerContext, extra?: PlannedSite[], extraSlots?: Map<string, Vec2>): PlaceContext {
    return extra === undefined
      ? { sh: this.sh, view: ctx.view, tick: ctx.tick, budget: ctx.budget }
      : { sh: this.sh, view: ctx.view, tick: ctx.tick, budget: ctx.budget, extra, extraSlots: extraSlots ?? new Map() };
  }

  /** Hydro step without a reachable hydro spot: replace by its fallback (ai.md §4.1). */
  private hydroAvailable(ctx: ManagerContext): boolean {
    for (const sp of ctx.view.freeHydroSpots()) {
      const info = this.sh.analysis.spots[sp.index]!;
      if (info.zone !== 'own') continue;
      if (ctx.bb.reservations.isSpotAvailable(sp.index, ctx.tick)) return true;
    }
    return false;
  }

  /**
   * Resolves and emits the next commander batch: every pending step with a fixed place (plus one
   * deferred step if it is first), as one group; `append` queues behind the current order.
   */
  private issueBatch(ctx: ManagerContext, acu: OwnRecord, append: boolean): boolean {
    const sh = this.sh;
    const extra: PlannedSite[] = [];
    const slots = new Map<string, Vec2>();
    const pc = this.placeContext(ctx, extra, slots);
    const batch: { step: AcuStep; place: Placement; bp: AiBlueprint }[] = [];
    const skipped: AcuStep[] = [];
    const failed: AcuStep[] = [];
    const burst = Math.max(1, ctx.profile.apm.burst);
    const seq = this.sequential(ctx);
    for (let i = 0; i < this.acuSteps.length; i++) {
      const s = this.acuSteps[i]!;
      if (s.status !== 'pending') continue;
      if (s.plan.skip) {
        skipped.push(s);
        continue;
      }
      if (s.plan.kind !== 'build') {
        skipped.push(s);
        continue;
      }
      if (s.plan.role === ROLE.hydro && s.plan.fallback !== null && !this.hydroAvailable(ctx)) {
        if (batch.length > 0) break;
        const fb = expandFallback(s.plan.fallback);
        return ctx.step(() => () => {
          const idx = this.acuSteps.indexOf(s);
          this.acuSteps.splice(idx, 1, ...fb.map((plan): AcuStep => ({ plan, status: 'pending', place: null, ringSpot: -1, failures: 0, ref: null })));
        });
      }
      const deferred = isDeferredSelector(s.plan.at) || (s.plan.at === 'ring' && s.ringSpot < 0);
      if (deferred && batch.length > 0) break;
      const bp = sh.bp(s.plan.role, s.plan.tech);
      const res = s.place ?? place(pc, {
        selector: s.plan.at,
        bp,
        builder: batch.length > 0 ? batch[batch.length - 1]!.place : acu,
        owner: ACU_PLAN_OWNER,
        holder: acu.handle,
        spot: s.ringSpot,
      });
      if (res === 'budget') return false;
      if (res === null) {
        failed.push(s);
        break;
      }
      extra.push(plannedOf(res, bp, ACU_PLAN_OWNER, acu.handle, ctx.tick));
      if (res.slot !== null) slots.set(res.slot, { x: res.x, z: res.z });
      batch.push({ step: s, place: res, bp });
      if (seq || batch.length >= burst) break;
    }
    if (batch.length === 0 && skipped.length === 0 && failed.length === 0) return true;
    return ctx.step(() => {
      if (batch.length > 0) {
        ctx.emitter.group(() => {
          for (let k = 0; k < batch.length; k++) {
            const b = batch[k]!;
            ctx.emitter.build(acu.handle, b.bp.index, b.place.x, b.place.z, 0, Prio.P2, { source: OPENING_OWNER, queue: append || k > 0 });
          }
        });
      }
      return () => {
        for (const s of skipped) {
          s.status = 'skipped';
          if (s.ringSpot >= 0) ctx.bb.reservations.releaseSpot(s.ringSpot);
        }
        for (const s of failed) {
          s.failures++;
          if (s.failures >= PLACE_FAIL_LIMIT) {
            s.status = 'dropped';
            if (s.ringSpot >= 0) ctx.bb.reservations.releaseSpot(s.ringSpot);
          }
        }
        for (const b of batch) {
          commitPlacement(sh, b.place, b.bp, ACU_PLAN_OWNER, acu.handle, ctx.tick);
          b.step.place = b.place;
          b.step.status = 'issued';
          b.step.ref = { bp: b.bp.index, x: b.place.x, z: b.place.z, issuedTick: ctx.tick, siteHandle: 0, confirmed: false };
        }
        if (batch.length > 0) this.batchTick = ctx.tick;
      };
    });
  }

  // ---- engineer plans -------------------------------------------------------------------------

  private engineerPlans(ctx: ManagerContext): boolean {
    const bb = ctx.bb;
    const sh = this.sh;
    // New engineers in spawn order.
    const fresh: OwnRecord[] = [];
    for (const e of bb.units.engineers) if (!this.knownEngineers.has(e.handle)) fresh.push(e);
    fresh.sort((a, b) => a.firstSeenTick - b.firstSeenTick || a.handle - b.handle);
    for (const e of fresh) {
      this.knownEngineers.add(e.handle);
      if (bb.opening.defenseMode || this.nextPlan >= this.engPlans.length) continue;
      if (bb.reservations.unitOwner(e.handle) !== undefined) continue;
      bb.reservations.claimUnit(e.handle, OPENING_OWNER);
      this.engineers.push({
        handle: e.handle,
        steps: [...this.engPlans[this.nextPlan++]!],
        idx: 0,
        job: null,
        assistTarget: 0,
        assistUntil: -1,
        nextAt: 0,
        failures: 0,
        handedOff: false,
      });
    }
    const window = confirmTicks(ctx.profile.lead, ctx.profile.thinkEvery);
    for (const ep of this.engineers) {
      if (ep.handedOff) continue;
      if (!ctx.budget.take(1)) return false;
      const rec = bb.units.get(ep.handle);
      if (rec === undefined) {
        // Builder died: the spot returns, locked 30 s if there was enemy contact (ai.md §4.2).
        if (ep.job !== null) {
          const p = ep.job.place;
          const contact = ctx.budget.take(1) && bb.threat.threatAt('surface', p.x, p.z) > 0;
          releasePlacement(sh, p.key, p.spot, ep.handle, contact ? ctx.tick + ENEMY_CONTACT_LOCK_TICKS : -1);
        }
        ep.handedOff = true;
        continue;
      }
      if (bb.reservations.unitOwner(ep.handle) !== OPENING_OWNER) continue;
      if (ep.job !== null) {
        const st = buildStatus(sh, rec, ep.job.ref, ctx.tick, window);
        if (st === 'done') {
          releasePlacement(sh, ep.job.place.key, ep.job.place.spot, ep.handle);
          ep.job = null;
          ep.idx++;
          ep.failures = 0;
          ep.nextAt = ctx.tick + Math.round(ctx.profile.timing.stepDelayS * 10);
        } else if (st === 'stalled') {
          if (isIdle(rec) && ctx.tick > ep.job.reissued + window) {
            const j = ep.job;
            if (!ctx.step(() => {
              ctx.emitter.build(ep.handle, j.bp.index, j.place.x, j.place.z, 0, Prio.P2, { source: OPENING_OWNER });
              return () => {
                j.reissued = ctx.tick;
              };
            })) return false;
          }
          continue;
        } else if (st === 'lost') {
          const j = ep.job;
          const rej = this.rejectedSince.get(ep.handle);
          if (rej !== undefined && rej >= j.ref.issuedTick) {
            sh.rejected.push({ x: j.place.x, z: j.place.z, w: j.bp.footprint[0], d: j.bp.footprint[1], untilTick: ctx.tick + 600 });
          }
          sh.noteFailure(j.place.key, j.place.spot, ctx.tick);
          releasePlacement(sh, j.place.key, j.place.spot, ep.handle);
          ep.job = null;
          ep.failures++;
          if (ep.failures >= PLACE_FAIL_LIMIT) {
            ep.idx++;
            ep.failures = 0;
          }
        } else continue;
      }
      if (ep.assistTarget !== 0) {
        const t = bb.units.get(ep.assistTarget);
        if (t !== undefined && isWorking(t) && ctx.tick < ep.assistUntil) continue;
        ep.assistTarget = 0;
        ep.idx++;
      }
      if (ctx.tick < ep.nextAt) continue;
      const r = this.startEngineerStep(ctx, ep, rec);
      if (r === 'budget') return false;
    }
    return true;
  }

  private startEngineerStep(ctx: ManagerContext, ep: EngPlan, rec: OwnRecord): 'ok' | 'budget' {
    const sh = this.sh;
    for (let guard = 0; guard < 8; guard++) {
      const s = ep.steps[ep.idx];
      if (s === undefined) {
        this.handoffEngineer(ctx, ep);
        return 'ok';
      }
      if (s.skip) {
        ep.idx++;
        continue;
      }
      if (s.kind === 'assist') {
        const target = this.assistTarget(ctx, s.at);
        if (target === null) {
          ep.idx++;
          continue;
        }
        const ok = ctx.step(() => {
          ctx.emitter.assist([ep.handle], target.handle, Prio.P2, { source: OPENING_OWNER });
          return () => {
            ep.assistTarget = target.handle;
            ep.assistUntil = ctx.tick + 600;
          };
        });
        return ok ? 'ok' : 'budget';
      }
      if (s.role === ROLE.hydro && s.fallback !== null && !this.hydroAvailable(ctx)) {
        ep.steps.splice(ep.idx, 1, ...expandFallback(s.fallback));
        continue;
      }
      const bp = sh.bp(s.role, s.tech);
      if (!sh.static.bps.canBuild(rec.blueprint, bp)) {
        ep.idx++;
        continue;
      }
      const res = place(this.placeContext(ctx), { selector: s.at, bp, builder: rec, owner: OPENING_OWNER, holder: ep.handle });
      if (res === 'budget') return 'budget';
      if (res === null) {
        ep.idx++;
        continue;
      }
      const ok = ctx.step(() => {
        ctx.emitter.build(ep.handle, bp.index, res.x, res.z, 0, Prio.P2, { source: OPENING_OWNER });
        return () => {
          commitPlacement(sh, res, bp, OPENING_OWNER, ep.handle, ctx.tick);
          ep.job = { ref: { bp: bp.index, x: res.x, z: res.z, issuedTick: ctx.tick, siteHandle: 0, confirmed: false }, place: res, bp, reissued: -1 };
        };
      });
      return ok ? 'ok' : 'budget';
    }
    return 'ok';
  }

  private assistTarget(ctx: ManagerContext, at: string): OwnRecord | null {
    const name = at.startsWith('upgrade:') ? at.slice(8) : at;
    const f = this.facs.find((x) => x.plan.slot === name);
    if (f === undefined || f.handle === 0) return null;
    const rec = ctx.bb.units.get(f.handle);
    if (rec === undefined) return null;
    if (at.startsWith('upgrade:') && rec.upgradingTo < 0) return null;
    return rec;
  }

  // ---- factories --------------------------------------------------------------------------------

  private loopBps(plan: FactoryPlan, fac: AiBlueprint): number[] {
    const out: number[] = [];
    for (const it of plan.loop) {
      const bp = this.sh.roles.bestFor(it.role, it.tech, fac);
      if (bp !== null) out.push(bp.index);
    }
    return out;
  }

  private produceBp(role: string, tech: number, fac: AiBlueprint): AiBlueprint | null {
    const sh = this.sh;
    const t = role === ROLE.eng ? Math.max(1, fac.tech) : tech;
    const bp = sh.roles.tryResolve(role, t) ?? sh.roles.tryResolve(role, tech);
    return bp !== null && sh.static.bps.canBuild(fac, bp) ? bp : null;
  }

  private factoryRole(slot: string): string {
    for (const s of this.acuSteps) if (s.plan.at === `slot:${slot}`) return s.plan.role;
    for (const p of this.engPlans) for (const s of p) if (s.at === `slot:${slot}`) return s.role;
    return slot === 'fac_air' ? ROLE.facAir : ROLE.facLand;
  }

  private factories(ctx: ManagerContext): boolean {
    const bb = ctx.bb;
    const window = confirmTicks(ctx.profile.lead, ctx.profile.thinkEvery);
    // Attribute new units to opening factories (production tracking for pull-forward).
    const scanFrom = this.lastScanTick;
    for (const list of [bb.units.army, bb.units.engineers]) {
      for (const u of list) {
        if (u.firstSeenTick <= scanFrom) continue;
        if (!ctx.budget.take(1)) return false;
        let best: FacState | null = null;
        let bestD = SPAWN_ATTRIBUTION_WU * SPAWN_ATTRIBUTION_WU;
        for (const f of this.facs) {
          if (f.handle === 0 || f.handedOff) continue;
          const fr = bb.units.get(f.handle);
          if (fr === undefined) continue;
          const d = (fr.x - u.x) * (fr.x - u.x) + (fr.z - u.z) * (fr.z - u.z);
          if (d <= bestD) {
            best = f;
            bestD = d;
          }
        }
        if (best === null) continue;
        const i = best.remaining.indexOf(u.bp);
        if (i >= 0) best.remaining.splice(i, 1);
      }
    }
    this.lastScanTick = ctx.tick;
    for (const f of this.facs) {
      if (f.handedOff) continue;
      if (!ctx.budget.take(1)) return false;
      if (f.handle === 0) {
        const rec = this.findFactory(ctx, f.plan.slot);
        if (rec === null) continue;
        if (!this.bindFactory(ctx, f, rec)) return false;
        continue;
      }
      const rec = bb.units.get(f.handle);
      if (rec === undefined) {
        f.handedOff = true;
        continue;
      }
      if (bb.reservations.unitOwner(f.handle) !== OPENING_OWNER) continue;
      const loopRunning = f.remaining.length === 0 && rec.factoryRepeat;
      if (loopRunning || ctx.tick >= OPENING_DEADLINE_TICK) {
        this.handoffFactory(ctx, f);
        continue;
      }
      if (ctx.tick > f.issuedTick + window && rec.factoryBp < 0 && !rec.factoryRepeat && rec.upgradingTo < 0) {
        // The setup never showed up (APM drop): issue it again.
        if (!this.bindFactory(ctx, f, rec)) return false;
      }
    }
    return true;
  }

  private findFactory(ctx: ManagerContext, slot: string): OwnRecord | null {
    const sh = this.sh;
    const role = this.factoryRole(slot);
    const pos = slotPosition({ sh, view: ctx.view, tick: ctx.tick, budget: ctx.budget }, slot);
    if (pos === null) return null;
    let best: OwnRecord | null = null;
    let bestD = 12 * 12;
    for (const f of ctx.bb.units.factories) {
      if (!sh.roles.isRole(f.blueprint, role)) continue;
      if (this.facs.some((x) => x.handle === f.handle)) continue;
      const owner = ctx.bb.reservations.unitOwner(f.handle);
      if (owner !== undefined && owner !== OPENING_OWNER) continue;
      const d = (f.x - pos.x) * (f.x - pos.x) + (f.z - pos.z) * (f.z - pos.z);
      if (d <= bestD) {
        best = f;
        bestD = d;
      }
    }
    return best;
  }

  private rallyPoint(plan: FactoryPlan, ctx: ManagerContext): Vec2 {
    const a = this.sh.analysis;
    if (plan.rally === null || plan.rally === 'slot:rally') return a.rally;
    if (plan.rally.startsWith('slot:')) {
      const p = slotPosition({ sh: this.sh, view: ctx.view, tick: ctx.tick, budget: ctx.budget }, plan.rally.slice(5));
      if (p !== null) return p;
    }
    return a.rally;
  }

  private bindFactory(ctx: ManagerContext, f: FacState, rec: OwnRecord): boolean {
    const bb = ctx.bb;
    const plan = f.plan;
    const fac = rec.blueprint;
    const entries: { bp: number; count: number }[] = [];
    for (const p of plan.produce) {
      const bp = this.produceBp(p.role, p.tech, fac);
      if (bp !== null) entries.push({ bp: bp.index, count: p.count });
    }
    const loop = this.loopBps(plan, fac);
    const rally = this.rallyPoint(plan, ctx);
    return ctx.step(() => {
      ctx.emitter.group(() => {
        ctx.emitter.setRally([rec.handle], rally.x, rally.z, Prio.P3, { source: OPENING_OWNER });
        entries.forEach((e, k) => ctx.emitter.factoryQueue(rec.handle, e.bp, e.count, Prio.P3, { source: OPENING_OWNER, queue: k > 0 }));
        if (loop.length > 0) ctx.emitter.factoryRepeat(rec.handle, loop, Prio.P3, { source: OPENING_OWNER });
      });
      return () => {
        if (f.handle === 0) bb.reservations.claimUnit(rec.handle, OPENING_OWNER);
        f.handle = rec.handle;
        f.issuedTick = ctx.tick;
        const rem: number[] = [];
        for (const e of entries) for (let i = 0; i < e.count; i++) rem.push(e.bp);
        f.remaining = rem;
        f.loopBps = loop;
      };
    });
  }

  // ---- handoff ------------------------------------------------------------------------------------

  private handoffAcu(ctx: ManagerContext): void {
    const bb = ctx.bb;
    if (bb.opening.handedOffAcu) return;
    bb.reservations.handoverAcu(OPENING_OWNER, 'engineer', ctx.tick);
    bb.opening.handedOffAcu = true;
    for (const s of this.acuSteps) {
      if (s.ringSpot >= 0 && s.status !== 'issued') {
        const r = bb.reservations.spotReservation(s.ringSpot);
        if (r !== undefined && r.owner === ACU_PLAN_OWNER && r.holder === 0) bb.reservations.releaseSpot(s.ringSpot);
      }
    }
    bb.telemetry.push({ kind: 'handoff', tick: ctx.tick, what: 'acu', unit: bb.units.commander?.handle ?? 0 });
  }

  private handoffEngineer(ctx: ManagerContext, ep: EngPlan): void {
    const bb = ctx.bb;
    if (ep.job !== null) releasePlacement(this.sh, ep.job.place.key, ep.job.place.spot, ep.handle);
    ep.job = null;
    ep.handedOff = true;
    bb.reservations.releaseUnit(ep.handle, OPENING_OWNER);
    bb.opening.handedOffEngineers.push(ep.handle);
    bb.telemetry.push({ kind: 'handoff', tick: ctx.tick, what: 'engineer', unit: ep.handle });
  }

  private handoffFactory(ctx: ManagerContext, f: FacState): void {
    const bb = ctx.bb;
    f.handedOff = true;
    bb.reservations.releaseUnit(f.handle, OPENING_OWNER);
    bb.opening.handedOffFactories.push(f.handle);
    bb.telemetry.push({ kind: 'handoff', tick: ctx.tick, what: 'factory', unit: f.handle });
  }

  // ---- publication / end ------------------------------------------------------------------------

  /** Pending Glutkessel power of the next two steps of every opening builder (energy balance inflight). */
  private publish(ctx: ManagerContext): void {
    const sh = this.sh;
    let e = 0;
    let estore = false;
    const count = (plan: PlanStep): void => {
      if (plan.kind !== 'build' || plan.skip) return;
      const bp = sh.roles.tryResolve(plan.role, plan.tech);
      if (bp === null) return;
      // Only Glutkessel steps count (ecosim `pgen_inflight`: plan steps with role pgen); a hydro step
      // may lie far outside and would block the balance for minutes (tai-p5 calibration).
      if (sh.flags.pgen[bp.index] === 1) e += bp.energyPerSec;
      if (sh.flags.estore[bp.index] === 1) estore = true;
    };
    if (!ctx.bb.opening.handedOffAcu) {
      let n = 0;
      for (const s of this.acuSteps) {
        if (s.status !== 'pending' && s.status !== 'issued') continue;
        if (s.ref !== null && s.ref.siteHandle !== 0) continue;
        if (n < 2) count(s.plan);
        else if (s.plan.role === ROLE.estore) estore = true;
        n++;
      }
    }
    for (const ep of this.engineers) {
      if (ep.handedOff) continue;
      const from = ep.job !== null && ep.job.ref.siteHandle !== 0 ? ep.idx + 1 : ep.idx;
      for (let i = from; i < Math.min(ep.steps.length, ep.idx + 2); i++) count(ep.steps[i]!);
    }
    sh.openingPendingPowerE = e;
    sh.openingPendingEstore = estore;
  }

  /**
   * The opening ends when the commander, every plan engineer and every factory are handed over
   * (an opening factory that never got built stops counting at 5:00). Plans without an engineer
   * lapse once no opening factory produces any more.
   */
  private checkFinished(ctx: ManagerContext): void {
    const bb = ctx.bb;
    if (!bb.opening.handedOffAcu) return;
    if (this.engineers.some((e) => !e.handedOff)) return;
    if (this.facs.some((f) => !f.handedOff && (f.handle !== 0 || ctx.tick < OPENING_DEADLINE_TICK))) return;
    this.finish(ctx);
  }

  private finish(ctx: ManagerContext): void {
    this.finished = true;
    ctx.bb.opening.active = false;
    this.sh.openingPendingPowerE = 0;
    this.sh.openingPendingEstore = false;
    ctx.bb.opening.localDefense = false;
    for (const f of this.facs) if (!f.handedOff) f.handedOff = true;
  }
}
