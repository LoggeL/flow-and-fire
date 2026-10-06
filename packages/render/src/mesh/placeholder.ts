/**
 * Procedural placeholder meshes (PLAN §3.7 "Platzhalter"): gameplay never waits for art.
 *
 * Mesh space: origin at the center of the footprint on the ground, +y up, forward = +x
 * (Ang16 yaw 0). Triangles are counter-clockwise seen from outside. Every vertex carries a
 * `partId` for merged-part meshes; placeholder hulls are a single part (0).
 *
 * LODs (P2): {@link createPlaceholderLods} builds 3 levels (cylinders with 16/8/4 segments, boxes
 * 24/24/8 vertices). {@link combineParts} merges several meshes into one merged-part mesh with part
 * pivots and parents (PLAN §3.7 "Merged-Part-Mesh").
 *
 * Turret (MS3, view.json v2 `placeholder.turret`): a spec with `turret {hull, size, offset}` becomes a
 * two-part merged-part mesh – part 0 = hull, part 1 = turret (+ a short barrel pointing +x, same part)
 * with its pivot at `offset` (turret base center in hull space) – so PartStream entry `partBase` turns
 * it. LOD 2 drops the barrel.
 */

export type PlaceholderHull = 'box' | 'cyl';

export interface PlaceholderTurret {
  readonly hull: PlaceholderHull;
  /** Turret extent in WU (x forward, y height, z side). */
  readonly size: readonly [number, number, number];
  /** Turret base center in hull mesh space (WU), usually `[x, hullHeight, z]`; also the rotation pivot. */
  readonly offset: readonly [number, number, number];
}

export interface PlaceholderSpec {
  readonly hull: PlaceholderHull;
  /** Extent in WU along x (forward), y (height), z (side). */
  readonly size: readonly [number, number, number];
  /** Base color (linear 0..1); used by the renderer's visual table. */
  readonly color?: readonly [number, number, number];
  /** Optional turret (part 1). */
  readonly turret?: PlaceholderTurret;
}

export interface MeshData {
  /** xyz per vertex. */
  readonly positions: Float32Array;
  /** Unit-length xyz normal per vertex. */
  readonly normals: Float32Array;
  /**
   * Part index per vertex (merged-part meshes, PLAN §3.7): 0 = hull (moves with the unit only);
   * part k ≥ 1 rotates with PartStream entry `partBase + k − 1` (if `k ≤ partCount`) around its pivot.
   */
  readonly partIds: Uint8Array;
  readonly indices: Uint16Array | Uint32Array;
  readonly vertexCount: number;
  readonly indexCount: number;
  /** Axis-aligned bounds in mesh space: [minX, minY, minZ, maxX, maxY, maxZ]. */
  readonly bounds: readonly [number, number, number, number, number, number];
  /**
   * Pivot (mesh space, xyz) per part id; part k rotates around `partPivots[3k..3k+2]` by its yaw
   * (around +y) and pitch (nose +x up). Omitted ⇒ all pivots at the origin.
   */
  readonly partPivots?: Float32Array;
  /**
   * Parent part per part id (`partParents[k] < k`, hull = 0): a part also follows every ancestor's
   * rotation (turret → barrel). Omitted ⇒ every part hangs directly on the hull.
   */
  readonly partParents?: Uint8Array;
}

/** Segments around a placeholder cylinder (LOD 0). */
export const CYL_SEGMENTS = 16;
/** Cylinder segments per LOD level. */
export const CYL_LOD_SEGMENTS: readonly [number, number, number] = [16, 8, 4];
/** Part ids per mesh at most (hull + 15; the PartStream carries ≤ 8 parts per unit). */
export const MAX_MESH_PARTS = 16;

class MeshBuilder {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly idx: number[] = [];

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
    const len = Math.hypot(nx, ny, nz) || 1;
    this.pos.push(x, y, z);
    this.nrm.push(nx / len, ny / len, nz / len);
    return this.pos.length / 3 - 1;
  }

  /** Adds a triangle, flipping the winding if needed so it faces along `(nx, ny, nz)`. */
  tri(a: number, b: number, c: number, nx: number, ny: number, nz: number): void {
    const p = this.pos;
    const ax = p[a * 3]!;
    const ay = p[a * 3 + 1]!;
    const az = p[a * 3 + 2]!;
    const ux = p[b * 3]! - ax;
    const uy = p[b * 3 + 1]! - ay;
    const uz = p[b * 3 + 2]! - az;
    const vx = p[c * 3]! - ax;
    const vy = p[c * 3 + 1]! - ay;
    const vz = p[c * 3 + 2]! - az;
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    if (cx * nx + cy * ny + cz * nz >= 0) this.idx.push(a, b, c);
    else this.idx.push(a, c, b);
  }

  build(): MeshData {
    const vertexCount = this.pos.length / 3;
    if (vertexCount > 65535) throw new Error('placeholder mesh exceeds 16-bit indices');
    const positions = new Float32Array(this.pos);
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < vertexCount; i++) {
      const x = positions[i * 3]!;
      const y = positions[i * 3 + 1]!;
      const z = positions[i * 3 + 2]!;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    }
    return {
      positions,
      normals: new Float32Array(this.nrm),
      partIds: new Uint8Array(vertexCount),
      indices: new Uint16Array(this.idx),
      vertexCount,
      indexCount: this.idx.length,
      bounds: [minX, minY, minZ, maxX, maxY, maxZ],
    };
  }
}

