/**
 * FactoryManager (ai.md §5.4; 1 Hz on even k, Easy every think; budget ai.md §2.3).
 *
 * Order of work per run:
 *   1. survey (by handle cursor, resumable): Ist = living army by mass per blueprint + current
 *      production + own queued orders; engineers and scouts are counted separately.
 *   2. counter table (Normal: the rules found in this run apply from the NEXT mix run; Hard: at once
 *      plus the prediction "enemy Landwerk II seen ⇒ Meißel +10"; Easy: off).
 *   3. per factory (by handle cursor): engineers first up to `bb.engineerTarget`, then
 *      `bb.productionRequests` by priority, then the base mix as a repeat loop of 5–6 orders built by
 *      largest deficit (Soll − Ist); the loop is rewritten only when the mix changes (or after a
 *      drift check, see below), rally point per factory.
 *   4. scout: one living land scout, replaced after a loss, at most one per 180 s.
 *
 * Factory control (handoff ai.md §4.3): a land factory belongs to the OpeningRunner while the opening
 * is active, before 5:00, not in defence mode, not handed off (`bb.opening.handedOffFactories`) and
 * either claimed by 'opening' (`reservations.unitOwner`) or standing on a factory slot of the
 * opening (analysis.slots of `opening.factoryOrder`, ±6 WU). Every other factory — including
 * additional factories — is controlled here (`claimUnit(h, 'factory')`). Production requests are
 * served by any land factory (also during the opening: local defence pulls tanks/bots forward).
 *
 * Queue model (assumption for the arena/sim, documented): `FactoryQueue` with Shift appends to the
 * production queue, which runs before the repeat loop continues; `queueLength` of the perception
 * counts queued, not yet started orders (the loop is not part of it).
 *
 * Drift check (documented extension): the loop is written for the Ist at the time of the mix change.
 * Every 60 s the manager rebuilds the loop; it rewrites only if the living army deviates by more than
 * 15 percentage points from the target in some role and the new loop differs.
 *
 * Rally: analysis.rally; moves to the staging point while an own platoon holds it with R ≥ 1.0
 * (`bb.platoons`, state 'staging' within 30 WU, ratio ≥ 1); back after 10 s without.
 * Air factories (Air-Lite is MS12): served minimally — fighters (Turmfalke) once enemy aircraft were
 * seen, otherwise bombers (Dohle) with one fighter, an air scout (Lerche) every 4 min.
 */
import { effectiveOpening, type Manager, type ManagerContext, type ManagerInitContext } from '../../brain.ts';
import type { OwnRecord, ProductionRequest } from '../../blackboard.ts';
import { Op } from '@faf/protocol';
import { Prio } from '../../commands/emitter.ts';
import { compareNumbers, distSq } from '../../det.ts';
import type { RoleTable } from '../../openings.ts';
import type { AiBlueprint, Vec2 } from '../../types.ts';
import { UC, unitClassesFor, type UnitClasses } from '../intel/unit-classes.ts';
import { stagingHeld } from '../platoon/scene.ts';
import {
  applyCounters,
  baseMix,
  buildLoop,
  COUNTER_AIR_COUNT,
  COUNTER_AIR_SHARE,
  COUNTER_COMMAND_RANGE_WU,
  COUNTER_RULES,
  COUNTER_SHARE_MIN,
  mixRoleKey,
  mixSignature,
  resolveMix,
  type ResolvedEntry,
} from './mix.ts';

/** Before this tick the opening keeps its factories unless handed off (5:00, ai.md §4.3). */
export const OPENING_FACTORY_DEADLINE_TICK = 3000;
/** A factory within this distance of an opening factory slot belongs to the opening. */
export const OPENING_SLOT_MATCH_WU = 6;
/** One scout at most every 180 s. */
export const SCOUT_REPLACE_TICKS = 1800;
/** Air scout every 4 min (Air-Lite minimum). */
export const AIR_SCOUT_TICKS = 2400;
/** Drift check period and threshold. */
export const DRIFT_CHECK_TICKS = 600;
/** Counter-rule hysteresis: an active rule stays on down to this share … */
export const COUNTER_SHARE_OFF = 0.28;
/** … and for at least this long (30 s). */
export const COUNTER_HOLD_TICKS = 300;
/**
 * Minimum time between two loop rewrites of one factory while its blueprint set stays the same
 * (tai-p5 APM calibration; a new role or a lost role is written at once).
 */
