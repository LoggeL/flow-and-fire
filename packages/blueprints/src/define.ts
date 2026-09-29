/**
 * Authoring helpers for blueprint content (PLAN §3.9). Content files live in
 * `content/blueprints/<ns>/<type>/*.ts` and default-export the result of `defineUnit` /
 * `definePatch` (or an array of them).
 *
 * This module has no runtime dependencies (no TypeBox) so content files stay cheap to load.
 * Values are validated by the compiler, not by these helpers.
 */

/** Movement layer names (PLAN §3.1). The MVP accepts `land` and `air`. */
export type LayerName = 'land' | 'water' | 'seabed' | 'hover' | 'amphibious' | 'air';

/** Procedural placeholder hull (PLAN §3.7 "Platzhalter"). */
export interface PlaceholderDef {
  readonly hull: 'box' | 'cyl';
  /** Extent in WU: x (forward), y (height), z (side). */
  readonly size: readonly [number, number, number];
  /** Base color, linear RGB 0..1. */
  readonly color?: readonly [number, number, number];
}

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
      /** Acceleration (and braking) in WU/s². */
      readonly accel: number;
      /** Turn rate in degrees/s. */
      readonly turnRateDeg: number;
      /** Pathing size class (clearance, PLAN §3.8). */
      readonly sizeClass: number;
      /** Footprint in whole WU cells [w, h]. */
      readonly footprint: readonly [number, number];
      /** Maximum slope (rise per WU). */
      readonly maxSlope: number;
      /** Collision/separation radius in WU (default: max(footprint) / 2). */
      readonly radius?: number;
    };
    readonly intel?: { readonly vision?: number };
  };
  readonly view: {
    readonly placeholder: PlaceholderDef;
    readonly icon?: string;
    /** Screen size (px) below which the strategic icon replaces the mesh. */
    readonly iconThreshold?: number;
    readonly nameKey?: string;
    readonly descKey?: string;
  };
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

/** Input of `defineUnit`: a unit with `extends` may leave inherited fields out. */
export type UnitBlueprintInput =
  | (UnitBlueprint & { readonly extends?: undefined })
  | (DeepPatch<Omit<UnitBlueprint, 'id' | 'extends'>> & { readonly id: string; readonly extends: string })
  | (DeepPatch<Omit<UnitBlueprint, 'id' | 'abstract'>> & { readonly id: string; readonly abstract: true });

/** A unit definition as exported by a content file. */
export interface UnitDefinition {
  readonly kind: 'unit';
  readonly data: UnitBlueprintInput;
}

/** A merge patch applied to an existing blueprint before `extends` is resolved (PLAN §3.9 step 1). */
export interface PatchDefinition {
  readonly kind: 'patch';
  /** Id of the patched blueprint. */
  readonly target: string;
  readonly patch: DeepPatch<Omit<UnitBlueprint, 'id'>>;
}

export type BlueprintDefinition = UnitDefinition | PatchDefinition;

/** Declares a unit blueprint. */
export function defineUnit(data: UnitBlueprintInput): UnitDefinition {
  return { kind: 'unit', data };
}

/** Declares a merge patch on blueprint `target`. */
export function definePatch(target: string, patch: DeepPatch<Omit<UnitBlueprint, 'id'>>): PatchDefinition {
  return { kind: 'patch', target, patch };
}

/** True if `v` looks like the result of defineUnit/definePatch. */
export function isBlueprintDefinition(v: unknown): v is BlueprintDefinition {
  if (typeof v !== 'object' || v === null) return false;
  const k = (v as { kind?: unknown }).kind;
  if (k === 'unit') return typeof (v as { data?: unknown }).data === 'object' && (v as { data?: unknown }).data !== null;
  if (k === 'patch') {
    return typeof (v as { target?: unknown }).target === 'string' && typeof (v as { patch?: unknown }).patch === 'object';
  }
  return false;
}
