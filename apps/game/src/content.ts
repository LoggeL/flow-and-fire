/**
 * Content glue of the game page: view.json → render visual table, start-army layout helpers.
 * Pure (no DOM), unit-tested in apps/game/test.
 */
import { parseViewJson } from '@faf/blueprints/view';
import type { VisualTable } from '@faf/client';

/** Spread radius (WU) so that `n` cubes of radius 0.3 have room: ≈ 4.5 WU² per cube. */
export function spawnSpreadWU(n: number): number {
  return Math.max(3, Math.sqrt(n * 1.45));
}

/** view.json (text) → visual table; index = blueprint sim id = `UnitRecord.visual`. */
export function visualsFromViewJson(text: string): VisualTable {
  const bundle = parseViewJson(text);
  return bundle.visuals.map((v) => ({
    spec: {
      hull: v.placeholder.hull,
      size: [v.placeholder.size[0], v.placeholder.size[1], v.placeholder.size[2]] as [number, number, number],
      ...(v.placeholder.color !== undefined
        ? { color: [v.placeholder.color[0], v.placeholder.color[1], v.placeholder.color[2]] as [number, number, number] }
        : {}),
    },
  }));
}