export const MIN_REWRITE_TICKS = 200;
export const DRIFT_MAX_DEVIATION = 0.15;
/** The rally returns from the staging point after 10 s without a holding platoon. */
export const RALLY_HOLD_TICKS = 100;
/** Own queued orders older than this are forgotten (safety net of the queue model). */
export const QUEUE_ENTRY_MAX_AGE_TICKS = 1800;

interface QueuedOrder {
  readonly bp: number;
  readonly tick: number;
}

interface FactoryState {
  /** Mix signature of the written loop (null = none written by this manager). */
  sig: string | null;
  /** Blueprint set of the mix of the written signature. */
  roleKey: string;
  loop: number[];
  lastWrite: number;
  lastDriftCheck: number;
  /** Own appended, not yet started orders (FIFO). */
  queued: QueuedOrder[];
  rally: string;
  lastAirScout: number;
}

export interface FactoryManagerOptions {
  /** Loop length override (tests); default 5/6 by mix size. */
  readonly loopLength?: number;
}

export class FactoryManager implements Manager {
  readonly name = 'factory' as const;
  readonly budgetKey = 'factory' as const;
  private readonly classes: UnitClasses;
  private readonly roles: RoleTable;
  private readonly states = new Map<number, FactoryState>();
  // survey
  private surveyCursor = -1;
  private surveyMass: Float64Array;
  private surveyScouts = 0;
  private surveyEngineers = 0;
  private surveyLastScoutBirth = -1;
  private surveyDone = false;
  /** Survey result of the last completed survey. */
  private istMass: Float64Array;
  private scoutsAlive = 0;
  private engineersAlive = 0;
  // counters
  /** Rules found in the last counter evaluation. */
  private counterFound: string[] = [];
  /** Rules currently applied to the mix. */
  counterApplied: string[] = [];
  /** Active counter rules → tick they turned on (rule order). */
  private counterSince = new Map<string, number>();
  private airContact = false;
  private airCount = 0;
  // scout
  private lastScoutTick = 0;
  // rally
  private rallyAtStaging = false;
  private rallyStagingSince = -1;
  private rallyStagingLost = -1;
  private factoryCursor = -1;
  private engQueuedThisCycle = 0;
  /** Mix of the last factory decision per phase (diagnostics/tests). */
  readonly lastMix = new Map<number, ResolvedEntry[]>();

  constructor(
    init: ManagerInitContext,
    private readonly opts: FactoryManagerOptions = {},
  ) {
    this.classes = unitClassesFor(init.roles);
    this.roles = init.roles;
    const n = init.static.bps.list.length;
    this.surveyMass = new Float64Array(n);
    this.istMass = new Float64Array(n);
  }

  think(ctx: ManagerContext): void {
    if (!this.surveyDone) {
      if (!this.survey(ctx)) return;
    }
    if (!this.evaluateCounters(ctx)) return;
    if (!this.factories(ctx)) return;
    this.surveyDone = false;
  }

  // ---- 1. survey ----------------------------------------------------------------------------------

