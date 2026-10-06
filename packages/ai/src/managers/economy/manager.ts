/**
 * EconomyManager (ai.md §5.1, 1 Hz; A1 MS9, A9 MS10). Runs from the first think; during the opening
 * it only orders through the task board and touches the commander queue only in an energy
 * emergency (via `BuildShared.acuFrontTask`, taken by the OpeningRunner or EngineerManager).
 *
 * Every economy second:
 * 1. R_E decays by 10 %; decided-but-not-started sinks (factory tasks) are pruned (R-03).
 * 2. Energy balance → power tasks (prio 90): Glutkessel II (3 builders) with a T2 engineer and
 *    deficit ≥ 150, else n = ⌈deficit / 20⌉ − running generators (≤ maxInflight + ⌊(P_E − U_E)/100⌋),
 *    placed Kranz → eco ring → next to factories; a free hydro with an engineer within 120 WU goes
 *    first. Glutspeicher at estore.atS (prio 70); afterwards the next 4 Glutkessel I on its sides.
 * 3. Energy emergency (storage empty within 10 s): the oldest unassigned power task goes to the
 *    front of the commander queue (prio 100).
 * 4. Scheduled mex upgrades (nearestBase, maxParallel; saturation rule R-01: no free own spot and
 *    t ≥ saturatedS ⇒ also during the tech upgrade, then at most one), only with lifetime >
 *    1.2 × amortisation and E_free ≥ 60 ("Energie zuerst", R-02; otherwise only R_E is booked).
 * 5. Mass sinks: S_M/C_M ≥ massStoreFrac for forS ⇒ distribute the measured surplus minus decided
 *    sinks over the table (mex upgrade, extra factory, factory I→II, +1 engineer), ≤ 4 per second.
 * 6. Expansion: mex tasks (prio 50, `mex:next`, the EngineerManager picks the spot by score per
 *    builder) and one hydro task (prio 45).
 */
import type { OwnRecord } from '../../blackboard.ts';
import type { Manager, ManagerContext, ManagerInitContext } from '../../brain.ts';
import { Prio } from '../../commands/emitter.ts';
import { horizonFor } from '../../profile.ts';
import { TaskPrio, type Task } from '../../taskboard.ts';
import type { EcoState } from '../../types.ts';
import { confirmTicks } from '../engineer/jobs.ts';
import { estorePosition } from '../engineer/placement.ts';
import {
  HYDRO_ENGINEER_WU,
  ROLE,
  TASK_ROLE_ENGINEERS_ONLY,
  buildShared,
  type BuildShared,
} from '../engineer/shared.ts';
import { contestedAllowed, countFreeSpots } from '../engineer/spots.ts';
import {
  EMERGENCY_WITHIN_S,
  ENGINEER_BONUS_MAX,
  SINK,
  SINK_ACTIONS_PER_SECOND,
  energyBalance,
  energyFree,
  mexLifetimeS,
  powerToOrder,
  upgradeAmortisationS,
  worthUpgrading,
} from './balance.ts';

export const ECONOMY_OWNER = 'economy';
/** Glutkessel II from this deficit on (ai.md §5.1). */
export const PGEN2_MIN_DEFICIT = 150;
export const PGEN2_BUILDERS = 3;
/** An unassigned Glutkessel II task older than this no longer blocks Glutkessel I orders. */
export const PGEN2_STUCK_TICKS = 200;
/** An unassigned power task goes to the commander after 5 s in an emergency (ecosim PREEMPT_PGEN_S). */
export const EMERGENCY_TASK_AGE_TICKS = 50;
/** Contact memory of a mex for the lifetime rule (120 s). */
export const MEX_CONTACT_TICKS = 1200;
/** Kranz: up to 4 Glutkessel I around the storage. */
export const KRANZ_PLACES = 4;
/** History of the mass surplus (seconds kept). */
const HIST_MAX = 120;

export class EconomyManager implements Manager {
  readonly name = 'economy' as const;
  readonly budgetKey = 'economy' as const;
  private readonly sh: BuildShared;
  private lastRunTick = -1;
  private readonly hist: number[] = [];
  private fullSince = -1;
  private readonly pendingUpgrades = new Map<number, number>();
  private readonly mexContact = new Map<number, number>();
  private mexCursor = 0;
  private seq = 0;
  private readonly spotAt = new Map<number, number>();
  private readonly massPerE: number;
  private readonly pgenEps: number;
  private readonly ownMaxT1: number;

