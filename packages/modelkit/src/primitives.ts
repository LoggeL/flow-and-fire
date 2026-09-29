/**
 * Primitive generators. Every generator returns planar, convex polygons (counter-clockwise seen from outside,
 * so the Newell normal points outwards) in local space, centered on the bounding box of the primitive.
 * `lod` (0–2) lowers the segment counts of round primitives; flat primitives ignore it.
 */
import { cross, dot, newell, sub, type Vec2, type Vec3 } from './math.ts';

export type Poly = Vec3[];
export type Axis = 'x' | 'y' | 'z';
export type Lod = 0 | 1 | 2;

/** Segment count for a LOD: LOD1 ≈ 60 %, LOD2 ≈ 40 %, rounded to an even count, never below `min`. */
export function lodSegments(n: number, lod: Lod, min = 4): number {
  if (!Number.isInteger(n) || n < 3) throw new RangeError(`segments must be an integer ≥ 3 (got ${n})`);
  if (lod === 0) return n;
  const f = lod === 1 ? 0.6 : 0.4;
  const even = 2 * Math.round((n * f) / 2);
  return Math.min(n, Math.max(min, even));
}

/** Ring count (latitude bands) for a LOD, never below `min`. */
export function lodRings(n: number, lod: Lod, min = 1): number {
  if (lod === 0) return n;
  return Math.min(n, Math.max(min, Math.round(n * (lod === 1 ? 0.67 : 0.4))));
}

/** Maps local "y-up" coordinates (x, y, z) onto the requested main axis. */
export function toAxis(p: Vec3, axis: Axis): Vec3 {
  switch (axis) {
    case 'y':
      return p;
    case 'z':
      // local y → +z, local z → -y … right-handed rotation of +90° about X
      return [p[0], -p[2], p[1]];
    case 'x':
      // local y → +x, local x → -y … rotation of -90° about Z
      return [p[1], -p[0], p[2]];
  }
}

function mapPolys(polys: Poly[], axis: Axis): Poly[] {
  return axis === 'y' ? polys : polys.map((poly) => poly.map((p) => toAxis(p, axis)));
}

/** Removes consecutive duplicate points (degenerate edges from collapsed rings). */
export function dedupe(poly: Poly, eps = 1e-9): Poly {
  const out: Vec3[] = [];
  for (const p of poly) {
    const q = out[out.length - 1];
    if (q === undefined || Math.abs(p[0] - q[0]) > eps || Math.abs(p[1] - q[1]) > eps || Math.abs(p[2] - q[2]) > eps) out.push(p);
  }
  while (out.length > 1) {
    const a = out[0]!;
    const b = out[out.length - 1]!;
    if (Math.abs(a[0] - b[0]) > eps || Math.abs(a[1] - b[1]) > eps || Math.abs(a[2] - b[2]) > eps) break;
    out.pop();
  }
  return out;
}

/** Reverses `poly` if its normal points against `expected`. */
function orient(poly: Poly, expected: Vec3): Poly {
  return dot(newell(poly), expected) < 0 ? poly.slice().reverse() : poly;
}

// ---------------------------------------------------------------------------------------------------------------
// Loft: stacked horizontal rings (same point count, points in increasing angle θ with x = cos θ, z = sin θ).

export interface Ring {
  readonly y: number;
  readonly pts: readonly Vec2[];
}

export function loft(rings: readonly Ring[], caps: { bottom?: boolean; top?: boolean } = {}): Poly[] {
  const out: Poly[] = [];
  const n = rings[0]?.pts.length ?? 0;
  for (const r of rings) if (r.pts.length !== n) throw new RangeError('loft: all rings need the same point count');
  const at = (r: Ring, j: number): Vec3 => {
    const p = r.pts[((j % n) + n) % n]!;
    return [p[0], r.y, p[1]];
  };
  for (let i = 0; i + 1 < rings.length; i++) {
    const r0 = rings[i]!;
    const r1 = rings[i + 1]!;
    for (let j = 0; j < n; j++) out.push([at(r0, j), at(r1, j), at(r1, j + 1), at(r0, j + 1)]);
  }
  const first = rings[0];
  const last = rings[rings.length - 1];
  if (caps.bottom !== false && first !== undefined) out.push(first.pts.map((_, j) => at(first, j)));
  if (caps.top !== false && last !== undefined) out.push(last.pts.map((_, j) => at(last, n - 1 - j)));
  return out;
}