  private survey(ctx: ManagerContext): boolean {
    const bb = ctx.bb;
    const army = bb.units.army.filter((u) => u.handle > this.surveyCursor);
    army.sort((a, b) => a.handle - b.handle);
    const mass = this.surveyCursor < 0 ? new Float64Array(this.surveyMass.length) : this.surveyMass.slice();
    let scouts = this.surveyCursor < 0 ? 0 : this.surveyScouts;
    let lastBirth = this.surveyCursor < 0 ? -1 : this.surveyLastScoutBirth;
    let cursor = this.surveyCursor;
    let complete = true;
    for (const u of army) {
      if (!ctx.budget.take(1)) {
        complete = false;
        break;
      }
      if (this.classes.has(u.bp, UC.scout) && !this.classes.has(u.bp, UC.air)) {
        scouts++;
        if (u.firstSeenTick > lastBirth) lastBirth = u.firstSeenTick;
      } else mass[u.bp] = mass[u.bp]! + u.blueprint.mass;
      cursor = u.handle;
    }
    let engineers = 0;
    if (complete) {
      // Production and own queued orders (few factories: counted with the last chunk).
      const facs = bb.units.factories;
      if (!ctx.budget.take(facs.length + 1)) complete = false;
      else {
        engineers = bb.units.engineers.length;
        for (const f of facs) {
          const st = this.states.get(f.handle);
          const items: number[] = [];
          if (f.factoryBp >= 0) items.push(f.factoryBp);
          if (st !== undefined) for (const q of this.trimmedQueue(f, st, ctx.tick)) items.push(q.bp);
          for (const b of items) {
            if (this.classes.has(b, UC.engineer)) engineers++;
            else if (this.classes.has(b, UC.scout)) scouts++;
            else mass[b] = mass[b]! + this.classes.bp(b).mass;
          }
        }
      }
    }
    return (
      ctx.step(() => () => {
        this.surveyMass = mass;
        this.surveyScouts = scouts;
        this.surveyLastScoutBirth = lastBirth;
        if (complete) {
          this.istMass = mass;
          this.scoutsAlive = scouts;
          this.engineersAlive = engineers;
          if (lastBirth > this.lastScoutTick) this.lastScoutTick = lastBirth;
          this.surveyCursor = -1;
          this.surveyDone = true;
        } else this.surveyCursor = cursor;
      }) && complete
    );
  }

  /** Own queued orders still in the factory queue (FIFO trimmed to the perceived queue length). */
  private trimmedQueue(f: OwnRecord, st: FactoryState, tick: number): QueuedOrder[] {
    const q = st.queued.filter((e) => tick - e.tick <= QUEUE_ENTRY_MAX_AGE_TICKS);
    while (q.length > f.queueLength) q.shift();
    return q;
  }

  // ---- 2. counter table --------------------------------------------------------------------------

  private evaluateCounters(ctx: ManagerContext): boolean {
    const bb = ctx.bb;
    const mode = ctx.profile.counterMode;
    const T = ctx.static.bps;
    let windowSize = 0;
    bb.enemy.forEachWindow(() => windowSize++);
    // Not enough budget for the window pass: keep the previous counter state (the factories still run).
    if (!ctx.budget.take(windowSize)) return true;
    // Air contact (aa share) and counter shares in one pass over the 180-s window.
    const preds = COUNTER_RULES.map((r) => (r.expr === null ? null : T.compile(r.expr)));
    const airExpr = T.compile('AIR & MOBILE');
    const hit = new Float64Array(COUNTER_RULES.length);
    const cnt = new Int32Array(COUNTER_RULES.length);
    let total = 0;
    let air = 0;
    bb.enemy.forEachWindow((bp, weight) => {
      total += weight;
      if (bp < 0) return;
      const b = T.list[bp]!;
      if (T.matches(b, airExpr)) air++;
      for (let i = 0; i < COUNTER_RULES.length; i++) {
        const p = preds[i];
        if (p !== null && p !== undefined && T.matches(b, p)) {
          hit[i] = hit[i]! + weight;
          cnt[i] = cnt[i]! + 1;
        }
      }
    });
    const found: string[] = [];
    const tick = ctx.tick;
    const since = new Map<string, number>();
    for (let i = 0; i < COUNTER_RULES.length; i++) {
      const r = COUNTER_RULES[i]!;
      const share = total > 0 ? hit[i]! / total : 0;
      // Hysteresis (tai-p5 APM calibration): an active rule stays on down to COUNTER_SHARE_OFF and at
      // least COUNTER_HOLD_TICKS; otherwise the sliding 180-s window flipped a rule every ~9 s and
      // every flip rewrote the loop of every factory.
      const on = this.counterSince.get(r.id);
      const held = on !== undefined && tick - on < COUNTER_HOLD_TICKS;
      let active: boolean;
      if (r.expr === null) active = mode !== 'off' && this.enemyCommanderInFront(ctx);
      else if (r.air) active = cnt[i]! >= COUNTER_AIR_COUNT || share >= COUNTER_AIR_SHARE;
      else active = share >= (on !== undefined ? COUNTER_SHARE_OFF : COUNTER_SHARE_MIN);
      if (active || held) {
        found.push(r.id);
        since.set(r.id, on ?? tick);
      }
    }
    return ctx.step(() => () => {
      this.counterSince = since;
      this.airContact = air > 0;
      this.airCount = air;
      if (mode === 'off') this.counterApplied = [];
      else if (mode === 'nextMix') this.counterApplied = this.counterFound;
      else this.counterApplied = found;
      this.counterFound = found;
    });
  }

