import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rng32 } from '@faf/fixed';
import { createRtsMap, readRtsMap, type MapSplatRaw, type RtsMap } from '@faf/formats';
import { sampleHeightRaw, type Heightfield } from '@faf/rules';
import { describe, expect, it } from 'vitest';
import { FALLBACK_LAYER_SRGB, rgbToLinear, srgbToLinear } from '../../src/view/colors.ts';
import { buildTerrainGeometry, terrainStep } from '../../src/view/geometry.ts';
import { buildGridPositions } from '../../src/view/grid.ts';
import { buildWaterGeometry } from '../../src/view/water.ts';

const mapsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../content/maps');
const loadMap = (name: string): RtsMap => readRtsMap(new Uint8Array(readFileSync(resolve(mapsDir, `${name}.rtsmap`))));

function hfOf(map: RtsMap): Heightfield {
  return { sizeWu: map.meta.sizeWu, dim: map.meta.sizeWu + 1, heights: map.heights, heightScaleRaw: map.meta.heightScaleRaw };
}

/** Deterministic rough terrain (integer hash, no Math.random). */
function hillyMap(sizeWu: number, extra: Partial<Parameters<typeof createRtsMap>[0]> = {}): RtsMap {
  return createRtsMap({
    sizeWu,
    heights: (x, z) => 4000 + ((((x * 73856093) ^ (z * 19349663)) >>> 0) % 900) + ((x * 7 + z * 3) % 1200),
    ...extra,
  });
}

describe('terrainStep', () => {
  it('picks the smallest power of two within the vertex budget', () => {
    expect(terrainStep(512)).toBe(1);
    expect(terrainStep(1024)).toBe(2);
    expect(terrainStep(4096)).toBe(8);
    expect(terrainStep(512, 129)).toBe(4);
    expect(terrainStep(64, 1000)).toBe(1);
    expect(() => terrainStep(512, 1)).toThrow();
  });
});

describe('buildTerrainGeometry', () => {
  it('has full resolution on 512-WU maps', () => {
    const g = buildTerrainGeometry(hillyMap(512));
    expect(g.step).toBe(1);
    expect(g.vertsPerSide).toBe(513);
    expect(g.positions.length).toBe(513 * 513 * 3);
    expect(g.normals.length).toBe(513 * 513 * 3);
    expect(g.colors.length).toBe(513 * 513 * 3);
    expect(g.indices.length).toBe(512 * 512 * 6);
  });

  it('uses every 2nd sample on 1024-WU maps (Setons)', () => {
    const setons = loadMap('setons');
    expect(setons.meta.sizeWu).toBe(1024);
    const g = buildTerrainGeometry(setons);
    expect(g.step).toBe(2);
    expect(g.vertsPerSide).toBe(513);
    expect(g.positions.length).toBe(513 * 513 * 3);
    expect(g.indices.length).toBe(512 * 512 * 6);
    let maxIndex = 0;
    for (const i of g.indices) if (i > maxIndex) maxIndex = i;
    expect(maxIndex).toBe(513 * 513 - 1);
  });

  it('matches sampleHeightRaw / 4096 at 1,000 grid points (all four maps)', () => {
    for (const name of ['hollow-ridge', 'tessera', 'braidwater', 'setons']) {
      const map = loadMap(name);
      const g = buildTerrainGeometry(map);
      const hf = hfOf(map);
      const n = g.vertsPerSide;
      for (let k = 0; k < 1000; k++) {
        // Grid points with x, z < sizeWu: at the far edge sampleHeightRaw clamps to size·4096 − 16
        // (see the next test), everywhere else it is exactly h·heightScaleRaw.
        const gx = rng32(0x5eed, k, 0, 1) % (n - 1);
        const gz = rng32(0x5eed, k, 0, 2) % (n - 1);
        const v = gz * n + gx;
        const xWu = gx * g.step;
        const zWu = gz * g.step;
        expect(g.positions[v * 3]).toBe(xWu);
        expect(g.positions[v * 3 + 2]).toBe(zWu);
        expect(g.positions[v * 3 + 1]).toBe(sampleHeightRaw(hf, xWu * 4096, zWu * 4096) / 4096);
      }
    }
  });

  it('keeps the far edge exact (sampleHeightRaw clamps to size·4096 − 16)', () => {
    const map = hillyMap(64);
    const g = buildTerrainGeometry(map);
    const hf = hfOf(map);
    const last = g.vertsPerSide * g.vertsPerSide - 1;
    // Clamping moves the probe 1/256 WU inside: compare against the heightfield sample directly.
    expect(g.positions[last * 3 + 1]).toBe((map.heights[map.heights.length - 1]! * map.meta.heightScaleRaw) / 4096);
    expect(Math.abs(g.positions[last * 3 + 1]! - sampleHeightRaw(hf, 64 * 4096, 64 * 4096) / 4096)).toBeLessThan(0.05);
  });

  it('has unit normals pointing up', () => {
    for (const map of [hillyMap(512), loadMap('tessera')]) {
      const g = buildTerrainGeometry(map);
      for (let v = 0; v < g.normals.length / 3; v++) {
        const x = g.normals[v * 3]!;
        const y = g.normals[v * 3 + 1]!;
        const z = g.normals[v * 3 + 2]!;
        expect(Math.abs(Math.hypot(x, y, z) - 1)).toBeLessThan(1e-5);
        expect(y).toBeGreaterThan(0);
      }
    }
  });

  it('tilts normals against the slope', () => {
    // Height rises along +x: the normal leans towards −x.
    const map = createRtsMap({ sizeWu: 64, heights: (x) => x * 128 });
    const g = buildTerrainGeometry(map);
    const v = 32 * g.vertsPerSide + 32;
    expect(g.normals[v * 3]!).toBeLessThan(-0.5);
    expect(Math.abs(g.normals[v * 3 + 2]!)).toBeLessThan(1e-6);
  });

  it('emits counter-clockwise triangles seen from +y', () => {
    const g = buildTerrainGeometry(createRtsMap({ sizeWu: 64 }));
    const p = g.positions;
    for (let t = 0; t < 10; t++) {
      const [a, b, c] = [g.indices[t * 3]!, g.indices[t * 3 + 1]!, g.indices[t * 3 + 2]!];
      const ux = p[b * 3]! - p[a * 3]!;
      const uz = p[b * 3 + 2]! - p[a * 3 + 2]!;
      const vx = p[c * 3]! - p[a * 3]!;
      const vz = p[c * 3 + 2]! - p[a * 3 + 2]!;
      // y component of (u × v) = uz·vx − ux·vz
      expect(uz * vx - ux * vz).toBeGreaterThan(0);
    }
  });

  it('is deterministic', () => {
    const map = loadMap('braidwater');
    const a = buildTerrainGeometry(map);
    const b = buildTerrainGeometry(map);
    expect(Buffer.from(a.colors.buffer).equals(Buffer.from(b.colors.buffer))).toBe(true);
    expect(Buffer.from(a.normals.buffer).equals(Buffer.from(b.normals.buffer))).toBe(true);
  });
});