function circle(r: number, segs: number, phase = 0.5): Vec2[] {
  const pts: Vec2[] = [];
  for (let j = 0; j < segs; j++) {
    const t = ((j + phase) / segs) * Math.PI * 2;
    pts.push([r * Math.cos(t), r * Math.sin(t)]);
  }
  return pts;
}

/**
 * Rectangle (optionally with cut corners = octagon) with half extents and per-side insets, points in θ order.
 * Always 8 points so rings with and without corner cuts can be lofted together.
 */
function octo(hx: number, hz: number, inset: Insets, cut: number): Vec2[] {
  const xp = hx - inset.xp;
  const xn = -hx + inset.xn;
  const zp = hz - inset.zp;
  const zn = -hz + inset.zn;
  const c = Math.max(0, Math.min(cut, (xp - xn) / 2, (zp - zn) / 2));
  return [
    [xp, zp - c],
    [xp - c, zp],
    [xn + c, zp],
    [xn, zp - c],
    [xn, zn + c],
    [xn + c, zn],
    [xp - c, zn],
    [xp, zn + c],
  ];
}

interface Insets {
  xp: number;
  xn: number;
  zp: number;
  zn: number;
}

// ---------------------------------------------------------------------------------------------------------------

export function boxPolys(size: Vec3): Poly[] {
  return beveledBoxPolys(size, {});
}

export interface Bevel {
  /** Chamfer of the four top edges (45°), WU. */
  readonly top?: number;
  /** Chamfer of the four bottom edges, WU. */
  readonly bottom?: number;
  /** Chamfer of the four vertical edges, WU. */
  readonly side?: number;
  /** Overrides `top` on the front (+Z) edge (e.g. a steeper bow). */
  readonly topFront?: number;
  /** Overrides `top` on the back (-Z) edge. */
  readonly topBack?: number;
  /** Overrides `bottom` on the front (+Z) edge. */
  readonly bottomFront?: number;
  /** Overrides `bottom` on the back (-Z) edge. */
  readonly bottomBack?: number;
}

export function beveledBoxPolys(size: Vec3, bevel: Bevel): Poly[] {
  const [w, h, d] = size;
  if (!(w > 0 && h > 0 && d > 0)) throw new RangeError(`box size must be positive (got ${size.join(',')})`);
  const hx = w / 2;
  const hz = d / 2;
  const top = bevel.top ?? 0;
  const bot = bevel.bottom ?? 0;
  const side = bevel.side ?? 0;
  const tIn: Insets = { xp: top, xn: top, zp: bevel.topFront ?? top, zn: bevel.topBack ?? top };
  const bIn: Insets = { xp: bot, xn: bot, zp: bevel.bottomFront ?? bot, zn: bevel.bottomBack ?? bot };
  const zero: Insets = { xp: 0, xn: 0, zp: 0, zn: 0 };
  const tMax = Math.max(tIn.xp, tIn.zp, tIn.zn);
  const bMax = Math.max(bIn.xp, bIn.zp, bIn.zn);
  if (tMax + bMax > h + 1e-9) throw new RangeError('beveledBox: top + bottom bevel exceed the height');
  if (Math.max(tIn.xp, bIn.xp) * 2 > w || Math.max(tIn.zp + tIn.zn, bIn.zp + bIn.zn) > d) {
    throw new RangeError('beveledBox: bevel wider than the box');
  }
  // 45° chamfers: the inset of a side equals its height. Sides with smaller insets reach the full box
  // earlier, so every ring uses the per-side inset scaled to the ring height (straight chamfer planes).
  const rings: Ring[] = [];
  const y0 = -h / 2;
  const y3 = h / 2;
  if (bMax > 0) {
    rings.push({ y: y0, pts: octo(hx, hz, bIn, side) });
    // intermediate rings where single sides finish their chamfer keep chamfer faces planar
    for (const v of uniqueSorted([bIn.xp, bIn.zp, bIn.zn]).filter((v) => v > 0 && v < bMax)) {
      rings.push({ y: y0 + v, pts: octo(hx, hz, clampIn(bIn, v), side) });
    }
    rings.push({ y: y0 + bMax, pts: octo(hx, hz, zero, side) });
  } else {
    rings.push({ y: y0, pts: octo(hx, hz, zero, side) });
  }
  if (tMax > 0) {
    rings.push({ y: y3 - tMax, pts: octo(hx, hz, zero, side) });
    for (const v of uniqueSorted([tIn.xp, tIn.zp, tIn.zn]).filter((v) => v > 0 && v < tMax).reverse()) {
      rings.push({ y: y3 - v, pts: octo(hx, hz, clampIn(tIn, v), side) });
    }
    rings.push({ y: y3, pts: octo(hx, hz, tIn, side) });
  } else {
    rings.push({ y: y3, pts: octo(hx, hz, zero, side) });
  }
  return loft(dedupeRings(rings));
}

