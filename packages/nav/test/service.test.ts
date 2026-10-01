import { describe, expect, it } from 'vitest';
import {
  createStandaloneNav,
  NAV_BUDGET_EXPANSIONS_PER_TICK,
  PATH_CANCELLED,
  PATH_DIRECT,
  PATH_F_RETARGETED,
  PATH_F_START_MOVED,
  PATH_FAILED,
  PATH_PENDING,
  PATH_READY,
  COMP_META_WORDS,
  nearestInComponent,
  SPIRAL_LABEL,
  SPIRAL_PASSABLE,
  spiralSearch,
  WP_END,
  WP_NEED_REFINE,
  WP_OK,
  WP_PENDING,
  type Nav,
  type StandaloneNav,
} from '../src/index.ts';
import { generateNavTestMap } from '../bench/testmap.ts';
import { flatMap, geometricSupercover, hollowRidge, testRng } from './helpers.ts';

const FX = 4096;
const C = (v: number): number => v * FX + FX / 2;

/** Walks a path to its end: returns the waypoints (Fx pairs) in order. */
function walk(nav: Nav, p: number): number[] {
  const out = new Int32Array(2);
  const pts: number[] = [];
  for (let guard = 0; guard < 100_000; guard++) {
    const r = nav.waypoint(p, out);
    if (r === WP_OK) {
      pts.push(out[0]!, out[1]!);
      nav.advance(p);
    } else if (r === WP_NEED_REFINE) {
      expect(nav.refineNext(p, 1)).toBeGreaterThan(0);
    } else {
      expect(r).toBe(WP_END);
      return pts;
    }
  }
  throw new Error('walk did not end');
}

function bases(size: number, seed: number): StandaloneNav {
  const m = generateNavTestMap({ sizeWu: size, seed, kind: 'bases' });
  const sn = createStandaloneNav(m);
  for (const f of m.baseFootprints) sn.nav.stampFootprint(f.x, f.z, f.w, f.h, 1);
  return sn;
}

describe('PathService FIFO and budget', () => {
  it('serves requests in (issueTick, entityIdx) order, stable for equal keys', () => {
    const { nav } = createStandaloneNav(flatMap(128));
    const keys: [number, number][] = [
      [5, 3],
      [2, 9],
      [5, 1],
      [2, 9],
      [0, 50],
      [5, 3],
      [2, 1],
    ];
    const ids = keys.map(([tick, e], i) => nav.request(e, tick, 1, C(10 + i), C(10), C(100), C(100 - i)));
    const expected = ids
      .map((id, i) => ({ id, i, t: keys[i]![0], e: keys[i]![1] }))
      .sort((a, b) => a.t - b.t || a.e - b.e || a.i - b.i)
      .map((x) => x.id);
    const served: number[] = [];
    while (nav.pendingCount > 0) {
      const before = ids.filter((p) => nav.pathState(p) === PATH_PENDING);
      nav.serviceTick(1); // budget 1: exactly one request per call
      const after = ids.filter((p) => nav.pathState(p) === PATH_PENDING);
      expect(before.length - after.length).toBe(1);
      served.push(before.find((p) => !after.includes(p))!);
    }
    expect(served).toEqual(expected);
    expect(nav.requestsIssued).toBe(7);
    expect(nav.requestsDone).toBe(7);
  });

  it('stops once the budget is used; a started request always completes', () => {
    const sn = bases(512, 4);
    const { nav, arena } = sn;
    const rnd = testRng(4);
    const req = (): number[] => {
      const out: number[] = [];
      for (let i = 0; i < 40; i++) out.push(nav.request(i, 0, 1 + (i % 3), C(5 + (rnd() % 500)), C(5 + (rnd() % 500)), C(5 + (rnd() % 500)), C(5 + (rnd() % 500))));
      return out;
    };
    const snap = arena.snapshot();
    // expansions per request, one at a time
    req();
    const each: number[] = [];
    while (nav.pendingCount > 0) each.push(nav.serviceTick(1));
    arena.restore(snap);
    const r2 = testRng(4);
    void r2;
    // same requests again (same RNG sequence)
    const rnd2 = testRng(4);
    for (let i = 0; i < 40; i++) nav.request(i, 0, 1 + (i % 3), C(5 + (rnd2() % 500)), C(5 + (rnd2() % 500)), C(5 + (rnd2() % 500)), C(5 + (rnd2() % 500)));
    for (const budget of [5000, 20000, 1]) {
      const pendingBefore = nav.pendingCount;
      const done = 40 - pendingBefore;
      const used = nav.serviceTick(budget);
      const doneNow = 40 - nav.pendingCount - done;
      // processed exactly while the sum stayed below the budget
      let sum = 0;
      let k = 0;
      while (done + k < 40 && sum < budget) sum += each[done + k++]!;
      expect(doneNow).toBe(k);
      expect(used).toBe(sum);
      expect(nav.expansionsLastTick).toBe(used);
    }
  });

  it('the budget constant serves 200 requests on a 1,024-WU bases map in ≤ 10 ticks', () => {
    const sn = bases(1024, 1);
    const { nav } = sn;
    const rnd = testRng(1024);
    for (let i = 0; i < 200; i++) {
      nav.request(i, 0, 1 + (i % 3), C(8 + (rnd() % 1008)), C(8 + (rnd() % 1008)), C(8 + (rnd() % 1008)), C(8 + (rnd() % 1008)));
    }
    let ticks = 0;
    while (nav.pendingCount > 0 && ticks < 50) {
      nav.serviceTick(NAV_BUDGET_EXPANSIONS_PER_TICK);
      ticks++;
    }
    expect(nav.pendingCount).toBe(0);
    expect(ticks).toBeLessThanOrEqual(10);
    expect(nav.requestsDone).toBe(200);
  });
});

