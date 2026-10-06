/**
 * TechManager (ai.md §5.2, 1 Hz): T1 → T2 by upgrading a land factory in place.
 *
 * Trigger: t ≥ techT2.minS + techDelayS, P_M ≥ min(minMassIncome, 0.8 × max. T1 income of the own
 * zone), energy surplus P_E − U_E − D_eff ≥ minEnergySurplus or S_E ≥ 2,000 (§5.2; §11 point 11:
 * no extra R_E booking — the energy balance covers the upgrade). The land factory closest to the
 * start upgrades (1,400 M, 11,000 E, 115 s at BP 20); `assistEngineers` engineers (task prio 80,
 * engineers only) and the commander (`acuAssist`, separate `@acu` task, only without an enemy
 * combat unit in the base radius) assist. Mex upgrades wait until it is done except under
 * saturation (EconomyManager reads `bb.tech.upgrading`).
 * After T2: `followUp.techT2.t2Engineers` T2 engineers via a production request (FactoryManager),
 * Glutkessel II through the energy balance, further factory upgrades through the mass sink.
 * T2 → T3 and T3 artillery are MS13 (outside TRACK-AI).
 */
import type { OwnRecord } from '../../blackboard.ts';
import type { Manager, ManagerContext, ManagerInitContext } from '../../brain.ts';
import { Prio } from '../../commands/emitter.ts';
import { TaskPrio } from '../../taskboard.ts';
import { confirmTicks } from '../engineer/jobs.ts';
import {
  BASE_RADIUS_WU,
  ROLE,
  TASK_ROLE_ACU_ONLY,
  TASK_ROLE_ENGINEERS_ONLY,
  buildShared,
  distToStart,
  type BuildShared,
} from '../engineer/shared.ts';

export const TECH_OWNER = 'tech';
/** S_E alternative to the energy surplus (ai.md §5.2). */
export const TECH_MIN_STORED_E = 2000;
/** P_M share of the own zone's T1 maximum (ai.md §5.2). */
export const TECH_OWN_MAX_SHARE = 0.8;
export const TECH_ASSIST_KEY = 'tech:assist';
export const TECH_ACU_KEY = 'tech:acu';

export class TechManager implements Manager {
  readonly name = 'tech' as const;
  readonly budgetKey = 'tech' as const;
  private readonly sh: BuildShared;
  private readonly ownMaxT1: number;
  private requestedT2Engineers = false;

  constructor(init: ManagerInitContext) {
    this.sh = buildShared(init);
    const sh = this.sh;
    let own = 0;
    for (const si of sh.analysis.spots) if (si.kind === 'mass' && si.zone === 'own') own++;
    let acuMps = 0;
    for (const b of sh.static.bps.list) if (sh.flags.commander[b.index] === 1) acuMps = Math.max(acuMps, b.massPerSec);
    this.ownMaxT1 = acuMps + sh.bp(ROLE.mex, 1).massPerSec * own;
  }

  think(ctx: ManagerContext): void {
    const bb = ctx.bb;
    const sh = this.sh;
    const facs = bb.units.factories;
    if (!ctx.budget.take(facs.length)) return;
    // Current tech level: highest complete own land factory.
    let level = 1;
    for (const f of facs) if (sh.flags.landFactory[f.bp] === 1 && f.blueprint.tech > level) level = f.blueprint.tech;
    if (level > bb.tech.level) bb.tech.level = level;
    if (bb.tech.upgrading) {
      this.follow(ctx);
      return;
    }
    if (bb.tech.level >= 2) {
      this.afterT2(ctx);
      return;
    }
    this.trigger(ctx);
  }

  /** Checks the T2 trigger and starts the upgrade. */
  private trigger(ctx: ManagerContext): void {
    const bb = ctx.bb;
    const sh = this.sh;
    const tt = sh.opening.followUp.techT2;
    const eco = ctx.view.eco();
    const t = ctx.tick / 10;
    if (t < tt.minS + ctx.profile.timing.techDelayS) return;
    if (eco.massIncome < Math.min(tt.minMassIncome, TECH_OWN_MAX_SHARE * this.ownMaxT1)) return;
    const surplus = eco.energyIncome - eco.energyUpkeep - eco.energyDemand * eco.massRatio;
    if (surplus < tt.minEnergySurplus && eco.energyStored < TECH_MIN_STORED_E) return;
    const fac = this.upgradeCandidate(ctx);
    if (fac === null) return;
    const to = fac.blueprint.upgradesTo;
    const tick = ctx.tick;
    ctx.step(() => {
      ctx.emitter.upgrade(fac.handle, to, Prio.P2, { source: TECH_OWNER });
      return () => {
        bb.tech.upgrading = true;
        bb.tech.upgradeHandle = fac.handle;
        bb.tech.startTick = tick;
        bb.telemetry.push({ kind: 'techStart', tick, unit: fac.handle, tech: sh.static.bps.list[to]!.tech });
        this.postAssist(ctx, fac);
      };
    });
  }

