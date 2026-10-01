/**
 * Brute-force evaluation of the corridor repath rule (`@faf/nav/check`, docs/status/ms3-p0-nav.md
 * "Korridorregel"), written independently of src/ (geometric supercover, own Dijkstra, direct
 * comparison of the sector graph before/after a stamp). Used by the nav repath test and by the L2
 * golden `obstacle-repath` (tools/headless), which checks `repathsTriggered` of the sim against it.
 *
 *  (a) refined part: a supercover cell of the remaining polyline (previous waypoint → waypoints)
 *      lies within Chebyshev distance cls of the footprint;
 *  (b) unrefined part, consecutive abstract cells a → b (starting at refCell):
 *      - same sector: the graph of that sector changed and a or b is no longer a node of the class,
 *        or the intra cost a → b is missing or higher than before;
 *      - adjacent sectors (portal): a graph changed and a/b are no longer partner nodes;
 *      - last step to the goal (goal leg): the footprint expanded by cls touches the goal sector
 *        and the best route a → goal inside that sector is missing or dearer than the stored leg.
 *
 * Not part of the simulation (allocates; only reads nav state). Deterministic nonetheless.
 */
import { NAV_CLASSES, NAV_EDGE_SLOTS, NAV_NODE_SLOTS, NAV_SECTOR_SIZE } from '../src/constants.ts';
import type { Nav, PathDebug } from '../src/nav.ts';

const FX = 4096;
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DZ = [0, 0, 1, -1, 1, -1, 1, -1];

/** Copy of the sector graph regions (nodes, intra edges). */
export interface NavGraphCopy {
  readonly nodes: Int32Array;
  readonly edges: Uint16Array;
}

/** Copies the current sector graph (take one before and one after a stamp). */
export function copyNavGraph(nav: Nav): NavGraphCopy {
  return { nodes: nav.st.nodes.slice(), edges: nav.st.edges.slice() };
}

/** Cells [x, z] whose closed unit square touches the segment between the centres of two cells. */
export function geometricSupercover(ax: number, az: number, bx: number, bz: number): [number, number][] {
  const out: [number, number][] = [];
  const Ax = 2 * ax + 1;
  const Az = 2 * az + 1;
  const Bx = 2 * bx + 1;
  const Bz = 2 * bz + 1;
  for (let z = Math.min(az, bz) - 1; z <= Math.max(az, bz) + 1; z++) {
    for (let x = Math.min(ax, bx) - 1; x <= Math.max(ax, bx) + 1; x++) {
      const sx0 = 2 * x;
      const sx1 = 2 * x + 2;
      const sz0 = 2 * z;
      const sz1 = 2 * z + 2;
      if (Math.max(Ax, Bx) < sx0 || Math.min(Ax, Bx) > sx1 || Math.max(Az, Bz) < sz0 || Math.min(Az, Bz) > sz1) continue;
      const dx = Bx - Ax;
      const dz = Bz - Az;
      let pos = false;
      let neg = false;
      for (const [cx, cz] of [
        [sx0, sz0],
        [sx1, sz0],
        [sx0, sz1],
        [sx1, sz1],
      ] as const) {
        const cr = dx * (cz - Az) - dz * (cx - Ax);
        if (cr > 0) pos = true;
        else if (cr < 0) neg = true;
        else {
          pos = true;
          neg = true;
        }
      }
      if (pos && neg) out.push([x, z]);
    }
  }
  return out;
}

/**
 * Reference Dijkstra (octile costs of @faf/nav, no corner cutting) from `src` inside the window
 * [x0, x1) × [z0, z1); distances per cell, −1 = unreachable.
 */
