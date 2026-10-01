import { describe, expect, it } from 'vitest';
import {
  createStandaloneNav,
  PATH_DIRECT,
  PATH_READY,
  WP_END,
  WP_LAST,
  WP_NEED_REFINE,
  WP_NONE,
  WP_OK,
  WP_PENDING,
} from '../src/index.ts';
import { hollowRidge, flatMap } from './helpers.ts';

const FX = 4096;

// pointAt / remainingPoints(skip) / pathPrev: random access for consumers sharing one path (sim
// group moves, MS3). Checked against the sequential waypoint/advance/refineNext protocol.
describe('pointAt (shared path cursor)', () => {
  it('equals the sequential waypoint sequence, WP_LAST on the final point, WP_NEED_REFINE at the refined end', () => {
    const { nav } = createStandaloneNav(hollowRidge());
    // NW plateau → SE plateau: a long HPA* route with several unrefined segments.
    const p = nav.request(1, 0, 2, 110 * FX, 110 * FX, 400 * FX, 400 * FX);
    const out = new Int32Array(2);
    expect(nav.pointAt(p, 0, out)).toBe(WP_PENDING);
    nav.serviceTick(1_000_000);
    expect(nav.pathState(p)).toBe(PATH_READY);
    // Refine everything, then compare random access with the sequential protocol.
    const seq: number[] = [];
    for (let guard = 0; guard < 10_000; guard++) {
      const left = nav.refinedLeft(p);
      let r = nav.pointAt(p, left, out);
      if (r === WP_NEED_REFINE) {
        nav.refineNext(p, 1);
        continue;
      }
      expect(r).toBe(WP_END);
      for (let k = 0; k < left; k++) {
        r = nav.pointAt(p, k, out);
        expect(r).toBe(k === left - 1 ? WP_LAST : WP_OK);
        seq.push(out[0]!, out[1]!);
      }
      break;
    }
    expect(seq.length).toBeGreaterThan(4);
    // remainingPoints with skip agrees.
    const buf = new Int32Array(512);
    const n = nav.remainingPoints(p, buf, 256, 3);
    expect(n).toBe(seq.length / 2 - 3);
    expect(Array.from(buf.subarray(0, 2 * n))).toEqual(seq.slice(6));
    // Sequential consumption: waypoint/advance see the same points; pathPrev follows.
    for (let k = 0; k < seq.length / 2; k++) {
      expect(nav.pointAt(p, 0, out)).toBe(k === seq.length / 2 - 1 ? WP_LAST : WP_OK);
      expect([out[0], out[1]]).toEqual([seq[2 * k], seq[2 * k + 1]]);
      nav.advance(p);
      nav.pathPrev(p, out);
      expect([out[0], out[1]]).toEqual([seq[2 * k], seq[2 * k + 1]]);
    }
    expect(nav.pointAt(p, 0, out)).toBe(WP_END);
    expect(nav.pointAt(p, -1, out)).toBe(WP_END);
    nav.release(p);
  });

  it('lazy route: points beyond the refined part report WP_NEED_REFINE with the next abstract point', () => {
    const { nav } = createStandaloneNav(hollowRidge());
    const p = nav.request(1, 0, 1, 110 * FX, 110 * FX, 402 * FX, 402 * FX);
    nav.serviceTick(1_000_000);
    const out = new Int32Array(2);
    const left = nav.refinedLeft(p);
    expect(left).toBeGreaterThan(0);
    expect(nav.pointAt(p, left - 1, out)).toBe(WP_OK);
    expect(nav.pointAt(p, left, out)).toBe(WP_NEED_REFINE);
    // the fallback point lies on the map (a node cell centre)
    expect(out[0]! % FX).toBe(2048);
    expect(nav.pointAt(p, left + 5, out)).toBe(WP_NEED_REFINE);
  });

  it('direct paths: the single point is the goal (WP_LAST); failed/free paths: WP_NONE', () => {
    const { nav } = createStandaloneNav(flatMap(128));
    const p = nav.request(1, 0, 1, 40 * FX, 40 * FX, 50 * FX + 17, 45 * FX + 3);
    nav.serviceTick(100);
    expect(nav.pathState(p)).toBe(PATH_DIRECT);
    const out = new Int32Array(2);
    expect(nav.pointAt(p, 0, out)).toBe(WP_LAST);
    expect([out[0], out[1]]).toEqual([50 * FX + 17, 45 * FX + 3]);
    expect(nav.pointAt(p, 1, out)).toBe(WP_END);
    nav.cancel(p);
    expect(nav.pointAt(p, 0, out)).toBe(WP_NONE);
  });
});
