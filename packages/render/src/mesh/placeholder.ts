/**
 * Procedural placeholder meshes (PLAN §3.7 "Platzhalter"): gameplay never waits for art.
 *
 * Mesh space: origin at the center of the footprint on the ground, +y up, forward = +x
 * (Ang16 yaw 0). Triangles are counter-clockwise seen from outside. Every vertex carries a
 * `partId` for merged-part meshes; placeholder hulls are a single part (0).
 */

export type PlaceholderHull = 'box' | 'cyl';

export interface PlaceholderSpec {
  readonly hull: PlaceholderHull;
  /** Extent in WU along x (forward), y (height), z (side). */
  readonly size: readonly [number, number, number];
  /** Base color (linear 0..1); used by the renderer's visual table. */
  readonly color?: readonly [number, number, number];
}

export interface MeshData {
  /** xyz per vertex. */
  readonly positions: Float32Array;
  /** Unit-length xyz normal per vertex. */
  readonly normals: Float32Array;
  /** Part index per vertex (merged-part meshes, PLAN §3.7). */
  readonly partIds: Uint8Array;
  readonly indices: Uint16Array;
  readonly vertexCount: number;
  readonly indexCount: number;
  /** Axis-aligned bounds in mesh space: [minX, minY, minZ, maxX, maxY, maxZ]. */
  readonly bounds: readonly [number, number, number, number, number, number];
}

/** Segments around a placeholder cylinder. */
export const CYL_SEGMENTS = 16;

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

function buildCylinder(sx: number, sy: number, sz: number): MeshData {
  const m = new MeshBuilder();
  const rx = sx / 2;
  const rz = sz / 2;
  const S = CYL_SEGMENTS;
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

/** Builds the placeholder mesh for a spec (box: 24 vertices/36 indices, cylinder: 66/192). */
export function createPlaceholderMesh(spec: PlaceholderSpec): MeshData {
  const [sx, sy, sz] = spec.size;
  if (!(sx > 0 && sy > 0 && sz > 0)) throw new Error(`placeholder: size must be positive, got ${spec.size.join(',')}`);
  return spec.hull === 'box' ? buildBox(sx, sy, sz) : buildCylinder(sx, sy, sz);
}
