/**
 * Spiral search (PLAN §3.8 "Unerreichbare Ziele → Spiralsuche"): Chebyshev rings around a centre
 * cell, each ring in a fixed order (top row west → east, east column north → south, bottom row
 * east → west, west column south → north). Returns the matching cell with the smallest squared
 * Euclidean distance to the centre; ties go to the cell found first. Rings are searched until
 * r² exceeds the best distance found, so the result is the true nearest match.
 */

import { NAV_CLASSES } from './constants.ts';
import { nextGen, S } from './scratch.ts';
import { DIR_X, DIR_Z } from './search.ts';
import type { NavState } from './state.ts';

/** Cells examined by the last spiral search (counted as expansions by the PathService / 8). */
export const spiral = { cells: 0 };

/** Match modes. */
export const SPIRAL_PASSABLE = 0;
export const SPIRAL_LABEL = 1;

function matches(st: NavState, cls: number, mode: number, label: number, c: number): boolean {
  if (st.clear[c]! < cls) return false;
  if (mode === SPIRAL_PASSABLE) return true;
  return st.comp[(cls - 1) * st.n + c] === label;
}

/**
 * Nearest cell to `center` that is passable for `cls` (mode SPIRAL_PASSABLE) or belongs to
 * component `label` of `cls` (mode SPIRAL_LABEL). Searches at most `maxR` rings; −1 if none.
 */
export function spiralSearch(st: NavState, cls: number, center: number, mode: number, label: number, maxR: number): number {
  if (cls < 1 || cls > NAV_CLASSES) throw new RangeError(`nav: class ${cls} out of range`);
  const size = st.size;
  const shift = st.shift;
  const cx = center & st.mask;
  const cz = center >> shift;
  spiral.cells = 1;
  if (matches(st, cls, mode, label, center)) return center;
  let best = -1;
  let bestD = 0x7fffffff;
  for (let r = 1; r <= maxR; r++) {
    if (best >= 0 && r * r > bestD) break;
    if (cx - r < 0 && cz - r < 0 && cx + r >= size && cz + r >= size) break;
    spiral.cells += 8 * r;
    // top row (z = cz − r), x from cx − r to cx + r
    let z = cz - r;
    if (z >= 0) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (x < 0 || x >= size) continue;
        const c = (z << shift) | x;
        if (!matches(st, cls, mode, label, c)) continue;
        const d = (x - cx) * (x - cx) + r * r;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
    }
    // east column (x = cx + r), z from cz − r + 1 to cz + r
    let x = cx + r;
    if (x < size) {
      for (z = cz - r + 1; z <= cz + r; z++) {
        if (z < 0 || z >= size) continue;
        const c = (z << shift) | x;
        if (!matches(st, cls, mode, label, c)) continue;
        const d = r * r + (z - cz) * (z - cz);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
    }
    // bottom row (z = cz + r), x from cx + r − 1 down to cx − r
    z = cz + r;
    if (z < size) {
      for (x = cx + r - 1; x >= cx - r; x--) {
        if (x < 0 || x >= size) continue;
        const c = (z << shift) | x;
        if (!matches(st, cls, mode, label, c)) continue;
        const d = (x - cx) * (x - cx) + r * r;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
    }
    // west column (x = cx − r), z from cz + r − 1 down to cz − r + 1
    x = cx - r;
    if (x >= 0) {
      for (z = cz + r - 1; z >= cz - r + 1; z--) {
        if (z < 0 || z >= size) continue;
        const c = (z << shift) | x;
        if (!matches(st, cls, mode, label, c)) continue;
        const d = r * r + (z - cz) * (z - cz);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
    }
  }
  return best;
}

/**
 * Position of cell (x, z) in the spiral order around (cx, cz): ring · 8·ring + index in the ring
 * (top row west → east, east column north → south, bottom row east → west, west column south →
 * north). Smaller = found earlier by spiralSearch.
 */
function spiralKey(x: number, z: number, cx: number, cz: number): number {
  const dx = x - cx;
  const dz = z - cz;
  const ax = dx < 0 ? (0 - dx) | 0 : dx;
  const az = dz < 0 ? (0 - dz) | 0 : dz;
  const r = ax > az ? ax : az;
  let pos: number;
  // Keep the zero-radius key in the integer domain (unary minus produces -0).
  if (dz === ((0 - r) | 0)) pos = dx + r;
  else if (dx === r) pos = 2 * r + (dz + r);
  else if (dz === r) pos = 4 * r + (r - dx);
  else pos = 6 * r + (r - dz);
  return (r * 8 * r + pos) | 0;
}

/**
 * Same result as spiralSearch(…, SPIRAL_LABEL, label, …) for a component of at most `cap` cells,
 * found by flooding the component from its smallest cell (compMeta) instead of scanning rings
 * around a far goal: nearest by squared distance, ties by spiral order. Returns −2 if the
 * component has more than `cap` cells (use the spiral), −1 if it is empty. Cells visited in
 * `spiral.cells`.
 */
export function nearestInComponent(st: NavState, cls: number, label: number, center: number, cap: number, minCell: number): number {
  const off = (cls - 1) * st.n;
  const comp = st.comp;
  spiral.cells = 0;
  if (minCell < 0 || comp[off + minCell] !== label) return -1;
  const gen = nextGen();
  const mark = S.mark;
  const q = S.list;
  const shift = st.shift;
  const mask = st.mask;
  const cx = center & mask;
  const cz = center >> shift;
  let head = 0;
  let tail = 0;
  q[tail++] = minCell;
  mark[minCell] = gen;
  let best = -1;
  let bestD = 0x7fffffff;
  let bestK = 0x7fffffff;
  while (head < tail) {
    const c = q[head++]!;
    const x = c & mask;
    const z = c >> shift;
    const d = (x - cx) * (x - cx) + (z - cz) * (z - cz);
    if (d <= bestD) {
      const k = spiralKey(x, z, cx, cz);
      if (d < bestD || k < bestK) {
        bestD = d;
        bestK = k;
        best = c;
      }
    }
    for (let dir = 0; dir < 8; dir++) {
      const nx = x + DIR_X[dir]!;
      const nz = z + DIR_Z[dir]!;
      if (nx < 0 || nz < 0 || nx >= st.size || nz >= st.size) continue;
      const j = (nz << shift) | nx;
      if (mark[j] === gen || comp[off + j] !== label) continue;
      mark[j] = gen;
      if (tail >= cap) {
        spiral.cells = tail;
        return -2;
      }
      q[tail++] = j;
    }
  }
  spiral.cells = tail;
  return best;
}
