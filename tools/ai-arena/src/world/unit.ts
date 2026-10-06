/**
 * Units, orders and per-blueprint facts of the arena world. Plain mutable classes (the arena is a
 * tool, not the sim); every field is part of the canonical state dump (world/hash.ts).
 */
import { OrderKind, type AiBlueprint, type AiBlueprintTable } from '@faf/ai';
import { toMilli } from '../eco/flow.ts';
import { buildRangeFor, type ArenaAssumptions } from '../data/assumptions.ts';

/** Vision fallback for blueprints without `intel.vision` (roster gives none for eco structures). */
export const VISION_FALLBACK_STRUCTURE_WU = 12;
export const VISION_FALLBACK_MOBILE_WU = 16;

/** Static facts of a blueprint, computed once per world. */
export interface BpInfo {
  readonly bp: AiBlueprint;
  readonly isStructure: boolean;
  readonly isAir: boolean;
  readonly isCommander: boolean;
  /** Mobile ENGINEER that is not the commander (idle-engineer metric). */
  readonly isEngineer: boolean;
  /** Mobile unit with build power (engineers and commander). */
  readonly isBuilder: boolean;
  readonly isFactory: boolean;
  readonly isMex: boolean;
  readonly isHydro: boolean;
  /** Energy generator that receives the Glutkranz bonus (ENERGYPRODUCTION & TECH1, not hydro). */
  readonly isKranzGen: boolean;
  readonly isEnergyStorage: boolean;
  /** Generator or energy storage (loss starts the 60-s stall exemption, ai.md §7.1). */
  readonly isEnergyInfra: boolean;
  readonly isScout: boolean;
  readonly hasSurfaceWeapon: boolean;
  readonly hasAirWeapon: boolean;
  readonly vision: number;
  readonly buildRange: number;
  /** max(w, d) / 2 of the footprint. */
  readonly halfFoot: number;
  readonly costMassMilli: number;
  readonly costEnergyMilli: number;
  readonly maxHp: number;
}

export function computeBpInfo(table: AiBlueprintTable, bp: AiBlueprint, a: ArenaAssumptions): BpInfo {
  const c = bp.categoryNames;
  const has = (n: string): boolean => c.includes(n);
  const isStructure = bp.isStructure;
  const isCommander = has('COMMAND');
  const isBuilder = !isStructure && has('ENGINEER') && bp.buildPower > 0;
  const vision = bp.vision > 0 ? bp.vision : isStructure ? VISION_FALLBACK_STRUCTURE_WU : VISION_FALLBACK_MOBILE_WU;
  return {
    bp,
    isStructure,
    isAir: bp.layer === 'air',
    isCommander,
    isEngineer: isBuilder && !isCommander,
    isBuilder,
    isFactory: isStructure && has('FACTORY'),
    isMex: isStructure && has('MASSEXTRACTION'),
    isHydro: isStructure && has('HYDROCARBON'),
    isKranzGen: isStructure && has('ENERGYPRODUCTION') && has('TECH1') && !has('HYDROCARBON'),
    isEnergyStorage: isStructure && has('ENERGYSTORAGE'),
    isEnergyInfra: isStructure && (has('ENERGYPRODUCTION') || has('ENERGYSTORAGE')),
    isScout: has('SCOUT'),
    hasSurfaceWeapon: bp.dpsSurface > 0,
    hasAirWeapon: bp.dpsAir > 0,
    vision,
    buildRange: isBuilder ? buildRangeFor(table, bp, a) : 0,
    halfFoot: Math.max(bp.footprint[0], bp.footprint[1]) / 2,
    costMassMilli: toMilli(bp.mass),
    costEnergyMilli: toMilli(bp.energy),
    maxHp: bp.hpEff > 0 ? bp.hpEff : 1,
  };
}