/** Inset that has progressed `v` WU of height into the chamfer from the flat side (each side stops at its max). */
function clampIn(ins: Insets, v: number): Insets {
  return {
    xp: Math.max(0, ins.xp - v),
    xn: Math.max(0, ins.xn - v),
    zp: Math.max(0, ins.zp - v),
    zn: Math.max(0, ins.zn - v),
  };
}

function uniqueSorted(vs: number[]): number[] {
  return [...new Set(vs)].sort((a, b) => a - b);
}

function dedupeRings(rings: Ring[]): Ring[] {
  const out: Ring[] = [];
  for (const r of rings) {
    const prev = out[out.length - 1];
    if (prev !== undefined && Math.abs(prev.y - r.y) < 1e-9) {
      out[out.length - 1] = r;
      continue;
    }
    out.push(r);
  }
  return out;
}

/** Regular n-gon prism along `axis`, circumradius `radius`. A flat face points to +Z for even n (axis y). */
export function prismPolys(sides: number, radius: number, height: number, axis: Axis): Poly[] {
  if (!Number.isInteger(sides) || sides < 3) throw new RangeError('prism: sides must be an integer ≥ 3');
  const pts = circle(radius, sides);
  return mapPolys(
    loft([
      { y: -height / 2, pts },
      { y: height / 2, pts },
    ]),
    axis,
  );
}

export interface CylinderSpec {
  readonly radius: number;
  readonly radiusTop?: number;
  readonly height: number;
  readonly segments: number;
  readonly axis: Axis;
  readonly caps?: boolean | 'top' | 'bottom';
}

export function cylinderPolys(s: CylinderSpec, lod: Lod): Poly[] {
  const segs = lodSegments(s.segments, lod, s.radiusTop === 0 ? 3 : 4);
  const rt = s.radiusTop ?? s.radius;
  const caps = s.caps ?? true;
  return mapPolys(
    loft(
      [
        { y: -s.height / 2, pts: circle(s.radius, segs) },
        { y: s.height / 2, pts: circle(rt, segs) },
      ],
      { bottom: caps === true || caps === 'bottom', top: caps === true || caps === 'top' },
    ),
    s.axis,
  );
}

export interface SphereSpec {
  readonly radius: number;
  readonly segments: number;
  readonly rings: number;
  /** Upper half only, closed by a flat disc at y = 0 (the result is still centered on its bounding box). */
  readonly hemi?: boolean;
  readonly axis: Axis;
}

export function spherePolys(s: SphereSpec, lod: Lod): Poly[] {
  const segs = lodSegments(s.segments, lod);
  const bands = lodRings(s.rings, lod, s.hemi === true ? 1 : 2);
  const rings: Ring[] = [];
  const start = s.hemi === true ? Math.PI / 2 : Math.PI;
  const yShift = s.hemi === true ? -s.radius / 2 : 0;
  for (let i = 0; i <= bands; i++) {
    const phi = start - (start * i) / bands; // polar angle from +Y
    const r = s.radius * Math.sin(phi);
    const y = s.radius * Math.cos(phi) + yShift;
    rings.push({ y, pts: circle(Math.abs(r) < 1e-12 ? 0 : r, segs) });
  }
  return mapPolys(loft(rings, { bottom: s.hemi === true, top: false }), s.axis);
}

