/** Metadata sidecar (`<faction>.<unit>.json`) and manifest entry of a built model. */
import type { BuiltModel, MatArea } from './build.ts';

export interface ModelMeta {
  readonly id: string;
  readonly unit: string;
  readonly faction: string;
  readonly name: string;
  readonly role: string;
  readonly class: string;
  readonly tech: number;
  /** GLB file name relative to the manifest. */
  readonly file: string;
  /** Hex SHA-256 of the GLB (filled by the CLI). */
  readonly sha256: string;
  readonly bytes: number;
  readonly axes: { readonly forward: '+z'; readonly up: '+y'; readonly unit: 'WU' };
  readonly footprint: readonly [number, number];
  readonly scale: { readonly xz: number; readonly y: number };
  readonly icon: string;
  readonly iconThreshold: number;
  readonly lodDistances: readonly [number, number];
  /** Hover height baked into the GLB (only present for hover/glide units, see HOVER_HEIGHT). */
  readonly hover?: number;
  readonly bounds: BuiltModel['bounds'];
  readonly footprintCheck: BuiltModel['footprintCheck'];
  readonly budget: { readonly tris: readonly number[]; readonly ok: boolean };
  readonly trisEstimate: number | null;
  readonly lods: readonly {
    readonly lod: number;
    readonly triangles: number;
    readonly vertices: number;
    readonly partTris: readonly number[];
    readonly matArea: MatArea;
    readonly teamTopShare: number;
  }[];
  readonly parts: readonly {
    readonly index: number;
    readonly name: string;
    readonly parent: number;
    readonly pivot: readonly [number, number, number];
    readonly anim: string;
  }[];
  readonly warnings: readonly string[];
}

export function modelMeta(m: BuiltModel, file: string, sha256: string, bytes: number): ModelMeta {
  return {
    id: m.id,
    unit: m.unit,
    faction: m.faction,
    name: m.name,
    role: m.role,
    class: m.class,
    tech: m.tech,
    file,
    sha256,
    bytes,
    axes: { forward: '+z', up: '+y', unit: 'WU' },
    footprint: m.footprint,
    scale: m.scale,
    icon: m.icon,
    iconThreshold: m.iconThreshold,
    lodDistances: m.lodDistances,
    ...(m.hover > 0 ? { hover: m.hover } : {}),
    bounds: m.bounds,
    footprintCheck: m.footprintCheck,
    budget: { tris: [...m.budget.tris], ok: m.lods.every((l, i) => l.triangles <= m.budget.tris[i]!) },
    trisEstimate: m.trisEstimate,
    lods: m.lods.map((l) => ({
      lod: l.lod,
      triangles: l.triangles,
      vertices: l.vertices,
      partTris: l.partTris,
      matArea: l.matArea,
      teamTopShare: l.teamTopShare,
    })),
    parts: m.parts.map((p) => ({ index: p.index, name: p.name, parent: p.parent, pivot: p.pivot, anim: p.anim })),
    warnings: m.warnings,
  };
}

export interface ManifestFaction {
  readonly slug: string;
  readonly name: string;
  /** Faction palette (sRGB hex per slot) for tools. */
  readonly palette: Readonly<Record<string, string>>;
  /** Team-color conflict swaps of the palette (view only, see Palette.teamAlt). */
  readonly teamAlt?: readonly { readonly slot: string; readonly teams: readonly string[]; readonly color: string }[];
  readonly models: readonly string[];
}

export interface Manifest {
  readonly schema: 'faf-models/1';
  readonly factions: readonly ManifestFaction[];
  readonly models: readonly ModelMeta[];
}