/** One order of a mobile unit (fields unused by a kind stay at their defaults). */
export class ArenaOrder {
  kind: OrderKind;
  x = 0;
  z = 0;
  /** Target handle (Attack/Assist/Guard/Repair/Overcharge). */
  target = 0;
  /** Build: blueprint index; −1 otherwise. */
  bp = -1;
  rot = 0;
  /** Sequence number of the command that created the order (late rejections). */
  seq = 0;
  /** Build: handle of the construction site once placed. */
  site = 0;
  /** Patrol: origin of the leg. */
  px = 0;
  pz = 0;
  /** Assist on a structure that was a site/upgrade when ordered: done when that work ends. */
  finite = false;
  /** Patrol: origin taken when the order became current. */
  started = false;

  constructor(kind: OrderKind) {
    this.kind = kind;
  }
}

/** A unit waiting in a factory's roll-off. */
export interface RollOff {
  readonly bp: number;
  ticksLeft: number;
}

export class ArenaUnit {
  readonly handle: number;
  readonly slot: number;
  readonly army: number;
  info: BpInfo;
  x: number;
  z: number;
  hp: number;
  complete: boolean;
  /** Construction progress 0..1 (1 when complete). */
  buildDone: number;
  alive = true;
  dying = false;
  readonly createdTick: number;
  /** Mass spot index occupied by an extractor, −1 otherwise. */
  spot = -1;

  // ---- orders / movement (mobile) ----
  orders: ArenaOrder[] = [];
  path: number[] | null = null;
  pathIdx = 0;
  pathGoalX = 0;
  pathGoalZ = 0;
  pathTick = -1;
  /** No land path to the current goal (other component): the order is dropped. */
  pathFailed = false;

  // ---- factory ----
  queueBp: number[] = [];
  queueCount: number[] = [];
  repeat: number[] = [];
  repeatIdx = 0;
  prodBp = -1;
  prodDone = 0;
  rolloff: RollOff[] = [];
  hasRally = false;
  rallyX = 0;
  rallyZ = 0;

  // ---- upgrade ----
  upgradeBp = -1;
  upgradeDone = 0;

  // ---- build power received this tick ----
  bpBuild = 0;
  bpProd = 0;
  bpUpgrade = 0;
  bpRepair = 0;

  // ---- combat ----
  target = 0;
  overchargeReadyTick = 0;
  lastDamagedTick = -1;
  /** Damage accumulated in the current combat phase. */
  dmgTick = 0;
  /** Scenario cheat `holdFire` (tai-p5, AI-DEF-03: a scout walking through without shooting). */
  holdFire = false;
  dmgTickAttacker = 0;
  /** Damage not yet reported in an ownDamaged event (rate limit). */
  dmgPending = 0;
  dmgPendingAttacker = 0;
  dmgEventTick = -1000;

  // ---- vision ----
  /** Bit per army that currently sees this unit. */
  seenMask = 0;

  // ---- metrics ----
  /** Consecutive ticks without an order (idle-engineer rule: counts from 2 s on, retroactively). */
  idleStreak = 0;
  /** Moved in the current tick (at most one movement step per tick). */
  moved = false;
  /** Glutkranz: number of adjacent completed energy storages (generators only). */
  kranz = 0;

  constructor(handle: number, slot: number, army: number, info: BpInfo, x: number, z: number, tick: number, complete: boolean) {
    this.handle = handle;
    this.slot = slot;
    this.army = army;
    this.info = info;
    this.x = x;
    this.z = z;
    this.createdTick = tick;
    this.complete = complete || !info.isStructure;
    this.buildDone = this.complete ? 1 : 0;
    this.hp = this.complete ? info.maxHp : Math.max(1, info.maxHp * SITE_START_HP_FRAC);
  }

  get bp(): AiBlueprint {
    return this.info.bp;
  }

  get hpFrac(): number {
    return this.hp / this.info.maxHp;
  }
}

/** Share of max HP a new construction site starts with; the rest grows with progress. */
export const SITE_START_HP_FRAC = 0.1;
