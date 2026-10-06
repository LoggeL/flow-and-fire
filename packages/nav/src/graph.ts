/**
 * M6 sector/portal graph (HPA*, PLAN §3.8): 32×32 sectors (= grid chunks). For every sector edge
 * with a neighbour and every class, the edge is scanned for maximal runs of positions where the
 * cell on both sides is passable for the class. Each run gets a portal in its middle; runs longer
 * than 16 cells get two (at ¼ and ¾ of the run). At most 4 portals per edge and class are kept
 * (longest runs first, ties by position); the fine-A* fallback keeps completeness if one is
 * dropped. Node slot = edge · 4 + k (edge N 0, E 1, S 2, W 3; k in position order), so the partner
 * across the edge is slot opposite(edge) · 4 + k of the neighbour — computed identically from both
 * sides.
 *
 * Intra-sector edges: optimal cost between every pair of nodes of a (sector, class), found by a
 * search bounded to the sector (A* per pair of nodes in the same sector-local component). Shortcuts with identical results: a fully passable sector with
 * one cost level uses the weighted octile distance (exact there); a class with the same passable
 * cells and nodes as the class below copies its costs.
 */

import {
  NAV_CLASSES,
  NAV_COST_DIAG,
  NAV_COST_ORTH,
  NAV_EDGE_SLOTS,
  NAV_LONG_RUN,
  NAV_NO_EDGE,
  NAV_NODE_SLOTS,
  NAV_PORTALS_PER_EDGE,
  NAV_SECTOR_SHIFT,
  NAV_SECTOR_SIZE,
  NAV_SURCHARGE_DIAG,
  NAV_SURCHARGE_ORTH,
} from './constants.ts';
import { S } from './scratch.ts';
import { DIR_X, DIR_Z, fineSearch } from './search.ts';
import type { NavState } from './state.ts';

const SEC = NAV_SECTOR_SIZE;

/** Index of the unordered pair (i, j), i ≠ j, in the 120-entry upper triangle. */
export function pairIndex(i: number, j: number): number {
  const a = i < j ? i : j;
  const b = i < j ? j : i;
  return ((a * (2 * NAV_NODE_SLOTS - 1 - a)) >> 1) + b - a - 1;
}

/** Node base index of (sector, class) in st.nodes. */
export function nodeBase(sec: number, cls: number): number {
  return (sec * NAV_CLASSES + cls - 1) * NAV_NODE_SLOTS;
}

/** Edge base index of (sector, class) in st.edges. */
export function edgeBase(sec: number, cls: number): number {
  return (sec * NAV_CLASSES + cls - 1) * NAV_EDGE_SLOTS;
}

/** Intra cost between slots i and j of (sector, class) from its edge base; −1 if none. */
export function intraCost(st: NavState, eb: number, i: number, j: number): number {
  if (i === j) return 0;
  const v = st.edges[eb + pairIndex(i, j)]!;
  return v === NAV_NO_EDGE ? -1 : v;
}

/** Neighbour sector across edge e (0 N, 1 E, 2 S, 3 W) or −1 at the map border. */
export function neighbourSector(st: NavState, sec: number, e: number): number {
  const spe = st.secPerEdge;
  const sx = sec & (spe - 1);
  const sz = sec >> st.secShift;
  switch (e) {
    case 0:
      return sz > 0 ? sec - spe : -1;
    case 1:
      return sx < spe - 1 ? sec + 1 : -1;
    case 2:
      return sz < spe - 1 ? sec + spe : -1;
    default:
      return sx > 0 ? sec - 1 : -1;
  }
}

/** Opposite edge. */
export function oppositeEdge(e: number): number {
  return (e + 2) & 3;
}

