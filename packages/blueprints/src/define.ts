/**
 * Authoring helpers for blueprint content (PLAN §3.9). Content files live in
 * `content/blueprints/<ns>/<type>/*.ts` and default-export the result of a `define*` helper
 * (`defineUnit`, `defineWeapon`, `defineProjectile`, `defineProp`, `defineEffect`,
 * `defineFaction`, `defineAiProfile`, `definePatch`) or an array of them.
 *
 * This module has no runtime dependencies (no TypeBox) so content files stay cheap to load.
 * Values are validated by the compiler, not by these helpers.
 *
 * Every type shares the same identity/inheritance fields: a namespaced `id` (`ns:name`), an
 * optional `extends` (parent of the same type, merged below this one) and `abstract` (a base that
 * is never emitted and may be incomplete).
 */

/** Movement layer names (PLAN §3.1). The MVP accepts `land` and `air`. */
export type LayerName = 'land' | 'water' | 'seabed' | 'hover' | 'amphibious' | 'air';

/** The blueprint types (PLAN §3.9). */
export type BlueprintKind = 'unit' | 'weapon' | 'projectile' | 'prop' | 'effect' | 'faction' | 'aiProfile';

/** All blueprint kinds in a fixed order (used for messages and output order). */
export const BLUEPRINT_KINDS: readonly BlueprintKind[] = ['unit', 'weapon', 'projectile', 'prop', 'effect', 'faction', 'aiProfile'];

/** RGB color, linear 0..1. */
export type Rgb = readonly [number, number, number];
/** Vector in WU: x (forward), y (up), z (side). */
export type Vec3 = readonly [number, number, number];

/** Procedural placeholder turret (MS3): drawn on top of the hull at `offset`. */
export interface PlaceholderTurretDef {
  readonly hull: 'box' | 'cyl';
  /** Extent in WU: x (forward), y (height), z (side). */
  readonly size: Vec3;
  /** Position of the turret base relative to the hull origin (WU). */
  readonly offset: Vec3;
}

/** Procedural placeholder hull (PLAN §3.7 "Platzhalter"). */
export interface PlaceholderDef {
  readonly hull: 'box' | 'cyl';
  /** Extent in WU: x (forward), y (height), z (side). */
  readonly size: Vec3;
  /** Base color, linear RGB 0..1. */
  readonly color?: Rgb;
  /** Optional turret (rendered from MS3 wave 1 on; older renderers ignore it). */
  readonly turret?: PlaceholderTurretDef;
}

/** Where a weapon sits: on the hull (fixed arc around the hull heading) or on the turret. */
export type WeaponPart = 'hull' | 'turret';

/** A weapon mount of a unit (array merged by `id`). */
export interface WeaponMountDef {
  /** Mount id, unique within the unit (merge key for `extends`/patches). */
  readonly id: string;
  /** Weapon blueprint id. */
  readonly ref: string;
  readonly part: WeaponPart;
  /** Firing arc in degrees (360 = all around). */
  readonly arcDeg: number;
  /** Turret/weapon yaw rate in degrees/s. */
  readonly yawRateDeg: number;
  /** Layers this weapon can hit. */
  readonly layers: readonly LayerName[];
  /** Target priorities, first match wins: category expressions (e.g. `MOBILE & LAND`). */
  readonly priorities: readonly string[];
}

/** Veterancy profile of a unit. */
export type VeterancyProfile = 'default' | 'none';

