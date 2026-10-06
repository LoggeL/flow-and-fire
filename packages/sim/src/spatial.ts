/**
 * Phase 8 SpatialRebuild (PLAN §3.4, S5): counting sort of all live units into the fine (4 WU)
 * and coarse (32 WU) grids. Buckets are cell-major with ascending slot order inside a cell, so
 * every query visits candidates in a deterministic order. Grids are derived state (full hash
 * only) and reflect the positions at rebuild time.
 *
 * MS1 keeps one grid pair for all layers (only land units exist); per-layer grids follow with
 * air units (MS12) without changing the query API.
 */
import { FINE_QUERY_MAX_RADIUS, UnitBits } from './constants.ts';
import type { SpatialGrid, World } from './world.ts';

function cellCoord(v: number, shift: number, dim: number): number {
  const c = v >> shift;
  return c < 0 ? 0 : c >= dim ? dim - 1 : c;
}

/** Counting-sort rebuild of one grid (phase 8; Movement also refreshes the fine grid before collisions). */
export function rebuildGrid(w: World, g: SpatialGrid): void {
  const units = w.units;
  const alive = units.alive;
  const flags = units.col.flags;
  const X = units.col.x;
  const Z = units.col.z;
  const hw = units.highWater;
  const dim = g.dim;
  const shift = g.shift;
  const cells = dim * dim;
  const start = g.start;
  const cursor = g.cursor;
  const items = g.items;
  const cellOf = g.cellOf;
  start.fill(0);
  // Pass 1: cell of every live slot, bucket sizes in start[c + 1].
  for (let i = 0; i < hw; i++) {
    if (alive[i] !== 1 || (flags[i]! & UnitBits.Dead) !== 0) {
      cellOf[i] = -1;
      continue;
    }
    const c = cellCoord(Z[i]!, shift, dim) * dim + cellCoord(X[i]!, shift, dim);
    cellOf[i] = c;
    start[c + 1] = start[c + 1]! + 1;
  }
  // Prefix sums → bucket begins; cursor = copy of the begins.
  for (let c = 0; c < cells; c++) {
    start[c + 1] = start[c + 1]! + start[c]!;
    cursor[c] = start[c]!;
  }
  // Pass 2: stable fill in ascending slot order.
  for (let i = 0; i < hw; i++) {
    const c = cellOf[i]!;
    if (c < 0) continue;
    const p = cursor[c]!;
    items[p] = i;
    cursor[c] = p + 1;
  }
}

/** Phase 8: rebuilds both grids. */
export function spatialRebuildPhase(w: World): void {
  rebuildGrid(w, w.fine);
  rebuildGrid(w, w.coarse);
}

/** Visitor of radius queries (an object instead of a closure: no allocation per query). */
export interface UnitVisitor {
  /** Called per unit slot in range; return false to stop the query. */
  visit(slot: number): boolean;
}

function gridFor(w: World, r: number): SpatialGrid {
  return r <= FINE_QUERY_MAX_RADIUS ? w.fine : w.coarse;
}

/**
 * Visits every unit whose position (current Units.x/z) lies within `r` (Fx) of (x, z) — among
 * the units registered in the grid at the last rebuild, in cell-major, ascending-slot order.
 * Returns the number of visited units.
 */
export function forEachInRadius(w: World, x: number, z: number, r: number, visitor: UnitVisitor): number {
  const g = gridFor(w, r);
  const dim = g.dim;
  const shift = g.shift;
  const x0 = cellCoord(x - r, shift, dim);
  const x1 = cellCoord(x + r, shift, dim);
  const z0 = cellCoord(z - r, shift, dim);
  const z1 = cellCoord(z + r, shift, dim);
  const start = g.start;
  const items = g.items;
  const X = w.units.col.x;
  const Z = w.units.col.z;
  const r2 = r * r;
  let n = 0;
  for (let cz = z0; cz <= z1; cz++) {
    const row = cz * dim;
    for (let cx = x0; cx <= x1; cx++) {
      const c = row + cx;
      const end = start[c + 1]!;
      for (let k = start[c]!; k < end; k++) {
        const u = items[k]!;
        const dx = X[u]! - x;
        const dz = Z[u]! - z;
        if (dx * dx + dz * dz > r2) continue;
        n++;
        if (!visitor.visit(u)) return n;
      }
    }
  }
  return n;
}

/** Collecting visitor behind queryRadius. */
class CollectVisitor implements UnitVisitor {
  out: Int32Array = new Int32Array(0);
  n = 0;
  visit(slot: number): boolean {
    if (this.n >= this.out.length) return false;
    this.out[this.n++] = slot;
    return true;
  }
}
const COLLECT = new CollectVisitor();
const EMPTY = new Int32Array(0);

/**
 * Writes the slots within `r` of (x, z) into `out` (same order as forEachInRadius) and returns
 * how many were written (at most out.length).
 */
export function queryRadius(w: World, x: number, z: number, r: number, out: Int32Array): number {
  COLLECT.out = out;
  COLLECT.n = 0;
  forEachInRadius(w, x, z, r, COLLECT);
  const n = COLLECT.n;
  COLLECT.out = EMPTY;
  return n;
}
