import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isDeepWaterForLand, sampleHeightRaw, waterDepthRaw, type Heightfield } from '@faf/rules';
import { describe, expect, it } from 'vitest';
import { mapSimData, mapSimHash, readRtsMap, writeRtsMap } from '../src/index.ts';
import { compileMapSource, MAPS_DIR, MAPS_SRC_DIR } from '../scripts/mapc.ts';
import {
  generateTesseraSources,
  mirrorB,
  mirrorN,
  mirrorP,
  orbit,
  TESSERA_BAR,
  TESSERA_BAR_SEGMENTS,
  TESSERA_CONTESTED_MASS,
  TESSERA_HYDRO,
  TESSERA_NOSE,
  TESSERA_NOSES,
  TESSERA_NOTCHES,
  TESSERA_PONDS,
  TESSERA_PROPS_CANONICAL,
  TESSERA_SPLAT_RES,
} from '../scripts/mapgen-tessera.ts';
import { decodePng } from '../scripts/png.ts';

// Gameplay contract of the skirmish map "Tessera" (content/maps/src/tessera.spec.md, §12 "Vertragstest-
// Vorschlag"): 512 WU, 1v1, 34 mass + 4 hydro, exactly point-symmetric heights, D2-symmetric layout,
// flat base plates, three lanes (centre 419 WU, flanks 509 WU) separated by two cliff bars with a
// 26-WU notch each, rock-nose gates 40/47 WU, tiny spring ponds only, gates of PLAN §3.9.
// Passable for land = not deep water (LAND_MAX_WATER_DEPTH) and slope ≤ 0.6 (PLAN §3.9 `maxSlope`).

const ONE = 4096;
const SIZE = 512;
/** Golden: mapSimHash of the checked-in tessera.rtsmap. Changing it breaks every replay/golden on the map. */
const TESSERA_MAP_SIM_HASH = 0x22cb60a8;
const MAX_SLOPE = 0.6;
const START0 = { x: 108, z: 404 };
const START1 = { x: 404, z: 108 };

const bytes = new Uint8Array(readFileSync(join(MAPS_DIR, 'tessera.rtsmap')));
const map = readRtsMap(bytes);
const sim = mapSimData(map);
const hf: Heightfield = sim;
const water = sim.waterLevelRaw!;
const D = sim.dim;
const heightWu = (x: number, z: number): number => sampleHeightRaw(hf, x * ONE, z * ONE) / ONE;
const sample = (x: number, z: number): number => sim.heights[z * D + x]! / 128;
const u = (x: number, z: number): number => (x - z) / Math.SQRT2;
const v = (x: number, z: number): number => (SIZE - x - z) / Math.SQRT2;

/** Slope magnitude at a sample (central differences, one-sided at the border). */
function slope(x: number, z: number): number {
  const xl = Math.max(0, x - 1);
  const xr = Math.min(D - 1, x + 1);
  const zl = Math.max(0, z - 1);
  const zr = Math.min(D - 1, z + 1);
  return Math.hypot((sample(xr, z) - sample(xl, z)) / (xr - xl), (sample(x, zr) - sample(x, zl)) / (zr - zl));
}

/** Passable samples for land units (1-WU grid). */
const passable = new Uint8Array(D * D);
for (let z = 0; z < D; z++) {
  for (let x = 0; x < D; x++) passable[z * D + x] = !isDeepWaterForLand(hf, water, x * ONE, z * ONE) && slope(x, z) <= MAX_SLOPE ? 1 : 0;
}
const ok = (x: number, z: number): boolean => {
  const xi = Math.round(x);
  const zi = Math.round(z);
  return xi >= 0 && zi >= 0 && xi < D && zi < D && passable[zi * D + xi] === 1;
};

