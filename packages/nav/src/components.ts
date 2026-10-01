/**
 * M5 connectivity: components per class (8-neighbourhood without corner cutting, the same moves as
 * the fine search). Labels are canonical: label k is the component with the k-th smallest minimum
 * cell index (scan order), so a full rebuild and any sequence of local updates produce identical
 * bytes. Components beyond NAV_MAX_COMPONENTS get NAV_COMP_OVERFLOW; a class in that state is
 * always rebuilt in full.
 *
 * Local update after a stamp (only the old components touching the changed cells are re-labelled):
 *  - removal (delta 1): per affected label an interleaved BFS from the cells next to the removed
 *    ones finds the pieces the component splits into; it stops as soon as at most one group is
 *    still growing, so the cost is the size of the small pieces, not of the component;
 *  - addition (delta −1): pieces of new cells join all components they touch (union of labels),
 *    without flooding the existing components.
 * Then the changed entries are merged into the canonical order; if any label changes its rank, all
 * labels are rewritten in one linear pass (label substitution, no flood).
 */

import { NAV_COMP_OVERFLOW, NAV_MAX_COMPONENTS } from './constants.ts';
import { COMP_META_WORDS } from './regions.ts';
import { nextGen, S } from './scratch.ts';
import { DIR_X, DIR_Z } from './search.ts';
import type { NavState } from './state.ts';

/**
 * Floods the component of `seed` (passable for `cls`) over cells whose visit mark != `gen`, marking
 * them with `gen`, appending them to `out` from `outPos`. Returns the new end position.
 * Cells are visited only if `cond(cell)` is true: here, passability plus (optionally) a box.
 */
function flood(
  st: NavState,
  cls: number,
  seed: number,
  gen: number,
  out: Int32Array,
  outPos: number,
  bx0: number,
  bz0: number,
  bx1: number,
  bz1: number,
): number {
  const mark = S.mark;
  const clear = st.clear;
  const size = st.size;
  const shift = st.shift;
  const mask = st.mask;
  let head = outPos;
  let tail = outPos;
  out[tail++] = seed;
  mark[seed] = gen;
  while (head < tail) {
    const c = out[head++]!;
    const x = c & mask;
    const z = c >> shift;
    for (let d = 0; d < 8; d++) {
      const nx = x + DIR_X[d]!;
      const nz = z + DIR_Z[d]!;
      if (nx < bx0 || nx >= bx1 || nz < bz0 || nz >= bz1) continue;
      const j = (nz << shift) | nx;
      if (mark[j] === gen || clear[j]! < cls) continue;
      if (d >= 4 && (clear[c + DIR_X[d]!]! < cls || clear[c + DIR_Z[d]! * size]! < cls)) continue;
      mark[j] = gen;
      out[tail++] = j;
    }
  }
  return tail;
}

/** Full relabel of one class. */
export function relabelClass(st: NavState, cls: number): void {
  const n = st.n;
  const off = (cls - 1) * n;
  const mo = (cls - 1) * COMP_META_WORDS;
  const comp = st.comp;
  const clear = st.clear;
  const meta = st.compMeta;
  const gen = nextGen();
  const mark = S.mark;
  const list = S.list;
  const size = st.size;
  let count = 0;
  comp.fill(0, off, off + n);
  for (let i = 0; i < n; i++) {
    if (clear[i]! < cls || mark[i] === gen) continue;
    count++;
    const label = count <= NAV_MAX_COMPONENTS ? count : NAV_COMP_OVERFLOW;
    if (count <= NAV_MAX_COMPONENTS) meta[mo + count] = i;
    const end = flood(st, cls, i, gen, list, 0, 0, 0, size, size);
    for (let k = 0; k < end; k++) comp[off + list[k]!] = label;
  }
  meta[mo] = count;
  for (let l = Math.min(count, NAV_MAX_COMPONENTS) + 1; l < COMP_META_WORDS; l++) meta[mo + l] = 0;
}

