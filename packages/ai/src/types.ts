/**
 * Core contracts of the skirmish AI (PLAN §3.10, docs/design/ai.md §2, §11 points 8/9).
 *
 * Coordinates are float world units (WU). The AI may use floats (PLAN §3.10) but only IEEE-exact
 * operations (ai.md §2.5); conversion to the sim's Fx raw happens in the command encoders
 * (`det.ts toFxRaw`).
 *
 * Adapter boundary (TRACK-AI → MS6/MS9): today `AiStatic` is built from the .rtsmap file
 * (`data/static.ts`) and the roster (`data/roster-adapter.ts`); later nav delivers `passLowRes` and
 * the sector graph, and @faf/blueprints the BlueprintViewTable. The shapes below stay.
 */
import type { CategoryRegistry, CompiledCategoryExpr, Heightfield } from '@faf/rules';

/** 2-D point in world units (x east, z south). */
export interface Vec2 {
  readonly x: number;
  readonly z: number;
}

export type SpotKind = 'mass' | 'hydro';

/** Resource spot of the map (index = position in the map's spot list). */
export interface Spot {
  readonly index: number;
  readonly kind: SpotKind;
  readonly x: number;
  readonly z: number;
}

/** Map class used by `ai-openings.json → weights.maps`. */
export type MapClass = 'setons' | 'size256' | 'size512' | 'size1024';

export interface AiMapMeta {
  readonly name: string;
  readonly sizeWu: number;
  readonly mapClass: MapClass;
}

/** Motion layer of a blueprint as the AI sees it (MVP: land and air, PLAN §3.1). */
export type AiMotionLayer = 'land' | 'air' | 'water' | 'seabed' | 'hover' | 'amphibious';

/** Threat layer: `surface` = damage against land/naval targets, `air` = against aircraft. */
export type ThreatLayer = 'surface' | 'air';

/**
 * Blueprint as the AI sees it (view data; later `BlueprintViewTable` from @faf/blueprints).
 * All rates are per second, costs absolute (upgrade stages carry the upgrade cost, FA semantics).
 */
export interface AiBlueprint {
  /** Position in the table sorted by `id` (code units). Provisional sim blueprint id of the payloads. */
  readonly index: number;
  readonly id: string;
  /** German display name — debugging/telemetry only, never used for decisions (ai.md §1 Leitplanke 2). */
  readonly name: string;
  /** 0 for the commander, 1..4 otherwise. */
  readonly tech: number;
  /** Category mask (rules.CATEGORY_WORDS words) against `AiBlueprintTable.registry`. */
  readonly categories: Uint32Array;
  readonly categoryNames: readonly string[];
  readonly mass: number;
  readonly energy: number;
  readonly buildTime: number;
  readonly buildPower: number;
  readonly massPerSec: number;
  readonly energyPerSec: number;
  readonly upkeepEnergyPerSec: number;
  readonly storageMass: number;
  readonly storageEnergy: number;
  readonly hp: number;
  readonly shieldHp: number;
  /** hp + shieldHp (ai.md §5.6: the shield counts into HP_eff). */
  readonly hpEff: number;
  readonly speed: number;
  /** Footprint [width (x), depth (z)] in WU at rotation 0. */
  readonly footprint: readonly [number, number];
  readonly isStructure: boolean;
  readonly layer: AiMotionLayer;
  readonly vision: number;
  readonly radar: number;
  /** Σ dps of weapons hitting land targets, without weapons marked "Nicht in DPS/Mass gewertet". */
  readonly dpsSurface: number;
  /** Σ dps of weapons hitting air targets (same exclusion). */
  readonly dpsAir: number;
  /** √(dpsSurface · hpEff) — threat at full HP (ai.md §5.5/§5.6). */
  readonly threatSurface: number;
  /** √(dpsAir · hpEff). */
  readonly threatAir: number;
  /** Largest weapon range (counted weapons), 0 without weapons. */
  readonly rangeMax: number;
  /** Smallest minimum range over counted weapons (0 if any weapon has none). */
  readonly rangeMin: number;
  /** Largest splash radius of counted weapons. */
  readonly splash: number;
  /** Table index of the upgrade target, −1 if none. */
  readonly upgradesTo: number;
  /** Table index of the previous stage, −1 if this is a base stage. */
  readonly upgradeFrom: number;
  /** Compiled `buildableBy` expression (matched against the builder's categories), null = not buildable. */
  readonly buildableBy: CompiledCategoryExpr | null;
  /** First milestone of the unit, e.g. 'MS9' (roster msFirst). */
  readonly msFirst: string;
}

