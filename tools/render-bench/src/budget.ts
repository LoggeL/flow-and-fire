/**
 * Draw-call budget of a scenario (upper bound per frame). Every pass of the prototype pipeline
 * issues a bounded number of draws, independent of the unit/prop count:
 *
 * - terrain: 1 instanced draw (all visible patches), water: 1
 * - units: one draw per non-empty (visual, LOD) bucket ⇒ ≤ visuals × 3
 * - props: one draw per (mesh, LOD) ⇒ ≤ meshes × 2, plus 1 impostor draw (all meshes, one atlas)
 * - CSM, per cascade: units with reduced LOD (LOD 1/2) ⇒ ≤ visuals × 2 every frame; the static
 *   layer (terrain 1 + props meshes × 1 LOD) only in frames that refresh the cache
 * - blob shadows: 1; post: bloom down (levels) + up (levels − 1) + composite 1 + FXAA 1
 * - facade (ms2): terrain + water + icons + 3 overlay draws (lines, markers, HP bars;
 *   `FIXED_PASS_DRAWS` = 6 since MS3) + units; the icon draw is booked on the overlay column
 */
import { FIXED_PASS_DRAWS } from '@faf/render';
import { PROP_LODS, PROP_MESHES, UNIT_LODS, UNIT_VISUALS } from './meshes.ts';
import type { ScenarioConfig } from './scenarios.ts';

/** LOD levels a shadow caster may use ("reduced LOD": camera LOD + 1, at least 1). */
export const SHADOW_UNIT_LODS = 2;

export interface DrawBudget {
  readonly terrain: number;
  readonly water: number;
  readonly units: number;
  readonly props: number;
  readonly impostors: number;
  readonly shadowUnits: number;
  readonly shadowStatic: number;
  readonly blob: number;
  readonly post: number;
  readonly overlay: number;
  /** Upper bound of a frame without a static shadow refresh. */
  readonly steady: number;
  /** Upper bound of a frame that also re-renders the static shadow cache of every cascade. */
  readonly worst: number;
}

export interface BudgetShape {
  readonly unitVisuals: number;
  readonly unitLods: number;
  readonly propMeshes: number;
  readonly propLods: number;
}

export const SCENE_SHAPE: BudgetShape = {
  unitVisuals: UNIT_VISUALS,
  unitLods: UNIT_LODS,
  propMeshes: PROP_MESHES,
  propLods: PROP_LODS,
};

export function drawBudget(cfg: ScenarioConfig, shape: BudgetShape = SCENE_SHAPE): DrawBudget {
  const units = shape.unitVisuals * shape.unitLods;
  if (cfg.facade) {
    const steady = units + FIXED_PASS_DRAWS;
    return {
      terrain: 1,
      water: 1,
      units,
      props: 0,
      impostors: 0,
      shadowUnits: 0,
      shadowStatic: 0,
      blob: 0,
      post: 0,
      overlay: FIXED_PASS_DRAWS - 2,
      steady,
      worst: steady,
    };
  }
  const props = cfg.props ? shape.propMeshes * shape.propLods : 0;
  const impostors = cfg.props && Number.isFinite(cfg.impostorDistanceWU) ? 1 : 0;
  const csm = cfg.shadows === 'csm' ? cfg.cascades : 0;
  const shadowUnits = csm * shape.unitVisuals * Math.min(SHADOW_UNIT_LODS, shape.unitLods);
  const shadowStatic = csm * (1 + (cfg.props ? shape.propMeshes : 0));
  const blob = cfg.shadows === 'blob' ? 1 : 0;
  const bloom = cfg.bloom ? cfg.bloomLevels + Math.max(0, cfg.bloomLevels - 1) : 0;
  const post = bloom + 1 + (cfg.fxaa ? 1 : 0);
  const steady = 1 + 1 + units + props + impostors + shadowUnits + blob + post;
  return {
    terrain: 1,
    water: 1,
    units,
    props,
    impostors,
    shadowUnits,
    shadowStatic,
    blob,
    post,
    overlay: 0,
    steady,
    worst: steady + shadowStatic,
  };
}
