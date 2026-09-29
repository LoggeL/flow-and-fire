/**
 * Curves and swept sections for organic forms (sweeps, tubes, limbs, claws, sickles): path sampling (Bézier,
 * Catmull-Rom, arcs), rotation-minimizing frames and the sweep polygon generator.
 *
 * Frame convention (matches `loft`): a section point (u, v) of the profile sits at p + n·u·rx + b·v·ry with
 * n = t × up (horizontal side for horizontal paths) and b = n × t (≈ up). Profiles are ordered by increasing angle
 * (u = cos θ, v = sin θ), so the quads face outwards like every other primitive.
 */
import { cross, dot, length, normalize, sub, type Vec2, type Vec3 } from './math.ts';
import type { Poly } from './primitives.ts';

export function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

/** Quadratic (3 control points) or cubic (4) Bézier curve, `segments` + 1 points. */
export function bezier(ctrl: readonly Vec3[], segments: number): Vec3[] {
  if (ctrl.length !== 3 && ctrl.length !== 4) throw new RangeError('bezier: 3 or 4 control points');
  if (!Number.isInteger(segments) || segments < 1) throw new RangeError('bezier: segments must be an integer ≥ 1');
  const out: Vec3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    let pts = ctrl.slice();
    while (pts.length > 1) {
      const next: Vec3[] = [];
      for (let k = 0; k + 1 < pts.length; k++) next.push(lerp3(pts[k]!, pts[k + 1]!, t));
      pts = next;
    }
    out.push(pts[0]!);
  }
  return out;
}

/**
 * Catmull-Rom spline through `points` (≥ 2), resampled to `samples` points (≥ 2) evenly by parameter, where each
 * span gets a share proportional to its chord length. The first and last point are kept exactly.
 */
export function catmullRom(points: readonly Vec3[], samples: number): Vec3[] {
  if (points.length < 2) throw new RangeError('catmullRom: ≥ 2 points');
  if (!Number.isInteger(samples) || samples < 2) throw new RangeError('catmullRom: samples must be an integer ≥ 2');
  if (points.length === 2) return Array.from({ length: samples }, (_, i) => lerp3(points[0]!, points[1]!, i / (samples - 1)));
  const n = points.length;
  const chord = points.slice(1).map((p, i) => length(sub(p, points[i]!)));
  const total = chord.reduce((s, v) => s + v, 0);
  if (!(total > 0)) throw new RangeError('catmullRom: path has no length');
  const at = (span: number, t: number): Vec3 => {
    const p0 = points[Math.max(0, span - 1)]!;
    const p1 = points[span]!;
    const p2 = points[span + 1]!;
    const p3 = points[Math.min(n - 1, span + 2)]!;
    const t2 = t * t;
    const t3 = t2 * t;
    const f = (a: number, b: number, c: number, d: number): number =>
      0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
    return [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1]), f(p0[2], p1[2], p2[2], p3[2])];
  };
  const out: Vec3[] = [];
  for (let i = 0; i < samples; i++) {
    if (i === samples - 1) {
      out.push(points[n - 1]!);
      continue;
    }
    let s = (i / (samples - 1)) * total;
    let span = 0;
    while (span < n - 2 && s > chord[span]!) {
      s -= chord[span]!;
      span++;
    }
    out.push(at(span, chord[span]! > 0 ? Math.min(1, s / chord[span]!) : 0));
  }
  return out;
}

/** Arc of `radius` around `center` in the plane perpendicular to `axis`; angles in degrees from +X towards +Z (axis y). */
export function arcPoints(radius: number, fromDeg: number, toDeg: number, segments: number, axis: 'x' | 'y' | 'z' = 'y', center: Vec3 = [0, 0, 0]): Vec3[] {
  if (!Number.isInteger(segments) || segments < 1) throw new RangeError('arcPoints: segments must be an integer ≥ 1');
  const out: Vec3[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = ((fromDeg + ((toDeg - fromDeg) * i) / segments) * Math.PI) / 180;
    const c = radius * Math.cos(a);
    const s = radius * Math.sin(a);
    const p: Vec3 = axis === 'y' ? [c, 0, s] : axis === 'z' ? [c, s, 0] : [0, c, s];
    out.push(add(center, p));
  }
  return out;
}

export interface Frame {
  readonly p: Vec3;
  readonly t: Vec3;
  readonly n: Vec3;
  readonly b: Vec3;
}