function solidSplat(layers: 4 | 8, resolution: number, layer: number): MapSplatRaw {
  const planes: Uint8Array[] = [];
  for (let p = 0; p < layers / 4; p++) {
    const plane = new Uint8Array(resolution * resolution * 4);
    if (p === layer >> 2) for (let i = layer & 3; i < plane.length; i += 4) plane[i] = 255;
    planes.push(plane);
  }
  return { codec: 0, layers, resolution, planes };
}

describe('terrain colours', () => {
  const strata = [
    { name: 'a', color: [200, 10, 10] as const },
    { name: 'b', color: [10, 200, 10] as const },
    { name: 'c', color: [10, 10, 200] as const },
    { name: 'd', color: [120, 120, 20] as const },
    { name: 'e', color: [20, 120, 120] as const },
  ];

  function expectAllColors(map: RtsMap, rgb: readonly [number, number, number]): void {
    const g = buildTerrainGeometry(map);
    const lin = rgbToLinear(rgb);
    for (let v = 0; v < g.colors.length / 3; v += 97) {
      for (let c = 0; c < 3; c++) expect(g.colors[v * 3 + c]!).toBeCloseTo(lin[c]!, 5);
    }
  }

  it('uses the strata colour of a fully painted layer', () => {
    expectAllColors(createRtsMap({ sizeWu: 64, strata, splat: solidSplat(4, 16, 1) }), strata[1]!.color);
    expectAllColors(createRtsMap({ sizeWu: 64, strata, splat: solidSplat(8, 16, 4) }), strata[4]!.color);
  });

  it('falls back to the palette for layers without a stratum', () => {
    expectAllColors(createRtsMap({ sizeWu: 64, strata, splat: solidSplat(8, 16, 6) }), FALLBACK_LAYER_SRGB[6]!);
    expectAllColors(createRtsMap({ sizeWu: 64, splat: solidSplat(4, 8, 2) }), FALLBACK_LAYER_SRGB[2]!);
  });

  it('blends painted layers in layer order (later layers cover earlier ones)', () => {
    // Plane 0: layer 0 = 255, layer 1 = 128 → layer 1 keeps 128/255, layer 0 the rest.
    const res = 8;
    const plane = new Uint8Array(res * res * 4);
    for (let i = 0; i < res * res; i++) {
      plane[i * 4] = 255;
      plane[i * 4 + 1] = 128;
    }
    const map = createRtsMap({ sizeWu: 64, strata, splat: { codec: 0, layers: 4, resolution: res, planes: [plane] } });
    const g = buildTerrainGeometry(map);
    const w1 = 128 / 255;
    const a = rgbToLinear(strata[0]!.color);
    const b = rgbToLinear(strata[1]!.color);
    for (let c = 0; c < 3; c++) expect(g.colors[100 * 3 + c]!).toBeCloseTo(a[c]! * (1 - w1) + b[c]! * w1, 5);
  });

  it('colours unpainted maps by height and slope (auto layers from the strata)', () => {
    // Flat low ground without water: shore band → stratum 0; a high plateau → stratum 3.
    const map = createRtsMap({ sizeWu: 64, strata, heights: (x) => (x < 32 ? 0 : 60000) });
    const g = buildTerrainGeometry(map);
    const n = g.vertsPerSide;
    const low = rgbToLinear(strata[0]!.color);
    const high = rgbToLinear(strata[3]!.color);
    for (let c = 0; c < 3; c++) {
      expect(g.colors[(10 * n + 5) * 3 + c]!).toBeCloseTo(low[c]!, 5);
      expect(g.colors[(10 * n + 60) * 3 + c]!).toBeCloseTo(high[c]!, 5);
    }
    // The cliff between them is rock (stratum 2), darkened by the slope term.
    const cliff = g.colors[(10 * n + 32) * 3 + 2]!;
    expect(cliff).toBeGreaterThan(0);
  });

  it('gives the real maps plausible colours (no NaN, 0..1, not uniform)', () => {
    for (const name of ['hollow-ridge', 'tessera', 'braidwater', 'setons']) {
      const g = buildTerrainGeometry(loadMap(name));
      let min = 1;
      let max = 0;
      for (const c of g.colors) {
        expect(Number.isFinite(c)).toBe(true);
        if (c < min) min = c;
        if (c > max) max = c;
      }
      expect(min).toBeGreaterThanOrEqual(0);
      expect(max).toBeLessThanOrEqual(1);
      expect(max - min).toBeGreaterThan(0.1);
    }
  });

  it('converts sRGB to linear like three.js', () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(255)).toBeCloseTo(1, 12);
    expect(srgbToLinear(10)).toBeCloseTo(10 / 255 / 12.92, 12);
    expect(srgbToLinear(128)).toBeCloseTo(0.2158605, 6);
  });
});

