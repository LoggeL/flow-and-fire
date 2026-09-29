/**
 * Builds a model definition into merged-part meshes (LOD0–2) with flat-shading normals, vertex colors, masks and
 * statistics. Pure and deterministic: same definition + palette → same arrays.
 */
import { aoFromNormalY, MATERIAL_SLOTS, resolvePalette, resolveSlot, SLOT_INDEX, type MaterialSlot, type Palette } from './materials.ts';
import { apply, det, mul, newell, normalize, scaling, snap, sub, cross, dot, type Mat, type Vec3 } from './math.ts';
import {
  checkModelDef,
  DEFAULT_BUDGETS,
  DEFAULT_ICON_THRESHOLD,
  DEFAULT_LOD_DISTANCES,
  type Budget,
  type ModelClass,
  type ModelDef,
  type PartAnim,
} from './model.ts';
import { dedupe, type Lod, type Poly } from './primitives.ts';
import { groupMatrix, placeMatrix, type PrimGen, type Shape } from './shapes.ts';

export const LOD_COUNT = 3;
/** Automatic LOD reduction: shapes whose largest extent is below this share of the model's largest extent vanish. */
export const LOD_REMOVE_RATIO: readonly [number, number, number] = [0, 0.08, 0.16];

/** Values from the faction roster, used where the model definition leaves fields out. */
export interface RosterDefaults {
  readonly name?: string;
  readonly role?: string;
  readonly class?: ModelClass;
  readonly tech?: 0 | 1 | 2 | 3;
  readonly footprint?: readonly [number, number];
  readonly scale?: { readonly xz: number; readonly y: number };
  readonly icon?: string;
  readonly iconThreshold?: number;
  /** Roster estimate for LOD0 tris (informational). */
  readonly trisEstimate?: number;
}

export interface BuildContext {
  readonly faction: string;
  readonly palette: Palette;
  readonly defaults?: RosterDefaults;
  readonly budgets?: Partial<Record<ModelClass, Budget>>;
}

export interface LodMesh {
  readonly lod: number;
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  /** Linear RGB per vertex. */
  readonly colors: Float32Array;
  readonly partIds: Uint8Array;
  /** RGBA u8 per vertex: team, glow, metal, AO. */
  readonly mask: Uint8Array;
  /** Material slot index per vertex (0–6), for tools; not exported to glTF. */
  readonly matIds: Uint8Array;
  readonly indices: Uint16Array | Uint32Array;
  readonly triangles: number;
  readonly vertices: number;
  /** Triangles per part index. */
  readonly partTris: readonly number[];
  /** Surface area per material slot (WU²). */
  readonly matArea: Readonly<Record<MaterialSlot, number>>;
  /** Share of `team` in the top-down view (orthographic from above, with occlusion; 96² raster). */
  readonly teamTopShare: number;
}

export interface BuiltPart {
  readonly index: number;
  readonly name: string;
  /** Parent part index (hull: 0). */
  readonly parent: number;
  /** Pivot in export space (scaled). */
  readonly pivot: Vec3;
  readonly anim: PartAnim;
}

export interface Bounds {
  readonly min: Vec3;
  readonly max: Vec3;
  readonly size: Vec3;
}

export interface FootprintCheck {
  readonly footprint: readonly [number, number];
  /** Model extent in x and z (WU, LOD0, scaled). */
  readonly extent: readonly [number, number];
  readonly ratio: readonly [number, number];
  readonly rule: string;
  readonly ok: boolean;
}

export interface BuiltModel {
  readonly id: string;
  readonly unit: string;
  readonly faction: string;
  readonly name: string;
  readonly role: string;
  readonly class: ModelClass;
  readonly tech: number;
  readonly footprint: readonly [number, number];
  readonly scale: { readonly xz: number; readonly y: number };
  readonly icon: string;
  readonly iconThreshold: number;
  readonly lodDistances: readonly [number, number];
  readonly budget: Budget;
  readonly trisEstimate: number | null;
  readonly parts: readonly BuiltPart[];
  readonly lods: readonly LodMesh[];
  readonly bounds: Bounds;
  readonly footprintCheck: FootprintCheck;
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}

