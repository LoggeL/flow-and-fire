/**
 * Model definition (one file per unit: `content/models/<faction>/<unit>.ts`, `export default defineModel({...})`).
 *
 * Parts are animation groups of the merged-part mesh (PLAN §3.7): part 0 is always `hull` (moves with the unit
 * only), parts 1…8 rotate with their PartStream entry around their pivot (yaw about +Y, pitch about the part's
 * side axis) and follow their parent chain. Static kitbash pieces all belong to `hull`.
 */
import type { Palette } from './materials.ts';
import type { Vec3 } from './math.ts';
import type { Shape, Smooth } from './shapes.ts';

/** Max animated parts per unit (PartStream limit, `MAX_PARTS_PER_UNIT` in @faf/protocol). */
export const MAX_ANIMATED_PARTS = 8;

export type PartAnim = 'none' | 'yaw' | 'pitch' | 'yawpitch' | 'spin' | 'legs';

export interface PartDef {
  /** `hull` (root) or a lowercase name: turret, barrel, barrel_l, legs_l, rotor, arm, dish, … */
  readonly name: string;
  /** Parent part (default `hull`). Must be declared earlier. */
  readonly parent?: string;
  /** Rotation pivot in model space (WU, before the roster scale). Default [0, 0, 0]. */
  readonly pivot?: Vec3;
  /** Intended animation (metadata for the renderer/sim authors). Default `none` for hull, `yaw` otherwise. */
  readonly anim?: PartAnim;
  /**
   * Smooth vertex normals for all shapes of the part (shapes may override with their own `smooth`): `true` = crease
   * angle 80°, a number = crease angle in degrees, `false`/absent = flat shading (Varkan, Skarn). Sael and Aurith
   * bodies are smooth.
   */
  readonly smooth?: Smooth;
  /** Shapes in model space (not relative to the pivot). */
  readonly shapes: readonly Shape[];
}

/** Unit classes = icon base forms (faction.md §6.2). Drives budgets, footprint rules and default icon threshold. */
export type ModelClass = 'land' | 'air' | 'eng' | 'struct' | 'cmd' | 'wall' | 'naval';

export interface Budget {
  /** Max triangles LOD0 / LOD1 / LOD2. */
  readonly tris: readonly [number, number, number];
}

/**
 * Default budgets. LOD0 ≤ 350 is the roster/faction.md §3.3 cap for kitbash meshes (one draw per (visual, LOD));
 * LOD1 (from 60 WU, ≈ 40 px for a 1.4-WU tank) ≤ 220 and LOD2 (from 180 WU, mostly below the icon threshold,
 * shadows and large structures) ≤ 110 keep 1,000 units on screen around 100–200k triangles.
 */
export const DEFAULT_BUDGETS: Readonly<Record<ModelClass, Budget>> = {
  land: { tris: [350, 220, 110] },
  air: { tris: [350, 220, 110] },
  eng: { tris: [350, 220, 110] },
  naval: { tris: [350, 220, 110] },
  cmd: { tris: [350, 220, 110] },
  struct: { tris: [350, 220, 110] },
  wall: { tris: [64, 40, 24] },
};

/**
 * T4 (experimental) budget (docs/design/experimentals.md), used for every class when `tech` is 4 unless the faction
 * overrides it (`budgets.t4`, e.g. Skarn 1,200/700/350) or a model sets its own `budget`. One unit is the size of a
 * base section, is seen from further away and comes in single digits per match (one or two on screen), so LOD0 may
 * be ~4.5× a T1–T3 mesh; LOD1/LOD2 keep the same share of the whole scene as ~2–3 ordinary units.
 */
export const T4_BUDGET: Budget = { tris: [1600, 800, 320] };
/** Alias of `T4_BUDGET` (name used by the Varkan experimentals). */
export const EXPERIMENTAL_BUDGET: Budget = T4_BUDGET;

/** Tech levels: 0 = commander/wall, 1–3, 4 = experimental. */
export type Tech = 0 | 1 | 2 | 3 | 4;

/** Default LOD switch distances in WU (PLAN §3.9 `view.lod`). */
export const DEFAULT_LOD_DISTANCES: readonly [number, number] = [60, 180];
/** Default LOD distances of T4 units (larger models keep their detail further out). */
export const T4_LOD_DISTANCES: readonly [number, number] = [120, 360];

/**
 * Hover-offset convention: hover and glide units are authored standing on the ground (lowest point of the hover
 * pad / keel at y = 0). The build lifts the whole model (geometry and pivots) by `hover` WU **after** the roster
 * scale, so the GLB floats at its in-game view height and the gap shows in every tool. Metadata and scene extras
 * carry `hover`; the renderer adds only the idle bob (± HOVER_BOB, period HOVER_PERIOD_S, phase from the entity id)
 * and draws shadow/ground light at y = 0. Sim positions are unaffected (view only).
 * Heights: Sael hover by tech (f3 §3.2; roster `motion.hoverHeightView` is used automatically), Aurith glide 0.25.
 */