export function refDijkstra(
  clear: Uint8Array,
  terrain: Uint8Array,
  size: number,
  cls: number,
  src: number,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
): Int32Array {
  const dist = new Int32Array(size * size).fill(-1);
  if (clear[src]! < cls) return dist;
  const heapD: number[] = [];
  const heapC: number[] = [];
  const push = (d: number, c: number): void => {
    heapD.push(d);
    heapC.push(c);
    let i = heapD.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapD[p]! <= heapD[i]!) break;
      [heapD[p], heapD[i]] = [heapD[i]!, heapD[p]!];
      [heapC[p], heapC[i]] = [heapC[i]!, heapC[p]!];
      i = p;
    }
  };
  const pop = (): [number, number] => {
    const d = heapD[0]!;
    const c = heapC[0]!;
    const ld = heapD.pop()!;
    const lc = heapC.pop()!;
    if (heapD.length > 0) {
      heapD[0] = ld;
      heapC[0] = lc;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= heapD.length) break;
        let m = l;
        if (l + 1 < heapD.length && heapD[l + 1]! < heapD[l]!) m = l + 1;
        if (heapD[m]! >= heapD[i]!) break;
        [heapD[m], heapD[i]] = [heapD[i]!, heapD[m]!];
        [heapC[m], heapC[i]] = [heapC[i]!, heapC[m]!];
        i = m;
      }
    }
    return [d, c];
  };
  const best = new Int32Array(size * size).fill(0x7fffffff);
  best[src] = 0;
  push(0, src);
  while (heapD.length > 0) {
    const [d, c] = pop();
    if (dist[c] !== -1) continue;
    dist[c] = d;
    const x = c % size;
    const z = Math.floor(c / size);
    for (let k = 0; k < 8; k++) {
      const nx = x + DX[k]!;
      const nz = z + DZ[k]!;
      if (nx < x0 || nx >= x1 || nz < z0 || nz >= z1) continue;
      const j = nz * size + nx;
      if (clear[j]! < cls || dist[j] !== -1) continue;
      const diag = k >= 4;
      if (diag && (clear[z * size + nx]! < cls || clear[nz * size + x]! < cls)) continue;
      const kk = terrain[c]! - 1 + terrain[j]! - 1;
      const nd = d + (diag ? 14 + 3 * kk : 10 + 2 * kk);
      if (nd < best[j]!) {
        best[j] = nd;
        push(nd, j);
      }
    }
  }
  return dist;
}

function slotOf(g: NavGraphCopy, sec: number, cls: number, cell: number): number {
  const nb = (sec * NAV_CLASSES + cls - 1) * NAV_NODE_SLOTS;
  for (let k = 0; k < NAV_NODE_SLOTS; k++) if (g.nodes[nb + k] === cell) return k;
  return -1;
}

function pairCost(g: NavGraphCopy, sec: number, cls: number, i: number, j: number): number {
  if (i === j) return 0;
  const a = Math.min(i, j);
  const b = Math.max(i, j);
  const idx = (a * (2 * NAV_NODE_SLOTS - 1 - a)) / 2 + b - a - 1;
  const v = g.edges[(sec * NAV_CLASSES + cls - 1) * NAV_EDGE_SLOTS + idx]!;
  return v === 0xffff ? -1 : v;
}

function sectorChanged(o: NavGraphCopy, n: NavGraphCopy, sec: number): boolean {
  const nb = sec * NAV_CLASSES * NAV_NODE_SLOTS;
  for (let k = 0; k < NAV_CLASSES * NAV_NODE_SLOTS; k++) if (o.nodes[nb + k] !== n.nodes[nb + k]) return true;
  const eb = sec * NAV_CLASSES * NAV_EDGE_SLOTS;
  for (let k = 0; k < NAV_CLASSES * NAV_EDGE_SLOTS; k++) if (o.edges[eb + k] !== n.edges[eb + k]) return true;
  return false;
}

/**
 * True if the stamp of footprint `fr` = [x0, z0, x1, z1) (clipped cells) cuts the remaining
 * corridor of the path described by `d` (its state before the stamp). `nav` must hold the state
 * after the stamp (clearance, terrain), `o` / `n` are the graph copies before / after.
 */
