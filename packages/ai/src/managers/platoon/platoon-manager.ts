/**
 * PlatoonManager (ai.md §5.5; 2 Hz = every think; budget ai.md §2.3).
 *
 * Waves:
 *   FORMING  (rally)     → units ≥ wave threshold, or first wave and t ≥ waves.maxS − 60 s → STAGING
 *   STAGING  (staging)   → R_ziel ≥ attackRatio for 2 thinks (after arriving)             → ATTACK
 *                        → first wave and t ≥ waves.maxS (Pflichtangriff): target with the highest
 *                          R_ziel in the enemy half                                          → ATTACK
 *   ATTACK   (attack-move, one group command)
 *                        → R_lokal < 0.7 for 2 thinks (also in the Pflichtangriff)          → RETREAT
 *                        → target destroyed/reached → next target with R_ziel ≥ 1.0, else    → STAGING
 *   RETREAT  (move to the nearest defended point behind the platoon, P0)
 *                        → R_lokal ≥ 1.0 and HP ≥ 60 % (or reinforcement merged)           → STAGING
 *   MERGE    platoons below 50 % of their initial size (staging, or retreat after arrival) join the
 *            nearest forming/staging platoon.
 * Wave thresholds: first = profile.firstWave ?? waves.first + bb.opening.waveExtra, then + grow each.
 * A platoon reaching STAGING while another waits there merges into it (documented extension).
 * STAGING platoons also retreat at R_lokal < 0.7 for 2 thinks (documented extension; ai.md lists the
 * rule for ATTACK only, a wave waiting at the staging point would otherwise stand and die).
 *
 * Raids (Normal 1 from 6:00, Hard 2 from 4:00, Easy none): 3–5 bots/tanks of tech 1 against outer
 * enemy mex with T_surface = 0 (fallback: enemy-zone mass spots without threat; with the artillery
 * counter rule: the nearest visible enemy artillery); retreat already at R < 1.0.
 * Hunts (bb.huntRequests): the nearest combat unit of a forming/staging platoon or the pool attacks
 * the target (P1); the request is removed when the target is gone or 60 s unseen.
 * Commander: see commander.ts. Micro (Hard, 5 Hz) is MS14 and not part of this manager.
 *
 * Budget: scene build (1 op per own unit and known enemy), then commander, membership, hunts and one
 * step per platoon (cursor over platoon ids; an exhausted budget continues with the same platoon in
 * the next think). Every step computes first and emits/commits only when complete.
 */
import type { OwnRecord, PlatoonInfo, PlatoonState } from '../../blackboard.ts';
import { effectiveOpening, type Manager, type ManagerContext, type ManagerInitContext } from '../../brain.ts';
import { Prio, type Priority } from '../../commands/emitter.ts';
import { compareNumbers, dist, distSq } from '../../det.ts';
import { strengthRadius } from '../../threat.ts';
import { OrderKind, type Vec2 } from '../../types.ts';
import { UC, unitClassesFor, type UnitClasses } from '../intel/unit-classes.ts';
import { CommanderControl } from './commander.ts';
import { RATIO_EPS, Scene } from './scene.ts';
import { ARTY_SHARE_FOR_PD, collectCandidates, evaluateTargets, inEnemyHalf, type TargetCandidate } from './targets.ts';

export type PlatoonKind = 'wave' | 'raid';

export interface PlatoonTarget {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  readonly value: number;
  readonly forced: boolean;
  /** Spot index of a fallback raid target (free enemy mass spot), −1/absent otherwise. */
  readonly spot?: number;
}

export interface Platoon {
  readonly id: number;
  readonly kind: PlatoonKind;
  state: PlatoonState;
  /** Member handles, ascending. */
  units: number[];
  initialSize: number;
  isFirstWave: boolean;
  target: PlatoonTarget | null;
  /** Consecutive thinks below the retreat ratio. */
  lowCount: number;
  /** Consecutive thinks with R_ziel ≥ attackRatio. */
  highCount: number;
  ratio: number;
  x: number;
  z: number;
  hpFrac: number;
  stateTick: number;
  retreatTo: Vec2 | null;
  reinforced: boolean;
}

/** Defaults when no opening is known. */
export const DEFAULT_WAVES = { first: 8, grow: 4, maxS: 420 } as const;
/** FORMING → STAGING of the first wave from maxS − 60 s. */
export const FIRST_WAVE_EARLY_S = 60;
/** "Arrived" at a point: centroid within this distance. */
export const ARRIVE_WU = 25;
/** Idle units within this distance of their order point need no new order. */
export const IDLE_NEAR_WU = 20;
export const ORDER_MATCH_WU = 4;
export const MERGE_BELOW_FRAC = 0.5;
export const RAID_MIN = 3;
export const RAID_MAX = 5;
export const RAID_RETREAT_RATIO = 1.0;
/** Outer mex: farther than this from the enemy start. */
export const RAID_OUTER_WU = 60;
/**
 * A raid does not return to a visited fallback spot for this long (tai-p5: two spots closer than
 * ARRIVE_WU made a raid flip between them every think and eat the APM budget).
 */