/** 4-neighbour flood fill over the passable samples. */
function reachable(from: { x: number; z: number }, blocked: (x: number, z: number) => boolean = () => false): Uint8Array {
  const seen = new Uint8Array(D * D);
  const stack = new Int32Array(D * D);
  let sp = 0;
  stack[sp++] = from.z * D + from.x;
  seen[from.z * D + from.x] = 1;
  while (sp > 0) {
    const i = stack[--sp]!;
    const x = i % D;
    const z = (i - x) / D;
    for (let k = 0; k < 4; k++) {
      const nx = k === 0 ? x + 1 : k === 1 ? x - 1 : x;
      const nz = k === 2 ? z + 1 : k === 3 ? z - 1 : z;
      if (nx < 0 || nz < 0 || nx >= D || nz >= D) continue;
      const j = nz * D + nx;
      if (seen[j] === 1 || passable[j] === 0 || blocked(nx, nz)) continue;
      seen[j] = 1;
      stack[sp++] = j;
    }
  }
  return seen;
}

/** Shortest passable path length (8-neighbour Dijkstra on the 1-WU grid, spec §10.1). */
function pathLength(from: { x: number; z: number }, to: { x: number; z: number }, blocked: (x: number, z: number) => boolean = () => false): number {
  const dist = new Float64Array(D * D).fill(Infinity);
  const heapI: number[] = [];
  const heapD: number[] = [];
  const push = (i: number, d: number): void => {
    heapI.push(i);
    heapD.push(d);
    let k = heapI.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heapD[p]! <= heapD[k]!) break;
      [heapI[p], heapI[k]] = [heapI[k]!, heapI[p]!];
      [heapD[p], heapD[k]] = [heapD[k]!, heapD[p]!];
      k = p;
    }
  };
  const pop = (): [number, number] => {
    const top: [number, number] = [heapI[0]!, heapD[0]!];
    const li = heapI.pop()!;
    const ld = heapD.pop()!;
    if (heapI.length > 0) {
      heapI[0] = li;
      heapD[0] = ld;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < heapI.length && heapD[l]! < heapD[m]!) m = l;
        if (r < heapI.length && heapD[r]! < heapD[m]!) m = r;
        if (m === k) break;
        [heapI[m], heapI[k]] = [heapI[k]!, heapI[m]!];
        [heapD[m], heapD[k]] = [heapD[k]!, heapD[m]!];
        k = m;
      }
    }
    return top;
  };
  const start = from.z * D + from.x;
  const goal = to.z * D + to.x;
  dist[start] = 0;
  push(start, 0);
  while (heapI.length > 0) {
    const [i, d] = pop();
    if (i === goal) return d;
    if (d > dist[i]!) continue;
    const x = i % D;
    const z = (i - x) / D;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const nx = x + dx;
        const nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= D || nz >= D) continue;
        const j = nz * D + nx;
        if (passable[j] === 0 || blocked(nx, nz)) continue;
        const nd = d + (dx !== 0 && dz !== 0 ? Math.SQRT2 : 1);
        if (nd < dist[j]!) {
          dist[j] = nd;
          push(j, nd);
        }
      }
    }
  }
  return Infinity;
}

/** Length (WU) of the passable run through `c` along the unit direction `dir` (0.25-WU steps, ±range). */
function passableRun(c: { x: number; z: number }, dir: { x: number; z: number }, range: number): number {
  const step = 0.25;
  if (!ok(c.x, c.z)) return 0;
  let a = 0;
  while (a < range && ok(c.x - dir.x * (a + step), c.z - dir.z * (a + step))) a += step;
  let b = 0;
  while (b < range && ok(c.x + dir.x * (b + step), c.z + dir.z * (b + step))) b += step;
  return a + b + step;
}

const at = (seen: Uint8Array, xRaw: number, zRaw: number): number => seen[Math.round(zRaw / ONE) * D + Math.round(xRaw / ONE)]!;
const spotsWu = sim.spots.map((s) => ({ kind: s.kind, x: s.x / ONE, z: s.z / ONE }));
const hasSpot = (kind: string, p: { x: number; z: number }): boolean => spotsWu.some((s) => s.kind === kind && s.x === p.x && s.z === p.z);

interface RosterWeapon {
  readonly range: number;
}
interface RosterUnit {
  readonly id: string;
  readonly weapons?: readonly RosterWeapon[];
}
const roster = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../docs/design/roster.json'), 'utf8')) as { units: RosterUnit[] };
const rangeOf = (id: string): number => Math.max(...roster.units.find((r) => r.id === id)!.weapons!.map((w) => w.range));

