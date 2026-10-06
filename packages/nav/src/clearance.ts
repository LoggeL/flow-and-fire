/**
 * M5 clearance: Chebyshev distance to the nearest blocked cell (terrain blocked or footprint > 0),
 * capped at NAV_MAX_CLEARANCE. Two-pass chamfer transform with unit weights on the 8-neighbourhood
 * (exact for the chessboard metric). The local variant recomputes a window around a changed
 * rectangle and writes back only the affected cells, recording every changed cell and its old
 * value (S.chCell / S.chOld) for the component and sector updates.
 */

import { NAV_MAX_CLEARANCE } from './constants.ts';
import { S, WIN_EDGE } from './scratch.ts';
import type { NavState } from './state.ts';

const CAP = NAV_MAX_CLEARANCE;

/** Recomputes the whole clearance grid. */
export function rebuildClearance(st: NavState): void {
  const size = st.size;
  const t = st.terrain;
  const f = st.foot;
  const c = st.clear;
  // forward pass
  for (let z = 0; z < size; z++) {
    const row = z * size;
    for (let x = 0; x < size; x++) {
      const i = row + x;
      if (t[i] === 0 || f[i] !== 0) {
        c[i] = 0;
        continue;
      }
      let m = CAP - 1;
      if (x > 0) m = Math.min(m, c[i - 1]!);
      if (z > 0) {
        m = Math.min(m, c[i - size]!);
        if (x > 0) m = Math.min(m, c[i - size - 1]!);
        if (x < size - 1) m = Math.min(m, c[i - size + 1]!);
      }
      c[i] = m + 1;
    }
  }
  // backward pass
  for (let z = size - 1; z >= 0; z--) {
    const row = z * size;
    for (let x = size - 1; x >= 0; x--) {
      const i = row + x;
      const v = c[i]!;
      if (v === 0) continue;
      let m = v - 1;
      if (x < size - 1) m = Math.min(m, c[i + 1]!);
      if (z < size - 1) {
        m = Math.min(m, c[i + size]!);
        if (x < size - 1) m = Math.min(m, c[i + size + 1]!);
        if (x > 0) m = Math.min(m, c[i + size - 1]!);
      }
      c[i] = m + 1;
    }
  }
}

/** Result of a local clearance update: number of changed cells and their bounding box. */
export const clearChange = { count: 0, x0: 0, z0: 0, x1: 0, z1: 0 };

/**
 * Recomputes clearance for all cells within Chebyshev distance CAP − 1 of the rectangle
 * [rx0, rx1) × [rz0, rz1) (the only cells whose clearance can change when blockedness changes
 * inside it). Changed cells are appended to S.chCell/S.chOld; bbox in `clearChange` (exclusive).
 */
export function updateClearanceLocal(st: NavState, rx0: number, rz0: number, rx1: number, rz1: number): void {
  const size = st.size;
  const reach = CAP - 1;
  // Affected area A (written back) and window W = A expanded by CAP (context).
  const ax0 = Math.max(0, rx0 - reach);
  const az0 = Math.max(0, rz0 - reach);
  const ax1 = Math.min(size, rx1 + reach);
  const az1 = Math.min(size, rz1 + reach);
  const wx0 = Math.max(0, ax0 - CAP);
  const wz0 = Math.max(0, az0 - CAP);
  const wx1 = Math.min(size, ax1 + CAP);
  const wz1 = Math.min(size, az1 + CAP);
  const ww = wx1 - wx0;
  const wh = wz1 - wz0;
  if (ww > WIN_EDGE || wh > WIN_EDGE) throw new RangeError('nav: clearance window too large');
  const w = S.win;
  const t = st.terrain;
  const f = st.foot;
  // forward
  for (let z = 0; z < wh; z++) {
    const grow = (z + wz0) * size + wx0;
    const lrow = z * ww;
    for (let x = 0; x < ww; x++) {
      const gi = grow + x;
      const li = lrow + x;
      if (t[gi] === 0 || f[gi] !== 0) {
        w[li] = 0;
        continue;
      }
      let m = CAP - 1;
      if (x > 0) m = Math.min(m, w[li - 1]!);
      if (z > 0) {
        m = Math.min(m, w[li - ww]!);
        if (x > 0) m = Math.min(m, w[li - ww - 1]!);
        if (x < ww - 1) m = Math.min(m, w[li - ww + 1]!);
      }
      w[li] = m + 1;
    }
  }
  // backward
  for (let z = wh - 1; z >= 0; z--) {
    const lrow = z * ww;
    for (let x = ww - 1; x >= 0; x--) {
      const li = lrow + x;
      const v = w[li]!;
      if (v === 0) continue;
      let m = v - 1;
      if (x < ww - 1) m = Math.min(m, w[li + 1]!);
      if (z < wh - 1) {
        m = Math.min(m, w[li + ww]!);
        if (x < ww - 1) m = Math.min(m, w[li + ww + 1]!);
        if (x > 0) m = Math.min(m, w[li + ww - 1]!);
      }
      w[li] = m + 1;
    }
  }
  // write back A
  const c = st.clear;
  let n = 0;
  let bx0 = size;
  let bz0 = size;
  let bx1 = 0;
  let bz1 = 0;
  for (let z = az0; z < az1; z++) {
    for (let x = ax0; x < ax1; x++) {
      const gi = z * size + x;
      const v = w[(z - wz0) * ww + (x - wx0)]!;
      const old = c[gi]!;
      if (v !== old) {
        S.chCell[n] = gi;
        S.chOld[n] = old;
        n++;
        c[gi] = v;
        if (x < bx0) bx0 = x;
        if (z < bz0) bz0 = z;
        if (x >= bx1) bx1 = x + 1;
        if (z >= bz1) bz1 = z + 1;
      }
    }
  }
  clearChange.count = n;
  clearChange.x0 = bx0;
  clearChange.z0 = bz0;
  clearChange.x1 = bx1;
  clearChange.z1 = bz1;
}
