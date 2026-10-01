/**
 * M6 HPA* (PLAN §3.8): abstract A* over the portal nodes of a class with temporary insertion of
 * start and goal. Start and goal are connected to the nodes of their sectors by A* searches bounded
 * to the sector (plus a direct start → goal edge when both share a sector), evaluated lazily:
 * start nodes enter the open list with the octile lower bound of their leg and are re-keyed with
 * the exact leg when popped; goal legs are computed when a goal-sector node is expanded. Lower
 * bounds keep the search exact. Node ids are
 * sector · 16 + slot; the virtual goal is numSectors · 16. Tie-break f → h → id. Integer costs.
 */

import {
  NAV_CLASSES,
  NAV_COMP_OVERFLOW,
  NAV_EDGE_SLOTS,
  NAV_NO_EDGE,
  NAV_NODE_SLOTS,
  NAV_PORTALS_PER_EDGE,
  NAV_SECTOR_SIZE,
} from './constants.ts';
import { levelOctile, neighbourSector, oppositeEdge, pairIndex } from './graph.ts';
import { nextAGen, S } from './scratch.ts';
import { fineSearch, lastExpansions, octile, stepCost } from './search.ts';
import type { NavState } from './state.ts';

/** Result details of the last hpaSearch. */
export const hpa = {
  /** Nodes of the route in S.aPath[0, nodes). */
  nodes: 0,
  /** Cost of the goal leg (last node → goal), −1 if the route is the direct start → goal edge. */
  legCost: -1,
  /** Cell expansions (sector legs) plus abstract node expansions. */
  expansions: 0,
  /** Abstract node expansions alone. */
  abstractExpansions: 0,
};

let aN = 0;

/** PAIR[i·16 + j] = pairIndex(i, j) for i ≠ j. */
const PAIR = new Int32Array(NAV_NODE_SLOTS * NAV_NODE_SLOTS);
for (let i = 0; i < NAV_NODE_SLOTS; i++) {
  for (let j = 0; j < NAV_NODE_SLOTS; j++) if (i !== j) PAIR[i * NAV_NODE_SLOTS + j] = pairIndex(i, j);
}

function aSiftUp(pos: number): void {
  const heap = rHeap;
  const hpos = rPos;
  const F = rF;
  const G = rG;
  const c = heap[pos]!;
  const fc = F[c]!;
  const hc = fc - G[c]!;
  while (pos > 0) {
    const pp = (pos - 1) >> 1;
    const p = heap[pp]!;
    const fp = F[p]!;
    if (fc > fp) break;
    if (fc === fp) {
      const hp = fp - G[p]!;
      if (hc > hp || (hc === hp && c > p)) break;
    }
    heap[pos] = p;
    hpos[p] = pos;
    pos = pp;
  }
  heap[pos] = c;
  hpos[c] = pos;
}

function aPop(): number {
  const heap = rHeap;
  const hpos = rPos;
  const F = rF;
  const G = rG;
  const top = heap[0]!;
  const n = --aN;
  if (n > 0) {
    const c = heap[n]!;
    const fc = F[c]!;
    const hc = fc - G[c]!;
    let pos = 0;
    for (;;) {
      const l = 2 * pos + 1;
      if (l >= n) break;
      let m = l;
      let mc = heap[l]!;
      let fm = F[mc]!;
      let hm = fm - G[mc]!;
      if (l + 1 < n) {
        const rc = heap[l + 1]!;
        const fr = F[rc]!;
        const hr = fr - G[rc]!;
        if (fr < fm || (fr === fm && (hr < hm || (hr === hm && rc < mc)))) {
          m = l + 1;
          mc = rc;
          fm = fr;
          hm = hr;
        }
      }
      if (fm > fc || (fm === fc && (hm > hc || (hm === hc && mc >= c)))) break;
      heap[pos] = mc;
      hpos[mc] = pos;
      pos = m;
    }
    heap[pos] = c;
    hpos[c] = pos;
  }
  return top;
}

let gGen = 0;
let gGoalX = 0;
let gGoalZ = 0;
let gVG = 0;

let rMark = S.aMark;
let rG = S.aG;
let rF = S.aF;
let rPar = S.aPar;
let rHeap = S.aHeap;
let rPos = S.aPos;
let rMask = 0;
let rShift = 0;

