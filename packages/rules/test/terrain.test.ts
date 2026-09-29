import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  HEIGHT_FRAC_BITS,
  isDeepWaterForLand,
  LAND_MAX_WATER_DEPTH_RAW,
  sampleHeightRaw,
  waterDepthRaw,
  type Heightfield,
} from '../src/index.ts';

const ONE = 4096;

function makeField(sizeWu: number, heightScaleRaw: number, fn: (x: number, z: number) => number): Heightfield {
  const dim = sizeWu + 1;
  const heights = new Uint16Array(dim * dim);
  for (let z = 0; z < dim; z++) for (let x = 0; x < dim; x++) heights[z * dim + x] = fn(x, z);
  return { sizeWu, dim, heights, heightScaleRaw };
}

/** BigInt reference of the height formula: floor(c·s / 65536) with c from the bilinear weights. */
function referenceHeight(hf: Heightfield, xRaw: number, zRaw: number): number {
  const max = hf.sizeWu * ONE - 16;
  const xr = Math.min(Math.max(xRaw, 0), max);
  const zr = Math.min(Math.max(zRaw, 0), max);
  const cx = Math.floor(xr / ONE);
  const cz = Math.floor(zr / ONE);
  const fx = BigInt(Math.floor(xr / 16) % 256);
  const fz = BigInt(Math.floor(zr / 16) % 256);
  const H = (x: number, z: number): bigint => BigInt(hf.heights[z * hf.dim + x]!);
  const a = H(cx, cz) * (256n - fx) + H(cx + 1, cz) * fx;
  const b = H(cx, cz + 1) * (256n - fx) + H(cx + 1, cz + 1) * fx;
  const c = a * (256n - fz) + b * fz;
  return Number((c * BigInt(hf.heightScaleRaw)) / 65536n);
}

