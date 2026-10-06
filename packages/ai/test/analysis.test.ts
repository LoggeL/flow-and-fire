import { describe, expect, it } from 'vitest';
import {
  computePassLowRes,
  computePassSamples,
  gridDijkstra,
  heightLowRes,
  INIT_OPS_LIMIT,
  labelComponents,
  nearestPassableCell,
  type MapAnalysis,
  type Zone,
} from '../src/index.ts';
import { loadAnalysis, loadStatic } from './support/fixtures.ts';

function counts(a: MapAnalysis, kind: 'mass' | 'hydro'): Record<Zone, number> {
  const out: Record<Zone, number> = { own: 0, contested: 0, enemy: 0, unreachable: 0 };
  for (const s of a.spots) if (s.kind === kind) out[s.zone]++;
  return out;
}

const within = (got: number, want: number, rel: number): void => {
  expect(Math.abs(got - want)).toBeLessThanOrEqual(want * rel);
};

describe('passability (port of ecosim analyze_map)', () => {
  it('uses numpy.gradient semantics and water depth', () => {
    // 5×5 samples (sizeWu 4), heightScaleRaw 4096 ⇒ raw = WU. Ramp of slope 1 along x in the last column.
    const dim = 5;
    const heights = new Uint16Array(dim * dim);
    for (let z = 0; z < dim; z++) heights[z * dim + 4] = 1;
    const h = { sizeWu: 4, dim, heights, heightScaleRaw: 4096, waterLevelRaw: null };
    const s = computePassSamples(h, { maxSlope: 0.6, maxWaterDepthWu: 0.5, cellWu: 2 });
    // x = 3: central difference (1 − 0) / 2 = 0.5 ⇒ passable; x = 4: one-sided 1 − 0 = 1 ⇒ blocked.
    expect(s[3]).toBe(1);
    expect(s[4]).toBe(0);
    expect(s[2]).toBe(1);
    const pass = computePassLowRes(h, { maxSlope: 0.6, maxWaterDepthWu: 0.5, cellWu: 2 });
    // Cells cover samples [0, 2) and [2, 4) — the blocked column x = 4 is outside every cell.
    expect([...pass]).toEqual([1, 1, 1, 1]);
    // Water level 1 WU over flat ground at 0 ⇒ depth 1 > 0.5 blocks; 0.5 is still passable.
    const flat = { sizeWu: 4, dim, heights: new Uint16Array(dim * dim), heightScaleRaw: 4096, waterLevelRaw: 4096 };
    expect([...computePassLowRes(flat)]).toEqual([0, 0, 0, 0]);
    expect([...computePassLowRes({ ...flat, waterLevelRaw: 2048 })]).toEqual([1, 1, 1, 1]);
    expect(heightLowRes({ ...h, heights: new Uint16Array(dim * dim).fill(3) })[0]).toBe(3);
  });

  it('components use the 8-neighbourhood without corner cutting', () => {
    // 1 0
    // 0 1   → diagonal only, both orthogonal neighbours blocked ⇒ two components.
    const c = labelComponents(Uint8Array.from([1, 0, 0, 1]), 2);
    expect(c.count).toBe(2);
    expect([...c.labels]).toEqual([0, -1, -1, 1]);
    const d = labelComponents(Uint8Array.from([1, 1, 0, 1]), 2);
    expect(d.count).toBe(1);
  });

  it('Dijkstra costs 2 / 2√2 and never cuts corners', () => {
    const pass = Uint8Array.from([1, 1, 1, 1, 0, 1, 1, 1, 1]);
    const r = gridDijkstra(pass, 3, 2, 0);
    expect(r.dist[2]).toBe(4);
    expect(r.dist[8]).toBe(8); // around the blocked centre: no diagonal next to it
    expect(r.dist[4]).toBe(Infinity);
    const open = gridDijkstra(new Uint8Array(9).fill(1), 3, 2, 0);
    expect(open.dist[8]).toBe(4 * Math.sqrt(2));
    expect(nearestPassableCell(pass, 3, 2, 3, 3)).toBe(1);
  });
});

