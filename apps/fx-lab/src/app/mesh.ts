/**
 * Small procedural meshes of the lab (non-indexed triangle lists with flat normals):
 * - {@link unitBoxesMesh}: three unit boxes (hull, upper body, barrel) tagged with a part index,
 * - {@link propMesh}: a tapered octagonal prism (rock or pillar, depending on the instance scale).
 * Vertex layout: f32×3 position, f32×3 normal, f32 part (28 bytes).
 */
import { vf } from '@faf/render';
import type { VertexStreamLayout } from '@faf/render';

export const MESH_STRIDE = 28;
/** Vertices of one box (6 faces × 2 triangles). */
export const BOX_VERTS = 36;

/** Mesh stream at locations 0 (position), 1 (normal), 2 (part). */
export const MESH_STREAM: VertexStreamLayout = {
  stepMode: 'vertex',
  stride: MESH_STRIDE,
  attributes: [
    { location: 0, format: vf('f32', 3, 'float'), offset: 0 },
    { location: 1, format: vf('f32', 3, 'float'), offset: 12 },
    { location: 2, format: vf('f32', 1, 'float'), offset: 24 },
  ],
};

/** Position-only variant of {@link MESH_STREAM} for shadow casters. */
export const MESH_STREAM_POS: VertexStreamLayout = {
  stepMode: 'vertex',
  stride: MESH_STRIDE,
  attributes: [{ location: 0, format: vf('f32', 3, 'float'), offset: 0 }],
};

type V3 = readonly [number, number, number];

function pushVertex(out: number[], p: V3, n: V3, part: number): void {
  out.push(p[0], p[1], p[2], n[0], n[1], n[2], part);
}

function pushTri(out: number[], a: V3, b: V3, c: V3, part: number): void {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l;
  ny /= l;
  nz /= l;
  const n: V3 = [nx, ny, nz];
  pushVertex(out, a, n, part);
  pushVertex(out, b, n, part);
  pushVertex(out, c, n, part);
}

/** Box with x/z ∈ [−1, 1] and y ∈ [0, 1], CCW outward faces. */
function pushBox(out: number[], part: number): void {
  const x0 = -1;
  const x1 = 1;
  const y0 = 0;
  const y1 = 1;
  const z0 = -1;
  const z1 = 1;
  const quad = (a: V3, b: V3, c: V3, d: V3): void => {
    pushTri(out, a, b, c, part);
    pushTri(out, a, c, d, part);
  };
  quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]); // +x
  quad([x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0]); // −x
  quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]); // +y
  quad([x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1]); // −y
  quad([x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1]); // +z
  quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]); // −z
}

/** Hull (part 0), upper body (part 1) and barrel (part 2): 3 × 36 vertices. */
export function unitBoxesMesh(): Float32Array {
  const out: number[] = [];
  for (let p = 0; p < 3; p++) pushBox(out, p);
  return new Float32Array(out);
}

/** Sides of the prop prism. */
export const PROP_SIDES = 8;
/** Top radius relative to the bottom radius. */
export const PROP_TOP_RADIUS = 0.62;

/**
 * Tapered octagonal prism: bottom radius 1 at y = 0, top radius {@link PROP_TOP_RADIUS} at y = 1,
 * flat top (part 1 = top face, part 0 = sides). Every other vertex ring corner is pushed out a little
 * so the silhouette reads as rock rather than a machined column.
 */
export function propMesh(): Float32Array {
  const out: number[] = [];
  const bottom: V3[] = [];
  const top: V3[] = [];
  for (let i = 0; i < PROP_SIDES; i++) {
    const a = (i / PROP_SIDES) * Math.PI * 2;
    const r = i % 2 === 0 ? 1 : 0.86;
    bottom.push([Math.cos(a) * r, 0, Math.sin(a) * r]);
    top.push([Math.cos(a + 0.2) * r * PROP_TOP_RADIUS, 1, Math.sin(a + 0.2) * r * PROP_TOP_RADIUS]);
  }
  for (let i = 0; i < PROP_SIDES; i++) {
    const j = (i + 1) % PROP_SIDES;
    // Outward (CCW seen from outside) winding: bottom i → top i → top j and bottom i → top j → bottom j.
    pushTri(out, bottom[i]!, top[i]!, top[j]!, 0);
    pushTri(out, bottom[i]!, top[j]!, bottom[j]!, 0);
  }
  const centre: V3 = [0, 1.06, 0];
  for (let i = 0; i < PROP_SIDES; i++) {
    const j = (i + 1) % PROP_SIDES;
    pushTri(out, centre, top[j]!, top[i]!, 1);
  }
  return new Float32Array(out);
}

/** Vertex count of a mesh array. */
export function meshVertexCount(mesh: Float32Array): number {
  return mesh.length / (MESH_STRIDE / 4);
}
