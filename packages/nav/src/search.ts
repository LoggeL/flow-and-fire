/**
 * Fine search on the 1-WU cell grid (PLAN §3.8): octile moves, no corner cutting, integer costs,
 * binary heap on an Int32Array with decrease-key, tie-break f → h → cell index, optionally bounded
 * to a rectangle (sector, sector pair, map). A* (octile heuristic, consistent ⇒ optimal) or
 * Dijkstra (h = 0) with a set of target cells.
 *
 * Step cost a → b: orthogonal 10 + 2·(ka + kb), diagonal 14 + 3·(ka + kb), k = cost level 0..3
 * of a cell (terrain − 1). Costs are symmetric. A cell is passable for class s iff clearance ≥ s; a
 * diagonal step additionally needs both orthogonal neighbours passable (no corner cutting).
 *
 * Allocation-free: all arrays are module scratch (scratch.ts), valid until the next search.
 */

import { NAV_COST_DIAG, NAV_COST_ORTH, NAV_SURCHARGE_DIAG, NAV_SURCHARGE_ORTH } from './constants.ts';
import { nextGen, S } from './scratch.ts';
import type { NavState } from './state.ts';

/** Move directions: 4 orthogonal, then 4 diagonal. */
export const DIR_X = new Int8Array([1, -1, 0, 0, 1, -1, 1, -1]);
export const DIR_Z = new Int8Array([0, 0, 1, -1, 1, 1, -1, -1]);

/** Expansions (closed cells) of the last search. */
export let lastExpansions = 0;

let heapN = 0;

/** Octile distance in cost units. */
export function octile(dx: number, dz: number): number {
  const ax = dx < 0 ? -dx : dx;
  const az = dz < 0 ? -dz : dz;
  return ax > az ? NAV_COST_ORTH * ax + (NAV_COST_DIAG - NAV_COST_ORTH) * az : NAV_COST_ORTH * az + (NAV_COST_DIAG - NAV_COST_ORTH) * ax;
}

/** Cost of one step between two neighbouring passable cells (diagonal flag). */
export function stepCost(st: NavState, a: number, b: number, diagonal: boolean): number {
  const k = st.terrain[a]! + st.terrain[b]! - 2;
  return diagonal ? NAV_COST_DIAG + NAV_SURCHARGE_DIAG * k : NAV_COST_ORTH + NAV_SURCHARGE_ORTH * k;
}

function before(a: number, b: number, F: Int32Array, G: Int32Array): boolean {
  const fa = F[a]!;
  const fb = F[b]!;
  if (fa !== fb) return fa < fb;
  const ha = fa - G[a]!;
  const hb = fb - G[b]!;
  if (ha !== hb) return ha < hb;
  return a < b;
}

function siftUp(pos: number, heap: Int32Array, hpos: Int32Array, F: Int32Array, G: Int32Array): void {
  const c = heap[pos]!;
  while (pos > 0) {
    const pp = (pos - 1) >> 1;
    const p = heap[pp]!;
    if (!before(c, p, F, G)) break;
    heap[pos] = p;
    hpos[p] = pos;
    pos = pp;
  }
  heap[pos] = c;
  hpos[c] = pos;
}

function popMin(heap: Int32Array, hpos: Int32Array, F: Int32Array, G: Int32Array): number {
  const top = heap[0]!;
  const n = --heapN;
  if (n > 0) {
    const c = heap[n]!;
    let pos = 0;
    for (;;) {
      const l = 2 * pos + 1;
      if (l >= n) break;
      let m = l;
      const r = l + 1;
      if (r < n && before(heap[r]!, heap[l]!, F, G)) m = r;
      const mc = heap[m]!;
      if (!before(mc, c, F, G)) break;
      heap[pos] = mc;
      hpos[mc] = pos;
      pos = m;
    }
    heap[pos] = c;
    hpos[c] = pos;
  }
  return top;
}

/**
 * Fine search from `start` restricted to cells with x0 ≤ x < x1, z0 ≤ z < z1.
 *  - `goal ≥ 0`: A* to `goal`; returns its cost or −1 (unreachable inside the rectangle).
 *  - `goal = −1`: Dijkstra; stops once `nTargets` cells of `S.targets` (marked in S.tmark) are closed
 *    or the open set is empty (duplicates count once); returns the number of distinct targets
 *    reached. Costs via `searchCost`.
 * `start` must be passable for `cls` (else −1 / 0). Expansions in `lastExpansions`.
 */