/** Full rebuild of all classes. */
export function rebuildComponents(st: NavState, classes: number): void {
  for (let c = 1; c <= classes; c++) relabelClass(st, c);
}

/** Valid move from c in direction d for class cls (target inside the map, no corner cutting). */
function canMove(st: NavState, cls: number, c: number, d: number): number {
  const x = (c & st.mask) + DIR_X[d]!;
  const z = (c >> st.shift) + DIR_Z[d]!;
  if (x < 0 || z < 0 || x >= st.size || z >= st.size) return -1;
  const j = (z << st.shift) | x;
  const clear = st.clear;
  if (clear[j]! < cls) return -1;
  if (d >= 4 && (clear[c + DIR_X[d]!]! < cls || clear[c + DIR_Z[d]! * st.size]! < cls)) return -1;
  return j;
}

// Union-find over small group ids (scratch).
function ufFind(parent: Int32Array, g: number): number {
  let r = g;
  while (parent[r] !== r) r = parent[r]!;
  while (parent[g] !== r) {
    const n = parent[g]!;
    parent[g] = r;
    g = n;
  }
  return r;
}

/** A component entry of the canonical re-ranking: min cell, and where its cells are. */
const E_OLD = 0; // an old label (cells keep/get remapped through `remap`)
const E_NEW = 1; // a new piece whose cells are listed in S.list2[start, start + len)

let nEntries = 0;
/** Number of affected old labels (S.labels[0, nAffected)). */
let nAffected = 0;

function pushEntry(kind: number, min: number, label: number, start: number, len: number): boolean {
  if (nEntries >= S.compMin.length) return false;
  const k = nEntries++;
  S.compOrder[k] = kind;
  S.compMin[k] = min;
  S.labels2[k] = label;
  S.compStart[k] = start;
  S.compLen[k] = len;
  return true;
}

/**
 * Local component update of class `cls` after `updateClearanceLocal` (changed cells in
 * S.chCell/S.chOld[0, nChanged)). A stamp either only removes passable cells (delta 1) or only adds
 * them (delta −1), never both.
 */
export function updateComponentsLocal(st: NavState, cls: number, nChanged: number): void {
  const n = st.n;
  const off = (cls - 1) * n;
  const mo = (cls - 1) * COMP_META_WORDS;
  const comp = st.comp;
  const clear = st.clear;
  const meta = st.compMeta;
  let nRem = 0;
  let nAdd = 0;
  for (let k = 0; k < nChanged; k++) {
    const c = S.chCell[k]!;
    const was = S.chOld[k]! >= cls;
    const now = clear[c]! >= cls;
    if (was === now) continue;
    if (was) S.rem[nRem++] = c;
    else S.add[nAdd++] = c;
  }
  if (nRem === 0 && nAdd === 0) return;
  if (meta[mo]! > NAV_MAX_COMPONENTS || (nRem > 0 && nAdd > 0)) {
    relabelClass(st, cls);
    return;
  }
  nEntries = 0;
  let ok: boolean;
  if (nRem > 0) ok = removeCells(st, cls, nRem);
  else ok = addCells(st, cls, nAdd);
  if (!ok) {
    relabelClass(st, cls);
    return;
  }
  rerank(st, cls, off, mo, comp, meta);
}

/** Collects the distinct labels of `cells` (old values) into S.labels[0, n) ascending; marks them in lmark. */
function collectLabels(comp: Uint16Array, off: number, cells: Int32Array, count: number, st: NavState, cls: number, neighbours: boolean): number {
  S.lgen++;
  if (S.lgen > 0x3ffffff0) {
    S.lmark.fill(0);
    S.lgen = 1;
  }
  const lgen = S.lgen;
  const lmark = S.lmark;
  const A = S.labels;
  let nA = 0;
  for (let k = 0; k < count; k++) {
    const c = cells[k]!;
    for (let d = neighbours ? 0 : -1; d < (neighbours ? 8 : 0); d++) {
      const j = d < 0 ? c : canMove(st, cls, c, d);
      if (j < 0) continue;
      const l = comp[off + j]!;
      if (l === 0 || lmark[l] === lgen) continue;
      lmark[l] = lgen;
      let p = nA++;
      while (p > 0 && A[p - 1]! > l) {
        A[p] = A[p - 1]!;
        p--;
      }
      A[p] = l;
    }
  }
  return nA;
}