function buildBox(sx: number, sy: number, sz: number): MeshData {
  const m = new MeshBuilder();
  const hx = sx / 2;
  const hz = sz / 2;
  const cy = sy / 2;
  // [normal, u axis, v axis] with half extents along u/v.
  const faces: readonly (readonly number[])[] = [
    [1, 0, 0, 0, 0, hz, 0, cy, 0, hx, cy, 0],
    [-1, 0, 0, 0, 0, hz, 0, cy, 0, -hx, cy, 0],
    [0, 1, 0, hx, 0, 0, 0, 0, hz, 0, sy, 0],
    [0, -1, 0, hx, 0, 0, 0, 0, hz, 0, 0, 0],
    [0, 0, 1, hx, 0, 0, 0, cy, 0, 0, cy, hz],
    [0, 0, -1, hx, 0, 0, 0, cy, 0, 0, cy, -hz],
  ];
  for (const f of faces) {
    const [nx, ny, nz, ux, uy, uz, vx, vy, vz, cx, cyy, cz] = f as [
      number, number, number, number, number, number, number, number, number, number, number, number,
    ];
    const v0 = m.vertex(cx - ux - vx, cyy - uy - vy, cz - uz - vz, nx, ny, nz);
    const v1 = m.vertex(cx + ux - vx, cyy + uy - vy, cz + uz - vz, nx, ny, nz);
    const v2 = m.vertex(cx + ux + vx, cyy + uy + vy, cz + uz + vz, nx, ny, nz);
    const v3 = m.vertex(cx - ux + vx, cyy - uy + vy, cz - uz + vz, nx, ny, nz);
    m.tri(v0, v1, v2, nx, ny, nz);
    m.tri(v0, v2, v3, nx, ny, nz);
  }
  return m.build();
}

/** Box with 8 shared vertices and averaged corner normals (coarsest LOD). */
function buildBoxLow(sx: number, sy: number, sz: number): MeshData {
  const m = new MeshBuilder();
  const hx = sx / 2;
  const hz = sz / 2;
  const v: number[] = [];
  for (let i = 0; i < 8; i++) {
    const x = i & 1 ? hx : -hx;
    const y = i & 2 ? sy : 0;
    const z = i & 4 ? hz : -hz;
    v.push(m.vertex(x, y, z, Math.sign(x), y > 0 ? 1 : -1, Math.sign(z)));
  }
  // faces: [a, b, c, d] corners + outward normal
  const faces: readonly (readonly number[])[] = [
    [1, 3, 7, 5, 1, 0, 0],
    [0, 4, 6, 2, -1, 0, 0],
    [2, 6, 7, 3, 0, 1, 0],
    [0, 1, 5, 4, 0, -1, 0],
    [4, 5, 7, 6, 0, 0, 1],
    [0, 2, 3, 1, 0, 0, -1],
  ];
  for (const f of faces) {
    const [a, b, c, d, nx, ny, nz] = f as [number, number, number, number, number, number, number];
    m.tri(v[a]!, v[b]!, v[c]!, nx, ny, nz);
    m.tri(v[a]!, v[c]!, v[d]!, nx, ny, nz);
  }
  return m.build();
}

