import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { COMP_META_WORDS, createStandaloneNav, NAV_CLASSES, PATH_READY, type StandaloneNav } from '../src/index.ts';
import { generateNavTestMap } from '../bench/testmap.ts';
import { bruteClearance, bruteComponents, derivedBytes, firstDiffs, testRng } from './helpers.ts';

// M5: clearance and components against brute force; M5/M6 local updates (stampFootprint) are
// bit-identical to rebuildDerived() from scratch (fast-check property).

function expectMatchesBruteForce(sn: StandaloneNav): void {
  const st = sn.nav.st;
  const clear = bruteClearance(st.terrain, st.foot, st.size);
  let diff = -1;
  for (let i = 0; i < st.n; i++) {
    if (clear[i] !== st.clear[i]) {
      diff = i;
      break;
    }
  }
  expect(diff, 'first clearance mismatch').toBe(-1);
  for (let c = 1; c <= NAV_CLASSES; c++) {
    const { labels, count } = bruteComponents(st.clear, st.size, c);
    const off = (c - 1) * st.n;
    let d = -1;
    for (let i = 0; i < st.n; i++) {
      if (labels[i] !== st.comp[off + i]) {
        d = i;
        break;
      }
    }
    expect(d, `class ${c}: first label mismatch`).toBe(-1);
    const mo = (c - 1) * COMP_META_WORDS;
    expect(st.compMeta[mo]).toBe(count);
    // smallest cell per label
    const mins = new Int32Array(count + 1).fill(-1);
    for (let i = 0; i < st.n; i++) {
      const l = labels[i]!;
      if (l !== 0 && mins[l] === -1) mins[l] = i;
    }
    for (let l = 1; l <= count; l++) expect(st.compMeta[mo + l]).toBe(mins[l]);
  }
}

function expectRebuildEqual(sn: StandaloneNav, what: string): void {
  const before = derivedBytes(sn.regions);
  sn.nav.rebuildDerived();
  const after = derivedBytes(sn.regions);
  const d = firstDiffs(before, after);
  for (const k of Object.keys(d)) expect(d[k], `${what}: region ${k} differs at byte`).toBe(-1);
}

describe('clearance and components', () => {
  it('match the brute-force definitions on generated maps with footprints', () => {
    for (const [size, kind, seed] of [
      [128, 'bases', 1],
      [128, 'choke', 2],
      [64, 'open', 3],
    ] as const) {
      const sn = createStandaloneNav(generateNavTestMap({ sizeWu: size, seed, kind }));
      expectMatchesBruteForce(sn);
      const rnd = testRng(seed);
      for (let i = 0; i < 40; i++) {
        const w = 1 + (rnd() % 7);
        const h = 1 + (rnd() % 7);
        sn.nav.stampFootprint(rnd() % size, rnd() % size, w, h, 1);
      }
      expectMatchesBruteForce(sn);
    }
  });

  it('labels are canonical: an isolated pocket gets its rank by smallest cell', () => {
    const sn = createStandaloneNav(generateNavTestMap({ sizeWu: 64, seed: 5, kind: 'open' }));
    // wall a 3×3 pocket at (10..12, 10..12) with a 1-cell ring → the pocket becomes label 1 (min cell)
    const nav = sn.nav;
    nav.stampFootprint(9, 9, 5, 1, 1);
    nav.stampFootprint(9, 13, 5, 1, 1);
    nav.stampFootprint(9, 10, 1, 3, 1);
    nav.stampFootprint(13, 10, 1, 3, 1);
    expect(nav.componentAt(1, 11, 11)).toBe(2); // main area starts at cell (1, 1) → label 1
    expect(nav.componentAt(1, 30, 30)).toBe(1);
    expectMatchesBruteForce(sn);
    // open it again → one component
    nav.stampFootprint(13, 10, 1, 3, -1);
    expect(nav.componentAt(1, 11, 11)).toBe(1);
    expectMatchesBruteForce(sn);
    expectRebuildEqual(sn, 'reopen');
  });
});