export const RAID_REVISIT_TICKS = 1200;
export const HUNT_UNSEEN_TICKS = 600;
/** Share threshold of the counter-table rules used here (artillery raid, sniper, point defense). */
export const COUNTER_RULE_SHARE = 0.35;
/** Staging platoons merge when within this distance. */
export const STAGING_MERGE_WU = 40;

export interface PlatoonManagerOptions {
  /** Disable the commander control (tests of waves alone). */
  readonly commander?: boolean;
  /** Disable raid platoons (tests of waves alone). */
  readonly raids?: boolean;
}

interface MemberInfo {
  readonly recs: OwnRecord[];
  readonly x: number;
  readonly z: number;
  readonly hpFrac: number;
  readonly threat: number;
  readonly r: number;
  readonly artyShare: number;
}

export class PlatoonManager implements Manager {
  readonly name = 'platoon' as const;
  readonly budgetKey = 'platoon' as const;
  readonly platoons: Platoon[] = [];
  readonly commander = new CommanderControl();
  private readonly classes: UnitClasses;
  private readonly scene: Scene;
  private nextId = 1;
  /** Waves launched into STAGING so far. */
  waveIndex = 0;
  firstWaveAttacked = false;
  private readonly hunters = new Map<number, number>();
  /** Fallback raid spots visited (spot index → tick), insertion order. */
  private readonly raidVisited = new Map<number, number>();
  private cursor = 0;
  private firstBase: number;
  private grow: number;
  private maxS: number;
  private readonly profileFirst: number | null;

  constructor(
    init: ManagerInitContext,
    private readonly opts: PlatoonManagerOptions = {},
  ) {
    this.classes = unitClassesFor(init.roles);
    this.scene = new Scene(init.static.map.sizeWu, this.classes);
    const w = init.opening?.followUp.waves ?? DEFAULT_WAVES;
    this.firstBase = w.first;
    this.grow = w.grow;
    this.maxS = w.maxS;
    this.profileFirst = init.profile.firstWave;
  }

  /**
   * Units needed for wave i (0 = first wave): profile override (Easy 12) or waves.first +
   * bb.opening.waveExtra (difficultyTiming, written by the OpeningRunner), then + grow per wave.
   */
  waveSize(ctx: ManagerContext, i: number): number {
    const first = this.profileFirst ?? this.firstBase + ctx.bb.opening.waveExtra;
    return first + this.grow * i;
  }

  think(ctx: ManagerContext): void {
    // Waves of the opening in effect (scout switch tech_greed → eco_standard, ai.md §4.3).
    const w = effectiveOpening(ctx)?.followUp.waves ?? DEFAULT_WAVES;
    this.firstBase = w.first;
    this.grow = w.grow;
    this.maxS = w.maxS;
    if (!this.scene.build(ctx)) return;
    if (this.opts.commander ?? true) {
      if (!this.commander.think(ctx, this.scene)) return;
    }
    if (!this.membership(ctx)) return;
    if (!this.hunts(ctx)) return;
    const list = [...this.platoons].sort((a, b) => a.id - b.id);
    for (const p of list) {
      if (p.id < this.cursor) continue;
      if (!this.platoonStep(ctx, p)) {
        this.cursor = p.id;
        this.publish(ctx);
        return;
      }
    }
    this.cursor = 0;
    this.publish(ctx);
  }

  // ---- membership -------------------------------------------------------------------------------

  private eligible(ctx: ManagerContext, u: OwnRecord): boolean {
    if (!u.complete || !this.classes.has(u.bp, UC.combatLand) || this.classes.has(u.bp, UC.air)) return false;
    const owner = ctx.bb.reservations.unitOwner(u.handle);
    return owner === undefined || owner === 'platoon';
  }

