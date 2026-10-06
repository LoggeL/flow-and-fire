/**
 * Supercover lines between cell centres, clearance line of sight and string pulling (PLAN §3.8).
 *
 * The supercover of the segment from the centre of cell a to the centre of cell b visits every cell
 * the segment touches: stepping in x or z by comparing (1 + 2·nx)·|dz| with (1 + 2·nz)·|dx|; when
 * the segment passes exactly through a cell corner, both side cells are visited as well (so a
 * clear line never cuts a blocked corner). LOS for class s: every supercover cell has clearance ≥ s.
 */

import type { NavState } from './state.ts';

/** True if every supercover cell between the centres of cells a and b has clearance ≥ cls. */
export function losClear(st: NavState, cls: number, a: number, b: number): boolean {
  const clear = st.clear;
  const shift = st.shift;
  const mask = st.mask;
  const size = st.size;
  const x = a & mask;
  const z = a >> shift;
  const x1 = b & mask;
  const z1 = b >> shift;
  const dx = x1 > x ? x1 - x : x - x1;
  const dz = z1 > z ? z1 - z : z - z1;
  const sx = x1 > x ? 1 : -1;
  const sz = z1 > z ? size : -size;
  let c = a;
  if (clear[c]! < cls) return false;
  let nx = 0;
  let nz = 0;
  while (nx < dx || nz < dz) {
    const d = (1 + 2 * nx) * dz - (1 + 2 * nz) * dx;
    if (d === 0) {
      if (clear[c + sx]! < cls || clear[c + sz]! < cls) return false;
      c += sx + sz;
      nx++;
      nz++;
    } else if (d < 0) {
      c += sx;
      nx++;
    } else {
      c += sz;
      nz++;
    }
    if (clear[c]! < cls) return false;
  }
  return true;
}

/**
 * True if a supercover cell between the centres of cells a and b lies inside the rectangle
 * [rx0, rx1) × [rz0, rz1).
 */
export function supercoverHitsRect(
  st: NavState,
  a: number,
  b: number,
  rx0: number,
  rz0: number,
  rx1: number,
  rz1: number,
): boolean {
  const shift = st.shift;
  const mask = st.mask;
  let x = a & mask;
  let z = a >> shift;
  const x1 = b & mask;
  const z1 = b >> shift;
  // quick reject by bounding boxes
  const minx = x < x1 ? x : x1;
  const maxx = x < x1 ? x1 : x;
  const minz = z < z1 ? z : z1;
  const maxz = z < z1 ? z1 : z;
  if (maxx < rx0 || minx >= rx1 || maxz < rz0 || minz >= rz1) return false;
  const dx = maxx - minx;
  const dz = maxz - minz;
  const sx = x1 > x ? 1 : -1;
  const sz = z1 > z ? 1 : -1;
  if (x >= rx0 && x < rx1 && z >= rz0 && z < rz1) return true;
  let nx = 0;
  let nz = 0;
  while (nx < dx || nz < dz) {
    const d = (1 + 2 * nx) * dz - (1 + 2 * nz) * dx;
    if (d === 0) {
      if (x + sx >= rx0 && x + sx < rx1 && z >= rz0 && z < rz1) return true;
      if (x >= rx0 && x < rx1 && z + sz >= rz0 && z + sz < rz1) return true;
      x += sx;
      z += sz;
      nx++;
      nz++;
    } else if (d < 0) {
      x += sx;
      nx++;
    } else {
      z += sz;
      nz++;
    }
    if (x >= rx0 && x < rx1 && z >= rz0 && z < rz1) return true;
  }
  return false;
}

/**
 * Visits the supercover cells between the centres of a and b, writing them to `out` from `pos`;
 * returns the new end. For tests, debugging and overlays.
 */
export function supercoverCells(st: NavState, a: number, b: number, out: Int32Array, pos: number): number {
  const shift = st.shift;
  const mask = st.mask;
  const size = st.size;
  const x0 = a & mask;
  const z0 = a >> shift;
  const x1 = b & mask;
  const z1 = b >> shift;
  const dx = x1 > x0 ? x1 - x0 : x0 - x1;
  const dz = z1 > z0 ? z1 - z0 : z0 - z1;
  const sx = x1 > x0 ? 1 : -1;
  const sz = z1 > z0 ? size : -size;
  let c = a;
  out[pos++] = c;
  let nx = 0;
  let nz = 0;
  while (nx < dx || nz < dz) {
    const d = (1 + 2 * nx) * dz - (1 + 2 * nz) * dx;
    if (d === 0) {
      out[pos++] = c + sx;
      out[pos++] = c + sz;
      c += sx + sz;
      nx++;
      nz++;
    } else if (d < 0) {
      c += sx;
      nx++;
    } else {
      c += sz;
      nz++;
    }
    out[pos++] = c;
  }
  return pos;
}

/**
 * String pulling of a cell path cells[0..n): greedy farthest-visible cell with clearance LOS.
 * Writes the waypoint cells (without cells[0], always ending with cells[n − 1]) to `out` (may alias
 * `cells`) and returns their count.
 */
export function stringPull(st: NavState, cls: number, cells: Int32Array, n: number, out: Int32Array): number {
  let m = 0;
  let a = 0;
  while (a < n - 1) {
    let j = a + 1;
    const anchor = cells[a]!;
    while (j + 1 < n && losClear(st, cls, anchor, cells[j + 1]!)) j++;
    out[m++] = cells[j]!;
    a = j;
  }
  return m;
}
