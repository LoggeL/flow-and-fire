/**
 * Curves over the normalized particle age a ∈ [0, 1] (PLAN §3.7 "Kurven-LUT").
 *
 * - {@link Curve}: a constant or piecewise-linear keys `[t, v]` with t strictly ascending in [0, 1].
 *   Before the first key the first value holds, after the last key the last value.
 * - {@link ColorCurve}: piecewise-linear keys `[t, r, g, b, a]`; rgb are linear HDR intensities
 *   (≤ {@link MAX_HDR_INTENSITY}), a is opacity 0..1.
 *
 * Curves are baked into a LUT with {@link LUT_WIDTH} samples at t_i = i / (LUT_WIDTH − 1); the GPU
 * samples it linearly at u = (a·(LUT_WIDTH − 1) + 0.5) / LUT_WIDTH, which reproduces the baked
 * piecewise-linear interpolation exactly (see {@link sampleBaked}).
 */

export type CurveKey = readonly [t: number, v: number];
export type Curve = number | readonly CurveKey[];
export type ColorKey = readonly [t: number, r: number, g: number, b: number, a: number];
export type ColorCurve = readonly ColorKey[];

/** Samples per curve in the LUT texture. */
export const LUT_WIDTH = 64;
/** Largest allowed linear HDR color intensity (fits RGBA16F comfortably). */
export const MAX_HDR_INTENSITY = 16;

/**
 * Linear color from a hex string (`#RRGGBB` or `RRGGBB`, components / 255 taken as linear values
 * like the faction color tables) scaled by `intensity`, as `[r, g, b]`.
 */
export function hexColor(hex: string, intensity = 1): [number, number, number] {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (m === null) throw new Error(`hexColor: invalid color '${hex}' (expected #RRGGBB)`);
  const v = parseInt(m[1]!, 16);
  return [(((v >> 16) & 255) / 255) * intensity, (((v >> 8) & 255) / 255) * intensity, ((v & 255) / 255) * intensity];
}

/** Builds a color key from a hex color, an HDR intensity and an alpha. */
export function colorKey(t: number, hex: string, intensity: number, alpha: number): ColorKey {
  const c = hexColor(hex, intensity);
  return [t, c[0], c[1], c[2], alpha];
}

/** Validates a scalar curve; returns an error text or null. */
export function curveError(curve: Curve, min: number, max: number): string | null {
  if (typeof curve === 'number') {
    if (!Number.isFinite(curve)) return 'value is not finite';
    if (curve < min || curve > max) return `value ${curve} outside [${min}, ${max}]`;
    return null;
  }
  if (!Array.isArray(curve) || curve.length === 0) return 'curve needs at least one key';
  let prev = -1;
  for (let i = 0; i < curve.length; i++) {
    const k = curve[i]!;
    if (!Array.isArray(k) || k.length !== 2) return `key ${i} must be [t, v]`;
    const [t, v] = k;
    if (!Number.isFinite(t) || t < 0 || t > 1) return `key ${i}: t=${t} outside [0, 1]`;
    if (i > 0 && !(t > prev)) return `key ${i}: t=${t} not strictly ascending`;
    if (!Number.isFinite(v)) return `key ${i}: value is not finite`;
    if (v < min || v > max) return `key ${i}: value ${v} outside [${min}, ${max}]`;
    prev = t;
  }
  return null;
}

/** Validates a color curve; returns an error text or null. */
export function colorCurveError(curve: ColorCurve): string | null {
  if (!Array.isArray(curve) || curve.length === 0) return 'color curve needs at least one key';
  let prev = -1;
  for (let i = 0; i < curve.length; i++) {
    const k = curve[i]!;
    if (!Array.isArray(k) || k.length !== 5) return `key ${i} must be [t, r, g, b, a]`;
    const t = k[0];
    if (!Number.isFinite(t) || t < 0 || t > 1) return `key ${i}: t=${t} outside [0, 1]`;
    if (i > 0 && !(t > prev)) return `key ${i}: t=${t} not strictly ascending`;
    for (let c = 1; c <= 3; c++) {
      const v = k[c]!;
      if (!Number.isFinite(v) || v < 0 || v > MAX_HDR_INTENSITY) {
        return `key ${i}: color component ${v} outside [0, ${MAX_HDR_INTENSITY}]`;
      }
    }
    const a = k[4];
    if (!Number.isFinite(a) || a < 0 || a > 1) return `key ${i}: alpha ${a} outside [0, 1]`;
    prev = t;
  }
  return null;
}

