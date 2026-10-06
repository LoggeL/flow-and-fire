import { createRtsMap, mapSimData } from '@faf/formats';
import { XxHash32 } from '@faf/fixed';
import { ArenaBuilder, fullHash as fullHashOf, ruleHash as ruleHashOf, type Arena } from '@faf/heap';
import { describe, expect, it } from 'vitest';
import {
  addNavRegions,
  createStandaloneNav,
  defineNavRegions,
  fineSearch,
  navMemoryBytes,
  Nav,
  PATH_READY,
} from '../src/index.ts';
import { generateNavTestMap } from '../bench/testmap.ts';
import { testRng } from './helpers.ts';

const hasher = new XxHash32();
const ruleHash = (a: Arena): number => ruleHashOf(a, hasher);
const fullHash = (a: Arena): number => fullHashOf(a, hasher);

describe('test map generator (@faf/nav/testmap)', () => {
  it('is deterministic per (size, seed, kind) and seed-dependent', () => {
    for (const kind of ['bases', 'choke', 'open'] as const) {
      const a = generateNavTestMap({ sizeWu: 256, seed: 7, kind });
      const b = generateNavTestMap({ sizeWu: 256, seed: 7, kind });
      const c = generateNavTestMap({ sizeWu: 256, seed: 8, kind });
      expect(a.heights).toEqual(b.heights);
      expect(a.baseFootprints).toEqual(b.baseFootprints);
      if (kind !== 'choke') expect(a.heights).not.toEqual(c.heights);
    }
  });

  it('builds valid formats maps (RtsMap) with the same simulation data', () => {
    for (const kind of ['bases', 'choke', 'open'] as const) {
      const t = generateNavTestMap({ sizeWu: 512, seed: 1, kind });
      const map = createRtsMap({
        name: t.name,
        sizeWu: t.sizeWu,
        heights: t.heights,
        heightScaleRaw: t.heightScaleRaw,
        waterLevelRaw: t.waterLevelRaw,
        starts: t.starts,
      });
      const md = mapSimData(map);
      expect(md.heights).toBe(t.heights);
      expect(md.waterLevelRaw).toBe(t.waterLevelRaw);
      expect(md.starts.length).toBe(t.starts.length);
    }
  });

  it("'choke': one wall with exactly one 3-WU gap (class ≤ 2 passes, class 3 does not)", () => {
    for (const size of [256, 512, 1024]) {
      const t = generateNavTestMap({ sizeWu: size, seed: 3, kind: 'choke' });
      const { nav } = createStandaloneNav(t);
      const ch = t.choke!;
      expect(ch.gapWu).toBe(3);
      // along the wall row, exactly 3 consecutive passable cells
      const row: boolean[] = [];
      for (let x = 0; x < size; x++) row.push(nav.isPassable(1, x, ch.z));
      const open = row.map((v, x) => (v ? x : -1)).filter((x) => x >= 0);
      expect(open).toEqual([ch.x, ch.x + 1, ch.x + 2]);
      const s0 = t.starts[0]!;
      const s1 = t.starts[1]!;
      const a = nav.cellOfFx(s0.x, s0.z);
      const b = nav.cellOfFx(s1.x, s1.z);
      expect(fineSearch(nav.st, 1, a, b, 0, 0, size, size, 0)).toBeGreaterThan(0);
      expect(fineSearch(nav.st, 2, a, b, 0, 0, size, size, 0)).toBeGreaterThan(0);
      expect(nav.componentAt(3, s0.x >> 12, s0.z >> 12)).not.toBe(nav.componentAt(3, s1.x >> 12, s1.z >> 12));
    }
  });

  it("'bases': plateaus, river with fords, chokes; all starts connected for every class with bases stamped", () => {
    for (const size of [256, 512, 1024]) {
      const t = generateNavTestMap({ sizeWu: size, seed: 1, kind: 'bases' });
      expect(t.waterLevelRaw).not.toBeNull();
      expect(t.baseFootprints.length).toBeGreaterThanOrEqual(4 * t.starts.length);
      const { nav } = createStandaloneNav(t);
      for (const f of t.baseFootprints) nav.stampFootprint(f.x, f.z, f.w, f.h, 1);
      let blocked = 0;
      for (let i = 0; i < nav.st.n; i++) if (nav.st.terrain[i] === 0) blocked++;
      expect(blocked).toBeGreaterThan(nav.st.n / 50); // cliffs, river, ridges
      for (let c = 1; c <= 3; c++) {
        const l = nav.componentAt(c, t.starts[0]!.x >> 12, t.starts[0]!.z >> 12);
        expect(l).toBeGreaterThan(0);
        for (const s of t.starts) expect(nav.componentAt(c, s.x >> 12, s.z >> 12), `size ${size} class ${c}`).toBe(l);
      }
    }
  });

  it("'open': gentle, fully connected", () => {
    const t = generateNavTestMap({ sizeWu: 512, seed: 2, kind: 'open' });
    const { nav } = createStandaloneNav(t);
    for (let c = 1; c <= 3; c++) expect(nav.st.compMeta[(c - 1) * 16384]).toBe(1);
  });
});