  /** Land factory (T1, complete, not upgrading) with the smallest distance to the start. */
  upgradeCandidate(ctx: ManagerContext): OwnRecord | null {
    const sh = this.sh;
    let best: OwnRecord | null = null;
    let bestD = Infinity;
    for (const f of ctx.bb.units.factories) {
      if (sh.flags.landFactory[f.bp] !== 1 || f.blueprint.tech !== 1 || f.upgradingTo >= 0 || f.blueprint.upgradesTo < 0) continue;
      const d = distToStart(sh, f.x, f.z);
      if (d < bestD || (d === bestD && best !== null && f.handle < best.handle)) {
        best = f;
        bestD = d;
      }
    }
    return best;
  }

  private enemyInBase(ctx: ManagerContext): boolean {
    const sh = this.sh;
    const st = sh.analysis.ownStart;
    for (const c of ctx.bb.enemy.current) {
      if (c.bp < 0 || (sh.flags.combat[c.bp] !== 1 && sh.flags.commander[c.bp] !== 1)) continue;
      const dx = c.x - st.x;
      const dz = c.z - st.z;
      if (dx * dx + dz * dz <= BASE_RADIUS_WU * BASE_RADIUS_WU) return true;
    }
    return false;
  }

  private postAssist(ctx: ManagerContext, fac: OwnRecord): void {
    const bb = ctx.bb;
    const tt = this.sh.opening.followUp.techT2;
    if (tt.assistEngineers > 0) {
      bb.taskBoard.add(
        { kind: 'assist', role: TASK_ROLE_ENGINEERS_ONLY, builders: 'engineers', target: fac.handle, prio: TaskPrio.techAssist, wanted: tt.assistEngineers, source: TECH_OWNER, key: TECH_ASSIST_KEY },
        ctx.tick,
      );
    }
    if (tt.acuAssist && !this.enemyInBase(ctx)) {
      bb.taskBoard.add(
        { kind: 'assist', role: TASK_ROLE_ACU_ONLY, builders: 'commander', target: fac.handle, prio: TaskPrio.techAssist, wanted: 1, source: TECH_OWNER, key: TECH_ACU_KEY },
        ctx.tick,
      );
    }
  }

  private cancelAssist(ctx: ManagerContext): void {
    const board = ctx.bb.taskBoard;
    for (const key of [TECH_ASSIST_KEY, TECH_ACU_KEY]) {
      const t = board.byKey(key);
      if (t !== undefined) board.cancel(t.id);
    }
  }

  /** Follows a running upgrade: done, lost (factory died) or never started (re-issue). */
  private follow(ctx: ManagerContext): void {
    const bb = ctx.bb;
    const sh = this.sh;
    const h = bb.tech.upgradeHandle;
    const fac = bb.units.get(h);
    const tick = ctx.tick;
    if (fac === undefined) {
      ctx.step(() => () => {
        bb.tech.upgrading = false;
        bb.tech.upgradeHandle = 0;
        this.cancelAssist(ctx);
      });
      return;
    }
    if (fac.blueprint.tech >= 2 && fac.upgradingTo < 0) {
      ctx.step(() => () => {
        bb.tech.upgrading = false;
        bb.tech.level = Math.max(bb.tech.level, fac.blueprint.tech);
        bb.tech.doneTick = tick;
        bb.telemetry.push({ kind: 'techDone', tick, unit: h, tech: fac.blueprint.tech });
        this.cancelAssist(ctx);
      });
      return;
    }
    const window = confirmTicks(ctx.profile.lead, ctx.profile.thinkEvery);
    if (fac.upgradingTo < 0 && tick > bb.tech.startTick + window) {
      // The order never showed up (APM drop): issue it again.
      const to = fac.blueprint.upgradesTo;
      if (to < 0) return;
      ctx.step(() => {
        ctx.emitter.upgrade(h, to, Prio.P2, { source: TECH_OWNER });
        return () => {
          bb.tech.startTick = tick;
        };
      });
      return;
    }
    // Commander assist only while no enemy combat unit is in the base radius.
    const acuTask = bb.taskBoard.byKey(TECH_ACU_KEY);
    const enemy = this.enemyInBase(ctx);
    if (acuTask !== undefined && enemy) bb.taskBoard.cancel(acuTask.id);
    else if (acuTask === undefined && !enemy && sh.opening.followUp.techT2.acuAssist && fac.upgradingTo >= 0) {
      bb.taskBoard.add(
        { kind: 'assist', role: TASK_ROLE_ACU_ONLY, builders: 'commander', target: h, prio: TaskPrio.techAssist, wanted: 1, source: TECH_OWNER, key: TECH_ACU_KEY },
        tick,
      );
    }
  }

  /** After Landwerk II: the T2 engineers first (production request for the FactoryManager). */
  private afterT2(ctx: ManagerContext): void {
    if (this.requestedT2Engineers) return;
    const bb = ctx.bb;
    const n = this.sh.opening.followUp.techT2.t2Engineers;
    const tick = ctx.tick;
    ctx.step(() => () => {
      this.requestedT2Engineers = true;
      if (n > 0) {
        bb.productionRequests.add((id) => ({ id, role: ROLE.eng, tech: 2, count: n, prio: TaskPrio.techAssist, source: TECH_OWNER, createdTick: tick }));
      }
    });
  }
}