  /** A visible enemy commander ≤ 150 WU from any own unit (ai.md §5.4 `COMMAND` vorn). */
  private enemyCommanderInFront(ctx: ManagerContext): boolean {
    const bb = ctx.bb;
    const r2 = COUNTER_COMMAND_RANGE_WU * COUNTER_COMMAND_RANGE_WU;
    if (!ctx.budget.take(bb.enemy.current.length)) return false;
    for (const c of bb.enemy.current) {
      if (c.kind !== 'visible' || !this.classes.has(c.bp, UC.commander)) continue;
      const all = bb.units.all;
      if (!ctx.budget.take(all.length)) return false;
      for (const u of all) if (distSq(u.x, u.z, c.x, c.z) <= r2) return true;
    }
    return false;
  }

  // ---- 3. factories ------------------------------------------------------------------------------

  /** True if the OpeningRunner still controls factory `f`. */
  isOpeningFactory(ctx: ManagerContext, f: OwnRecord): boolean {
    const bb = ctx.bb;
    const o = bb.opening;
    if (!o.active || o.defenseMode || ctx.tick >= OPENING_FACTORY_DEADLINE_TICK) return false;
    if (o.handedOffFactories.includes(f.handle)) return false;
    const owner = bb.reservations.unitOwner(f.handle);
    if (owner === 'opening') return true;
    if (owner === 'factory') return false;
    const op = effectiveOpening(ctx);
    if (op === null) return false;
    const m2 = OPENING_SLOT_MATCH_WU * OPENING_SLOT_MATCH_WU;
    for (const slot of op.factoryOrder) {
      const s = ctx.analysis.slots[slot];
      if (s !== undefined && distSq(s.x, s.z, f.x, f.z) <= m2) return true;
    }
    return false;
  }