/**
 * Removal: for every affected label L, an interleaved BFS from all cells of L next to the removed
 * cells finds the pieces L splits into. Groups that meet are merged; a group whose frontier runs
 * empty is a complete piece; the search stops when at most one group is still growing (that one
 * is the rest of L and keeps its label). Cost ~ size of the small pieces, not of the component.
 */
function removeCells(st: NavState, cls: number, nRem: number): boolean {
  const off = (cls - 1) * st.n;
  const mo = (cls - 1) * COMP_META_WORDS;
  const comp = st.comp;
  const meta = st.compMeta;
  const nA = collectLabels(comp, off, S.rem, nRem, st, cls, false);
  nAffected = nA;
  for (let i = 0; i < nA; i++) S.aliasOf[S.labels[i]!] = S.labels[i]!;
  for (let k = 0; k < nRem; k++) comp[off + S.rem[k]!] = 0;
  const parent = S.ufParent;
  const cnt = S.ufCount;
  const gmin = S.ufMin;
  const fin = S.ufDone;
  const grp = S.G; // group id per visited cell (scratch of the fine search, unused here)
  const q = S.list;
  let pieceCells = 0; // write position in S.list2
  for (let ai = 0; ai < nA; ai++) {
    const L = S.labels[ai]!;
    const gen = nextGen();
    const mark = S.mark;
    // seeds: cells of L adjacent (valid move) to a removed cell
    let ng = 0;
    let tail = 0;
    for (let k = 0; k < nRem; k++) {
      const r = S.rem[k]!;
      for (let d = 0; d < 8; d++) {
        const x = (r & st.mask) + DIR_X[d]!;
        const z = (r >> st.shift) + DIR_Z[d]!;
        if (x < 0 || z < 0 || x >= st.size || z >= st.size) continue;
        const j = (z << st.shift) | x;
        if (comp[off + j] !== L || mark[j] === gen) continue;
        if (ng >= parent.length) return false;
        mark[j] = gen;
        grp[j] = ng;
        parent[ng] = ng;
        cnt[ng] = 1;
        gmin[ng] = j;
        fin[ng] = 0;
        ng++;
        q[tail++] = j;
      }
    }
    if (ng === 0) continue; // L consisted of removed cells only: it vanishes
    let active = ng;
    let head = 0;
    while (active > 1 && head < tail) {
      const c = q[head++]!;
      let r = ufFind(parent, grp[c]!);
      cnt[r] = cnt[r]! - 1;
      for (let d = 0; d < 8; d++) {
        const j = canMove(st, cls, c, d);
        if (j < 0 || comp[off + j] !== L) continue;
        if (mark[j] !== gen) {
          mark[j] = gen;
          grp[j] = r;
          cnt[r] = cnt[r]! + 1;
          if (j < gmin[r]!) gmin[r] = j;
          q[tail++] = j;
        } else {
          const r2 = ufFind(parent, grp[j]!);
          if (r2 !== r) {
            // merge the larger id into the smaller (deterministic)
            const a = r < r2 ? r : r2;
            const b = r < r2 ? r2 : r;
            parent[b] = a;
            cnt[a] = cnt[a]! + cnt[b]!;
            if (gmin[b]! < gmin[a]!) gmin[a] = gmin[b]!;
            active--;
            r = a;
          }
        }
      }
      if (cnt[r] === 0) {
        fin[r] = 1;
        active--;
      }
    }
    // roots: finished pieces and at most one growing rest
    let rest = -1;
    let pieces = 0;
    for (let g = 0; g < ng; g++) {
      if (parent[g] !== g) continue;
      if (fin[g] === 1) pieces++;
      else rest = g;
    }
    if (pieces === 0) {
      // no split: L keeps its cells; only its smallest cell may have been removed
      let mn = meta[mo + L]!;
      if (comp[off + mn] !== L) {
        mn++;
        while (mn < st.n && comp[off + mn] !== L) mn++;
      }
      if (!pushEntry(E_OLD, mn, L, 0, 0)) return false;
      continue;
    }
    // finished pieces become new entries; their cells are copied to S.list2
    for (let g = 0; g < ng; g++) {
      if (parent[g] !== g || fin[g] !== 1) continue;
      const start = pieceCells;
      for (let k = 0; k < tail; k++) {
        const c = q[k]!;
        if (ufFind(parent, grp[c]!) === g) S.list2[pieceCells++] = c;
      }
      if (!pushEntry(E_NEW, gmin[g]!, 0, start, pieceCells - start)) return false;
    }
    if (rest >= 0) {
      // the rest keeps L; its smallest cell: scan from the old minimum, skipping finished pieces
      let mn = meta[mo + L]!;
      while (mn < st.n) {
        if (comp[off + mn] === L && !(mark[mn] === gen && fin[ufFind(parent, grp[mn]!)] === 1)) break;
        mn++;
      }
      if (!pushEntry(E_OLD, mn, L, 0, 0)) return false;
    }
  }
  return true;
}

