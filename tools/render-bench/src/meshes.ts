/**
 * Meshes of the SPK4 scene (pure data, no GPU):
 *
 * - Units: {@link UNIT_VISUALS} merged-part variants, each built from three part meshes
 *   (hull box, turret cylinder, barrel box) with `combineParts` from @faf/render, 3 LODs each
 *   (placeholder LODs: cylinders 16/8/4 segments, boxes 24/24/8 vertices). Part 1 = turret (yaw),
 *   part 2 = barrel (pitch, parent turret) – the PartStream convention of the UnitPass.
 * - Props: {@link PROP_MESHES} meshes (tree, rock, bush) × {@link PROP_LODS} LODs with per-vertex
 *   colors, in the bench's own prop vertex format (see `proto/props.ts`).
 */
import { combineParts, createPlaceholderLods } from '@faf/render';
import type { MeshData, VisualEntry } from '@faf/render';

/** Unit visual variants (distinct merged-part meshes ⇒ distinct (visual, LOD) draws). */
export const UNIT_VISUALS = 12;
/** LOD levels per unit visual (P2). */
export const UNIT_LODS = 3;
/** PartStream entries per unit: turret yaw, barrel pitch. */
export const PARTS_PER_UNIT = 2;
/** Prop meshes: 0 tree, 1 rock, 2 bush. */
export const PROP_MESHES = 3;
/** LOD levels per prop mesh. */
export const PROP_LODS = 2;

export interface UnitVariant {
  readonly name: string;
  /** Hull size x (forward), y, z in WU. */
  readonly hull: readonly [number, number, number];
  /** Turret diameter / height. */
  readonly turret: readonly [number, number];
  /** Barrel length / thickness. */
  readonly barrel: readonly [number, number];
  /** Base color 0xRRGGBB (mixed with the army color). */
  readonly color: number;
  /** LOD switch distances in WU (before the preset LOD bias). */
  readonly lod: readonly [number, number];
}

/** Twelve variants: light/medium/heavy tanks, artillery, AA, engineers, scouts … (T1–T3 sizes). */
export const UNIT_VARIANTS: readonly UnitVariant[] = [
  { name: 'scout', hull: [1.2, 0.4, 0.8], turret: [0.5, 0.25], barrel: [0.6, 0.08], color: 0x55606a, lod: [40, 120] },
  { name: 'tank-t1', hull: [1.8, 0.55, 1.2], turret: [0.9, 0.35], barrel: [1.0, 0.12], color: 0x39424a, lod: [55, 160] },
  { name: 'tank-t2', hull: [2.2, 0.7, 1.5], turret: [1.1, 0.45], barrel: [1.3, 0.16], color: 0x3b4450, lod: [60, 180] },
  { name: 'tank-t3', hull: [2.8, 0.9, 1.9], turret: [1.4, 0.55], barrel: [1.8, 0.2], color: 0x2f363e, lod: [70, 200] },
  { name: 'artillery-t1', hull: [1.9, 0.5, 1.3], turret: [0.8, 0.3], barrel: [1.6, 0.14], color: 0x4a4636, lod: [55, 160] },
  { name: 'artillery-t2', hull: [2.4, 0.6, 1.6], turret: [1.0, 0.4], barrel: [2.2, 0.18], color: 0x4f4a38, lod: [60, 180] },
  { name: 'aa-t1', hull: [1.7, 0.5, 1.2], turret: [0.9, 0.5], barrel: [0.8, 0.1], color: 0x3c4a44, lod: [55, 160] },
  { name: 'aa-t2', hull: [2.1, 0.6, 1.5], turret: [1.1, 0.6], barrel: [1.0, 0.12], color: 0x3a4c46, lod: [60, 180] },
  { name: 'engineer', hull: [1.5, 0.6, 1.1], turret: [0.7, 0.3], barrel: [0.7, 0.18], color: 0x6a6440, lod: [45, 140] },
  { name: 'shield', hull: [1.9, 0.7, 1.4], turret: [0.8, 0.7], barrel: [0.4, 0.3], color: 0x44506a, lod: [55, 160] },
  { name: 'assault-bot', hull: [1.4, 1.0, 1.0], turret: [0.8, 0.45], barrel: [1.1, 0.14], color: 0x484040, lod: [50, 150] },
  { name: 'command', hull: [3.0, 1.1, 2.2], turret: [1.6, 0.7], barrel: [1.9, 0.24], color: 0x5a5a60, lod: [80, 240] },
];