  private membership(ctx: ManagerContext): boolean {
    const bb = ctx.bb;
    const tick = ctx.tick;
    let members = 0;
    for (const p of this.platoons) members += p.units.length;
    if (!ctx.budget.take(bb.units.army.length + members)) return false;
    // alive members
    const alive = (h: number): boolean => {
      const u = bb.units.get(h);
      return u !== undefined && u.complete && this.eligible(ctx, u);
    };
    const kept = this.platoons.map((p) => p.units.filter(alive));
    const inPlatoon = new Set<number>();
    for (const k of kept) for (const h of k) inPlatoon.add(h);
    const huntersAlive = [...this.hunters.keys()].filter((h) => bb.units.get(h) !== undefined);
    const pool: number[] = [];
    for (const u of bb.units.army) {
      if (!this.eligible(ctx, u) || inPlatoon.has(u.handle) || this.hunters.has(u.handle)) continue;
      pool.push(u.handle);
    }
    pool.sort((a, b) => a - b);
    // raids
    const raids: number[][] = [];
    const raidProfile = ctx.profile.raids;
    let raidCount = this.platoons.filter((p, i) => p.kind === 'raid' && kept[i]!.length > 0).length;
    const formingIdx = this.platoons.findIndex((p) => p.kind === 'wave' && p.state === 'forming');
    if ((this.opts.raids ?? true) && raidProfile.count > 0 && tick >= raidProfile.fromS * 10) {
      while (raidCount < raidProfile.count) {
        const cands = [...pool, ...(formingIdx >= 0 ? kept[formingIdx]! : [])].filter((h) => {
          const b = bb.units.get(h)!.blueprint;
          return b.tech === 1 && (ctx.roles.isRole(b, 'bot') || ctx.roles.isRole(b, 'tank'));
        });
        if (cands.length < RAID_MIN) break;
        cands.sort((a, b) => {
          const ba = ctx.roles.isRole(bb.units.get(a)!.blueprint, 'bot') ? 0 : 1;
          const bbv = ctx.roles.isRole(bb.units.get(b)!.blueprint, 'bot') ? 0 : 1;
          return ba !== bbv ? ba - bbv : a - b;
        });
        const take = cands.slice(0, RAID_MAX).sort((a, b) => a - b);
        raids.push(take);
        for (const h of take) {
          const i = pool.indexOf(h);
          if (i >= 0) pool.splice(i, 1);
          if (formingIdx >= 0) {
            const j = kept[formingIdx]!.indexOf(h);
            if (j >= 0) kept[formingIdx]!.splice(j, 1);
          }
        }
        raidCount++;
      }
    }
    return ctx.step(() => () => {
      for (let i = 0; i < this.platoons.length; i++) this.platoons[i]!.units = kept[i]!;
      for (const h of [...this.hunters.keys()]) if (!huntersAlive.includes(h)) this.hunters.delete(h);
      for (const r of raids) {
        for (const h of r) bb.reservations.claimUnit(h, 'platoon');
        this.platoons.push(this.newPlatoon('raid', r, tick));
      }
      if (pool.length > 0) {
        let forming = this.platoons.find((p) => p.kind === 'wave' && p.state === 'forming');
        if (forming === undefined) {
          forming = this.newPlatoon('wave', [], tick);
          this.platoons.push(forming);
        }
        forming.units = [...forming.units, ...pool].sort((a, b) => a - b);
        forming.initialSize = Math.max(forming.initialSize, forming.units.length);
        for (const h of pool) bb.reservations.claimUnit(h, 'platoon');
      }
      // drop empty platoons (the forming one may stay empty)
      for (let i = this.platoons.length - 1; i >= 0; i--) {
        const p = this.platoons[i]!;
        if (p.units.length === 0 && !(p.kind === 'wave' && p.state === 'forming')) this.platoons.splice(i, 1);
      }
    });
  }

  private newPlatoon(kind: PlatoonKind, units: number[], tick: number): Platoon {
    return {
      id: this.nextId++,
      kind,
      state: 'forming',
      units: [...units].sort((a, b) => a - b),
      initialSize: units.length,
      isFirstWave: false,
      target: null,
      lowCount: 0,
      highCount: 0,
      ratio: 0,
      x: 0,
      z: 0,
      hpFrac: 1,
      stateTick: tick,
      retreatTo: null,
      reinforced: false,
    };
  }

  // ---- hunts ------------------------------------------------------------------------------------

  private hunts(ctx: ManagerContext): boolean {
    const bb = ctx.bb;
    const tick = ctx.tick;
    const reqs = [...bb.huntRequests.items];
    if (reqs.length === 0) return true;
    if (!ctx.budget.take(reqs.length * 4)) return false;
    for (const r of reqs) {
      const c = bb.enemy.contacts.get(r.target);
      const hunterRec = r.hunter !== 0 ? bb.units.get(r.hunter) : undefined;
      if (c === undefined || tick - c.lastSeenTick > HUNT_UNSEEN_TICKS) {
        const ok = ctx.step(() => () => {
          if (r.hunter !== 0) this.hunters.delete(r.hunter);
          bb.huntRequests.remove(r.id);
        });
        if (!ok) return false;
        continue;
      }
      let hunter = hunterRec;
      let fromPlatoon: Platoon | null = null;
      if (hunter === undefined) {
        // nearest combat unit of a forming/staging platoon or the pool
        let best: OwnRecord | undefined;
        let bd = Infinity;
        for (const p of this.platoons) {
          if (p.kind !== 'wave' || (p.state !== 'forming' && p.state !== 'staging')) continue;
          for (const h of p.units) {
            const u = bb.units.get(h);
            if (u === undefined || u.blueprint.dpsSurface <= 0) continue;
            const d = distSq(u.x, u.z, c.x, c.z);
            if (d < bd || (d === bd && best !== undefined && h < best.handle)) {
              bd = d;
              best = u;
              fromPlatoon = p;
            }
          }
        }
        if (best === undefined) continue;
        hunter = best;
      }
      const h = hunter;
      const visible = c.kind === 'visible' && c.present;
      const ok = ctx.step(() => {
        const em = ctx.emitter;
        if (visible) {
          if (!(h.order === OrderKind.Attack && h.orderTarget === c.id)) em.attack([h.handle], c.id, Prio.P1, { source: 'platoon' });
        } else if (!(h.order === OrderKind.AttackMove && Math.abs(h.orderX - c.x) <= ORDER_MATCH_WU && Math.abs(h.orderZ - c.z) <= ORDER_MATCH_WU)) {
          em.attackMove([h.handle], c.x, c.z, Prio.P1, { source: 'platoon' });
        }
        return () => {
          r.hunter = h.handle;
          r.x = c.x;
          r.z = c.z;
          this.hunters.set(h.handle, r.id);
          bb.reservations.claimUnit(h.handle, 'platoon');
          if (fromPlatoon !== null) fromPlatoon.units = fromPlatoon.units.filter((x) => x !== h.handle);
        };
      });
      if (!ok) return false;
    }
    // hunters whose request vanished return to the pool
    for (const [h, id] of [...this.hunters]) if (bb.huntRequests.find((r) => r.id === id) === undefined) this.hunters.delete(h);
    return true;
  }