/**
 * Addition: pieces of newly passable cells join every component they touch (union of labels);
 * a piece touching nothing is a new component. No flood of existing components is needed: merged
 * labels are rewritten by the remap pass.
 */
function addCells(st: NavState, cls: number, nAdd: number): boolean {
  const off = (cls - 1) * st.n;
  const mo = (cls - 1) * COMP_META_WORDS;
  const comp = st.comp;
  const meta = st.compMeta;
  const nA = collectLabels(comp, off, S.add, nAdd, st, cls, true);
  nAffected = nA;
  const parent = S.ufParent;
  const gmin = S.ufMin;
  const lidx = S.remap; // label → union index (for labels in A)
  // union indices: 0..nA−1 = labels of A, nA.. = pieces of added cells
  if (nA + nAdd > parent.length) return false;
  for (let i = 0; i < nA; i++) {
    parent[i] = i;
    gmin[i] = meta[mo + S.labels[i]!]!;
    lidx[S.labels[i]!] = i;
  }
  const gen = nextGen();
  const mark = S.mark;
  const grp = S.G;
  const q = S.list;
  let ng = nA;
  // mark added cells (label 0 & passable & listed)
  for (let k = 0; k < nAdd; k++) S.tmark[S.add[k]!] = gen;
  let tail = 0;
  for (let k = 0; k < nAdd; k++) {
    const seed = S.add[k]!;
    if (mark[seed] === gen) continue;
    const g = ng++;
    parent[g] = g;
    gmin[g] = seed;
    mark[seed] = gen;
    grp[seed] = g;
    let head = tail;
    q[tail++] = seed;
    while (head < tail) {
      const c = q[head++]!;
      if (c < gmin[g]!) gmin[g] = c;
      for (let d = 0; d < 8; d++) {
        const j = canMove(st, cls, c, d);
        if (j < 0) continue;
        if (S.tmark[j] === gen) {
          if (mark[j] !== gen) {
            mark[j] = gen;
            grp[j] = g;
            q[tail++] = j;
          }
        } else {
          const l = comp[off + j]!;
          if (l === 0) continue;
          // union piece g with label l
          const a = ufFind(parent, g);
          const b = ufFind(parent, lidx[l]!);
          if (a !== b) {
            const lo = a < b ? a : b;
            const hi = a < b ? b : a;
            parent[hi] = lo;
            if (gmin[hi]! < gmin[lo]!) gmin[lo] = gmin[hi]!;
          }
        }
      }
    }
  }
  // one entry per union root: an old label (the smallest member label carries the group) or a new piece
  const cells = S.list2;
  let pos = 0;
  for (let g = 0; g < ng; g++) {
    if (ufFind(parent, g) !== g) continue;
    if (g < nA) {
      // label group: the root is the smallest label of the group; all member labels and pieces
      // are rewritten to its new rank; list the piece cells
      const start = pos;
      for (let k = 0; k < tail; k++) {
        const c = q[k]!;
        if (ufFind(parent, grp[c]!) === g) cells[pos++] = c;
      }
      if (!pushEntry(E_OLD, gmin[g]!, S.labels[g]!, start, pos - start)) return false;
    } else {
      const start = pos;
      for (let k = 0; k < tail; k++) {
        const c = q[k]!;
        if (ufFind(parent, grp[c]!) === g) cells[pos++] = c;
      }
      if (!pushEntry(E_NEW, gmin[g]!, 0, start, pos - start)) return false;
    }
  }
  // merged labels map to the root label of their group
  for (let i = 0; i < nA; i++) S.aliasOf[S.labels[i]!] = S.labels[ufFind(parent, i)]!;
  return true;
}

