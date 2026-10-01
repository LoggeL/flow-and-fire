/**
 * Procedural low-poly geometry for pipeline source models (P3: own placeholder art, nothing from
 * FA). Mesh space = render convention (`@faf/render` MeshData): origin at the footprint centre on
 * the ground, +y up, forward = +x. Triangles are counter-clockwise seen from outside, every vertex
 * carries a part id (merged-part meshes, PLAN §3.7).
 *
 * All coordinates are snapped to a 1/4096 grid and normals to 1/16384 before they become float32,
 * so the checked-in pipeline output does not depend on last-ulp differences of Math.sin/cos.
 */

/** Plain mesh arrays of one LOD. */
export interface LodGeometry {
  readonly positions: Float32Array<ArrayBuffer>;
  readonly normals: Float32Array<ArrayBuffer>;
  readonly partIds: Uint8Array<ArrayBuffer>;
  readonly indices: Uint16Array<ArrayBuffer> | Uint32Array<ArrayBuffer>;
  /** Modelkit palette in linear RGB; omitted by legacy benchmark geometry. */
  readonly colors?: Float32Array<ArrayBuffer>;
  /** Team, emissive, metal and ambient-occlusion channels. */
  readonly mask?: Uint8Array<ArrayBuffer>;
}

const POS_GRID = 4096;
const NRM_GRID = 16384;

function snap(v: number, grid: number): number {
  const r = Math.round(v * grid) / grid;
  return r === 0 ? 0 : r; // no −0
}

export class GeometryBuilder {
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];
  private readonly part: number[] = [];
  private readonly idx: number[] = [];

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  vertex(part: number, x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
    const len = Math.hypot(nx, ny, nz) || 1;
    this.pos.push(snap(x, POS_GRID), snap(y, POS_GRID), snap(z, POS_GRID));
    this.nrm.push(snap(nx / len, NRM_GRID), snap(ny / len, NRM_GRID), snap(nz / len, NRM_GRID));
    this.part.push(part);
    return this.vertexCount - 1;
  }

  /** Triangle a, b, c; the winding is flipped if needed so the face points along (nx, ny, nz). */
  tri(a: number, b: number, c: number, nx: number, ny: number, nz: number): void {
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
    if (cx * nx + cy * ny + cz * nz < 0) this.idx.push(a, c, b);
    else this.idx.push(a, b, c);
  }

  /** Axis-aligned box [min, max] with flat faces (24 vertices, 12 triangles). */
  box(part: number, min: readonly [number, number, number], max: readonly [number, number, number]): void {
    const [x0, y0, z0] = min;
    const [x1, y1, z1] = max;
    const faces: [number, number, number, [number, number, number][]][] = [
      [1, 0, 0, [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]]],
      [-1, 0, 0, [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]],
      [0, 1, 0, [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]]],
      [0, -1, 0, [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]],
      [0, 0, 1, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]],
      [0, 0, -1, [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]]],
    ];
    for (const [nx, ny, nz, q] of faces) {
      const v = q.map(([x, y, z]) => this.vertex(part, x, y, z, nx, ny, nz));
      this.tri(v[0]!, v[1]!, v[2]!, nx, ny, nz);
      this.tri(v[0]!, v[2]!, v[3]!, nx, ny, nz);
    }
  }

  /**
   * Cylinder along `axis` ('y' up or 'x' forward) from `from` to `to` (along the axis) around the
   * centre (c0, c1) of the two other axes (y: (x, z); x: (y, z)). Smooth sides, flat caps.
   */
  cylinder(
    part: number,
    axis: 'x' | 'y',
    c0: number,
    c1: number,
    from: number,
    to: number,
    radius: number,
    segments: number,
    caps: { readonly start: boolean; readonly end: boolean } = { start: true, end: true },
  ): void {
    // Local frame: a = axis coordinate, (u, w) = radial plane.
    const place = (a: number, u: number, w: number): [number, number, number] =>
      axis === 'y' ? [c0 + u, a, c1 + w] : [a, c0 + u, c1 + w];
    const dir = (da: number, du: number, dw: number): [number, number, number] => (axis === 'y' ? [du, da, dw] : [da, du, dw]);
    const ring: [number, number][] = [];
    // Start half a segment off the axis so 4 segments give a square aligned to the other axes.
    for (let i = 0; i < segments; i++) {
      const t = ((i + 0.5) / segments) * Math.PI * 2;
      ring.push([Math.cos(t), Math.sin(t)]);
    }
    // Sides.
    const side: number[] = [];
    for (const [cu, cw] of ring) {
      const [nx, ny, nz] = dir(0, cu, cw);
      const p0 = place(from, cu * radius, cw * radius);
      const p1 = place(to, cu * radius, cw * radius);
      side.push(this.vertex(part, p0[0], p0[1], p0[2], nx, ny, nz), this.vertex(part, p1[0], p1[1], p1[2], nx, ny, nz));
    }
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments;
      const [cu, cw] = ring[i]!;
      const [du, dw] = ring[j]!;
      const [nx, ny, nz] = dir(0, cu + du, cw + dw);
      this.tri(side[i * 2]!, side[j * 2]!, side[j * 2 + 1]!, nx, ny, nz);
      this.tri(side[i * 2]!, side[j * 2 + 1]!, side[i * 2 + 1]!, nx, ny, nz);
    }
    // Caps (fan around a centre vertex).
    const cap = (a: number, sign: number): void => {
      const [nx, ny, nz] = dir(sign, 0, 0);
      const cp = place(a, 0, 0);
      const centre = this.vertex(part, cp[0], cp[1], cp[2], nx, ny, nz);
      const rim = ring.map(([cu, cw]) => {
        const p = place(a, cu * radius, cw * radius);
        return this.vertex(part, p[0], p[1], p[2], nx, ny, nz);
      });
      for (let i = 0; i < segments; i++) this.tri(centre, rim[i]!, rim[(i + 1) % segments]!, nx, ny, nz);
    };
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    if (caps.start) cap(from, from === lo ? -1 : 1);
    if (caps.end) cap(to, to === hi ? 1 : -1);
  }

  build(): LodGeometry {
    if (this.vertexCount > 65535) throw new RangeError('GeometryBuilder: more than 65,535 vertices');
    return {
      positions: new Float32Array(this.pos),
      normals: new Float32Array(this.nrm),
      partIds: new Uint8Array(this.part),
      indices: new Uint16Array(this.idx),
    };
  }
}
