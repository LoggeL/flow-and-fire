/**
 * Visual table (render `VisualTable`, index = blueprint sim id = `UnitRecord.visual`) from the
 * compiled `view.json` plus the models loaded by the asset pipeline (P3): a visual with
 * `view.mesh` gets the model's LOD meshes (merged parts), all visuals get their `view.lod`
 * distances; without a loaded model the placeholder from `view.placeholder` is drawn.
 */
import type { SimBpTable } from '@faf/blueprints/simbin';
import type { ViewBundle } from '@faf/blueprints/view';
import type { MeshData, VisualEntry, VisualTable } from '@faf/render';

/** Model lookup: mesh asset id → LOD meshes (e.g. `LoadedAssets.models`). */
export type ModelLookup =
  | ReadonlyMap<string, { readonly lods: readonly MeshData[] }>
  | ((meshId: string) => readonly MeshData[] | undefined);

export function visualTableFromView(view: ViewBundle, models?: ModelLookup): VisualTable {
  const find = (id: string): readonly MeshData[] | undefined => {
    if (models === undefined) return undefined;
    if (typeof models === 'function') return models(id);
    return models.get(id)?.lods;
  };
  return view.visuals.map((v): VisualEntry => {
    const ph = v.placeholder;
    const spec = {
      hull: ph.hull,
      size: [ph.size[0], ph.size[1], ph.size[2]] as [number, number, number],
      ...(ph.color !== undefined ? { color: [ph.color[0], ph.color[1], ph.color[2]] as [number, number, number] } : {}),
    };
    const meshes = v.mesh === undefined ? undefined : find(v.mesh);
    return {
      spec,
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