interface Inst {
  readonly gen: PrimGen;
  readonly m: Mat;
  readonly flip: boolean;
  readonly slot: MaterialSlot;
  readonly part: number;
  readonly keep: boolean;
  readonly minLod: number;
  readonly maxLod: number;
  size: number;
  readonly type: string;
}

interface Flags {
  keep: boolean;
  minLod: number;
  maxLod: number;
}

function collect(shape: Shape, parent: Mat, mat: string | undefined, flags: Flags, part: number, palette: Palette, out: Inst[]): void {
  const f: Flags = {
    keep: flags.keep || shape.place.keep === true,
    minLod: Math.max(flags.minLod, shape.place.minLod ?? 0),
    maxLod: Math.min(flags.maxLod, shape.place.maxLod ?? 2),
  };
  const m2 = shape.place.mat ?? mat;
  if (shape.kind === 'group') {
    const m = mul(parent, groupMatrix(shape));
    for (const c of shape.children) collect(c, m, m2, f, part, palette, out);
    return;
  }
  const m = mul(parent, placeMatrix(shape.place));
  out.push({
    gen: shape.gen,
    m,
    flip: det(m) < 0,
    slot: resolveSlot(m2 ?? 'base', palette),
    part,
    keep: f.keep,
    minLod: f.minLod,
    maxLod: f.maxLod,
    size: 0,
    type: shape.type,
  });
}

function transformPolys(inst: Inst, lod: Lod, minFeature: number): Poly[] {
  const polys = inst.gen(lod, minFeature);
  return polys.map((p) => {
    const t = p.map((v) => apply(inst.m, v));
    return inst.flip ? t.reverse() : t;
  });
}

function unitOf(id: string): string {
  return id.slice(id.indexOf(':') + 1);
}

function classFromIcon(icon: string | undefined): ModelClass | undefined {
  if (icon === undefined) return undefined;
  const form = icon.split('_')[0];
  switch (form) {
    case 'land':
    case 'air':
    case 'eng':
    case 'struct':
    case 'cmd':
    case 'wall':
    case 'naval':
      return form;
    default:
      return undefined;
  }
}

class MeshAccumulator {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly col: number[] = [];
  readonly part: number[] = [];
  readonly mask: number[] = [];
  readonly mat: number[] = [];
  readonly idx: number[] = [];
  private readonly map = new Map<string, number>();

  vertex(p: Vec3, n: Vec3, part: number, slot: MaterialSlot, color: readonly number[], mask: readonly number[]): number {
    const px = snap(p[0]);
    const py = snap(p[1]);
    const pz = snap(p[2]);
    const nx = snap(n[0], 1e-5);
    const ny = snap(n[1], 1e-5);
    const nz = snap(n[2], 1e-5);
    const key = `${part}|${slot}|${px},${py},${pz}|${nx},${ny},${nz}`;
    const hit = this.map.get(key);
    if (hit !== undefined) return hit;
    const i = this.pos.length / 3;
    this.pos.push(px, py, pz);
    this.nrm.push(nx, ny, nz);
    this.col.push(color[0]!, color[1]!, color[2]!);
    this.part.push(part);
    this.mask.push(mask[0]!, mask[1]!, mask[2]!, aoFromNormalY(ny));
    this.mat.push(SLOT_INDEX[slot]);
    this.map.set(key, i);
    return i;
  }
}

const AREA_EPS = 1e-10;
const TOP_RES = 96;

