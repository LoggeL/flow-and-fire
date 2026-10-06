/**
 * Land paths of the arena: A* on the 2-WU passability grid (8-neighbourhood without corner cutting,
 * like the Dijkstra graph of ecosim.py and @faf/ai analysis), deterministic binary heap with
 * tie-break on the cell index, straight line if the grid line is free, greedy string pulling, and a
 * bounded path cache keyed by (start cell, goal cell) with FIFO eviction (insertion order of a Map
 * is deterministic).
 *
 * No collisions, no steering, no structures as obstacles (documented simplification); cells marked
 * by the scenario cheat `blockCells` are impassable.
 */
import { labelComponents } from '@faf/ai';

const SQRT2 = Math.sqrt(2);
/** Neighbour offsets in fixed order (dz outer, dx inner). */
const NDX = [-1, 0, 1, -1, 1, -1, 0, 1] as const;
const NDZ = [-1, -1, -1, 0, 0, 1, 1, 1] as const;

/** Maximum ring radius (cells) searched for a passable substitute of a blocked start/goal. */
export const NEAREST_MAX_RINGS = 32;
/** Default number of cached paths. */
export const PATH_CACHE_SIZE = 2048;

export interface PathStats {
  /** A* searches run (cache misses without straight line). */
  searches: number;
  /** Node expansions over all searches. */
  expansions: number;
  cacheHits: number;
  straight: number;
  /** Requests without a path (other component, no passable cell nearby). */
  failures: number;
}

/**
 * Path service over a passability grid (1 = passable). `pass` is owned by the finder (blocking
 * cells mutates it and clears the cache).
 */
export class PathFinder {
  readonly dim: number;
  readonly cellWu: number;
  readonly pass: Uint8Array;
  private comp: Int32Array;
  private readonly g: Float64Array;
  private readonly parent: Int32Array;
  private readonly seen: Uint32Array;
  private readonly closed: Uint32Array;
  private stamp = 0;
  private heapF = new Float64Array(1024);
  private heapC = new Int32Array(1024);
  private heapN = 0;
  private readonly cache = new Map<number, Int32Array>();
  private readonly cacheSize: number;
  readonly stats: PathStats = { searches: 0, expansions: 0, cacheHits: 0, straight: 0, failures: 0 };

  constructor(pass: Uint8Array, dim: number, cellWu: number, cacheSize = PATH_CACHE_SIZE) {
    if (pass.length !== dim * dim) throw new RangeError('PathFinder: pass size mismatch');
    this.dim = dim;
    this.cellWu = cellWu;
    this.pass = pass;
    this.comp = labelComponents(pass, dim).labels;
    const n = dim * dim;
    this.g = new Float64Array(n);
    this.parent = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.cacheSize = cacheSize;
  }

  /** Component label of a cell (−1 = impassable). */
  component(cell: number): number {
    return this.comp[cell] ?? -1;
  }

  /** Marks cells impassable (walls); recomputes components and clears the cache. */
  block(cells: readonly number[]): void {
    for (const c of cells) {
      if (c >= 0 && c < this.pass.length) this.pass[c] = 0;
    }
    this.comp = labelComponents(this.pass, this.dim).labels;
    this.cache.clear();
  }

  /** Cell of a world point (clamped to the grid). */
  cellOf(x: number, z: number): number {
    const d = this.dim;
    let cx = Math.floor(x / this.cellWu);
    let cz = Math.floor(z / this.cellWu);
    cx = cx < 0 ? 0 : cx >= d ? d - 1 : cx;
    cz = cz < 0 ? 0 : cz >= d ? d - 1 : cz;
    return cz * d + cx;
  }

  isPassableAt(x: number, z: number): boolean {
    return this.pass[this.cellOf(x, z)] === 1;
  }

