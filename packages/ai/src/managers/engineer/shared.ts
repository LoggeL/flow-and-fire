/**
 * Shared state of the build/eco managers (OpeningRunner, EconomyManager, TechManager,
 * EngineerManager — TRACK-AI tai-p3). The P0 blackboard contracts are frozen in wave 1, so the
 * extra state these four managers exchange lives here, keyed by the blackboard (one instance per
 * brain, `WeakMap` lookup only — never iterated). Integration (tai-p5) may move the fields onto the
 * blackboard; every field documents its owner.
 *
 * Roles (ai.md §1 Leitplanke 2): decisions name roles of ai-openings.json, never unit ids. The
 * German roster names used in ai.md map once to role + tech:
 *   Zapfstelle I/II = mex@1/@2 · Glutkessel I/II = pgen@1/@2 · Dampfquelle = hydro@1 ·
 *   Glutspeicher = estore@1 · Landwerk I/II = fac_land@1/@2 · Riegel I = pd@1 ·
 *   Lehrling/Geselle = eng@1/@2 · Punze = tank@1 · Stichel = bot@1 · Funke = scout@1.
 */
import { TASK_ROLE_MARKER_COMMANDER, TASK_ROLE_MARKER_ENGINEERS } from '../../taskboard.ts';
import type { MapAnalysis } from '../../analysis/map-analysis.ts';
import type { Blackboard, OwnRecord } from '../../blackboard.ts';
import type { ManagerInitContext } from '../../brain.ts';
import type { Opening, OpeningsDoc, RoleTable } from '../../openings.ts';
import type { OpBudget } from '../../budget.ts';
import type { AiBlueprint, AiStatic, PerceptionView, Vec2 } from '../../types.ts';

/** Roles of ai-openings.json used by the build managers. */
export const ROLE = {
  mex: 'mex',
  pgen: 'pgen',
  hydro: 'hydro',
  estore: 'estore',
  facLand: 'fac_land',
  facAir: 'fac_air',
  pd: 'pd',
  eng: 'eng',
  tank: 'tank',
  bot: 'bot',
  scout: 'scout',
} as const;

/**
 * Task-board role markers for assist tasks (Task.role of a non-build task): `@acu` = only the
 * commander may take it (Vogt-Assist of the tech upgrade), `@eng` = only engineers (never the
 * commander, e.g. mex-upgrade assist). Build tasks carry their real role.
 */
export const TASK_ROLE_ACU_ONLY = TASK_ROLE_MARKER_COMMANDER;
export const TASK_ROLE_ENGINEERS_ONLY = TASK_ROLE_MARKER_ENGINEERS;

// ---- constants of ai.md ------------------------------------------------------------------------

/** Base radius (ai.md §4.3 local defence, §5.5 commander). */
export const BASE_RADIUS_WU = 60;
/** Base tasks only go to builders within 80 WU (ai.md §5.3). */
export const BOARD_NEAR_WU = 80;
/** ... unless the task is at least 20 s old. */
export const BOARD_ANY_AFTER_TICKS = 200;
/** Engineer flight threshold T_eng (ai.md §5.3, R-06); threat below counts 0 in the spot score. */
export const T_ENG = 20;
/** Spots with T_surface above this and no own cover are blocked (ai.md §5.1). */
export const SPOT_BLOCK_THREAT = 150;
/** Contested spots from 6:00 (or T2), ai.md §4.2/§5.1. */
export const CONTESTED_FROM_TICK = 3600;
/** Spot lock after enemy contact (ai.md §4.2/§5.3). */
export const ENEMY_CONTACT_LOCK_TICKS = 300;
/** Three placement failures lock a place for 60 s (ai.md §5.3). */
export const PLACE_FAIL_LIMIT = 3;
export const PLACE_FAIL_LOCK_TICKS = 600;
/** Hydro has priority over power generators when an engineer is within 120 WU (ai.md §5.1). */
export const HYDRO_ENGINEER_WU = 120;
/** Radius of the threat estimate / own cover around a point (ai.md §5.1 "lokale Schätzung 40 WU"). */
export const COVER_RADIUS_WU = 40;
/** Opening decisions end at 5:00 (factory handoff at the latest, abort window). */
export const OPENING_DEADLINE_TICK = 3000;

// ---- blueprint classes -----------------------------------------------------------------------

/** Per-blueprint flags (index = AiBlueprint.index), computed once from roles and categories. */
export interface BpFlags {
  readonly mex: Uint8Array;
  readonly pgen: Uint8Array;
  readonly hydro: Uint8Array;
  /** Any structure producing energy (pgen, hydro, …). */
  readonly power: Uint8Array;
  readonly estore: Uint8Array;
  readonly landFactory: Uint8Array;
  readonly factory: Uint8Array;
  readonly pd: Uint8Array;
  readonly scout: Uint8Array;
  readonly engineer: Uint8Array;
  readonly commander: Uint8Array;
  /** Mobile armed unit that is not an engineer, commander or scout. */
  readonly combat: Uint8Array;
  readonly structure: Uint8Array;
}