describe('water and grid', () => {
  it('has no water mesh without a water level', () => {
    expect(buildWaterGeometry(createRtsMap({ sizeWu: 64 }))).toBeNull();
  });

  it('builds a water plane at the water level with depth-dependent alpha', () => {
    const map = loadMap('hollow-ridge');
    const w = buildWaterGeometry(map)!;
    expect(w.levelWu).toBe(map.meta.waterLevelRaw! / 4096);
    expect(w.vertsPerSide).toBe(257);
    let lo = 1;
    let hi = 0;
    for (let v = 0; v < w.colors.length / 4; v++) {
      expect(w.positions[v * 3 + 1]).toBe(w.levelWu);
      const a = w.colors[v * 4 + 3]!;
      lo = Math.min(lo, a);
      hi = Math.max(hi, a);
    }
    expect(lo).toBeGreaterThan(0.3);
    expect(hi).toBeLessThanOrEqual(0.9);
    expect(hi - lo).toBeGreaterThan(0.2);
  });

  it('drapes the 32-WU grid over the terrain', () => {
    const map = hillyMap(128);
    const pos = buildGridPositions(map);
    // 5 lines per axis, 64 segments of 2 WU each, 2 axes, 2 vertices of xyz.
    expect(pos.length).toBe(5 * 2 * 64 * 6);
    const hf = hfOf(map);
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i]!;
      const z = pos[i + 2]!;
      expect(x % 2 === 0 || z % 2 === 0).toBe(true);
      expect(x % 32 === 0 || z % 32 === 0).toBe(true);
      expect(pos[i + 1]!).toBeCloseTo(sampleHeightRaw(hf, Math.min(x, 127.99) * 4096, Math.min(z, 127.99) * 4096) / 4096 + 0.12, 0);
    }
  });
});