function buildCylinder(sx: number, sy: number, sz: number, segments = CYL_SEGMENTS): MeshData {
  const m = new MeshBuilder();
  const rx = sx / 2;
  const rz = sz / 2;
  const S = segments;
  // Side: smooth normals of the (possibly elliptic) mantle.
  const bottom: number[] = [];
  const top: number[] = [];
  for (let i = 0; i < S; i++) {
    const a = (i / S) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const nx = c / Math.max(rx, 1e-6);
    const nz = s / Math.max(rz, 1e-6);
    bottom.push(m.vertex(c * rx, 0, s * rz, nx, 0, nz));
    top.push(m.vertex(c * rx, sy, s * rz, nx, 0, nz));
  }
  for (let i = 0; i < S; i++) {
    const j = (i + 1) % S;
    const a = ((i + 0.5) / S) * Math.PI * 2;
    const nx = Math.cos(a) / Math.max(rx, 1e-6);
    const nz = Math.sin(a) / Math.max(rz, 1e-6);
    m.tri(bottom[i]!, bottom[j]!, top[j]!, nx, 0, nz);
    m.tri(bottom[i]!, top[j]!, top[i]!, nx, 0, nz);
  }
  // Caps with their own flat normals.
  for (const [y, ny] of [
    [sy, 1],
    [0, -1],
  ] as const) {
    const center = m.vertex(0, y, 0, 0, ny, 0);
    const ring: number[] = [];
    for (let i = 0; i < S; i++) {
      const a = (i / S) * Math.PI * 2;
      ring.push(m.vertex(Math.cos(a) * rx, y, Math.sin(a) * rz, 0, ny, 0));
    }
    for (let i = 0; i < S; i++) m.tri(center, ring[i]!, ring[(i + 1) % S]!, 0, ny, 0);
  }
  return m.build();
}

/**
 * Builds the placeholder mesh for a spec (box: 24 vertices/36 indices, cylinder: 66/192).
 * `lod` 1/2 gives coarser levels (cylinder 8/4 segments, box LOD 2 = 8 shared vertices).
 */
export function createPlaceholderMesh(spec: PlaceholderSpec, lod: 0 | 1 | 2 = 0): MeshData {
  const hull = buildHull(spec.hull, spec.size, lod, 'placeholder');
  const t = spec.turret;
  if (t === undefined) return hull;
  const turret = buildHull(t.hull, t.size, lod, 'placeholder turret');
  const [ox, oy, oz] = t.offset;
  if (![ox, oy, oz].every(Number.isFinite)) throw new Error(`placeholder turret: offset must be finite, got ${t.offset.join(',')}`);
  const parts: MeshPart[] = [
    { mesh: hull, partId: 0 },
    { mesh: turret, partId: 1, offset: [ox, oy, oz], pivot: [ox, oy, oz] },
  ];
  if (lod < 2) {
    // Barrel: forward (+x) from the turret front, a third of the turret height, same part.
    const len = Math.max(t.size[0] * 0.8, 0.05);
    const thick = Math.max(Math.min(t.size[1], t.size[2]) * 0.3, 0.02);
    const barrel = buildBox(len, thick, thick);
    parts.push({ mesh: barrel, partId: 1, offset: [ox + t.size[0] * 0.45 + len / 2, oy + t.size[1] * 0.5 - thick / 2, oz] });
  }
  return combineParts(parts);
}

function buildHull(hull: PlaceholderHull, size: readonly [number, number, number], lod: 0 | 1 | 2, what: string): MeshData {
  const [sx, sy, sz] = size;
  if (!(sx > 0 && sy > 0 && sz > 0)) throw new Error(`${what}: size must be positive, got ${size.join(',')}`);
  if (hull === 'box') return lod === 2 ? buildBoxLow(sx, sy, sz) : buildBox(sx, sy, sz);
  return buildCylinder(sx, sy, sz, CYL_LOD_SEGMENTS[lod]);
}

/** The three placeholder LODs of a spec (P2: "Platzhalter-LODs", cylinders 16/8/4 segments). */
export function createPlaceholderLods(spec: PlaceholderSpec): [MeshData, MeshData, MeshData] {
  const lod0 = createPlaceholderMesh(spec, 0);
  // Boxes share LOD 0 and 1 (same 24-vertex mesh, stored once in the unit VBO); with a cylinder turret
  // the levels differ.
  const shared = spec.hull === 'box' && (spec.turret === undefined || spec.turret.hull === 'box');
  const lod1 = shared ? lod0 : createPlaceholderMesh(spec, 1);
  return [lod0, lod1, createPlaceholderMesh(spec, 2)];
}

/** One input of {@link combineParts}. */
export interface MeshPart {
  readonly mesh: MeshData;
  /** Part id written into every vertex (0 = hull). */
  readonly partId: number;
  /** Translation applied to the part's vertices (mesh space). */
  readonly offset?: readonly [number, number, number];
  /** Rotation pivot of this part id (mesh space, after `offset`). */
  readonly pivot?: readonly [number, number, number];
  /** Parent part id (< partId), default 0 (hull). */
  readonly parent?: number;
}

/**
 * Merges meshes into one merged-part mesh (PLAN §3.7): vertices keep their part id, pivots and
 * parents are collected per part id. Several inputs may share a part id (then pivot/parent of the
 * first input with that id win).
 */
