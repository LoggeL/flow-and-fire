import { describe, expect, it } from 'vitest';
import { TERRAIN_HEIGHT_GLSL, TERRAIN_SPLAT_GLSL, generateTerrainAlbedo, TERRAIN_ALBEDO_LAYERS, TERRAIN_ALBEDO_SIZE } from '../src/terrain/glsl.ts';
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
