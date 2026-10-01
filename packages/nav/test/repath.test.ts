import { describe, expect, it } from 'vitest';
import { createStandaloneNav, PATH_DIRECT, PATH_F_REPATH, PATH_READY, WP_NEED_REFINE, WP_OK } from '../src/index.ts';
import { generateNavTestMap } from '../bench/testmap.ts';
import { copyNavGraph, corridorCutBrute } from '../bench/corridor-check.ts';
import { testRng } from './helpers.ts';

// Corridor repath (PLAN §3.8, MS3 acceptance "Repath-Sturm"): 200 paths, 20 random footprints ⇒ the
// set of paths marked by stampFootprint equals a brute-force evaluation of the documented rule
// (docs/status/ms3-p0-nav.md, "Korridorregel"), written independently in bench/corridor-check.ts
// (shared with the sim golden `obstacle-repath`):
//  (a) refined part: a supercover cell of the remaining polyline (previous waypoint → waypoints)
//      lies within Chebyshev distance cls of the footprint;
//  (b) unrefined part, consecutive abstract cells a → b (starting at refCell):
//      - same sector: the graph of that sector changed and a or b is no longer a node of the class,
//        or the intra cost a → b is missing or higher than before;
//      - adjacent sectors (portal): a graph changed and a/b are no longer partner nodes;
//      - last step to the goal (goal leg): the footprint expanded by cls touches the goal sector
//        and the best route a → goal inside that sector is missing or dearer than the stored leg.

const FX = 4096;

describe('corridor repath', () => {
  it('200 paths, 20 random footprints ⇒ marked set == brute-force corridor rule', () => {
    const m = generateNavTestMap({ sizeWu: 512, seed: 10, kind: 'bases' });
    const { nav } = createStandaloneNav(m);
    for (const f of m.baseFootprints) nav.stampFootprint(f.x, f.z, f.w, f.h, 1);
    const rnd = testRng(10);
    const ids: number[] = [];
    // paths between the bases and random points (many through the base areas and chokes)
    for (let i = 0; i < 200; i++) {
      const s = m.starts[i % m.starts.length]!;
      const t = m.starts[(i + 1 + (i % 3)) % m.starts.length]!;
      const sx = s.x + ((rnd() % 41) - 20) * FX;
      const sz = s.z + ((rnd() % 41) - 20) * FX;
      const tx = i % 4 === 0 ? (5 + (rnd() % 500)) * FX : t.x + ((rnd() % 41) - 20) * FX;
      const tz = i % 4 === 0 ? (5 + (rnd() % 500)) * FX : t.z + ((rnd() % 41) - 20) * FX;
      ids.push(nav.request(i, 0, 1 + (i % 3), sx, sz, tx, tz));
    }
    nav.serviceTick(1e9);
    const out = new Int32Array(2);
    // advance some paths so there are consumed waypoints, refined and unrefined parts
    for (const p of ids) {
      const steps = rnd() % 6;
      for (let k = 0; k < steps; k++) {
        const w = nav.waypoint(p, out);
        if (w === WP_OK) nav.advance(p);
        else if (w === WP_NEED_REFINE) nav.refineNext(p, 1);
      }
    }
    let totalMarked = 0;
    let totalExpected = 0;
    let candidatesChecked = 0;
    for (let f = 0; f < 20; f++) {
      // footprint near the remaining route of a random path
      const p0 = ids[rnd() % ids.length]!;
      const d0 = nav.pathDebug(p0);
      const pts = d0.waypoints.length > 0 ? d0.waypoints : [d0.prevX, d0.prevZ];
      const k = (rnd() % (pts.length / 2)) * 2;
      const w = 3 + (rnd() % 6);
      const h = 3 + (rnd() % 6);
      const x = Math.floor(pts[k]! / FX) + (rnd() % 9) - 4 - (w >> 1);
      const z = Math.floor(pts[k + 1]! / FX) + (rnd() % 9) - 4 - (h >> 1);
      const before = ids.map((p) => nav.pathDebug(p));
      const flagsBefore = ids.map((p) => nav.pathFlags(p));
      const og = copyNavGraph(nav);
      const counterBefore = nav.repathsTriggered;
      const marked = nav.stampFootprint(x, z, w, h, 1);
      const ng = copyNavGraph(nav);
      const fr: [number, number, number, number] = [Math.max(0, x), Math.max(0, z), Math.min(512, x + w), Math.min(512, z + h)];
      let expected = 0;
      for (let i = 0; i < ids.length; i++) {
        const p = ids[i]!;
        const d = before[i]!;
        const eligible = (d.state === PATH_READY || d.state === PATH_DIRECT) && (flagsBefore[i]! & PATH_F_REPATH) === 0;
        const want = eligible && corridorCutBrute(nav, d, fr, og, ng);
        const got = eligible && (nav.pathFlags(p) & PATH_F_REPATH) !== 0;
        if (eligible) candidatesChecked++;
        expect(got, `footprint ${f} (${x}, ${z}, ${w}×${h}), path ${p}`).toBe(want);
        if (want) expected++;
      }
      expect(marked).toBe(expected);
      expect(nav.repathsTriggered - counterBefore).toBe(expected);
      totalMarked += marked;
      totalExpected += expected;
      // repath the marked ones from their previous waypoint (new request, same goal)
      for (const p of ids) {
        if (nav.needsRepath(p)) {
          const d = nav.pathDebug(p);
          nav.repath(p, d.prevX, d.prevZ, f + 1);
          expect(nav.needsRepath(p)).toBe(false);
        }
      }
      nav.serviceTick(1e9);
    }
    console.log(`corridor repath: ${totalMarked} marks over 20 footprints (${candidatesChecked} path checks)`);
    expect(totalMarked).toBe(totalExpected);
    // the storm test is meaningful: some footprints hit, most paths stay untouched
    expect(totalMarked).toBeGreaterThan(10);
    expect(totalMarked).toBeLessThan(20 * 200 * 0.5);
  });

  it('removing footprints never marks paths', () => {
    const m = generateNavTestMap({ sizeWu: 256, seed: 2, kind: 'open' });
    const { nav } = createStandaloneNav(m);
    nav.stampFootprint(100, 100, 8, 8, 1);
    const p = nav.request(1, 0, 1, 20 * FX, 104 * FX, 200 * FX, 104 * FX);
    nav.serviceTick(1e9);
    expect(nav.stampFootprint(100, 100, 8, 8, -1)).toBe(0);
    expect(nav.needsRepath(p)).toBe(false);
    // a footprint on the route marks it
    const d = nav.pathDebug(p);
    const wx = Math.floor(d.waypoints[0]! / FX);
    const wz = Math.floor(d.waypoints[1]! / FX);
    expect(nav.stampFootprint(wx - 1, wz - 1, 3, 3, 1)).toBe(1);
    expect(nav.needsRepath(p)).toBe(true);
  });
});