  // ---- platoon steps ------------------------------------------------------------------------------

  private info(ctx: ManagerContext, p: Platoon): MemberInfo | null {
    const bb = ctx.bb;
    const recs: OwnRecord[] = [];
    for (const h of p.units) {
      const u = bb.units.get(h);
      if (u !== undefined) recs.push(u);
    }
    if (!ctx.budget.take(recs.length + 1)) return null;
    let sx = 0;
    let sz = 0;
    let hp = 0;
    let hpMax = 0;
    let threat = 0;
    let arty = 0;
    let mass = 0;
    const bps: number[] = [];
    for (const u of recs) {
      sx += u.x;
      sz += u.z;
      hp += u.hpFrac * u.blueprint.hp;
      hpMax += u.blueprint.hp;
      threat += this.scene.ownThreat(u);
      mass += u.blueprint.mass;
      if (this.classes.has(u.bp, UC.arty)) arty += u.blueprint.mass;
      if (!bps.includes(u.bp)) bps.push(u.bp);
    }
    const n = Math.max(1, recs.length);
    return {
      recs,
      x: sx / n,
      z: sz / n,
      hpFrac: hpMax > 0 ? hp / hpMax : 1,
      threat,
      r: strengthRadius(ctx.static.bps, bps),
      artyShare: mass > 0 ? arty / mass : 0,
    };
  }

  /** Members that need `op` to (x, z): perceived order differs and not idle near the point. */
  private needOrder(recs: readonly OwnRecord[], kind: number, x: number, z: number): number[] {
    const out: number[] = [];
    const near2 = IDLE_NEAR_WU * IDLE_NEAR_WU;
    for (const u of recs) {
      const same =
        u.order === kind && u.queueLength === 0 && Math.abs(u.orderX - x) <= ORDER_MATCH_WU && Math.abs(u.orderZ - z) <= ORDER_MATCH_WU;
      const idleNear = u.order === OrderKind.Idle && distSq(u.x, u.z, x, z) <= near2;
      if (!same && !idleNear) out.push(u.handle);
    }
    return out;
  }

  private emitOrder(ctx: ManagerContext, units: number[], kind: 'move' | 'attackMove', x: number, z: number, prio: Priority): void {
    if (units.length === 0) return;
    if (kind === 'move') ctx.emitter.move(units, x, z, prio, { source: 'platoon' });
    else ctx.emitter.attackMove(units, x, z, prio, { source: 'platoon' });
  }

  private platoonStep(ctx: ManagerContext, p: Platoon): boolean {
    if (p.units.length === 0) return true;
    const m = this.info(ctx, p);
    if (m === null) return false;
    const local = this.scene.strengthAt(m.x, m.z, m.r);
    if (local === null) return false;
    return p.kind === 'raid' ? this.raidStep(ctx, p, m, local.ratio) : this.waveStep(ctx, p, m, local.ratio);
  }

