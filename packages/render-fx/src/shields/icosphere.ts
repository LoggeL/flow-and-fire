/**
 * Unit icosphere for the shield bubbles: 10·4ⁿ + 2 vertices, 20·4ⁿ triangles (n = subdivisions),
 * counter-clockwise seen from outside, u16 indices (n ≤ 6).
 */

export interface Icosphere {
  /** xyz per vertex, unit length (also the normal). */
  readonly positions: Float32Array;
  readonly indices: Uint16Array;
  readonly vertexCount: number;
  readonly triangleCount: number;
}

/** Highest subdivision level whose vertices fit u16 indices (6 → 40 962 vertices). */
export const ICOSPHERE_MAX_SUBDIVISIONS = 6;

export function icosphereVertexCount(subdivisions: number): number {
  return 10 * 4 ** subdivisions + 2;
}

export function icosphereTriangleCount(subdivisions: number): number {
  return 20 * 4 ** subdivisions;
}

export function createIcosphere(subdivisions: number): Icosphere {
  if (!Number.isInteger(subdivisions) || subdivisions < 0) throw new Error(`createIcosphere: invalid subdivisions ${subdivisions}`);
  const nv = icosphereVertexCount(subdivisions);
  if (nv > 65536) {
    throw new RangeError(`createIcosphere: ${nv} vertices exceed u16 indices (max ${ICOSPHERE_MAX_SUBDIVISIONS} subdivisions)`);
  }
  const pos = new Float64Array(nv * 3);
  let n = 0;
  const push = (x: number, y: number, z: number): number => {
    const l = Math.hypot(x, y, z);
    pos[n * 3] = x / l;
    pos[n * 3 + 1] = y / l;
    pos[n * 3 + 2] = z / l;
    return n++;
  };
  const t = (1 + Math.sqrt(5)) / 2;
  push(-1, t, 0);
  push(1, t, 0);
  push(-1, -t, 0);
  push(1, -t, 0);
  push(0, -1, t);
  push(0, 1, t);
  push(0, -1, -t);
  push(0, 1, -t);
  push(t, 0, -1);
  push(t, 0, 1);
  push(-t, 0, -1);
  push(-t, 0, 1);
  // prettier-ignore
  let tris: number[] = [
    0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11,
    1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
    3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9,
    4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
  ];
  for (let s = 0; s < subdivisions; s++) {
    const mid = new Map<number, number>();
    const midpoint = (a: number, b: number): number => {
      const key = a < b ? a * 65536 + b : b * 65536 + a;
      const hit = mid.get(key);
      if (hit !== undefined) return hit;
      const v = push(
        (pos[a * 3]! + pos[b * 3]!) / 2,
        (pos[a * 3 + 1]! + pos[b * 3 + 1]!) / 2,
        (pos[a * 3 + 2]! + pos[b * 3 + 2]!) / 2,
      );
      mid.set(key, v);
      return v;
    };
    const next: number[] = [];
    for (let i = 0; i < tris.length; i += 3) {
      const a = tris[i]!;
      const b = tris[i + 1]!;
      const c = tris[i + 2]!;
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      next.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
    }
    tris = next;
  }
  if (n !== nv) throw new Error(`createIcosphere: vertex count ${n} ≠ ${nv}`);
  return {
    positions: Float32Array.from(pos),
    indices: Uint16Array.from(tris),
    vertexCount: nv,
    triangleCount: tris.length / 3,
  };
}