/** Top-down z-buffer over the xz bounds: share of covered cells whose highest surface has material `slot`. */
function topShare(acc: MeshAccumulator, b: Bounds, slot: MaterialSlot): number {
  const ext = Math.max(b.size[0], b.size[2]);
  if (!(ext > 0)) return 0;
  const cell = ext / TOP_RES;
  const nx = Math.max(1, Math.ceil(b.size[0] / cell));
  const nz = Math.max(1, Math.ceil(b.size[2] / cell));
  const height = new Float64Array(nx * nz).fill(-Infinity);
  const mat = new Int8Array(nx * nz).fill(-1);
  const want = SLOT_INDEX[slot];
  const P = acc.pos;
  for (let t = 0; t < acc.idx.length; t += 3) {
    const ia = acc.idx[t]!;
    const ib = acc.idx[t + 1]!;
    const ic = acc.idx[t + 2]!;
    const ax = P[3 * ia]!, ay = P[3 * ia + 1]!, az = P[3 * ia + 2]!;
    const bx = P[3 * ib]!, by = P[3 * ib + 1]!, bz = P[3 * ib + 2]!;
    const cx = P[3 * ic]!, cy = P[3 * ic + 1]!, cz = P[3 * ic + 2]!;
    const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(den) < 1e-12) continue; // vertical face
    const x0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - b.min[0]) / cell));
    const x1 = Math.min(nx - 1, Math.floor((Math.max(ax, bx, cx) - b.min[0]) / cell));
    const z0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - b.min[2]) / cell));
    const z1 = Math.min(nz - 1, Math.floor((Math.max(az, bz, cz) - b.min[2]) / cell));
    const m = acc.mat[ia]!;
    for (let i = x0; i <= x1; i++) {
      const px = b.min[0] + (i + 0.5) * cell;
      for (let k = z0; k <= z1; k++) {
        const pz = b.min[2] + (k + 0.5) * cell;
        const w0 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / den;
        const w1 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / den;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const y = w0 * ay + w1 * by + w2 * cy;
        const c = i * nz + k;
        if (y > height[c]!) {
          height[c] = y;
          mat[c] = m;
        }
      }
    }
  }
  let covered = 0;
  let hit = 0;
  for (const m of mat) {
    if (m < 0) continue;
    covered++;
    if (m === want) hit++;
  }
  return covered > 0 ? Math.round((hit / covered) * 1000) / 1000 : 0;
}

