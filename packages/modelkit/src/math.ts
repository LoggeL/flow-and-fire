/**
 * Minimal affine math for the kitbash DSL. Model space: 1 unit = 1 WU, +Y up, +Z forward (bow), right-handed
 * like glTF, so +X is the unit's left side (seen from behind).
 *
 * `Mat` is a 3×4 affine matrix in row-major order: [m00 m01 m02 tx, m10 m11 m12 ty, m20 m21 m22 tz].
 */

export type Vec3 = readonly [number, number, number];
export type Vec2 = readonly [number, number];
export type Mat = readonly [number, number, number, number, number, number, number, number, number, number, number, number];

export const IDENTITY: Mat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

const DEG = Math.PI / 180;

/** a · b (apply b first, then a). */
export function mul(a: Mat, b: Mat): Mat {
  const r = new Array<number>(12);
  for (let i = 0; i < 3; i++) {
    const a0 = a[i * 4]!;
    const a1 = a[i * 4 + 1]!;
    const a2 = a[i * 4 + 2]!;
    const a3 = a[i * 4 + 3]!;
    for (let j = 0; j < 4; j++) {
      r[i * 4 + j] = a0 * b[j]! + a1 * b[4 + j]! + a2 * b[8 + j]! + (j === 3 ? a3 : 0);
    }
  }
  return r as unknown as Mat;
}

export function translation(t: Vec3): Mat {
  return [1, 0, 0, t[0], 0, 1, 0, t[1], 0, 0, 1, t[2]];
}

export function scaling(s: Vec3): Mat {
  return [s[0], 0, 0, 0, 0, s[1], 0, 0, 0, 0, s[2], 0];
}

export function rotX(deg: number): Mat {
  const c = cosDeg(deg);
  const s = sinDeg(deg);
  return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0];
}

export function rotY(deg: number): Mat {
  const c = cosDeg(deg);
  const s = sinDeg(deg);
  return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0];
}

export function rotZ(deg: number): Mat {
  const c = cosDeg(deg);
  const s = sinDeg(deg);
  return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0];
}

/** Exact values for multiples of 90° keep axis-aligned geometry free of float noise. */
function cosDeg(deg: number): number {
  const m = ((deg % 360) + 360) % 360;
  if (m === 0) return 1;
  if (m === 90 || m === 270) return 0;
  if (m === 180) return -1;
  return Math.cos(deg * DEG);
}

function sinDeg(deg: number): number {
  const m = ((deg % 360) + 360) % 360;
  if (m === 0 || m === 180) return 0;
  if (m === 90) return 1;
  if (m === 270) return -1;
  return Math.sin(deg * DEG);
}

/** Euler rotation in degrees, applied X first, then Y, then Z (fixed world axes). */
export function rotation(r: Vec3): Mat {
  return mul(rotZ(r[2]), mul(rotY(r[1]), rotX(r[0])));
}

/** T · R · S. */
export function compose(at: Vec3 | undefined, rot: Vec3 | undefined, scale: Vec3 | undefined): Mat {
  let m: Mat = IDENTITY;
  if (scale !== undefined) m = scaling(scale);
  if (rot !== undefined && (rot[0] !== 0 || rot[1] !== 0 || rot[2] !== 0)) m = mul(rotation(rot), m);
  if (at !== undefined) m = mul(translation(at), m);
  return m;
}

export function apply(m: Mat, p: Vec3): Vec3 {
  return [
    m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
    m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
    m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
  ];
}

export function det(m: Mat): number {
  return m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8]);
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function normalize(a: Vec3): Vec3 {
  const l = length(a);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
}

/** Newell normal (unnormalized; its length is twice the polygon area). */
export function newell(pts: readonly Vec3[]): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    x += (a[1] - b[1]) * (a[2] + b[2]);
    y += (a[2] - b[2]) * (a[0] + b[0]);
    z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [x, y, z];
}

/** Rounds to a fixed grid and removes negative zero (stable, deterministic output). */
export function snap(v: number, grid = 1e-6): number {
  const r = Math.round(v / grid) * grid;
  const f = Number(r.toFixed(7));
  return f === 0 ? 0 : f;
}
