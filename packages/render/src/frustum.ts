/**
 * View-frustum culling on the CPU (PLAN §3.7 "Chunk-Frustum plus Kugeltest").
 *
 * Planes are extracted from the camera-relative view-projection matrix (origin = `camPosInt`, WU), so
 * all tests take coordinates relative to `camPosInt` in WU – the same space the shaders use.
 * Plane normals are normalized; a point p is inside a plane when `dot(n, p) + d ≥ 0`.
 */

/** Result of an AABB test. */
export const OUTSIDE = 0;
export const INTERSECTS = 1;
export const INSIDE = 2;
export type CullResult = typeof OUTSIDE | typeof INTERSECTS | typeof INSIDE;

export class Frustum {
  /** 6 planes × (nx, ny, nz, d): left, right, bottom, top, near, far. */
  readonly planes = new Float64Array(24);

  /** Gribb/Hartmann extraction from a column-major (gl-matrix) view-projection matrix. */
  setFromViewProj(m: ArrayLike<number>): this {
    const p = this.planes;
    for (let i = 0; i < 6; i++) {
      const row = i >> 1; // 0: x, 1: y, 2: z
      const sign = (i & 1) === 0 ? 1 : -1;
      const a = m[3]! + sign * m[row]!;
      const b = m[7]! + sign * m[4 + row]!;
      const c = m[11]! + sign * m[8 + row]!;
      const d = m[15]! + sign * m[12 + row]!;
      const len = Math.hypot(a, b, c) || 1;
      p[i * 4] = a / len;
      p[i * 4 + 1] = b / len;
      p[i * 4 + 2] = c / len;
      p[i * 4 + 3] = d / len;
    }
    return this;
  }

  /** Axis-aligned box test (p-/n-vertex): OUTSIDE, INTERSECTS or INSIDE. */
  testAabb(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): CullResult {
    const p = this.planes;
    let inside = true;
    for (let i = 0; i < 24; i += 4) {
      const nx = p[i]!;
      const ny = p[i + 1]!;
      const nz = p[i + 2]!;
      const d = p[i + 3]!;
      // Positive vertex: the corner furthest along the normal.
      const px = nx >= 0 ? maxX : minX;
      const py = ny >= 0 ? maxY : minY;
      const pz = nz >= 0 ? maxZ : minZ;
      if (nx * px + ny * py + nz * pz + d < 0) return OUTSIDE;
      const qx = nx >= 0 ? minX : maxX;
      const qy = ny >= 0 ? minY : maxY;
      const qz = nz >= 0 ? minZ : maxZ;
      if (nx * qx + ny * qy + nz * qz + d < 0) inside = false;
    }
    return inside ? INSIDE : INTERSECTS;
  }

  /** Sphere test: false when the sphere lies completely outside one plane. */
  sphereVisible(x: number, y: number, z: number, r: number): boolean {
    const p = this.planes;
    for (let i = 0; i < 24; i += 4) {
      if (p[i]! * x + p[i + 1]! * y + p[i + 2]! * z + p[i + 3]! < -r) return false;
    }
    return true;
  }
}