/** The three LOD meshes of a variant: hull (part 0), turret (part 1, yaw), barrel (part 2, pitch, parent 1). */
export function unitVariantLods(v: UnitVariant): [MeshData, MeshData, MeshData] {
  const [hx, hy, hz] = v.hull;
  const [td, th] = v.turret;
  const [bl, bt] = v.barrel;
  const hull = createPlaceholderLods({ hull: 'box', size: [hx, hy, hz] });
  const turret = createPlaceholderLods({ hull: 'cyl', size: [td, th, td] });
  const barrel = createPlaceholderLods({ hull: 'box', size: [bl, bt, bt] });
  const pivotY = hy + th * 0.5;
  const lods = [0, 1, 2].map((l) =>
    combineParts([
      { mesh: hull[l]!, partId: 0 },
      { mesh: turret[l]!, partId: 1, offset: [0, hy, 0], pivot: [0, hy, 0] },
      { mesh: barrel[l]!, partId: 2, offset: [td * 0.35 + bl * 0.5, pivotY - bt * 0.5, 0], pivot: [td * 0.35, pivotY, 0], parent: 1 },
    ]),
  );
  return [lods[0]!, lods[1]!, lods[2]!];
}

/** Visual table for the renderer / UnitPass (index = UnitRecord.visual). */
export function unitVisualTable(): VisualEntry[] {
  return UNIT_VARIANTS.map((v) => ({
    spec: { hull: 'box', size: v.hull },
    color: v.color,
    baseWeight: 0.35,
    meshes: unitVariantLods(v),
    lodDistancesWU: v.lod,
  }));
}

// -------------------------------------------------------------------------------------------------
// Props
// -------------------------------------------------------------------------------------------------

/** Prop mesh in the bench vertex format: position f32×3, normal (unit), color RGBA8. */
export interface PropMesh {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly colors: Uint8Array;
  readonly indices: Uint16Array;
  readonly vertexCount: number;
  readonly indexCount: number;
  /** Bounding cylinder: radius in xz and height (WU, scale 1). */
  readonly radius: number;
  readonly height: number;
}

