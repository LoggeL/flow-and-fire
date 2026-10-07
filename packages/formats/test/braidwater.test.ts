import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepWaterForLand, sampleHeightRaw, waterDepthRaw, type Heightfield } from '@faf/rules';
import { describe, expect, it } from 'vitest';
import { mapSimData, mapSimHash, readRtsMap, writeRtsMap } from '../src/index.ts';
import { compileMapSource, MAPS_DIR, MAPS_SRC_DIR } from '../scripts/mapc.ts';
import {
  BRAIDWATER_FORDS,
  BRAIDWATER_ISLAND,
  BRAIDWATER_PLATEAUS,
  BRAIDWATER_RAMPS,
  BRAIDWATER_SPLAT_RES,
  BRAIDWATER_START_S,
  generateBraidwaterSources,
  type Ramp,
} from '../scripts/mapgen-braidwater.ts';
import { decodePng } from '../scripts/png.ts';

// Gameplay contract of the 1v1 skirmish map "Braidwater" (content/maps/src/braidwater.spec.md §11):
// 512 WU, 2 starts, 36 mass + 5 hydro, exactly mirror-symmetric at the river axis z = 256; the river
// separates the sides and is crossed only at three fords – the west ford (short route ≈ 428 WU) and
// the two island fords (long route ≈ 676 WU); plateaus with steep cliffs, reachable only over their
// ramps (bluff and knoll only over their single back ramp).

const ONE = 4096;
const SIZE = 512;
const AXIS = 256;
/** Golden: mapSimHash of the checked-in braidwater.rtsmap. Changing it breaks every replay/golden on the map. */
const BRAIDWATER_MAP_SIM_HASH = 0xeeaec694;
/** Land units' slope limit of the later nav (MS3, `maxSlope` 0.6): rise per WU between neighbours. */
const MAX_SLOPE = 0.6;
/** Slope limit for the "only over the ramps" checks: the cliffs seal with a margin above {@link MAX_SLOPE}. */
const SEAL_SLOPE = 0.75;

const bytes = new Uint8Array(readFileSync(join(MAPS_DIR, 'braidwater.rtsmap')));
const map = readRtsMap(bytes);
const sim = mapSimData(map);
const hf: Heightfield = sim;
const water = sim.waterLevelRaw!;
const D = sim.dim;
const heightWu = (x: number, z: number): number => sampleHeightRaw(hf, x * ONE, z * ONE) / ONE;
/** Heights (WU) and land-unit walkability (not deeper than 0.5 WU) per sample. */
const H = new Float64Array(D * D);
const WALK = new Uint8Array(D * D);
for (let z = 0; z < D; z++) {
  for (let x = 0; x < D; x++) {
    H[z * D + x] = heightWu(x, z);
    WALK[z * D + x] = isDeepWaterForLand(hf, water, x * ONE, z * ONE) ? 0 : 1;
  }
}
const h = (x: number, z: number): number => H[z * D + x]!;
const S = BRAIDWATER_START_S;
const N = { x: S.x, z: SIZE - S.z };
const mirrorZ = (z: number): number => SIZE - z;

type Blocked = (x: number, z: number) => boolean;
const open: Blocked = () => false;

/**
 * Shortest land path lengths (WU) from (sx, sz) over the 1-WU sample grid, 8 neighbours. `slope`:
 * a step is allowed only if it rises/falls ≤ that limit per WU (true = {@link MAX_SLOPE}, the later
 * nav); false: only deep water blocks (the MS2 rule).
 */
