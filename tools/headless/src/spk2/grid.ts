/**
 * SPK2 (throw-away Float64 prototype, PLAN §4): obstacle grid with 1-WU cells, Chebyshev
 * clearance per cell (same rule as @faf/nav: class s passable ⇔ clearance ≥ s, cap 15),
 * a Euclidean-ish distance field for the obstacle gradient, octile grid A* (no corner cutting)
 * with greedy string pulling, and a clearance-aware line-of-sight test.
 *
 * Float math is allowed here: SPK2 only picks parameters that ms3-p2 ports to Fx.
 */

export const CLEARANCE_CAP = 15;
const SQRT2 = Math.SQRT2;

export class Spk2Grid {
  readonly width: number;
  readonly height: number;
  /** 1 = blocked. */
  readonly blocked: Uint8Array;
  /** Chebyshev distance (cells) to the nearest blocked cell or the map edge, capped. */
  readonly clearance: Uint8Array;
  /** Distance (WU) from the cell centre to the nearest blocked cell boundary (chamfer 1/√2). */
  readonly dist: Float64Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.blocked = new Uint8Array(width * height);
    this.clearance = new Uint8Array(width * height);
    this.dist = new Float64Array(width * height);
  }

  inBounds(x: number, z: number): boolean {
    return x >= 0 && z >= 0 && x < this.width && z < this.height;
  }

  /** Marks the cell rectangle [x0, x0+w) × [z0, z0+h) (clipped) as blocked (or free). */
  fillRect(x0: number, z0: number, w: number, h: number, value = 1): void {
    for (let z = Math.max(0, z0); z < Math.min(this.height, z0 + h); z++) {
      for (let x = Math.max(0, x0); x < Math.min(this.width, x0 + w); x++) this.blocked[z * this.width + x] = value;
    }
  }

  /** Blocks every cell whose centre lies within `r` of (cx, cz). */
  fillDisc(cx: number, cz: number, r: number): void {
    for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if (!this.inBounds(x, z)) continue;
        const dx = x + 0.5 - cx;
        const dz = z + 0.5 - cz;
        if (dx * dx + dz * dz <= r * r) this.blocked[z * this.width + x] = 1;
      }
    }
  }

  isBlocked(x: number, z: number): boolean {
    if (!this.inBounds(x, z)) return true;
    return this.blocked[z * this.width + x] === 1;
  }

  /** Recomputes clearance and the distance field (call after editing `blocked`). */
  rebuild(): void {
    const { width: w, height: h, blocked, clearance, dist } = this;
    // Chebyshev clearance: 1 + min over the 8 neighbours, edge counts as blocked.
    const c = new Int32Array(w * h);
    for (let i = 0; i < w * h; i++) c[i] = blocked[i] ? 0 : CLEARANCE_CAP;
    const at = (x: number, z: number): number => (x < 0 || z < 0 || x >= w || z >= h ? 0 : c[z * w + x]!);
    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w; x++) {
        const i = z * w + x;
        if (c[i] === 0) continue;
        c[i] = Math.min(c[i]!, 1 + Math.min(at(x - 1, z), at(x - 1, z - 1), at(x, z - 1), at(x + 1, z - 1)));
      }
    }
    for (let z = h - 1; z >= 0; z--) {
      for (let x = w - 1; x >= 0; x--) {
        const i = z * w + x;
        if (c[i] === 0) continue;
        c[i] = Math.min(c[i]!, 1 + Math.min(at(x + 1, z), at(x + 1, z + 1), at(x, z + 1), at(x - 1, z + 1)));
      }
    }
    for (let i = 0; i < w * h; i++) clearance[i] = Math.min(CLEARANCE_CAP, c[i]!);
    // Chamfer distance (cell centres) to the nearest blocked cell; edge = blocked ring outside.
    const big = 1e9;
    for (let i = 0; i < w * h; i++) dist[i] = blocked[i] ? 0 : big;
    const d = (x: number, z: number): number => (x < 0 || z < 0 || x >= w || z >= h ? 0 : dist[z * w + x]!);
    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w; x++) {
        const i = z * w + x;
        if (dist[i] === 0) continue;
        dist[i] = Math.min(dist[i]!, d(x - 1, z) + 1, d(x, z - 1) + 1, d(x - 1, z - 1) + SQRT2, d(x + 1, z - 1) + SQRT2);
      }
    }
    for (let z = h - 1; z >= 0; z--) {
      for (let x = w - 1; x >= 0; x--) {
        const i = z * w + x;
        if (dist[i] === 0) continue;
        dist[i] = Math.min(dist[i]!, d(x + 1, z) + 1, d(x, z + 1) + 1, d(x + 1, z + 1) + SQRT2, d(x - 1, z + 1) + SQRT2);
      }
    }
    // Centre-to-centre distance → distance to the blocked cell's boundary.
    for (let i = 0; i < w * h; i++) if (dist[i]! > 0) dist[i] = dist[i]! - 0.5;
  }

  /** True if class `cls` may stand in cell (x, z). */
  passable(cls: number, x: number, z: number): boolean {
    if (!this.inBounds(x, z)) return false;
    return this.clearance[z * this.width + x]! >= Math.max(1, cls);
  }

  /** Bilinear distance-field sample at a point (WU). */
  sampleDist(px: number, pz: number): number {
    const x = Math.min(this.width - 1.001, Math.max(0, px - 0.5));
    const z = Math.min(this.height - 1.001, Math.max(0, pz - 0.5));
    const x0 = Math.floor(x);
    const z0 = Math.floor(z);
    const fx = x - x0;
    const fz = z - z0;
    const w = this.width;
    const a = this.dist[z0 * w + x0]!;
    const b = this.dist[z0 * w + x0 + 1]!;
    const c = this.dist[(z0 + 1) * w + x0]!;
    const d = this.dist[(z0 + 1) * w + x0 + 1]!;
    return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
  }

  /** Gradient of the distance field (points away from obstacles), written into out[0..1]. */
  gradient(px: number, pz: number, out: Float64Array): void {
    const e = 0.35;
    out[0] = (this.sampleDist(px + e, pz) - this.sampleDist(px - e, pz)) / (2 * e);
    out[1] = (this.sampleDist(px, pz + e) - this.sampleDist(px, pz - e)) / (2 * e);
  }

  /** Supercover line of sight between two points: every touched cell passable for `cls`. */
  lineOfSight(cls: number, ax: number, az: number, bx: number, bz: number): boolean {
    let x = Math.floor(ax);
    let z = Math.floor(az);
    const x1 = Math.floor(bx);
    const z1 = Math.floor(bz);
    if (!this.passable(cls, x, z)) return false;
    const dx = bx - ax;
    const dz = bz - az;
    const sx = dx > 0 ? 1 : -1;
    const sz = dz > 0 ? 1 : -1;
    const tdx = dx === 0 ? Infinity : Math.abs(1 / dx);
    const tdz = dz === 0 ? Infinity : Math.abs(1 / dz);
    let tx = dx === 0 ? Infinity : (sx > 0 ? x + 1 - ax : ax - x) * tdx;
    let tz = dz === 0 ? Infinity : (sz > 0 ? z + 1 - az : az - z) * tdz;
    let guard = 0;
    while ((x !== x1 || z !== z1) && guard++ < 4096) {
      if (Math.abs(tx - tz) < 1e-12) {
        // Through a corner: both side cells must be passable (supercover).
        if (!this.passable(cls, x + sx, z) || !this.passable(cls, x, z + sz)) return false;
        x += sx;
        z += sz;
        tx += tdx;
        tz += tdz;
      } else if (tx < tz) {
        x += sx;
        tx += tdx;
      } else {
        z += sz;
        tz += tdz;
      }
      if (!this.passable(cls, x, z)) return false;
    }
    return true;
  }

  /** Nearest cell (x, z) passable for `cls` to the point (spiral search), or null. */
  nearestPassable(cls: number, px: number, pz: number): [number, number] | null {
    const cx = Math.floor(px);
    const cz = Math.floor(pz);
    for (let r = 0; r < Math.max(this.width, this.height); r++) {
      let best: [number, number] | null = null;
      let bestD = Infinity;
      for (let z = cz - r; z <= cz + r; z++) {
        for (let x = cx - r; x <= cx + r; x++) {
          if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) !== r || !this.passable(cls, x, z)) continue;
          const d = (x + 0.5 - px) ** 2 + (z + 0.5 - pz) ** 2;
          if (d < bestD) {
            bestD = d;
            best = [x, z];
          }
        }
      }
      if (best !== null) return best;
    }
    return null;
  }

  /**
   * Octile A* from the cell of (ax, az) to the cell of (bx, bz) for class `cls`, then greedy
   * string pulling with clearance LOS. Returns waypoints (cell centres, the exact goal last) or
   * null if unreachable. `expansions` (optional) receives the expansion count.
   */
  findPath(cls: number, ax: number, az: number, bx: number, bz: number, stats?: { expansions: number }): number[] | null {
    const w = this.width;
    const h = this.height;
    let start = [Math.floor(ax), Math.floor(az)] as [number, number];
    if (!this.passable(cls, start[0], start[1])) {
      const s = this.nearestPassable(cls, ax, az);
      if (s === null) return null;
      start = s;
    }
    let goal = [Math.floor(bx), Math.floor(bz)] as [number, number];
    let exactGoal = true;
    if (!this.passable(cls, goal[0], goal[1])) {
      const g = this.nearestPassable(cls, bx, bz);
      if (g === null) return null;
      goal = g;
      exactGoal = false;
    }
    const n = w * h;
    const g = new Float64Array(n).fill(Infinity);
    const parent = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const heap = new MinHeap();
    const si = start[1] * w + start[0];
    const gi = goal[1] * w + goal[0];
    const hfn = (i: number): number => {
      const dx = Math.abs((i % w) - goal[0]);
      const dz = Math.abs(Math.floor(i / w) - goal[1]);
      return Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz);
    };
    g[si] = 0;
    heap.push(si, hfn(si));
    let expansions = 0;
    while (heap.size > 0) {
      const i = heap.pop();
      if (closed[i]) continue;
      closed[i] = 1;
      expansions++;
      if (i === gi) break;
      const x = i % w;
      const z = Math.floor(i / w);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const nx = x + dx;
          const nz = z + dz;
          if (!this.passable(cls, nx, nz)) continue;
          if (dx !== 0 && dz !== 0 && (!this.passable(cls, x + dx, z) || !this.passable(cls, x, z + dz))) continue;
          const ni = nz * w + nx;
          if (closed[ni]) continue;
          const ng = g[i]! + (dx !== 0 && dz !== 0 ? SQRT2 : 1);
          if (ng < g[ni]!) {
            g[ni] = ng;
            parent[ni] = i;
            heap.push(ni, ng + hfn(ni));
          }
        }
      }
    }
    if (stats !== undefined) stats.expansions = expansions;
    if (parent[gi] === -1 && gi !== si) return null;
    const cells: number[] = [];
    for (let i = gi; i !== -1; i = parent[i]!) cells.push(i);
    cells.reverse();
    // String pulling: from the current anchor, jump to the farthest cell with clearance LOS.
    const out: number[] = [];
    let anchorX = ax;
    let anchorZ = az;
    let k = 0;
    while (k < cells.length - 1) {
      // Greedy forward: extend while the line of sight holds.
      let best = k + 1;
      while (best + 1 < cells.length) {
        const cx = (cells[best + 1]! % w) + 0.5;
        const cz = Math.floor(cells[best + 1]! / w) + 0.5;
        if (!this.lineOfSight(cls, anchorX, anchorZ, cx, cz)) break;
        best++;
      }
      anchorX = (cells[best]! % w) + 0.5;
      anchorZ = Math.floor(cells[best]! / w) + 0.5;
      out.push(anchorX, anchorZ);
      k = best;
    }
    if (out.length === 0) out.push((gi % w) + 0.5, Math.floor(gi / w) + 0.5);
    if (exactGoal) {
      out[out.length - 2] = bx;
      out[out.length - 1] = bz;
    }
    return out;
  }
}