  constructor(init: ManagerInitContext) {
    this.sh = buildShared(init);
    const sh = this.sh;
    for (const sp of sh.static.spots) this.spotAt.set(spotKey(sp.x, sp.z), sp.index);
    const pgen = sh.bp(ROLE.pgen, 1);
    this.pgenEps = pgen.energyPerSec > 0 ? pgen.energyPerSec : 20;
    this.massPerE = pgen.mass / this.pgenEps;
    // ai.md §5.2: max. T1 income of the own zone = commander + T1 mex × own mass spots.
    let own = 0;
    for (const si of sh.analysis.spots) if (si.kind === 'mass' && si.zone === 'own') own++;
    let acuMps = 0;
    for (const b of sh.static.bps.list) if (sh.flags.commander[b.index] === 1) acuMps = Math.max(acuMps, b.massPerSec);
    this.ownMaxT1 = acuMps + sh.bp(ROLE.mex, 1).massPerSec * own;
  }

  /** Mass surplus history (tests). */
  get surplusHistory(): readonly number[] {
    return this.hist;
  }

  think(ctx: ManagerContext): void {
    const sh = this.sh;
    const bb = ctx.bb;
    const tick = ctx.tick;
    const eco = ctx.view.eco();
    const take = (n: number): boolean => ctx.budget.take(n);
    if (!sh.ensureIndex(take)) return;
    const secs = this.lastRunTick < 0 ? 1 : Math.max(1, Math.min(10, Math.round((tick - this.lastRunTick) / 10)));
    this.lastRunTick = tick;
    // 1. bookkeeping
    for (let i = 0; i < secs; i++) bb.eco.decayOneSecond();
    bb.eco.sinks = bb.eco.sinks.filter((s) => {
      const t = bb.taskBoard.get(s.taskId);
      return t !== undefined && (t.state === 'open' || t.state === 'assigned') && t.siteHandle === 0;
    });
    const consumption = eco.massDemand * eco.massRatio;
    for (let i = 0; i < secs; i++) this.hist.push(eco.massIncome - consumption);
    if (this.hist.length > HIST_MAX) this.hist.splice(0, this.hist.length - HIST_MAX);
    const frac = eco.massCapacity > 0 ? eco.massStored / eco.massCapacity : 0;
    if (frac >= sh.opening.followUp.extraFactory.massStoreFrac) {
      if (this.fullSince < 0) this.fullSince = tick;
    } else this.fullSince = -1;
    this.confirmUpgrades(ctx);

    const fu = sh.opening.followUp;
    const horizon = horizonFor(ctx.profile, fu.energy.horizonS);
    const bal = energyBalance(eco, bb.eco.reservedE, fu.energy.reserveE, horizon);
    bb.eco.deficitE = bal.deficit;
    bb.eco.energyEmptyInS = bal.emptyInS;
    bb.eco.emergency = bal.emptyInS <= EMERGENCY_WITHIN_S;

    if (!this.power(ctx, eco, bal.deficit)) return;
    if (!this.storage(ctx)) return;
    if (!this.emergency(ctx)) return;
    if (!this.scanMex(ctx)) return;
    if (!this.scheduledMexUpgrade(ctx, eco)) return;
    if (!this.massSinks(ctx, eco)) return;
    this.expansion(ctx);
  }

  // ---- energy ------------------------------------------------------------------------------------

  private liveTasks(ctx: ManagerContext, pred: (t: Task) => boolean): Task[] | null {
    const all = ctx.bb.taskBoard.ordered();
    if (!ctx.budget.take(all.length)) return null;
    return all.filter(pred);
  }