  private factories(ctx: ManagerContext): boolean {
    const bb = ctx.bb;
    const tick = ctx.tick;
    for (const h of [...this.states.keys()]) if (bb.units.get(h) === undefined) this.states.delete(h);
    const facs = [...bb.units.factories].sort((a, b) => a.handle - b.handle);
    if (this.factoryCursor < 0) this.engQueuedThisCycle = 0;
    // engineers wanted (survey count + orders of this cycle; decremented as orders go out)
    let engDeficit = bb.engineerTarget - this.engineersAlive - this.engQueuedThisCycle;
    const requests = [...bb.productionRequests.items].sort(compareRequests);
    const eco = ctx.view.eco();
    const rally = this.rallyPoint(ctx);
    // Loop/rally records the emitter dropped last think (APM, budget, abort) were not applied: forget
    // their signature so they are written again (bb.lastDropped, emitter feedback).
    for (const d of bb.lastDropped) {
      if (d.request.source !== 'factory' || d.reason === 'dedup') continue;
      if (d.request.op !== Op.FactoryRepeat && d.request.op !== Op.SetRally) continue;
      for (const h of d.request.units) {
        const st = this.states.get(h);
        if (st === undefined) continue;
        if (d.request.op === Op.FactoryRepeat) {
          st.sig = null;
          st.lastWrite = -1;
        } else st.rally = '';
      }
    }
    if (bb.rally === null || bb.rally.x !== rally.x || bb.rally.z !== rally.z) bb.rally = { x: rally.x, z: rally.z };
    let needScout = this.scoutsAlive === 0 && tick - this.lastScoutTick >= SCOUT_REPLACE_TICKS;
    for (const f of facs) {
      if (f.handle <= this.factoryCursor) continue; // processed earlier in this cycle
      if (!ctx.budget.take(4)) return false;
      const opening = this.isOpeningFactory(ctx, f);
      const owner = bb.reservations.unitOwner(f.handle);
      const foreign = owner !== undefined && owner !== 'factory' && owner !== 'opening';
      const controlled = !opening && !foreign;
      const st = this.stateOf(f.handle);
      const queued = this.trimmedQueue(f, st, tick);
      const busyUpgrading = f.upgradingTo >= 0;
      const isAir = this.classes.has(f.bp, UC.airFactory);
      const emitted: QueuedOrder[] = [];
      let newLoop: number[] | null = null;
      let newSig: string | null = st.sig;
      let newRoleKey = st.roleKey;
      let didDriftCheck = false;
      let newRally = st.rally;
      let scoutQueued = false;
      let airScout = st.lastAirScout;
      let request: ProductionRequest | null = null;
      let engQueued = false;
      const done = ctx.step(() => {
        const em = ctx.emitter;
        if (!busyUpgrading) {
          // (a) engineers first
          if (controlled && !isAir && engDeficit > 0) {
            const producingEng =
              (f.factoryBp >= 0 && this.classes.has(f.factoryBp, UC.engineer)) ||
              queued.some((q) => this.classes.has(q.bp, UC.engineer));
            const eng = this.roles.bestFor('eng', 1, f.blueprint);
            if (!producingEng && eng !== null) {
              em.factoryQueue(f.handle, eng.index, 1, Prio.P3, { queue: true, source: 'factory' });
              emitted.push({ bp: eng.index, tick });
              engQueued = true;
            }
          }
          // (b) production requests by priority (any factory not held by another manager)
          for (const r of foreign ? [] : requests) {
            if (r.count <= 0) continue;
            const bp = this.requestBp(r, f.blueprint, ctx);
            if (bp === null) continue;
            em.factoryQueue(f.handle, bp.index, r.count, Prio.P3, { queue: true, source: 'factory' });
            for (let i = 0; i < r.count; i++) emitted.push({ bp: bp.index, tick });
            request = r;
            break;
          }
          // (c) the mix loop
          if (controlled) {
            if (isAir) {
              const loop = this.airLoop(f.blueprint);
              const sig = `air:${loop.join(',')}`;
              if (loop.length > 0 && sig !== st.sig) {
                em.factoryRepeat(f.handle, loop, Prio.P3, { source: 'factory' });
                newLoop = loop;
                newSig = sig;
              }
              const scout = this.roles.bestFor('air_scout', 1, f.blueprint);
              if (scout !== null && tick - st.lastAirScout >= AIR_SCOUT_TICKS) {
                em.factoryQueue(f.handle, scout.index, 1, Prio.P3, { queue: true, source: 'factory' });
                emitted.push({ bp: scout.index, tick });
                airScout = tick;
              }
            } else {
              const mix = this.mixFor(ctx, f.blueprint, eco.massIncome);
              this.lastMix.set(f.handle, mix);
              const sig = mixSignature(mix);
              const ist = mix.map((e) => this.istOf(e, mix));
              // Blueprint set + applied counter rules + air contact: a qualitative mix change is written at
              // once, a pure share drift of the same rules at most every MIN_REWRITE_TICKS.
              const roleKey = `${mixRoleKey(mix)}|${this.counterApplied.join(',')}|${this.airContact ? 1 : 0}`;
              const rewriteDue = roleKey !== st.roleKey || st.lastWrite < 0 || tick - st.lastWrite >= MIN_REWRITE_TICKS;
              if (mix.length > 0 && sig !== st.sig && rewriteDue) {
                const loop = buildLoop(mix, ist, this.loopOptions(ctx));
                if (this.opts.loopLength !== undefined) loop.length = Math.min(loop.length, this.opts.loopLength);
                // Same orders as the running loop ⇒ only the signature moves on (no record, APM).
                if (st.sig === null || !sameMultiset(loop, st.loop) || f.factoryRepeat === false) {
                  em.factoryRepeat(f.handle, loop, Prio.P3, { source: 'factory' });
                  newLoop = loop;
                }
                newSig = sig;
                newRoleKey = roleKey;
              } else if (mix.length > 0 && tick - st.lastDriftCheck >= DRIFT_CHECK_TICKS) {
                didDriftCheck = true;
                if (this.drifted(mix, ist)) {
                  const loop = buildLoop(mix, ist, this.loopOptions(ctx));
                  if (!sameMultiset(loop, st.loop)) {
                    em.factoryRepeat(f.handle, loop, Prio.P3, { source: 'factory' });
                    newLoop = loop;
                  }
                }
              }
              // (d) scout replacement
              if (needScout) {
                const scout = this.roles.bestFor('scout', 1, f.blueprint);
                if (scout !== null) {
                  em.factoryQueue(f.handle, scout.index, 1, Prio.P3, { queue: true, source: 'factory' });
                  emitted.push({ bp: scout.index, tick });
                  scoutQueued = true;
                }
              }
            }
            // (e) rally
            const key = `${rally.x}|${rally.z}`;
            if (key !== st.rally) {
              em.setRally([f.handle], rally.x, rally.z, Prio.P4, { source: 'factory' });
              newRally = key;
            }
          }
        }
        return () => {
          if (controlled) bb.reservations.claimUnit(f.handle, 'factory');
          st.queued = [...queued, ...emitted];
          if (newLoop !== null) {
            st.loop = newLoop;
            st.lastWrite = tick;
            st.lastDriftCheck = tick;
          }
          if (didDriftCheck) st.lastDriftCheck = tick;
          st.sig = newSig;
          st.roleKey = newRoleKey;
          st.rally = newRally;
          st.lastAirScout = airScout;
          if (engQueued) {
            engDeficit--;
            this.engQueuedThisCycle++;
          }
          if (request !== null) {
            const r: ProductionRequest = request;
            r.count = 0;
            bb.productionRequests.remove(r.id);
          }
          if (scoutQueued) {
            needScout = false;
            this.lastScoutTick = tick;
          }
          this.factoryCursor = f.handle;
        };
      });
      if (!done) return false;
    }
    this.factoryCursor = -1;
    return true;
  }

