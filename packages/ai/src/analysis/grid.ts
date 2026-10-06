/**
 * Grid path distances on the 2-WU passability grid (ai.md §3): Dijkstra with an indexed binary
 * heap (priority = distance, tie-break = cell index), step costs cellWu (orthogonal) and cellWu·√2
 * (diagonal, only if both orthogonal neighbours are passable — no corner cutting), like the scipy
 * graph of tools/ai-sim/ecosim.py.
 */

/** Neighbour offsets in fixed order (dz outer, dx inner). */
const NDX = [-1, 0, 1, -1, 1, -1, 0, 1];
const NDZ = [-1, -1, -1, 0, 0, 1, 1, 1];

export interface DijkstraResult {
  /** Path distance in WU per cell, Infinity = unreachable. */
  readonly dist: Float64Array;
  /** Predecessor cell towards the source, −1 for the source and unreachable cells. */
  readonly pred: Int32Array;
  /** Node expansions (ops). */
  readonly expansions: number;
}

/** Indexed min-heap over (key, id). */
class IndexedHeap {
  private readonly ids: Int32Array;
  private readonly keys: Float64Array;
  private readonly pos: Int32Array;
  size = 0;

  constructor(n: number) {
    this.ids = new Int32Array(n);
    this.keys = new Float64Array(n);
    this.pos = new Int32Array(n).fill(-1);
  }

  private less(i: number, j: number): boolean {
    const a = this.keys[i]!;
    const b = this.keys[j]!;
    return a < b || (a === b && this.ids[i]! < this.ids[j]!);
  }

  private swap(i: number, j: number): void {
    const ii = this.ids[i]!;
    const jj = this.ids[j]!;
    const ki = this.keys[i]!;
    this.ids[i] = jj;
    this.keys[i] = this.keys[j]!;
    this.ids[j] = ii;
    this.keys[j] = ki;
    this.pos[jj] = i;
    this.pos[ii] = j;
  }

  private up(i: number): void {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }

  private down(i: number): void {
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < this.size && this.less(l, m)) m = l;
      if (r < this.size && this.less(r, m)) m = r;
      if (m === i) return;
      this.swap(i, m);
      i = m;
    }
  }

  /** Inserts id or lowers its key. */
  push(id: number, key: number): void {
    const p = this.pos[id]!;
    if (p >= 0) {
      if (key < this.keys[p]!) {
        this.keys[p] = key;
        this.up(p);
      }
      return;
    }
    const i = this.size++;
    this.ids[i] = id;
    this.keys[i] = key;
    this.pos[id] = i;
    this.up(i);
  }

  /** Removes and returns the id with the smallest (key, id). */
  pop(): number {
    const top = this.ids[0]!;
    const last = --this.size;
    if (last > 0) {
      this.swap(0, last);
      this.down(0);
    }
    this.pos[top] = -2;
    return top;
  }
}

/** Single-source Dijkstra over the passability grid (dim × dim, index z·dim + x). */
export function gridDijkstra(pass: Uint8Array, dim: number, cellWu: number, source: number): DijkstraResult {
  const n = dim * dim;
  const dist = new Float64Array(n).fill(Infinity);
  const pred = new Int32Array(n).fill(-1);
  if (source < 0 || source >= n || pass[source] === 0) return { dist, pred, expansions: 0 };
  const diag = cellWu * Math.sqrt(2);
  const heap = new IndexedHeap(n);
  dist[source] = 0;
  heap.push(source, 0);
  let expansions = 0;
  while (heap.size > 0) {
    const u = heap.pop();
    expansions++;
    const du = dist[u]!;
    const ux = u % dim;
    const uz = (u - ux) / dim;
    for (let k = 0; k < 8; k++) {
      const dx = NDX[k]!;
      const dz = NDZ[k]!;
      const vx = ux + dx;
      const vz = uz + dz;
      if (vx < 0 || vz < 0 || vx >= dim || vz >= dim) continue;
      const v = vz * dim + vx;
      if (pass[v] === 0) continue;
      let w = cellWu;
      if (dx !== 0 && dz !== 0) {
        if (pass[uz * dim + vx] === 0 || pass[vz * dim + ux] === 0) continue;
        w = diag;
      }
      const nd = du + w;
      if (nd < dist[v]!) {
        dist[v] = nd;
        pred[v] = u;
        heap.push(v, nd);
      }
    }
  }
  return { dist, pred, expansions };
}

/**
 * Nearest passable cell to a world point, exactly like `node()` in ecosim.py: rings r = 0…5 around
 * the cell (⌊x/g⌋, ⌊z/g⌋); in a ring the smallest dx² + dz² wins, ties by scan order (dz, then dx).
 * Returns −1 if no passable cell is within 5 rings.
 */
export function nearestPassableCell(pass: Uint8Array, dim: number, cellWu: number, x: number, z: number): number {
  const cx = Math.floor(x / cellWu);
  const cz = Math.floor(z / cellWu);
  for (let r = 0; r < 6; r++) {
    let best = -1;
    let bestD = 0;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const ix = cx + dx;
        const iz = cz + dz;
        if (ix < 0 || iz < 0 || ix >= dim || iz >= dim) continue;
        const i = iz * dim + ix;
        if (pass[i] === 0) continue;
        const d = dx * dx + dz * dz;
        if (best < 0 || d < bestD) {
          best = i;
          bestD = d;
        }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

/** Centre of a cell in WU. */
export function cellCenter(cell: number, dim: number, cellWu: number): { x: number; z: number } {
  const cx = cell % dim;
  const cz = (cell - cx) / dim;
  return { x: (cx + 0.5) * cellWu, z: (cz + 0.5) * cellWu };
}
