/**
 * Visual table (render `VisualTable`, index = blueprint sim id = `UnitRecord.visual`) from the
 * compiled `view.json` plus the models loaded by the asset pipeline (P3): a visual with
 * `view.mesh` gets the model's LOD meshes (merged parts), all visuals get their `view.lod`
 * distances; without a loaded model the placeholder from `view.placeholder` is drawn.
 */
import type { SimBpTable } from '@faf/blueprints/simbin';
import type { ViewBundle } from '@faf/blueprints/view';
import type { MeshData, VisualEntry, VisualTable } from '@faf/render';
import type { ModelPartInfo } from './assets/glb.ts';

/** Model lookup: mesh asset id → LOD meshes (e.g. `LoadedAssets.models`). */
export type ModelLookup =
  | ReadonlyMap<string, { readonly lods: readonly MeshData[]; readonly parts?: readonly ModelPartInfo[] }>
  | ((meshId: string) => readonly MeshData[] | undefined);

/** View-only bindings. Indices address the original merged mesh, never the Sim mount-part enum. */
export interface RigBinding {
  readonly mount: number;
  readonly yaw: boolean;
  readonly pitch: boolean;
  /** Opposed hip rotation driven only by accepted horizontal movement. */
  readonly gait?: 1 | -1;
  /** Structure motion needs current private-safe economy observations, never wall-clock time. */
  readonly activity?: 'factory-gate' | 'mex-pump' | 'radar-spin';
}
export interface RigVisualEntry extends VisualEntry {
  /** Compiled public category, used only to present accepted factory rally watches. */
  readonly factory?: boolean;
  readonly modelParts?: readonly ModelPartInfo[];
  /** Index = mesh part id. Unbound parts retain their authored rest pose. */
  readonly rig?: readonly (RigBinding | undefined)[];
}

export function combatRig(id: string, parts: readonly ModelPartInfo[]): readonly (RigBinding | undefined)[] {
  const rig: (RigBinding | undefined)[] = new Array(parts.length);
  const bind = (name: string, mount: number, yaw: boolean, pitch: boolean): void => {
    const i = parts.findIndex(p => p.name === name);
    if (i > 0) rig[i] = { mount, yaw, pitch };
  };
  const activity = (name: string, anim: string, kind: NonNullable<RigBinding['activity']>): void => {
    const i = parts.findIndex(p => p.name === name && p.anim === anim);
    if (i > 0) rig[i] = { mount: -1, yaw: false, pitch: false, activity: kind };
  };
  if (id === 'core:fac_land_t1' || id === 'core:fac_land_t2') {
    activity('gate', 'pitch', 'factory-gate');
  } else if (id === 'core:str_t1_mex' || id === 'core:str_t2_mex') {
    activity('pump', 'pitch', 'mex-pump');
  } else if (id === 'core:str_t1_radar') {
    activity('wing', 'yaw', 'radar-spin');
  }
  for (const [name, gait] of [['legs_l', 1], ['legs_r', -1]] as const) {
    const i = parts.findIndex(p => p.name === name && p.anim === 'legs');
    if (i > 0) rig[i] = { mount: -1, yaw: false, pitch: false, gait };
  }
  if (id === 'core:cmd_commander' || id.startsWith('core:cmd_commander_')) {
    bind('torso', 0, true, false);
    bind('barrel', 0, false, true);
  } else if (id === 'core:lnd_t3_heavy') {
    bind('turret', 0, true, true);
    bind('turret2', 1, true, true);
  } else if (id === 'core:lnd_t1_arty') {
    bind('boom', 0, true, false);
    bind('ladle', 0, false, true);
  } else {
    // A turret/barrel pair also supports legacy cube_bot assets without anim tags.
    bind('turret', 0, true, false);
    bind('barrel', 0, false, true);
  }
  return rig;
}

export function visualTableFromView(view: ViewBundle, models?: ModelLookup): VisualTable {
  const find = (id: string): readonly MeshData[] | undefined => {
    if (models === undefined) return undefined;
    if (typeof models === 'function') return models(id);
    return models.get(id)?.lods;
  };
  return view.visuals.map((v): RigVisualEntry => {
    const ph = v.placeholder;
    const spec = {
      hull: ph.hull,
      ...(ph.turret !== undefined ? { turret: ph.turret } : {}),
      size: [ph.size[0], ph.size[1], ph.size[2]] as [number, number, number],
      ...(ph.color !== undefined ? { color: [ph.color[0], ph.color[1], ph.color[2]] as [number, number, number] } : {}),
    };
    const meshes = v.mesh === undefined ? undefined : find(v.mesh);
    const modelParts = v.mesh === undefined || models === undefined || typeof models === 'function'
      ? undefined : models.get(v.mesh)?.parts;
    const rig = modelParts !== undefined ? combatRig(v.id, modelParts)
      : meshes === undefined && ph.turret !== undefined ? [undefined, { mount: 0, yaw: true, pitch: true }] : undefined;
    return {
      spec,
      factory: v.categories.includes('FACTORY'),
      ...(modelParts !== undefined ? { modelParts } : {}),
      ...(rig !== undefined ? { rig } : {}),
      ...(v.icon !== undefined ? { icon: v.icon } : {}),
      iconThreshold: v.iconThreshold,
      tech: v.tech,
      selectionRadius: v.selectionRadius,
      ...(meshes !== undefined && meshes.length > 0 ? { meshes: meshes.slice(0, 3) } : {}),
      ...(v.lod !== undefined ? { lodDistancesWU: [v.lod[0], v.lod[1]] as const } : {}),
    };
  });
}

/** Category name of commanders (ACU, MS5); `jumpToCommander` looks for units with it. */
export const COMMAND_CATEGORY = 'COMMAND';

/** One flag per blueprint sim id (= visual): 1 if the blueprint has category COMMAND. */
export function commanderVisuals(bp: SimBpTable): Uint8Array {
  const out = new Uint8Array(bp.count);
  const bit = bp.categoryNames.indexOf(COMMAND_CATEGORY);
  if (bit < 0) return out;
  const w = bit >>> 5;
  const m = 1 << (bit & 31);
  for (let i = 0; i < bp.count; i++) if ((bp.categoryWord(i, w) & m) !== 0) out[i] = 1;
  return out;
}