describe('regions', () => {
  it('static terrain is outside the hashed range, derived regions are only in the full hash', () => {
    const b = new ArenaBuilder();
    const regions = addNavRegions(b, defineNavRegions(256));
    const arena = b.build();
    const nav = new Nav(regions);
    nav.precomputeStatic(generateNavTestMap({ sizeWu: 256, seed: 1, kind: 'bases' }));
    nav.rebuildDerived();
    expect(regions.terrain.area).toBe('static');
    for (const r of [regions.clear, regions.comp, regions.compMeta, regions.secInfo, regions.nodes, regions.edges, regions.back]) {
      expect(r.derived).toBe(true);
      expect(r.area).toBe('dynamic');
    }
    for (const r of [regions.foot, regions.paths, regions.blocks, regions.fifo, regions.ctr]) expect(r.derived).toBe(false);
    const rule0 = ruleHash(arena);
    const full0 = fullHash(arena);
    const flip = (a: Uint8Array, i: number): void => {
      a[i] = a[i]! ^ 1;
    };
    // derived change: full hash only
    flip(regions.clear.u8, 1000);
    expect(ruleHash(arena)).toBe(rule0);
    expect(fullHash(arena)).not.toBe(full0);
    flip(regions.clear.u8, 1000);
    // static change: neither
    flip(regions.terrain.u8, 1000);
    expect(ruleHash(arena)).toBe(rule0);
    expect(fullHash(arena)).toBe(full0);
    flip(regions.terrain.u8, 1000);
    // rule state: footprint
    nav.stampFootprint(50, 50, 2, 2, 1);
    expect(ruleHash(arena)).not.toBe(rule0);
  });

  it('snapshot/restore round-trips paths and derived regions (no rebuild needed)', () => {
    const sn = createStandaloneNav(generateNavTestMap({ sizeWu: 256, seed: 4, kind: 'bases' }));
    const { nav, arena } = sn;
    const rnd = testRng(4);
    for (let i = 0; i < 20; i++) nav.request(i, 0, 1 + (i % 3), (5 + (rnd() % 240)) * 4096, (5 + (rnd() % 240)) * 4096, (5 + (rnd() % 240)) * 4096, (5 + (rnd() % 240)) * 4096);
    nav.serviceTick(1e9);
    const states = Array.from({ length: 20 }, (_, p) => nav.pathState(p));
    expect(states.filter((x) => x === PATH_READY).length).toBeGreaterThan(10);
    const snap = arena.snapshot();
    const h = fullHash(arena);
    nav.stampFootprint(100, 100, 10, 10, 1);
    for (let p = 0; p < 20; p++) nav.release(p);
    arena.restore(snap);
    expect(fullHash(arena)).toBe(h);
    expect(Array.from({ length: 20 }, (_, p) => nav.pathState(p))).toEqual(states);
  });

  it('documents the memory budget (MiB) for 512 and 1,024 WU', () => {
    const m512 = navMemoryBytes(512);
    const m1024 = navMemoryBytes(1024);
    console.log(`nav memory: 512 WU ${(m512.total / 1048576).toFixed(2)} MiB, 1,024 WU ${(m1024.total / 1048576).toFixed(2)} MiB`);
    expect(m1024.total).toBeLessThanOrEqual(12 * 1048576);
  });
});
