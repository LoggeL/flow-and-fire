/**
 * Water surface of the editor view: a flat grid at the map's water level whose colour and alpha
 * follow the water depth coarsely (shallow = light and clear, deep = dark and opaque). The shore
 * line itself comes from the depth test against the terrain.
 */
import type { RtsMap } from '@faf/formats';

export interface WaterGeometryData {
  /** Water level (WU). */
  readonly levelWu: number;
  readonly positions: Float32Array;
  /** Linear RGBA per vertex. */
  readonly colors: Float32Array;
  readonly indices: Uint32Array;
  readonly vertsPerSide: number;
}

/** Linear colours of shallow and deep water. */
const SHALLOW: readonly [number, number, number] = [0.09, 0.3, 0.34];
const DEEP: readonly [number, number, number] = [0.012, 0.06, 0.12];
/** Depth (WU) at which the water counts as fully deep. */
const DEEP_WU = 7;
const ALPHA_SHALLOW = 0.5;
const ALPHA_DEEP = 0.88;

/** Water mesh or null if the map has no water. At most 257 vertices per side. */
export function buildWaterGeometry(map: RtsMap, maxVertsPerSide = 257): WaterGeometryData | null {
  const level = map.meta.waterLevelRaw;
  if (level === null) return null;
  const size = map.meta.sizeWu;
  const dim = size + 1;
  let step = 1;
  while (step < size && size / step + 1 > maxVertsPerSide) step *= 2;
  const n = size / step + 1;
  const levelWu = level / 4096;
  const s = map.meta.heightScaleRaw / 4096;
  const h = map.heights;
  const positions = new Float32Array(n * n * 3);
  const colors = new Float32Array(n * n * 4);
  for (let gz = 0; gz < n; gz++) {
    const z = gz * step;
    for (let gx = 0; gx < n; gx++) {
      const x = gx * step;
      const v = gz * n + gx;
      positions[v * 3] = x;
      positions[v * 3 + 1] = levelWu;
      positions[v * 3 + 2] = z;
      const depth = levelWu - h[z * dim + x]! * s;
      const t = Math.min(1, Math.max(0, depth / DEEP_WU));
      const k = t * (2 - t);
      colors[v * 4] = SHALLOW[0] + (DEEP[0] - SHALLOW[0]) * k;
      colors[v * 4 + 1] = SHALLOW[1] + (DEEP[1] - SHALLOW[1]) * k;
      colors[v * 4 + 2] = SHALLOW[2] + (DEEP[2] - SHALLOW[2]) * k;
      colors[v * 4 + 3] = ALPHA_SHALLOW + (ALPHA_DEEP - ALPHA_SHALLOW) * k;
    }
  }
  const cells = n - 1;
  const indices = new Uint32Array(cells * cells * 6);
  let o = 0;
  for (let gz = 0; gz < cells; gz++) {
    for (let gx = 0; gx < cells; gx++) {
      const a = gz * n + gx;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      indices[o++] = a;
      indices[o++] = c;
      indices[o++] = b;
      indices[o++] = b;
      indices[o++] = c;
      indices[o++] = d;
    }
  }
  return { levelWu, positions, colors, indices, vertsPerSide: n };
}
