/**
 * Terrain mesh data for the editor view (pure, no DOM/WebGL). three.js world: x = WU x, z = WU z,
 * y = height in WU. At every grid vertex the height equals `@faf/rules` sampleHeightRaw / 4096
 * exactly (h·heightScaleRaw is an integer < 2^21, the division by 4096 is exact in float32).
 */
import type { RtsMap } from '@faf/formats';
import { autoBands, layerPalette, layerWeights, MAX_LAYERS, sampleSplat } from './colors.ts';

export interface TerrainGeometryData {
  /** vertsPerSide² × xyz (WU). */
  readonly positions: Float32Array;
  /** vertsPerSide² × xyz, unit length. */
  readonly normals: Float32Array;
  /** vertsPerSide² × linear RGB 0..1. */
  readonly colors: Float32Array;
  /** 2 triangles per cell, counter-clockwise seen from +y. */
  readonly indices: Uint32Array;
  /** Height samples (WU) between two vertices: a power of two. */
  readonly step: number;
  readonly vertsPerSide: number;
}

/** Default vertex budget per side (513 = full resolution of a 512-WU map, every 2nd sample on 1024). */
export const DEFAULT_MAX_VERTS_PER_SIDE = 513;

/** Smallest power-of-two step so that sizeWu / step + 1 ≤ maxVertsPerSide. */
export function terrainStep(sizeWu: number, maxVertsPerSide: number = DEFAULT_MAX_VERTS_PER_SIDE): number {
  if (!Number.isInteger(maxVertsPerSide) || maxVertsPerSide < 2) throw new Error(`maxVertsPerSide must be an integer >= 2, got ${maxVertsPerSide}`);
  let step = 1;
  while (step < sizeWu && sizeWu / step + 1 > maxVertsPerSide) step *= 2;
  return step;
}

/** Slight darkening of steep faces on top of the lighting (reads cliffs better from above). */
const EDGE_DARKEN = 0.18;

export function buildTerrainGeometry(map: RtsMap, maxVertsPerSide: number = DEFAULT_MAX_VERTS_PER_SIDE): TerrainGeometryData {
  const size = map.meta.sizeWu;
  const dim = size + 1;
  const step = terrainStep(size, maxVertsPerSide);
  const n = size / step + 1;
  const h = map.heights;
  const s = map.meta.heightScaleRaw / 4096;
  const positions = new Float32Array(n * n * 3);
  const normals = new Float32Array(n * n * 3);
  const colors = new Float32Array(n * n * 3);

  const splat = map.splat !== null && map.splat.codec === 0 ? map.splat : null;
  const paintedLayers = splat === null ? 0 : Math.min(splat.layers, MAX_LAYERS);
  const painted = splat === null ? null : new Float64Array(MAX_LAYERS);
  const weights = new Float64Array(12);
  const bands = autoBands(map);
  const pal = layerPalette(map);

  for (let gz = 0; gz < n; gz++) {
    const z = gz * step;
    const zm = Math.max(0, z - step);
    const zp = Math.min(size, z + step);
    for (let gx = 0; gx < n; gx++) {
      const x = gx * step;
      const v = gz * n + gx;
      const y = h[z * dim + x]! * s;
      positions[v * 3] = x;
      positions[v * 3 + 1] = y;
      positions[v * 3 + 2] = z;

      // Central differences on the full-resolution heightfield (one-sided at the edges).
      const xm = Math.max(0, x - step);
      const xp = Math.min(size, x + step);
      const dhdx = ((h[z * dim + xp]! - h[z * dim + xm]!) * s) / (xp - xm);
      const dhdz = ((h[zp * dim + x]! - h[zm * dim + x]!) * s) / (zp - zm);
      const inv = 1 / Math.sqrt(dhdx * dhdx + 1 + dhdz * dhdz);
      const ny = inv;
      normals[v * 3] = -dhdx * inv;
      normals[v * 3 + 1] = ny;
      normals[v * 3 + 2] = -dhdz * inv;

      if (painted !== null && splat !== null) sampleSplat(splat, size, x, z, painted);
      const slope = 1 - ny;
      layerWeights(y, slope, bands, painted, paintedLayers, weights);
      let r = 0;
      let g = 0;
      let b = 0;
      for (let l = 0; l < 4; l++) {
        const w = weights[l]!;
        if (w === 0) continue;
        const c = pal.auto[l]!;
        r += w * c[0];
        g += w * c[1];
        b += w * c[2];
      }
      for (let l = 0; l < paintedLayers; l++) {
        const w = weights[4 + l]!;
        if (w === 0) continue;
        const c = pal.painted[l]!;
        r += w * c[0];
        g += w * c[1];
        b += w * c[2];
      }
      const k = 1 - EDGE_DARKEN * Math.min(1, slope * 2);
      colors[v * 3] = r * k;
      colors[v * 3 + 1] = g * k;
      colors[v * 3 + 2] = b * k;
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
      // (a, c, b) and (b, c, d): counter-clockwise seen from +y (x right, z towards the viewer).
      indices[o++] = a;
      indices[o++] = c;
      indices[o++] = b;
      indices[o++] = b;
      indices[o++] = c;
      indices[o++] = d;
    }
  }
  return { positions, normals, colors, indices, step, vertsPerSide: n };
}