/** Builds all LODs of a model. Never throws for content problems: they are reported in `errors`/`warnings`. */
export function buildModel(def: ModelDef, ctx: BuildContext): BuiltModel {
  const errors: string[] = [...checkModelDef(def)];
  const warnings: string[] = [];
  const d = ctx.defaults ?? {};
  const cls: ModelClass = def.class ?? d.class ?? classFromIcon(def.icon ?? d.icon) ?? 'land';
  const scaleIn = def.scale ?? d.scale ?? 1;
  const scale = typeof scaleIn === 'number' ? { xz: scaleIn, y: scaleIn } : { xz: scaleIn.xz, y: scaleIn.y };
  const footprint = def.footprint ?? d.footprint ?? [1, 1];
  const budget = def.budget ?? ctx.budgets?.[cls] ?? DEFAULT_BUDGETS[cls];
  const pal = resolvePalette(ctx.palette);
  const root = scaling([scale.xz, scale.y, scale.xz]);

  // Parts
  const partIndex = new Map<string, number>();
  const parts: BuiltPart[] = def.parts.map((p, i) => {
    partIndex.set(p.name, i);
    const pv = p.pivot ?? [0, 0, 0];
    return {
      index: i,
      name: p.name,
      parent: i === 0 ? 0 : (partIndex.get(p.parent ?? 'hull') ?? 0),
      pivot: [snap(pv[0] * scale.xz), snap(pv[1] * scale.y), snap(pv[2] * scale.xz)] as Vec3,
      anim: p.anim ?? (i === 0 ? 'none' : 'yaw'),
    };
  });

  // Shape instances
  const insts: Inst[] = [];
  def.parts.forEach((p, i) => {
    for (const s of p.shapes) {
      try {
        collect(s, root, undefined, { keep: false, minLod: 0, maxLod: 2 }, i, ctx.palette, insts);
      } catch (e) {
        errors.push(`part ${p.name}: ${(e as Error).message}`);
      }
    }
  });

  // LOD0 bounds per instance (size for the automatic reduction) and of the whole model
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const inst of insts) {
    let polys: Poly[] = [];
    try {
      polys = transformPolys(inst, 0, 0);
    } catch (e) {
      errors.push(`${inst.type}: ${(e as Error).message}`);
    }
    const lmin = [Infinity, Infinity, Infinity];
    const lmax = [-Infinity, -Infinity, -Infinity];
    for (const poly of polys) {
      for (const v of poly) {
        for (let k = 0; k < 3; k++) {
          lmin[k] = Math.min(lmin[k]!, v[k]!);
          lmax[k] = Math.max(lmax[k]!, v[k]!);
        }
      }
    }
    inst.size = Math.max(lmax[0]! - lmin[0]!, lmax[1]! - lmin[1]!, lmax[2]! - lmin[2]!);
    if (inst.minLod === 0) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k]!, lmin[k]!);
        max[k] = Math.max(max[k]!, lmax[k]!);
      }
    }
  }
  if (!Number.isFinite(min[0]!)) {
    for (let k = 0; k < 3; k++) {
      min[k] = 0;
      max[k] = 0;
    }
    errors.push('model has no geometry in LOD0');
  }
  const bounds: Bounds = {
    min: [snap(min[0]!, 1e-4), snap(min[1]!, 1e-4), snap(min[2]!, 1e-4)],
    max: [snap(max[0]!, 1e-4), snap(max[1]!, 1e-4), snap(max[2]!, 1e-4)],
    size: [snap(max[0]! - min[0]!, 1e-4), snap(max[1]! - min[1]!, 1e-4), snap(max[2]! - min[2]!, 1e-4)],
  };
  const maxExtent = Math.max(...bounds.size);

  const lods: LodMesh[] = [];
  for (let l = 0 as Lod; l < LOD_COUNT; l = (l + 1) as Lod) {
    const acc = new MeshAccumulator();
    const partTris = parts.map(() => 0);
    const matArea = Object.fromEntries(MATERIAL_SLOTS.map((s) => [s, 0])) as Record<MaterialSlot, number>;
    for (const inst of insts) {
      if (l < inst.minLod || l > inst.maxLod) continue;
      const minFeature = LOD_REMOVE_RATIO[l]! * maxExtent;
      if (l > 0 && !inst.keep && inst.size < minFeature) continue;
      let polys: Poly[];
      try {
        polys = transformPolys(inst, l, minFeature);
      } catch (e) {
        if (l === 0) continue; // already reported
        errors.push(`${inst.type} LOD${l}: ${(e as Error).message}`);
        continue;
      }
      const res = pal[inst.slot];
      for (const raw of polys) {
        const poly = dedupe(raw);
        if (poly.length < 3) continue;
        const nn = newell(poly);
        const area2 = Math.hypot(nn[0], nn[1], nn[2]);
        if (area2 < AREA_EPS) continue;
        const n = normalize(nn);
        // fan triangulation; non-planar polygons get per-triangle normals
        for (let k = 1; k + 1 < poly.length; k++) {
          const a = poly[0]!;
          const b = poly[k]!;
          const c = poly[k + 1]!;
          const tn = cross(sub(b, a), sub(c, a));
          const tArea = Math.hypot(tn[0], tn[1], tn[2]) / 2;
          if (tArea < AREA_EPS) continue;
          const tnn = normalize(tn);
          const useN = dot(tnn, n) > 0.9999 ? n : tnn;
          if (!(Number.isFinite(useN[0]) && Number.isFinite(useN[1]) && Number.isFinite(useN[2]))) {
            errors.push(`non-finite normal in ${inst.type}`);
            continue;
          }
          const ia = acc.vertex(a, useN, inst.part, inst.slot, res.linear, res.mask);
          const ib = acc.vertex(b, useN, inst.part, inst.slot, res.linear, res.mask);
          const ic = acc.vertex(c, useN, inst.part, inst.slot, res.linear, res.mask);
          if (ia === ib || ib === ic || ia === ic) continue; // collapsed by snapping
          acc.idx.push(ia, ib, ic);
          partTris[inst.part]!++;
          matArea[inst.slot] += tArea;
        }
      }
    }
    const vcount = acc.pos.length / 3;
    const tris = acc.idx.length / 3;
    for (const v of acc.pos) if (!Number.isFinite(v)) errors.push(`LOD${l}: non-finite position`);
    lods.push({
      lod: l,
      positions: new Float32Array(acc.pos),
      normals: new Float32Array(acc.nrm),
      colors: new Float32Array(acc.col),
      partIds: new Uint8Array(acc.part),
      mask: new Uint8Array(acc.mask),
      matIds: new Uint8Array(acc.mat),
      indices: vcount > 65535 ? new Uint32Array(acc.idx) : new Uint16Array(acc.idx),
      triangles: tris,
      vertices: vcount,
      partTris,
      matArea: Object.fromEntries(MATERIAL_SLOTS.map((s) => [s, Math.round(matArea[s] * 1e4) / 1e4])) as Record<MaterialSlot, number>,
      teamTopShare: topShare(acc, bounds, 'team'),
    });
  }

  // Budgets
  lods.forEach((lod, i) => {
    const cap = budget.tris[i]!;
    if (lod.triangles > cap) errors.push(`LOD${i}: ${lod.triangles} tris > budget ${cap} (${cls})`);
  });
  for (let i = 1; i < lods.length; i++) {
    if (lods[i]!.triangles > lods[i - 1]!.triangles) warnings.push(`LOD${i} has more tris than LOD${i - 1}`);
  }
  parts.forEach((p, i) => {
    if (lods[0]!.partTris[i] === 0) warnings.push(`part ${p.name} has no triangles in LOD0`);
  });
  if (lods[0]!.matArea.team <= 0) warnings.push('no team-color surface (faction rule: ≥ 1 team part)');

  // Footprint
  const ext: [number, number] = [bounds.size[0], bounds.size[2]];
  const isStruct = cls === 'struct' || cls === 'wall';
  const ratio: [number, number] = [snap(ext[0] / footprint[0], 1e-3), snap(ext[1] / footprint[1], 1e-3)];
  const fpOk = isStruct ? ratio[0] <= 1.05 && ratio[1] <= 1.05 && Math.max(ratio[0], ratio[1]) >= 0.7 : Math.max(ratio[0], ratio[1]) <= 2.0;
  const rule = isStruct ? 'Struktur: Ausdehnung 70–105 % der Footprint-Kante' : 'Mobil: Ausdehnung ≤ 200 % der Footprint-Kante';
  if (!fpOk) warnings.push(`footprint check failed (${rule}): extent ${ext.map((v) => v.toFixed(2)).join('×')} on ${footprint.join('×')}`);

  return {
    id: def.id,
    unit: unitOf(def.id),
    faction: ctx.faction,
    name: def.name ?? d.name ?? unitOf(def.id),
    role: def.role ?? d.role ?? '',
    class: cls,
    tech: def.tech ?? d.tech ?? 1,
    footprint: [footprint[0], footprint[1]],
    scale,
    icon: def.icon ?? d.icon ?? '',
    iconThreshold: def.iconThreshold ?? d.iconThreshold ?? DEFAULT_ICON_THRESHOLD,
    lodDistances: def.lodDistances ?? DEFAULT_LOD_DISTANCES,
    budget,
    trisEstimate: d.trisEstimate ?? null,
    parts,
    lods,
    bounds,
    footprintCheck: { footprint: [footprint[0], footprint[1]], extent: [snap(ext[0], 1e-4), snap(ext[1], 1e-4)], ratio, rule, ok: fpOk },
    warnings,
    errors,
  };
}
