/**
 * Circle queries over a 16-WU bucket grid with one layer per army, rebuilt from scratch in slot
 * order (counting sort) so the order inside a cell is canonical: rows z ascending, columns x
 * ascending, inside a cell by slot. Queries visit only the requested layer (army), so dense clumps
 * of one army do not slow down queries for another.
 */

export const QUERY_CELL_WU = 16;

export class UnitGrid {
  readonly cells: number;
  readonly sizeWu: number;
  readonly layers: number;
  private readonly cellsN: number;
  private readonly start: Int32Array;
  private readonly count: Int32Array;
  private items: Int32Array = new Int32Array(256);
  private keyOfItem: Int32Array = new Int32Array(256);
  private n = 0;

  constructor(sizeWu: number, layers = 1) {
    this.sizeWu = sizeWu;
    this.layers = layers;
    this.cells = Math.max(1, Math.ceil(sizeWu / QUERY_CELL_WU));
    this.cellsN = this.cells * this.cells;
    this.start = new Int32Array(this.cellsN * layers + 1);
    this.count = new Int32Array(this.cellsN * layers);
  }

  cellIndex(x: number, z: number): number {
    const m = this.cells;
    let cx = Math.floor(x / QUERY_CELL_WU);
    let cz = Math.floor(z / QUERY_CELL_WU);
    cx = cx < 0 ? 0 : cx >= m ? m - 1 : cx;
    cz = cz < 0 ? 0 : cz >= m ? m - 1 : cz;
    return cz * m + cx;
  }

  /**
   * Rebuilds the grid from slots 0…slotCount−1 with positions xs/zs indexed by slot; `layerOf[slot]`
   * is the layer (−1 = not inserted).
   */
  rebuild(slotCount: number, layerOf: Int8Array, xs: Float64Array, zs: Float64Array): void {
    if (this.items.length < slotCount) {
      let cap = this.items.length;
      while (cap < slotCount) cap *= 2;
      this.items = new Int32Array(cap);
      this.keyOfItem = new Int32Array(cap);
    }
    this.count.fill(0);
    let n = 0;
    for (let s = 0; s < slotCount; s++) {
      const l = layerOf[s]!;
      if (l < 0) continue;
      const k = l * this.cellsN + this.cellIndex(xs[s]!, zs[s]!);
      this.keyOfItem[s] = k;
      this.count[k]!++;
      n++;
    }
    this.n = n;
    let acc = 0;
    const keys = this.cellsN * this.layers;
    for (let k = 0; k < keys; k++) {
      this.start[k] = acc;
      acc += this.count[k]!;
    }
    this.start[keys] = acc;
    this.count.fill(0);
    for (let s = 0; s < slotCount; s++) {
      if (layerOf[s]! < 0) continue;
      const k = this.keyOfItem[s]!;
      this.items[this.start[k]! + this.count[k]!] = s;
      this.count[k]!++;
    }
  }

  get size(): number {
    return this.n;
  }

  /**
   * Calls fn(slot) for every item of `layer` in the cells overlapping the square around (x, z)
   * with half size r (callers test the exact distance). Returning true from fn stops the query.
   */
  query(layer: number, x: number, z: number, r: number, fn: (slot: number) => boolean | void): void {
    const m = this.cells;
    let x0 = Math.floor((x - r) / QUERY_CELL_WU);
    let x1 = Math.floor((x + r) / QUERY_CELL_WU);
    let z0 = Math.floor((z - r) / QUERY_CELL_WU);
    let z1 = Math.floor((z + r) / QUERY_CELL_WU);
    if (x0 < 0) x0 = 0;
    if (z0 < 0) z0 = 0;
    if (x1 >= m) x1 = m - 1;
    if (z1 >= m) z1 = m - 1;
    const base = layer * this.cellsN;
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const c = base + cz * m + cx;
        const e = this.start[c + 1]!;
        for (let i = this.start[c]!; i < e; i++) {
          if (fn(this.items[i]!) === true) return;
        }
      }
    }
  }
}