  private power(ctx: ManagerContext, eco: EcoState, deficit: number): boolean {
    const sh = this.sh;
    const bb = ctx.bb;
    const flags = sh.flags;
    if (!(deficit > 0)) return true;
    const sites = bb.units.sites;
    if (!ctx.budget.take(sites.length)) return false;
    // Running power in ecosim `pgen_inflight` semantics (tai-p5 calibration): every power site and
    // every decided, unstarted power task counts as ONE plant, whatever its output. Counting a hydro
    // task as 5 Glutkessel (its E/s) or a Glutkessel II task as 25 blocked all other power orders
    // until that single, far-away or slow build was done — the storage ran empty meanwhile (Setons
    // 8.7 % stall without an enemy). Opening steps keep their Glutkessel equivalents.
    let inflight = Math.ceil(sh.openingPendingPowerE / this.pgenEps - 1e-9);
    let t2Inflight = 0;
    // A Glutkessel II that nobody works on (task unassigned for PGEN2_STUCK_TICKS, e.g. the only T2
    // engineer died) must not block the T1 route (tai-p5: stall after raids in the late game).
    let t2Progressing = 0;
    for (const s of sites) {
      if (flags.power[s.bp] !== 1) continue;
      inflight++;
      if (s.blueprint.tech >= 2 && flags.pgen[s.bp] === 1) {
        t2Inflight++;
        t2Progressing++;
      }
    }
    const tasks = this.liveTasks(ctx, (t) => t.kind === 'build' && (t.role === ROLE.pgen || t.role === ROLE.hydro));
    if (tasks === null) return false;
    for (const t of tasks) {
      // Only power decided by the balance counts as running (the prio-45 hydro expansion may never
      // be reached; ecosim `pgen_inflight` counts board power plants only).
      if (t.siteHandle !== 0 || t.prio < TaskPrio.power) continue;
      inflight++;
      if (t.role === ROLE.pgen && t.tech >= 2) {
        t2Inflight++;
        if (t.assigned.length > 0 || ctx.tick - t.createdTick < PGEN2_STUCK_TICKS) t2Progressing++;
      }
    }
    const t2Eng = bb.units.engineers.some((e) => e.blueprint.tech >= 2);
    const tick = ctx.tick;
    if (t2Eng && deficit >= PGEN2_MIN_DEFICIT && (t2Inflight === 0 || t2Progressing > 0)) {
      if (t2Inflight > 0) return true;
      return ctx.step(() => () => {
        bb.taskBoard.add(
          { kind: 'build', role: ROLE.pgen, tech: 2, site: 'slot:eco', prio: TaskPrio.power, wanted: PGEN2_BUILDERS, source: ECONOMY_OWNER, key: `power2:${this.seq++}` },
          tick,
        );
      });
    }
    // Scale of the cap: the larger of net income and the actual (mass-throttled) demand (tai-p5
    // calibration): with the income as the only scale, a demand jump of +300 E/s at 8 min (T2
    // factory, mex upgrades, extra factories) was answered with 4 Glutkessel at a time and the 13.900-E
    // storage ran dry (Setons eco_standard 13 % stall without an enemy).
    const scale = Math.max(eco.energyIncome - eco.energyUpkeep, eco.energyDemand * eco.massRatio);
    let n = powerToOrder(deficit, this.pgenEps, inflight, sh.opening.followUp.energy.maxInflight, scale);
    if (n <= 0) return true;
    // Hydro first when an engineer stands within 120 WU (ai.md §5.1).
    const hydro = this.hydroCandidate(ctx, tasks);
    if (hydro === 'budget') return false;
    const kranzFree = this.kranzFree(ctx, tasks);
    return ctx.step(() => () => {
      if (hydro !== null) {
        bb.taskBoard.add(
          { kind: 'build', role: ROLE.hydro, tech: 1, site: `spot:${hydro}`, spot: hydro, prio: TaskPrio.power, wanted: 1, source: ECONOMY_OWNER, key: `hydro:${hydro}` },
          tick,
        );
        n -= 1;
      }
      let kranz = kranzFree;
      for (let i = 0; i < n; i++) {
        const site = kranz > 0 ? 'kranz' : 'slot:eco';
        if (kranz > 0) kranz--;
        bb.taskBoard.add(
          { kind: 'build', role: ROLE.pgen, tech: 1, site, prio: TaskPrio.power, wanted: 1, source: ECONOMY_OWNER, key: `power:${this.seq++}` },
          tick,
        );
      }
    });
  }