/** Evaluates a scalar curve at t (clamped to the first/last key outside the key range). */
export function sampleCurve(curve: Curve, t: number): number {
  if (typeof curve === 'number') return curve;
  const n = curve.length;
  const first = curve[0]!;
  if (t <= first[0]) return first[1];
  const last = curve[n - 1]!;
  if (t >= last[0]) return last[1];
  for (let i = 1; i < n; i++) {
    const k1 = curve[i]!;
    if (t <= k1[0]) {
      const k0 = curve[i - 1]!;
      const f = (t - k0[0]) / (k1[0] - k0[0]);
      return k0[1] + (k1[1] - k0[1]) * f;
    }
  }
  return last[1];
}

/** Evaluates a color curve at t into out (rgba). */
export function sampleColorCurve(curve: ColorCurve, t: number, out: Float64Array | number[] = [0, 0, 0, 0]): Float64Array | number[] {
  const n = curve.length;
  const first = curve[0]!;
  const last = curve[n - 1]!;
  let k0: ColorKey = first;
  let k1: ColorKey = first;
  let f = 0;
  if (t <= first[0]) {
    k0 = k1 = first;
  } else if (t >= last[0]) {
    k0 = k1 = last;
  } else {
    for (let i = 1; i < n; i++) {
      const k = curve[i]!;
      if (t <= k[0]) {
        k0 = curve[i - 1]!;
        k1 = k;
        f = (t - k0[0]) / (k1[0] - k0[0]);
        break;
      }
    }
  }
  for (let c = 0; c < 4; c++) out[c] = k0[c + 1]! + (k1[c + 1]! - k0[c + 1]!) * f;
  return out;
}

/** Bakes a scalar curve into n samples at t_i = i / (n − 1). */
export function bakeCurve(curve: Curve, n: number = LUT_WIDTH): Float32Array {
  if (!Number.isInteger(n) || n < 2) throw new Error(`bakeCurve: n=${n} must be an integer ≥ 2`);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = sampleCurve(curve, i / (n - 1));
  return out;
}

/** Bakes a color curve into n rgba samples at t_i = i / (n − 1). */
export function bakeColorCurve(curve: ColorCurve, n: number = LUT_WIDTH): Float32Array {
  if (!Number.isInteger(n) || n < 2) throw new Error(`bakeColorCurve: n=${n} must be an integer ≥ 2`);
  const out = new Float32Array(n * 4);
  const tmp = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    sampleColorCurve(curve, i / (n - 1), tmp);
    out.set(tmp, i * 4);
  }
  return out;
}

/**
 * Linear sampling of a baked LUT row (`width` texels of `channels` floats starting at `offset`) at
 * normalized age a — the exact CPU equivalent of a GPU `texture()` fetch at
 * u = (a·(width − 1) + 0.5) / width with linear filtering (ignoring filter precision).
 */
export function sampleBaked(
  data: Float32Array,
  offset: number,
  width: number,
  channels: number,
  a: number,
  channel: number,
): number {
  const x = Math.min(width - 1, Math.max(0, a * (width - 1)));
  const i0 = Math.floor(x);
  const i1 = Math.min(width - 1, i0 + 1);
  const f = x - i0;
  const v0 = data[offset + i0 * channels + channel]!;
  const v1 = data[offset + i1 * channels + channel]!;
  return v0 + (v1 - v0) * f;
}
