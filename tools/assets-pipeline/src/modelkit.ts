/** Existing art is compiled only when a live blueprint references it. No simulation data enters this bridge. */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BuiltModel, FactionDef, ModelDef as KitModelDef, RosterFile } from '@faf/modelkit';
import { allModels, type ModelDef } from './models.ts';

interface ModelEntry { readonly unit: string; readonly def: KitModelDef }
interface FactionEntry { readonly def: FactionDef; readonly roster: RosterFile | null; readonly models: readonly ModelEntry[] }
interface Registry {
  loadFaction(slug: string, root?: string): Promise<FactionEntry>;
  buildEntry(faction: FactionEntry, model: ModelEntry): BuiltModel;
}

/** Explicit view aliases, preserving the authoritative blueprint IDs. */
export const LIVE_VARKAN_MODELS: Readonly<Record<string, string>> = {
  'core:cmd_commander': 'cmd_commander', 'core:eng_t1': 'lnd_t1_engineer',
  'core:fac_land_t1': 'str_t1_fac_land', 'core:lnd_t1_arty': 'lnd_t1_arty',
  'core:lnd_t1_scout': 'lnd_t1_scout', 'core:lnd_t1_tank': 'lnd_t1_tank',
  'core:lnd_t2_tank': 'lnd_t2_tank', 'core:lnd_t3_heavy': 'lnd_t3_bot',
  'core:str_t1_estorage': 'str_t1_estore', 'core:str_t1_mex': 'str_t1_mex',
  'core:str_t1_pgen': 'str_t1_pgen',
  'core:fac_land_t2': 'str_t2_fac_land', 'core:fac_land_t3': 'str_t3_fac_land',
  'core:str_t1_pd': 'str_t1_pd', 'core:str_t1_radar': 'str_t1_radar',
};

export function fromModelkit(id: string, built: BuiltModel, viewScale = 1): ModelDef {
  if (built.errors.length > 0) throw new Error(`${id}: ${built.errors.join('; ')}`);
  if (!(viewScale > 0) || !Number.isFinite(viewScale)) throw new Error(`${id}: invalid view scale`);
  return { id, sourceModelId: built.id, forward: '+z', viewScale,
    parts: built.parts.map(part => ({ name: part.name, parent: part.parent,
      pivot: part.pivot.map(value => value * viewScale) as [number, number, number], anim: part.anim })),
    lods: built.lods.map(lod => ({ positions: Float32Array.from(lod.positions, value => value * viewScale), normals: new Float32Array(lod.normals),
      colors: new Float32Array(lod.colors), mask: new Uint8Array(lod.mask), partIds: new Uint8Array(lod.partIds),
      indices: lod.indices instanceof Uint32Array ? new Uint32Array(lod.indices) : new Uint16Array(lod.indices) })) };
}

export async function referencedModels(meshes: readonly string[], repoRoot: string,
  structureFootprints: ReadonlyMap<string, readonly [number, number]> = new Map()): Promise<ModelDef[]> {
  const models = allModels(); // Keep the original cube benchmark artifact, including when no scene references it.
  const requested = [...new Set(meshes)].filter(id => !models.some(model => model.id === id)).sort();
  if (requested.length === 0) return models;
  // The content registry owns discovery, palette/default resolution and source validation. Dynamic
  // loading keeps Node content modules out of the browser-facing package/project compilation.
  const registry = await import(pathToFileURL(join(repoRoot, 'content/models/registry.ts')).href) as Registry;
  const faction = await registry.loadFaction('varkan', join(repoRoot, 'content/models'));
  for (const id of requested) {
    const unit = id.startsWith('units/varkan/') ? id.slice('units/varkan/'.length) : null;
    const entry = unit === null ? undefined : faction.models.find(model => model.unit === unit);
    if (entry === undefined) throw new Error(`Unknown referenced model '${id}'`);
    const built = registry.buildEntry(faction, entry), footprint = structureFootprints.get(id);
    // Scale all axes/pivots uniformly; only structures with a differing actual footprint are
    // adapted. Mobile models retain their authored WU, including their barrel overhang.
    const viewScale = footprint === undefined ? 1 : Math.min(1, footprint[0] / built.footprint[0], footprint[1] / built.footprint[1]);
    models.push(fromModelkit(id, built, viewScale));
  }
  return models.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