export function icospherePolys(radius: number, detail: number, lod: Lod): Poly[] {
  const level = Math.max(0, detail - lod);
  const t = (1 + Math.sqrt(5)) / 2;
  let verts: Vec3[] = [
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
  const norm = (v: Vec3): Vec3 => {
    const l = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  verts = verts.map(norm);
  for (let k = 0; k < level; k++) {
    const cache = new Map<string, number>();
    const mid = (a: number, b: number): number => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      const va = verts[a]!;
      const vb = verts[b]!;
      verts.push(norm([(va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2, (va[2] + vb[2]) / 2]));
      cache.set(key, verts.length - 1);
      return verts.length - 1;
    };
    const next: [number, number, number][] = [];
    for (const [a, b, c] of faces) {
      const ab = mid(a, b);
      const bc = mid(b, c);
      const ca = mid(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  return faces.map(([a, b, c]) => {
    const poly: Poly = [a, b, c].map((i) => {
      const v = verts[i]!;
      return [v[0] * radius, v[1] * radius, v[2] * radius] as Vec3;
    });
    const cen: Vec3 = [
      (poly[0]![0] + poly[1]![0] + poly[2]![0]) / 3,
      (poly[0]![1] + poly[1]![1] + poly[2]![1]) / 3,
      (poly[0]![2] + poly[1]![2] + poly[2]![2]) / 3,
    ];
    return orient(poly, cen);
  });
}

export interface CapsuleSpec {
  readonly radius: number;
  /** Total length including both caps (≥ 2 × radius). */
  readonly length: number;
  readonly segments: number;
  readonly rings: number;
  readonly axis: Axis;
}

export function capsulePolys(s: CapsuleSpec, lod: Lod): Poly[] {
  if (s.length < 2 * s.radius) throw new RangeError('capsule: length must be ≥ 2 × radius');
  const segs = lodSegments(s.segments, lod);
  const bands = lodRings(s.rings, lod, 1);
  const half = s.length / 2 - s.radius;
  const rings: Ring[] = [];
  for (let i = 0; i <= bands; i++) {
    const phi = Math.PI - ((Math.PI / 2) * i) / bands;
    const r = s.radius * Math.sin(phi);
    rings.push({ y: -half + s.radius * Math.cos(phi), pts: circle(Math.abs(r) < 1e-12 ? 0 : r, segs) });
  }
  for (let i = 0; i <= bands; i++) {
    const phi = Math.PI / 2 - ((Math.PI / 2) * i) / bands;
    const r = s.radius * Math.sin(phi);
    rings.push({ y: half + s.radius * Math.cos(phi), pts: circle(Math.abs(r) < 1e-12 ? 0 : r, segs) });
  }
  return mapPolys(loft(dedupeRings(rings), { bottom: false, top: false }), s.axis);
}

export interface TorusSpec {
  /** Radius of the ring center line. */
  readonly radius: number;
  /** Radius of the tube cross-section. */
  readonly tube: number;
  readonly segments: number;
  readonly sides: number;
  /** Ring axis (the torus lies in the plane perpendicular to it). */
  readonly axis: Axis;
}

export function torusPolys(s: TorusSpec, lod: Lod): Poly[] {
  const segs = lodSegments(s.segments, lod);
  const sides = lodSegments(s.sides, lod, 3);
  const out: Poly[] = [];
  const pt = (i: number, j: number): Vec3 => {
    const u = ((i + 0.5) / segs) * Math.PI * 2;
    const v = (j / sides) * Math.PI * 2;
    const r = s.radius + s.tube * Math.cos(v);
    return [r * Math.cos(u), s.tube * Math.sin(v), r * Math.sin(u)];
  };
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < sides; j++) {
      const q: Poly = [pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1)];
      const um = ((i + 1) / segs) * Math.PI * 2;
      const c = q.reduce<Vec3>((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4, a[2] + p[2] / 4], [0, 0, 0]);
      // the center line is a polygon too: its edge midpoint lies at radius · cos(π / segs)
      const rc = s.radius * Math.cos(Math.PI / segs);
      const center: Vec3 = [rc * Math.cos(um), 0, rc * Math.sin(um)];
      out.push(orient(q, sub(c, center)));
    }
  }
  return mapPolys(out, s.axis);
}

export interface TubeSpec {
  readonly outer: number;
  readonly inner: number;
  readonly height: number;
  readonly segments: number;
  readonly axis: Axis;
  /** Closed bottom of this thickness (bowl / ladle); 0 or undefined = open pipe. */
  readonly floor?: number;
}

export function tubePolys(s: TubeSpec, lod: Lod): Poly[] {
  if (!(s.inner > 0 && s.inner < s.outer)) throw new RangeError('tube: 0 < inner < outer required');
  const segs = lodSegments(s.segments, lod);
  const o = circle(s.outer, segs);
  const inn = circle(s.inner, segs);
  const y0 = -s.height / 2;
  const y1 = s.height / 2;
  const floor = s.floor ?? 0;
  if (floor >= s.height) throw new RangeError('tube: floor thicker than the height');
  const out: Poly[] = [];
  const p = (v: Vec2, y: number): Vec3 => [v[0], y, v[1]];
  const yi = y0 + floor;
  for (let j = 0; j < segs; j++) {
    const k = (j + 1) % segs;
    // outer wall
    out.push([p(o[j]!, y0), p(o[j]!, y1), p(o[k]!, y1), p(o[k]!, y0)]);
    // inner wall (faces the axis)
    out.push(orient([p(inn[j]!, yi), p(inn[j]!, y1), p(inn[k]!, y1), p(inn[k]!, yi)], [-(inn[j]![0] + inn[k]![0]), 0, -(inn[j]![1] + inn[k]![1])]));
    // top rim
    out.push(orient([p(o[j]!, y1), p(o[k]!, y1), p(inn[k]!, y1), p(inn[j]!, y1)], [0, 1, 0]));
    if (floor <= 0) out.push(orient([p(o[j]!, y0), p(o[k]!, y0), p(inn[k]!, y0), p(inn[j]!, y0)], [0, -1, 0]));
  }
  if (floor > 0) {
    out.push(orient(o.map((v) => p(v, y0)), [0, -1, 0]));
    out.push(orient(inn.map((v) => p(v, yi)), [0, 1, 0]));
  }
  return mapPolys(out, s.axis);
}

/** Profile axes of `extrudePolys`: axis x → profile (z, y) side view; y → (x, z) top view; z → (x, y) front view. */
function profileTo3(u: number, v: number, w: number, axis: Axis): Vec3 {
  switch (axis) {
    case 'x':
      return [w, v, u];
    case 'y':
      return [u, w, v];
    case 'z':
      return [u, v, w];
  }
}

const AXIS_VEC: Record<Axis, Vec3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

/**
 * Extrudes a simple polygon (convex or concave, any winding) by `depth` along `axis`, centered on the axis.
 * Profile coordinates: axis 'x' → [z, y] (side view, +Z = front), 'y' → [x, z] (top view), 'z' → [x, y].
 */
export function extrudePolys(profile: readonly Vec2[], depth: number, axis: Axis, minArea = 0): Poly[] {
  if (profile.length < 3) throw new RangeError('extrude: profile needs ≥ 3 points');
  checkSimple(profile);
  if (minArea > 0) profile = simplifyProfile(profile, minArea);
  const ax = AXIS_VEC[axis];
  const w1 = depth / 2;
  let front: Vec3[] = profile.map(([u, v]) => profileTo3(u, v, w1, axis));
  if (dot(newell(front), ax) < 0) front = front.slice().reverse();
  const back = front.map((p): Vec3 => [p[0] - ax[0] * depth, p[1] - ax[1] * depth, p[2] - ax[2] * depth]);
  const out: Poly[] = [];
  const tris = earClip(front, ax);
  for (const [a, b, c] of tris) {
    out.push([front[a]!, front[b]!, front[c]!]);
    out.push([back[c]!, back[b]!, back[a]!]);
  }
  const n = front.length;
  for (let i = 0; i < n; i++) {
    const k = (i + 1) % n;
    const edge = sub(front[k]!, front[i]!);
    out.push(orient([front[i]!, back[i]!, back[k]!, front[k]!], cross(edge, ax)));
  }
  return out;
}

/** Throws for degenerate or self-intersecting profiles. */
function checkSimple(p: readonly Vec2[]): void {
  let area = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!;
    const b = p[(i + 1) % p.length]!;
    area += a[0] * b[1] - b[0] * a[1];
  }
  if (Math.abs(area) < 1e-12) throw new RangeError('extrude: profile has no area');
  const cross2 = (o: Vec2, a: Vec2, b: Vec2): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const n = p.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      const a = p[i]!;
      const b = p[(i + 1) % n]!;
      const c = p[j]!;
      const d = p[(j + 1) % n]!;
      if (cross2(a, b, c) * cross2(a, b, d) < 0 && cross2(c, d, a) * cross2(c, d, b) < 0) {
        throw new RangeError('extrude: profile is self-intersecting');
      }
    }
  }
}