  private waveStep(ctx: ManagerContext, p: Platoon, m: MemberInfo, ratio: number): boolean {
    const bb = ctx.bb;
    const a = ctx.analysis;
    const tick = ctx.tick;
    const t = tick / 10;
    const prof = ctx.profile;
    let next: PlatoonState = p.state;
    let target: PlatoonTarget | null = p.target;
    let low = ratio < prof.retreatRatio - RATIO_EPS ? p.lowCount + 1 : 0;
    let high = p.highCount;
    let retreatTo = p.retreatTo;
    let firstWave = p.isFirstWave;
    let waveInc = 0;
    let attackedNow = false;
    let forcedNow = false;
    let mergeInto: Platoon | null = null;
    let reinforcedClear = false;
    const orders: { units: number[]; kind: 'move' | 'attackMove'; x: number; z: number; prio: Priority }[] = [];
    const n = m.recs.length;

    const retreatPoint = (): Vec2 | null => this.retreatPoint(ctx, p, m);
    switch (p.state) {
      case 'forming': {
        low = 0;
        const threshold = this.waveSize(ctx, this.waveIndex);
        // First wave: the first launched wave, or a platoon that absorbed the (weakened) first wave.
        const isFirst = (this.waveIndex === 0 || p.isFirstWave) && !this.firstWaveAttacked;
        if (n >= threshold || (isFirst && t >= this.maxS - FIRST_WAVE_EARLY_S && n > 0)) {
          next = 'staging';
          waveInc = 1;
          firstWave = isFirst;
          high = 0;
          orders.push({ units: m.recs.map((u) => u.handle), kind: 'move', x: a.staging.x, z: a.staging.z, prio: Prio.P1 });
        } else {
          // Gather at the rally point; units walking to the staging point (factory rally moved there
          // while a platoon holds it) are left alone.
          // The factories' current rally (bb.rally, FactoryManager) — without a FactoryManager the
          // same staging-held rule as the factories.
          const atStaging = bb.rally !== null ? bb.rally.x === a.staging.x && bb.rally.z === a.staging.z : this.scene.stagingHeld;
          const gather = atStaging ? a.staging : a.rally;
          const need = this.needOrder(m.recs, OrderKind.Move, gather.x, gather.z);
          const other = atStaging ? a.rally : a.staging;
          const skip = new Set(this.needOrder(m.recs, OrderKind.Move, other.x, other.z));
          orders.push({ units: need.filter((h) => skip.has(h)), kind: 'move', x: gather.x, z: gather.z, prio: Prio.P1 });
        }
        break;
      }
      case 'staging': {
        if (low >= 2) {
          const rp = retreatPoint();
          if (rp === null) return false;
          next = 'retreat';
          retreatTo = rp;
          orders.push({ units: m.recs.map((u) => u.handle), kind: 'move', x: rp.x, z: rp.z, prio: Prio.P0 });
          break;
        }
        // merge with another waiting platoon, or below 50 %
        mergeInto = this.mergeTarget(p, m, n < MERGE_BELOW_FRAC * p.initialSize);
        if (mergeInto !== null) {
          next = 'merge';
          break;
        }
        const forced = p.isFirstWave && !this.firstWaveAttacked && t >= this.maxS;
        const arrived = dist(m.x, m.z, a.staging.x, a.staging.z) <= ARRIVE_WU;
        if (forced || arrived) {
          const cands = collectCandidates(ctx, this.classes, m.artyShare);
          if (cands === null) return false;
          const ev = evaluateTargets(this.scene, cands, { x: m.x, z: m.z }, m.threat, m.r);
          if (ev === null) return false;
          let pick: TargetCandidate | null = null;
          if (forced) {
            const half = ev.filter((c) => inEnemyHalf(ctx, c.x, c.z));
            half.sort((x, y) => {
              const k = compareNumbers(y.ratio, x.ratio);
              if (k !== 0) return k;
              const s = compareNumbers(y.score, x.score);
              return s !== 0 ? s : x.id - y.id;
            });
            pick = half[0] ?? null;
            if (pick === null) {
              const es = a.enemyStart;
              pick = { id: 0, x: es.x, z: es.z, value: 0, commander: false, ratio: 0, pathThreat: 0, score: 0 };
            }
            forcedNow = true;
          } else {
            const best = ev[0] ?? null;
            const sniper = this.scene.shareSniper >= COUNTER_RULE_SHARE;
            const pdHeavy = this.scene.sharePd >= COUNTER_RULE_SHARE;
            const need = sniper ? Math.min(prof.attackRatio, 1) : prof.attackRatio;
            const allowed = !pdHeavy || m.artyShare >= ARTY_SHARE_FOR_PD;
            if (best !== null && allowed && best.ratio >= need - RATIO_EPS) {
              high++;
              if (high >= 2 || sniper) pick = best;
            } else high = 0;
          }
          if (pick !== null) {
            next = 'attack';
            target = { id: pick.id, x: pick.x, z: pick.z, value: pick.value, forced: forcedNow };
            attackedNow = true;
            low = 0;
            orders.push({ units: m.recs.map((u) => u.handle), kind: 'attackMove', x: pick.x, z: pick.z, prio: Prio.P1 });
            break;
          }
        }
        orders.push({ units: this.needOrder(m.recs, OrderKind.Move, a.staging.x, a.staging.z), kind: 'move', x: a.staging.x, z: a.staging.z, prio: Prio.P1 });
        break;
      }
      case 'attack': {
        if (low >= 2) {
          const rp = retreatPoint();
          if (rp === null) return false;
          next = 'retreat';
          retreatTo = rp;
          orders.push({ units: m.recs.map((u) => u.handle), kind: 'move', x: rp.x, z: rp.z, prio: Prio.P0 });
          break;
        }
        const tg = p.target;
        let done = tg === null;
        if (tg !== null) {
          if (tg.id !== 0) done = !bb.enemy.contacts.has(tg.id);
          else {
            const structNear = bb.enemy.structures.some((s) => distSq(s.x, s.z, tg.x, tg.z) <= 60 * 60);
            done = dist(m.x, m.z, tg.x, tg.z) <= ARRIVE_WU && !structNear;
          }
        }
        if (done) {
          const cands = collectCandidates(ctx, this.classes, m.artyShare);
          if (cands === null) return false;
          const ev = evaluateTargets(this.scene, cands, { x: m.x, z: m.z }, m.threat, m.r);
          if (ev === null) return false;
          const nxt = ev.find((c) => c.ratio >= 1 - RATIO_EPS && !(tg !== null && c.id === tg.id && c.id !== 0)) ?? null;
          if (nxt !== null && !(tg !== null && tg.id === 0 && nxt.id === 0)) {
            target = { id: nxt.id, x: nxt.x, z: nxt.z, value: nxt.value, forced: false };
            orders.push({ units: m.recs.map((u) => u.handle), kind: 'attackMove', x: nxt.x, z: nxt.z, prio: Prio.P1 });
          } else {
            next = 'staging';
            target = null;
            high = 0;
            orders.push({ units: m.recs.map((u) => u.handle), kind: 'move', x: a.staging.x, z: a.staging.z, prio: Prio.P1 });
          }
        } else if (tg !== null) {
          orders.push({ units: this.needOrder(m.recs, OrderKind.AttackMove, tg.x, tg.z), kind: 'attackMove', x: tg.x, z: tg.z, prio: Prio.P1 });
        }
        break;
      }
      case 'retreat': {
        low = 0;
        const rp = p.retreatTo ?? a.rally;
        const arrived = dist(m.x, m.z, rp.x, rp.z) <= ARRIVE_WU;
        if (arrived) {
          const weak = n < MERGE_BELOW_FRAC * p.initialSize;
          mergeInto = weak ? this.mergeTarget(p, m, true) : null;
          if (mergeInto !== null) {
            next = 'merge';
            break;
          }
        }
        if ((ratio >= prof.reentryRatio - RATIO_EPS && m.hpFrac >= prof.reentryHpFrac - RATIO_EPS) || p.reinforced) {
          next = 'staging';
          high = 0;
          reinforcedClear = true;
          target = null;
          orders.push({ units: m.recs.map((u) => u.handle), kind: 'move', x: a.staging.x, z: a.staging.z, prio: Prio.P1 });
        } else {
          orders.push({ units: this.needOrder(m.recs, OrderKind.Move, rp.x, rp.z), kind: 'move', x: rp.x, z: rp.z, prio: Prio.P0 });
        }
        break;
      }
      default:
        break;
    }

    const enemyHalf = target !== null ? inEnemyHalf(ctx, target.x, target.z) : false;
    return ctx.step(() => {
      for (const o of orders) this.emitOrder(ctx, o.units, o.kind, o.x, o.z, o.prio);
      return () => {
        p.ratio = ratio;
        p.x = m.x;
        p.z = m.z;
        p.hpFrac = m.hpFrac;
        p.lowCount = low;
        p.highCount = high;
        p.retreatTo = retreatTo;
        p.isFirstWave = firstWave;
        if (reinforcedClear) p.reinforced = false;
        if (next !== p.state) p.stateTick = tick;
        const prev = p.state;
        p.state = next;
        p.target = target;
        this.waveIndex += waveInc;
        if (next === 'retreat' && prev !== 'retreat') {
          bb.telemetry.push({ kind: 'retreat', tick, platoon: p.id, ratio });
        }
        if (attackedNow && target !== null) {
          if (p.isFirstWave) this.firstWaveAttacked = true;
          bb.telemetry.push({
            kind: 'waveAttack',
            tick,
            x: target.x,
            z: target.z,
            enemyHalf,
            units: n,
            forced: forcedNow,
          });
        }
        if (next === 'staging' && prev === 'forming') {
          // A second platoon arriving for staging joins the one already waiting there.
          const other = this.platoons.find((o) => o !== p && o.kind === 'wave' && o.state === 'staging');
          if (other !== undefined) this.absorb(other, p);
        }
        if (next === 'merge' && mergeInto !== null) this.absorb(mergeInto, p);
      };
    });
  }