describe('rules/terrain sampleHeightRaw', () => {
  it('uses 8 fraction bits (1/256 WU)', () => {
    expect(HEIGHT_FRAC_BITS).toBe(8);
    expect(LAND_MAX_WATER_DEPTH_RAW).toBe(2048);
  });

  it('matches the BigInt reference in 10^5 random cases (all scales 1..32, extremes 0/65535)', () => {
    // One 64-WU field whose four corners of the probed cell are rewritten per case.
    const hf = makeField(64, 1, () => 0);
    const heights = hf.heights as Uint16Array;
    const sample = fc.oneof(
      { weight: 1, arbitrary: fc.constantFrom(0, 65535) },
      { weight: 1, arbitrary: fc.constantFrom(1, 65534, 32768, 32767) },
      { weight: 4, arbitrary: fc.integer({ min: 0, max: 65535 }) },
    );
    const frac = fc.oneof(fc.constantFrom(0, 1, 127, 128, 254, 255), fc.integer({ min: 0, max: 255 }));
    let checked = 0;
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 32 }),
        fc.integer({ min: 0, max: 63 }),
        fc.integer({ min: 0, max: 63 }),
        frac,
        frac,
        fc.integer({ min: 0, max: 15 }),
        fc.integer({ min: 0, max: 15 }),
        fc.tuple(sample, sample, sample, sample),
        (s, cx, cz, fx, fz, subX, subZ, [h00, h10, h01, h11]) => {
          const f = { ...hf, heightScaleRaw: s };
          const d = hf.dim;
          heights[cz * d + cx] = h00;
          heights[cz * d + cx + 1] = h10;
          heights[(cz + 1) * d + cx] = h01;
          heights[(cz + 1) * d + cx + 1] = h11;
          const x = cx * ONE + fx * 16 + subX;
          const z = cz * ONE + fz * 16 + subZ;
          const got = sampleHeightRaw(f, x, z);
          checked++;
          return got === referenceHeight(f, x, z) && Number.isInteger(got) && got >= 0 && got < 2 ** 31;
        },
      ),
      { numRuns: 100_000, seed: 0x5eed },
    );
    expect(checked).toBe(100_000);
  });

  it('is exact for every scale with all-extreme corners and edge fractions', () => {
    const fracs = [0, 1, 127, 128, 254, 255];
    const hf = makeField(64, 1, () => 0);
    const heights = hf.heights as Uint16Array;
    for (let s = 1; s <= 32; s++) {
      for (let corners = 0; corners < 16; corners++) {
        heights[0] = corners & 1 ? 65535 : 0;
        heights[1] = corners & 2 ? 65535 : 0;
        heights[hf.dim] = corners & 4 ? 65535 : 0;
        heights[hf.dim + 1] = corners & 8 ? 65535 : 0;
        const f = { ...hf, heightScaleRaw: s };
        for (const fx of fracs) {
          for (const fz of fracs) {
            expect(sampleHeightRaw(f, fx * 16, fz * 16)).toBe(referenceHeight(f, fx * 16, fz * 16));
          }
        }
      }
    }
    // Maximum: 65535 everywhere at scale 32 stays below 2^31.
    const top = makeField(64, 32, () => 65535);
    expect(sampleHeightRaw(top, 12_345, 67_890)).toBe(65535 * 32);
  });

  it('returns h·s at every sample point', () => {
    const hf = makeField(64, 32, (x, z) => (x * 977 + z * 1223 + ((x * z) % 97) * 331) & 0xffff);
    for (let z = 0; z < hf.dim - 1; z++) {
      for (let x = 0; x < hf.dim - 1; x++) {
        expect(sampleHeightRaw(hf, x * ONE, z * ONE)).toBe(hf.heights[z * hf.dim + x]! * 32);
      }
    }
  });

  it('interpolates linearly between two samples along an axis', () => {
    const hf = makeField(64, 16, (x) => (x === 1 ? 256 : 0));
    // Halfway between x = 0 (0) and x = 1 (256 steps · 16 = 4096 raw).
    expect(sampleHeightRaw(hf, ONE / 2, 0)).toBe(2048);
    expect(sampleHeightRaw(hf, ONE / 4, 0)).toBe(1024);
  });

  it('clamps positions outside the map to the edge', () => {
    const hf = makeField(64, 8, (x, z) => (x + 3 * z) * 100);
    const maxRaw = 64 * ONE - 16;
    expect(sampleHeightRaw(hf, -1, -1)).toBe(0);
    expect(sampleHeightRaw(hf, -1_000_000, 5 * ONE)).toBe(sampleHeightRaw(hf, 0, 5 * ONE));
    expect(sampleHeightRaw(hf, 64 * ONE, 3 * ONE)).toBe(sampleHeightRaw(hf, maxRaw, 3 * ONE));
    expect(sampleHeightRaw(hf, 2 ** 30, 2 ** 30)).toBe(sampleHeightRaw(hf, maxRaw, maxRaw));
    expect(sampleHeightRaw(hf, maxRaw, maxRaw)).toBe(referenceHeight(hf, maxRaw, maxRaw));
    // A constant edge row reproduces its value exactly even when clamped.
    const flatEdge = makeField(64, 32, () => 700);
    expect(sampleHeightRaw(flatEdge, 64 * ONE, 64 * ONE)).toBe(700 * 32);
  });

  it('logs its throughput (not gated)', () => {
    const hf = makeField(512, 32, (x, z) => ((x * 131) ^ (z * 71)) & 0x3fff);
    const n = 2_000_000;
    let acc = 0;
    let x = 12_345;
    let z = 54_321;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      x = (x + 40_503) & 0x1fffff;
      z = (z + 69_069) & 0x1fffff;
      acc = (acc + sampleHeightRaw(hf, x, z)) | 0;
    }
    const ms = performance.now() - t0;
    console.log(`[terrain] sampleHeightRaw: ${((n / ms) * 1000 / 1e6).toFixed(1)} M samples/s (${((ms * 1e6) / n).toFixed(1)} ns each, acc ${acc})`);
    expect(ms).toBeGreaterThan(0);
  });
});

describe('rules/terrain water', () => {
  // Terrain rises 1 WU per WU along x: height(x) = x WU.
  const hf = makeField(64, 32, (x) => x * 128);
  const water = 10 * ONE;

  it('waterDepthRaw = waterLevelRaw − terrain height', () => {
    expect(waterDepthRaw(hf, water, 4 * ONE, 0)).toBe(6 * ONE);
    expect(waterDepthRaw(hf, water, 10 * ONE, 7 * ONE)).toBe(0);
    expect(waterDepthRaw(hf, water, 12 * ONE, 0)).toBe(-2 * ONE);
    expect(waterDepthRaw(hf, null, 12 * ONE, 0)).toBe(-12 * ONE);
  });

  it('blocks land units only in water deeper than 0.5 WU', () => {
    expect(isDeepWaterForLand(hf, water, 9 * ONE, 0)).toBe(true); // 1 WU deep
    expect(isDeepWaterForLand(hf, water, 9 * ONE + ONE / 2 - 16, 0)).toBe(true); // just over 0.5 WU
    expect(isDeepWaterForLand(hf, water, 9 * ONE + ONE / 2, 0)).toBe(false); // exactly 0.5 WU
    expect(isDeepWaterForLand(hf, water, 9 * ONE + (3 * ONE) / 4, 0)).toBe(false); // shallow
    expect(isDeepWaterForLand(hf, water, 20 * ONE, 0)).toBe(false); // dry
    expect(isDeepWaterForLand(hf, null, 0, 0)).toBe(false); // no water on the map
  });
});