function paths(sx: number, sz: number, slope: boolean | number, blocked: Blocked = open): Float64Array {
  const limit = slope === true ? MAX_SLOPE : slope === false ? Infinity : slope;
  const dist = new Float64Array(D * D).fill(Infinity);
  const heap: number[] = [];
  const keys: number[] = [];
  const push = (i: number, k: number): void => {
    heap.push(i);
    keys.push(k);
    let c = heap.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (keys[p]! <= keys[c]!) break;
      [heap[p], heap[c]] = [heap[c]!, heap[p]!];
      [keys[p], keys[c]] = [keys[c]!, keys[p]!];
      c = p;
    }
  };
  const pop = (): [number, number] => {
    const top: [number, number] = [heap[0]!, keys[0]!];
    const li = heap.pop()!;
    const lk = keys.pop()!;
    if (heap.length > 0) {
      heap[0] = li;
      keys[0] = lk;
      let c = 0;
      for (;;) {
        const l = 2 * c + 1;
        const r = l + 1;
        let m = c;
        if (l < heap.length && keys[l]! < keys[m]!) m = l;
        if (r < heap.length && keys[r]! < keys[m]!) m = r;
        if (m === c) break;
        [heap[m], heap[c]] = [heap[c]!, heap[m]!];
        [keys[m], keys[c]] = [keys[c]!, keys[m]!];
        c = m;
      }
    }
    return top;
  };
  dist[sz * D + sx] = 0;
  push(sz * D + sx, 0);
  while (heap.length > 0) {
    const [i, k] = pop();
    if (k > dist[i]!) continue;
    const x = i % D;
    const z = (i - x) / D;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const nx = x + dx;
        const nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= D || nz >= D) continue;
        const j = nz * D + nx;
        if (WALK[j] === 0 || blocked(nx, nz)) continue;
        const len = dx !== 0 && dz !== 0 ? Math.SQRT2 : 1;
        if (Math.abs(H[j]! - H[i]!) > limit * len) continue;
        const nk = k + len;
        if (nk < dist[j]!) {
          dist[j] = nk;
          push(j, nk);
        }
      }
    }
  }
  return dist;
}

// Only unblocked paths are shared: blocked ramp/ford experiments keep independent searches.
const unblocked = new Map<string, Readonly<Float64Array>>();
function unblockedPaths(sx: number, sz: number, slope: boolean): Readonly<Float64Array> {
  const key = `${sx},${sz},${slope}`;
  let dist = unblocked.get(key);
  if (dist === undefined) {
    dist = paths(sx, sz, slope);
    unblocked.set(key, dist);
  }
  return dist;
}

const at = (d: Readonly<Float64Array>, x: number, z: number): number => d[Math.round(z) * D + Math.round(x)]!;
const F = BRAIDWATER_FORDS;
const axisDist = (z: number): number => Math.abs(z - AXIS);
const westFord: Blocked = (x, z) => x >= F.west.x0 - 10 && x <= F.west.x1 + 10 && axisDist(z) < 45;
const islandFords: Blocked = (x, z) => x >= F.island.x0 - 10 && x <= F.island.x1 + 10 && axisDist(z) > 6 && axisDist(z) < 80;
const allFords: Blocked = (x, z) => westFord(x, z) || islandFords(x, z);

/** True inside a ramp's band (both sides, `extra` WU beyond its width), mirrored for the north side. */
function inRamp(r: Ramp, x: number, z: number, extra: number): boolean {
  for (const zz of [z, mirrorZ(z)]) {
    const dx = r.b.x - r.a.x;
    const dz = r.b.z - r.a.z;
    const len = Math.hypot(dx, dz);
    const along = ((x - r.a.x) * dx + (zz - r.a.z) * dz) / len;
    const across = Math.abs(((x - r.a.x) * dz - (zz - r.a.z) * dx) / len);
    if (along > -2 && along < len + 2 && across < r.width / 2 + extra) return true;
  }
  return false;
}
const ramp = (id: string): Ramp => BRAIDWATER_RAMPS.find((r) => r.id === id)!;

