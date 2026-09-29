/** Test helpers: triangle soups, watertightness, signed volume. */
import { dedupe, type Lod, type Poly, type PrimNode, type Vec3 } from '../src/index.ts';

export type Tri = [Vec3, Vec3, Vec3];

export function trisOf(polys: Poly[]): Tri[] {
  const out: Tri[] = [];
  for (const raw of polys) {
    const p = dedupe(raw);
    for (let k = 1; k + 1 < p.length; k++) out.push([p[0]!, p[k]!, p[k + 1]!]);
  }
  return out;
}

export function primTris(prim: PrimNode, lod: Lod = 0, minFeature = 0): Tri[] {
  return trisOf(prim.gen(lod, minFeature));
}

/** Signed volume (> 0 for closed meshes with outward normals). */
export function signedVolume(tris: Tri[]): number {
  let v = 0;
  for (const [a, b, c] of tris) {
    v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return v;
}

const key = (p: Vec3): string => p.map((v) => (Math.round(v * 1e6) / 1e6 + 0).toFixed(6)).join(',');

/** Every directed edge must be matched by exactly one opposite edge (closed, consistently oriented 2-manifold). */
export function openEdges(tris: Tri[]): number {
  const count = new Map<string, number>();
  for (const [a, b, c] of tris) {
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const k = `${key(p)}>${key(q)}`;
      count.set(k, (count.get(k) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const [k, n] of count) {
    const [p, q] = k.split('>');
    const back = count.get(`${q}>${p}`) ?? 0;
    if (n !== 1 || back !== 1) open++;
  }
  return open;
}
