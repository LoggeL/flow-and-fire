/**
 * Plane picking on the CPU (PLAN §3.7 "Picking": no GPU readback).
 *
 * MS1 has a flat test plane at y = 0: the ray through a CSS pixel (render `screenToRay`) is
 * intersected with the plane and the hit point is converted to Q20.12 raw integers, clamped to
 * the map. Camera math is float64 presentation code; only the rounded raw integers enter
 * commands, so the sim stays deterministic.
 */
import { createRay, intersectGround, RAW_PER_WU, type Ray, type RtsCamera } from '@faf/render';

/** Edge length of the MS1 test plane in WU. */
export const TEST_PLANE_SIZE_WU = 512;

/** Axis-aligned map rectangle on the ground plane in raw Q20.12 units (inclusive). */
export interface MapBounds {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
}

/** Map bounds from an origin and a size in WU (defaults: the 512 × 512 WU test plane at 0,0). */
export function mapBoundsWU(originX = 0, originZ = 0, sizeX = TEST_PLANE_SIZE_WU, sizeZ = sizeX): MapBounds {
  return {
    minX: Math.round(originX * RAW_PER_WU),
    minZ: Math.round(originZ * RAW_PER_WU),
    maxX: Math.round((originX + sizeX) * RAW_PER_WU),
    maxZ: Math.round((originZ + sizeZ) * RAW_PER_WU),
  };
}

/** WU (float) → raw int32, rounded to the nearest raw step. */
export function wuToRaw(wu: number): number {
  return Math.round(wu * RAW_PER_WU);
}

/** Clamps `v` into [lo, hi]. */
export function clampRaw(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Reusable ground picker. After a successful `pick()`, `x`/`z` hold the clamped raw hit point and
 * `wuX`/`wuZ` the unclamped float hit in WU. Allocation-free.
 */
export class GroundPicker {
  /** Clamped hit point (raw Q20.12 int32). */
  x = 0;
  z = 0;
  /** Unclamped hit point in WU (float64). */
  wuX = 0;
  wuZ = 0;
  /** True if the last hit lay outside the map and was clamped. */
  clamped = false;
  private readonly ray: Ray = createRay();
  private readonly hit = new Float64Array(2);

  constructor(
    public bounds: MapBounds,
    /** Height of the plane in WU (test plane: 0). */
    public heightWU = 0,
  ) {}

  /**
   * Picks the plane under the CSS pixel (x, y). Returns false if the ray misses the plane (points
   * at or above the horizon); x/z are unchanged then.
   */
  pick(camera: RtsCamera, cssX: number, cssY: number): boolean {
    camera.update();
    camera.screenToRay(cssX, cssY, this.ray);
    if (!intersectGround(this.ray, this.heightWU, this.hit)) return false;
    const hx = this.hit[0]!;
    const hz = this.hit[1]!;
    this.wuX = hx;
    this.wuZ = hz;
    const b = this.bounds;
    const rx = wuToRaw(hx);
    const rz = wuToRaw(hz);
    this.x = clampRaw(rx, b.minX, b.maxX);
    this.z = clampRaw(rz, b.minZ, b.maxZ);
    this.clamped = this.x !== rx || this.z !== rz;
    return true;
  }
}
