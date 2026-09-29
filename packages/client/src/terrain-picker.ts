/**
 * Heightmap ray picking on the CPU (G15, PLAN §3.7 "Picking: Terrain per Heightmap-Raymarch, kein
 * GPU-Readback").
 *
 * The ray through a CSS pixel (render `screenToRay`, float64 WU) is intersected with the terrain
 * surface `h(x, z)` = bilinear interpolation of the map samples (ClientMap.heightWU, the continuous
 * form of `rules.sampleHeightRaw`):
 *
 * 1. Clip the ray to the map rectangle (xz) and to the height band [minHeight, maxHeight].
 * 2. Coarse skip: walk the 32 × 32 WU chunks along the ray (2D DDA); a chunk is skipped when the
 *    ray's lowest point inside it lies above the chunk's max height.
 * 3. March: inside a candidate chunk the ray is split at every 1 WU cell boundary and into steps
 *    of ≤ 0.5 WU. Within one cell `f(t) = rayY(t) − h(t)` is exactly quadratic, so each step also
 *    tests the quadratic's extremum — a grazing hit between two samples is not missed.
 * 4. Bisection on the first bracket until it is shorter than 1/256 WU, then a final linear
 *    interpolation (secant) inside it.
 *
 * Result: the hit in raw Q20.12 — `x`, `z` rounded and clamped to the map, `y` =
 * `rules.sampleHeightRaw(x, z)` (sim-exact height of the command target) — plus the float hit in WU.
 *
 * No hit (the ray leaves the map before touching the terrain, e.g. the cursor is beyond the map
 * edge): fallback to the plane at "edge height": the ray is intersected with y = mid height of the
 * map, that point is clamped to the map, and the ray is intersected again with the plane at the
 * terrain height of that clamped point; the result is clamped to the map (`hit = false`,
 * `clamped = true`). A ray at or above the horizon returns false (no pick).
 *
 * Allocation-free after construction.
 */
import { createRay, RAW_PER_WU, type Ray, type RtsCamera } from '@faf/render';
import { MAP_CHUNK_WU, type TerrainHeightSource } from './map.ts';

/** Terrain the picker can march: heights plus per-chunk max heights (ClientMap). */
export interface PickableTerrain extends TerrainHeightSource {
  readonly chunksPerSide: number;
  /** Max height (raw) per 32 × 32 WU chunk, index cz·chunksPerSide + cx. */
  readonly chunkMaxRaw: Int32Array;
}

/** Longest march step in WU (G15: ≤ 0.5 WU). */
export const PICK_MAX_STEP_WU = 0.5;
/** Bisection stops below this bracket length in WU (G15: < 1/256 WU). */
export const PICK_BISECT_WU = 1 / 256;
const MAX_RAY_WU = 1e6;
const EPS = 1e-9;

export class TerrainPicker {
  /** Hit point (raw Q20.12 int32): x/z rounded + clamped to the map, y = sim height there. */
  x = 0;
  y = 0;
  z = 0;
  /** Unclamped float hit in WU (fallback: plane intersection). */
  wuX = 0;
  wuY = 0;
  wuZ = 0;
  /** True if the ray touched the terrain; false for the edge-plane fallback. */
  hit = false;
  /** True if the result was clamped to the map rectangle. */
  clamped = false;
  /** Height evaluations of the last pick (diagnostics). */
  evaluations = 0;

  private readonly ray: Ray = createRay();
  private ox = 0;
  private oy = 0;
  private oz = 0;
  private dx = 0;
  private dy = 0;
  private dz = 0;

  constructor(public terrain: PickableTerrain) {}

  /** Picks the terrain under the CSS pixel (x, y). False if the ray points at/above the horizon. */
  pick(camera: RtsCamera, cssX: number, cssY: number): boolean {
    camera.update();
    camera.screenToRay(cssX, cssY, this.ray);
    const o = this.ray.origin;
    const d = this.ray.dir;
    return this.pickRay(o[0]!, o[1]!, o[2]!, d[0]!, d[1]!, d[2]!);
  }