describe('tessera map contract', () => {
  it('has the documented header data (512 WU, 2 starts, 34 mass, 4 hydro, 61 props) and pinned identity', () => {
    expect(map.meta.name).toBe('Tessera');
    expect(sim.sizeWu).toBe(SIZE);
    expect(D).toBe(513);
    expect(sim.heightScaleRaw).toBe(32);
    expect(water).toBe(16 * ONE);
    expect(sim.starts).toEqual([
      { army: 0, x: START0.x * ONE, z: START0.z * ONE },
      { army: 1, x: START1.x * ONE, z: START1.z * ONE },
    ]);
    expect(Math.hypot(START1.x - START0.x, START1.z - START0.z)).toBeCloseTo(418.6, 1);
    expect(sim.spots.filter((s) => s.kind === 'mass')).toHaveLength(34);
    expect(sim.spots.filter((s) => s.kind === 'hydro')).toHaveLength(4);
    expect(sim.props).toHaveLength(61);
    expect(sim.props.filter((p) => p.id === 'core:rock_01' || p.id === 'core:rock_02')).toHaveLength(61);
    expect(map.splat?.layers).toBe(8);
    expect(map.splat?.resolution).toBe(TESSERA_SPLAT_RES);
    expect(map.preview).not.toBeNull();
    expect(mapSimHash(map)).toBe(TESSERA_MAP_SIM_HASH);
    expect(Buffer.from(writeRtsMap(map)).equals(Buffer.from(bytes))).toBe(true);
    let lo = 65535;
    let hi = 0;
    for (const h of sim.heights) {
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    // Lowest point: the pond beds (≥ 15 WU); highest: the corner massifs (50–65 WU).
    expect(lo / 128).toBeGreaterThanOrEqual(14.9);
    expect(hi / 128).toBeGreaterThanOrEqual(50);
    expect(hi / 128).toBeLessThanOrEqual(66);
  });

  it('is exactly point-symmetric (heights, starts, spots, props) and D2-symmetric in its layout (spots, props)', () => {
    let asymmetric = 0;
    for (let i = 0; i < D * D; i++) if (sim.heights[i] !== sim.heights[D * D - 1 - i]) asymmetric++;
    expect(asymmetric).toBe(0);
    const [s0, s1] = sim.starts;
    expect([s1!.x, s1!.z]).toEqual([SIZE * ONE - s0!.x, SIZE * ONE - s0!.z]);
    for (const m of [mirrorP, mirrorN, mirrorB]) {
      for (const s of spotsWu) expect(hasSpot(s.kind, m(s)), `${m.name} of ${s.kind} (${s.x}, ${s.z})`).toBe(true);
      for (const p of sim.props) {
        const q = m({ x: p.x / ONE, z: p.z / ONE });
        const img = sim.props.find((o) => o.x === q.x * ONE && o.z === q.z * ONE);
        expect(img, `${m.name} of prop (${p.x / ONE}, ${p.z / ONE})`).toBeDefined();
        expect([img!.id, img!.scalePermille]).toEqual([p.id, p.scalePermille]);
      }
    }
    // Starts lie on the base axis, mirrored onto each other by P and N.
    expect(mirrorN(START0)).toEqual(START1);
    expect(mirrorB(START0)).toEqual(START0);
  });

  it('keeps the flanks and the neutral diamond tips equally far from both starts (spec §7.2/§10.1)', () => {
    const d = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.hypot(a.x - b.x, a.z - b.z);
    for (const p of [...TESSERA_CONTESTED_MASS, ...TESSERA_HYDRO.slice(2)]) {
      // Every contested spot has a partner with swapped distances (N image); on x = z both are equal.
      const q = mirrorN(p);
      expect(d(p, START0)).toBeCloseTo(d(q, START1), 9);
      if (p.x === p.z) expect(d(p, START0)).toBeCloseTo(d(p, START1), 9);
    }
    // Safe spots: all 12 per army ≤ 126 WU from the own start, nearer than half the enemy distance.
    const safe = spotsWu.filter((s) => s.kind === 'mass' && Math.hypot(s.x - START0.x, s.z - START0.z) <= 126);
    expect(safe).toHaveLength(12);
    for (const s of safe) expect(Math.hypot(s.x - START1.x, s.z - START1.z)).toBeGreaterThan(209);
    // Contested: between 45 % and 75 % of the start distance from both starts.
    for (const p of TESSERA_CONTESTED_MASS) {
      for (const st of [START0, START1]) {
        const share = d(p, st) / 418.6;
        expect(share).toBeGreaterThanOrEqual(0.45);
        expect(share).toBeLessThanOrEqual(0.75);
      }
    }
  });

  it('puts 4 start mex around every start, flat base plates (28 WU) and every spot on flat dry land', () => {
    for (const st of sim.starts) {
      const near = sim.spots.filter((s) => s.kind === 'mass' && Math.hypot(s.x - st.x, s.z - st.z) <= 16 * ONE);
      expect(near).toHaveLength(4);
      // Plate: 28 ± 0.1 WU within r 48 (spec §3), the base hydro included.
      for (let dz = -48; dz <= 48; dz += 2) {
        for (let dx = -48; dx <= 48; dx += 2) {
          if (dx * dx + dz * dz > 48 * 48) continue;
          expect(Math.abs(heightWu(st.x / ONE + dx, st.z / ONE + dz) - 28)).toBeLessThanOrEqual(0.1);
        }
      }
      expect(sim.spots.filter((s) => s.kind === 'hydro' && Math.hypot(s.x - st.x, s.z - st.z) <= 48 * ONE)).toHaveLength(1);
    }
    for (const p of [...sim.spots, ...sim.starts]) {
      expect(waterDepthRaw(hf, water, p.x, p.z)).toBeLessThan(-3.5 * ONE);
      const h0 = heightWu(p.x / ONE, p.z / ONE);
      for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) expect(Math.abs(heightWu(p.x / ONE + dx, p.z / ONE + dz) - h0)).toBeLessThan(0.1);
      // ≥ 30 WU from the map edge (spec §7.2; Setons rule ≥ 12 WU).
      expect(Math.min(p.x, p.z, SIZE * ONE - p.x, SIZE * ONE - p.z) / ONE).toBeGreaterThanOrEqual(30);
    }
    // Shard hollow: floor ≈ 20 WU (diamond), plain ≈ 24 WU.
    for (const p of TESSERA_CONTESTED_MASS.slice(0, 4)) expect(Math.abs(heightWu(p.x, p.z) - 20)).toBeLessThan(0.6);
    expect(Math.abs(heightWu(256, 256) - 20)).toBeLessThan(0.6);
  });

  it('connects both starts and every spot over land – through the centre alone and around each flank alone', () => {
    const all = reachable(START0);
    for (const s of [...sim.starts, ...sim.spots]) expect(at(all, s.x, s.z), `(${s.x / ONE}, ${s.z / ONE})`).toBe(1);
    // Centre lane blocked (|v| < 95, |u| < 110): still connected over the flanks.
    const flanksOnly = reachable(START0, (x, z) => Math.abs(v(x, z)) < 95 && Math.abs(u(x, z)) < 110);
    expect(at(flanksOnly, START1.x * ONE, START1.z * ONE)).toBe(1);
    // Flanks blocked (|v| > 95): still connected through the centre.
    const centreOnly = reachable(START0, (x, z) => Math.abs(v(x, z)) > 95);
    expect(at(centreOnly, START1.x * ONE, START1.z * ONE)).toBe(1);
    // Each flank alone (the other flank and the centre lane blocked) connects the starts as well.
    for (const sign of [1, -1]) {
      const one = reachable(START0, (x, z) => (Math.abs(v(x, z)) < 95 && Math.abs(u(x, z)) < 110) || sign * v(x, z) < -95);
      expect(at(one, START1.x * ONE, START1.z * ONE), `flank ${sign > 0 ? 'NW' : 'SO'}`).toBe(1);
    }
    // Corner massifs are impassable, the ponds are no land.
    expect(at(all, 4 * ONE, 4 * ONE)).toBe(0);
    expect(at(all, 508 * ONE, 508 * ONE)).toBe(0);
    for (const p of TESSERA_PONDS) expect(ok(p.x, p.z)).toBe(false);
  });

  it('has cliff bars with a 22–30 WU notch, rock-nose gates of 36–52 WU and steep corner massifs', () => {
    const across = { x: Math.SQRT1_2, z: Math.SQRT1_2 };
    // Every bar segment: impassable across its whole length (slope > 1.0 on every crossing, core ≥ 1.5).
    for (const c of TESSERA_BAR_SEGMENTS) {
      for (let t = 0; t <= 1; t += 0.1) {
        const cx = c[0] + (c[2] - c[0]) * t;
        const cz = c[1] + (c[3] - c[1]) * t;
        let steep = 0;
        for (let r = -TESSERA_BAR.foot - 4; r < TESSERA_BAR.foot + 4; r++) {
          steep = Math.max(steep, Math.abs(heightWu(cx + across.x * (r + 1), cz + across.z * (r + 1)) - heightWu(cx + across.x * r, cz + across.z * r)));
        }
        expect(steep, `bar (${cx.toFixed(0)}, ${cz.toFixed(0)})`).toBeGreaterThan(1.5);
        expect(heightWu(cx, cz) - 24).toBeGreaterThan(8);
      }
    }
    // Notches on the neutral axis: passable run along the bar axis (spec: 26 WU).
    const along = { x: Math.SQRT1_2, z: -Math.SQRT1_2 };
    for (const n of TESSERA_NOTCHES) {
      const w = passableRun(n, along, 60);
      expect(w, `notch (${n.x}, ${n.z})`).toBeGreaterThanOrEqual(22);
      expect(w).toBeLessThanOrEqual(30);
      // Gentle floor (≤ 0.1) through the notch (bar foot to bar foot plus 3 WU on each side).
      for (let r = -16; r < 16; r++) expect(Math.abs(heightWu(n.x + across.x * (r + 1), n.z + across.z * (r + 1)) - heightWu(n.x + across.x * r, n.z + across.z * r))).toBeLessThanOrEqual(0.1);
    }
    // Rock noses: passage to the map edge (spec 40 WU) and to the bar end (spec 47 WU).
    const barEnds = TESSERA_BAR_SEGMENTS.flatMap((c) => [
      { x: c[0], z: c[1] },
      { x: c[2], z: c[3] },
    ]);
    for (const nose of TESSERA_NOSES) {
      expect(heightWu(nose.x, nose.z) - 24).toBeGreaterThan(TESSERA_NOSE.crest - 3);
      // Edge gap: along the axis nose → nearest map edge.
      const toEdge = nose.x < 100 ? { x: -1, z: 0 } : nose.x > 412 ? { x: 1, z: 0 } : nose.z < 100 ? { x: 0, z: -1 } : { x: 0, z: 1 };
      const edgeDist = toEdge.x < 0 ? nose.x : toEdge.x > 0 ? SIZE - nose.x : toEdge.z < 0 ? nose.z : SIZE - nose.z;
      const edgeMid = { x: nose.x + toEdge.x * (edgeDist - TESSERA_NOSE.foot) * 0.5 + toEdge.x * TESSERA_NOSE.foot, z: nose.z + toEdge.z * (edgeDist - TESSERA_NOSE.foot) * 0.5 + toEdge.z * TESSERA_NOSE.foot };
      const edgeGap = passableRun(edgeMid, toEdge, 60);
      expect(edgeGap, `edge gap at nose (${nose.x}, ${nose.z})`).toBeGreaterThanOrEqual(36);
      expect(edgeGap).toBeLessThanOrEqual(52);
      // Bar gap: along the line nose → nearest bar end.
      const end = barEnds.reduce((a, b) => (Math.hypot(b.x - nose.x, b.z - nose.z) < Math.hypot(a.x - nose.x, a.z - nose.z) ? b : a));
      const len = Math.hypot(end.x - nose.x, end.z - nose.z);
      const dir = { x: (end.x - nose.x) / len, z: (end.z - nose.z) / len };
      const s = (TESSERA_NOSE.foot + (len - TESSERA_BAR.foot)) * 0.5;
      const barGap = passableRun({ x: nose.x + dir.x * s, z: nose.z + dir.z * s }, dir, 60);
      expect(barGap, `bar gap at nose (${nose.x}, ${nose.z})`).toBeGreaterThanOrEqual(36);
      expect(barGap).toBeLessThanOrEqual(52);
    }
    // Corner massifs: steep foot band from the flank towards the NW corner, high ridges.
    let steep = 0;
    for (let t = 30; t < 80; t++) steep = Math.max(steep, sample(t, t) - sample(t + 1, t + 1));
    expect(steep).toBeGreaterThan(1.2);
    expect(sample(6, 6)).toBeGreaterThan(45);
    expect(sample(SIZE - 6, SIZE - 6)).toBeGreaterThan(45);
  });

  it('has the documented lane lengths: centre 405–435 WU, around one flank 490–540 WU (spec §10.1)', () => {
    const centre = pathLength(START0, START1);
    expect(centre).toBeGreaterThanOrEqual(405);
    expect(centre).toBeLessThanOrEqual(435);
    const flank = pathLength(START0, START1, (x, z) => Math.abs(v(x, z)) < 95 && Math.abs(u(x, z)) < 110);
    expect(flank).toBeGreaterThanOrEqual(490);
    expect(flank).toBeLessThanOrEqual(540);
    expect(flank / centre).toBeGreaterThan(1.15);
    // Gentle centre lane (no cliffs, slope ≤ 0.3 along the base axis).
    for (let t = 0; t < 296; t++) expect(Math.abs(sample(START0.x + t + 1, START0.z - t - 1) - sample(START0.x + t, START0.z - t)) / Math.SQRT2).toBeLessThanOrEqual(0.3);
  });

  it('has only two tiny spring ponds (< 0.5 % water, ≥ 30 WU from every spot)', () => {
    let wet = 0;
    let nearest = Infinity;
    for (let z = 0; z < D; z++) {
      for (let x = 0; x < D; x++) {
        if (sim.heights[z * D + x]! * sim.heightScaleRaw >= water) continue;
        wet++;
        const dp = Math.min(...TESSERA_PONDS.map((p) => Math.hypot(x - p.x, z - p.z)));
        expect(dp, `water at (${x}, ${z})`).toBeLessThan(20);
        for (const s of spotsWu) nearest = Math.min(nearest, Math.hypot(x - s.x, z - s.z));
      }
    }
    expect(wet / (D * D)).toBeGreaterThan(0.001);
    expect(wet / (D * D)).toBeLessThan(0.005);
    expect(nearest).toBeGreaterThanOrEqual(30);
    // ≤ 1 WU deep (land obstacle, visually flat).
    for (const p of TESSERA_PONDS) expect(waterDepthRaw(hf, water, p.x * ONE, p.z * ONE) / ONE).toBeLessThanOrEqual(1.05);
  });

  it('meets the range gates of PLAN §3.9 and spec §10.2 (roster.json)', () => {
    const diagonal = SIZE * Math.SQRT2;
    const furnace = rangeOf('core:str_t3_arty');
    expect(furnace).toBe(200);
    expect(diagonal).toBeGreaterThanOrEqual(furnace / 0.4);
    // No artillery reaches from base to base; a Bolt II in the centre covers the whole diamond.
    const baseToBase = Math.hypot(START1.x - START0.x, START1.z - START0.z);
    for (const id of ['core:lnd_t1_arty', 'core:str_t2_arty', 'core:str_t3_arty']) expect(rangeOf(id)).toBeLessThan(baseToBase);
    for (const p of TESSERA_CONTESTED_MASS.slice(0, 4)) expect(Math.hypot(p.x - 256, p.z - 256)).toBeLessThanOrEqual(rangeOf('core:str_t2_pd'));
  });

  it('keeps the rock props on dry, drivable ground and 37 of them in the shard hollow', () => {
    for (const p of sim.props) {
      const x = p.x / ONE;
      const z = p.z / ONE;
      expect(waterDepthRaw(hf, water, p.x, p.z), `prop (${x}, ${z})`).toBeLessThan(0);
      expect(slope(x, z), `prop (${x}, ${z})`).toBeLessThanOrEqual(MAX_SLOPE);
      for (const s of spotsWu) expect(Math.hypot(x - s.x, z - s.z)).toBeGreaterThanOrEqual(12);
    }
    // Tessera stone + shard field (the first 10 canonical entries and their D2 images), all inside the hollow.
    const shard = TESSERA_PROPS_CANONICAL.slice(0, 10).flatMap(([x, z]) => orbit({ x, z }));
    expect(shard).toHaveLength(37);
    for (const q of shard) {
      expect(sim.props.some((p) => p.x === q.x * ONE && p.z === q.z * ONE)).toBe(true);
      expect(Math.hypot(q.x - 256, q.z - 256)).toBeLessThanOrEqual(90);
    }
  });

  it('paints a sand-free steppe splat that covers the auto-splat, with slate plates in the hollow floor', () => {
    const sp = map.splat!;
    expect(sp.codec).toBe(0);
    if (sp.codec !== 0) return;
    const res = sp.resolution;
    const [p0, p1] = sp.planes;
    let floor = 0;
    let slate = 0;
    let slateOutside = 0;
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const o = (j * res + i) * 4;
        // Plane 0 R = 1: the painted layers replace the auto-splat completely.
        expect(p0![o]).toBe(255);
        // Final sand weight after the lerp chain: none anywhere (spec §11 "kein Sand").
        let sand = 1;
        for (let c = 1; c < 4; c++) sand *= 1 - p0![o + c]! / 255;
        for (let c = 0; c < 4; c++) sand *= 1 - p1![o + c]! / 255;
        expect(sand).toBeLessThan(0.01);
        // Final dark-rock weight: plane 1 B, then moss (A) on top.
        const dark = (p1![o + 2]! / 255) * (1 - p1![o + 3]! / 255);
        const r = Math.hypot((i + 0.5) * (SIZE / res) - 256, (j + 0.5) * (SIZE / res) - 256);
        if (r <= 36) {
          floor++;
          if (dark > 0.4) slate++;
        } else if (r > 80 && dark > 0.4) slateOutside++;
      }
    }
    expect(slate / floor).toBeGreaterThan(0.4);
    // Outside the hollow dark rock only streaks the steep faces (bars, noses, massifs).
    expect(slateOutside / (res * res)).toBeLessThan(0.02);
  });
});