function computeFlags(s: AiStatic, roles: RoleTable): BpFlags {
  const t = s.bps;
  const n = t.list.length;
  const byRole = (role: string): Uint8Array => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = roles.isRole(t.list[i]!, role) ? 1 : 0;
    return out;
  };
  const byExpr = (src: string): Uint8Array => {
    const e = t.compile(src);
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = t.matches(t.list[i]!, e) ? 1 : 0;
    return out;
  };
  const engineer = byExpr('ENGINEER - COMMAND');
  const commander = byExpr('COMMAND');
  const scout = byExpr('MOBILE & SCOUT');
  const mobile = byExpr('MOBILE');
  const combat = new Uint8Array(n);
  const structure = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const b = t.list[i]!;
    structure[i] = b.isStructure ? 1 : 0;
    combat[i] =
      mobile[i] === 1 && engineer[i] === 0 && commander[i] === 0 && scout[i] === 0 && (b.dpsSurface > 0 || b.dpsAir > 0) ? 1 : 0;
  }
  return {
    mex: byRole(ROLE.mex),
    pgen: byRole(ROLE.pgen),
    hydro: byRole(ROLE.hydro),
    power: byExpr('STRUCTURE & ENERGYPRODUCTION'),
    estore: byRole(ROLE.estore),
    landFactory: byRole(ROLE.facLand),
    factory: byExpr('STRUCTURE & FACTORY'),
    pd: byRole(ROLE.pd),
    scout,
    engineer,
    commander,
    combat,
    structure,
  };
}

// ---- planned sites ---------------------------------------------------------------------------

/** A place decided by a manager but possibly not yet visible as a construction site. */
export interface PlannedSite {
  readonly key: string;
  readonly bp: number;
  readonly x: number;
  readonly z: number;
  readonly w: number;
  readonly d: number;
  readonly owner: string;
  readonly holder: number;
  readonly tick: number;
  readonly spot: number;
}

/** Footprint of a rejected placement (sim said no although the perception said yes). */
export interface RejectedArea {
  readonly x: number;
  readonly z: number;
  readonly w: number;
  readonly d: number;
  readonly untilTick: number;
}

// ---- shared state ----------------------------------------------------------------------------

export class BuildShared {
  readonly bb: Blackboard;
  readonly static: AiStatic;
  readonly analysis: MapAnalysis;
  readonly roles: RoleTable;
  readonly doc: OpeningsDoc;
  readonly flags: BpFlags;
  /**
   * Opening in effect (owner: OpeningRunner). Starts as the brain's selected opening; the scout
   * switch (ai.md §4.3) replaces `tech_greed` by `eco_standard`. followUp parameters are read here.
   */
  opening: Opening;
  /** Places decided but not yet confirmed (owner: whoever reserved the site key). */
  readonly planned = new Map<string, PlannedSite>();
  /** Recently rejected footprints; candidates overlapping them are skipped (ai.md §5.3, AI-ENG-02). */
  rejected: RejectedArea[] = [];
  /** Placement failures per site key (3 ⇒ lock 60 s). */
  readonly siteFailures = new Map<string, number>();
  /** Actual position of template slots once placed (e.g. fac1 moved by the spiral search). */
  readonly slotActual = new Map<string, Vec2>();
  /** Extra engineers decided by the mass sink (owner: EconomyManager, ≤ 6, ai.md §5.1). */
  engineerBonus = 0;
  /** Board task the commander must build first (energy emergency; owner: EconomyManager). */
  acuFrontTask = 0;
  /**
   * E/s of power steps within the next two steps of every opening builder (owner: OpeningRunner);
   * the energy balance counts them as running power plants (ecosim `pgen_inflight`).
   */
  openingPendingPowerE = 0;
  /** The opening still has an energy-storage step pending (owner: OpeningRunner). */
  openingPendingEstore = false;
  /** Builders that just completed an expansion (owner: EngineerManager). */
  readonly expansionDone = new Map<number, number>();

  // per-think caches
  private indexThink = -1;
  private index = new Map<number, OwnRecord[]>();
  private threatThink = -1;
  private readonly spotThreat = new Map<number, number>();

  constructor(init: ManagerInitContext) {
    this.bb = init.bb;
    this.static = init.static;
    this.analysis = init.analysis;
    this.roles = init.roles;
    this.doc = init.openings;
    this.flags = computeFlags(init.static, init.roles);
    this.opening = init.opening ?? init.openings.openings[0]!;
  }

  /** Blueprint of role@tech (throws if the role does not resolve — a data error). */
  bp(role: string, tech: number): AiBlueprint {
    return this.roles.resolve(role, tech);
  }

  /** Current game time in seconds. */
  get timeS(): number {
    return this.bb.tick / 10;
  }