  private raidStep(ctx: ManagerContext, p: Platoon, m: MemberInfo, ratio: number): boolean {
    const bb = ctx.bb;
    const a = ctx.analysis;
    const tick = ctx.tick;
    let next: PlatoonState = p.state;
    let target = p.target;
    let low = ratio < RAID_RETREAT_RATIO - RATIO_EPS ? p.lowCount + 1 : 0;
    let retreatTo = p.retreatTo;
    const orders: { units: number[]; kind: 'move' | 'attackMove'; x: number; z: number; prio: Priority }[] = [];
    const all = m.recs.map((u) => u.handle);
    switch (p.state) {
      case 'forming': {
        low = 0;
        if (m.recs.length >= RAID_MIN) {
          const tg = this.raidTarget(ctx, m);
          if (tg === undefined) return false;
          if (tg !== null) {
            next = 'raid';
            target = tg;
            orders.push({ units: all, kind: 'attackMove', x: tg.x, z: tg.z, prio: Prio.P1 });
            break;
          }
        }
        orders.push({ units: this.needOrder(m.recs, OrderKind.Move, a.rally.x, a.rally.z), kind: 'move', x: a.rally.x, z: a.rally.z, prio: Prio.P1 });
        break;
      }
      case 'raid': {
        if (low >= 2) {
          const rp = this.retreatPoint(ctx, p, m);
          if (rp === null) return false;
          next = 'retreat';
          retreatTo = rp;
          orders.push({ units: all, kind: 'move', x: rp.x, z: rp.z, prio: Prio.P0 });
          break;
        }
        const tg = p.target;
        let done = tg === null;
        if (tg !== null) {
          if (tg.id !== 0) done = !bb.enemy.contacts.has(tg.id);
          else done = dist(m.x, m.z, tg.x, tg.z) <= ARRIVE_WU;
        }
        if (done) {
          if (tg !== null && tg.spot !== undefined && tg.spot >= 0) {
            // Visiting is idempotent (same tick value on a re-run after an aborted step).
            this.raidVisited.delete(tg.spot);
            this.raidVisited.set(tg.spot, tick);
          }
          const nt = this.raidTarget(ctx, m, tg);
          if (nt === undefined) return false;
          if (nt !== null) {
            target = nt;
            orders.push({ units: all, kind: 'attackMove', x: nt.x, z: nt.z, prio: Prio.P1 });
          } else {
            next = 'forming';
            target = null;
            orders.push({ units: all, kind: 'move', x: a.rally.x, z: a.rally.z, prio: Prio.P1 });
          }
        } else if (tg !== null) {
          orders.push({ units: this.needOrder(m.recs, OrderKind.AttackMove, tg.x, tg.z), kind: 'attackMove', x: tg.x, z: tg.z, prio: Prio.P1 });
        }
        break;
      }
      case 'retreat': {
        low = 0;
        const rp = p.retreatTo ?? a.rally;
        if (ratio >= ctx.profile.reentryRatio - RATIO_EPS && m.hpFrac >= ctx.profile.reentryHpFrac - RATIO_EPS) {
          next = 'forming';
          target = null;
        } else orders.push({ units: this.needOrder(m.recs, OrderKind.Move, rp.x, rp.z), kind: 'move', x: rp.x, z: rp.z, prio: Prio.P0 });
        break;
      }
      default:
        break;
    }
    return ctx.step(() => {
      for (const o of orders) this.emitOrder(ctx, o.units, o.kind, o.x, o.z, o.prio);
      return () => {
        const prev = p.state;
        p.ratio = ratio;
        p.x = m.x;
        p.z = m.z;
        p.hpFrac = m.hpFrac;
        p.lowCount = low;
        p.retreatTo = retreatTo;
        if (next !== prev) p.stateTick = tick;
        p.state = next;
        p.target = target;
        if (next === 'retreat' && prev !== 'retreat') bb.telemetry.push({ kind: 'retreat', tick, platoon: p.id, ratio });
      };
    });
  }

