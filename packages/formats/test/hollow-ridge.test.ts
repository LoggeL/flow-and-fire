import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepWaterForLand, LAND_MAX_WATER_DEPTH_RAW, sampleHeightRaw, waterDepthRaw, type Heightfield } from '@faf/rules';
import { describe, expect, it } from 'vitest';
import { mapSimData, readRtsMap } from '../src/index.ts';
import { MAPS_DIR } from '../scripts/mapc.ts';

// Gameplay contract of the MS2 map (docs/status/ms2-p0-formats.md): the sim goldens (ms2-p2) and
// the E2E tests (ms2-p4) rely on these properties.

const ONE = 4096;
const map = readRtsMap(new Uint8Array(readFileSync(join(MAPS_DIR, 'hollow-ridge.rtsmap'))));
const sim = mapSimData(map);
const hf: Heightfield = sim;
const water = sim.waterLevelRaw!;
const depthWu = (x: number, z: number): number => waterDepthRaw(hf, water, x * ONE, z * ONE) / ONE;
const heightWu = (x: number, z: number): number => sampleHeightRaw(hf, x * ONE, z * ONE) / ONE;

/** 4-neighbour flood fill over 1-WU sample points that land units may enter. */
function reachable(fromX: number, fromZ: number, blocked: (x: number, z: number) => boolean = () => false): Uint8Array {
  const dim = sim.dim;
  const seen = new Uint8Array(dim * dim);
  const stack = [fromZ * dim + fromX];
  seen[stack[0]!] = 1;
  while (stack.length > 0) {
    const i = stack.pop()!;
    const x = i % dim;
    const z = (i - x) / dim;
    for (const [nx, nz] of [
      [x + 1, z],
      [x - 1, z],
      [x, z + 1],
      [x, z - 1],
    ] as const) {
      if (nx < 0 || nz < 0 || nx >= dim || nz >= dim) continue;
      const j = nz * dim + nx;
      if (seen[j] === 1 || isDeepWaterForLand(hf, water, nx * ONE, nz * ONE) || blocked(nx, nz)) continue;
      seen[j] = 1;
      stack.push(j);
    }
  }
  return seen;
}

const nearFord = (x: number, z: number): boolean => (Math.abs(x - 356) <= 30 && Math.abs(z - 156) <= 30) || (Math.abs(x - 156) <= 30 && Math.abs(z - 356) <= 30);

describe('hollow-ridge map contract', () => {
  it('has the documented header data', () => {
    expect(map.meta.name).toBe('Hollow Ridge');
    expect(sim.sizeWu).toBe(512);
    expect(sim.heightScaleRaw).toBe(32);
    expect(water).toBe(10 * ONE);
    expect(sim.starts).toEqual([
      { army: 0, x: 96 * ONE, z: 96 * ONE },
      { army: 1, x: 416 * ONE, z: 416 * ONE },
    ]);
    expect(sim.spots.filter((s) => s.kind === 'mass')).toHaveLength(16);
    expect(sim.spots.filter((s) => s.kind === 'hydro')).toHaveLength(2);
    expect(map.props).toHaveLength(12);
    expect(map.preview).not.toBeNull();
    let lo = 65535;
    let hi = 0;
    for (const h of sim.heights) {
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    expect(lo / 128).toBeGreaterThanOrEqual(6);
    expect(hi / 128).toBeLessThanOrEqual(40);
  });

  it('is point-symmetric around the map centre (fair for both starts)', () => {
    const d = sim.dim;
    let asymmetric = 0;
    for (let i = 0; i < d * d; i++) if (sim.heights[i] !== sim.heights[d * d - 1 - i]) asymmetric++;
    expect(asymmetric).toBe(0);
    for (const s of sim.spots) expect(sim.spots.some((o) => o.kind === s.kind && o.x === 512 * ONE - s.x && o.z === 512 * ONE - s.z)).toBe(true);
  });

  it('puts 4 mass spots on each start plateau and every spot/start on dry land', () => {
    for (const st of sim.starts) {
      const near = sim.spots.filter((s) => s.kind === 'mass' && Math.hypot(s.x - st.x, s.z - st.z) <= 30 * ONE);
      expect(near).toHaveLength(4);
    }
    for (const p of [...sim.spots, ...sim.starts]) expect(waterDepthRaw(hf, water, p.x, p.z)).toBeLessThanOrEqual(0);
  });

  it('separates the two starts by a deep channel (> 0.5 WU) crossable only at the fords', () => {
    const all = reachable(96, 96);
    expect(all[416 * sim.dim + 416]).toBe(1);
    const noFords = reachable(96, 96, nearFord);
    expect(noFords[416 * sim.dim + 416]).toBe(0);
    // Each ford alone connects the sides.
    const onlyA = reachable(96, 96, (x, z) => Math.abs(x - 156) <= 30 && Math.abs(z - 356) <= 30);
    const onlyB = reachable(96, 96, (x, z) => Math.abs(x - 356) <= 30 && Math.abs(z - 156) <= 30);
    expect(onlyA[416 * sim.dim + 416]).toBe(1);
    expect(onlyB[416 * sim.dim + 416]).toBe(1);
  });

  it('has fords no deeper than 0.3 WU along their crossing line', () => {
    for (const [fx, fz] of [
      [356, 156],
      [156, 356],
    ] as const) {
      let max = -Infinity;
      for (let t = -40; t <= 40; t += 0.25) max = Math.max(max, depthWu(fx + t, fz + t));
      expect(max).toBeLessThanOrEqual(0.3);
      expect(depthWu(fx, fz)).toBeCloseTo(0.25, 5);
    }
  });

  it('has a deep channel (bed 6.5 WU) along the river and in the lake', () => {
    for (const [x, z] of [
      [256, 256], // lake centre
      [300, 212],
      [212, 300],
      [420, 92],
      [92, 420],
      [506, 6], // NE corner
      [6, 506], // SW corner
    ] as const) {
      expect(depthWu(x, z), `${x},${z}`).toBeGreaterThan(LAND_MAX_WATER_DEPTH_RAW / ONE);
    }
    expect(depthWu(256, 256)).toBe(3.5);
  });

  it('has steep plateau cliffs and gentle ramps', () => {
    // NW plateau: top 24 WU, cliff between r = 52 and 58 (north side, no ramp).
    expect(heightWu(96, 96 - 50)).toBeGreaterThan(23);
    expect(heightWu(96, 96 - 60)).toBeLessThan(18.5);
    const cliffSlope = (heightWu(96, 96 - 53) - heightWu(96, 96 - 57)) / 4;
    expect(cliffSlope).toBeGreaterThan(1.5);
    // East ramp: from the plateau edge (x = 148) down to the lowland (x = 182) with slope ≤ 0.4 (nominal 0.28, lowland noise adds a little).
    for (let x = 140; x < 190; x++) expect(Math.abs(heightWu(x + 1, 96) - heightWu(x, 96))).toBeLessThanOrEqual(0.4);
    expect(heightWu(148, 96) - heightWu(182, 96)).toBeGreaterThan(7);
    // Mesa NW: 36 WU top with a north ramp.
    expect(heightWu(120, 250)).toBeGreaterThan(35);
    expect(heightWu(120 + 30, 250)).toBeLessThan(20);
  });
});
