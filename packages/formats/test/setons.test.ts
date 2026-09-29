import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepWaterForLand, sampleHeightRaw, waterDepthRaw, type Heightfield } from '@faf/rules';
import { describe, expect, it } from 'vitest';
import { mapSimData, mapSimHash, readRtsMap, writeRtsMap } from '../src/index.ts';
import { MAPS_DIR } from '../scripts/mapc.ts';
import { SETONS_ISLAND_MASS_NO, SETONS_ISLAND_NO, SETONS_MASS_NO, SETONS_STARTS_NO } from '../scripts/mapgen-setons.ts';

// Gameplay contract of the default map "Setons" (content/maps/src/setons.spec.md, §11 "Prüfkriterien
// für den Import"): 1,024 WU, 8 starts, 108 mass + 8 hydro, exactly point-symmetric, one land bridge
// (70–80 WU at its narrowest) as the only ground route, islands without land access, spots on flat
// dry land, steep cliffs at islands and mountains.

const ONE = 4096;
const SIZE = 1024;
/** Golden: mapSimHash of the checked-in setons.rtsmap. Changing it breaks every replay/golden on the map. */
const SETONS_MAP_SIM_HASH = 0x52eccf92;

const bytes = new Uint8Array(readFileSync(join(MAPS_DIR, 'setons.rtsmap')));
const map = readRtsMap(bytes);
const sim = mapSimData(map);
const hf: Heightfield = sim;
const water = sim.waterLevelRaw!;
const D = sim.dim;
const heightWu = (x: number, z: number): number => sampleHeightRaw(hf, x * ONE, z * ONE) / ONE;
const walkable = (x: number, z: number): boolean => !isDeepWaterForLand(hf, water, x * ONE, z * ONE);

/** 4-neighbour flood fill over the 1-WU sample grid of everything land units may enter. */
function reachable(fromX: number, fromZ: number, blocked: (x: number, z: number) => boolean = () => false): Uint8Array {
  const seen = new Uint8Array(D * D);
  const stack = new Int32Array(D * D);
  let sp = 0;
  stack[sp++] = fromZ * D + fromX;
  seen[fromZ * D + fromX] = 1;
  while (sp > 0) {
    const i = stack[--sp]!;
    const x = i % D;
    const z = (i - x) / D;
    for (let k = 0; k < 4; k++) {
      const nx = k === 0 ? x + 1 : k === 1 ? x - 1 : x;
      const nz = k === 2 ? z + 1 : k === 3 ? z - 1 : z;
      if (nx < 0 || nz < 0 || nx >= D || nz >= D) continue;
      const j = nz * D + nx;
      if (seen[j] === 1 || !walkable(nx, nz) || blocked(nx, nz)) continue;
      seen[j] = 1;
      stack[sp++] = j;
    }
  }
  return seen;
}

const at = (seen: Uint8Array, xRaw: number, zRaw: number): number => seen[Math.round(zRaw / ONE) * D + Math.round(xRaw / ONE)]!;
const fromSwMid = reachable(354, 678);