/** Computes the (up to 4) portal cells of edge e of a sector for a class into S.pick; returns count. */
function edgePortals(st: NavState, sec: number, e: number, cls: number): number {
  if (neighbourSector(st, sec, e) < 0) return 0;
  const size = st.size;
  const clear = st.clear;
  const x0 = st.sectorX0(sec);
  const z0 = st.sectorZ0(sec);
  // own cell of position p and the step to the partner cell
  let own0: number;
  let stepAlong: number;
  let toPartner: number;
  switch (e) {
    case 0:
      own0 = z0 * size + x0;
      stepAlong = 1;
      toPartner = -size;
      break;
    case 1:
      own0 = z0 * size + x0 + SEC - 1;
      stepAlong = size;
      toPartner = 1;
      break;
    case 2:
      own0 = (z0 + SEC - 1) * size + x0;
      stepAlong = 1;
      toPartner = size;
      break;
    default:
      own0 = z0 * size + x0;
      stepAlong = size;
      toPartner = -1;
      break;
  }
  const runPos = S.runPos;
  const runLen = S.runLen;
  let nc = 0; // candidate portals: position in runPos, run length in runLen
  let p = 0;
  while (p < SEC) {
    const c = own0 + p * stepAlong;
    if (clear[c]! < cls || clear[c + toPartner]! < cls) {
      p++;
      continue;
    }
    const start = p;
    while (p < SEC) {
      const q = own0 + p * stepAlong;
      if (clear[q]! < cls || clear[q + toPartner]! < cls) break;
      p++;
    }
    const len = p - start;
    if (len > NAV_LONG_RUN) {
      runPos[nc] = start + (len >> 2);
      runLen[nc++] = len;
      runPos[nc] = start + len - 1 - (len >> 2);
      runLen[nc++] = len;
    } else {
      runPos[nc] = start + ((len - 1) >> 1);
      runLen[nc++] = len;
    }
  }
  const pick = S.pick;
  if (nc <= NAV_PORTALS_PER_EDGE) {
    for (let k = 0; k < nc; k++) pick[k] = own0 + runPos[k]! * stepAlong;
    return nc;
  }
  // Keep the 4 best (longest run, then smaller position), output in position order.
  let kept = 0;
  for (let r = 0; r < NAV_PORTALS_PER_EDGE; r++) {
    let best = -1;
    for (let k = 0; k < nc; k++) {
      const l = runLen[k]!;
      if (l < 0) continue;
      if (best < 0 || l > runLen[best]! || (l === runLen[best]! && runPos[k]! < runPos[best]!)) best = k;
    }
    runLen[best] = -runLen[best]! - 1; // mark as picked (negative)
    kept++;
  }
  let o = 0;
  for (let k = 0; k < nc; k++) {
    if (runLen[k]! < 0) pick[o++] = own0 + runPos[k]! * stepAlong;
  }
  return kept;
}

/**
 * Optimal cost of (dx, dz) through a fully passable area with uniform cost level `level`: steps
 * cost 10 + 4k / 14 + 6k, so the weighted octile distance is exact.
 */
export function levelOctile(level: number, dx: number, dz: number): number {
  const ax = dx < 0 ? -dx : dx;
  const az = dz < 0 ? -dz : dz;
  const mn = ax < az ? ax : az;
  const mx = ax < az ? az : ax;
  return (NAV_COST_ORTH + 2 * NAV_SURCHARGE_ORTH * level) * (mx - mn) + (NAV_COST_DIAG + 2 * NAV_SURCHARGE_DIAG * level) * mn;
}

/** Per-sector statistics of one build: passable cells per class and uniform cost level. */
const secCnt = new Int32Array(NAV_CLASSES + 1);

/**
 * Scans a sector once: secCnt[c] = cells with clearance ≥ c (c = 1..3); returns the common cost
 * level of all cells if they share one (terrain ≥ 1), else −1.
 */
function scanSector(st: NavState, sec: number): number {
  const size = st.size;
  const clear = st.clear;
  const terrain = st.terrain;
  const x0 = st.sectorX0(sec);
  const z0 = st.sectorZ0(sec);
  let c1 = 0;
  let c2 = 0;
  let c3 = 0;
  const t0 = terrain[z0 * size + x0]!;
  let uniform = t0 !== 0;
  for (let z = z0; z < z0 + SEC; z++) {
    const row = z * size;
    for (let x = x0; x < x0 + SEC; x++) {
      const c = row + x;
      const v = clear[c]!;
      if (v >= 1) c1++;
      if (v >= 2) c2++;
      if (v >= 3) c3++;
      if (terrain[c] !== t0) uniform = false;
    }
  }
  secCnt[1] = c1;
  secCnt[2] = c2;
  secCnt[3] = c3;
  return uniform ? t0 - 1 : -1;
}

function sameNodes(nodes: Int32Array, a: number, b: number): boolean {
  for (let k = 0; k < NAV_NODE_SLOTS; k++) if (nodes[a + k] !== nodes[b + k]) return false;
  return true;
}

/**
 * Rebuilds nodes and intra edges of (sector, class). `level` = uniform cost level of the sector or
 * −1 (from scanSector, which must have run for this sector).
 */