describe('map analysis vs ai.md §3', () => {
  const setons = loadAnalysis('setons', 0);
  const hollow = loadAnalysis('hollow-ridge', 0);

  it('Setons army 0 vs army 1: mass 48/2/48/10, hydro own 4', () => {
    expect(counts(setons, 'mass')).toEqual({ own: 48, contested: 2, enemy: 48, unreachable: 10 });
    expect(counts(setons, 'hydro').own).toBe(4);
    expect(setons.enemyArmy).toBe(1);
  });

  it('Hollow Ridge: mass 6/4/6/0, hydro own 1', () => {
    expect(counts(hollow, 'mass')).toEqual({ own: 6, contested: 4, enemy: 6, unreachable: 0 });
    expect(counts(hollow, 'hydro').own).toBe(1);
  });

  it('path start → enemy 463 / 570 WU (±3 %), air line 458 / 453', () => {
    within(setons.pathLengthWu, 463, 0.03);
    within(hollow.pathLengthWu, 570, 0.03);
    within(setons.euclidToEnemy, 458, 0.01);
    within(hollow.euclidToEnemy, 453, 0.01);
  });

  it('ring mex d_own 16 / 22 WU (±2), four ring spots each', () => {
    expect(setons.ringSpots).toHaveLength(4);
    expect(hollow.ringSpots).toHaveLength(4);
    for (const i of setons.ringSpots) expect(Math.abs(setons.spots[i]!.dOwn - 16)).toBeLessThanOrEqual(2);
    for (const i of hollow.ringSpots) expect(Math.abs(hollow.spots[i]!.dOwn - 22)).toBeLessThanOrEqual(2);
  });

  it('rally → enemy start 418 / 525 WU (±3 %), rally 45 WU along the path', () => {
    within(setons.rallyToEnemyWu, 418, 0.03);
    within(hollow.rallyToEnemyWu, 525, 0.03);
    within(setons.dOwnAt(setons.rally.x, setons.rally.z), 45, 0.1);
  });

  it('mex order follows ai.md §3 (Setons ranks 1–8, Hollow Ridge contested spots)', () => {
    const pos = (a: MapAnalysis, i: number): string => `${a.spots[i]!.x}|${a.spots[i]!.z}`;
    expect(setons.mexOrder.slice(4, 8).map((i) => pos(setons, i))).toEqual(['354|728', '348|626', '304|692', '388|632']);
    expect(hollow.mexOrder.slice(4, 8).map((i) => pos(hollow, i))).toEqual(['112|244', '128|256', '328|128', '128|328']);
    expect(pos(setons, setons.hydroOrder[0]!)).toBe('302|739');
    const contested = setons.spots.filter((s) => s.zone === 'contested').map((s) => `${s.x}|${s.z}`);
    expect(contested.sort()).toEqual(['494|534', '530|490']);
  });

  it('staging at q = 0.40 on the path, chokepoint on the Setons land bridge (≈ 74 WU)', () => {
    const q = setons.dOwnAt(setons.staging.x, setons.staging.z);
    const qe = setons.dEnemyAt(setons.staging.x, setons.staging.z);
    expect(q / (q + qe)).toBeGreaterThanOrEqual(0.4);
    expect(q / (q + qe)).toBeLessThan(0.42);
    expect(setons.chokepoint).not.toBeNull();
    expect(Math.abs(setons.chokepoint!.widthWu - 74)).toBeLessThanOrEqual(10);
    expect(Math.abs(setons.chokepoint!.x / 1024 - 0.49)).toBeLessThan(0.03);
    expect(Math.abs(setons.chokepoint!.z / 1024 - 0.5)).toBeLessThan(0.03);
  });

  it('axes and base template point towards the enemy; generated factory slots', () => {
    const f = setons.forward;
    expect(Math.abs(f.x * f.x + f.z * f.z - 1)).toBeLessThan(1e-12);
    expect(f.x).toBeGreaterThan(0);
    expect(f.z).toBeLessThan(0);
    const fac1 = setons.slots.fac1!;
    expect(Math.abs(fac1.x - (354 + f.x * 12))).toBeLessThan(1e-9);
    expect(Math.abs(fac1.z - (678 + f.z * 12))).toBeLessThan(1e-9);
    expect(setons.factorySlot(2)).toEqual({ x: setons.slots.fac2!.x, z: setons.slots.fac2!.z });
    const fac4 = setons.factorySlot(4);
    const back = (fac4.x - 354) * f.x + (fac4.z - 678) * f.z;
    expect(back).toBeLessThan(0);
    const eco0 = setons.ecoRingSlot(0);
    expect(Math.abs(Math.sqrt((eco0.x - 354) ** 2 + (eco0.z - 678) ** 2) - 12)).toBeLessThan(0.05);
    expect(setons.detour).toBeCloseTo(1.1, 6);
  });

  it('init ops stay within 2 M and the analysis is deterministic', () => {
    expect(setons.initOps).toBeLessThanOrEqual(INIT_OPS_LIMIT);
    expect(hollow.initOps).toBeLessThanOrEqual(INIT_OPS_LIMIT);
    const s1 = loadStatic('setons', 1);
    expect(s1.passLowRes).toBe(loadStatic('setons', 0).passLowRes);
    const a1 = loadAnalysis('setons', 1);
    expect(counts(a1, 'mass')).toEqual({ own: 48, contested: 2, enemy: 48, unreachable: 10 });
    within(a1.pathLengthWu, 463, 0.03);
  });
});