/** Relaxes abstract node v (cell `cell`, −1 for the virtual goal) with g = ng from `parent`. */
function relax(v: number, cell: number, ng: number, parent: number): void {
  const mv = rMark[v]!;
  if (mv === gGen + 1) return;
  if (mv === gGen) {
    const og = rG[v]!;
    if (ng >= og) return;
    rF[v] = rF[v]! - og + ng;
    rG[v] = ng;
    rPar[v] = parent;
    aSiftUp(rPos[v]!);
    return;
  }
  rMark[v] = gGen;
  rG[v] = ng;
  rF[v] = cell < 0 ? ng : ng + octile((cell & rMask) - gGoalX, (cell >> rShift) - gGoalZ);
  rPar[v] = parent;
  rHeap[aN] = v;
  rPos[v] = aN;
  aN++;
  aSiftUp(aN - 1);
}

/** A compact per-expanded-node loop, shared by every route's exact intra-sector relaxation. */
function relaxSector(st: NavState, cls: number, u: number, cellBase: number, sector: number, slot: number, g: number): void {
  const nodes = st.nodes;
  const edges = st.edges;
  const eb = (sector * NAV_CLASSES + cls - 1) * NAV_EDGE_SLOTS;
  const row = slot << 4;
  const secBase = sector << 4;
  const closed = gGen + 1;
  for (let v = 0; v < NAV_NODE_SLOTS; v++) {
    if (v === slot) continue;
    const cv = nodes[cellBase + v]!;
    if (cv < 0) continue;
    const w = edges[eb + PAIR[row + v]!]!;
    if (w === NAV_NO_EDGE) continue;
    const id = secBase | v;
    const mv = rMark[id]!;
    if (mv === closed) continue;
    const ng = g + w;
    if (mv === gGen) {
      const og = rG[id]!;
      if (ng >= og) continue;
      rF[id] = rF[id]! - og + ng;
      rG[id] = ng;
      rPar[id] = u;
      aSiftUp(rPos[id]!);
      continue;
    }
    rMark[id] = gGen;
    rG[id] = ng;
    rF[id] = ng + octile((cv & rMask) - gGoalX, (cv >> rShift) - gGoalZ);
    rPar[id] = u;
    rHeap[aN] = id;
    rPos[id] = aN;
    aN++;
    aSiftUp(aN - 1);
  }
}

/** Seed the same start-sector portal nodes, using exact uniform legs or lazy lower bounds. */
function seedStartSector(st: NavState, cls: number, start: number, secS: number): void {
  const comp = st.comp;
  const coff = (cls - 1) * st.n;
  const label = comp[coff + start]!;
  const sx = start & rMask;
  const sz = start >> rShift;
  const nbS = (secS * NAV_CLASSES + cls - 1) * NAV_NODE_SLOTS;
  const levelS = st.secInfo[secS * NAV_CLASSES + cls - 1]!;
  const nodes = st.nodes;
  const legS = S.legStart;
  const legG = S.legGoal;
  for (let k = 0; k < NAV_NODE_SLOTS; k++) {
    legG[k] = LEG_UNKNOWN;
    const c = nodes[nbS + k]!;
    if (c < 0 || (label !== NAV_COMP_OVERFLOW && comp[coff + c] !== label)) {
      legS[k] = -1;
      continue;
    }
    if (levelS >= 0) {
      legS[k] = levelOctile(levelS, (c & rMask) - sx, (c >> rShift) - sz);
      relax(secS * NAV_NODE_SLOTS + k, c, legS[k]!, -1);
    } else {
      legS[k] = LEG_UNKNOWN;
      relax(secS * NAV_NODE_SLOTS + k, c, octile((c & rMask) - sx, (c >> rShift) - sz), -1);
    }
  }
}

/** Successors of one closed portal; lazy goal legs keep their original exact costs. */
function expandPortal(st: NavState, cls: number, u: number, cellU: number, goal: number, secG: number, levelG: number): void {
  const sec = u >> 4;
  const slot = u & 15;
  const g = rG[u]!;
  relaxSector(st, cls, u, (sec * NAV_CLASSES + cls - 1) * NAV_NODE_SLOTS, sec, slot, g);
  const e = slot >> 2;
  const nsec = neighbourSector(st, sec, e);
  if (nsec >= 0) {
    const pslot = oppositeEdge(e) * NAV_PORTALS_PER_EDGE + (slot & 3);
    const pc = st.nodes[(nsec * NAV_CLASSES + cls - 1) * NAV_NODE_SLOTS + pslot]!;
    if (pc >= 0) relax(nsec * NAV_NODE_SLOTS + pslot, pc, g + stepCost(st, cellU, pc, false), u);
  }
  if (sec !== secG) return;
  let leg = S.legGoal[slot]!;
  if (leg === LEG_UNKNOWN) {
    if (levelG >= 0) {
      leg = levelOctile(levelG, (cellU & rMask) - gGoalX, (cellU >> rShift) - gGoalZ);
    } else {
      const gx0 = st.sectorX0(secG);
      const gz0 = st.sectorZ0(secG);
      leg = fineSearch(st, cls, cellU, goal, gx0, gz0, gx0 + NAV_SECTOR_SIZE, gz0 + NAV_SECTOR_SIZE, 0);
      hpa.expansions += lastExpansions;
    }
    S.legGoal[slot] = leg;
  }
  if (leg >= 0) relax(gVG, -1, g + leg, u);
}