/** Fully specified unit blueprint (the shape a concrete unit has after `extends`). */
export interface UnitBlueprint {
  /** Namespaced id `ns:name` (lower case, digits, `_`). */
  readonly id: string;
  /** Parent blueprint id; its values are merged below this one's. */
  readonly extends?: string;
  /** Abstract blueprints are only bases: never emitted, may be incomplete. */
  readonly abstract?: boolean;
  /** Category names (upper case), e.g. `['LAND', 'MOBILE', 'TECH1']`. */
  readonly categories: readonly string[];
  readonly sim: {
    readonly health: { readonly max: number };
    readonly motion: {
      readonly layer: LayerName;
      /** Top speed in WU/s. */
      readonly speed: number;
      /** Acceleration in WU/s². */
      readonly accel: number;
      /** Turn rate in degrees/s. */
      readonly turnRateDeg: number;
      /** Pathing size class (clearance, PLAN §3.8; land units 0..3, class rule see DECISIONS 23). */
      readonly sizeClass: number;
      /** Footprint in whole WU cells [w, h]. */
      readonly footprint: readonly [number, number];
      /** Maximum slope (rise per WU). */
      readonly maxSlope: number;
      /** Collision/separation radius in WU (default: max(footprint) / 2). */
      readonly radius?: number;
      /** Collision mass/priority (integer ≥ 1; default from sizeClass: 1, 2, 4, 8, …). */
      readonly mass?: number;
      /** Tracks: turns in place before driving off (default: true for land units). */
      readonly turnInPlace?: boolean;
      /** Braking deceleration in WU/s² (default: SPK2 factor × accel, see DEFAULT_BRAKE_FACTOR). */
      readonly brake?: number;
    };
    readonly intel?: { readonly vision?: number };
    /** Build cost; `buildableBy` is a category expression over the builder's categories. */
    readonly economy?: {
      readonly mass: number;
      readonly energy: number;
      /** Build time in build points (integer; build power × seconds). */
      readonly buildTime: number;
      readonly buildableBy?: string;
      readonly buildPower?: number;
      readonly buildRange?: number;
      readonly massIncome?: number;
      readonly energyIncome?: number;
      readonly massStorage?: number;
      readonly energyStorage?: number;
      readonly massUpkeep?: number;
      readonly energyUpkeep?: number;
      readonly stallsOff?: boolean;
      readonly spotKind?: 'mass' | 'hydro';
    };
    readonly weapons?: readonly WeaponMountDef[];
    /** Hit box extent in WU [x, y, z] (default: collision diameter 2 · radius on every axis). */
    readonly hitbox?: Vec3;
    /** Wreck left behind (fractions of the build mass / max HP). Absent ⇒ no wreck. */
    readonly wreck?: { readonly massFraction: number; readonly hpFraction: number };
    /** Weapon fired on death (e.g. a death explosion) or null. */
    readonly deathWeapon?: string | null;
    readonly veterancy?: VeterancyProfile;
    /** Unit this one upgrades into (in place) or null. */
    readonly upgradesTo?: string | null;
    /** Behavior registry keys (PLAN §3.1). No behavior is registered in MS3. */
    readonly behaviors?: readonly string[];
    /** Toggle registry keys. No toggle is registered in MS3. */
    readonly toggles?: readonly string[];
  };
  readonly view: {
    readonly placeholder: PlaceholderDef;
    /**
     * Asset id of the model (asset pipeline, e.g. `units/cube_bot`); without it the placeholder is
     * drawn. View only: never part of simHash.
     */
    readonly mesh?: string;
    /** LOD switch distances in WU [LOD0→1, LOD1→2] (renderer default [60, 180]). View only. */
    readonly lod?: readonly [number, number];
    /** Strategic icon id (`ICON_IDS` in view.ts); mandatory for game units. */
    readonly icon?: string;
    /**
     * Projected height in CSS px below which the strategic icon replaces the mesh (default 14;
     * semantics see DECISIONS 23).
     */
    readonly iconThreshold?: number;
    /** Selection ring radius in WU (default: derived from radius/footprint). */
    readonly selectionRadius?: number;
    /** Build-menu hotkey slot (single upper-case letter or digit). */
    readonly hotkeySlot?: string;
    /** Effect slots → effect blueprint ids (e.g. `{ death: 'core:fx_explosion_small' }`). */
    readonly fx?: Readonly<Record<string, string>>;
    readonly nameKey?: string;
    readonly descKey?: string;
  };
}

/** Weapon blueprint. */
export interface WeaponBlueprint {
  readonly id: string;
  readonly extends?: string;
  readonly abstract?: boolean;
  readonly sim: {
    /** Maximum range in WU. */
    readonly range: number;
    /** Minimum range in WU (default 0). */
    readonly minRange?: number;
    /** Damage per projectile (integer HP). */
    readonly damage: number;
    /** Area damage radius in WU (default 0 = single target). */
    readonly damageRadius?: number;
    readonly overcharge?: boolean;
    readonly damageInnerRadius?:number;
    readonly damageFalloff?:'quarter';
    /** Seconds between salvos. */
    readonly reloadSec: number;
    /** Launch speed in WU/s. */
    readonly muzzleVelocity: number;
    /** Projectile blueprint id. */
    readonly projectile: string;
    /** Projectiles per salvo. */
    readonly salvo: number;
    /** Seconds between the shots of a salvo (default 0). */
    readonly salvoIntervalSec?: number;
  };
  readonly view?: {
    /** Effect slots (`muzzle`, `impact`) → effect ids. */
    readonly fx?: Readonly<Record<string, string>>;
  };
}

