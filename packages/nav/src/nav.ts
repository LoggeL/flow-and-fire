/**
 * Nav: the public face of the package (M5 passability/clearance/components, M6 fine A*, HPA*,
 * PathService, corridor repath). Works only on the arena regions (NavState) and module scratch.
 *
 * Call order (sim):
 *   const defs = defineNavRegions(sizeWu); const regions = addNavRegions(builder, defs); builder.build();
 *   const nav = new Nav(regions);
 *   nav.precomputeStatic(map);   // static area (terrain), once per map
 *   nav.rebuildDerived();        // derived regions from terrain + footprints + paths
 * Afterwards per tick: request()/repath()/cancel()/release() (Orders), serviceTick(budget)
 * (phase 3), waypoint()/advance()/refineNext() (Movement), stampFootprint() (obstacles).
 * After an arena restore nothing has to be rebuilt (derived regions are part of the snapshot).
 */

import {
  CTR_BLOCKS_EXHAUSTED,
  CTR_DIRECT,
  CTR_EXPANSIONS_LAST_TICK,
  CTR_EXPANSIONS_TOTAL_HI,
  CTR_EXPANSIONS_TOTAL_LO,
  CTR_FAILED,
  CTR_FALLBACK,
  CTR_FIFO_COUNT,
  CTR_FIFO_HEAD,
  CTR_REFINES,
  CTR_REPATHS_TRIGGERED,
  CTR_REQUESTS_DONE,
  CTR_REQUESTS_ISSUED,
  CTR_RETARGETED,
  CTR_STAMPS,
  CTR_WORDS,
  NAV_BACK_WORDS,
  NAV_BLOCK_PAYLOAD,
  NAV_BLOCK_WORDS,
  NAV_CAP_PATHS,
  NAV_CLASSES,
  NAV_COMP_OVERFLOW,
  NAV_EDGE_SLOTS,
  NAV_MAX_FOOTPRINT,
  NAV_NODE_SLOTS,
  NAV_PORTALS_PER_EDGE,
  NAV_SECTOR_SHIFT,
  NAV_SECTOR_SIZE,
  PATH_CANCELLED,
  PATH_DIRECT,
  PATH_F_FALLBACK,
  PATH_F_REPATH,
  PATH_F_RETARGETED,
  PATH_F_START_MOVED,
  PATH_FAILED,
  PATH_NONE,
  PATH_PENDING,
  PATH_READY,
  WP_END,
  WP_LAST,
  WP_NEED_REFINE,
  WP_NONE,
  WP_OK,
  WP_PENDING,
} from './constants.ts';
import { clearChange, rebuildClearance, updateClearanceLocal } from './clearance.ts';
import { rebuildComponents, updateComponentsLocal } from './components.ts';
import { buildSector, edgeBase, findNodeSlot, intraCost, neighbourSector, nodeBase, oppositeEdge, rebuildGraph } from './graph.ts';
import { hpa, hpaSearch, nodeCell } from './hpa.ts';
import { losClear, stringPull, supercoverHitsRect } from './los.ts';
import { COMP_META_WORDS, type NavRegions } from './regions.ts';
import { nextSecGen, S, STAMP_MAX_SECTORS } from './scratch.ts';
import { fineSearch, lastExpansions, reconstruct } from './search.ts';
import { nearestInComponent, spiral, SPIRAL_LABEL, SPIRAL_PASSABLE, spiralSearch } from './spiral.ts';
import { precomputeTerrain, type NavMapInput } from './static.ts';
import { NavState } from './state.ts';

/** Debug view of a path (Nav.pathDebug). */
export interface PathDebug {
  readonly state: number;
  readonly flags: number;
  readonly cls: number;
  readonly entity: number;
  readonly issueTick: number;
  /** Previous waypoint / start of the current leg (Fx raw). */
  readonly prevX: number;
  readonly prevZ: number;
  /** Remaining refined waypoints, Fx x/z pairs. */
  readonly waypoints: readonly number[];
  /** Cell where the next refinement starts. */
  readonly refCell: number;
  /** Unrefined abstract cells (nodes of the route, the last one is the goal cell). */
  readonly abs: readonly number[];
  readonly legCost: number;
  readonly cost: number;
  readonly startCell: number;
  readonly goalCell: number;
}

/** Maps a blueprint size class to a nav class: 0 → 1, 1..3 unchanged, > 3 → 3. */
export function navClassOf(sizeClass: number): number {
  return sizeClass < 1 ? 1 : sizeClass > NAV_CLASSES ? NAV_CLASSES : sizeClass;
}

const TWO32 = 4294967296;

/** Components up to this size are flooded to find the nearest cell to an unreachable goal. */
const NAV_FLOOD_CAP = 16384;

export class Nav {
  readonly st: NavState;

  constructor(regions: NavRegions) {
    this.st = new NavState(regions);
  }

  get sizeWu(): number {
    return this.st.size;
  }

  // -------------------------------------------------------------------------------------------
  // Setup

  /** Fills the static terrain region (area 'static') from the map. */
  precomputeStatic(map: NavMapInput): void {
    precomputeTerrain(this.st, map);
  }