export function fineSearch(
  st: NavState,
  cls: number,
  start: number,
  goal: number,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  nTargets: number,
): number {
  const gen = nextGen();
  const closed = gen + 1;
  lastExpansions = 0;
  heapN = 0;
  const clear = st.clear;
  if (clear[start]! < cls) return goal >= 0 ? -1 : 0;
  const terrain = st.terrain;
  const shift = st.shift;
  const mask = st.mask;
  const size = st.size;
  const G = S.G;
  const F = S.F;
  const mark = S.mark;
  const heap = S.heap;
  const hpos = S.hpos;
  const par = S.par;
  const tmark = S.tmark;
  const gx = goal >= 0 ? goal & mask : 0;
  const gz = goal >= 0 ? goal >> shift : 0;
  const useH = goal >= 0;
  let targetsLeft = nTargets;
  if (!useH) {
    const t = S.targets;
    for (let i = 0; i < nTargets; i++) {
      const c = t[i]!;
      if (tmark[c] === gen) targetsLeft--;
      else tmark[c] = gen;
    }
  }
  let reached = 0;

  const sx = start & mask;
  const sz = start >> shift;
  mark[start] = gen;
  G[start] = 0;
  F[start] = useH ? octile(sx - gx, sz - gz) : 0;
  par[start] = 255;
  heap[0] = start;
  hpos[start] = 0;
  heapN = 1;
  let exp = 0;

  while (heapN > 0) {
    const c = popMin(heap, hpos, F, G);
    mark[c] = closed;
    exp++;
    const g = G[c]!;
    if (useH) {
      if (c === goal) {
        lastExpansions = exp;
        return g;
      }
    } else if (tmark[c] === gen) {
      reached++;
      if (--targetsLeft <= 0) break;
    }
    const x = c & mask;
    const z = c >> shift;
    const kc = terrain[c]! - 2;
    for (let d = 0; d < 8; d++) {
      const nx = x + DIR_X[d]!;
      const nz = z + DIR_Z[d]!;
      if (nx < x0 || nx >= x1 || nz < z0 || nz >= z1) continue;
      const j = (nz << shift) | nx;
      if (clear[j]! < cls) continue;
      const mj = mark[j]!;
      if (mj === closed) continue;
      let cost: number;
      if (d >= 4) {
        if (clear[c + DIR_X[d]!]! < cls || clear[c + DIR_Z[d]! * size]! < cls) continue;
        cost = NAV_COST_DIAG + NAV_SURCHARGE_DIAG * (kc + terrain[j]!);
      } else {
        cost = NAV_COST_ORTH + NAV_SURCHARGE_ORTH * (kc + terrain[j]!);
      }
      const ng = g + cost;
      if (mj === gen) {
        if (ng >= G[j]!) continue;
        F[j] = F[j]! - G[j]! + ng;
        G[j] = ng;
        par[j] = d;
        siftUp(hpos[j]!, heap, hpos, F, G);
      } else {
        mark[j] = gen;
        G[j] = ng;
        F[j] = useH ? ng + octile(nx - gx, nz - gz) : ng;
        par[j] = d;
        heap[heapN] = j;
        hpos[j] = heapN;
        heapN++;
        siftUp(heapN - 1, heap, hpos, F, G);
      }
    }
  }
  lastExpansions = exp;
  return useH ? -1 : reached;
}

/** Cost of `cell` in the last search if it was closed (final), else −1. */
export function searchCost(cell: number): number {
  return S.mark[cell] === S.gen2 + 1 ? S.G[cell]! : -1;
}

/**
 * Writes the cells of the last search's path start → `end` into `out` (start first) and returns the
 * count. `end` must have been closed by the last search.
 */
export function reconstruct(st: NavState, end: number, out: Int32Array): number {
  const par = S.par;
  const size = st.size;
  let n = 0;
  let c = end;
  for (;;) {
    out[n++] = c;
    const d = par[c]!;
    if (d === 255) break;
    c = c - DIR_X[d]! - DIR_Z[d]! * size;
  }
  // reverse
  for (let i = 0, j = n - 1; i < j; i++, j--) {
    const t = out[i]!;
    out[i] = out[j]!;
    out[j] = t;
  }
  return n;
}