/** Projectile blueprint. */
export interface ProjectileBlueprint {
  readonly id: string;
  readonly extends?: string;
  readonly abstract?: boolean;
  readonly sim: {
    readonly kind: 'linear' | 'ballistic' | 'homing';
    /** Flight speed in WU/s. */
    readonly speed: number;
    /** Gravity in WU/s² (ballistic only, > 0 there; default 0). */
    readonly gravity?: number;
    readonly lifetimeSec: number;
    /** Homing turn rate in degrees/s (homing only, required there). */
    readonly turnRateDeg?: number;
  };
  readonly view?: {
    readonly shape?: 'sphere' | 'tracer';
    /** Visual size in WU. */
    readonly size?: number;
    readonly color?: Rgb;
    /** Trail effect id. */
    readonly trailFx?: string;
  };
}

/** Prop blueprint (rocks, trees, wrecks placed by the map). */
export interface PropBlueprint {
  readonly id: string;
  readonly extends?: string;
  readonly abstract?: boolean;
  readonly sim: {
    readonly reclaim: {
      /** Mass gained by reclaiming (integer). */
      readonly mass: number;
      /** Energy gained by reclaiming (integer). */
      readonly energy: number;
      /** Reclaim time in seconds at build power 1. */
      readonly timeSec: number;
    };
    /** True if the prop stops projectiles. */
    readonly blocksShots: boolean;
    /** Blocked cells [w, h] (0 = does not block pathing). */
    readonly footprint: readonly [number, number];
    /** Hit points (integer; absent = indestructible). */
    readonly health?: number;
  };
  readonly view: {
    readonly placeholder: PlaceholderDef;
    readonly mesh?: string;
    readonly lod?: readonly [number, number];
  };
}

/** Effect blueprint (view only: never part of sim.bin/simHash). */
export interface EffectBlueprint {
  readonly id: string;
  readonly extends?: string;
  readonly abstract?: boolean;
  readonly view: {
    readonly kind: 'flash' | 'burst' | 'trail' | 'decal';
    readonly color: Rgb;
    /** Size in WU. */
    readonly size: number;
    readonly durationSec: number;
    /** Particle count (burst/trail, default 1). */
    readonly count?: number;
  };
}

/** Faction blueprint. */
export interface FactionBlueprint {
  readonly id: string;
  readonly extends?: string;
  readonly abstract?: boolean;
  /** Unit blueprint ids of the faction. */
  readonly units: readonly string[];
  /** The unit a player starts with (must be in `units`). */
  readonly startUnit: string;
  /** Team default color, linear RGB. */
  readonly color: Rgb;
  readonly nameKey?: string;
}

/** A weighted category rule of an AI profile. */
export interface AiWeightDef {
  readonly id: string;
  /** Category expression. */
  readonly categories: string;
  readonly weight: number;
}

/** AI profile blueprint: category-based weights (MS3: schema + validation only). */
export interface AiProfileBlueprint {
  readonly id: string;
  readonly extends?: string;
  readonly abstract?: boolean;
  /** Build preferences (share of production). */
  readonly build: readonly AiWeightDef[];
  /** Target preferences. */
  readonly attack: readonly AiWeightDef[];
  readonly nameKey?: string;
}

/** Blueprint shape per kind. */
export interface BlueprintOfKind {
  unit: UnitBlueprint;
  weapon: WeaponBlueprint;
  projectile: ProjectileBlueprint;
  prop: PropBlueprint;
  effect: EffectBlueprint;
  faction: FactionBlueprint;
  aiProfile: AiProfileBlueprint;
}

/**
 * Patch/partial shape: every field optional, `null` deletes the inherited value
 * (merge semantics, see merge.ts).
 */
export type DeepPatch<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { readonly [K in keyof T]?: DeepPatch<T[K]> | null }
    : T;