  /** Recomputes every derived region (clearance, components, sector graph, corridor index). */
  rebuildDerived(): void {
    const st = this.st;
    rebuildClearance(st);
    rebuildComponents(st, NAV_CLASSES);
    rebuildGraph(st);
    st.back.fill(0);
    const hw = st.paths.highWater;
    for (let p = 0; p < hw; p++) {
      if (st.paths.alive[p] === 1) this.setCorridorBits(p);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Queries

  /** Clearance of cell (x, z) (0 = blocked). */
  clearanceAt(x: number, z: number): number {
    return this.st.clear[(z << this.st.shift) | x]!;
  }

  /** True if cell (x, z) is passable for class `cls`. */
  isPassable(cls: number, x: number, z: number): boolean {
    const st = this.st;
    if (x < 0 || z < 0 || x >= st.size || z >= st.size) return false;
    return st.clear[(z << st.shift) | x]! >= cls;
  }

  /** True if the Fx position lies in a cell passable for `cls`. */
  isPassableFx(cls: number, xRaw: number, zRaw: number): boolean {
    return this.isPassable(cls, xRaw >> 12, zRaw >> 12);
  }

  /** Component label of cell (x, z) for class `cls` (0 = blocked, NAV_COMP_OVERFLOW = unknown). */
  componentAt(cls: number, x: number, z: number): number {
    const st = this.st;
    return st.comp[(cls - 1) * st.n + ((z << st.shift) | x)]!;
  }

  /** Static terrain byte of cell (x, z): 0 blocked, else 1 + cost level. */
  terrainAt(x: number, z: number): number {
    return this.st.terrain[(z << this.st.shift) | x]!;
  }

  /** Footprint refcount of cell (x, z). */
  footprintAt(x: number, z: number): number {
    return this.st.foot[(z << this.st.shift) | x]!;
  }

  /** Cell index of a Fx position (clamped). */
  cellOfFx(xRaw: number, zRaw: number): number {
    return this.st.cellOfFx(xRaw, zRaw);
  }

  /** Nearest cell passable for `cls` (spiral search from (x, z)), −1 if none. */
  nearestPassable(cls: number, x: number, z: number): number {
    const st = this.st;
    return spiralSearch(st, cls, (z << st.shift) | x, SPIRAL_PASSABLE, 0, st.size);
  }

  /**
   * Nearest cell to (tx, tz) in the component of cell (fx, fz) for `cls` (spiral search), −1 if the
   * from-cell is blocked or its component is unknown (overflow).
   */
  nearestReachable(cls: number, fx: number, fz: number, tx: number, tz: number): number {
    const st = this.st;
    const from = (fz << st.shift) | fx;
    const L = st.comp[(cls - 1) * st.n + from]!;
    if (L === 0 || L === NAV_COMP_OVERFLOW) return -1;
    return this.nearestInLabel(cls, L, (tz << st.shift) | tx);
  }

  /**
   * Nearest cell of component L (class cls) to `target` (squared distance, ties in spiral order):
   * small components are flooded (≤ NAV_FLOOD_CAP cells), large ones use the spiral around the
   * target. With L = NAV_COMP_OVERFLOW: nearest passable cell.
   */
  private nearestInLabel(cls: number, L: number, target: number): number {
    const st = this.st;
    if (L === NAV_COMP_OVERFLOW) return spiralSearch(st, cls, target, SPIRAL_PASSABLE, 0, st.size);
    const minCell = st.compMeta[(cls - 1) * COMP_META_WORDS + L]!;
    const r = nearestInComponent(st, cls, L, target, NAV_FLOOD_CAP, minCell);
    if (r !== -2) return r;
    const flooded = spiral.cells;
    const s = spiralSearch(st, cls, target, SPIRAL_LABEL, L, st.size);
    spiral.cells += flooded;
    return s;
  }

  /** Clearance LOS between the centres of two cells for `cls`. */
  lineOfSight(cls: number, a: number, b: number): boolean {
    return losClear(this.st, cls, a, b);
  }

  // -------------------------------------------------------------------------------------------
  // Footprints (M5 local updates + corridor repath)

  /**
   * Adds (delta 1) or removes (delta −1) a footprint rectangle [x0, x0 + w) × [z0, z0 + h) (cells,
   * clipped to the map; w, h ≤ NAV_MAX_FOOTPRINT). Refcounts saturate at 0 and 255. Clearance,
   * components and the sector graph are updated locally (bit-identical to rebuildDerived); for
   * delta 1 every path whose remaining corridor is cut gets PATH_F_REPATH (corridor rule).
   * Returns the number of paths newly marked.
   */
  stampFootprint(x0: number, z0: number, w: number, h: number, delta: 1 | -1): number {
    const st = this.st;
    if (w < 1 || h < 1 || w > NAV_MAX_FOOTPRINT || h > NAV_MAX_FOOTPRINT) {
      throw new RangeError(`nav: footprint ${w}×${h} out of range 1..${NAV_MAX_FOOTPRINT}`);
    }
    if (delta !== 1 && delta !== -1) throw new RangeError('nav: delta must be 1 or -1');
    const size = st.size;
    const fx0 = Math.max(0, x0);
    const fz0 = Math.max(0, z0);
    const fx1 = Math.min(size, x0 + w);
    const fz1 = Math.min(size, z0 + h);
    st.ctr[CTR_STAMPS] = st.ctr[CTR_STAMPS]! + 1;
    if (fx0 >= fx1 || fz0 >= fz1) return 0;
    const foot = st.foot;
    const terrain = st.terrain;
    let changed = false;
    for (let z = fz0; z < fz1; z++) {
      for (let x = fx0; x < fx1; x++) {
        const c = (z << st.shift) | x;
        const v = foot[c]!;
        if (delta === 1) {
          if (v < 255) {
            foot[c] = v + 1;
            if (v === 0 && terrain[c] !== 0) changed = true;
          }
        } else if (v > 0) {
          foot[c] = v - 1;
          if (v === 1 && terrain[c] !== 0) changed = true;
        }
      }
    }
    let nOld = 0;
    const secGen = nextSecGen();
    if (changed) {
      updateClearanceLocal(st, fx0, fz0, fx1, fz1);
      const nCh = clearChange.count;
      if (nCh > 0) {
        for (let c = 1; c <= NAV_CLASSES; c++) updateComponentsLocal(st, c, nCh);
        // Only cells whose passability for a class changed matter for that class's graph:
        // per-class bbox of those cells, +1 for the portals on shared sector edges.
        const bb = this.classBoxes(nCh);
        for (let c = 1; c <= NAV_CLASSES; c++) {
          const o = (c - 1) * 4;
          if (bb[o + 2]! <= bb[o]!) continue;
          const sx0 = Math.max(0, bb[o]! - 1) >> NAV_SECTOR_SHIFT;
          const sz0 = Math.max(0, bb[o + 1]! - 1) >> NAV_SECTOR_SHIFT;
          const sx1 = Math.min(size - 1, bb[o + 2]!) >> NAV_SECTOR_SHIFT;
          const sz1 = Math.min(size - 1, bb[o + 3]!) >> NAV_SECTOR_SHIFT;
          for (let sz = sz0; sz <= sz1; sz++) {
            for (let sx = sx0; sx <= sx1; sx++) {
              const sec = (sz << st.secShift) | sx;
              if (S.secMark[sec] === secGen) {
                const k0 = S.secList[sec]!;
                S.secMask[k0] = S.secMask[k0]! | (1 << (c - 1));
                continue;
              }
              if (nOld >= STAMP_MAX_SECTORS) throw new Error('nav: too many sectors in one stamp');
              S.oldSec[nOld] = sec;
              S.secMask[nOld] = 1 << (c - 1);
              S.secMark[sec] = secGen;
              S.secList[sec] = nOld;
              nOld++;
            }
          }
        }
        // snapshot the old graph of every touched sector (all classes), then rebuild
        for (let k = 0; k < nOld; k++) {
          const sec = S.oldSec[k]!;
          const nb = nodeBase(sec, 1);
          const eb = edgeBase(sec, 1);
          S.oldNodes.set(st.nodes.subarray(nb, nb + NAV_CLASSES * NAV_NODE_SLOTS), k * NAV_CLASSES * NAV_NODE_SLOTS);
          S.oldEdges.set(st.edges.subarray(eb, eb + NAV_CLASSES * NAV_EDGE_SLOTS), k * NAV_CLASSES * NAV_EDGE_SLOTS);
          buildSector(st, sec, S.secMask[k]!);
        }
      }
    }
    if (delta !== 1) return 0;
    return this.markCorridors(fx0, fz0, fx1, fz1, secGen, nOld);
  }

  /**
   * Per class c the bbox [x0, z0, x1, z1) (exclusive; empty if x1 ≤ x0) of the changed cells whose
   * passability for c changed, in S.boxes[(c − 1) · 4 …].
   */
  private classBoxes(nCh: number): Int32Array {
    const st = this.st;
    const bb = S.boxes;
    for (let c = 0; c < NAV_CLASSES; c++) {
      bb[c * 4] = st.size;
      bb[c * 4 + 1] = st.size;
      bb[c * 4 + 2] = 0;
      bb[c * 4 + 3] = 0;
    }
    for (let k = 0; k < nCh; k++) {
      const cell = S.chCell[k]!;
      const o = S.chOld[k]!;
      const v = st.clear[cell]!;
      const x = cell & st.mask;
      const z = cell >> st.shift;
      for (let c = 1; c <= NAV_CLASSES; c++) {
        if (o >= c === v >= c) continue;
        const i = (c - 1) * 4;
        if (x < bb[i]!) bb[i] = x;
        if (z < bb[i + 1]!) bb[i + 1] = z;
        if (x + 1 > bb[i + 2]!) bb[i + 2] = x + 1;
        if (z + 1 > bb[i + 3]!) bb[i + 3] = z + 1;
      }
    }
    return bb;
  }

  /** Corridor rule (see docs/status/ms3-p0-nav.md): marks cut paths, returns their number. */
  private markCorridors(fx0: number, fz0: number, fx1: number, fz1: number, secGen: number, nOld: number): number {
    const st = this.st;
    const size = st.size;
    // candidate sectors: footprint expanded by the largest class, plus the rebuilt sectors
    const m = NAV_CLASSES;
    const cx0 = Math.max(0, fx0 - m) >> NAV_SECTOR_SHIFT;
    const cz0 = Math.max(0, fz0 - m) >> NAV_SECTOR_SHIFT;
    const cx1 = Math.min(size - 1, fx1 - 1 + m) >> NAV_SECTOR_SHIFT;
    const cz1 = Math.min(size - 1, fz1 - 1 + m) >> NAV_SECTOR_SHIFT;
    const back = st.back;
    let marked = 0;
    for (let w = 0; w < NAV_BACK_WORDS; w++) {
      let bits = 0;
      for (let sz = cz0; sz <= cz1; sz++) {
        for (let sx = cx0; sx <= cx1; sx++) bits |= back[((sz << st.secShift) | sx) * NAV_BACK_WORDS + w]!;
      }
      for (let k = 0; k < nOld; k++) bits |= back[S.oldSec[k]! * NAV_BACK_WORDS + w]!;
      while (bits !== 0) {
        const low = bits & -bits;
        bits ^= low;
        const p = (w << 5) | (31 - Math.clz32(low));
        if (this.corridorCut(p, fx0, fz0, fx1, fz1, secGen)) {
          st.paths.col.flags[p] = st.paths.col.flags[p]! | PATH_F_REPATH;
          marked++;
        }
      }
    }
    st.ctr[CTR_REPATHS_TRIGGERED] = st.ctr[CTR_REPATHS_TRIGGERED]! + marked;
    return marked;
  }

  /** Corridor rule for one path. */
  private corridorCut(p: number, fx0: number, fz0: number, fx1: number, fz1: number, secGen: number): boolean {
    const st = this.st;
    const col = st.paths.col;
    const state = col.state[p]!;
    if (state !== PATH_READY && state !== PATH_DIRECT) return false;
    if ((col.flags[p]! & PATH_F_REPATH) !== 0) return false;
    const cls = col.cls[p]!;
    const size = st.size;
    // (a) refined part: supercover of the polyline (px,pz) → waypoints, cells expanded by cls
    const rx0 = fx0 - cls;
    const rz0 = fz0 - cls;
    const rx1 = fx1 + cls;
    const rz1 = fz1 + cls;
    let prev = st.cellOfFx(col.px[p]!, col.pz[p]!);
    const bi = st.blocks.i32;
    let blk = col.wpHead[p]!;
    let pos = col.wpPos[p]!;
    let left = col.wpLeft[p]!;
    while (left > 0 && blk >= 0) {
      const base = blk * NAV_BLOCK_WORDS;
      const cnt = bi[base + 1]!;
      while (pos < cnt && left > 0) {
        const cur = st.cellOfFx(bi[base + 2 + pos]!, bi[base + 3 + pos]!);
        if (supercoverHitsRect(st, prev, cur, rx0, rz0, rx1, rz1)) return true;
        prev = cur;
        pos += 2;
        left--;
      }
      blk = bi[base]!;
      pos = 0;
    }
    // (b) unrefined part: consecutive abstract cells
    let a = col.refCell[p]!;
    blk = col.absHead[p]!;
    pos = col.absPos[p]!;
    left = col.absLeft[p]!;
    while (left > 0 && blk >= 0) {
      const base = blk * NAV_BLOCK_WORDS;
      const cnt = bi[base + 1]!;
      while (pos < cnt && left > 0) {
        const b = bi[base + 2 + pos]!;
        pos++;
        left--;
        if (left === 0) {
          // goal leg a → goal inside the goal sector
          if (this.goalLegCut(p, cls, a, b, rx0, rz0, rx1, rz1, size)) return true;
        } else if (a !== b && this.abstractStepCut(cls, a, b, secGen)) {
          return true;
        }
        a = b;
      }
      blk = bi[base]!;
      pos = 0;
    }
    return false;
  }

  private goalLegCut(p: number, cls: number, a: number, goal: number, rx0: number, rz0: number, rx1: number, rz1: number, size: number): boolean {
    const st = this.st;
    const sec = st.sectorOf(goal);
    const x0 = st.sectorX0(sec);
    const z0 = st.sectorZ0(sec);
    if (rx1 <= x0 || rx0 >= x0 + NAV_SECTOR_SIZE || rz1 <= z0 || rz0 >= z0 + NAV_SECTOR_SIZE) return false;
    void size;
    const leg = st.paths.col.legCost[p]!;
    const cost = fineSearch(st, cls, a, goal, x0, z0, x0 + NAV_SECTOR_SIZE, z0 + NAV_SECTOR_SIZE, 0);
    return cost < 0 || (leg >= 0 && cost > leg);
  }

  private abstractStepCut(cls: number, a: number, b: number, secGen: number): boolean {
    const st = this.st;
    const secA = st.sectorOf(a);
    const secB = st.sectorOf(b);
    const rebA = S.secMark[secA] === secGen;
    const rebB = S.secMark[secB] === secGen;
    if (!rebA && !rebB) return false;
    if (secA === secB) {
      const nb = nodeBase(secA, cls);
      const sa = findNodeSlot(st.nodes, nb, a);
      const sb = findNodeSlot(st.nodes, nb, b);
      if (sa < 0 || sb < 0) return true;
      const k = S.secList[secA]!;
      const onb = (k * NAV_CLASSES + cls - 1) * NAV_NODE_SLOTS;
      const oa = findNodeSlot(S.oldNodes, onb, a);
      const ob = findNodeSlot(S.oldNodes, onb, b);
      if (oa < 0 || ob < 0) return true;
      const oeb = (k * NAV_CLASSES + cls - 1) * NAV_EDGE_SLOTS;
      const oldCost = oa === ob ? 0 : oldIntra(oeb, oa, ob);
      const newCost = intraCost(st, edgeBase(secA, cls), sa, sb);
      return oldCost < 0 || newCost < 0 || newCost > oldCost;
    }
    // portal step a → b across a sector edge
    const sa = findNodeSlot(st.nodes, nodeBase(secA, cls), a);
    const sb = findNodeSlot(st.nodes, nodeBase(secB, cls), b);
    if (sa < 0 || sb < 0) return true;
    const e = sa >> 2;
    return neighbourSector(st, secA, e) !== secB || sb !== oppositeEdge(e) * NAV_PORTALS_PER_EDGE + (sa & 3);
  }

  // -------------------------------------------------------------------------------------------
  // PathService

  /**
   * Queues a path request of entity `entityIdx` issued at `issueTick` for class `cls` (use
   * navClassOf) from (sx, sz) to (tx, tz) (Fx raw). Returns the path id (slot) or −1 if the path
   * table is full. The FIFO is ordered by (issueTick, entityIdx), stable for equal keys.
   */
  request(entityIdx: number, issueTick: number, cls: number, sx: number, sz: number, tx: number, tz: number): number {
    const st = this.st;
    const p = st.paths.alloc();
    if (p < 0) return -1;
    const col = st.paths.col;
    col.cls[p] = navClassOf(cls);
    col.entity[p] = entityIdx;
    col.tx[p] = tx;
    col.tz[p] = tz;
    this.resetPath(p, issueTick, sx, sz);
    st.ctr[CTR_REQUESTS_ISSUED] = st.ctr[CTR_REQUESTS_ISSUED]! + 1;
    return p;
  }

  /**
   * Re-plans path `p` from (sx, sz) to its requested goal as a new request issued at `issueTick`
   * (clears PATH_F_REPATH). Counts as a request (requestsIssued).
   */
  repath(p: number, sx: number, sz: number, issueTick: number): void {
    const st = this.st;
    this.checkLive(p);
    this.dropPath(p);
    this.resetPath(p, issueTick, sx, sz);
    st.ctr[CTR_REQUESTS_ISSUED] = st.ctr[CTR_REQUESTS_ISSUED]! + 1;
  }

  /** Stops path `p` (dequeues a pending request, frees its data); the slot stays allocated. */
  cancel(p: number): void {
    this.checkLive(p);
    this.dropPath(p);
    this.st.paths.col.state[p] = PATH_CANCELLED;
  }

  /** Cancels and frees path slot `p`. */
  release(p: number): void {
    this.checkLive(p);
    this.dropPath(p);
    this.st.paths.col.state[p] = PATH_NONE;
    this.st.paths.free(p);
  }

  /**
   * Works the FIFO while the expansion budget lasts; a started request always runs to completion
   * (no search state survives the call). Returns the expansions used (also in expansionsLastTick).
   */
  serviceTick(budgetExpansions: number): number {
    const st = this.st;
    const ctr = st.ctr;
    let used = 0;
    while (ctr[CTR_FIFO_COUNT]! > 0 && used < budgetExpansions) {
      const head = ctr[CTR_FIFO_HEAD]!;
      const p = st.fifo[head]!;
      ctr[CTR_FIFO_HEAD] = head + 1 === NAV_CAP_PATHS ? 0 : head + 1;
      ctr[CTR_FIFO_COUNT] = ctr[CTR_FIFO_COUNT]! - 1;
      used += this.process(p);
    }
    ctr[CTR_EXPANSIONS_LAST_TICK] = used;
    this.addExpansions(used);
    return used;
  }

  /** Path state (PATH_*). */
  pathState(p: number): number {
    return this.st.paths.col.state[p]!;
  }

  /** Path flags (PATH_F_*). */
  pathFlags(p: number): number {
    return this.st.paths.col.flags[p]!;
  }

  /** True if a footprint cut the remaining corridor (call repath). */
  needsRepath(p: number): boolean {
    return (this.st.paths.col.flags[p]! & PATH_F_REPATH) !== 0;
  }

  /** Effective goal (Fx raw) into out[0], out[1] (retargeted goal = cell centre). */
  pathGoal(p: number, out: Int32Array): void {
    out[0] = this.st.paths.col.gx[p]!;
    out[1] = this.st.paths.col.gz[p]!;
  }

  /** Effective start and goal cells of the last search (after start snapping / retargeting). */
  pathStartCell(p: number): number {
    return this.st.paths.col.startCell[p]!;
  }

  pathGoalCell(p: number): number {
    return this.st.paths.col.goalCell[p]!;
  }

  /** Nav class of the path. */
  pathClass(p: number): number {
    return this.st.paths.col.cls[p]!;
  }

  /** Cost of the path's route (abstract route, or fine path for Direct/fallback); −1 if none. */
  pathCost(p: number): number {
    return this.st.paths.col.cost[p]!;
  }

  /** Current waypoint (Fx raw) into out[0], out[1]; returns WP_*. */
  waypoint(p: number, out: Int32Array): number {
    const col = this.st.paths.col;
    const s = col.state[p]!;
    if (s === PATH_PENDING) return WP_PENDING;
    if (s !== PATH_READY && s !== PATH_DIRECT) return WP_NONE;
    if (col.wpLeft[p]! > 0) {
      const bi = this.st.blocks.i32;
      const base = col.wpHead[p]! * NAV_BLOCK_WORDS + 2 + col.wpPos[p]!;
      out[0] = bi[base]!;
      out[1] = bi[base + 1]!;
      return WP_OK;
    }
    return col.absLeft[p]! > 0 ? WP_NEED_REFINE : WP_END;
  }

  /**
   * Random access into the remaining route for consumers that share one path (group moves, MS3):
   * writes the k-th remaining refined waypoint (k = 0 is the current one, see `waypoint`) into
   * `out` and returns WP_OK, or WP_LAST if it is the final point of the path. For k beyond the
   * refined part it returns WP_NEED_REFINE (unrefined abstract cells remain; `out` receives the
   * next abstract point — node cell centre or the goal — as a steering fallback) or WP_END.
   * WP_PENDING / WP_NONE as `waypoint`. Allocation-free; cost O(k / 7) blocks.
   */
  pointAt(p: number, k: number, out: Int32Array): number {
    const st = this.st;
    const col = st.paths.col;
    const s = col.state[p]!;
    if (s === PATH_PENDING) return WP_PENDING;
    if (s !== PATH_READY && s !== PATH_DIRECT) return WP_NONE;
    const left = col.wpLeft[p]!;
    const bi = st.blocks.i32;
    if (k >= 0 && k < left) {
      let blk = col.wpHead[p]!;
      let pos = col.wpPos[p]! + 2 * k;
      for (;;) {
        const cnt = bi[blk * NAV_BLOCK_WORDS + 1]!;
        if (pos < cnt) break;
        pos -= cnt;
        blk = bi[blk * NAV_BLOCK_WORDS]!;
      }
      const base = blk * NAV_BLOCK_WORDS + 2 + pos;
      out[0] = bi[base]!;
      out[1] = bi[base + 1]!;
      return k === left - 1 && col.absLeft[p]! <= 0 ? WP_LAST : WP_OK;
    }
    if (k < 0 || col.absLeft[p]! <= 0) return WP_END;
    if (col.absLeft[p] === 1) {
      out[0] = col.gx[p]!;
      out[1] = col.gz[p]!;
    } else {
      const c = bi[col.absHead[p]! * NAV_BLOCK_WORDS + 2 + col.absPos[p]!]!;
      out[0] = ((c & st.mask) << 12) + 2048;
      out[1] = ((c >> st.shift) << 12) + 2048;
    }
    return WP_NEED_REFINE;
  }

  /** Previous waypoint of path p (start of the current leg, Fx) into out[0], out[1]. */
  pathPrev(p: number, out: Int32Array): void {
    out[0] = this.st.paths.col.px[p]!;
    out[1] = this.st.paths.col.pz[p]!;
  }

  /** Number of refined waypoints left. */
  refinedLeft(p: number): number {
    return this.st.paths.col.wpLeft[p]!;
  }

  /** Consumes the current waypoint (the unit reached it). */
  advance(p: number): void {
    const st = this.st;
    const col = st.paths.col;
    if (col.wpLeft[p]! <= 0) return;
    const bi = st.blocks.i32;
    const head = col.wpHead[p]!;
    const base = head * NAV_BLOCK_WORDS;
    const pos = col.wpPos[p]!;
    col.px[p] = bi[base + 2 + pos]!;
    col.pz[p] = bi[base + 3 + pos]!;
    this.popFront(p, true, pos + 2);
    this.setCorridorBits(p);
  }

  /**
   * Refines the next segment (to the next sector entry or the goal, fine A* bounded to the sector
   * pair, string pulling). Does nothing if `budget` ≤ 0 or nothing is left to refine. Returns the
   * expansions used (the segment always completes; ≤ 2 sectors of cells).
   */
  refineNext(p: number, budget: number): number {
    const st = this.st;
    const col = st.paths.col;
    if (budget <= 0 || col.state[p] !== PATH_READY || col.absLeft[p]! <= 0) return 0;
    const exp = this.refine(p);
    this.setCorridorBits(p);
    this.addExpansions(exp);
    return exp;
  }

  /**
   * Remaining route as Fx x/z pairs into `out` (refined waypoints, then centres of the unrefined
   * abstract cells), at most `maxPoints`, skipping the first `skip` refined waypoints (a group
   * member ahead of the shared cursor); returns the number of points. For frames/overlays.
   */
  remainingPoints(p: number, out: Int32Array, maxPoints: number, skip = 0): number {
    const st = this.st;
    const col = st.paths.col;
    const s = col.state[p]!;
    if (s !== PATH_READY && s !== PATH_DIRECT) return 0;
    const bi = st.blocks.i32;
    let n = 0;
    let blk = col.wpHead[p]!;
    let pos = col.wpPos[p]!;
    let left = col.wpLeft[p]!;
    let sk = skip > 0 ? skip : 0;
    while (left > 0 && blk >= 0 && n < maxPoints) {
      const base = blk * NAV_BLOCK_WORDS;
      const cnt = bi[base + 1]!;
      while (pos < cnt && left > 0 && n < maxPoints) {
        if (sk > 0) sk--;
        else {
          out[2 * n] = bi[base + 2 + pos]!;
          out[2 * n + 1] = bi[base + 3 + pos]!;
          n++;
        }
        pos += 2;
        left--;
      }
      blk = bi[base]!;
      pos = 0;
    }
    blk = col.absHead[p]!;
    pos = col.absPos[p]!;
    left = col.absLeft[p]!;
    while (left > 0 && blk >= 0 && n < maxPoints) {
      const base = blk * NAV_BLOCK_WORDS;
      const cnt = bi[base + 1]!;
      while (pos < cnt && left > 0 && n < maxPoints) {
        const c = bi[base + 2 + pos]!;
        pos++;
        left--;
        if (left === 0) {
          out[2 * n] = col.gx[p]!;
          out[2 * n + 1] = col.gz[p]!;
        } else {
          out[2 * n] = ((c & st.mask) << 12) + 2048;
          out[2 * n + 1] = ((c >> st.shift) << 12) + 2048;
        }
        n++;
      }
      blk = bi[base]!;
      pos = 0;
    }
    return n;
  }

  /** Debug view of a path (allocates; tests and tools only, never in the tick path). */
  pathDebug(p: number): PathDebug {
    const st = this.st;
    const col = st.paths.col;
    const bi = st.blocks.i32;
    const waypoints: number[] = [];
    let blk = col.wpHead[p]!;
    let pos = col.wpPos[p]!;
    let left = col.wpLeft[p]!;
    while (left > 0 && blk >= 0) {
      const base = blk * NAV_BLOCK_WORDS;
      const cnt = bi[base + 1]!;
      while (pos < cnt && left > 0) {
        waypoints.push(bi[base + 2 + pos]!, bi[base + 3 + pos]!);
        pos += 2;
        left--;
      }
      blk = bi[base]!;
      pos = 0;
    }
    const abs: number[] = [];
    blk = col.absHead[p]!;
    pos = col.absPos[p]!;
    left = col.absLeft[p]!;
    while (left > 0 && blk >= 0) {
      const base = blk * NAV_BLOCK_WORDS;
      const cnt = bi[base + 1]!;
      while (pos < cnt && left > 0) {
        abs.push(bi[base + 2 + pos]!);
        pos++;
        left--;
      }
      blk = bi[base]!;
      pos = 0;
    }
    return {
      state: col.state[p]!,
      flags: col.flags[p]!,
      cls: col.cls[p]!,
      entity: col.entity[p]!,
      issueTick: col.issueTick[p]!,
      prevX: col.px[p]!,
      prevZ: col.pz[p]!,
      waypoints,
      refCell: col.refCell[p]!,
      abs,
      legCost: col.legCost[p]!,
      cost: col.cost[p]!,
      startCell: col.startCell[p]!,
      goalCell: col.goalCell[p]!,
    };
  }

  // Counters -----------------------------------------------------------------------------------

  get requestsIssued(): number {
    return this.st.ctr[CTR_REQUESTS_ISSUED]!;
  }
  get requestsDone(): number {
    return this.st.ctr[CTR_REQUESTS_DONE]!;
  }
  get repathsTriggered(): number {
    return this.st.ctr[CTR_REPATHS_TRIGGERED]!;
  }
  get expansionsLastTick(): number {
    return this.st.ctr[CTR_EXPANSIONS_LAST_TICK]!;
  }
  get expansionsTotal(): number {
    return (this.st.ctr[CTR_EXPANSIONS_TOTAL_LO]! >>> 0) + (this.st.ctr[CTR_EXPANSIONS_TOTAL_HI]! >>> 0) * TWO32;
  }
  get pendingCount(): number {
    return this.st.ctr[CTR_FIFO_COUNT]!;
  }
  /** Further counters: failed, retargeted, direct, fallback, stamps, refines, blocksExhausted. */
  counter(word: number): number {
    if (word < 0 || word >= CTR_WORDS) throw new RangeError('nav: counter index');
    return this.st.ctr[word]!;
  }

  // -------------------------------------------------------------------------------------------
  // internals

  private checkLive(p: number): void {
    if (!this.st.paths.isLive(p)) throw new RangeError(`nav: path ${p} is not live`);
  }

  private addExpansions(n: number): void {
    const ctr = this.st.ctr;
    const lo = (ctr[CTR_EXPANSIONS_TOTAL_LO]! >>> 0) + n;
    if (lo >= TWO32) {
      ctr[CTR_EXPANSIONS_TOTAL_LO] = lo - TWO32;
      ctr[CTR_EXPANSIONS_TOTAL_HI] = ctr[CTR_EXPANSIONS_TOTAL_HI]! + 1;
    } else {
      ctr[CTR_EXPANSIONS_TOTAL_LO] = lo;
    }
  }

  /** Initialises the per-search columns and enqueues the path. */
  private resetPath(p: number, issueTick: number, sx: number, sz: number): void {
    const col = this.st.paths.col;
    col.state[p] = PATH_PENDING;
    col.flags[p] = 0;
    col.issueTick[p] = issueTick;
    col.sx[p] = sx;
    col.sz[p] = sz;
    col.gx[p] = col.tx[p]!;
    col.gz[p] = col.tz[p]!;
    col.startCell[p] = -1;
    col.goalCell[p] = -1;
    col.absHead[p] = -1;
    col.absTail[p] = -1;
    col.absPos[p] = 0;
    col.absLeft[p] = 0;
    col.wpHead[p] = -1;
    col.wpTail[p] = -1;
    col.wpPos[p] = 0;
    col.wpLeft[p] = 0;
    col.refCell[p] = -1;
    col.px[p] = sx;
    col.pz[p] = sz;
    col.cost[p] = -1;
    col.legCost[p] = -1;
    this.enqueue(p);
  }

  /** Inserts p into the FIFO ordered by (issueTick, entity), after equal keys. */
  private enqueue(p: number): void {
    const st = this.st;
    const ctr = st.ctr;
    const fifo = st.fifo;
    const col = st.paths.col;
    const head = ctr[CTR_FIFO_HEAD]!;
    const count = ctr[CTR_FIFO_COUNT]!;
    const t = col.issueTick[p]!;
    const e = col.entity[p]!;
    let k = count;
    while (k > 0) {
      const q = fifo[(head + k - 1) % NAV_CAP_PATHS]!;
      const tq = col.issueTick[q]!;
      if (tq < t || (tq === t && col.entity[q]! <= e)) break;
      fifo[(head + k) % NAV_CAP_PATHS] = q;
      k--;
    }
    fifo[(head + k) % NAV_CAP_PATHS] = p;
    ctr[CTR_FIFO_COUNT] = count + 1;
  }

  private dequeue(p: number): void {
    const st = this.st;
    const ctr = st.ctr;
    const fifo = st.fifo;
    const head = ctr[CTR_FIFO_HEAD]!;
    const count = ctr[CTR_FIFO_COUNT]!;
    let k = 0;
    while (k < count && fifo[(head + k) % NAV_CAP_PATHS] !== p) k++;
    if (k === count) return;
    for (; k < count - 1; k++) fifo[(head + k) % NAV_CAP_PATHS] = fifo[(head + k + 1) % NAV_CAP_PATHS]!;
    ctr[CTR_FIFO_COUNT] = count - 1;
  }

  /** Dequeues (if pending), frees the chains and clears the corridor bits. */
  private dropPath(p: number): void {
    const col = this.st.paths.col;
    if (col.state[p] === PATH_PENDING) this.dequeue(p);
    this.freeChain(col.absHead[p]!);
    this.freeChain(col.wpHead[p]!);
    col.absHead[p] = -1;
    col.absTail[p] = -1;
    col.absLeft[p] = 0;
    col.absPos[p] = 0;
    col.wpHead[p] = -1;
    col.wpTail[p] = -1;
    col.wpLeft[p] = 0;
    col.wpPos[p] = 0;
    this.clearCorridorBits(p);
  }

  private freeChain(blk: number): void {
    const blocks = this.st.blocks;
    const bi = blocks.i32;
    while (blk >= 0) {
      const next = bi[blk * NAV_BLOCK_WORDS]!;
      blocks.free(blk);
      blk = next;
    }
  }

  /** Appends `words` (1 or 2) values to the abs (wp = false) or waypoint chain; false if out of blocks. */
  private append(p: number, wp: boolean, v0: number, v1: number): boolean {
    const st = this.st;
    const col = st.paths.col;
    const blocks = st.blocks;
    const bi = blocks.i32;
    const words = wp ? 2 : 1;
    let tail = wp ? col.wpTail[p]! : col.absTail[p]!;
    if (tail < 0 || bi[tail * NAV_BLOCK_WORDS + 1]! + words > NAV_BLOCK_PAYLOAD) {
      const nb = blocks.alloc();
      if (nb < 0) {
        st.ctr[CTR_BLOCKS_EXHAUSTED] = st.ctr[CTR_BLOCKS_EXHAUSTED]! + 1;
        return false;
      }
      bi[nb * NAV_BLOCK_WORDS] = -1;
      bi[nb * NAV_BLOCK_WORDS + 1] = 0;
      if (tail >= 0) bi[tail * NAV_BLOCK_WORDS] = nb;
      else if (wp) {
        col.wpHead[p] = nb;
        col.wpPos[p] = 0;
      } else {
        col.absHead[p] = nb;
        col.absPos[p] = 0;
      }
      tail = nb;
      if (wp) col.wpTail[p] = nb;
      else col.absTail[p] = nb;
    }
    const base = tail * NAV_BLOCK_WORDS;
    const cnt = bi[base + 1]!;
    bi[base + 2 + cnt] = v0;
    if (wp) bi[base + 3 + cnt] = v1;
    bi[base + 1] = cnt + words;
    if (wp) col.wpLeft[p] = col.wpLeft[p]! + 1;
    else col.absLeft[p] = col.absLeft[p]! + 1;
    return true;
  }

  /** Moves the read position of a chain to `newPos`, freeing the head block when it is used up. */
  private popFront(p: number, wp: boolean, newPos: number): void {
    const st = this.st;
    const col = st.paths.col;
    const bi = st.blocks.i32;
    const head = wp ? col.wpHead[p]! : col.absHead[p]!;
    const base = head * NAV_BLOCK_WORDS;
    if (wp) col.wpLeft[p] = col.wpLeft[p]! - 1;
    else col.absLeft[p] = col.absLeft[p]! - 1;
    if (newPos >= bi[base + 1]!) {
      const next = bi[base]!;
      st.blocks.free(head);
      if (wp) {
        col.wpHead[p] = next;
        col.wpPos[p] = 0;
        if (next < 0) col.wpTail[p] = -1;
      } else {
        col.absHead[p] = next;
        col.absPos[p] = 0;
        if (next < 0) col.absTail[p] = -1;
      }
    } else if (wp) col.wpPos[p] = newPos;
    else col.absPos[p] = newPos;
  }

  /** Pops the next abstract cell. */
  private popAbs(p: number): number {
    const st = this.st;
    const col = st.paths.col;
    const pos = col.absPos[p]!;
    const c = st.blocks.i32[col.absHead[p]! * NAV_BLOCK_WORDS + 2 + pos]!;
    this.popFront(p, false, pos + 1);
    return c;
  }

  private fail(p: number): void {
    const st = this.st;
    const col = st.paths.col;
    this.freeChain(col.absHead[p]!);
    this.freeChain(col.wpHead[p]!);
    col.absHead[p] = -1;
    col.absTail[p] = -1;
    col.absLeft[p] = 0;
    col.absPos[p] = 0;
    col.wpHead[p] = -1;
    col.wpTail[p] = -1;
    col.wpLeft[p] = 0;
    col.wpPos[p] = 0;
    col.state[p] = PATH_FAILED;
    st.ctr[CTR_FAILED] = st.ctr[CTR_FAILED]! + 1;
  }

  /** Runs one request to completion; returns the expansions used. */
  private process(p: number): number {
    const st = this.st;
    const col = st.paths.col;
    const ctr = st.ctr;
    ctr[CTR_REQUESTS_DONE] = ctr[CTR_REQUESTS_DONE]! + 1;
    const cls = col.cls[p]!;
    const n = st.n;
    let start = st.cellOfFx(col.sx[p]!, col.sz[p]!);
    let goal = st.cellOfFx(col.tx[p]!, col.tz[p]!);
    let exp = 0;
    if (st.clear[start]! < cls) {
      const s2 = spiralSearch(st, cls, start, SPIRAL_PASSABLE, 0, st.size);
      exp += spiral.cells >> 3;
      if (s2 < 0) {
        this.fail(p);
        return exp + 1;
      }
      start = s2;
      col.flags[p] = col.flags[p]! | PATH_F_START_MOVED;
    }
    const L = st.comp[(cls - 1) * n + start]!;
    const gl = st.comp[(cls - 1) * n + goal]!;
    const goalOk = st.clear[goal]! >= cls && (L === NAV_COMP_OVERFLOW || gl === L);
    if (!goalOk) {
      const g2 = this.nearestInLabel(cls, L, goal);
      exp += spiral.cells >> 3;
      if (g2 < 0) {
        this.fail(p);
        return exp + 1;
      }
      goal = g2;
      col.flags[p] = col.flags[p]! | PATH_F_RETARGETED;
      col.gx[p] = ((goal & st.mask) << 12) + 2048;
      col.gz[p] = ((goal >> st.shift) << 12) + 2048;
      ctr[CTR_RETARGETED] = ctr[CTR_RETARGETED]! + 1;
    }
    col.startCell[p] = start;
    col.goalCell[p] = goal;
    col.px[p] = col.sx[p]!;
    col.pz[p] = col.sz[p]!;
    if ((col.flags[p]! & PATH_F_START_MOVED) !== 0) {
      if (!this.append(p, true, ((start & st.mask) << 12) + 2048, ((start >> st.shift) << 12) + 2048)) {
        this.fail(p);
        return exp + 1;
      }
    }
    // short path: same or neighbouring sector with free LOS ⇒ Direct
    const ss = st.sectorOf(start);
    const gs = st.sectorOf(goal);
    const dsx = (ss & (st.secPerEdge - 1)) - (gs & (st.secPerEdge - 1));
    const dsz = (ss >> st.secShift) - (gs >> st.secShift);
    if (start === goal || (dsx >= -1 && dsx <= 1 && dsz >= -1 && dsz <= 1 && losClear(st, cls, start, goal))) {
      if (!this.append(p, true, col.gx[p]!, col.gz[p]!)) {
        this.fail(p);
        return exp + 1;
      }
      col.state[p] = PATH_DIRECT;
      col.refCell[p] = goal;
      col.cost[p] = 0;
      ctr[CTR_DIRECT] = ctr[CTR_DIRECT]! + 1;
      this.setCorridorBits(p);
      return exp + 1;
    }
    const cost = hpaSearch(st, cls, start, goal);
    exp += hpa.expansions;
    if (cost >= 0) {
      const nn = hpa.nodes;
      for (let k = 0; k < nn; k++) {
        if (!this.append(p, false, nodeCell(st, cls, S.aPath[k]!), 0)) {
          this.fail(p);
          return exp;
        }
      }
      if (!this.append(p, false, goal, 0)) {
        this.fail(p);
        return exp;
      }
      col.cost[p] = cost;
      col.legCost[p] = hpa.legCost;
      col.refCell[p] = start;
      col.state[p] = PATH_READY;
      exp += this.refine(p);
    } else {
      // Fallback: HPA* found no route (dropped portal) although the component matches.
      const c2 = fineSearch(st, cls, start, goal, 0, 0, st.size, st.size, 0);
      exp += lastExpansions;
      if (c2 < 0) {
        this.fail(p);
        return exp;
      }
      const cells = S.list;
      const m0 = reconstruct(st, goal, cells);
      const m = stringPull(st, cls, cells, m0, cells);
      for (let k = 0; k < m; k++) {
        const c = cells[k]!;
        const last = k === m - 1;
        if (!this.append(p, true, last ? col.gx[p]! : ((c & st.mask) << 12) + 2048, last ? col.gz[p]! : ((c >> st.shift) << 12) + 2048)) {
          this.fail(p);
          return exp;
        }
      }
      col.cost[p] = c2;
      col.refCell[p] = goal;
      col.state[p] = PATH_READY;
      col.flags[p] = col.flags[p]! | PATH_F_FALLBACK;
      ctr[CTR_FALLBACK] = ctr[CTR_FALLBACK]! + 1;
    }
    this.setCorridorBits(p);
    return exp < 1 ? 1 : exp;
  }

  /** Refines the next segment of a READY path; returns expansions. */
  private refine(p: number): number {
    const st = this.st;
    const col = st.paths.col;
    const cls = col.cls[p]!;
    const ref = col.refCell[p]!;
    const secR = st.sectorOf(ref);
    let target = -1;
    while (col.absLeft[p]! > 0) {
      const c = this.popAbs(p);
      if (col.absLeft[p] === 0 || st.sectorOf(c) !== secR) {
        target = c;
        break;
      }
    }
    if (target < 0) return 0;
    const secT = st.sectorOf(target);
    const rx0 = Math.min(st.sectorX0(secR), st.sectorX0(secT));
    const rz0 = Math.min(st.sectorZ0(secR), st.sectorZ0(secT));
    const rx1 = Math.max(st.sectorX0(secR), st.sectorX0(secT)) + NAV_SECTOR_SIZE;
    const rz1 = Math.max(st.sectorZ0(secR), st.sectorZ0(secT)) + NAV_SECTOR_SIZE;
    const cost = fineSearch(st, cls, ref, target, rx0, rz0, rx1, rz1, 0);
    const exp = lastExpansions;
    st.ctr[CTR_REFINES] = st.ctr[CTR_REFINES]! + 1;
    if (cost < 0) {
      // the corridor changed without a repath mark (e.g. several stamps); ask for a repath
      col.flags[p] = col.flags[p]! | PATH_F_REPATH;
      col.refCell[p] = target;
      return exp;
    }
    const cells = S.list;
    const n = reconstruct(st, target, cells);
    const m = stringPull(st, cls, cells, n, cells);
    const isGoal = col.absLeft[p] === 0;
    for (let k = 0; k < m; k++) {
      const c = cells[k]!;
      const last = isGoal && k === m - 1;
      if (!this.append(p, true, last ? col.gx[p]! : ((c & st.mask) << 12) + 2048, last ? col.gz[p]! : ((c >> st.shift) << 12) + 2048)) {
        this.fail(p);
        return exp;
      }
    }
    if (m === 0 && isGoal) {
      if (!this.append(p, true, col.gx[p]!, col.gz[p]!)) this.fail(p);
    }
    col.refCell[p] = target;
    return exp;
  }

  private clearCorridorBits(p: number): void {
    const st = this.st;
    const w = p >> 5;
    const m = ~(1 << (p & 31));
    const back = st.back;
    for (let s = 0, i = w; s < st.numSectors; s++, i += NAV_BACK_WORDS) back[i] = back[i]! & m;
  }

  private setSectorsOfRect(p: number, x0: number, z0: number, x1: number, z1: number): void {
    const st = this.st;
    const bit = 1 << (p & 31);
    const w = p >> 5;
    const sx0 = x0 >> NAV_SECTOR_SHIFT;
    const sz0 = z0 >> NAV_SECTOR_SHIFT;
    const sx1 = x1 >> NAV_SECTOR_SHIFT;
    const sz1 = z1 >> NAV_SECTOR_SHIFT;
    for (let sz = sz0; sz <= sz1; sz++) {
      for (let sx = sx0; sx <= sx1; sx++) {
        const i = ((sz << st.secShift) | sx) * NAV_BACK_WORDS + w;
        st.back[i] = st.back[i]! | bit;
      }
    }
  }

  /**
   * Recomputes the sector bits of path p: bounding boxes of the remaining refined legs (from the
   * previous waypoint) and the sectors of the unrefined abstract cells and the refinement start.
   */
  private setCorridorBits(p: number): void {
    const st = this.st;
    this.clearCorridorBits(p);
    const col = st.paths.col;
    const s = col.state[p]!;
    if (s !== PATH_READY && s !== PATH_DIRECT) return;
    const mask = st.mask;
    const shift = st.shift;
    let prev = st.cellOfFx(col.px[p]!, col.pz[p]!);
    const bi = st.blocks.i32;
    let blk = col.wpHead[p]!;
    let pos = col.wpPos[p]!;
    let left = col.wpLeft[p]!;
    while (left > 0 && blk >= 0) {
      const base = blk * NAV_BLOCK_WORDS;
      const cnt = bi[base + 1]!;
      while (pos < cnt && left > 0) {
        const cur = st.cellOfFx(bi[base + 2 + pos]!, bi[base + 3 + pos]!);
        const ax = prev & mask;
        const az = prev >> shift;
        const bx = cur & mask;
        const bz = cur >> shift;
        this.setSectorsOfRect(p, Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz));
        prev = cur;
        pos += 2;
        left--;
      }
      blk = bi[base]!;
      pos = 0;
    }
    if (col.absLeft[p]! > 0) {
      const r = col.refCell[p]!;
      this.setSectorsOfRect(p, r & mask, r >> shift, r & mask, r >> shift);
      blk = col.absHead[p]!;
      pos = col.absPos[p]!;
      left = col.absLeft[p]!;
      while (left > 0 && blk >= 0) {
        const base = blk * NAV_BLOCK_WORDS;
        const cnt = bi[base + 1]!;
        while (pos < cnt && left > 0) {
          const c = bi[base + 2 + pos]!;
          this.setSectorsOfRect(p, c & mask, c >> shift, c & mask, c >> shift);
          pos++;
          left--;
        }
        blk = bi[base]!;
        pos = 0;
      }
    }
  }
}

function oldIntra(oeb: number, i: number, j: number): number {
  const a = i < j ? i : j;
  const b = i < j ? j : i;
  const v = S.oldEdges[oeb + (((a * (2 * NAV_NODE_SLOTS - 1 - a)) >> 1) + b - a - 1)]!;
  return v === 0xffff ? -1 : v;
}