export function corridorCutBrute(nav: Nav, d: PathDebug, fr: readonly [number, number, number, number], o: NavGraphCopy, n: NavGraphCopy): boolean {
  const st = nav.st;
  const size = st.size;
  const spe = size / NAV_SECTOR_SIZE;
  const cls = d.cls;
  const [fx0, fz0, fx1, fz1] = fr;
  const near = (x: number, z: number): boolean => x >= fx0 - cls && x < fx1 + cls && z >= fz0 - cls && z < fz1 + cls;
  const cx = (c: number): number => c % size;
  const cz = (c: number): number => Math.floor(c / size);
  const sec = (c: number): number => Math.floor(cz(c) / NAV_SECTOR_SIZE) * spe + Math.floor(cx(c) / NAV_SECTOR_SIZE);
  // (a) refined part
  let px = Math.floor(d.prevX / FX);
  let pz = Math.floor(d.prevZ / FX);
  for (let k = 0; k < d.waypoints.length; k += 2) {
    const x = Math.min(size - 1, Math.max(0, Math.floor(d.waypoints[k]! / FX)));
    const z = Math.min(size - 1, Math.max(0, Math.floor(d.waypoints[k + 1]! / FX)));
    for (const [sx, sz] of geometricSupercover(px, pz, x, z)) if (near(sx, sz)) return true;
    px = x;
    pz = z;
  }
  // (b) unrefined part
  let a = d.refCell;
  for (let k = 0; k < d.abs.length; k++) {
    const b = d.abs[k]!;
    if (k === d.abs.length - 1) {
      const s = sec(b);
      const x0 = (s % spe) * NAV_SECTOR_SIZE;
      const z0 = Math.floor(s / spe) * NAV_SECTOR_SIZE;
      const touches = fx1 + cls > x0 && fx0 - cls < x0 + NAV_SECTOR_SIZE && fz1 + cls > z0 && fz0 - cls < z0 + NAV_SECTOR_SIZE;
      if (touches) {
        const dist = refDijkstra(st.clear, st.terrain, size, cls, a, x0, z0, x0 + NAV_SECTOR_SIZE, z0 + NAV_SECTOR_SIZE);
        const c = dist[b]!;
        if (c < 0 || (d.legCost >= 0 && c > d.legCost)) return true;
      }
    } else if (a !== b) {
      const sa = sec(a);
      const sb = sec(b);
      if (sa === sb) {
        if (sectorChanged(o, n, sa)) {
          const oi = slotOf(o, sa, cls, a);
          const oj = slotOf(o, sa, cls, b);
          const ni = slotOf(n, sa, cls, a);
          const nj = slotOf(n, sa, cls, b);
          if (oi < 0 || oj < 0 || ni < 0 || nj < 0) return true;
          const oc = pairCost(o, sa, cls, oi, oj);
          const nc = pairCost(n, sa, cls, ni, nj);
          if (oc < 0 || nc < 0 || nc > oc) return true;
        }
      } else if (sectorChanged(o, n, sa) || sectorChanged(o, n, sb)) {
        const i = slotOf(n, sa, cls, a);
        const j = slotOf(n, sb, cls, b);
        if (i < 0 || j < 0) return true;
        const e = i >> 2;
        const opp = (e + 2) & 3;
        const dxs = (sb % spe) - (sa % spe);
        const dzs = Math.floor(sb / spe) - Math.floor(sa / spe);
        const dir = dzs === -1 ? 0 : dxs === 1 ? 1 : dzs === 1 ? 2 : 3;
        if (dir !== e || j !== opp * 4 + (i & 3)) return true;
      }
    }
    a = b;
  }
  return false;
}

/** Clipped footprint rectangle [x0, z0, x1, z1) of a stamp (cells). */
export function clipFootprint(size: number, x: number, z: number, w: number, h: number): [number, number, number, number] {
  return [Math.max(0, x), Math.max(0, z), Math.min(size, x + w), Math.min(size, z + h)];
}