  /**
   * Raid target: with the artillery counter rule the nearest visible enemy artillery; otherwise the
   * outer enemy mex (> 60 WU from the enemy start) with T_surface = 0 by value / (1 + d/200); fallback
   * enemy-zone mass spots without threat, oldest first by distance. undefined = budget exhausted.
   */
  private raidTarget(ctx: ManagerContext, m: MemberInfo, prev: PlatoonTarget | null = null): PlatoonTarget | null | undefined {
    const bb = ctx.bb;
    const a = ctx.analysis;
    const es = a.enemyStart;
    if (!ctx.budget.take(bb.enemy.structures.length + bb.enemy.current.length + a.spots.length)) return undefined;
    if (this.scene.shareArty >= COUNTER_RULE_SHARE) {
      let best: { id: number; x: number; z: number } | null = null;
      let bd = Infinity;
      for (const c of bb.enemy.current) {
        if (c.kind !== 'visible' || !this.classes.has(c.bp, UC.arty)) continue;
        const d = distSq(c.x, c.z, m.x, m.z);
        if (d < bd || (d === bd && best !== null && c.id < best.id)) {
          bd = d;
          best = c;
        }
      }
      if (best !== null) return { id: best.id, x: best.x, z: best.z, value: 100, forced: false };
    }
    const outer2 = RAID_OUTER_WU * RAID_OUTER_WU;
    let best: PlatoonTarget | null = null;
    let bestScore = -Infinity;
    for (const s of bb.enemy.structures) {
      if (!this.classes.has(s.bp, UC.mex) || distSq(s.x, s.z, es.x, es.z) <= outer2) continue;
      if (prev !== null && prev.id === s.id) continue;
      if (bb.threat.threatAt('surface', s.x, s.z) > 0) continue;
      const score = this.classes.value[s.bp]! / (1 + dist(m.x, m.z, s.x, s.z) / 200);
      if (score > bestScore || (score === bestScore && best !== null && s.id < best.id)) {
        bestScore = score;
        best = { id: s.id, x: s.x, z: s.z, value: this.classes.value[s.bp]!, forced: false };
      }
    }
    if (best !== null) return best;
    let spot: { x: number; z: number; index: number } | null = null;
    let sd = Infinity;
    for (const s of a.spots) {
      if (s.zone !== 'enemy' || s.kind !== 'mass' || distSq(s.x, s.z, es.x, es.z) <= outer2) continue;
      if (prev !== null && prev.id === 0 && prev.x === s.x && prev.z === s.z) continue;
      const visited = this.raidVisited.get(s.index);
      if (visited !== undefined && ctx.tick - visited < RAID_REVISIT_TICKS) continue;
      if (bb.threat.threatAt('surface', s.x, s.z) > 0) continue;
      const d = distSq(s.x, s.z, m.x, m.z);
      if (d < sd || (d === sd && spot !== null && s.index < spot.index)) {
        sd = d;
        spot = s;
      }
    }
    return spot === null ? null : { id: 0, x: spot.x, z: spot.z, value: 100, forced: false, spot: spot.index };
  }