export const HOVER_HEIGHT: Readonly<Record<Tech, number>> = { 0: 0.25, 1: 0.25, 2: 0.3, 3: 0.35, 4: 0.45 };
export const GLIDE_HEIGHT = 0.25;
export const HOVER_BOB = 0.03;
export const HOVER_PERIOD_S = 3;
/** Default `iconThreshold`: screen length in px below which the strategic icon replaces the mesh (faction.md §3.2). */
export const DEFAULT_ICON_THRESHOLD = 25;

export interface ModelDef {
  /** Blueprint id, e.g. `core:lnd_t1_tank`. */
  readonly id: string;
  /** Display name (default from the roster). */
  readonly name?: string;
  readonly role?: string;
  /** Default from the roster (group/icon). */
  readonly class?: ModelClass;
  /** 1–3 = T1–T3, 4 = experimental (T4: `T4_BUDGET`/faction `budgets.t4` and `T4_LOD_DISTANCES`), 0 = no tier (commander). */
  readonly tech?: Tech;
  /** Footprint in grid cells [x, z] (default from the roster). */
  readonly footprint?: readonly [number, number];
  /** Roster scale (T2 1.3, …) baked into the export; default from the roster, else 1. */
  readonly scale?: number | { readonly xz: number; readonly y: number };
  /** Strategic icon id (`land_direct_t1`), default from the roster. */
  readonly icon?: string;
  readonly iconThreshold?: number;
  readonly lodDistances?: readonly [number, number];
  /** Budget override (rarely needed; justify in `notes`). */
  readonly budget?: Budget;
  /**
   * Material palette of this model: a palette name (`'varkan'`, `'skarn'`, `'sael'`, `'aurith'`, `'default'`) or an
   * own `definePalette({...})`. Default: the faction palette from `_faction.ts`.
   */
  readonly palette?: string | Palette;
  /**
   * Hover/glide height in WU (in-game, not scaled; see HOVER_HEIGHT): the build lifts the model by this amount.
   * Default from the roster (`motion.hoverHeightView`), else 0 (ground unit).
   */
  readonly hover?: number;
  readonly parts: readonly PartDef[];
  readonly notes?: string;
}

const PART_NAME = /^[a-z][a-z0-9_]*$/;

/** Validates the structure of a model definition and returns it unchanged (typed default export). */
export function defineModel<T extends ModelDef>(def: T): T {
  const errors = checkModelDef(def);
  if (errors.length > 0) throw new Error(`defineModel(${def.id}): ${errors.join('; ')}`);
  return def;
}

export function checkModelDef(def: ModelDef): string[] {
  const errors: string[] = [];
  if (!/^[a-z0-9_]+:[a-z0-9_]+$/.test(def.id)) errors.push(`id "${def.id}" must look like namespace:unit_id`);
  const first = def.parts[0];
  if (first === undefined || first.name !== 'hull') errors.push('the first part must be "hull"');
  if (first !== undefined && first.parent !== undefined) errors.push('hull has no parent');
  const seen = new Set<string>();
  for (const p of def.parts) {
    if (!PART_NAME.test(p.name)) errors.push(`part name "${p.name}" must match ${PART_NAME}`);
    if (seen.has(p.name)) errors.push(`part "${p.name}" declared twice`);
    if (p !== first && !seen.has(p.parent ?? 'hull')) errors.push(`part "${p.name}": parent "${p.parent ?? 'hull'}" must be declared before`);
    seen.add(p.name);
    if (p.shapes.length === 0) errors.push(`part "${p.name}" has no shapes`);
  }
  if (def.parts.length - 1 > MAX_ANIMATED_PARTS) {
    errors.push(`${def.parts.length - 1} animated parts > ${MAX_ANIMATED_PARTS} (PartStream limit)`);
  }
  if (def.footprint !== undefined && !(def.footprint[0] > 0 && def.footprint[1] > 0)) errors.push('footprint must be positive');
  if (def.lodDistances !== undefined && !(def.lodDistances[0] > 0 && def.lodDistances[1] > def.lodDistances[0])) {
    errors.push('lodDistances must be increasing and positive');
  }
  if (def.tech !== undefined && ![0, 1, 2, 3, 4].includes(def.tech)) errors.push(`tech ${String(def.tech)} must be 0–4`);
  if (def.hover !== undefined && !(def.hover >= 0 && def.hover <= 2)) errors.push(`hover ${def.hover} must be 0–2 WU`);
  return errors;
}
