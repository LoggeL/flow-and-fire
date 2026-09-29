import { describe, expect, it } from 'vitest';
import { NOISE_GLSL, TERRAIN_HEIGHT_GLSL, TERRAIN_SPLAT_GLSL, generateTerrainAlbedo, TERRAIN_ALBEDO_LAYERS, TERRAIN_ALBEDO_SIZE } from '../src/terrain/glsl.ts';
import type { TerrainDesc } from '../src/terrain/heightfield.ts';
import { computeChunkBounds, sampleTerrainHeightRaw, validateTerrain, TERRAIN_PATCH_WU } from '../src/terrain/heightfield.ts';

/** Deterministic xorshift32 for test data. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function randomTerrain(sizeWu: number, scale: number, seed: number, extremes = false): TerrainDesc {
  const dim = sizeWu + 1;
  const r = rng(seed);
  const heights = new Uint16Array(dim * dim);
  for (let i = 0; i < heights.length; i++) {
    const v = r();
    heights[i] = extremes ? (v < 0.3 ? 0 : v < 0.6 ? 65535 : Math.floor(r() * 65536)) : Math.floor(v * 65536);
  }
  return { sizeWu, dim, heights, heightScaleRaw: scale, waterLevelRaw: null };
}

/** BigInt reference of the height formula (independent of the JS number mirror). */
function referenceHeight(t: TerrainDesc, xRaw: number, zRaw: number): number {
  const max = BigInt(t.sizeWu * 4096 - 16);
  const clamp = (v: bigint): bigint => (v < 0n ? 0n : v > max ? max : v);
  const xr = clamp(BigInt(xRaw));
  const zr = clamp(BigInt(zRaw));
  const cx = xr / 4096n;
  const cz = zr / 4096n;
  const fx = (xr / 16n) % 256n;
  const fz = (zr / 16n) % 256n;
  const dim = BigInt(t.dim);
  const H = (x: bigint, z: bigint): bigint => BigInt(t.heights[Number(z * dim + x)]!);
  const a = H(cx, cz) * (256n - fx) + H(cx + 1n, cz) * fx;
  const b = H(cx, cz + 1n) * (256n - fx) + H(cx + 1n, cz + 1n) * fx;
  const c = a * (256n - fz) + b * fz;
  expect(c < 2n ** 32n).toBe(true);
  return Number((c * BigInt(t.heightScaleRaw)) / 65536n);
}

describe('terrain height formula (CPU mirror of TERRAIN_HEIGHT_GLSL)', () => {
  it('matches the BigInt reference in 200,000 random points incl. clamping and extreme samples', () => {
    const r = rng(7);
    let checked = 0;
    for (const [size, scale, extremes] of [
      [64, 32, true],
      [512, 32, false],
      [128, 1, true],
      [256, 17, false],
    ] as const) {
      const t = randomTerrain(size, scale, size * 31 + scale, extremes);
      for (let i = 0; i < 50_000; i++) {
        // Mostly inside, some far outside (negative, beyond the edge).
        const span = size * 4096;
        const x = Math.floor((r() * 1.2 - 0.1) * span);
        const z = Math.floor((r() * 1.2 - 0.1) * span);
        expect(sampleTerrainHeightRaw(t, x, z)).toBe(referenceHeight(t, x, z));
        checked++;
      }
    }
    expect(checked).toBe(200_000);
  });

  it('is exact at the grid samples and stays below 2^31', () => {
    const t = randomTerrain(64, 32, 3, true);
    for (let z = 0; z < 64; z++) {
      for (let x = 0; x < 64; x++) {
        expect(sampleTerrainHeightRaw(t, x * 4096, z * 4096)).toBe(t.heights[z * t.dim + x]! * 32);
      }
    }
    const max: TerrainDesc = { ...t, heights: new Uint16Array(t.dim * t.dim).fill(65535) };
    // 65535·65536·32 / 65536 = 2,097,120 raw (≈ 512 WU)
    expect(sampleTerrainHeightRaw(max, 1000, 1000)).toBe(65535 * 32);
    expect(sampleTerrainHeightRaw(max, 1000, 1000)).toBeLessThan(2 ** 31);
  });

  it('clamps to [0, sizeWu·4096 − 16] on both axes', () => {
    const t = randomTerrain(64, 5, 11);
    const edge = 64 * 4096 - 16;
    expect(sampleTerrainHeightRaw(t, -5_000_000, 100)).toBe(sampleTerrainHeightRaw(t, 0, 100));
    expect(sampleTerrainHeightRaw(t, 9_000_000, 100)).toBe(sampleTerrainHeightRaw(t, edge, 100));
    expect(sampleTerrainHeightRaw(t, 100, 64 * 4096)).toBe(sampleTerrainHeightRaw(t, 100, edge));
  });

  it('GLSL source carries the exact integer formula', () => {
    const g = TERRAIN_HEIGHT_GLSL;
    for (const token of [
      'usampler2D u_heightmap',
      'texelFetch',
      'uint terrainHeightRawU(ivec2 xzRaw)',
      'int terrainHeightRaw(ivec2 xzRaw)',
      '* 4096 - 16',
      '>> 12',
      '(xr >> 4) & 255',
      '256u - fx',
      '256u - fz',
      '(c >> 16u) * s',
      '(c & 0xffffu) * s) >> 16u',
    ]) {
      expect(g, token).toContain(token);
    }
    // No float math in the height path (the normal helper below uses floats on purpose).
    const heightFn = g.slice(g.indexOf('uint terrainHeightRawU'), g.indexOf('int terrainHeightRaw('));
    expect(heightFn).not.toMatch(/\bfloat\b|\bvec[234]\b|texture\(/);
    expect(TERRAIN_SPLAT_GLSL).toContain('vec4 terrainAutoWeights(float heightWU, float slope, vec4 bands)');
    expect(TERRAIN_SPLAT_GLSL).toContain('sampler2DArray albedo');
    // Weights of all 8 layers, explicit-gradient sampling (safe in the per-layer branches),
    // triplanar variant and the old top-projection signature for tools/render-bench.
    expect(TERRAIN_SPLAT_GLSL).toContain('void terrainLayerWeights(');
    expect(TERRAIN_SPLAT_GLSL).toContain('textureGrad(albedo');
    expect(TERRAIN_SPLAT_GLSL).toContain('vec3 terrainAlbedoTri(');
    expect(TERRAIN_SPLAT_GLSL).toContain('vec3 terrainAlbedo(highp sampler2DArray albedo');
    expect(TERRAIN_SPLAT_GLSL).not.toMatch(/\btexture\(albedo/);
    // Detail normals need the analytic noise gradient.
    expect(NOISE_GLSL).toContain('vec3 terrainValueNoiseD(vec2 p)');
    // Noise-sharpened splat transitions (review R2 P2-3); the noise comes from the caller.
    expect(TERRAIN_SPLAT_GLSL).toContain('void terrainSharpenWeights(inout vec4 wA, inout vec4 wB, vec3 sharp)');
    expect(TERRAIN_SPLAT_GLSL).not.toContain('terrainValueNoise');
  });
});

describe('procedural albedo', () => {
  it('has close-up grain (≈ ±25 %, review R2 P2-3) but no periodic stripes (rows and columns look alike)', () => {
    const layers = generateTerrainAlbedo();
    const n = TERRAIN_ALBEDO_SIZE;
    for (let l = 0; l < layers.length; l++) {
      const g = layers[l]!;
      const lum = (x: number, y: number): number => {
        const o = (y * n + x) * 4;
        return g[o]! + g[o + 1]! + g[o + 2]!;
      };
      let sum = 0;
      let sum2 = 0;
      const rowMean = new Float64Array(n);
      const colMean = new Float64Array(n);
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const v = lum(x, y);
          sum += v;
          sum2 += v * v;
          rowMean[y]! += v / n;
          colMean[x]! += v / n;
        }
      }
      const mean = sum / (n * n);
      const sd = Math.sqrt(sum2 / (n * n) - mean * mean);
      expect(sd / mean, `layer ${l} contrast`).toBeGreaterThan(0.08);
      expect(sd / mean, `layer ${l} contrast`).toBeLessThan(0.18);
      // Stripes (the old sine strata/ripples) show as a strong variation of the row means.
      const spread = (a: Float64Array): number => Math.max(...a) - Math.min(...a);
      expect(spread(rowMean) / mean, `layer ${l} row stripes`).toBeLessThan(0.25);
      expect(spread(colMean) / mean, `layer ${l} column stripes`).toBeLessThan(0.25);
    }
  });
});