describe('paths: states, waypoints, LOS, retarget, spiral', () => {
  it('walks refined paths whose legs keep clearance ≥ class (string pulling with clearance LOS)', () => {
    const sn = bases(512, 5);
    const { nav } = sn;
    const st = nav.st;
    const rnd = testRng(55);
    let walked = 0;
    for (let i = 0; i < 60; i++) {
      const cls = 1 + (i % 3);
      const p = nav.request(i, 0, cls, C(5 + (rnd() % 500)), C(5 + (rnd() % 500)), C(5 + (rnd() % 500)), C(5 + (rnd() % 500)));
      nav.serviceTick(1e9);
      const s = nav.pathState(p);
      expect(s === PATH_READY || s === PATH_DIRECT).toBe(true);
      const startCell = nav.pathStartCell(p);
      const pts = walk(nav, p);
      const goal = new Int32Array(2);
      nav.pathGoal(p, goal);
      expect(pts[pts.length - 2]).toBe(goal[0]);
      expect(pts[pts.length - 1]).toBe(goal[1]);
      // every leg between consecutive waypoints (cells) is clear for the class
      let prev = startCell;
      let first = (nav.pathFlags(p) & PATH_F_START_MOVED) !== 0;
      for (let k = 0; k < pts.length; k += 2) {
        const cell = st.cellOfFx(pts[k]!, pts[k + 1]!);
        if (!first) {
          for (const [x, z] of geometricSupercover(prev & st.mask, prev >> st.shift, cell & st.mask, cell >> st.shift)) {
            expect(st.clear[(z << st.shift) | x]!, `path ${p} leg (${prev} → ${cell}) cell (${x}, ${z})`).toBeGreaterThanOrEqual(cls);
          }
        }
        first = false;
        prev = cell;
      }
      walked++;
      nav.release(p);
    }
    expect(walked).toBe(60);
  });

  it('short paths with free LOS are Direct (no search); others are Ready with lazy refinement', () => {
    const { nav } = createStandaloneNav(flatMap(256));
    const d = nav.request(1, 0, 2, C(40), C(40), C(70), C(52));
    nav.serviceTick(1e9);
    expect(nav.pathState(d)).toBe(PATH_DIRECT);
    expect(nav.expansionsLastTick).toBe(1);
    const out = new Int32Array(2);
    expect(nav.waypoint(d, out)).toBe(WP_OK);
    expect([out[0], out[1]]).toEqual([C(70), C(52)]);
    nav.advance(d);
    expect(nav.waypoint(d, out)).toBe(WP_END);
    // across the map: Ready, first segment refined, the rest on demand
    const r = nav.request(2, 0, 1, C(10), C(10), C(240), C(200));
    expect(nav.waypoint(r, out)).toBe(WP_PENDING);
    nav.serviceTick(1e9);
    expect(nav.pathState(r)).toBe(PATH_READY);
    expect(nav.refinedLeft(r)).toBeGreaterThan(0);
    expect(nav.pathDebug(r).abs.length).toBeGreaterThan(1);
    const pts = walk(nav, r);
    expect(pts.slice(-2)).toEqual([C(240), C(200)]);
  });

  it('unreachable goals are retargeted to the nearest cell of the start component (spiral)', () => {
    const map = hollowRidge();
    const { nav } = createStandaloneNav(map);
    const st = nav.st;
    // goal in the lake (deep water) and on a cliff
    for (const [tx, tz, cls] of [
      [256, 256, 1],
      [300, 240, 3],
      [96, 40, 2],
    ] as const) {
      const p = nav.request(7, 0, cls, C(96), C(96), C(tx), C(tz));
      nav.serviceTick(1e9);
      expect(nav.pathState(p)).toBe(PATH_READY);
      expect(nav.pathFlags(p) & PATH_F_RETARGETED).toBe(PATH_F_RETARGETED);
      const g = nav.pathGoalCell(p);
      const label = nav.componentAt(cls, 96, 96);
      expect(st.comp[(cls - 1) * st.n + g]).toBe(label);
      // nearest by brute force
      let best = Infinity;
      for (let c = 0; c < st.n; c++) {
        if (st.comp[(cls - 1) * st.n + c] !== label) continue;
        const dx = (c & st.mask) - tx;
        const dz = (c >> st.shift) - tz;
        best = Math.min(best, dx * dx + dz * dz);
      }
      const gx = (g & st.mask) - tx;
      const gz = (g >> st.shift) - tz;
      expect(gx * gx + gz * gz).toBe(best);
      const pts = walk(nav, p);
      expect(st.cellOfFx(pts[pts.length - 2]!, pts[pts.length - 1]!)).toBe(g);
    }
    expect(nav.counter(9)).toBe(3);
  });

  it('spiral search == brute-force nearest (passable and by label)', () => {
    const sn = bases(256, 6);
    const st = sn.nav.st;
    const rnd = testRng(6);
    for (let i = 0; i < 200; i++) {
      const cls = 1 + (i % 3);
      const center = rnd() % st.n;
      const byLabel = i % 2 === 0;
      const label = byLabel ? 1 + (rnd() % Math.max(1, st.compMeta[(cls - 1) * 16384]!)) : 0;
      const got = spiralSearch(st, cls, center, byLabel ? SPIRAL_LABEL : SPIRAL_PASSABLE, label, st.size);
      let best = Infinity;
      for (let c = 0; c < st.n; c++) {
        if (st.clear[c]! < cls) continue;
        if (byLabel && st.comp[(cls - 1) * st.n + c] !== label) continue;
        const dx = (c & st.mask) - (center & st.mask);
        const dz = (c >> st.shift) - (center >> st.shift);
        best = Math.min(best, dx * dx + dz * dz);
      }
      if (best === Infinity) {
        expect(got).toBe(-1);
        continue;
      }
      const dx = (got & st.mask) - (center & st.mask);
      const dz = (got >> st.shift) - (center >> st.shift);
      expect(dx * dx + dz * dz).toBe(best);
    }
  });

  it('flooding a small component finds exactly the spiral result (distance, then spiral order)', () => {
    const sn = bases(256, 7);
    const st = sn.nav.st;
    // many small components: chop the map with thin walls
    for (let k = 0; k < 14; k++) sn.nav.stampFootprint(8 + 17 * k, 4, 1, 60, 1);
    for (let k = 0; k < 14; k++) sn.nav.stampFootprint(4, 8 + 17 * k, 60, 1, 1);
    const rnd = testRng(71);
    let compared = 0;
    for (let i = 0; i < 400; i++) {
      const cls = 1 + (i % 3);
      const count = st.compMeta[(cls - 1) * COMP_META_WORDS]!;
      const label = 1 + (rnd() % count);
      const center = rnd() % st.n;
      const minCell = st.compMeta[(cls - 1) * COMP_META_WORDS + label]!;
      const f = nearestInComponent(st, cls, label, center, 1 << 30, minCell);
      const s = spiralSearch(st, cls, center, SPIRAL_LABEL, label, st.size);
      expect(f, `class ${cls} label ${label} centre ${center}`).toBe(s);
      compared++;
    }
    expect(compared).toBe(400);
  });

  it('a blocked start is moved to the nearest passable cell; no passable cell ⇒ Failed', () => {
    const { nav } = createStandaloneNav(flatMap(128));
    nav.stampFootprint(20, 20, 10, 10, 1);
    const p = nav.request(1, 0, 3, C(25), C(25), C(100), C(100));
    nav.serviceTick(1e9);
    expect(nav.pathState(p)).toBe(PATH_READY);
    expect(nav.pathFlags(p) & PATH_F_START_MOVED).toBe(PATH_F_START_MOVED);
    const s = nav.pathStartCell(p);
    expect(nav.st.clear[s]!).toBeGreaterThanOrEqual(3);
    const full = createStandaloneNav(flatMap(64)).nav;
    full.stampFootprint(0, 0, 64, 64, 1);
    const f = full.request(1, 0, 1, C(10), C(10), C(50), C(50));
    full.serviceTick(1e9);
    expect(full.pathState(f)).toBe(PATH_FAILED);
    expect(full.waypoint(f, new Int32Array(2))).toBeLessThan(0);
  });

  it('cancel dequeues, release frees the slot (FIFO reuse)', () => {
    const { nav } = createStandaloneNav(flatMap(128));
    const a = nav.request(1, 0, 1, C(10), C(10), C(100), C(100));
    const b = nav.request(2, 0, 1, C(10), C(10), C(100), C(90));
    expect(nav.pendingCount).toBe(2);
    nav.cancel(a);
    expect(nav.pendingCount).toBe(1);
    expect(nav.pathState(a)).toBe(PATH_CANCELLED);
    nav.serviceTick(1e9);
    expect(nav.pathState(b)).not.toBe(PATH_PENDING);
    nav.release(a);
    nav.release(b);
    expect(nav.st.paths.isLive(a)).toBe(false);
    expect(nav.st.blocks.liveCount).toBe(0);
    const c = nav.request(3, 1, 1, C(10), C(10), C(100), C(100));
    expect(c).toBe(a); // freed slots are reused in free order
    expect(() => nav.release(b)).toThrow();
  });
});