  private stateOf(h: number): FactoryState {
    let st = this.states.get(h);
    if (st === undefined) {
      st = { sig: null, roleKey: '', loop: [], lastWrite: -1, lastDriftCheck: -1, queued: [], rally: '', lastAirScout: -AIR_SCOUT_TICKS };
      this.states.set(h, st);
    }
    return st;
  }

  /** Blueprint for a request: role@tech, else the highest buildable tech ≥ tech. */
  private requestBp(r: ProductionRequest, factory: AiBlueprint, ctx: ManagerContext): AiBlueprint | null {
    const exact = this.roles.tryResolve(r.role, r.tech);
    if (exact !== null && ctx.static.bps.canBuild(factory, exact)) return exact;
    return this.roles.bestFor(r.role, r.tech, factory);
  }

  /** Target mix of a factory: base mix of its phase + counter table, resolved and normalised. */
  mixFor(ctx: ManagerContext, factory: AiBlueprint, massIncome: number): ResolvedEntry[] {
    const phase = factory.tech >= 2 ? 2 : 1;
    const mix = baseMix(phase, this.airContact, massIncome);
    const predict = ctx.profile.counterMode === 'immediatePredict' && ctx.bb.enemy.t2LandFactorySeen;
    applyCounters(mix, this.counterApplied, predict);
    return resolveMix(mix, factory, ctx.static.bps, (role, tech) => this.roles.tryResolve(role, tech));
  }