describe('braidwater map contract', () => {
  it('has the documented header data (512 WU, 2 starts, 36 mass, 5 hydro) and pinned identity', () => {
    expect(map.meta.name).toBe('Braidwater');
    expect(sim.sizeWu).toBe(SIZE);
    expect(D).toBe(513);
    expect(sim.heightScaleRaw).toBe(32);
    expect(water).toBe(12 * ONE);
    expect(sim.starts).toEqual([
      { army: 0, x: 154 * ONE, z: 446 * ONE },
      { army: 1, x: 154 * ONE, z: 66 * ONE },
    ]);
    expect(Math.hypot(0, 446 - 66)).toBe(380);
    expect(sim.spots.filter((s) => s.kind === 'mass')).toHaveLength(36);
    expect(sim.spots.filter((s) => s.kind === 'hydro')).toHaveLength(5);
    expect(map.splat?.layers).toBe(8);
    expect(map.preview).not.toBeNull();
    expect(map.meta.light.azimuthDeg).toBe(270);
    expect(mapSimHash(map)).toBe(BRAIDWATER_MAP_SIM_HASH);
    expect(Buffer.from(writeRtsMap(map)).equals(Buffer.from(bytes))).toBe(true);
    // T3 static artillery (200 WU) ≤ 40 % of the diagonal (DECISIONS: map size gate).
    expect(200).toBeLessThanOrEqual(0.4 * SIZE * Math.SQRT2);
  });

  it('is fresh: mapgen reproduces the sources, mapc reproduces braidwater.rtsmap byte-exactly', () => {
    const dir = join(MAPS_SRC_DIR, 'braidwater');
    const gen = generateBraidwaterSources();
    const png = decodePng(new Uint8Array(readFileSync(join(dir, 'heightmap.png'))));
    expect([png.bitDepth, png.channels, png.width]).toEqual([16, 1, gen.heightmap.dim]);
    expect(Buffer.from(png.samples.buffer).equals(Buffer.from(gen.heightmap.samples.buffer))).toBe(true);
    gen.splat.forEach((plane, k) => {
      const img = decodePng(new Uint8Array(readFileSync(join(dir, `splat-${k}.png`))));
      expect([img.bitDepth, img.channels, img.width, img.height]).toEqual([8, 4, BRAIDWATER_SPLAT_RES, BRAIDWATER_SPLAT_RES]);
      expect(Buffer.from(img.samples.buffer).equals(Buffer.from(plane.buffer))).toBe(true);
    });
    expect(readFileSync(join(dir, 'markers.json'), 'utf8')).toBe(`${JSON.stringify(gen.markers, null, 2)}\n`);
    const { bytes: compiled } = compileMapSource(dir);
    expect(compiled.length).toBe(bytes.length);
    expect(Buffer.from(compiled).equals(Buffer.from(bytes))).toBe(true);
  });

  it('is exactly mirror-symmetric at z = 256 (heights, splat, starts, spots, props)', () => {
    let asymmetric = 0;
    for (let z = 0; z < D; z++) for (let x = 0; x < D; x++) if (sim.heights[z * D + x] !== sim.heights[(SIZE - z) * D + x]) asymmetric++;
    expect(asymmetric).toBe(0);
    const [a, b] = sim.starts;
    expect([b!.x, b!.z]).toEqual([a!.x, SIZE * ONE - a!.z]);
    for (const s of sim.spots) expect(sim.spots.some((o) => o.kind === s.kind && o.x === s.x && o.z === SIZE * ONE - s.z), `spot ${s.x / ONE},${s.z / ONE}`).toBe(true);
    // Only the island spots lie on the axis (equally far from both starts).
    expect(sim.spots.filter((s) => s.z === AXIS * ONE).map((s) => [s.kind, s.x / ONE])).toEqual([
      ['mass', 300],
      ['mass', 400],
      ['hydro', 350],
    ]);
    for (const p of map.props) expect(map.props.some((o) => o.id === p.id && o.x === p.x && o.z === SIZE * ONE - p.z)).toBe(true);
    const sp = map.splat!;
    expect(sp.codec).toBe(0);
    if (sp.codec !== 0) return;
    const res = sp.resolution;
    for (const plane of sp.planes) {
      for (let j = 0; j < res; j++) {
        for (let k = 0; k < res * 4; k++) {
          if (plane[j * res * 4 + k] !== plane[(res - 1 - j) * res * 4 + k]) throw new Error(`splat row ${j} not mirrored`);
        }
      }
    }
  });

  it('is about 13 % water (river, channels, estuary)', () => {
    let wet = 0;
    for (let i = 0; i < D * D; i++) if (H[i]! < 12) wet++;
    const share = wet / (D * D);
    expect(share).toBeGreaterThan(0.1);
    expect(share).toBeLessThan(0.16);
    // Estuary basin: deepest water (≥ 6 WU) at the east edge.
    expect(12 - h(505, 256)).toBeGreaterThan(6);
  });

  it('puts 4 start mex around every start on a flat base plateau and every spot on flat dry land ≥ 12 WU from the edge', () => {
    for (const st of sim.starts) {
      const near = sim.spots.filter((s) => s.kind === 'mass' && Math.hypot(s.x - st.x, s.z - st.z) <= 16 * ONE);
      expect(near).toHaveLength(4);
      const h0 = heightWu(st.x / ONE, st.z / ONE);
      expect(h0).toBeCloseTo(28, 1);
      // Base area: flat (±0.5 WU) within r 45.
      for (let dz = -45; dz <= 45; dz += 3) {
        for (let dx = -45; dx <= 45; dx += 3) {
          if (dx * dx + dz * dz > 45 * 45) continue;
          expect(Math.abs(heightWu(st.x / ONE + dx, st.z / ONE + dz) - h0)).toBeLessThanOrEqual(0.5);
        }
      }
    }
    for (const p of [...sim.spots, ...sim.starts]) {
      // Dry: ≥ 1 WU above the water.
      expect(waterDepthRaw(hf, water, p.x, p.z)).toBeLessThanOrEqual(-1 * ONE);
      const h0 = heightWu(p.x / ONE, p.z / ONE);
      for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) expect(Math.abs(heightWu(p.x / ONE + dx, p.z / ONE + dz) - h0)).toBeLessThan(0.1);
      const e = Math.min(p.x, p.z, SIZE * ONE - p.x, SIZE * ONE - p.z) / ONE;
      expect(e).toBeGreaterThanOrEqual(12);
    }
  });

  it('has a short route over the west ford (≈ 428 WU) and a long one over the island (≈ 676 WU), no other crossing', () => {
    for (const slope of [false, true]) {
      const label = slope ? 'with slope limit' : 'water only';
      const all = unblockedPaths(S.x, S.z, slope);
      const long = at(paths(S.x, S.z, slope, westFord), N.x, N.z);
      const withoutIslandFords = paths(S.x, S.z, slope, islandFords);
      const short = at(withoutIslandFords, N.x, N.z);
      expect(at(all, N.x, N.z), label).toBeCloseTo(short, 6);
      // Spec §5 [F] ±5 %: 428 / 676 WU.
      expect(short, label).toBeGreaterThanOrEqual(407);
      expect(short, label).toBeLessThanOrEqual(449);
      expect(long, label).toBeGreaterThanOrEqual(642);
      expect(long, label).toBeLessThanOrEqual(710);
      expect(long / short, label).toBeGreaterThanOrEqual(1.45);
      // Without any ford the sides are separated; the island is reachable only over its fords.
      const cut = paths(S.x, S.z, slope, allFords);
      expect(at(cut, N.x, N.z), label).toBe(Infinity);
      expect(at(cut, BRAIDWATER_ISLAND.x, AXIS), label).toBe(Infinity);
      expect(at(withoutIslandFords, BRAIDWATER_ISLAND.x, AXIS), label).toBe(Infinity);
      // Every spot is reachable by land from both starts.
      const fromN = unblockedPaths(N.x, N.z, slope);
      for (const s of sim.spots) {
        expect(at(all, s.x / ONE, s.z / ONE), `${label}: spot ${s.x / ONE},${s.z / ONE}`).toBeLessThan(Infinity);
        expect(at(fromN, s.x / ONE, s.z / ONE)).toBeLessThan(Infinity);
      }
    }
  });

  it('has fords 0.2–0.45 WU deep and 28–36 WU wide; the river is ≥ 2 WU deep away from the fords and the shores', () => {
    const fordRun = (x0: number, z: number): number => {
      let a = x0;
      while (WALK[z * D + a - 1] === 1 && h(a - 1, z) < 12) a--;
      let b = x0;
      while (WALK[z * D + b + 1] === 1 && h(b + 1, z) < 12) b++;
      return b - a + 1;
    };
    const westX = (F.west.x0 + F.west.x1) / 2;
    const islX = (F.island.x0 + F.island.x1) / 2;
    // West ford across the whole river; island fords in the middle of each channel.
    for (const [x, z] of [
      [westX, AXIS],
      [westX, AXIS + 10],
      [islX, AXIS + 40],
      [islX, mirrorZ(AXIS + 40)],
    ] as const) {
      const depth = 12 - h(x, z);
      expect(depth, `ford depth at ${x},${z}`).toBeGreaterThanOrEqual(0.2);
      expect(depth).toBeLessThanOrEqual(0.45);
      const w = fordRun(x, z);
      expect(w, `ford width at ${x},${z}`).toBeGreaterThanOrEqual(28);
      expect(w).toBeLessThanOrEqual(36);
      // Flat ford bed (slope < 0.1).
      expect(Math.abs(h(x + 6, z) - h(x - 6, z)) / 12).toBeLessThan(0.1);
    }
    // Deep river: every sample whose ±6 WU neighbourhood is all water, away from the fords.
    let checked = 0;
    for (let z = AXIS; z < D - 6; z++) {
      for (let x = 6; x < D - 6; x++) {
        if (westFord(x, z) || islandFords(x, z)) continue;
        let allWet = true;
        for (let dz = -6; dz <= 6 && allWet; dz += 2) for (let dx = -6; dx <= 6 && allWet; dx += 2) if (h(x + dx, z + dz) >= 12) allWet = false;
        if (!allWet) continue;
        checked++;
        if (12 - h(x, z) < 2) throw new Error(`shallow river at ${x},${z}: ${(12 - h(x, z)).toFixed(2)} WU`);
      }
    }
    expect(checked).toBeGreaterThan(10_000);
  });

  it('has plateaus at their heights with steep cliffs (slope ≥ 1.2) except at the ramps', () => {
    const P = BRAIDWATER_PLATEAUS;
    expect(h(P.watch.x, P.watch.z)).toBeCloseTo(30, 0);
    expect(Math.abs(h(208, 300) - P.bluff.top)).toBeLessThanOrEqual(1);
    expect(Math.abs(h(P.knoll.x, P.knoll.z) - P.knoll.top)).toBeLessThanOrEqual(1);
    const maxDrop = (x0: number, z0: number, x1: number, z1: number): number => {
      const n = Math.round(Math.hypot(x1 - x0, z1 - z0));
      let m = 0;
      for (let i = 0; i < n; i++) {
        const t0 = i / n;
        const t1 = (i + 1) / n;
        m = Math.max(m, heightWu(x0 + (x1 - x0) * t0, z0 + (z1 - z0) * t0) - heightWu(x0 + (x1 - x0) * t1, z0 + (z1 - z0) * t1));
      }
      return (m * n) / Math.hypot(x1 - x0, z1 - z0);
    };
    const nearRamp = (x: number, z: number): boolean => BRAIDWATER_RAMPS.some((r) => inRamp(r, x, z, 8));
    // Circular plateaus: every radial line (away from the ramps) crosses a cliff.
    for (const [c, r] of [
      [P.watch, 60],
      [P.knoll, 36],
    ] as const) {
      for (let k = 0; k < 32; k++) {
        const cx = Math.cos((k * Math.PI) / 16);
        const cz = Math.sin((k * Math.PI) / 16);
        const ex = c.x + cx * r;
        const ez = c.z + cz * r;
        if (ex < 1 || ex > SIZE - 1) continue;
        let ramped = false;
        for (let t = 0; t <= r; t += 2) if (nearRamp(c.x + cx * t, c.z + cz * t)) ramped = true;
        if (ramped) continue;
        expect(maxDrop(c.x, c.z, ex, ez), `cliff of ${c === P.watch ? 'watch' : 'knoll'} at ray ${k}`).toBeGreaterThanOrEqual(1.2);
      }
    }
    // Base plateau (north, east, west edges) and bluff (back and river front).
    const lines: [number, number, number, number][] = [];
    for (let x = 92; x <= 228; x += 4) lines.push([x, 404, x, 364]);
    for (let z = 424; z <= 500; z += 4) lines.push([224, z, 262, z]);
    for (let z = 420; z <= 500; z += 4) lines.push([100, z, 60, z]);
    for (let x = 164; x <= 252; x += 4) lines.push([x, 318, x, 350]);
    for (let x = 164; x <= 252; x += 4) lines.push([x, 290, x, 262]);
    for (const [x0, z0, x1, z1] of lines) {
      if (nearRamp(x0, z0) || nearRamp(x1, z1) || nearRamp((x0 + x1) / 2, (z0 + z1) / 2)) continue;
      expect(maxDrop(x0, z0, x1, z1), `cliff ${x0},${z0} → ${x1},${z1}`).toBeGreaterThanOrEqual(1.2);
    }
  });

  it('has ramps ≥ 16 WU wide with slope ≤ 0.3; bluff and knoll are reachable only over their back ramp', () => {
    for (const r of BRAIDWATER_RAMPS) {
      const len = Math.hypot(r.b.x - r.a.x, r.b.z - r.a.z);
      const ux = (r.b.x - r.a.x) / len;
      const uz = (r.b.z - r.a.z) / len;
      for (let t = 0; t < len; t++) {
        const s = Math.abs(heightWu(r.a.x + ux * (t + 1), r.a.z + uz * (t + 1)) - heightWu(r.a.x + ux * t, r.a.z + uz * t));
        expect(s, `${r.id} slope at ${t}`).toBeLessThanOrEqual(0.3);
      }
      // Width: at mid length the cross-section rises/falls ≤ 0.3 per WU over ≥ 16 WU (side walls beyond).
      const mx = r.a.x + ux * len * 0.5;
      const mz = r.a.z + uz * len * 0.5;
      let w = 1;
      for (const sgn of [-1, 1]) {
        for (let k = 1; k < 20; k++) {
          const step = heightWu(mx - uz * k * sgn, mz + ux * k * sgn) - heightWu(mx - uz * (k - 1) * sgn, mz + ux * (k - 1) * sgn);
          if (Math.abs(step) > 0.3) break;
          w++;
        }
      }
      expect(w, `${r.id} side walls`).toBeLessThan(39);
      expect(w, `${r.id} width`).toBeGreaterThanOrEqual(16);
      expect(r.width).toBeGreaterThanOrEqual(16);
    }
    // Reachable over the ramp (nav limit), sealed without it even with the looser SEAL_SLOPE.
    const fromS = unblockedPaths(S.x, S.z, true);
    const fromN = unblockedPaths(N.x, N.z, true);
    for (const [id, x, z] of [
      ['bluff', 208, 300],
      ['knoll', BRAIDWATER_PLATEAUS.knoll.x, BRAIDWATER_PLATEAUS.knoll.z],
    ] as const) {
      expect(at(fromS, x, z)).toBeLessThan(Infinity);
      expect(at(fromN, x, z)).toBeLessThan(Infinity);
      const blocked: Blocked = (bx, bz) => inRamp(ramp(id), bx, bz, 6);
      expect(at(paths(S.x, S.z, SEAL_SLOPE, blocked), x, z), `${id} without its ramp`).toBe(Infinity);
      expect(at(paths(N.x, N.z, SEAL_SLOPE, blocked), x, z), `${id} without its ramp (enemy)`).toBe(Infinity);
    }
    // The base plateau is left only over its ramps; the watch plateau is reached over its ramp, the
    // west hollow over the hollow ramp.
    const noBaseRamps = paths(S.x, S.z, SEAL_SLOPE, (x, z) => ['baseWest', 'baseEast', 'hollow'].some((id) => inRamp(ramp(id), x, z, 6)));
    expect(at(noBaseRamps, 110, 310)).toBe(Infinity);
    expect(at(noBaseRamps, 350, 450)).toBe(Infinity);
    const P = BRAIDWATER_PLATEAUS;
    expect(at(paths(S.x, S.z, SEAL_SLOPE, (x, z) => inRamp(ramp('watch'), x, z, 4)), P.watch.x, P.watch.z)).toBe(Infinity);
    expect(at(paths(S.x, S.z, SEAL_SLOPE, (x, z) => inRamp(ramp('hollow'), x, z, 4)), 44, 432)).toBe(Infinity);
  });

  it('places the artillery positions as documented (spec §10.3)', () => {
    const P = BRAIDWATER_PLATEAUS;
    // Watch plateau top edge ↔ west ford centre ≤ 60 WU (Rinne/Pfanne reach the ford from the edge).
    const fx = (F.west.x0 + F.west.x1) / 2;
    let nearest = Infinity;
    for (let z = AXIS; z < 400; z++) for (let x = 0; x < 100; x++) if (h(x, z) >= P.watch.top - 0.5) nearest = Math.min(nearest, Math.hypot(x - fx, z - AXIS));
    expect(nearest).toBeLessThanOrEqual(60);
    // Bluff front edges (top ≥ 23 WU) face each other 40–56 WU apart across the river.
    for (const x of [180, 208, 236]) {
      let z = 300;
      while (h(x, z - 1) >= 23) z--;
      expect(2 * (z - AXIS), `bluff front gap at x ${x}`).toBeGreaterThanOrEqual(40);
      expect(2 * (z - AXIS)).toBeLessThanOrEqual(56);
    }
    // Knoll ↔ enemy knoll > 200 WU (just outside the T3 static artillery).
    expect(2 * (P.knoll.z - AXIS)).toBeGreaterThan(200);
  });

  it('has a gentle midland (slope p50 ≥ 0.05, p99 ≤ 0.3) and rugged corner rocks', () => {
    const slopes: number[] = [];
    for (const [x0, x1, z0, z1] of [
      [300, 430, 430, 470],
      [380, 500, 340, 400],
      [150, 190, 342, 378],
      [100, 145, 282, 328],
    ] as const) {
      for (let z = z0; z < z1; z += 2) for (let x = x0; x < x1; x += 2) slopes.push(Math.hypot(h(x + 1, z) - h(x - 1, z), h(x, z + 1) - h(x, z - 1)) / 2);
    }
    slopes.sort((a, b) => a - b);
    expect(slopes[Math.floor(slopes.length / 2)]!).toBeGreaterThanOrEqual(0.05);
    expect(slopes[Math.floor(slopes.length * 0.99)]!).toBeLessThanOrEqual(0.3);
    for (const [x, z] of [
      [4, 508],
      [506, 506],
      [4, 4],
      [506, 6],
    ] as const) {
      expect(h(x, z), `corner rock ${x},${z}`).toBeGreaterThanOrEqual(30);
    }
  });

  it('has ≈ 64 reclaim rocks on dry land, off the spots, ramps and fords', () => {
    expect(map.props.length).toBeGreaterThanOrEqual(58);
    expect(map.props.length).toBeLessThanOrEqual(70);
    for (const p of map.props) {
      expect(['core:rock_01', 'core:rock_02']).toContain(p.id);
      const x = p.x / ONE;
      const z = p.z / ONE;
      expect(heightWu(x, z)).toBeGreaterThan(12.5);
      for (const s of sim.spots) expect(Math.hypot(s.x / ONE - x, s.z / ONE - z)).toBeGreaterThanOrEqual(8);
      expect(BRAIDWATER_RAMPS.some((r) => inRamp(r, x, z, 0))).toBe(false);
    }
    // 10 on the island (4 mirrored pairs + 2 on the axis).
    const I = BRAIDWATER_ISLAND;
    expect(map.props.filter((p) => ((p.x / ONE - I.x) / I.rx) ** 2 + ((p.z / ONE - I.z) / I.rz) ** 2 < 1)).toHaveLength(10);
  });

  it('paints a splat that covers the auto-splat (plane 0 R = 1)', () => {
    const sp = map.splat!;
    expect(sp.codec).toBe(0);
    if (sp.codec !== 0) return;
    expect(sp.resolution).toBe(BRAIDWATER_SPLAT_RES);
    const p0 = sp.planes[0]!;
    for (let o = 0; o < p0.length; o += 4) if (p0[o] !== 255) throw new Error(`plane 0 R at texel ${o / 4}`);
  });
});
