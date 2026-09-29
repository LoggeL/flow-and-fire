/**
 * Test support of the E2E hooks (not used by the game itself):
 *
 * - {@link referencePick}: high-resolution float64 reference for the heightmap picking (G15): the
 *   ray is marched in 1/64 WU steps against the continuous bilinear surface (`heightWU`) and the
 *   first bracket is bisected 40 times — the same reference as the client's Vitest
 *   (terrain-picker.test.ts), here in the browser against the live camera.
 * - {@link probePoints}: deterministic pseudo-random probe points (xorshift32) for the CPU == GPU
 *   height comparison, including a few points outside the map (both sides clamp identically).
 */

/** What the reference needs from the terrain (ClientMap fits). */
export interface ReferenceTerrain {
  readonly sizeWu: number;
  readonly minHeightWU: number;
  readonly maxHeightWU: number;
  heightWU(xWU: number, zWU: number): number;
}

/** March step of the reference in WU. */
export const REFERENCE_STEP_WU = 1 / 64;
/** Bisection steps after the first bracket. */
export const REFERENCE_BISECTIONS = 40;

/**
 * First intersection of the ray (origin o, unit direction d; WU) with the terrain surface inside the
 * map, or null if the ray leaves the map (or the height band) without touching it.
 */
export function referencePick(
  t: ReferenceTerrain,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
): { x: number; y: number; z: number } | null {
  const size = t.sizeWu;
  let t0 = 0;
  let t1 = Number.POSITIVE_INFINITY;
  // Height band [min, max] (+ tiny margin).
  const hiY = t.maxHeightWU + 1e-6;
  const loY = t.minHeightWU - 1e-6;
  if (Math.abs(dy) < 1e-12) {
    if (oy > hiY || oy < loY) return null;
  } else {
    const a = (hiY - oy) / dy;
    const b = (loY - oy) / dy;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  // Map rectangle in x and z.
  const slab = (o: number, d: number): boolean => {
    if (Math.abs(d) < 1e-12) return o >= 0 && o <= size;
    const a = (0 - o) / d;
    const b = (size - o) / d;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
    return true;
  };
  if (!slab(ox, dx) || !slab(oz, dz) || t0 > t1) return null;
  const f = (s: number): number => oy + dy * s - t.heightWU(ox + dx * s, oz + dz * s);
  let prev = t0;
  let fPrev = f(prev);
  if (fPrev <= 0) return { x: ox + dx * prev, y: oy + dy * prev, z: oz + dz * prev };
  const steps = Math.ceil((t1 - t0) / REFERENCE_STEP_WU);
  for (let i = 1; i <= steps; i++) {
    const s = Math.min(t1, t0 + i * REFERENCE_STEP_WU);
    const fs = f(s);
    if (fs <= 0) {
      let lo = prev;
      let hi = s;
      for (let k = 0; k < REFERENCE_BISECTIONS; k++) {
        const m = 0.5 * (lo + hi);
        if (f(m) > 0) lo = m;
        else hi = m;
      }
      const r = 0.5 * (lo + hi);
      return { x: ox + dx * r, y: oy + dy * r, z: oz + dz * r };
    }
    prev = s;
    fPrev = fs;
  }
  return fPrev <= 0 ? { x: ox + dx * prev, y: oy + dy * prev, z: oz + dz * prev } : null;
}

/**
 * `n` probe points `[x0, z0, x1, z1, …]` in raw units: uniformly over [0, sizeWu·4096] (every 64th
 * point up to 1 WU outside the map on one axis), xorshift32 from `seed`.
 */
export function probePoints(n: number, seed: number, sizeWu: number): Int32Array {
  const out = new Int32Array(2 * n);
  let s = seed >>> 0 || 0x9e3779b9;
  const next = (): number => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s;
  };
  const edge = sizeWu * 4096;
  for (let i = 0; i < n; i++) {
    if (i % 64 === 63) {
      // Outside the map by up to 1 WU on one axis (both sides clamp to the edge samples).
      const off = next() % 4096;
      const outer = (next() & 1) === 0 ? -1 - off : edge + 1 + off;
      const inner = next() % (edge + 1);
      const swap = (next() & 1) === 0;
      out[2 * i] = swap ? inner : outer;
      out[2 * i + 1] = swap ? outer : inner;
    } else {
      out[2 * i] = next() % (edge + 1);
      out[2 * i + 1] = next() % (edge + 1);
    }
  }
  return out;
}