export interface AiBlueprintTable {
  /** Blueprints sorted by id; `list[i].index === i`. */
  readonly list: readonly AiBlueprint[];
  readonly registry: CategoryRegistry;
  /** Blueprint by id, undefined if unknown (binary search, no Map). */
  byId(id: string): AiBlueprint | undefined;
  /** True if `builder` may construct/produce `target` (target.buildableBy matches builder's mask). */
  canBuild(builder: AiBlueprint, target: AiBlueprint): boolean;
  /** True if the categories of `bp` match the compiled expression. */
  matches(bp: AiBlueprint, expr: CompiledCategoryExpr): boolean;
  /** Compiles a category expression against the table's registry (cached per source string). */
  compile(source: string): CompiledCategoryExpr;
}

/**
 * Static knowledge of one AI army (PLAN §3.10 + ai.md §11 point 8). Everything here is setup
 * knowledge a human player also has (map, spots, start positions from the lobby).
 */
export interface AiStatic {
  readonly army: number;
  readonly gameSeed: number;
  readonly map: AiMapMeta;
  readonly spots: readonly Spot[];
  /** Land passability on the 2-WU grid, dim = sizeWu / passCellWu, index z·dim + x, 1 = passable. */
  readonly passLowRes: Uint8Array;
  readonly passCellWu: number;
  /** Cells per edge of `passLowRes` (= sizeWu / passCellWu). */
  readonly passDim: number;
  /** Terrain height per 2-WU cell in WU (cell centre sample). */
  readonly heightLowRes: Float64Array;
  /** Connected-component label per cell (8-neighbourhood without corner cutting), −1 = impassable. */
  readonly components: Int32Array;
  /** Sector graph — not available before nav (adapter boundary, MS9). */
  readonly sectors: null;
  readonly bps: AiBlueprintTable;
  /** Start positions of the skirmish setup (lobby/loading screen knowledge, ai.md §3 point 0). */
  readonly starts: readonly Vec2[];
  /** Army → index into `starts`, −1 = inactive army (length 16). */
  readonly armyStart: readonly number[];
  /** Active armies in ascending order. */
  readonly activeArmies: readonly number[];
  /** Public team membership; these armies are never enemy targets. */
  readonly alliedArmies?: readonly number[];
  /** Actual static game placement rules; occupancy is rebuilt from perception only. */
  readonly placement?: {
    readonly terrain: Heightfield;
    readonly waterLevelRaw: number | null;
    readonly terrainCells: Uint8Array;
    readonly spots: Int32Array;
    readonly spotCount: number;
    readonly maxSlopeRaw: Int32Array;
    readonly spotKind: Int32Array;
  };
}

/** Own economy (per second resp. stored amounts). */
export interface EcoState {
  readonly massIncome: number;
  readonly energyIncome: number;
  readonly energyUpkeep: number;
  readonly massStored: number;
  readonly energyStored: number;
  readonly massCapacity: number;
  readonly energyCapacity: number;
  /** Stall ratio actually granted to mass consumers in the last economy phase (0..1). */
  readonly massRatio: number;
  readonly energyRatio: number;
  /** Full demand of all running consumers at ratio 1 (per second). */
  readonly massDemand: number;
  readonly energyDemand: number;
}

/** Current order of an own unit as the perception reports it. */
export const OrderKind = {
  Idle: 0,
  Move: 1,
  AttackMove: 2,
  Attack: 3,
  Build: 4,
  Assist: 5,
  Guard: 6,
  Repair: 7,
  Reclaim: 8,
  Upgrade: 9,
  Patrol: 10,
  Overcharge: 11,
} as const;
export type OrderKind = (typeof OrderKind)[keyof typeof OrderKind];
export const ORDER_KIND_COUNT = 12;

/**
 * Own unit (flyweight in callbacks: copy what you need, never keep the object).
 * `orderTarget` = target handle (Attack/Assist/Guard/Repair/Reclaim/Overcharge) or the handle of the
 * construction site (Build, 0 before the site exists); `orderBp` = blueprint index of a Build/Upgrade
 * order (−1 otherwise); `orderX/orderZ` = order position (Move/AttackMove/Patrol/Build), else the unit's.
 */