describe('chunk bounds', () => {
  it('contain every interpolated height of the chunk', () => {
    const t = randomTerrain(128, 32, 5);
    const b = computeChunkBounds(t);
    expect(b.chunks).toBe(4);
    const r = rng(99);
    for (let i = 0; i < 20_000; i++) {
      const x = Math.floor(r() * 128 * 4096);
      const z = Math.floor(r() * 128 * 4096);
      const k = Math.floor(z / 4096 / TERRAIN_PATCH_WU) * b.chunks + Math.floor(x / 4096 / TERRAIN_PATCH_WU);
      const h = sampleTerrainHeightRaw(t, x, z);
      expect(h).toBeGreaterThanOrEqual(b.minRaw[k]!);
      expect(h).toBeLessThanOrEqual(b.maxRaw[k]!);
    }
    expect(b.mapMinRaw).toBe(Math.min(...b.minRaw));
    expect(b.mapMaxRaw).toBe(Math.max(...b.maxRaw));
  });

  it('validates the description', () => {
    const t = randomTerrain(64, 32, 1);
    expect(() => validateTerrain(t)).not.toThrow();
    expect(() => validateTerrain({ ...t, sizeWu: 100 })).toThrow(/power of two/);
    expect(() => validateTerrain({ ...t, dim: 64 })).toThrow(/dim/);
    expect(() => validateTerrain({ ...t, heightScaleRaw: 33 })).toThrow(/heightScaleRaw/);
    expect(() => validateTerrain({ ...t, heights: new Uint16Array(10) })).toThrow(/samples/);
    expect(() => validateTerrain({ ...t, waterLevelRaw: 1.5 })).toThrow(/waterLevelRaw/);
    expect(() => validateTerrain({ ...t, splat: { layers: 4, resolution: 2, planes: [] } })).toThrow(/planes/);
    expect(() => validateTerrain({ ...t, splat: { layers: 4, resolution: 2, planes: [new Uint8Array(15)] } })).toThrow(/plane size/);
  });
});

describe('procedural albedo layers', () => {
  it('generates 8 deterministic RGBA8 layers', () => {
    const a = generateTerrainAlbedo(16);
    const b = generateTerrainAlbedo(16);
    expect(a.length).toBe(TERRAIN_ALBEDO_LAYERS);
    expect(a[0]!.length).toBe(16 * 16 * 4);
    expect(a).toEqual(b);
    expect(TERRAIN_ALBEDO_SIZE).toBe(128);
    // Layers differ (grass is greener than sand).
    const avg = (l: Uint8Array, c: number): number => l.reduce((s, v, i) => (i % 4 === c ? s + v : s), 0) / (l.length / 4);
    expect(avg(a[1]!, 1)).toBeGreaterThan(avg(a[1]!, 0));
    expect(avg(a[0]!, 0)).toBeGreaterThan(avg(a[1]!, 0));
  });
});