/** Rotation-minimizing frames along a polyline (tangent = bisector at inner points). */
export function pathFrames(path: readonly Vec3[], up: Vec3 = [0, 1, 0]): Frame[] {
  if (path.length < 2) throw new RangeError('path needs ≥ 2 points');
  const seg: Vec3[] = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const d = sub(path[i + 1]!, path[i]!);
    if (length(d) < 1e-9) throw new RangeError(`path: points ${i} and ${i + 1} coincide`);
    seg.push(normalize(d));
  }
  const tangents = path.map((_, i) => {
    if (i === 0) return seg[0]!;
    if (i === path.length - 1) return seg[seg.length - 1]!;
    const t = add(seg[i - 1]!, seg[i]!);
    return length(t) < 1e-9 ? seg[i]! : normalize(t);
  });
  const sideOf = (t: Vec3): Vec3 => {
    let n = cross(t, up);
    if (length(n) < 1e-6) n = cross(t, Math.abs(t[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]);
    return normalize(n);
  };
  const frames: Frame[] = [];
  let n = sideOf(tangents[0]!);
  path.forEach((p, i) => {
    const t = tangents[i]!;
    if (i > 0) {
      const proj = sub(n, scale(t, dot(n, t)));
      n = length(proj) < 1e-6 ? sideOf(t) : normalize(proj);
    }
    frames.push({ p, t, n, b: cross(n, t) });
  });
  return frames;
}

/** Unit regular polygon (circumradius 1), points in increasing angle; a flat edge faces ±u/±v for even counts. */
export function polygonProfile(sides: number): Vec2[] {
  if (!Number.isInteger(sides) || sides < 3) throw new RangeError('profile: sides must be an integer ≥ 3');
  const pts: Vec2[] = [];
  for (let j = 0; j < sides; j++) {
    const a = ((j + 0.5) / sides) * Math.PI * 2;
    pts.push([Math.cos(a), Math.sin(a)]);
  }
  return pts;
}

/** Section half extents per frame: [rx along n, ry along b]; 0 collapses the section to a point (pointed end). */
export type Section = readonly [number, number];

/**
 * Sweeps a convex profile along frames. Caps close the first/last section (collapsed sections need none).
 * `open`: the profile is an open polyline (no closing edge, no caps) – a surface strip, e.g. a skirt panel.
 */
export function sweepPolys(
  frames: readonly Frame[],
  sections: readonly Section[],
  profile: readonly Vec2[],
  caps: { start?: boolean; end?: boolean } = {},
  open = false,
): Poly[] {
  if (sections.length !== frames.length) throw new RangeError('sweep: one section per frame');
  const m = profile.length;
  const rings = frames.map((f, i) => {
    const [rx, ry] = sections[i]!;
    if (!(rx >= 0 && ry >= 0)) throw new RangeError('sweep: section radii must be ≥ 0');
    return profile.map(([u, v]) => add(f.p, add(scale(f.n, u * rx), scale(f.b, v * ry))));
  });
  const out: Poly[] = [];
  for (let i = 0; i + 1 < rings.length; i++) {
    const r0 = rings[i]!;
    const r1 = rings[i + 1]!;
    for (let j = 0; j < (open ? m - 1 : m); j++) {
      const k = (j + 1) % m;
      out.push([r0[j]!, r1[j]!, r1[k]!, r0[k]!]);
    }
  }
  if (open) return out;
  const first = rings[0]!;
  const last = rings[rings.length - 1]!;
  if (caps.start !== false) out.push(first.slice());
  if (caps.end !== false) out.push(last.slice().reverse());
  return out;
}

/** Linear interpolation of per-point values onto `count` evenly spaced parameters. */
export function resampleValues<T extends number | Section>(values: readonly T[], count: number): T[] {
  if (values.length === count) return values.slice();
  if (values.length === 1) return Array.from({ length: count }, () => values[0]!);
  const out: T[] = [];
  for (let i = 0; i < count; i++) {
    const x = count === 1 ? 0 : (i / (count - 1)) * (values.length - 1);
    const k = Math.min(values.length - 2, Math.floor(x));
    const f = x - k;
    const a = values[k]!;
    const b = values[k + 1] ?? a;
    if (typeof a === 'number') out.push((a + ((b as number) - a) * f) as T);
    else out.push([a[0] + ((b as Section)[0] - a[0]) * f, a[1] + ((b as Section)[1] - a[1]) * f] as unknown as T);
  }
  return out;
}
