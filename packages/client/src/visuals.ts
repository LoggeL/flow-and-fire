/**
 * Visual table (render `VisualTable`, index = blueprint sim id = `UnitRecord.visual`) from the
 * compiled `view.json` plus the models loaded by the asset pipeline (P3): a visual with
 * `view.mesh` gets the model's LOD meshes (merged parts), all visuals get their `view.lod`
 * distances; without a loaded model the placeholder from `view.placeholder` is drawn (MS3: with
 * its turret). MS3 (view.json v2): strategic icon id, tech level, icon threshold and selection
 * radius go into the entry, so the renderer's crossfade and the client's hit tests use the same
 * numbers ({@link VisualGeometry}).
 */
import type { SimBpTable } from '@faf/blueprints/simbin';
import type { ViewBundle } from '@faf/blueprints/view';
import {
  DEFAULT_ARMY_COLORS,
  DEFAULT_ICON_THRESHOLD_PX,
  type MeshData,
  type PlaceholderSpec,
  type VisualEntry,
  type VisualTable,
} from '@faf/render';

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
    const t = ph.turret;
    const spec: PlaceholderSpec = {
      hull: ph.hull,
      size: [ph.size[0], ph.size[1], ph.size[2]],
      ...(ph.color !== undefined ? { color: [ph.color[0], ph.color[1], ph.color[2]] as [number, number, number] } : {}),
      ...(t !== undefined
        ? { turret: { hull: t.hull, size: [t.size[0], t.size[1], t.size[2]], offset: [t.offset[0], t.offset[1], t.offset[2]] } }
        : {}),
    };
    const meshes = v.mesh === undefined ? undefined : find(v.mesh);
    return {
      spec,
      ...(meshes !== undefined && meshes.length > 0 ? { meshes: meshes.slice(0, 3) } : {}),
      ...(v.lod !== undefined ? { lodDistancesWU: [v.lod[0], v.lod[1]] as const } : {}),
      ...(v.icon !== undefined ? { icon: v.icon } : {}),
      tech: v.tech,
      iconThreshold: v.iconThreshold,
      selectionRadius: v.selectionRadius,
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

/**
 * Per-visual numbers the client needs for hit tests and decals, derived exactly like the renderer
 * derives them for its crossfade (render `writeVisualStrategic`): selection radius (WU; default
 * 1.2 × the horizontal half extent of LOD 0) and icon threshold (CSS px; default 14).
 */
export class VisualGeometry {
  /** Selection radius in WU per visual. */
  readonly selectionRadius: Float64Array;
  /** Icon threshold in CSS px per visual (0 = never icon, except in Z2). */
  readonly iconThreshold: Float64Array;
  /** Number of visuals in the table. */
  readonly count: number;
  /** Radius / threshold for records whose visual is outside the table (renderer: grey fallback cube). */
  readonly fallbackRadius: number;

  constructor(table: VisualTable) {
    const n = table.length;
    this.count = n;
    this.selectionRadius = new Float64Array(n);
    this.iconThreshold = new Float64Array(n);
    this.fallbackRadius = selectionRadiusOf(undefined);
    for (let v = 0; v < n; v++) {
      const e = table[v] ?? undefined;
      this.selectionRadius[v] = selectionRadiusOf(e);
      this.iconThreshold[v] = Math.max(0, e?.iconThreshold ?? DEFAULT_ICON_THRESHOLD_PX);
    }
  }

  radius(visual: number): number {
    return visual < this.count ? this.selectionRadius[visual]! : this.fallbackRadius;
  }

  threshold(visual: number): number {
    return visual < this.count ? this.iconThreshold[visual]! : DEFAULT_ICON_THRESHOLD_PX;
  }
}

const FALLBACK_SPEC: PlaceholderSpec = { hull: 'box', size: [1, 1, 1] };

function selectionRadiusOf(e: VisualEntry | undefined): number {
  if (e?.selectionRadius !== undefined) return e.selectionRadius;
  const lod0 = e?.meshes?.[0];
  const b = lod0 !== undefined ? lod0.bounds : placeholderBounds(e?.spec ?? FALLBACK_SPEC);
  const half = Math.max(Math.abs(b[0]), Math.abs(b[3]), Math.abs(b[2]), Math.abs(b[5]));
  return Math.max(0.1, half * 1.2);
}

/** Placeholder bounds exactly as the renderer computes them (render `placeholderBounds`). */
function placeholderBounds(spec: PlaceholderSpec): readonly [number, number, number, number, number, number] {
  const [sx, sy, sz] = spec.size;
  const b: [number, number, number, number, number, number] = [-sx / 2, 0, -sz / 2, sx / 2, sy, sz / 2];
  const t = spec.turret;
  if (t !== undefined) {
    const [ox, oy, oz] = t.offset;
    b[0] = Math.min(b[0], ox - t.size[0] / 2);
    b[2] = Math.min(b[2], oz - t.size[2] / 2);
    b[3] = Math.max(b[3], ox + t.size[0] * 1.3);
    b[4] = Math.max(b[4], oy + t.size[1]);
    b[5] = Math.max(b[5], oz + t.size[2] / 2);
  }
  return b;
}

/** Army color as 0xRRGGBB (render `DEFAULT_ARMY_COLORS`, the palette the renderer uses). */
export function armyColorHex(army: number): number {
  const c = DEFAULT_ARMY_COLORS[army % DEFAULT_ARMY_COLORS.length]!;
  const to8 = (v: number): number => Math.max(0, Math.min(255, Math.round(v * 255)));
  return (to8(c[0]) << 16) | (to8(c[1]) << 8) | to8(c[2]);
}