class PropBuilder {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly col: number[] = [];
  readonly idx: number[] = [];

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, rgb: number): number {
    const l = Math.hypot(nx, ny, nz) || 1;
    this.pos.push(x, y, z);
    this.nrm.push(nx / l, ny / l, nz / l);
    this.col.push((rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, 255);
    return this.pos.length / 3 - 1;
  }

  /** Triangle, wound counter-clockwise when seen from outside along `(ox, oy, oz)`. */
  tri(a: number, b: number, c: number, ox: number, oy: number, oz: number): void {
    const p = this.pos;
    const ux = p[b * 3]! - p[a * 3]!;
    const uy = p[b * 3 + 1]! - p[a * 3 + 1]!;
    const uz = p[b * 3 + 2]! - p[a * 3 + 2]!;
    const vx = p[c * 3]! - p[a * 3]!;
    const vy = p[c * 3 + 1]! - p[a * 3 + 1]!;
    const vz = p[c * 3 + 2]! - p[a * 3 + 2]!;
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    if (cx * ox + cy * oy + cz * oz >= 0) this.idx.push(a, b, c);
    else this.idx.push(a, c, b);
  }

  /** Cone (or truncated cone / cylinder) with smooth side normals; `r1` = top radius. */
  cone(y0: number, h: number, r0: number, r1: number, segments: number, rgb: number, cap: boolean): void {
    const bottom: number[] = [];
    const top: number[] = [];
    const slope = (r0 - r1) / h;
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      bottom.push(this.vertex(c * r0, y0, s * r0, c, slope, s, rgb));
      top.push(this.vertex(c * r1, y0 + h, s * r1, c, slope, s, rgb));
    }
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments;
      const a = ((i + 0.5) / segments) * Math.PI * 2;
      const ox = Math.cos(a);
      const oz = Math.sin(a);
      if (r1 > 1e-6) {
        this.tri(bottom[i]!, bottom[j]!, top[j]!, ox, slope, oz);
        this.tri(bottom[i]!, top[j]!, top[i]!, ox, slope, oz);
      } else {
        this.tri(bottom[i]!, bottom[j]!, top[i]!, ox, slope, oz);
      }
    }
    if (cap) {
      const center = this.vertex(0, y0, 0, 0, -1, 0, rgb);
      const ring: number[] = [];
      for (let i = 0; i < segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        ring.push(this.vertex(Math.cos(a) * r0, y0, Math.sin(a) * r0, 0, -1, 0, rgb));
      }
      for (let i = 0; i < segments; i++) this.tri(center, ring[i]!, ring[(i + 1) % segments]!, 0, -1, 0);
    }
  }

  /**
   * Deformed icosphere (flat shaded): `subdiv` 0 = 20, 1 = 80 triangles. `jitter` displaces vertices
   * radially by a deterministic hash of their direction (same displacement for both LODs).
   */
  blob(rx: number, ry: number, rz: number, y0: number, subdiv: 0 | 1, jitter: number, seed: number, rgb: number, rgb2: number): void {
    const t = (1 + Math.sqrt(5)) / 2;
    const base: [number, number, number][] = [
      [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
      [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
      [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
    ];
    let faces: [number, number, number][] = [
      [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
      [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
      [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ];
    const verts = base.map(([x, y, z]) => normalize([x, y, z]));
    if (subdiv === 1) {
      const mid = new Map<string, number>();
      const midpoint = (a: number, b: number): number => {
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        const k = mid.get(key);
        if (k !== undefined) return k;
        const va = verts[a]!;
        const vb = verts[b]!;
        verts.push(normalize([(va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2, (va[2] + vb[2]) / 2]));
        mid.set(key, verts.length - 1);
        return verts.length - 1;
      };
      const next: [number, number, number][] = [];
      for (const [a, b, c] of faces) {
        const ab = midpoint(a, b);
        const bc = midpoint(b, c);
        const ca = midpoint(c, a);
        next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
      }
      faces = next;
    }
    const disp = verts.map((v) => {
      const k = 1 + jitter * (hashDir(v, seed) * 2 - 1);
      return [v[0] * rx * k, y0 + v[1] * ry * k, v[2] * rz * k] as [number, number, number];
    });
    for (const [a, b, c] of faces) {
      const pa = disp[a]!;
      const pb = disp[b]!;
      const pc = disp[c]!;
      const ux = pb[0] - pa[0];
      const uy = pb[1] - pa[1];
      const uz = pb[2] - pa[2];
      const vx = pc[0] - pa[0];
      const vy = pc[1] - pa[1];
      const vz = pc[2] - pa[2];
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      // Outward = away from the blob center.
      const cx = (pa[0] + pb[0] + pc[0]) / 3;
      const cy = (pa[1] + pb[1] + pc[1]) / 3 - y0;
      const cz = (pa[2] + pb[2] + pc[2]) / 3;
      if (nx * cx + ny * cy + nz * cz < 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
      const shade = hashDir([cx, cy, cz], seed + 7) < 0.5 ? rgb : rgb2;
      const ia = this.vertex(pa[0], pa[1], pa[2], nx, ny, nz, shade);
      const ib = this.vertex(pb[0], pb[1], pb[2], nx, ny, nz, shade);
      const ic = this.vertex(pc[0], pc[1], pc[2], nx, ny, nz, shade);
      this.tri(ia, ib, ic, nx, ny, nz);
    }
  }

  build(): PropMesh {
    const vertexCount = this.pos.length / 3;
    const positions = new Float32Array(this.pos);
    let radius = 0;
    let height = 0;
    for (let v = 0; v < vertexCount; v++) {
      radius = Math.max(radius, Math.hypot(positions[v * 3]!, positions[v * 3 + 2]!));
      height = Math.max(height, positions[v * 3 + 1]!);
    }
    return {
      positions,
      normals: new Float32Array(this.nrm),
      colors: new Uint8Array(this.col),
      indices: new Uint16Array(this.idx),
      vertexCount,
      indexCount: this.idx.length,
      radius,
      height,
    };
  }
}

function normalize(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Deterministic hash of a direction (quantized) to [0, 1). */
function hashDir(v: readonly [number, number, number], seed: number): number {
  let h = Math.imul(Math.round(v[0] * 1000), 0x27d4eb2d) ^ Math.imul(Math.round(v[1] * 1000), 0x165667b1);
  h ^= Math.imul(Math.round(v[2] * 1000), 0x9e3779b1) ^ Math.imul(seed, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function tree(lod: number): PropMesh {
  const b = new PropBuilder();
  const seg = lod === 0 ? 10 : 5;
  b.cone(0, 0.55, 0.11, 0.08, lod === 0 ? 6 : 4, 0x5a4026, false);
  b.cone(0.4, 0.8, 0.62, 0, seg, 0x2f5a26, true);
  if (lod === 0) b.cone(0.85, 0.75, 0.46, 0, seg, 0x3a6a2c, true);
  return b.build();
}

function rock(lod: number): PropMesh {
  const b = new PropBuilder();
  b.blob(0.62, 0.42, 0.55, 0.12, lod === 0 ? 1 : 0, 0.22, 11, 0x77726a, 0x6a655d);
  return b.build();
}

function bush(lod: number): PropMesh {
  const b = new PropBuilder();
  b.blob(0.48, 0.34, 0.48, 0.22, lod === 0 ? 1 : 0, 0.18, 29, 0x3c5a2a, 0x46662e);
  return b.build();
}

/** `props[mesh][lod]` for mesh 0 tree, 1 rock, 2 bush. */
export function propMeshes(): PropMesh[][] {
  return [
    [tree(0), tree(1)],
    [rock(0), rock(1)],
    [bush(0), bush(1)],
  ];
}