  /** Picks along a ray in WU (`d` normalized). */
  pickRay(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): boolean {
    this.ox = ox;
    this.oy = oy;
    this.oz = oz;
    this.dx = dx;
    this.dy = dy;
    this.dz = dz;
    this.evaluations = 0;
    this.hit = false;
    this.clamped = false;
    const t = this.terrain;
    const size = t.sizeWu;

    // 1. Clip to the map rectangle and the height band.
    let t0 = 0;
    let t1 = MAX_RAY_WU;
    let inside = true;
    if (Math.abs(dx) < EPS) {
      if (ox < 0 || ox > size) inside = false;
    } else {
      const a = (0 - ox) / dx;
      const b = (size - ox) / dx;
      t0 = Math.max(t0, Math.min(a, b));
      t1 = Math.min(t1, Math.max(a, b));
    }
    if (Math.abs(dz) < EPS) {
      if (oz < 0 || oz > size) inside = false;
    } else {
      const a = (0 - oz) / dz;
      const b = (size - oz) / dz;
      t0 = Math.max(t0, Math.min(a, b));
      t1 = Math.min(t1, Math.max(a, b));
    }
    const hiY = t.maxHeightWU + 1e-6;
    const loY = t.minHeightWU - 1e-6;
    if (dy < -EPS) {
      t0 = Math.max(t0, (hiY - oy) / dy);
      t1 = Math.min(t1, (loY - oy) / dy);
    } else if (dy > EPS) {
      t1 = Math.min(t1, (hiY - oy) / dy);
    } else if (oy > hiY || oy < loY) {
      inside = false;
    }
    if (inside && t0 <= t1 && this.march(t0, t1)) return true;
    return this.fallback();
  }

  // ---- internals ------------------------------------------------------------------------------

  /** f(t) = ray height − terrain height (> 0: above the terrain). */
  private f(t: number): number {
    this.evaluations++;
    return this.oy + this.dy * t - this.terrain.heightWU(this.ox + this.dx * t, this.oz + this.dz * t);
  }

  /** Chunk DDA over [t0, t1]; returns true on a hit (result written). */
  private march(t0: number, t1: number): boolean {
    const ter = this.terrain;
    const n = ter.chunksPerSide;
    const C = MAP_CHUNK_WU;
    const { ox, oz, dx, dz, oy, dy } = this;
    const px = ox + dx * t0;
    const pz = oz + dz * t0;
    let cx = clampInt(Math.floor(px / C), 0, n - 1);
    let cz = clampInt(Math.floor(pz / C), 0, n - 1);
    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
    let tNextX = stepX > 0 ? ((cx + 1) * C - ox) / dx : stepX < 0 ? (cx * C - ox) / dx : Infinity;
    let tNextZ = stepZ > 0 ? ((cz + 1) * C - oz) / dz : stepZ < 0 ? (cz * C - oz) / dz : Infinity;
    const tDeltaX = stepX !== 0 ? C / Math.abs(dx) : Infinity;
    const tDeltaZ = stepZ !== 0 ? C / Math.abs(dz) : Infinity;
    let ta = t0;
    let fa = this.f(ta);
    if (fa <= 0) return this.result(ta);
    for (let guard = 0; guard < 4 * n + 8 && ta < t1; guard++) {
      const tb = Math.min(tNextX, tNextZ, t1);
      const lowest = Math.min(oy + dy * ta, oy + dy * tb);
      if (lowest <= ter.chunkMaxRaw[cz * n + cx]! / RAW_PER_WU + 1e-6) {
        const r = this.marchCells(ta, tb, fa);
        if (r >= 0) return this.result(r);
      }
      if (tb >= t1) break;
      ta = tb;
      fa = this.f(ta);
      if (fa <= 0) return this.result(ta);
      if (tNextX <= tNextZ) {
        cx += stepX;
        tNextX += tDeltaX;
      } else {
        cz += stepZ;
        tNextZ += tDeltaZ;
      }
      if (cx < 0 || cx >= n || cz < 0 || cz >= n) break;
    }
    return false;
  }