export function combineParts(parts: readonly MeshPart[]): MeshData {
  let vtx = 0;
  let idx = 0;
  let maxPart = 0;
  for (const p of parts) {
    if (!Number.isInteger(p.partId) || p.partId < 0 || p.partId >= MAX_MESH_PARTS) {
      throw new Error(`combineParts: partId ${p.partId} outside 0..${MAX_MESH_PARTS - 1}`);
    }
    if ((p.parent ?? 0) >= p.partId && p.partId !== 0) throw new Error(`combineParts: parent of part ${p.partId} must be smaller`);
    vtx += p.mesh.vertexCount;
    idx += p.mesh.indexCount;
    maxPart = Math.max(maxPart, p.partId);
  }
  const positions = new Float32Array(vtx * 3);
  const normals = new Float32Array(vtx * 3);
  const partIds = new Uint8Array(vtx);
  const indices = vtx > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
  const pivots = new Float32Array((maxPart + 1) * 3);
  const parents = new Uint8Array(maxPart + 1);
  const seen = new Uint8Array(maxPart + 1);
  const bounds: [number, number, number, number, number, number] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  let v0 = 0;
  let i0 = 0;
  for (const p of parts) {
    const m = p.mesh;
    const [ox, oy, oz] = p.offset ?? [0, 0, 0];
    for (let v = 0; v < m.vertexCount; v++) {
      const x = m.positions[v * 3]! + ox;
      const y = m.positions[v * 3 + 1]! + oy;
      const z = m.positions[v * 3 + 2]! + oz;
      positions[(v0 + v) * 3] = x;
      positions[(v0 + v) * 3 + 1] = y;
      positions[(v0 + v) * 3 + 2] = z;
      normals[(v0 + v) * 3] = m.normals[v * 3]!;
      normals[(v0 + v) * 3 + 1] = m.normals[v * 3 + 1]!;
      normals[(v0 + v) * 3 + 2] = m.normals[v * 3 + 2]!;
      partIds[v0 + v] = p.partId;
      bounds[0] = Math.min(bounds[0], x);
      bounds[1] = Math.min(bounds[1], y);
      bounds[2] = Math.min(bounds[2], z);
      bounds[3] = Math.max(bounds[3], x);
      bounds[4] = Math.max(bounds[4], y);
      bounds[5] = Math.max(bounds[5], z);
    }
    for (let i = 0; i < m.indexCount; i++) indices[i0 + i] = m.indices[i]! + v0;
    if (seen[p.partId] === 0) {
      seen[p.partId] = 1;
      const pv = p.pivot ?? [0, 0, 0];
      pivots[p.partId * 3] = pv[0];
      pivots[p.partId * 3 + 1] = pv[1];
      pivots[p.partId * 3 + 2] = pv[2];
      parents[p.partId] = p.parent ?? 0;
    }
    v0 += m.vertexCount;
    i0 += m.indexCount;
  }
  return {
    positions,
    normals,
    partIds,
    indices,
    vertexCount: vtx,
    indexCount: idx,
    bounds: vtx > 0 ? bounds : [0, 0, 0, 0, 0, 0],
    partPivots: pivots,
    partParents: parents,
  };
}

/**
 * Radius (WU) of a sphere around the mesh origin that contains the mesh for every part rotation:
 * a part's vertices stay within `|pivot| + max distance to the pivot` (ancestors' pivots included).
 */
export function meshBoundingRadius(m: MeshData): number {
  const pivots = m.partPivots;
  const parents = m.partParents;
  const n = m.vertexCount;
  let r = 0;
  for (let v = 0; v < n; v++) {
    const x = m.positions[v * 3]!;
    const y = m.positions[v * 3 + 1]!;
    const z = m.positions[v * 3 + 2]!;
    let k = m.partIds[v]!;
    if (k === 0 || pivots === undefined) {
      r = Math.max(r, Math.hypot(x, y, z));
      continue;
    }
    // Walk up the chain: distance to the own pivot, then pivot-to-parent-pivot distances.
    let px = pivots[k * 3] ?? 0;
    let py = pivots[k * 3 + 1] ?? 0;
    let pz = pivots[k * 3 + 2] ?? 0;
    let reach = Math.hypot(x - px, y - py, z - pz);
    for (let guard = 0; guard < MAX_MESH_PARTS && k !== 0; guard++) {
      const parent = parents?.[k] ?? 0;
      const qx = parent === 0 ? 0 : (pivots[parent * 3] ?? 0);
      const qy = parent === 0 ? 0 : (pivots[parent * 3 + 1] ?? 0);
      const qz = parent === 0 ? 0 : (pivots[parent * 3 + 2] ?? 0);
      reach += Math.hypot(px - qx, py - qy, pz - qz);
      px = qx;
      py = qy;
      pz = qz;
      k = parent;
    }
    r = Math.max(r, reach);
  }
  return r;
}