  /**
   * Nearest passable cell to a point: rings r = 0…NEAREST_MAX_RINGS, smallest dx² + dz² inside the
   * first ring with a hit, ties by scan order. −1 if none.
   */
  nearestPassable(x: number, z: number): number {
    const d = this.dim;
    const c = this.cellOf(x, z);
    const cx = c % d;
    const cz = (c - cx) / d;
    for (let r = 0; r <= NEAREST_MAX_RINGS; r++) {
      let best = -1;
      let bestD = 0;
      for (let dz = -r; dz <= r; dz++) {
        const iz = cz + dz;
        if (iz < 0 || iz >= d) continue;
        const edgeRow = dz === -r || dz === r;
        for (let dx = -r; dx <= r; dx += edgeRow || r === 0 ? 1 : 2 * r) {
          const ix = cx + dx;
          if (ix < 0 || ix >= d) continue;
          const i = iz * d + ix;
          if (this.pass[i] === 0) continue;
          const dd = dx * dx + dz * dz;
          if (best < 0 || dd < bestD) {
            best = i;
            bestD = dd;
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /** Centre of a cell in WU (x). */
  centerX(cell: number): number {
    return ((cell % this.dim) + 0.5) * this.cellWu;
  }

  /** Centre of a cell in WU (z). */
  centerZ(cell: number): number {
    return (Math.floor(cell / this.dim) + 0.5) * this.cellWu;
  }

  /**
   * True if the segment (ax, az) → (bx, bz) crosses only passable cells (grid traversal; when the
   * segment passes exactly through a cell corner both side cells must be passable — no corner cutting).
   */
  lineFree(ax: number, az: number, bx: number, bz: number): boolean {
    const g = this.cellWu;
    const d = this.dim;
    const pass = this.pass;
    let cx = Math.floor(ax / g);
    let cz = Math.floor(az / g);
    const ex = Math.floor(bx / g);
    const ez = Math.floor(bz / g);
    const inside = (x: number, z: number): boolean => x >= 0 && z >= 0 && x < d && z < d && pass[z * d + x] === 1;
    if (!inside(cx, cz)) return false;
    const dx = bx - ax;
    const dz = bz - az;
    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
    const tDeltaX = stepX === 0 ? Infinity : g / Math.abs(dx);
    const tDeltaZ = stepZ === 0 ? Infinity : g / Math.abs(dz);
    let tMaxX = stepX === 0 ? Infinity : stepX > 0 ? ((cx + 1) * g - ax) / dx : (cx * g - ax) / dx;
    let tMaxZ = stepZ === 0 ? Infinity : stepZ > 0 ? ((cz + 1) * g - az) / dz : (cz * g - az) / dz;
    let guard = 4 * d + 8;
    while ((cx !== ex || cz !== ez) && guard-- > 0) {
      if (tMaxX < tMaxZ) {
        if (tMaxX > 1) break;
        cx += stepX;
        tMaxX += tDeltaX;
      } else if (tMaxZ < tMaxX) {
        if (tMaxZ > 1) break;
        cz += stepZ;
        tMaxZ += tDeltaZ;
      } else {
        if (tMaxX > 1) break;
        // exact corner: both side cells must be passable
        if (!inside(cx + stepX, cz) || !inside(cx, cz + stepZ)) return false;
        cx += stepX;
        cz += stepZ;
        tMaxX += tDeltaX;
        tMaxZ += tDeltaZ;
      }
      if (!inside(cx, cz)) return false;
    }
    return true;
  }

  /**
   * Waypoints (flat [x0, z0, x1, z1, …], without the start point) from (sx, sz) to (gx, gz), or null
   * if no land path exists. A blocked goal is replaced by the nearest passable cell centre; a start
   * on a blocked cell first walks to the nearest passable cell.
   */
  find(sx: number, sz: number, gx: number, gz: number): number[] | null {
    let sc = this.cellOf(sx, sz);
    const startBlocked = this.pass[sc] === 0;
    if (startBlocked) sc = this.nearestPassable(sx, sz);
    let gc = this.cellOf(gx, gz);
    let goalX = gx;
    let goalZ = gz;
    if (this.pass[gc] === 0) {
      gc = this.nearestPassable(gx, gz);
      if (gc >= 0) {
        goalX = this.centerX(gc);
        goalZ = this.centerZ(gc);
      }
    }
    if (sc < 0 || gc < 0 || this.comp[sc] !== this.comp[gc]) {
      this.stats.failures++;
      return null;
    }
    const out: number[] = [];
    let fromX = sx;
    let fromZ = sz;
    if (startBlocked) {
      fromX = this.centerX(sc);
      fromZ = this.centerZ(sc);
      out.push(fromX, fromZ);
    }
    if (sc === gc || this.lineFree(fromX, fromZ, goalX, goalZ)) {
      this.stats.straight++;
      out.push(goalX, goalZ);
      return out;
    }
    const key = sc * this.pass.length + gc;
    let cells = this.cache.get(key);
    if (cells !== undefined) {
      this.stats.cacheHits++;
    } else {
      const raw = this.search(sc, gc);
      if (raw === null) {
        this.stats.failures++;
        return null;
      }
      cells = this.pull(raw);
      if (this.cache.size >= this.cacheSize) {
        const first = this.cache.keys().next();
        if (first.done !== true) this.cache.delete(first.value);
      }
      this.cache.set(key, cells);
    }
    // cells[0] is the start cell; skip waypoints the unit can already see past (string pulling
    // from the actual position), end at the exact goal.
    let i = 1;
    while (i < cells.length - 1 && this.lineFree(fromX, fromZ, this.centerX(cells[i + 1]!), this.centerZ(cells[i + 1]!))) i++;
    for (; i < cells.length - 1; i++) out.push(this.centerX(cells[i]!), this.centerZ(cells[i]!));
    out.push(goalX, goalZ);
    return out;
  }

  /** Clears the cache (e.g. after terrain changes). */
  clearCache(): void {
    this.cache.clear();
  }

  private heapPush(f: number, c: number): void {
    if (this.heapN >= this.heapF.length) {
      const nf = new Float64Array(this.heapF.length * 2);
      nf.set(this.heapF);
      const nc = new Int32Array(this.heapC.length * 2);
      nc.set(this.heapC);
      this.heapF = nf;
      this.heapC = nc;
    }
    const hf = this.heapF;
    const hc = this.heapC;
    let i = this.heapN++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      const pf = hf[p]!;
      const pc = hc[p]!;
      if (pf < f || (pf === f && pc <= c)) break;
      hf[i] = pf;
      hc[i] = pc;
      i = p;
    }
    hf[i] = f;
    hc[i] = c;
  }

  /** Pops the minimum (f, then cell index); returns the cell. */
  private heapPop(): number {
    const hf = this.heapF;
    const hc = this.heapC;
    const top = hc[0]!;
    const n = --this.heapN;
    if (n > 0) {
      const f = hf[n]!;
      const c = hc[n]!;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        let m = l;
        if (r < n && (hf[r]! < hf[l]! || (hf[r] === hf[l] && hc[r]! < hc[l]!))) m = r;
        if (f < hf[m]! || (f === hf[m] && c <= hc[m]!)) break;
        hf[i] = hf[m]!;
        hc[i] = hc[m]!;
        i = m;
      }
      hf[i] = f;
      hc[i] = c;
    }
    return top;
  }

  private heuristic(c: number, gx: number, gz: number): number {
    const d = this.dim;
    const cx = c % d;
    const cz = (c - cx) / d;
    const dx = cx > gx ? cx - gx : gx - cx;
    const dz = cz > gz ? cz - gz : gz - cz;
    const mn = dx < dz ? dx : dz;
    const mx = dx < dz ? dz : dx;
    return (mx - mn + SQRT2 * mn) * this.cellWu;
  }

  /** A* from sc to gc; returns the cell sequence (start … goal) or null. */
  private search(sc: number, gc: number): Int32Array | null {
    this.stats.searches++;
    if (++this.stamp === 0xffffffff) {
      this.seen.fill(0);
      this.closed.fill(0);
      this.stamp = 1;
    }
    const st = this.stamp;
    const d = this.dim;
    const pass = this.pass;
    const g = this.g;
    const cw = this.cellWu;
    const diag = cw * SQRT2;
    const gx = gc % d;
    const gz = (gc - gx) / d;
    this.heapN = 0;
    g[sc] = 0;
    this.parent[sc] = -1;
    this.seen[sc] = st;
    this.heapPush(this.heuristic(sc, gx, gz), sc);
    let found = false;
    while (this.heapN > 0) {
      const c = this.heapPop();
      if (this.closed[c] === st) continue;
      this.closed[c] = st;
      this.stats.expansions++;
      if (c === gc) {
        found = true;
        break;
      }
      const cx = c % d;
      const cz = (c - cx) / d;
      const gc0 = g[c]!;
      for (let k = 0; k < 8; k++) {
        const dx = NDX[k]!;
        const dz = NDZ[k]!;
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= d || nz >= d) continue;
        const ni = nz * d + nx;
        if (pass[ni] === 0 || this.closed[ni] === st) continue;
        let cost = cw;
        if (dx !== 0 && dz !== 0) {
          if (pass[cz * d + nx] === 0 || pass[nz * d + cx] === 0) continue;
          cost = diag;
        }
        const ng = gc0 + cost;
        if (this.seen[ni] === st && ng >= g[ni]!) continue;
        this.seen[ni] = st;
        g[ni] = ng;
        this.parent[ni] = c;
        this.heapPush(ng + this.heuristic(ni, gx, gz), ni);
      }
    }
    if (!found) return null;
    let n = 0;
    for (let c = gc; c !== -1; c = this.parent[c]!) n++;
    const out = new Int32Array(n);
    let i = n - 1;
    for (let c = gc; c !== -1; c = this.parent[c]!) out[i--] = c;
    return out;
  }

  /** Greedy string pulling over cell centres: keeps the start and goal cell. */
  private pull(cells: Int32Array): Int32Array {
    if (cells.length <= 2) return cells;
    const out: number[] = [cells[0]!];
    let i = 0;
    while (i < cells.length - 1) {
      let j = i + 1;
      const ax = this.centerX(cells[i]!);
      const az = this.centerZ(cells[i]!);
      while (j + 1 < cells.length && this.lineFree(ax, az, this.centerX(cells[j + 1]!), this.centerZ(cells[j + 1]!))) j++;
      out.push(cells[j]!);
      i = j;
    }
    return Int32Array.from(out);
  }
}

/** Length of a polyline starting at (x, z) through flat waypoints. */
export function polylineLength(x: number, z: number, pts: readonly number[]): number {
  let len = 0;
  let px = x;
  let pz = z;
  for (let i = 0; i + 1 < pts.length; i += 2) {
    const dx = pts[i]! - px;
    const dz = pts[i + 1]! - pz;
    len += Math.sqrt(dx * dx + dz * dz);
    px = pts[i]!;
    pz = pts[i + 1]!;
  }
  return len;
}