  /** Ist mass of a mix entry: exact blueprint, units of the same role without own entry go to the first entry of the role. */
  private istOf(e: ResolvedEntry, mix: readonly ResolvedEntry[]): number {
    let m = this.istMass[e.bp.index]!;
    const first = mix.find((x) => x.role === e.role);
    if (first !== e) return m;
    const list = this.classes.table.list;
    for (let b = 0; b < list.length; b++) {
      if (b === e.bp.index || this.istMass[b]! <= 0) continue;
      if (mix.some((x) => x.bp.index === b)) continue;
      if (this.roles.isRole(list[b]!, e.role)) m += this.istMass[b]!;
    }
    return m;
  }

  private drifted(mix: readonly ResolvedEntry[], ist: readonly number[]): boolean {
    let total = 0;
    for (const v of ist) total += v;
    if (total <= 0) return false;
    for (let i = 0; i < mix.length; i++) {
      if (Math.abs(ist[i]! / total - mix[i]!.share) > DRIFT_MAX_DEVIATION) return true;
    }
    return false;
  }

  private loopOptions(ctx: ManagerContext): { rng: ManagerContext['rng']; errorRate: number; topK: number } {
    return { rng: ctx.rng, errorRate: ctx.profile.errorRate, topK: ctx.profile.errorTopK };
  }

  /** Air-Lite minimum (MS12): fighters after enemy air contact, else bombers with one fighter. */
  private airLoop(factory: AiBlueprint): number[] {
    const fighter = this.roles.bestFor('fighter', 1, factory);
    const bomber = this.roles.bestFor('bomber', 1, factory);
    if (this.airContact && fighter !== null) return [fighter.index];
    const out: number[] = [];
    if (bomber !== null) out.push(bomber.index, bomber.index);
    if (fighter !== null) out.push(fighter.index);
    return out;
  }

  /** Rally point of the factories (ai.md §5.4). */
  private rallyPoint(ctx: ManagerContext): Vec2 {
    const a = ctx.analysis;
    const held = stagingHeld(ctx.bb, a);
    if (held) {
      this.rallyStagingLost = -1;
      if (!this.rallyAtStaging) {
        this.rallyAtStaging = true;
        this.rallyStagingSince = ctx.tick;
      }
    } else if (this.rallyAtStaging) {
      if (this.rallyStagingLost < 0) this.rallyStagingLost = ctx.tick;
      else if (ctx.tick - this.rallyStagingLost >= RALLY_HOLD_TICKS) {
        this.rallyAtStaging = false;
        this.rallyStagingLost = -1;
      }
    }
    return this.rallyAtStaging ? a.staging : a.rally;
  }

  /** Diagnostics: number of enemy aircraft in the 180-s window at the last counter evaluation. */
  get enemyAircraft(): number {
    return this.airCount;
  }

  /** Diagnostics: tick since which the rally stands at the staging point (−1 = rally point). */
  get rallyStagingTick(): number {
    return this.rallyAtStaging ? this.rallyStagingSince : -1;
  }
}

function compareRequests(a: ProductionRequest, b: ProductionRequest): number {
  if (a.prio !== b.prio) return b.prio - a.prio;
  const c = compareNumbers(a.createdTick, b.createdTick);
  return c !== 0 ? c : a.id - b.id;
}

function sameMultiset(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const x = [...a].sort((p, q) => p - q);
  const y = [...b].sort((p, q) => p - q);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}