  /** Cell-aligned march over [t0, t1] with f(t0) = f0 > 0; returns the hit t or −1. */
  private marchCells(t0: number, t1: number, f0: number): number {
    const { ox, oz, dx, dz } = this;
    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
    // Cell of t0, nudged along the ray so a start exactly on a boundary picks the cell ahead.
    let cellX = Math.floor(ox + dx * t0 + (stepX > 0 ? 1e-9 : stepX < 0 ? -1e-9 : 0));
    let cellZ = Math.floor(oz + dz * t0 + (stepZ > 0 ? 1e-9 : stepZ < 0 ? -1e-9 : 0));
    let tNextX = stepX > 0 ? (cellX + 1 - ox) / dx : stepX < 0 ? (cellX - ox) / dx : Infinity;
    let tNextZ = stepZ > 0 ? (cellZ + 1 - oz) / dz : stepZ < 0 ? (cellZ - oz) / dz : Infinity;
    let a = t0;
    let fa = f0;
    while (a < t1) {
      const cellEnd = Math.min(tNextX, tNextZ, t1);
      // Steps of ≤ 0.5 WU inside the cell (f is quadratic there).
      while (a < cellEnd) {
        const b = Math.min(cellEnd, a + PICK_MAX_STEP_WU);
        const fb = this.f(b);
        const r = this.bracket(a, b, fa, fb);
        if (r >= 0) return r;
        a = b;
        fa = fb;
      }
      if (cellEnd >= t1) break;
      if (tNextX <= tNextZ) {
        cellX += stepX;
        tNextX += 1 / Math.abs(dx);
      } else {
        cellZ += stepZ;
        tNextZ += 1 / Math.abs(dz);
      }
    }
    return -1;
  }

  /**
   * First root of the quadratic f on [a, b] (f(a) = fa > 0, f(b) = fb), or −1. The quadratic is
   * fitted through a, the midpoint and b (exact inside one cell).
   */
  private bracket(a: number, b: number, fa: number, fb: number): number {
    const fm = this.f(0.5 * (a + b));
    // f(u) = fa + B·u + A·u², u ∈ [0, 1]
    const A = 2 * fa - 4 * fm + 2 * fb;
    const B = -3 * fa + 4 * fm - fb;
    const w = b - a;
    if (A > 1e-12) {
      const u = -B / (2 * A);
      if (u > 0 && u < 1) {
        const tv = a + u * w;
        const fv = this.f(tv);
        if (fv <= 0) return this.bisect(a, tv, fa, fv);
      }
      return fb <= 0 ? this.bisect(a, b, fa, fb) : -1;
    }
    if (fb > 0) return -1;
    if (A < -1e-12) {
      const u = -B / (2 * A);
      if (u > 0 && u < 1) {
        const tv = a + u * w;
        const fv = this.f(tv);
        if (fv > 0) return this.bisect(tv, b, fv, fb);
      }
    }
    return this.bisect(a, b, fa, fb);
  }

  /** Bisection on [a, b] with f(a) > 0 ≥ f(b) until b − a < 1/256 WU, then a secant step. */
  private bisect(a: number, b: number, fa: number, fb: number): number {
    while (b - a >= PICK_BISECT_WU) {
      const m = 0.5 * (a + b);
      const fm = this.f(m);
      if (fm > 0) {
        a = m;
        fa = fm;
      } else {
        b = m;
        fb = fm;
      }
    }
    const den = fa - fb;
    return den > 0 ? a + ((b - a) * fa) / den : b;
  }

  private result(t: number): boolean {
    this.hit = true;
    this.store(this.ox + this.dx * t, this.oy + this.dy * t, this.oz + this.dz * t);
    return true;
  }

  private fallback(): boolean {
    const { ox, oy, oz, dx, dy, dz } = this;
    if (dy > -EPS) return false;
    const ter = this.terrain;
    const size = ter.sizeWu;
    const midH = 0.5 * (ter.minHeightWU + ter.maxHeightWU);
    let t = (midH - oy) / dy;
    if (t < 0) t = 0;
    const hR = ter.heightWU(clampF(ox + dx * t, 0, size), clampF(oz + dz * t, 0, size));
    let t2 = (hR - oy) / dy;
    if (t2 < 0) t2 = 0;
    this.hit = false;
    this.store(ox + dx * t2, oy + dy * t2, oz + dz * t2);
    this.clamped = true;
    return true;
  }

  private store(hx: number, hy: number, hz: number): void {
    this.wuX = hx;
    this.wuY = hy;
    this.wuZ = hz;
    const edge = this.terrain.sizeWu * RAW_PER_WU;
    const rx = Math.round(hx * RAW_PER_WU);
    const rz = Math.round(hz * RAW_PER_WU);
    this.x = rx < 0 ? 0 : rx > edge ? edge : rx;
    this.z = rz < 0 ? 0 : rz > edge ? edge : rz;
    this.clamped = this.x !== rx || this.z !== rz;
    this.y = this.terrain.heightAtRaw(this.x, this.z);
  }
}

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function clampF(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