/** Input of a define helper: with `extends` or `abstract: true` inherited fields may be left out. */
export type BlueprintInput<T extends { id: string; extends?: string; abstract?: boolean }> =
  | (T & { readonly extends?: undefined })
  | (DeepPatch<Omit<T, 'id' | 'extends'>> & { readonly id: string; readonly extends: string })
  | (DeepPatch<Omit<T, 'id' | 'abstract'>> & { readonly id: string; readonly abstract: true });

export type UnitBlueprintInput = BlueprintInput<UnitBlueprint>;
export type WeaponBlueprintInput = BlueprintInput<WeaponBlueprint>;
export type ProjectileBlueprintInput = BlueprintInput<ProjectileBlueprint>;
export type PropBlueprintInput = BlueprintInput<PropBlueprint>;
export type EffectBlueprintInput = BlueprintInput<EffectBlueprint>;
export type FactionBlueprintInput = BlueprintInput<FactionBlueprint>;
export type AiProfileBlueprintInput = BlueprintInput<AiProfileBlueprint>;

/** A typed definition as exported by a content file. */
export interface KindDefinition<K extends BlueprintKind, D> {
  readonly kind: K;
  readonly data: D;
}

export type UnitDefinition = KindDefinition<'unit', UnitBlueprintInput>;
export type WeaponDefinition = KindDefinition<'weapon', WeaponBlueprintInput>;
export type ProjectileDefinition = KindDefinition<'projectile', ProjectileBlueprintInput>;
export type PropDefinition = KindDefinition<'prop', PropBlueprintInput>;
export type EffectDefinition = KindDefinition<'effect', EffectBlueprintInput>;
export type FactionDefinition = KindDefinition<'faction', FactionBlueprintInput>;
export type AiProfileDefinition = KindDefinition<'aiProfile', AiProfileBlueprintInput>;

/** A merge patch applied to an existing blueprint (any kind) before `extends` is resolved (PLAN §3.9 step 1). */
export interface PatchDefinition {
  readonly kind: 'patch';
  /** Id of the patched blueprint. */
  readonly target: string;
  readonly patch: Readonly<Record<string, unknown>>;
}

export type TypedDefinition =
  | UnitDefinition
  | WeaponDefinition
  | ProjectileDefinition
  | PropDefinition
  | EffectDefinition
  | FactionDefinition
  | AiProfileDefinition;

export type BlueprintDefinition = TypedDefinition | PatchDefinition;

/** Declares a unit blueprint. */
export function defineUnit(data: UnitBlueprintInput): UnitDefinition {
  return { kind: 'unit', data };
}

/** Declares a weapon blueprint. */
export function defineWeapon(data: WeaponBlueprintInput): WeaponDefinition {
  return { kind: 'weapon', data };
}

/** Declares a projectile blueprint. */
export function defineProjectile(data: ProjectileBlueprintInput): ProjectileDefinition {
  return { kind: 'projectile', data };
}

/** Declares a prop blueprint. */
export function defineProp(data: PropBlueprintInput): PropDefinition {
  return { kind: 'prop', data };
}

/** Declares an effect blueprint (view only). */
export function defineEffect(data: EffectBlueprintInput): EffectDefinition {
  return { kind: 'effect', data };
}

/** Declares a faction blueprint. */
export function defineFaction(data: FactionBlueprintInput): FactionDefinition {
  return { kind: 'faction', data };
}

/** Declares an AI profile blueprint. */
export function defineAiProfile(data: AiProfileBlueprintInput): AiProfileDefinition {
  return { kind: 'aiProfile', data };
}

/** Declares a merge patch on blueprint `target` (any kind; typed for units by default). */
export function definePatch<T extends object = UnitBlueprint>(target: string, patch: DeepPatch<Omit<T, 'id'>>): PatchDefinition {
  return { kind: 'patch', target, patch: patch as Readonly<Record<string, unknown>> };
}

/** True if `v` looks like the result of one of the define helpers. */
export function isBlueprintDefinition(v: unknown): v is BlueprintDefinition {
  if (typeof v !== 'object' || v === null) return false;
  const k = (v as { kind?: unknown }).kind;
  if (typeof k === 'string' && (BLUEPRINT_KINDS as readonly string[]).includes(k)) {
    return typeof (v as { data?: unknown }).data === 'object' && (v as { data?: unknown }).data !== null;
  }
  if (k === 'patch') {
    return typeof (v as { target?: unknown }).target === 'string' && typeof (v as { patch?: unknown }).patch === 'object';
  }
  return false;
}
