// ClientMap (MS2): heights bit-identical to rules, chunk bounds, render terrain/decals, starts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_MAP_LIGHT, FormatError, createRtsMap, createTestPlaneMap, writeRtsMap } from '@faf/formats';
import { RAW_PER_WU, computeChunkBounds, sampleTerrainHeightRaw, sunDirection } from '@faf/render';
import { sampleHeightRaw } from '@faf/rules';
import { describe, expect, it } from 'vitest';
import { ClientMap, HYDRO_SPOT_DECAL, MAP_CHUNK_WU, MASS_SPOT_DECAL, MASS_SPOT_PAD_DECAL } from '../src/map.ts';
import { REPO_ROOT, hollowRidge, prng } from './support/map.ts';

describe('ClientMap', () => {
  it('reads hollow-ridge: size, water, starts, 16 mass + 2 hydro spots, bounds', () => {
    const m = hollowRidge();
    expect(m.name.length).toBeGreaterThan(0);
    expect(m.sizeWu).toBe(512);
    expect(m.dim).toBe(513);
    expect(m.heightScaleRaw).toBe(32);
    expect(m.waterLevelRaw).toBe(10 * RAW_PER_WU);
    expect(m.bounds).toEqual({ minX: 0, minZ: 0, maxX: 512 * RAW_PER_WU, maxZ: 512 * RAW_PER_WU });
    expect(m.startOf(0)).toEqual({ army: 0, x: 96 * RAW_PER_WU, z: 96 * RAW_PER_WU });
    expect(m.startOf(1)).toEqual({ army: 1, x: 416 * RAW_PER_WU, z: 416 * RAW_PER_WU });
    expect(m.startOf(7)).toBeNull();
    expect(m.spots.filter((s) => s.kind === 'mass')).toHaveLength(16);
    expect(m.spots.filter((s) => s.kind === 'hydro')).toHaveLength(2);
    expect(m.minHeightWU).toBeCloseTo(6.5, 1);
    expect(m.maxHeightWU).toBeGreaterThan(35);
    expect(m.center()).toEqual({ x: 256 * RAW_PER_WU, z: 256 * RAW_PER_WU });
  });

  it('heightAtRaw is rules.sampleHeightRaw (== render JS mirror); heightWU is its continuous form', () => {
    const m = hollowRidge();
    const rnd = prng(1);
    for (let i = 0; i < 20_000; i++) {
      const x = Math.floor(rnd() * 513 * RAW_PER_WU) - 2048;
      const z = Math.floor(rnd() * 513 * RAW_PER_WU) - 2048;
      const h = m.heightAtRaw(x, z);
      expect(h).toBe(sampleHeightRaw(m.heightfield, x, z));
      expect(h).toBe(sampleTerrainHeightRaw(m.heightfield, x, z));
      // Continuous surface vs integer formula: ≤ 1/256 WU sub-cell quantization · slope + floor.
      const d = Math.abs(m.heightWU(x / RAW_PER_WU, z / RAW_PER_WU) - h / RAW_PER_WU);
      expect(d).toBeLessThan(0.08);
    }
    // At sample points both are exact (except on the far edge, where the sim clamps to size − 1/256 WU).
    for (const [x, z] of [
      [0, 0],
      [96, 96],
      [256, 256],
      [511, 511],
      [37, 411],
    ] as const) {
      expect(m.heightWU(x, z) * RAW_PER_WU).toBe(m.heightAtRaw(x * RAW_PER_WU, z * RAW_PER_WU));
    }
  });

  it('chunk min/max bound every height inside the chunk', () => {
    const m = hollowRidge();
    expect(m.chunksPerSide).toBe(512 / MAP_CHUNK_WU);
    const rnd = prng(2);
    for (let i = 0; i < 20_000; i++) {
      const x = rnd() * 512;
      const z = rnd() * 512;
      const cx = Math.min(15, Math.floor(x / 32));
      const cz = Math.min(15, Math.floor(z / 32));
      const h = m.heightAtRaw(Math.floor(x * RAW_PER_WU), Math.floor(z * RAW_PER_WU));
      expect(h).toBeLessThanOrEqual(m.chunkMaxRaw[cz * 16 + cx]!);
      expect(h).toBeGreaterThanOrEqual(m.chunkMinRaw[cz * 16 + cx]!);
      expect(m.heightWU(x, z)).toBeLessThanOrEqual(m.chunkMaxWU(cx, cz) + 1e-9);
    }
    expect(Math.max(...m.chunkMaxRaw)).toBe(m.maxHeightRaw);
  });

  it('1,024 WU map: chunk bounds equal the renderer\'s culling bounds and hold on chunk borders and edges', () => {
    const m = new ClientMap(
      createRtsMap({ sizeWu: 1024, name: 'big', heights: (x, z) => ((x * 131 + z * 71) % 997) * 40 + ((x & 31) === 0 ? 5000 : 0) }),
    );
    expect(m.chunksPerSide).toBe(32);
    const cb = computeChunkBounds(m.heightfield);
    expect(m.chunkMaxRaw).toEqual(cb.maxRaw);
    expect(m.chunkMinRaw).toEqual(cb.minRaw);
    expect(m.maxHeightRaw).toBe(cb.mapMaxRaw);
    const rnd = prng(3);
    for (let i = 0; i < 20_000; i++) {
      // Points on/near chunk borders and on the far edge (x or z = 1,024).
      const x = i % 3 === 0 ? 1024 : Math.min(1024, Math.floor(rnd() * 33) * 32 + (rnd() - 0.5) * 0.5);
      const z = i % 5 === 0 ? 1024 : rnd() * 1024;
      const xr = Math.max(0, Math.floor(x * RAW_PER_WU));
      const zr = Math.max(0, Math.floor(z * RAW_PER_WU));
      const cx = Math.min(31, xr >> 17);
      const cz = Math.min(31, zr >> 17);
      const h = m.heightAtRaw(xr, zr);
      expect(h).toBe(sampleHeightRaw(m.heightfield, xr, zr));
      expect(h).toBeLessThanOrEqual(m.chunkMaxRaw[cz * 32 + cx]!);
      expect(h).toBeGreaterThanOrEqual(m.chunkMinRaw[cz * 32 + cx]!);
    }
  });

  it('META.light azimuth: formats convention (0° = sun from +z, 90° = from +x) is what the renderer lights with', () => {
    const lit = (azimuthDeg: number): [number, number, number] => {
      const desc = new ClientMap(createRtsMap({ sizeWu: 64, name: 'sun', light: { ...DEFAULT_MAP_LIGHT, azimuthDeg, elevationDeg: 30 } })).toTerrainDesc();
      return sunDirection(desc.light!.azimuthDeg, desc.light!.elevationDeg);
    };
    const n = lit(0);
    expect(n[2]).toBeGreaterThan(0.8);
    expect(Math.abs(n[0])).toBeLessThan(1e-9);
    const e = lit(90);
    expect(e[0]).toBeGreaterThan(0.8);
    expect(Math.abs(e[2])).toBeLessThan(1e-9);
    const s = lit(180);
    expect(s[2]).toBeLessThan(-0.8);
    // hollow-ridge (215°): the sun stands mainly towards −z, less towards −x.
    const r = hollowRidge().toTerrainDesc().light!;
    expect(r.azimuthDeg).toBe(215);
    const d = sunDirection(r.azimuthDeg, r.elevationDeg);
    expect(d[2]).toBeLessThan(d[0]);
    expect(d[0]).toBeLessThan(0);
    for (const v of [n, e, s, d]) expect(Math.hypot(v[0], v[1], v[2])).toBeCloseTo(1, 12);
  });

  it('the test plane is a generated map: flat, no water/spots, MS1 starts, 512 WU', () => {
    const m = ClientMap.testPlane();
    expect(m.map).toEqual(createTestPlaneMap());
    expect([m.name, m.sizeWu, m.waterLevelRaw, m.maxHeightRaw, m.spots.length]).toEqual(['testplane', 512, null, 0, 0]);
    expect(m.startOf(0)).toEqual({ army: 0, x: 256 * RAW_PER_WU, z: 256 * RAW_PER_WU });
    expect(m.startOf(1)).toEqual({ army: 1, x: 312 * RAW_PER_WU, z: 214 * RAW_PER_WU });
    expect(ClientMap.testPlane(1024).startOf(1)).toEqual({ army: 1, x: 624 * RAW_PER_WU, z: 428 * RAW_PER_WU });
    expect(() => ClientMap.testPlane(96)).toThrow(FormatError);
  });

  it('toTerrainDesc feeds render.setTerrain; spotDecals are green rings / cyan diamonds on the spots', () => {
    const m = hollowRidge();
    const d = m.toTerrainDesc();
    expect(d).toMatchObject({ sizeWu: 512, dim: 513, heightScaleRaw: 32, waterLevelRaw: 40960 });
    expect(d.heights).toBe(m.map.heights);
    expect(d.light).toEqual(m.map.meta.light);
    expect(d.splat).toBeUndefined();
    const decals = m.spotDecals();
    expect(decals).toHaveLength(16 * 2 + 2);
    let k = 0;
    for (const s of m.spots) {
      if (s.kind === 'mass') {
        expect(decals[k++]).toEqual({ ...MASS_SPOT_PAD_DECAL, x: s.x, z: s.z });
        expect(decals[k]).toEqual({ ...MASS_SPOT_DECAL, x: s.x, z: s.z });
      } else expect(decals[k]).toEqual({ ...HYDRO_SPOT_DECAL, x: s.x, z: s.z });
      expect(decals[k]!.kind).toBe(s.kind === 'mass' ? 'ring' : 'diamond');
      expect(decals[k++]!.minRadiusPx).toBeGreaterThanOrEqual(4);
    }
    expect(m.spotDecals().filter((x) => x.color === MASS_SPOT_DECAL.color)).toHaveLength(16);
    expect(m.spotDecals().filter((x) => x.color === 0x20e0ff)).toHaveLength(2);
  });

  it('water queries (rules) and a splat map are passed through; corrupt bytes throw FormatError', () => {
    const m = hollowRidge();
    expect(m.isDeepWaterForLand(256 * RAW_PER_WU, 256 * RAW_PER_WU)).toBe(true);
    expect(m.waterDepthRaw(256 * RAW_PER_WU, 256 * RAW_PER_WU)).toBe(Math.round(3.5 * RAW_PER_WU));
    expect(m.isDeepWaterForLand(96 * RAW_PER_WU, 96 * RAW_PER_WU)).toBe(false);
    const planes = [new Uint8Array(16 * 16 * 4).fill(7)];
    const small = createRtsMap({ sizeWu: 64, heights: (x, z) => x + z, splat: { codec: 0, layers: 4, resolution: 16, planes } });
    const cm = ClientMap.fromBytes(writeRtsMap(small));
    expect(cm.toTerrainDesc().splat).toEqual({ layers: 4, resolution: 16, planes });
    expect(cm.chunksPerSide).toBe(2);
    const bytes = new Uint8Array(readFileSync(join(REPO_ROOT, 'content/maps/hollow-ridge.rtsmap')));
    bytes[100] = bytes[100]! ^ 0xff;
    expect(() => ClientMap.fromBytes(bytes)).toThrow(FormatError);
  });
});