  /** Free own hydro spot with an engineer within 120 WU and no task yet (spot index), else null. */
  private hydroCandidate(ctx: ManagerContext, tasks: readonly Task[]): number | null | 'budget' {
    const sh = this.sh;
    const list = ctx.view.freeHydroSpots();
    if (!ctx.budget.take(list.length)) return 'budget';
    const engs = ctx.bb.units.engineers;
    let best = -1;
    let bestD = Infinity;
    for (const sp of list) {
      const info = sh.analysis.spots[sp.index]!;
      if (info.zone !== 'own') continue;
      if (!ctx.bb.reservations.isSpotAvailable(sp.index, ctx.tick)) continue;
      if (tasks.some((t) => t.spot === sp.index || t.site === `spot:${sp.index}`)) continue;
      if (!ctx.budget.take(engs.length)) return 'budget';
      let near = false;
      for (const e of engs) {
        const dx = e.x - sp.x;
        const dz = e.z - sp.z;
        if (dx * dx + dz * dz <= HYDRO_ENGINEER_WU * HYDRO_ENGINEER_WU) {
          near = true;
          break;
        }
      }
      if (!near) continue;
      if (info.dOwn < bestD || (info.dOwn === bestD && sp.index < best)) {
        best = sp.index;
        bestD = info.dOwn;
      }
    }
    return best < 0 ? null : best;
  }

  /** Free Glutkranz places: 4 − own Glutkessel I on the storage sides − open kranz tasks. */
  private kranzFree(ctx: ManagerContext, tasks: readonly Task[]): number {
    const sh = this.sh;
    let hasStore = false;
    for (const s of ctx.bb.units.structures) if (sh.flags.estore[s.bp] === 1) hasStore = true;
    if (!hasStore) return 0;
    const p = estorePosition({ sh, view: ctx.view, tick: ctx.tick, budget: ctx.budget });
    if (p === null) return 0;
    const pgen = sh.bp(ROLE.pgen, 1);
    const gap = (sh.bp(ROLE.estore, 1).footprint[0] + pgen.footprint[0]) / 2;
    let used = 0;
    for (const s of ctx.bb.units.structures) {
      if (s.bp !== pgen.index) continue;
      const dx = Math.abs(s.x - p.x);
      const dz = Math.abs(s.z - p.z);
      if ((Math.abs(dx - gap) <= 0.5 && dz <= 0.5) || (Math.abs(dz - gap) <= 0.5 && dx <= 0.5)) used++;
    }
    for (const t of tasks) if (t.site === 'kranz') used++;
    return Math.max(0, KRANZ_PLACES - used);
  }

  /** Glutspeicher from estore.atS (prio 70), unless the opening builds one. */
  private storage(ctx: ManagerContext): boolean {
    const sh = this.sh;
    const bb = ctx.bb;
    if (ctx.tick / 10 < sh.opening.followUp.estore.atS || sh.openingPendingEstore) return true;
    for (const s of bb.units.structures) if (sh.flags.estore[s.bp] === 1) return true;
    if (bb.taskBoard.byKey('estore') !== undefined) return true;
    const tick = ctx.tick;
    return ctx.step(() => () => {
      bb.taskBoard.add({ kind: 'build', role: ROLE.estore, tech: 1, site: 'slot:estore', prio: TaskPrio.storage, wanted: 1, source: ECONOMY_OWNER, key: 'estore' }, tick);
    });
  }

  /** Storage empty within 10 s ⇒ the oldest unassigned power task to the front of the commander. */
  private emergency(ctx: ManagerContext): boolean {
    const sh = this.sh;
    const bb = ctx.bb;
    if (!bb.eco.emergency || sh.acuFrontTask !== 0) return true;
    const tasks = this.liveTasks(
      ctx,
      // Only Glutkessel of the energy balance (ecosim: role pgen); a hydro may be far outside the base.
      (t) => t.kind === 'build' && t.state === 'open' && t.role === ROLE.pgen && t.prio >= TaskPrio.power && ctx.tick - t.createdTick >= EMERGENCY_TASK_AGE_TICKS,
    );
    if (tasks === null) return false;
    let oldest: Task | null = null;
    for (const t of tasks) if (oldest === null || t.createdTick < oldest.createdTick || (t.createdTick === oldest.createdTick && t.id < oldest.id)) oldest = t;
    if (oldest === null) return true;
    const task = oldest;
    return ctx.step(() => () => {
      task.prio = TaskPrio.energyEmergency;
      sh.acuFrontTask = task.id;
    });
  }

  // ---- mex upgrades --------------------------------------------------------------------------------