interface Op {
  readonly x: number;
  readonly z: number;
  readonly w: number;
  readonly h: number;
  /** remove the k-th live stamp instead (if any) */
  readonly remove: number;
}

const opArb = (size: number): fc.Arbitrary<Op> =>
  fc.record({
    x: fc.integer({ min: -4, max: size - 1 }),
    z: fc.integer({ min: -4, max: size - 1 }),
    w: fc.integer({ min: 1, max: 12 }),
    h: fc.integer({ min: 1, max: 12 }),
    remove: fc.integer({ min: -3, max: 7 }),
  });

function runOps(sn: StandaloneNav, ops: readonly Op[], checkEach: boolean): void {
  const live: Op[] = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!;
    if (op.remove >= 0 && live.length > 0) {
      const k = op.remove % live.length;
      const r = live.splice(k, 1)[0]!;
      sn.nav.stampFootprint(r.x, r.z, r.w, r.h, -1);
    } else {
      sn.nav.stampFootprint(op.x, op.z, op.w, op.h, 1);
      live.push(op);
    }
    if (checkEach) expectRebuildEqual(sn, `after op ${i}`);
  }
  expectRebuildEqual(sn, 'end');
}

describe('stampFootprint local updates == rebuildDerived (property)', () => {
  it('random stamp/unstamp sequences on a 128-WU bases map (checked after every step)', () => {
    const base = createStandaloneNav(generateNavTestMap({ sizeWu: 128, seed: 11, kind: 'bases' }));
    const snap = base.arena.snapshot();
    fc.assert(
      fc.property(fc.array(opArb(128), { minLength: 1, maxLength: 16 }), (ops) => {
        base.arena.restore(snap);
        runOps(base, ops, true);
      }),
      { numRuns: 40, seed: 0x5eed },
    );
  });

  it('random sequences on a 256-WU bases map with live paths (corridor index included)', () => {
    const base = createStandaloneNav(generateNavTestMap({ sizeWu: 256, seed: 12, kind: 'bases' }));
    const nav = base.nav;
    const rnd = testRng(3);
    for (let i = 0; i < 30; i++) {
      const sx = 4 + (rnd() % 248);
      const sz = 4 + (rnd() % 248);
      const tx = 4 + (rnd() % 248);
      const tz = 4 + (rnd() % 248);
      nav.request(i, 0, 1 + (i % 3), sx * 4096, sz * 4096, tx * 4096, tz * 4096);
    }
    nav.serviceTick(1e9);
    let ready = 0;
    for (let p = 0; p < 30; p++) if (nav.pathState(p) === PATH_READY) ready++;
    expect(ready).toBeGreaterThan(20);
    const snap = base.arena.snapshot();
    fc.assert(
      fc.property(fc.array(opArb(256), { minLength: 1, maxLength: 24 }), (ops) => {
        base.arena.restore(snap);
        runOps(base, ops, false);
      }),
      { numRuns: 30, seed: 0xbeef },
    );
  });

  it('large footprints (64×64) and stacking (refcounts) stay exact', () => {
    const sn = createStandaloneNav(generateNavTestMap({ sizeWu: 256, seed: 13, kind: 'open' }));
    const nav = sn.nav;
    nav.stampFootprint(40, 40, 64, 64, 1);
    nav.stampFootprint(60, 60, 20, 20, 1);
    expectRebuildEqual(sn, 'stacked');
    nav.stampFootprint(40, 40, 64, 64, -1);
    expect(nav.footprintAt(70, 70)).toBe(1);
    expect(nav.isPassable(1, 70, 70)).toBe(false);
    expect(nav.isPassable(1, 45, 45)).toBe(true);
    expectRebuildEqual(sn, 'unstacked');
    nav.stampFootprint(60, 60, 20, 20, -1);
    nav.stampFootprint(60, 60, 20, 20, -1); // saturates at 0
    expect(nav.footprintAt(70, 70)).toBe(0);
    expectRebuildEqual(sn, 'cleared');
    expectMatchesBruteForce(sn);
  });
});