function buildSectorClass(st: NavState, sec: number, cls: number, level: number): void {
  const nb = nodeBase(sec, cls);
  const eb = edgeBase(sec, cls);
  const nodes = st.nodes;
  const edges = st.edges;
  for (let e = 0; e < 4; e++) {
    const cnt = edgePortals(st, sec, e, cls);
    for (let k = 0; k < NAV_PORTALS_PER_EDGE; k++) nodes[nb + e * NAV_PORTALS_PER_EDGE + k] = k < cnt ? S.pick[k]! : -1;
  }
  const shift = st.shift;
  const mask = st.mask;
  const x0 = st.sectorX0(sec);
  const z0 = st.sectorZ0(sec);
  const open = secCnt[cls] === SEC * SEC && level >= 0;
  st.secInfo[sec * NAV_CLASSES + cls - 1] = open ? level : -1;
  if (open) {
    // fully passable with one cost level: the optimum is the weighted octile distance
    edges.fill(NAV_NO_EDGE, eb, eb + NAV_EDGE_SLOTS);
    for (let i = 0; i < NAV_NODE_SLOTS; i++) {
      const a = nodes[nb + i]!;
      if (a < 0) continue;
      for (let j = i + 1; j < NAV_NODE_SLOTS; j++) {
        const b = nodes[nb + j]!;
        if (b < 0) continue;
        let dx = (a & mask) - (b & mask);
        let dz = (a >> shift) - (b >> shift);
        if (dx < 0) dx = -dx;
        if (dz < 0) dz = -dz;
        edges[eb + pairIndex(i, j)] = levelOctile(level, dx, dz);
      }
    }
    return;
  }
  if (cls > 1 && secCnt[cls] === secCnt[cls - 1] && sameNodes(nodes, nb, nodeBase(sec, cls - 1))) {
    // same passable cells and nodes as the class below ⇒ identical intra costs
    const pb = edgeBase(sec, cls - 1);
    edges.copyWithin(eb, pb, pb + NAV_EDGE_SLOTS);
    return;
  }
  edges.fill(NAV_NO_EDGE, eb, eb + NAV_EDGE_SLOTS);
  // Sector-local components: pairs in different local components have no intra edge; all other
  // pairs get an A* bounded to the sector (directed, far fewer expansions than a full Dijkstra).
  localComponents(st, sec, cls);
  const loc = S.loc;
  for (let i = 0; i < NAV_NODE_SLOTS - 1; i++) {
    const a = nodes[nb + i]!;
    if (a < 0) continue;
    const la = loc[(((a >> shift) - z0) << NAV_SECTOR_SHIFT) | ((a & mask) - x0)]!;
    for (let j = i + 1; j < NAV_NODE_SLOTS; j++) {
      const b = nodes[nb + j]!;
      if (b < 0 || loc[(((b >> shift) - z0) << NAV_SECTOR_SHIFT) | ((b & mask) - x0)] !== la) continue;
      const c = fineSearch(st, cls, a, b, x0, z0, x0 + SEC, z0 + SEC, 0);
      if (c >= 0) edges[eb + pairIndex(i, j)] = c;
    }
  }
}

/** Labels the components of a sector for a class (same moves as the fine search) into S.loc. */
function localComponents(st: NavState, sec: number, cls: number): void {
  const size = st.size;
  const clear = st.clear;
  const x0 = st.sectorX0(sec);
  const z0 = st.sectorZ0(sec);
  const loc = S.loc;
  const q = S.locQueue;
  loc.fill(0);
  let label = 0;
  for (let li = 0; li < SEC * SEC; li++) {
    if (loc[li] !== 0) continue;
    const gx = x0 + (li & (SEC - 1));
    const gz = z0 + (li >> NAV_SECTOR_SHIFT);
    if (clear[gz * size + gx]! < cls) continue;
    label++;
    loc[li] = label;
    let head = 0;
    let tail = 0;
    q[tail++] = li;
    while (head < tail) {
      const cur = q[head++]!;
      const lx = cur & (SEC - 1);
      const lz = cur >> NAV_SECTOR_SHIFT;
      const c = (z0 + lz) * size + x0 + lx;
      for (let d = 0; d < 8; d++) {
        const nx = lx + DIR_X[d]!;
        const nz = lz + DIR_Z[d]!;
        if (nx < 0 || nx >= SEC || nz < 0 || nz >= SEC) continue;
        const nl = (nz << NAV_SECTOR_SHIFT) | nx;
        if (loc[nl] !== 0) continue;
        if (clear[c + DIR_X[d]! + DIR_Z[d]! * size]! < cls) continue;
        if (d >= 4 && (clear[c + DIR_X[d]!]! < cls || clear[c + DIR_Z[d]! * size]! < cls)) continue;
        loc[nl] = label;
        q[tail++] = nl;
      }
    }
  }
}

/**
 * Rebuilds the graph of one sector for the classes in `classMask` (bit c − 1 = class c), in
 * ascending class order. Classes not in the mask must be up to date.
 */
export function buildSector(st: NavState, sec: number, classMask: number): void {
  const level = scanSector(st, sec);
  for (let c = 1; c <= NAV_CLASSES; c++) if ((classMask & (1 << (c - 1))) !== 0) buildSectorClass(st, sec, c, level);
}

/** Rebuilds the whole graph. */
export function rebuildGraph(st: NavState): void {
  const all = (1 << NAV_CLASSES) - 1;
  for (let s = 0; s < st.numSectors; s++) buildSector(st, s, all);
}

/** Slot of `cell` among the nodes of (sector, class), or −1. */
export function findNodeSlot(nodes: Int32Array, nb: number, cell: number): number {
  for (let k = 0; k < NAV_NODE_SLOTS; k++) if (nodes[nb + k] === cell) return k;
  return -1;
}