  /** Own complete mex: contact memory (T_surface > 0 within the last 120 s), cursor-based. */
  private scanMex(ctx: ManagerContext): boolean {
    const sh = this.sh;
    const list = ctx.bb.units.structures;
    if (this.mexCursor >= list.length) this.mexCursor = 0;
    for (let i = this.mexCursor; i < list.length; i++) {
      const s = list[i]!;
      if (sh.flags.mex[s.bp] !== 1) continue;
      if (!ctx.budget.take(2)) {
        this.mexCursor = i;
        return false;
      }
      if (ctx.bb.threat.threatAt('surface', s.x, s.z) > 0) this.mexContact.set(s.handle, ctx.tick);
    }
    this.mexCursor = 0;
    for (const h of [...this.mexContact.keys()]) if (ctx.bb.units.get(h) === undefined) this.mexContact.delete(h);
    return true;
  }

  private confirmUpgrades(ctx: ManagerContext): void {
    const window = confirmTicks(ctx.profile.lead, ctx.profile.thinkEvery);
    for (const [h, t] of [...this.pendingUpgrades]) {
      const u = ctx.bb.units.get(h);
      if (u === undefined || u.upgradingTo >= 0 || u.blueprint.upgradeFrom >= 0 || ctx.tick > t + window) this.pendingUpgrades.delete(h);
    }
  }

  private runningMexUpgrades(ctx: ManagerContext): number {
    let n = 0;
    for (const s of ctx.bb.units.structures) if (this.sh.flags.mex[s.bp] === 1 && s.upgradingTo >= 0) n++;
    for (const h of this.pendingUpgrades.keys()) {
      const u = ctx.bb.units.get(h);
      if (u !== undefined && u.upgradingTo < 0) n++;
    }
    return n;
  }

