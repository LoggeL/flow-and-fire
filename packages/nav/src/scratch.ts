/**
 * Module scratch of the search and update algorithms (PLAN §3.1: state lives in the arena; this is
 * not state). Every array lives only within one call: searches use generation stamps instead of
 * clearing, so no call depends on what an earlier call left behind. The arrays are sized for the
 * largest map seen so far and grow only when a Nav for a larger map is created (setup, never in a
 * tick), which keeps the tick path allocation-free.
 */

import {
  NAV_CLASSES,
  NAV_EDGE_SLOTS,
  NAV_MAX_CLEARANCE,
  NAV_MAX_COMPONENTS,
  NAV_MAX_FOOTPRINT,
  NAV_NODE_SLOTS,
  NAV_SECTOR_SIZE,
} from './constants.ts';

/** Edge of the clearance window around a footprint (footprint + 2 × (14 affected + 15 context) + 2). */
export const WIN_EDGE = NAV_MAX_FOOTPRINT + 4 * NAV_MAX_CLEARANCE + 2;
/** Upper bound of sectors touched by one stamp (window edge / 32 + 2 per axis). */
export const STAMP_MAX_SECTORS = (((WIN_EDGE / NAV_SECTOR_SIZE) | 0) + 3) * (((WIN_EDGE / NAV_SECTOR_SIZE) | 0) + 3);

/** Union-find capacity of a local component update (seeds / labels + pieces around one stamp). */
const UF_CAP = 2 * (WIN_EDGE + 2) * (WIN_EDGE + 2);
/** Entries of one canonical re-ranking (changed components of one stamp). */
const ENTRY_CAP = UF_CAP;

class Scratch {
  cells = 0;
  sectors = 0;
  // Fine search (per cell).
  G = new Int32Array(0);
  F = new Int32Array(0);
  mark = new Int32Array(0);
  tmark = new Int32Array(0);
  heap = new Int32Array(0);
  hpos = new Int32Array(0);
  par = new Uint8Array(0);
  /** Path cells / flood stacks / generic cell lists. */
  list = new Int32Array(0);
  list2 = new Int32Array(0);
  // Abstract search (per node id = sector·16 + slot, plus the virtual goal).
  aG = new Int32Array(0);
  aF = new Int32Array(0);
  aMark = new Int32Array(0);
  aHeap = new Int32Array(0);
  aPos = new Int32Array(0);
  aPar = new Int32Array(0);
  aPath = new Int32Array(0);
  // Sector-sized helpers.
  secMark = new Int32Array(0);
  secList = new Int32Array(0);
  // Fixed-size helpers.
  legStart = new Int32Array(NAV_NODE_SLOTS);
  legGoal = new Int32Array(NAV_NODE_SLOTS);
  targets = new Int32Array(NAV_NODE_SLOTS + 1);
  loc = new Int32Array(NAV_SECTOR_SIZE * NAV_SECTOR_SIZE);
  locQueue = new Int32Array(NAV_SECTOR_SIZE * NAV_SECTOR_SIZE);
  runPos = new Int32Array(NAV_SECTOR_SIZE);
  runLen = new Int32Array(NAV_SECTOR_SIZE);
  pick = new Int32Array(NAV_SECTOR_SIZE);
  win = new Uint8Array(WIN_EDGE * WIN_EDGE);
  chCell = new Int32Array(WIN_EDGE * WIN_EDGE);
  chOld = new Uint8Array(WIN_EDGE * WIN_EDGE);
  rem = new Int32Array(WIN_EDGE * WIN_EDGE);
  add = new Int32Array(WIN_EDGE * WIN_EDGE);
  lmark = new Int32Array(NAV_MAX_COMPONENTS + 2);
  lgen = 0;
  newMeta = new Int32Array(NAV_MAX_COMPONENTS + 2);
  remap = new Int32Array(NAV_MAX_COMPONENTS + 2);
  aliasOf = new Int32Array(NAV_MAX_COMPONENTS + 2);
  newMeta2 = new Int32Array(NAV_MAX_COMPONENTS + 2);
  labels2 = new Int32Array(ENTRY_CAP);
  labels3 = new Int32Array(ENTRY_CAP);
  ufParent = new Int32Array(UF_CAP);
  ufCount = new Int32Array(UF_CAP);
  ufMin = new Int32Array(UF_CAP);
  ufDone = new Uint8Array(UF_CAP);
  labels = new Int32Array(NAV_MAX_COMPONENTS + 2);
  compStart = new Int32Array(ENTRY_CAP);
  compLen = new Int32Array(ENTRY_CAP);
  compMin = new Int32Array(ENTRY_CAP);
  compOrder = new Int32Array(ENTRY_CAP);
  compLabel = new Int32Array(ENTRY_CAP);
  oldSec = new Int32Array(STAMP_MAX_SECTORS);
  secMask = new Int32Array(STAMP_MAX_SECTORS);
  boxes = new Int32Array(4 * NAV_CLASSES);
  oldNodes = new Int32Array(STAMP_MAX_SECTORS * NAV_CLASSES * NAV_NODE_SLOTS);
  oldEdges = new Uint16Array(STAMP_MAX_SECTORS * NAV_CLASSES * NAV_EDGE_SLOTS);
  /** Generation of the fine search (mark = gen2 open, gen2 + 1 closed). */
  gen2 = 0;
  aGen2 = 0;
  secGen = 0;
}

export const S = new Scratch();

/** Grows the scratch for a map of `cells` cells and `sectors` sectors (setup only). */
export function ensureScratch(cells: number, sectors: number): void {
  if (cells > S.cells) {
    S.cells = cells;
    S.G = new Int32Array(cells);
    S.F = new Int32Array(cells);
    S.mark = new Int32Array(cells);
    S.tmark = new Int32Array(cells);
    S.heap = new Int32Array(cells + 1);
    S.hpos = new Int32Array(cells);
    S.par = new Uint8Array(cells);
    S.list = new Int32Array(cells);
    S.list2 = new Int32Array(cells);
    S.gen2 = 0;
  }
  if (sectors > S.sectors) {
    S.sectors = sectors;
    const nodes = sectors * NAV_NODE_SLOTS + 1;
    S.aG = new Int32Array(nodes);
    S.aF = new Int32Array(nodes);
    S.aMark = new Int32Array(nodes);
    S.aHeap = new Int32Array(nodes + 1);
    S.aPos = new Int32Array(nodes);
    S.aPar = new Int32Array(nodes);
    S.aPath = new Int32Array(nodes);
    S.secMark = new Int32Array(sectors);
    S.secList = new Int32Array(sectors);
    S.aGen2 = 0;
    S.secGen = 0;
  }
}

/** Starts a fine-search generation (O(1) except on wrap-around). */
export function nextGen(): number {
  S.gen2 += 2;
  if (S.gen2 > 0x3ffffff0) {
    S.mark.fill(0);
    S.tmark.fill(0);
    S.gen2 = 2;
  }
  return S.gen2;
}

/** Starts an abstract-search generation. */
export function nextAGen(): number {
  S.aGen2 += 2;
  if (S.aGen2 > 0x3ffffff0) {
    S.aMark.fill(0);
    S.aGen2 = 2;
  }
  return S.aGen2;
}

/** Starts a sector-mark generation. */
export function nextSecGen(): number {
  S.secGen += 1;
  if (S.secGen > 0x3ffffff0) {
    S.secMark.fill(0);
    S.secGen = 1;
  }
  return S.secGen;
}