/**
 * Canonical re-ranking: untouched labels (ascending = by min cell) are merged with the changed
 * entries (sorted by min cell). Affected old labels follow their entry (via S.aliasOf) or vanish
 * (0). If any label changes its rank, all labels are rewritten in one linear pass; cells listed by
 * the entries get their new labels afterwards.
 */
function rerank(st: NavState, cls: number, off: number, mo: number, comp: Uint16Array, meta: Int32Array): void {
  const count = meta[mo]!;
  const ne = nEntries;
  const order = S.compLabel;
  for (let e = 0; e < ne; e++) {
    let p = e;
    const m = S.compMin[e]!;
    while (p > 0 && S.compMin[order[p - 1]!]! > m) {
      order[p] = order[p - 1]!;
      p--;
    }
    order[p] = e;
  }
  const lmark = S.lmark;
  const lgen = S.lgen;
  const remap = S.remap;
  const newMeta = S.newMeta;
  const entryRank = S.labels3;
  let newCount = 0;
  let identity = true;
  let ei = 0;
  let u = 1;
  while (u <= count || ei < ne) {
    if (u <= count && lmark[u] === lgen) {
      u++;
      continue;
    }
    if (u <= count && (ei >= ne || meta[mo + u]! < S.compMin[order[ei]!]!)) {
      newCount++;
      if (newCount > NAV_MAX_COMPONENTS) break;
      remap[u] = newCount;
      newMeta[newCount] = meta[mo + u]!;
      if (newCount !== u) identity = false;
      u++;
    } else {
      const e = order[ei++]!;
      newCount++;
      if (newCount > NAV_MAX_COMPONENTS) break;
      entryRank[e] = newCount;
      newMeta[newCount] = S.compMin[e]!;
    }
  }
  if (newCount > NAV_MAX_COMPONENTS) {
    relabelClass(st, cls);
    return;
  }
  const rankOf = S.newMeta2;
  for (let i = 0; i < nAffected; i++) rankOf[S.labels[i]!] = 0;
  for (let e = 0; e < ne; e++) if (S.compOrder[e] === E_OLD) rankOf[S.labels2[e]!] = entryRank[e]!;
  for (let i = 0; i < nAffected; i++) {
    const L = S.labels[i]!;
    const r = rankOf[S.aliasOf[L]!]!;
    remap[L] = r;
    if (r !== L) identity = false;
  }
  if (!identity) {
    for (let i = off, e = off + st.n; i < e; i++) {
      const l = comp[i]!;
      if (l !== 0) comp[i] = remap[l]!;
    }
  }
  const cells = S.list2;
  for (let e = 0; e < ne; e++) {
    const label = entryRank[e]!;
    const s0 = S.compStart[e]!;
    const e0 = s0 + S.compLen[e]!;
    for (let k = s0; k < e0; k++) comp[off + cells[k]!] = label;
  }
  meta[mo] = newCount;
  for (let l = 1; l <= newCount; l++) meta[mo + l] = newMeta[l]!;
  for (let l = newCount + 1; l <= count; l++) meta[mo + l] = 0;
}