export interface OwnUnit {
  readonly handle: number;
  readonly bp: number;
  readonly x: number;
  readonly z: number;
  readonly hpFrac: number;
  /** Construction progress 0..1 (1 when complete). */
  readonly buildFrac: number;
  readonly complete: boolean;
  readonly order: OrderKind;
  readonly orderTarget: number;
  readonly orderBp: number;
  readonly orderX: number;
  readonly orderZ: number;
  /** Queued orders after the current one. */
  readonly queueLength: number;
  /** Factories: blueprint in production, −1 = idle. */
  readonly factoryBp: number;
  readonly factoryProgress: number;
  readonly factoryRepeat: boolean;
  /** In-place upgrade target blueprint, −1 = none. */
  readonly upgradingTo: number;
  /** Tick of the last damage taken, −1 = never. */
  readonly lastDamagedTick: number;
}

export type KnownKind = 'visible' | 'ghost' | 'blip';

/** Known enemy object (visible, ghost structure or radar blip). Flyweight in callbacks. */
export interface KnownUnit {
  /** Sim handle (stable identity while the object lives). */
  readonly id: number;
  readonly army: number;
  readonly kind: KnownKind;
  /** Blueprint index, −1 for blips. */
  readonly bp: number;
  readonly x: number;
  readonly z: number;
  /** HP fraction; only meaningful for `visible` (ghosts and blips report 1). */
  readonly hpFrac: number;
  readonly lastSeenTick: number;
}

/** Reasons the sim (or the arena) rejects a command. */
export const REJECT_REASONS = [
  'other',
  'malformed',
  'unknownOp',
  'invalidUnit',
  'notOwner',
  'notBuildable',
  'placement',
  'noTarget',
  'unitCap',
  'noEnergy',
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

export type PerceptionEvent =
  | {
      readonly kind: 'ownDamaged';
      readonly tick: number;
      readonly unit: number;
      /** Attacker handle or 0 if unknown (e.g. not visible). */
      readonly attacker: number;
      /** Attacker blueprint or −1 if not visible. */
      readonly attackerBp: number;
      readonly amount: number;
    }
  | { readonly kind: 'ownDestroyed'; readonly tick: number; readonly unit: number; readonly bp: number }
  | { readonly kind: 'ownCompleted'; readonly tick: number; readonly unit: number; readonly bp: number }
  | { readonly kind: 'enemySighted'; readonly tick: number; readonly id: number; readonly army: number; readonly bp: number }
  | { readonly kind: 'enemyDestroyed'; readonly tick: number; readonly id: number; readonly army: number; readonly bp: number }
  | {
      readonly kind: 'commandRejected';
      readonly tick: number;
      readonly seq: number;
      readonly reason: RejectReason;
      /** First unit of the rejected command (0 if none). */
      readonly unit: number;
    };

export type PerceptionEventKind = PerceptionEvent['kind'];

/**
 * What the AI may read (PLAN §3.10 + ai.md §11 point 9). Implementations only contain the own army's
 * profile of the frame: own units, visible enemies, ghosts, blips, own events.
 *
 * `freeMassSpots()`, `freeHydroSpots()` and `canPlace()` use ONLY terrain, own objects and KNOWN
 * enemy structures (visible or ghost) — never the sim's true occupancy (ai.md §5.3 R-08). A spot
 * occupied in the fog is reported free until it is seen.
 *
 * Callback objects may be flyweights: never store them, copy the fields.
 */
export interface PerceptionView {
  readonly tick: number;
  readonly army: number;
  readonly ownCount: number;
  readonly knownEnemyCount: number;
  eco(): EcoState;
  /** Own units in perception (slot) order; `filter` null = all. */
  forEachOwn(filter: CompiledCategoryExpr | null, fn: (u: OwnUnit) => void): void;
  /** Known enemies in perception order; blips (bp −1) only match a null filter. */
  forEachKnownEnemy(filter: CompiledCategoryExpr | null, fn: (u: KnownUnit) => void): void;
  freeMassSpots(): readonly Spot[];
  freeHydroSpots(): readonly Spot[];
  /** Placement check with known occupancy only; x/z = footprint centre in WU, rot 0..3 (90° steps). */
  canPlace(bp: number, x: number, z: number, rot: number): boolean;
  /** Own events since the previous perception, in emission order. */
  forEachEvent(fn: (e: PerceptionEvent) => void): void;
}