describe('setons map contract', () => {
  it('has the documented header data (1,024 WU, 8 starts, 108 mass, 8 hydro) and pinned identity', () => {
    expect(map.meta.name).toBe('Setons');
    expect(sim.sizeWu).toBe(SIZE);
    expect(D).toBe(1025);
    expect(sim.heightScaleRaw).toBe(32);
    expect(water).toBe(20 * ONE);
    expect(sim.starts.map((s) => s.army)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    // Army 0/1 = Mid vs Mid (MVP 1v1), straight across the land bridge (≈ 458 WU).
    expect(sim.starts[0]).toEqual({ army: 0, x: 354 * ONE, z: 678 * ONE });
    expect(sim.starts[1]).toEqual({ army: 1, x: 670 * ONE, z: 346 * ONE });
    expect(Math.hypot(670 - 354, 346 - 678)).toBeCloseTo(458.3, 0);
    for (const s of SETONS_STARTS_NO) expect(sim.starts[s.army]).toEqual({ army: s.army, x: s.x * ONE, z: s.z * ONE });
    expect(sim.spots.filter((s) => s.kind === 'mass')).toHaveLength(108);
    expect(sim.spots.filter((s) => s.kind === 'hydro')).toHaveLength(8);
    expect(map.splat?.layers).toBe(8);
    expect(map.preview).not.toBeNull();
    expect(mapSimHash(map)).toBe(SETONS_MAP_SIM_HASH);
    expect(Buffer.from(writeRtsMap(map)).equals(Buffer.from(bytes))).toBe(true);
    let lo = 65535;
    let hi = 0;
    for (const h of sim.heights) {
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    expect(lo / 128).toBeGreaterThanOrEqual(4);
    expect(hi / 128).toBeLessThanOrEqual(80);
  });

  it('is exactly point-symmetric (heights, starts, spots)', () => {
    let asymmetric = 0;
    for (let i = 0; i < D * D; i++) if (sim.heights[i] !== sim.heights[D * D - 1 - i]) asymmetric++;
    expect(asymmetric).toBe(0);
    for (const s of sim.spots) expect(sim.spots.some((o) => o.kind === s.kind && o.x === SIZE * ONE - s.x && o.z === SIZE * ONE - s.z)).toBe(true);
    for (const s of sim.starts) {
      const m = sim.starts[s.army ^ 1]!;
      expect([m.x, m.z]).toEqual([SIZE * ONE - s.x, SIZE * ONE - s.z]);
    }
  });

  it('is about 57 % water (two big lakes)', () => {
    let wet = 0;
    for (let i = 0; i < D * D; i++) if (sim.heights[i]! * sim.heightScaleRaw < water) wet++;
    const share = wet / (D * D);
    expect(share).toBeGreaterThan(0.52);
    expect(share).toBeLessThan(0.62);
    // Lake centres are deep (> 8 WU).
    expect(20 - heightWu(250, 250)).toBeGreaterThan(8);
    expect(20 - heightWu(774, 774)).toBeGreaterThan(8);
  });

  it('puts 4 start mex around every start, flat base areas (26–30 WU) and every spot on flat dry land', () => {
    for (const st of sim.starts) {
      const near = sim.spots.filter((s) => s.kind === 'mass' && Math.hypot(s.x - st.x, s.z - st.z) <= 16 * ONE);
      expect(near).toHaveLength(4);
      const h0 = heightWu(st.x / ONE, st.z / ONE);
      expect(h0).toBeGreaterThanOrEqual(26);
      expect(h0).toBeLessThanOrEqual(30);
      // Flat within r 30 WU.
      for (let a = 0; a < 16; a++) {
        const r = 30;
        const x = st.x / ONE + Math.round(r * Math.cos((a * Math.PI) / 8));
        const z = st.z / ONE + Math.round(r * Math.sin((a * Math.PI) / 8));
        expect(Math.abs(heightWu(x, z) - h0)).toBeLessThan(0.05);
      }
    }
    for (const p of [...sim.spots, ...sim.starts]) {
      expect(waterDepthRaw(hf, water, p.x, p.z)).toBeLessThan(-0.3 * ONE);
      const h0 = heightWu(p.x / ONE, p.z / ONE);
      for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) expect(Math.abs(heightWu(p.x / ONE + dx, p.z / ONE + dz) - h0)).toBeLessThan(0.1);
    }
  });

  it('connects all 8 starts over land, only via the land bridge', () => {
    for (const s of sim.starts) expect(at(fromSwMid, s.x, s.z), `army ${s.army}`).toBe(1);
    const cut = reachable(354, 678, (x, z) => (x - 512) * (x - 512) + (z - 512) * (z - 512) < 130 * 130);
    for (const s of sim.starts) expect(at(cut, s.x, s.z), `army ${s.army} without the bridge`).toBe(s.army % 2 === 0 ? 1 : 0);
  });

  it('has a land bridge 70–80 WU wide at its narrowest point, ≈ 125–145 WU along most of it', () => {
    const widths: number[] = [];
    for (let t = -200; t <= 200; t += 2) {
      const cx = 512 + t;
      const cz = 512 - t;
      expect(walkable(cx, cz), `bridge axis at t=${t}`).toBe(true);
      let a = 0;
      while (walkable(cx + a + 1, cz + a + 1)) a++;
      let b = 0;
      while (walkable(cx - b - 1, cz - b - 1)) b++;
      widths.push((a + b + 1) * Math.SQRT2);
    }
    const min = Math.min(...widths);
    expect(min).toBeGreaterThanOrEqual(70);
    expect(min).toBeLessThanOrEqual(80);
    const mid = widths.filter((w) => w >= 120 && w <= 150).length;
    expect(mid).toBeGreaterThan(widths.length / 3);
    // Gentle bridge (no cliffs on the ground route): slope along the axis ≤ 0.3.
    for (let t = -200; t < 200; t++) expect(Math.abs(heightWu(513 + t, 511 - t) - heightWu(512 + t, 512 - t)) / Math.SQRT2).toBeLessThanOrEqual(0.3);
  });

  it('has two elevated islands with 5 mass each, a cliff ring and no land access', () => {
    for (const isl of [SETONS_ISLAND_NO, { ...SETONS_ISLAND_NO, x: SIZE - SETONS_ISLAND_NO.x, z: SIZE - SETONS_ISLAND_NO.z }]) {
      expect(heightWu(isl.x, isl.z)).toBeGreaterThan(38);
      expect(heightWu(isl.x, isl.z)).toBeLessThan(42);
      expect(at(fromSwMid, isl.x * ONE, isl.z * ONE)).toBe(0);
      const mass = sim.spots.filter((s) => s.kind === 'mass' && Math.hypot(s.x / ONE - isl.x, s.z / ONE - isl.z) < 60);
      expect(mass).toHaveLength(SETONS_ISLAND_MASS_NO.length);
      // Cliff on every radial line towards the open water: a drop steeper than 1.5 somewhere.
      const dir = isl.x > SIZE / 2 ? -1 : 1;
      for (let a = -6; a <= 6; a++) {
        const ang = (a * Math.PI) / 14;
        let steep = 0;
        for (let r = 30; r < 90; r++) {
          const x = isl.x + dir * r * Math.cos(ang);
          const z = isl.z + r * Math.sin(ang);
          const x2 = isl.x + dir * (r + 1) * Math.cos(ang);
          const z2 = isl.z + (r + 1) * Math.sin(ang);
          steep = Math.max(steep, heightWu(x, z) - heightWu(x2, z2));
        }
        expect(steep, `island cliff at angle ${a}`).toBeGreaterThan(1.5);
      }
    }
    // Island mex are unreachable, all other mex reachable by land.
    const unreachable = sim.spots.filter((s) => at(fromSwMid, s.x, s.z) === 0);
    expect(unreachable).toHaveLength(10);
  });

  it('gives the islands an irregular outline (review R2 P2-6: bulges, no plain ellipse)', () => {
    // Plateau edge (first drop below 36 WU) along 13 rays towards the open water, measured against
    // the §6 ellipse radius in that direction: the deviation spans ≥ 12 WU.
    const isl = SETONS_ISLAND_NO;
    const dev: number[] = [];
    for (let a = -6; a <= 6; a++) {
      const ang = (a * Math.PI) / 14;
      const cx = -Math.cos(ang);
      const cz = Math.sin(ang);
      let r = 0;
      while (r < 120 && heightWu(isl.x + cx * r, isl.z + cz * r) >= 36) r++;
      const ellipse = 1 / Math.sqrt((cx / isl.rx) ** 2 + (cz / isl.rz) ** 2);
      dev.push(r - ellipse);
    }
    expect(Math.max(...dev) - Math.min(...dev)).toBeGreaterThanOrEqual(12);
  });

  it('keeps every spot ≥ 12 WU from the map edge (outside the renderer\'s edge darkening)', () => {
    for (const s of sim.spots) {
      const e = Math.min(s.x, s.z, SIZE * ONE - s.x, SIZE * ONE - s.z) / ONE;
      expect(e, `spot (${s.x / ONE}, ${s.z / ONE})`).toBeGreaterThanOrEqual(12);
    }
  });

  it('has steep corner mountains (unpassable later) behind the air starts', () => {
    // NO corner: climbing from the air base towards the east edge crosses a slope > 1.5.
    let steep = 0;
    for (let x = 930; x < 1020; x++) steep = Math.max(steep, heightWu(x + 1, 110) - heightWu(x, 110));
    expect(steep).toBeGreaterThan(1.5);
    expect(heightWu(1015, 60)).toBeGreaterThan(55);
    expect(heightWu(SIZE - 1015, SIZE - 60)).toBeGreaterThan(55);
  });

  it('keeps the lakes deep up to the map border (no shallow rim, no land in the corners)', () => {
    for (const [x, z] of [
      [2, 2],
      [2, 150],
      [150, 2],
      [1022, 1022],
      [1022, 874],
      [874, 1022],
    ] as const) {
      expect(20 - heightWu(x, z), `depth at (${x}, ${z})`).toBeGreaterThan(9);
    }
  });

  it('has a rolling hinterland (review R1 P2-5: land p25–p75 ≥ 5 WU apart, median slope ≥ 0.08)', () => {
    const land: number[] = [];
    const slopes: number[] = [];
    for (let z = 3; z < SIZE - 3; z += 4) {
      for (let x = 3; x < SIZE - 3; x += 4) {
        const h = heightWu(x, z);
        if (h < 21) continue;
        land.push(h);
        slopes.push(Math.hypot(heightWu(x + 1, z) - heightWu(x - 1, z), heightWu(x, z + 1) - heightWu(x, z - 1)) / 2);
      }
    }
    land.sort((a, b) => a - b);
    slopes.sort((a, b) => a - b);
    expect(land[Math.floor(land.length * 0.75)]! - land[Math.floor(land.length * 0.25)]!).toBeGreaterThanOrEqual(5);
    expect(slopes[Math.floor(slopes.length / 2)]!).toBeGreaterThanOrEqual(0.08);
  });

  it('has a rugged rock field with passages ≥ 12 WU to its mex and low boulders at the bay tip', () => {
    // Rock ribs: impassable faces (slope > 1) inside the field (0.85–0.97 | 0.43–0.55).
    let steep = 0;
    for (let z = 450; z < 560; z += 2) for (let x = 880; x < 1000; x++) steep = Math.max(steep, Math.abs(heightWu(x + 1, z) - heightWu(x, z)));
    expect(steep).toBeGreaterThan(1);
    // Rock-cluster and edge mex: nothing 3 WU above the pad within 12 WU.
    for (const m of SETONS_MASS_NO.filter((p) => p.x > 900 && p.z > 420 && p.z < 520)) {
      const c = heightWu(m.x, m.z);
      for (let dz = -12; dz <= 12; dz++) {
        for (let dx = -12; dx <= 12; dx++) {
          if (dx * dx + dz * dz > 144) continue;
          expect(heightWu(m.x + dx, m.z + dz) - c, `rock near mex (${m.x}, ${m.z})`).toBeLessThan(3);
        }
      }
    }
    // Boulders at (0.71–0.75 | 0.36–0.38) stand on the shore (≈ 20–22 WU): at most 8 WU above the water.
    let top = 0;
    for (let z = 350; z < 395; z++) for (let x = 725; x < 775; x++) top = Math.max(top, heightWu(x, z));
    expect(top - 20).toBeGreaterThan(3);
    expect(top - 20).toBeLessThanOrEqual(8);
  });

  it('paints a splat that covers the auto-splat: sand only as a narrow seam at the beach coasts', () => {
    const sp = map.splat!;
    expect(sp.codec).toBe(0);
    if (sp.codec !== 0) return;
    const res = sp.resolution;
    const [p0, p1] = sp.planes;
    let sandLand = 0;
    let sandOffBeach = 0;
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const o = (j * res + i) * 4;
        // Plane 0 R = 1: the painted layers replace the auto-splat (and its shore band) completely.
        expect(p0![o]).toBe(255);
        // Final sand weight after the lerp chain (G, B, A of plane 0, then all of plane 1 on top).
        let w = 1;
        for (let c = 1; c < 4; c++) w *= 1 - p0![o + c]! / 255;
        for (let c = 0; c < 4; c++) w *= 1 - p1![o + c]! / 255;
        if (w < 0.4) continue;
        const x = (i + 0.5) * (SIZE / res);
        const z = (j + 0.5) * (SIZE / res);
        if (heightWu(x, z) < 20) continue;
        sandLand++;
        // Canonical coordinates (NO half): beach coast x ≈ 0.50–0.62, z < 0.30.
        const [cx, cz] = x > z ? [x, z] : [SIZE - x, SIZE - z];
        if (cx < 490 || cx > 660 || cz > 330) sandOffBeach++;
      }
    }
    expect(sandOffBeach).toBe(0);
    // A seam of ≤ 10 WU along ≈ 2 × 330 WU of beach coast: at most 2 × 330 × 10 / 16 ≈ 412 texels of 16 WU².
    expect(sandLand).toBeGreaterThan(100);
    expect(sandLand).toBeLessThanOrEqual(412);
  });
});

