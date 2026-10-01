import { describe, expect, it } from 'vitest';
import { createStandaloneNav, fineSearch, hpaSearch, searchCost, type Nav } from '../src/index.ts';
import { generateNavTestMap } from '../bench/testmap.ts';
import { hollowRidge, testRng } from './helpers.ts';

// MS3 acceptance: HPA* costs ≤ 1.10 × optimum in ≥ 95 % of ≥ 2,000 cases on 512- and 1,024-WU
// 'bases' maps (bases stamped) and hollow-ridge. Optimum = fine search over the whole map (Dijkstra
// mode of the same fine search, which equals A* – see astar.test.ts – and yields all goals of a
// source at once).

interface Result {
  readonly ratios: number[];
  readonly noRoute: number;
}

function runCases(name: string, nav: Nav, sources: number, goalsPerSource: number, seed: number): Result {
  const st = nav.st;
  const rnd = testRng(seed);
  const ratios: number[] = [];
  let noRoute = 0;
  const opt = new Int32Array(goalsPerSource);
  const goals = new Int32Array(goalsPerSource);
  for (let s = 0; s < sources; s++) {
    const cls = 1 + (s % 3);
    let src = rnd() % st.n;
    while (st.clear[src]! < cls) src = rnd() % st.n;
    const label = st.comp[(cls - 1) * st.n + src]!;
    fineSearch(st, cls, src, -1, 0, 0, st.size, st.size, 0);
    for (let g = 0; g < goalsPerSource; g++) {
      let goal = rnd() % st.n;
      while (st.comp[(cls - 1) * st.n + goal] !== label) goal = rnd() % st.n;
      goals[g] = goal;
      opt[g] = searchCost(goal);
    }
    for (let g = 0; g < goalsPerSource; g++) {
      const o = opt[g]!;
      expect(o, `${name}: optimum must exist inside one component`).toBeGreaterThanOrEqual(0);
      const h = hpaSearch(st, cls, src, goals[g]!);
      if (h < 0) {
        noRoute++; // served by the fine-A* fallback of the PathService
        continue;
      }
      expect(h, `${name}: HPA* below the optimum`).toBeGreaterThanOrEqual(o);
      ratios.push(o === 0 ? 1 : h / o);
    }
  }
  return { ratios, noRoute };
}

function quantile(sorted: readonly number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}

describe('HPA* suboptimality', () => {
  it('≤ 1.10 × optimum in ≥ 95 % of ≥ 2,000 cases (512/1,024 bases, hollow-ridge)', () => {
    const all: number[] = [];
    let noRoute = 0;
    const lines: string[] = [];
    const record = (name: string, r: Result): void => {
      const s = r.ratios.slice().sort((a, b) => a - b);
      const within = s.filter((x) => x <= 1.1).length;
      lines.push(
        `${name}: n=${s.length} p50=${quantile(s, 0.5).toFixed(4)} p95=${quantile(s, 0.95).toFixed(4)} max=${s[s.length - 1]!.toFixed(4)} ≤1.10: ${((100 * within) / s.length).toFixed(1)} % noRoute=${r.noRoute}`,
      );
      all.push(...r.ratios);
      noRoute += r.noRoute;
    };
    for (const [size, seed, sources, goals] of [
      [512, 3, 8, 100],
      [1024, 1, 8, 125],
    ] as const) {
      const m = generateNavTestMap({ sizeWu: size, seed, kind: 'bases' });
      const { nav } = createStandaloneNav(m);
      for (const f of m.baseFootprints) nav.stampFootprint(f.x, f.z, f.w, f.h, 1);
      record(`bases-${size}`, runCases(`bases-${size}`, nav, sources, goals, seed));
    }
    record('hollow-ridge', runCases('hollow-ridge', createStandaloneNav(hollowRidge()).nav, 6, 60, 99));
    const s = all.slice().sort((a, b) => a - b);
    const within = s.filter((x) => x <= 1.1).length;
    lines.push(`total: n=${s.length} p50=${quantile(s, 0.5).toFixed(4)} p95=${quantile(s, 0.95).toFixed(4)} p99=${quantile(s, 0.99).toFixed(4)} max=${s[s.length - 1]!.toFixed(4)} ≤1.10: ${((100 * within) / s.length).toFixed(2)} %`);
    console.log(`HPA* / optimum distribution\n  ${lines.join('\n  ')}`);
    expect(s.length).toBeGreaterThanOrEqual(2000);
    expect(within / s.length).toBeGreaterThanOrEqual(0.95);
    // dropped portals are rare: the fallback covers < 1 % of the cases
    expect(noRoute).toBeLessThan(s.length / 100);
  });
});
