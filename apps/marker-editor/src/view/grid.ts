/**
 * 32-WU chunk grid draped over the terrain (line segments slightly above the surface).
 */
import type { RtsMap } from '@faf/formats';

/** Grid spacing in WU (the chunk size of the map). */
export const CHUNK_WU = 32;
/** Segment length along a grid line (WU). */
const SEGMENT_WU = 2;
/** Lift above the terrain (WU) against z-fighting (the terrain also uses polygon offset). */
const LIFT_WU = 0.12;

/** Line-segment positions (pairs of xyz, WU) of the chunk grid. */
export function buildGridPositions(map: RtsMap, spacingWu: number = CHUNK_WU): Float32Array {
  const size = map.meta.sizeWu;
  const dim = size + 1;
  const h = map.heights;
  const s = map.meta.heightScaleRaw / 4096;
  const lines = Math.floor(size / spacingWu) + 1;
  const segs = size / SEGMENT_WU;
  const out = new Float32Array(lines * 2 * segs * 6);
  const y = (x: number, z: number): number => h[z * dim + x]! * s + LIFT_WU;
  let o = 0;
  for (let li = 0; li < lines; li++) {
    const c = Math.min(size, li * spacingWu);
    for (let k = 0; k < segs; k++) {
      const a = k * SEGMENT_WU;
      const b = a + SEGMENT_WU;
      // along x at z = c
      out[o++] = a;
      out[o++] = y(a, c);
      out[o++] = c;
      out[o++] = b;
      out[o++] = y(b, c);
      out[o++] = c;
      // along z at x = c
      out[o++] = c;
      out[o++] = y(c, a);
      out[o++] = a;
      out[o++] = c;
      out[o++] = y(c, b);
      out[o++] = b;
    }
  }
  return out;
}