  /** Nearest defended point behind the platoon: own factory, own point defense or forming/staging platoon. */
  private retreatPoint(ctx: ManagerContext, p: Platoon, m: MemberInfo): Vec2 | null {
    const bb = ctx.bb;
    const a = ctx.analysis;
    const structs = bb.units.structures;
    if (!ctx.budget.take(structs.length + this.platoons.length)) return null;
    const here = a.dOwnAt(m.x, m.z);
    const behind = (x: number, z: number): boolean => {
      const d = a.dOwnAt(x, z);
      if (!Number.isFinite(d) || !Number.isFinite(here)) return dist(x, z, a.ownStart.x, a.ownStart.z) < dist(m.x, m.z, a.ownStart.x, a.ownStart.z);
      return d < here - 10;
    };
    const pts: Vec2[] = [];
    for (const s of structs) {
      if (!s.complete) continue;
      if (this.classes.has(s.bp, UC.factory) || this.classes.has(s.bp, UC.pd)) pts.push(s);
    }
    for (const o of this.platoons) {
      if (o === p || o.kind !== 'wave' || (o.state !== 'forming' && o.state !== 'staging') || o.units.length === 0) continue;
      pts.push(o);
    }
    let bi = -1;
    let bd = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const q = pts[i]!;
      if (!behind(q.x, q.z)) continue;
      const d = distSq(q.x, q.z, m.x, m.z);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    return bi >= 0 ? { x: pts[bi]!.x, z: pts[bi]!.z } : { x: a.rally.x, z: a.rally.z };
  }

  /** Merge target: another staging platoon nearby, or (when below 50 %) the nearest forming/staging platoon. */
  private mergeTarget(p: Platoon, m: MemberInfo, weak: boolean): Platoon | null {
    let best: Platoon | null = null;
    let bd = Infinity;
    for (const o of this.platoons) {
      if (o === p || o.kind !== 'wave' || o.units.length === 0) continue;
      const staging = o.state === 'staging';
      if (!(staging || (weak && o.state === 'forming'))) continue;
      const d = distSq(o.x, o.z, m.x, m.z);
      if (!weak && !(staging && p.state === 'staging' && d <= STAGING_MERGE_WU * STAGING_MERGE_WU && o.id < p.id)) continue;
      if (d < bd || (d === bd && best !== null && o.id < best.id)) {
        bd = d;
        best = o;
      }
    }
    return best;
  }

  /** Moves all units of `from` into `into` (from becomes empty and is dropped next think). */
  private absorb(into: Platoon, from: Platoon): void {
    into.units = [...into.units, ...from.units].sort((a, b) => a - b);
    into.initialSize = Math.max(into.initialSize + from.units.length, into.units.length);
    if (from.isFirstWave && !this.firstWaveAttacked) into.isFirstWave = true;
    if (into.state === 'retreat') into.reinforced = true;
    from.units = [];
    from.state = 'merge';
  }

  // ---- publish ----------------------------------------------------------------------------------

  private publish(ctx: ManagerContext): void {
    const out: PlatoonInfo[] = [];
    for (const p of [...this.platoons].sort((a, b) => a.id - b.id)) {
      if (p.units.length === 0) continue;
      out.push({
        id: p.id,
        state: p.kind === 'raid' && p.state === 'forming' ? 'forming' : p.state,
        units: [...p.units],
        x: p.x,
        z: p.z,
        ratio: p.ratio,
        target: p.target === null ? null : { x: p.target.x, z: p.target.z },
        isFirstWave: p.isFirstWave,
      });
    }
    ctx.bb.platoons = out;
  }

  /** Platoon by id (tests/diagnostics). */
  platoon(id: number): Platoon | undefined {
    return this.platoons.find((p) => p.id === id);
  }
}