/**
 * Abstract search from `start` to `goal` (both passable for `cls`). Returns the route cost or −1.
 * On success the node ids of the route are in S.aPath[0, hpa.nodes).
 */
export function hpaSearch(st: NavState, cls: number, start: number, goal: number): number {
  hpa.nodes = 0;
  hpa.legCost = -1;
  hpa.expansions = 0;
  const nodes = st.nodes;
  const secS = st.sectorOf(start);
  const secG = st.sectorOf(goal);
  const legS = S.legStart;
  const mask = st.mask;
  const shift = st.shift;
  const sx0 = st.sectorX0(secS);
  const sz0 = st.sectorZ0(secS);
  let direct = -1;
  if (secS === secG) {
    const lv = st.secInfo[secS * NAV_CLASSES + cls - 1]!;
    if (lv >= 0) {
      direct = levelOctile(lv, (goal & mask) - (start & mask), (goal >> shift) - (start >> shift));
    } else {
      direct = fineSearch(st, cls, start, goal, sx0, sz0, sx0 + NAV_SECTOR_SIZE, sz0 + NAV_SECTOR_SIZE, 0);
      hpa.expansions += lastExpansions;
    }
  }
  // abstract A*
  gGen = nextAGen();
  gGoalX = goal & mask;
  gGoalZ = goal >> shift;
  gVG = st.numSectors * NAV_NODE_SLOTS;
  aN = 0;
  rMark = S.aMark;
  rG = S.aG;
  rF = S.aF;
  rPar = S.aPar;
  rHeap = S.aHeap;
  rPos = S.aPos;
  rMask = mask;
  rShift = shift;
  const VG = gVG;
  // Start legs are evaluated lazily: every start-sector node of the start's component is seeded
  // with the octile lower bound and gets its exact leg (A* inside the sector) when popped.
  const levelG = st.secInfo[secG * NAV_CLASSES + cls - 1]!;
  seedStartSector(st, cls, start, secS);
  if (direct >= 0) relax(VG, -1, direct, -1);
  let exp = 0;
  let found = false;
  const aMark = S.aMark;
  const aG = S.aG;
  const closed = gGen + 1;
  while (aN > 0) {
    const u = aPop();
    exp++;
    if (u === VG) {
      aMark[u] = closed;
      found = true;
      break;
    }
    const sec = u >> 4;
    const slot = u & 15;
    const nb = (sec * NAV_CLASSES + cls - 1) * NAV_NODE_SLOTS;
    const cellU = nodes[nb + slot]!;
    if (sec === secS && S.aPar[u] === -1 && legS[slot] === LEG_UNKNOWN) {
      const leg = fineSearch(st, cls, start, cellU, sx0, sz0, sx0 + NAV_SECTOR_SIZE, sz0 + NAV_SECTOR_SIZE, 0);
      hpa.expansions += lastExpansions;
      legS[slot] = leg;
      if (leg < 0) {
        aMark[u] = 0; // no leg: only reachable through other nodes
        continue;
      }
      if (leg > aG[u]!) {
        aMark[u] = 0;
        relax(u, cellU, leg, -1);
        continue;
      }
    }
    aMark[u] = closed;
    expandPortal(st, cls, u, cellU, goal, secG, levelG);
  }
  hpa.expansions += exp;
  hpa.abstractExpansions = exp;
  if (!found) return -1;
  // reconstruct (without VG)
  let n = 0;
  let v = S.aPar[VG]!;
  while (v >= 0) {
    S.aPath[n++] = v;
    v = S.aPar[v]!;
  }
  for (let i = 0, j = n - 1; i < j; i++, j--) {
    const t = S.aPath[i]!;
    S.aPath[i] = S.aPath[j]!;
    S.aPath[j] = t;
  }
  hpa.nodes = n;
  hpa.legCost = n > 0 ? aG[VG]! - aG[S.aPath[n - 1]!]! : -1;
  return aG[VG]!;
}

/** Marker of a leg that has not been evaluated yet. */
const LEG_UNKNOWN = -2;

/** Cell of abstract node id `v` for class `cls`. */
export function nodeCell(st: NavState, cls: number, v: number): number {
  return st.nodes[((v >> 4) * NAV_CLASSES + cls - 1) * NAV_NODE_SLOTS + (v & 15)]!;
}