/** Binary min-heap of (index, priority), ties broken by index. */
class MinHeap {
  private idx: number[] = [];
  private pri: number[] = [];
  get size(): number {
    return this.idx.length;
  }
  push(i: number, p: number): void {
    this.idx.push(i);
    this.pri.push(p);
    let c = this.idx.length - 1;
    while (c > 0) {
      const par = (c - 1) >> 1;
      if (this.less(c, par)) {
        this.swap(c, par);
        c = par;
      } else break;
    }
  }
  pop(): number {
    const top = this.idx[0]!;
    const li = this.idx.pop()!;
    const lp = this.pri.pop()!;
    if (this.idx.length > 0) {
      this.idx[0] = li;
      this.pri[0] = lp;
      let c = 0;
      for (;;) {
        const l = 2 * c + 1;
        const r = l + 1;
        let m = c;
        if (l < this.idx.length && this.less(l, m)) m = l;
        if (r < this.idx.length && this.less(r, m)) m = r;
        if (m === c) break;
        this.swap(c, m);
        c = m;
      }
    }
    return top;
  }
  private less(a: number, b: number): boolean {
    return this.pri[a]! < this.pri[b]! || (this.pri[a] === this.pri[b] && this.idx[a]! < this.idx[b]!);
  }
  private swap(a: number, b: number): void {
    [this.idx[a], this.idx[b]] = [this.idx[b]!, this.idx[a]!];
    [this.pri[a], this.pri[b]] = [this.pri[b]!, this.pri[a]!];
  }
}