  /** Spot index under a structure (−1 if none). */
  private spotOf(s: OwnRecord): number {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const i = this.spotAt.get(spotKey(s.x + dx, s.z + dz));
        if (i === undefined) continue;
        const sp = this.sh.static.spots[i]!;
        if (Math.abs(sp.x - s.x) <= 1 && Math.abs(sp.z - s.z) <= 1) return i;
      }
    }
    return -1;
  }

  /**
   * Best mex to upgrade: T1 mex (T2→T3 is MS13), complete, not upgrading, lifetime > 1.2 ×
   * amortisation; order nearestBase (smallest d_own, then spot index).
   */
  mexUpgradeCandidate(ctx: ManagerContext, exclude: ReadonlySet<number> | null = null): OwnRecord | null {
    const sh = this.sh;
    let best: OwnRecord | null = null;
    let bestD = Infinity;
    let bestSpot = -1;
    for (const s of ctx.bb.units.structures) {
      if (sh.flags.mex[s.bp] !== 1 || !s.complete || s.upgradingTo >= 0 || s.blueprint.tech !== 1) continue;
      if (s.blueprint.upgradesTo < 0 || this.pendingUpgrades.has(s.handle) || exclude?.has(s.handle) === true) continue;
      const spot = this.spotOf(s);
      if (spot < 0) continue;
      const info = sh.analysis.spots[spot]!;
      const last = this.mexContact.get(s.handle);
      const contact = last !== undefined && ctx.tick - last <= MEX_CONTACT_TICKS;
      const to = sh.static.bps.list[s.blueprint.upgradesTo]!;
      if (!worthUpgrading(mexLifetimeS(info.zone, contact), upgradeAmortisationS(s.blueprint, to, this.massPerE))) continue;
      if (info.dOwn < bestD || (info.dOwn === bestD && spot < bestSpot)) {
        best = s;
        bestD = info.dOwn;
        bestSpot = spot;
      }
    }
    return best;
  }

  /** No free (unreserved) mass spot of the own zone left (ai.md §5.1 Sättigung). */
  private saturated(ctx: ManagerContext): boolean {
    for (const sp of ctx.view.freeMassSpots()) {
      const info = this.sh.analysis.spots[sp.index]!;
      if (info.zone === 'own' && ctx.bb.reservations.isSpotAvailable(sp.index, ctx.tick)) return false;
    }
    return true;
  }

  private saturatedForUpgrade(ctx: ManagerContext): boolean {
    const mu = this.sh.opening.followUp.mexUpgrade;
    return ctx.tick / 10 >= mu.saturatedS + ctx.profile.timing.techDelayS && this.saturated(ctx);
  }

  private startMexUpgrade(ctx: ManagerContext, mex: OwnRecord): void {
    const sh = this.sh;
    const bb = ctx.bb;
    const to = mex.blueprint.upgradesTo;
    const tick = ctx.tick;
    const mu = sh.opening.followUp.mexUpgrade;
    ctx.emitter.upgrade(mex.handle, to, Prio.P2, { source: ECONOMY_OWNER });
    this.pendingUpgrades.set(mex.handle, tick);
    bb.telemetry.push({ kind: 'mexUpgradeStart', tick, unit: mex.handle });
    if (mu.assistEngineers > 0) {
      bb.taskBoard.add(
        {
          kind: 'assist',
          role: TASK_ROLE_ENGINEERS_ONLY,
          builders: 'engineers',
          target: mex.handle,
          prio: TaskPrio.mexUpgradeAssist,
          wanted: mu.assistEngineers,
          source: ECONOMY_OWNER,
          key: `mexup:${mex.handle}`,
        },
        tick,
      );
    }
  }

  /** Time/income-triggered mex upgrades (ecosim `tech_manager` second half, ai.md §5.1/§5.2). */
  private scheduledMexUpgrade(ctx: ManagerContext, eco: EcoState): boolean {
    const sh = this.sh;
    const bb = ctx.bb;
    const mu = sh.opening.followUp.mexUpgrade;
    const t = ctx.tick / 10;
    const delay = ctx.profile.timing.techDelayS;
    if (!ctx.budget.take(bb.units.structures.length + ctx.view.freeMassSpots().length)) return false;
    const sat = this.saturatedForUpgrade(ctx);
    if ((t < mu.minS + delay && !sat) || eco.massIncome < Math.min(mu.minMassIncome, 0.9 * this.ownMaxT1)) return true;
    const teching = bb.tech.upgrading;
    if (teching && !sat) return true;
    const limit = teching ? 1 : mu.maxParallel;
    if (this.runningMexUpgrades(ctx) >= limit) return true;
    const cand = this.mexUpgradeCandidate(ctx);
    if (cand === null) return true;
    const fu = sh.opening.followUp;
    if (energyFree(eco, bb.eco.reservedE, fu.energy.reserveE) < SINK.mexUpgrade.energy) {
      return ctx.step(() => () => {
        bb.eco.reservedE = Math.max(bb.eco.reservedE, SINK.mexUpgrade.energy);
      });
    }
    return ctx.step(() => {
      this.startMexUpgrade(ctx, cand);
      return () => {
        bb.eco.reserve(SINK.mexUpgrade.energy);
      };
    });
  }

  // ---- mass sinks --------------------------------------------------------------------------------

  private factoryCount(ctx: ManagerContext, tasks: readonly Task[]): number {
    let n = 0;
    for (const s of ctx.bb.units.structures) if (this.sh.flags.landFactory[s.bp] === 1) n++;
    for (const t of tasks) if (t.kind === 'build' && t.role === ROLE.facLand && t.siteHandle === 0) n++;
    return n;
  }

  /** Next free factory slot: extraFactory.slots, then fac4, fac5, … (13-WU grid behind the base). */
  private nextFactorySlot(ctx: ManagerContext, tasks: readonly Task[], taken: ReadonlySet<string>): string | null {
    const sh = this.sh;
    const names = [...sh.opening.followUp.extraFactory.slots];
    for (let n = 4; n <= 23; n++) names.push(`fac${n}`);
    for (const name of names) {
      if (taken.has(name) || sh.slotActual.has(name)) continue;
      if (tasks.some((t) => t.site === `slot:${name}`)) continue;
      if (!ctx.bb.reservations.isSiteAvailable(`slot:${name}`, ctx.tick)) continue;
      const m = /^fac(\d+)$/.exec(name);
      const p = m !== null ? sh.analysis.factorySlot(Number(m[1])) : sh.analysis.slots[name];
      if (p === undefined) continue;
      let used = false;
      for (const f of ctx.bb.units.structures) {
        if (sh.flags.factory[f.bp] !== 1) continue;
        if (Math.abs(f.x - p.x) <= 6 && Math.abs(f.z - p.z) <= 6) used = true;
      }
      if (!used) return name;
    }
    return null;
  }

  private massSinks(ctx: ManagerContext, eco: EcoState): boolean {
    const sh = this.sh;
    const bb = ctx.bb;
    const fu = sh.opening.followUp;
    const ef = fu.extraFactory;
    const mu = fu.mexUpgrade;
    const t = ctx.tick / 10;
    if (t < ef.minS || this.fullSince < 0 || ctx.tick - this.fullSince < ef.forS * 10) return true;
    const tasks = this.liveTasks(ctx, () => true);
    if (tasks === null) return false;
    if (!ctx.budget.take(bb.units.structures.length)) return false;
    const n = Math.min(this.hist.length, Math.max(1, Math.round(ef.forS)));
    let sum = 0;
    for (let i = this.hist.length - n; i < this.hist.length; i++) sum += this.hist[i]!;
    let surplus = sum / n - bb.eco.sinkMass;
    let eFree = energyFree(eco, bb.eco.reservedE, fu.energy.reserveE);
    const teching = bb.tech.upgrading;
    const sat = this.saturatedForUpgrade(ctx);
    const pm = eco.massIncome;
    type Action =
      | { readonly kind: 'mexUpgrade'; readonly mex: OwnRecord }
      | { readonly kind: 'factory'; readonly slot: string }
      | { readonly kind: 'factoryUpgrade'; readonly fac: OwnRecord }
      | { readonly kind: 'engineer' }
      | { readonly kind: 'reserve'; readonly energy: number };
    const actions: Action[] = [];
    const takenSlots = new Set<string>();
    const upgraded = new Set<number>();
    let running = this.runningMexUpgrades(ctx);
    let factories = this.factoryCount(ctx, tasks);
    let bonus = sh.engineerBonus;
    let count = 0;
    while (surplus > 1 && count < SINK_ACTIONS_PER_SECOND) {
      count++;
      // 1. Mex upgrade (nearest base first).
      const mexLimit = teching ? (sat ? 1 : 0) : 1 + Math.floor(pm / 15);
      if ((t >= mu.minS || bb.tech.level >= 2 || sat) && running < mexLimit) {
        const cand = this.mexUpgradeCandidate(ctx, upgraded);
        if (cand !== null) {
          if (eFree < SINK.mexUpgrade.energy) {
            actions.push({ kind: 'reserve', energy: SINK.mexUpgrade.energy });
            break;
          }
          actions.push({ kind: 'mexUpgrade', mex: cand });
          upgraded.add(cand.handle);
          running++;
          eFree -= SINK.mexUpgrade.energy;
          surplus -= SINK.mexUpgrade.mass;
          continue;
        }
      }
      // 2. Extra land factory.
      if (factories < 1 + Math.floor(pm / 6)) {
        const slot = this.nextFactorySlot(ctx, tasks, takenSlots);
        if (slot !== null) {
          takenSlots.add(slot);
          factories++;
          actions.push({ kind: 'factory', slot });
          surplus -= SINK.factory.mass;
          continue;
        }
      }
      // 3. Further land factory I → II (T2 reached).
      if (bb.tech.level >= 2) {
        const fac = this.t1LandFactory(ctx, upgraded);
        if (fac !== null) {
          if (eFree < SINK.factoryUpgrade.energy) {
            actions.push({ kind: 'reserve', energy: SINK.factoryUpgrade.energy });
            break;
          }
          actions.push({ kind: 'factoryUpgrade', fac });
          upgraded.add(fac.handle);
          eFree -= SINK.factoryUpgrade.energy;
          surplus -= SINK.factoryUpgrade.mass;
          continue;
        }
      }
      // 4. +1 engineer (at most +6 over the target); the rest overflows (APM).
      if (bonus >= ENGINEER_BONUS_MAX) break;
      bonus++;
      actions.push({ kind: 'engineer' });
      surplus -= SINK.engineer.mass;
    }
    const tick = ctx.tick;
    return ctx.step(() => {
      for (const a of actions) {
        if (a.kind === 'mexUpgrade') this.startMexUpgrade(ctx, a.mex);
        else if (a.kind === 'factoryUpgrade') {
          const to = a.fac.blueprint.upgradesTo;
          ctx.emitter.upgrade(a.fac.handle, to, Prio.P2, { source: ECONOMY_OWNER });
        }
      }
      return () => {
        for (const a of actions) {
          if (a.kind === 'reserve') bb.eco.reserve(a.energy);
          else if (a.kind === 'mexUpgrade') bb.eco.reserve(SINK.mexUpgrade.energy);
          else if (a.kind === 'factoryUpgrade') bb.eco.reserve(SINK.factoryUpgrade.energy);
          else if (a.kind === 'engineer') {
            sh.engineerBonus++;
            bb.eco.reserve(SINK.engineer.energy);
          } else {
            const task = bb.taskBoard.add(
              { kind: 'build', role: ef.role, tech: 1, site: `slot:${a.slot}`, prio: TaskPrio.factory, wanted: 1, source: ECONOMY_OWNER, key: `factory:${a.slot}` },
              tick,
            );
            bb.eco.addSink({ kind: 'factory', massPerSec: SINK.factory.mass, energyPerSec: SINK.factory.energy, taskId: task.id, tick });
            bb.eco.reserve(SINK.factory.energy);
          }
        }
        // A new distribution needs another full forS window (ecosim clears the history).
        this.fullSince = tick;
      };
    });
  }

  private t1LandFactory(ctx: ManagerContext, exclude: ReadonlySet<number>): OwnRecord | null {
    const sh = this.sh;
    let best: OwnRecord | null = null;
    for (const f of ctx.bb.units.factories) {
      if (sh.flags.landFactory[f.bp] !== 1 || f.blueprint.tech !== 1 || f.upgradingTo >= 0 || f.blueprint.upgradesTo < 0) continue;
      if (exclude.has(f.handle) || f.handle === ctx.bb.tech.upgradeHandle) continue;
      if (best === null || f.handle < best.handle) best = f;
    }
    return best;
  }

  // ---- expansion ---------------------------------------------------------------------------------

  /** Mex tasks (prio 50) = min(free spots, free engineers + 1); one hydro task (prio 45). */
  private expansion(ctx: ManagerContext): void {
    const sh = this.sh;
    const bb = ctx.bb;
    const take = (n: number): boolean => ctx.budget.take(n);
    const free = countFreeSpots(sh, ctx.view.freeMassSpots(), ctx.tick, contestedAllowed(sh, ctx.tick), take);
    if (free === null) return;
    const freeHydro = countFreeSpots(sh, ctx.view.freeHydroSpots(), ctx.tick, false, take);
    if (freeHydro === null) return;
    const tasks = this.liveTasks(ctx, (t) => t.key !== null && (t.key.startsWith('mex:') || t.key === 'hydro:next' || t.key.startsWith('hydro:')));
    if (tasks === null) return;
    let engineers = 0;
    for (const e of bb.units.engineers) if (bb.reservations.unitOwner(e.handle) === undefined || bb.reservations.unitOwner(e.handle) === 'engineer') engineers++;
    const mexTasks = tasks.filter((t) => t.key!.startsWith('mex:'));
    const want = Math.min(free, engineers + 1);
    const tick = ctx.tick;
    const cancel: number[] = [];
    if (mexTasks.length > want) {
      const open = mexTasks.filter((t) => t.state === 'open' && t.assigned.length === 0);
      open.sort((a, b) => b.createdTick - a.createdTick || b.id - a.id);
      for (let i = 0; i < Math.min(open.length, mexTasks.length - want); i++) cancel.push(open[i]!.id);
    }
    const add = Math.max(0, want - mexTasks.length);
    const hydroTask = freeHydro > 0 && !tasks.some((t) => t.key === 'hydro:next' || t.key!.startsWith('hydro:'));
    if (add === 0 && cancel.length === 0 && !hydroTask) return;
    ctx.step(() => () => {
      for (const id of cancel) bb.taskBoard.cancel(id);
      for (let i = 0; i < add; i++) {
        bb.taskBoard.add({ kind: 'build', role: ROLE.mex, tech: 1, site: 'mex:next', prio: TaskPrio.mex, wanted: 1, source: ECONOMY_OWNER, key: `mex:${this.seq++}` }, tick);
      }
      if (hydroTask) {
        bb.taskBoard.add({ kind: 'build', role: ROLE.hydro, tech: 1, site: 'hydro:next', prio: TaskPrio.hydro, wanted: 1, source: ECONOMY_OWNER, key: 'hydro:next' }, tick);
      }
    });
  }
}

function spotKey(x: number, z: number): number {
  return (Math.round(x) + 8) * 8192 + (Math.round(z) + 8);
}