describe('determinism and allocation', () => {
  function scenario(): StandaloneNav {
    const sn = bases(512, 8);
    const { nav } = sn;
    const rnd = testRng(8);
    for (let tick = 0; tick < 30; tick++) {
      for (let k = 0; k < 7; k++) {
        const i = tick * 7 + k;
        nav.request(i % 97, tick, 1 + (i % 3), C(5 + (rnd() % 500)), C(5 + (rnd() % 500)), C(5 + (rnd() % 500)), C(5 + (rnd() % 500)));
      }
      nav.serviceTick(20000);
      if (tick % 5 === 0) nav.stampFootprint(100 + tick * 7, 120 + tick * 3, 3 + (tick % 6), 4, 1);
      for (let p = 0; p < nav.st.paths.highWater; p++) {
        if (!nav.st.paths.isLive(p)) continue;
        const out = new Int32Array(2);
        const w = nav.waypoint(p, out);
        if (w === WP_OK) nav.advance(p);
        else if (w === WP_NEED_REFINE) nav.refineNext(p, 1);
        if (nav.needsRepath(p)) nav.repath(p, out[0]!, out[1]!, tick);
      }
    }
    return sn;
  }

  it('two runs ⇒ byte-identical arenas', () => {
    const a = scenario();
    const b = scenario();
    expect(a.arena.byteLength).toBe(b.arena.byteLength);
    let diff = -1;
    for (let i = 0; i < a.arena.byteLength; i++) {
      if (a.arena.bytes[i] !== b.arena.bytes[i]) {
        diff = i;
        break;
      }
    }
    expect(diff).toBe(-1);
    expect(a.nav.requestsIssued).toBeGreaterThanOrEqual(210);
  });

  it('serviceTick with 200 requests (warm) allocates < 64 KiB', () => {
    const sn = bases(512, 9);
    const { nav, arena } = sn;
    const snap = arena.snapshot();
    const out = new Int32Array(2);
    const starts = new Int32Array(800);
    const rnd = testRng(9);
    for (let i = 0; i < 800; i++) starts[i] = C(5 + (rnd() % 500));
    const cycle = (): void => {
      arena.restore(snap);
      for (let i = 0; i < 200; i++) nav.request(i, 0, 1 + (i % 3), starts[4 * i]!, starts[4 * i + 1]!, starts[4 * i + 2]!, starts[4 * i + 3]!);
      while (nav.pendingCount > 0) nav.serviceTick(NAV_BUDGET_EXPANSIONS_PER_TICK);
      for (let p = 0; p < 200; p++) {
        for (let k = 0; k < 4; k++) {
          const w = nav.waypoint(p, out);
          if (w === WP_OK) nav.advance(p);
          else if (w === WP_NEED_REFINE) nav.refineNext(p, 1);
        }
      }
    };
    cycle();
    cycle();
    const gc = (globalThis as { gc?: () => void }).gc;
    expect(gc, 'run with --expose-gc').toBeDefined();
    gc!();
    const before = process.memoryUsage().heapUsed;
    cycle();
    const after = process.memoryUsage().heapUsed;
    const delta = after - before;
    console.log(`allocation of one warm 200-request cycle: ${delta} B`);
    expect(delta).toBeLessThan(64 * 1024);
  });
});