/**
 * Visvalingam–Whyatt: repeatedly removes the vertex whose triangle with its neighbours has the smallest area,
 * while that area is below `minArea` and at least 3 (convex hull-ish) vertices remain. Used for automatic LODs.
 */
export function simplifyProfile(profile: readonly Vec2[], minArea: number): Vec2[] {
  const pts = profile.slice();
  const area = (a: Vec2, b: Vec2, c: Vec2): number => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
  while (pts.length > 4) {
    let best = -1;
    let bestA = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = area(pts[(i + pts.length - 1) % pts.length]!, pts[i]!, pts[(i + 1) % pts.length]!);
      if (a < bestA - 1e-12) {
        bestA = a;
        best = i;
      }
    }
    if (best < 0 || bestA >= minArea) break;
    pts.splice(best, 1);
  }
  return pts;
}

/** Ear clipping of a simple polygon whose normal points along `normal`; returns index triples. */
export function earClip(poly: readonly Vec3[], normal: Vec3): [number, number, number][] {
  const idx = poly.map((_, i) => i);
  const out: [number, number, number][] = [];
  const isConvex = (a: Vec3, b: Vec3, c: Vec3): boolean => dot(cross(sub(b, a), sub(c, b)), normal) > 1e-12;
  const inTri = (p: Vec3, a: Vec3, b: Vec3, c: Vec3): boolean => {
    const s1 = dot(cross(sub(b, a), sub(p, a)), normal);
    const s2 = dot(cross(sub(c, b), sub(p, b)), normal);
    const s3 = dot(cross(sub(a, c), sub(p, c)), normal);
    return s1 >= -1e-12 && s2 >= -1e-12 && s3 >= -1e-12;
  };
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length]!;
      const ib = idx[i]!;
      const ic = idx[(i + 1) % idx.length]!;
      const a = poly[ia]!;
      const b = poly[ib]!;
      const c = poly[ic]!;
      if (!isConvex(a, b, c)) continue;
      let blocked = false;
      for (const j of idx) {
        if (j === ia || j === ib || j === ic) continue;
        if (inTri(poly[j]!, a, b, c)) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      out.push([ia, ib, ic]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) throw new RangeError('extrude: profile is self-intersecting or degenerate');
  }
  if (idx.length === 3) out.push([idx[0]!, idx[1]!, idx[2]!]);
  return out;
}

/** Wedge / ramp: bottom w × d, height `height` at the back (-Z) edge sloping to `front` (default 0) at +Z. */
export function wedgePolys(size: Vec3, front: number): Poly[] {
  if (!(size[0] > 0 && size[1] > 0 && size[2] > 0)) throw new RangeError('wedge: size must be positive');
  const [w, h, d] = size;
  const pts: Vec2[] = front > 0
    ? [[-d / 2, -h / 2], [d / 2, -h / 2], [d / 2, -h / 2 + front], [-d / 2, h / 2]]
    : [[-d / 2, -h / 2], [d / 2, -h / 2], [-d / 2, h / 2]];
  return extrudePolys(pts, w, 'x');
}

/** Flat one-sided quad facing +Y (decals, stripes, glow slits). */
export function quadPolys(size: Vec2): Poly[] {
  const [w, d] = size;
  return [[[w / 2, 0, d / 2], [w / 2, 0, -d / 2], [-w / 2, 0, -d / 2], [-w / 2, 0, d / 2]]];
}
