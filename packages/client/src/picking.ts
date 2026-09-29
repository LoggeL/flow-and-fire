/**
 * Map rectangle and raw-unit helpers of the picking code (PLAN §3.7 "Picking": no GPU readback).
 *
 * Every map — the flat test plane included (formats `createTestPlaneMap`) — is picked by the
 * heightmap raymarch in terrain-picker.ts. Camera math is float64 presentation code; only the
 * rounded raw integers enter commands, so the sim stays deterministic.
 */
import { TEST_PLANE_SIZE_WU } from '@faf/formats';
import { RAW_PER_WU } from '@faf/render';

/** Edge length of the default (test plane) map in WU. */
export { TEST_PLANE_SIZE_WU };

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