  /**
   * Own structures indexed by rounded position (built once per think; `take` charges one op per
   * structure). Returns false if the budget refused.
   */
  ensureIndex(take: (n: number) => boolean): boolean {
    if (this.indexThink === this.bb.thinks) return true;
    const list = this.bb.units.structures;
    if (!take(list.length)) return false;
    const idx = new Map<number, OwnRecord[]>();
    for (const r of list) {
      const key = posKey(r.x, r.z);
      const bucket = idx.get(key);
      if (bucket === undefined) idx.set(key, [r]);
      else bucket.push(r);
    }
    this.index = idx;
    this.indexThink = this.bb.thinks;
    return true;
  }

  /**
   * Own structure matching `pred` whose centre is within 1 WU of (x, z) (index must be current).
   * Candidates in perception order.
   */
  structureAt(x: number, z: number, pred: (r: OwnRecord) => boolean): OwnRecord | null {
    const rx = Math.round(x);
    const rz = Math.round(z);
    let best: OwnRecord | null = null;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = this.index.get(posKeyInt(rx + dx, rz + dz));
        if (bucket === undefined) continue;
        for (const r of bucket) {
          if (Math.abs(r.x - x) > 1 || Math.abs(r.z - z) > 1 || !pred(r)) continue;
          if (best === null || r.handle < best.handle) best = r;
        }
      }
    }
    return best;
  }

  /** Surface threat at a spot, cached per think (1 op per fresh query). */
  spotThreatAt(spot: number, take: (n: number) => boolean): number | null {
    if (this.threatThink !== this.bb.thinks) {
      this.spotThreat.clear();
      this.threatThink = this.bb.thinks;
    }
    const cached = this.spotThreat.get(spot);
    if (cached !== undefined) return cached;
    if (!take(1)) return null;
    const sp = this.static.spots[spot]!;
    const t = this.bb.threat.threatAt('surface', sp.x, sp.z);
    this.spotThreat.set(spot, t);
    return t;
  }

  /** Drops expired rejected areas. */
  pruneRejected(tick: number): void {
    if (this.rejected.length > 0) this.rejected = this.rejected.filter((r) => r.untilTick > tick);
  }

  /** Counts a placement failure at `key`; returns true when the place is now locked (3rd failure). */
  noteFailure(key: string, spot: number, tick: number): boolean {
    const n = (this.siteFailures.get(key) ?? 0) + 1;
    if (n >= PLACE_FAIL_LIMIT) {
      this.siteFailures.delete(key);
      if (spot >= 0) this.bb.reservations.lockSpot(spot, tick + PLACE_FAIL_LOCK_TICKS);
      else this.bb.reservations.releaseSite(key, tick + PLACE_FAIL_LOCK_TICKS);
      return true;
    }
    this.siteFailures.set(key, n);
    return false;
  }
}

/** Integer key of a rounded position (maps ≤ 4096 WU). */
function posKeyInt(rx: number, rz: number): number {
  return (rx + 8) * 8192 + (rz + 8);
}

function posKey(x: number, z: number): number {
  return posKeyInt(Math.round(x), Math.round(z));
}

const registry = new WeakMap<Blackboard, BuildShared>();

/** The shared build state of a brain (created by the first build manager). */
export function buildShared(init: ManagerInitContext): BuildShared {
  let s = registry.get(init.bb);
  if (s === undefined) {
    s = new BuildShared(init);
    registry.set(init.bb, s);
  }
  return s;
}

/** Shared state if a build manager exists for this blackboard (tests, other managers). */
export function peekBuildShared(bb: Blackboard): BuildShared | undefined {
  return registry.get(bb);
}

/** Step function `cap(t)` of followUp.engineers.cap. */
export function capAt(cap: readonly (readonly [number, number])[], timeS: number): number {
  let n = 0;
  for (const [t0, v] of cap) if (timeS >= t0) n = v;
  return n;
}

/** Euclidean distance × map detour (ecosim `dist`): travel estimate between two points. */
export function travelWu(sh: BuildShared, ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz) * sh.analysis.detour;
}

/** Distance of a point to the own start (air line). */
export function distToStart(sh: BuildShared, x: number, z: number): number {
  const s = sh.analysis.ownStart;
  const dx = x - s.x;
  const dz = z - s.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Context of a placement decision (placement.ts, spots.ts). Lives here so spots.ts and placement.ts
 * do not import each other (tai-p5: dep-cruiser no-circular).
 */
export interface PlaceContext {
  readonly sh: BuildShared;
  readonly view: PerceptionView;
  readonly tick: number;
  readonly budget: OpBudget;
  /** Places decided earlier in the same, not yet committed step (e.g. a commander batch). */
  readonly extra?: readonly PlannedSite[];
  /** Slot positions decided earlier in the same step. */
  readonly extraSlots?: ReadonlyMap<string, Vec2>;
}
