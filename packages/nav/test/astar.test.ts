import { describe, expect, it } from 'vitest';
import { createStandaloneNav, fineSearch, navScratch, reconstruct, searchCost, stepCost, type Nav } from '../src/index.ts';
import { generateNavTestMap, type NavTestMapKind } from '../bench/testmap.ts';
import { hollowRidge, refDijkstra, testRng } from './helpers.ts';

// L1 (PLAN §3.12, MS3 acceptance): fine A* costs exactly as much as Dijkstra in 10,000 cases —
// generated 64–128-WU maps (with random footprints) and windows of hollow-ridge, all classes,
// including unreachable goals and blocked starts/goals.

interface Config {
  readonly name: string;
  readonly nav: Nav;
  readonly rect: readonly [number, number, number, number];
}

function generated(size: number, seed: number, kind: NavTestMapKind, stamps: number): Config {
  const m = generateNavTestMap({ sizeWu: size, seed, kind });
  const { nav } = createStandaloneNav(m);
  const rnd = testRng(seed * 31 + size);
  for (let i = 0; i < stamps; i++) {
    const w = 1 + (rnd() % 6);
    const h = 1 + (rnd() % 6);
    nav.stampFootprint(rnd() % (size - w), rnd() % (size - h), w, h, 1);
  }
  return { name: `${kind}-${size}-${seed}`, nav, rect: [0, 0, size, size] };
}

function configs(): Config[] {
  const out: Config[] = [
    generated(64, 1, 'open', 40),
    generated(64, 2, 'bases', 20),
    generated(128, 3, 'bases', 60),
    generated(128, 4, 'choke', 30),
    generated(128, 5, 'open', 120),
    generated(128, 6, 'bases', 0),
  ];
  const hr = createStandaloneNav(hollowRidge()).nav;
  // windows of hollow-ridge: NW plateau + ramps, the lake with a ford, a mesa
  out.push({ name: 'hollow-ridge NW', nav: hr, rect: [40, 40, 168, 168] });
  out.push({ name: 'hollow-ridge ford', nav: hr, rect: [290, 90, 418, 218] });
  out.push({ name: 'hollow-ridge mesa', nav: hr, rect: [60, 190, 188, 318] });
  return out;
}

/** Checks the reconstructed path of the last search: valid moves inside the rect, summed cost. */
function checkPath(nav: Nav, cls: number, start: number, goal: number, cost: number, rect: readonly number[]): void {
  const st = nav.st;
  const cells = new Int32Array(st.n);
  const n = reconstruct(st, goal, cells);
  expect(cells[0]).toBe(start);
  expect(cells[n - 1]).toBe(goal);
  let sum = 0;
  for (let i = 1; i < n; i++) {
    const a = cells[i - 1]!;
    const b = cells[i]!;
    const dx = (b & st.mask) - (a & st.mask);
    const dz = (b >> st.shift) - (a >> st.shift);
    expect(Math.abs(dx) <= 1 && Math.abs(dz) <= 1 && (dx !== 0 || dz !== 0)).toBe(true);
    expect(st.clear[b]!).toBeGreaterThanOrEqual(cls);
    const x = b & st.mask;
    const z = b >> st.shift;
    expect(x >= rect[0]! && x < rect[2]! && z >= rect[1]! && z < rect[3]!).toBe(true);
    const diag = dx !== 0 && dz !== 0;
    if (diag) {
      expect(st.clear[a + dx]!).toBeGreaterThanOrEqual(cls);
      expect(st.clear[a + dz * st.size]!).toBeGreaterThanOrEqual(cls);
    }
    sum += stepCost(st, a, b, diag);
  }
  expect(sum).toBe(cost);
}

describe('fine A* == Dijkstra', () => {
  it('in ≥ 10,000 cases (all classes, reachable and unreachable)', () => {
    const cfgs = configs();
    let cases = 0;
    let unreachable = 0;
    let checkedPaths = 0;
    for (let ci = 0; ci < cfgs.length; ci++) {
      const { nav, rect, name } = cfgs[ci]!;
      const st = nav.st;
      const [x0, z0, x1, z1] = rect;
      const rnd = testRng(1000 + ci);
      const cell = (): number => {
        const x = x0 + (rnd() % (x1 - x0));
        const z = z0 + (rnd() % (z1 - z0));
        return (z << st.shift) | x;
      };
      for (let cls = 1; cls <= 3; cls++) {
        for (let s = 0; s < 8; s++) {
          // mostly passable sources (a blocked source is a trivial case, include a few)
          let src = cell();
          for (let k = 0; k < 20 && s > 0 && st.clear[src]! < cls; k++) src = cell();
          const ref = refDijkstra(st.clear, st.terrain, st.size, cls, src, x0, z0, x1, z1);
          for (let g = 0; g < 48; g++) {
            const goal = cell();
            const cost = fineSearch(st, cls, src, goal, x0, z0, x1, z1, 0);
            const want = ref[goal]!;
            if (cost !== want) throw new Error(`${name} cls ${cls}: ${src} → ${goal}: A* ${cost} != Dijkstra ${want}`);
            cases++;
            if (want < 0) unreachable++;
            else if (g % 8 === 0) {
              checkPath(nav, cls, src, goal, cost, rect);
              checkedPaths++;
            }
          }
        }
      }
    }
    expect(cases).toBeGreaterThanOrEqual(10_000);
    // a real share of unreachable/blocked cases and of checked paths
    expect(unreachable).toBeGreaterThan(500);
    expect(unreachable).toBeLessThan(cases / 2);
    expect(checkedPaths).toBeGreaterThan(500);
  });

  it('Dijkstra mode reaches exactly the target costs of the reference', () => {
    const { nav } = generated(128, 9, 'bases', 50);
    const st = nav.st;
    const rnd = testRng(77);
    for (let rep = 0; rep < 20; rep++) {
      const cls = 1 + (rep % 3);
      let src = rnd() % st.n;
      while (st.clear[src]! < cls) src = rnd() % st.n;
      const ref = refDijkstra(st.clear, st.terrain, st.size, cls, src, 0, 0, st.size, st.size);
      const nt = 1 + (rep % 16);
      for (let k = 0; k < nt; k++) navScratch.targets[k] = rnd() % st.n;
      fineSearch(st, cls, src, -1, 0, 0, st.size, st.size, nt);
      const targets = Array.from(navScratch.targets.subarray(0, nt));
      for (const t of targets) expect(searchCost(t), `target ${t}`).toBe(ref[t]); // −1 both if unreachable
      // full Dijkstra (no targets): every cell equals the reference
      fineSearch(st, cls, src, -1, 0, 0, st.size, st.size, 0);
      for (let c = 0; c < st.n; c += 7) expect(searchCost(c)).toBe(ref[c]);
    }
  });
});