describe('tessera sources are fresh', () => {
  it('mapc from content/maps/src/tessera reproduces content/maps/tessera.rtsmap byte-exactly', () => {
    const { bytes: compiled, map: m } = compileMapSource(join(MAPS_SRC_DIR, 'tessera'));
    expect(compiled.length).toBe(bytes.length);
    expect(Buffer.from(compiled).equals(Buffer.from(bytes))).toBe(true);
    expect(m.splat?.layers).toBe(8);
  });

  it('mapgen reproduces the checked-in Tessera sources (heights, splat planes, markers.json)', () => {
    const dir = join(MAPS_SRC_DIR, 'tessera');
    const gen = generateTesseraSources();
    const png = decodePng(new Uint8Array(readFileSync(join(dir, 'heightmap.png'))));
    expect([png.bitDepth, png.channels, png.width]).toEqual([16, 1, gen.heightmap.dim]);
    expect(Buffer.from(png.samples.buffer).equals(Buffer.from(gen.heightmap.samples.buffer))).toBe(true);
    gen.splat.forEach((plane, k) => {
      const img = decodePng(new Uint8Array(readFileSync(join(dir, `splat-${k}.png`))));
      expect([img.bitDepth, img.channels, img.width, img.height]).toEqual([8, 4, TESSERA_SPLAT_RES, TESSERA_SPLAT_RES]);
      expect(Buffer.from(img.samples.buffer).equals(Buffer.from(plane.buffer))).toBe(true);
    });
    expect(readFileSync(join(dir, 'markers.json'), 'utf8')).toBe(`${JSON.stringify(gen.markers, null, 2)}\n`);
  });
});
