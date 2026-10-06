/**
 * Threat grid of the IntelManager (ai.md §5.6, §2.3, Review R-10).
 *
 * 16-WU cells (Setons 64 × 64, 512 WU 32 × 32). Per cell:
 * - live layers T_surface / T_air / T_antiair of the last completed intel pass (mobile enemies and
 *   blips). They are rebuilt every pass in fixed handle order. "Clearing" costs nothing: every cell
 *   carries the generation of its last write, a stale generation reads as 0. Two buffers: the pass
 *   builds into one while queries read the other (published) one, so a pass that is cut off by the
 *   op budget and continued by cursor in the next intel run never exposes a half-built layer
 *   (grid ≤ 2 s old, deterministic).
 * - memory (Mem, t_mem) per layer: set to the live value whenever a pass writes a cell, cleared in
 *   cells under own sight without live threat ("gesehenes Leeres löscht das Gedächtnis"). Decay is
 *   lazy: value = max(Live, Mem · 0.95^(t − t_mem)) via DECAY_LUT (no Math.pow, ai.md §2.5).
 * - structure layers (T_surface, T_antiair, V_struct of known enemy structures incl. ghosts): only
 *   changed by events (structure newly known, structure gone); structures never decay.
 * - lastSeen: tick of the last own sight of the cell (−1 = never).
 *
 * The grid is AI state, never part of any hash. Queries implement the blackboard `ThreatQuery`.
 */
import type { ThreatQuery, ThreatQueryLayer } from '../../blackboard.ts';
import { decayFactor } from '../../det.ts';

export const GRID_CELL_WU = 16;
/** Rim beyond the weapon range where a unit enters with half its threat (ai.md §5.6). */
export const GRID_RIM_WU = 8;
/** Blips are smeared over this many cells around their cell (Chebyshev, radar jitter). */
export const BLIP_SMEAR_CELLS = 2;

export type GridLayer = 0 | 1 | 2;
export const LAYER_SURFACE: GridLayer = 0;
export const LAYER_AIR: GridLayer = 1;
export const LAYER_ANTIAIR: GridLayer = 2;

function layerIndex(layer: ThreatQueryLayer): GridLayer {
  return layer === 'surface' ? LAYER_SURFACE : layer === 'air' ? LAYER_AIR : LAYER_ANTIAIR;
}

interface LiveBuffer {
  readonly gen: Int32Array;
  readonly v: [Float64Array, Float64Array, Float64Array];
}

function makeBuffer(n: number): LiveBuffer {
  return { gen: new Int32Array(n), v: [new Float64Array(n), new Float64Array(n), new Float64Array(n)] };
}

/** Residues of add/subtract pairs below this are snapped to 0. */
const SNAP = 1e-9;

export class ThreatGrid implements ThreatQuery {
  readonly cellWu = GRID_CELL_WU;
  readonly dim: number;
  readonly cells: number;
  private readonly buffers: [LiveBuffer, LiveBuffer];
  private pubIndex = 0;
  private pubGen = 0;
  private buildGenValue = 0;
  private building = false;
  readonly mem: [Float64Array, Float64Array, Float64Array];
  /** Tick of the memory value per cell (−1 = none). */
  readonly memTick: Int32Array;
  readonly structSurface: Float64Array;
  readonly structAntiAir: Float64Array;
  readonly structValue: Float64Array;
  readonly lastSeen: Int32Array;
  /** Memory layers enabled (Easy: threat only from visible units, ai.md §6). */
  readonly useMemory: boolean;
  /** Tick of the last published pass (−1 = none yet). */
  publishedTick = -1;

  constructor(
    sizeWu: number,
    private readonly now: () => number,
    opts: { useMemory?: boolean } = {},
  ) {
    this.dim = Math.max(1, Math.ceil(sizeWu / GRID_CELL_WU));
    this.cells = this.dim * this.dim;
    this.buffers = [makeBuffer(this.cells), makeBuffer(this.cells)];
    this.mem = [new Float64Array(this.cells), new Float64Array(this.cells), new Float64Array(this.cells)];
    this.memTick = new Int32Array(this.cells).fill(-1);
    this.structSurface = new Float64Array(this.cells);
    this.structAntiAir = new Float64Array(this.cells);
    this.structValue = new Float64Array(this.cells);
    this.lastSeen = new Int32Array(this.cells).fill(-1);
    this.useMemory = opts.useMemory ?? true;
  }

  // ---- geometry ---------------------------------------------------------------------------------

  /** Cell index of a world position (clamped into the map). */
  cellOf(x: number, z: number): number {
    return this.cz(z) * this.dim + this.cx(x);
  }

  cx(x: number): number {
    const c = Math.floor(x / GRID_CELL_WU);
    return c < 0 ? 0 : c >= this.dim ? this.dim - 1 : c;
  }

  cz(z: number): number {
    const c = Math.floor(z / GRID_CELL_WU);
    return c < 0 ? 0 : c >= this.dim ? this.dim - 1 : c;
  }

  /**
   * Cells of a disc: centre distance ≤ full ⇒ weight 1, ≤ full + rim ⇒ weight 0.5; the unit's own
   * cell always has weight 1. Writes into `outCells/outW` and returns the count (row-major order).
   */
  discCells(x: number, z: number, full: number, rim: number, outCells: Int32Array, outW: Float64Array): number {
    const outer = full + rim;
    const own = this.cellOf(x, z);
    const c0 = this.cx(x - outer);
    const c1 = this.cx(x + outer);
    const r0 = this.cz(z - outer);
    const r1 = this.cz(z + outer);
    const f2 = full * full;
    const o2 = outer * outer;
    let n = 0;
    for (let r = r0; r <= r1; r++) {
      const cz = (r + 0.5) * GRID_CELL_WU - z;
      for (let c = c0; c <= c1; c++) {
        const cx = (c + 0.5) * GRID_CELL_WU - x;
        const d2 = cx * cx + cz * cz;
        const idx = r * this.dim + c;
        let w = 0;
        if (idx === own || d2 <= f2) w = 1;
        else if (d2 <= o2) w = 0.5;
        if (w === 0 || n >= outCells.length) continue;
        outCells[n] = idx;
        outW[n] = w;
        n++;
      }
    }
    return n;
  }

  /** Cells within Chebyshev distance `k` of the cell of (x, z), row-major. */
  squareCells(x: number, z: number, k: number, outCells: Int32Array): number {
    const cx = this.cx(x);
    const cz = this.cz(z);
    let n = 0;
    for (let r = Math.max(0, cz - k); r <= Math.min(this.dim - 1, cz + k); r++) {
      for (let c = Math.max(0, cx - k); c <= Math.min(this.dim - 1, cx + k); c++) {
        if (n >= outCells.length) return n;
        outCells[n++] = r * this.dim + c;
      }
    }
    return n;
  }

  // ---- pass lifecycle ---------------------------------------------------------------------------

  get isBuilding(): boolean {
    return this.building;
  }

  get buildGen(): number {
    return this.buildGenValue;
  }

  /** Starts a new pass (build buffer = the unpublished one, new generation). */
  beginPass(): void {
    this.building = true;
    this.buildGenValue = this.pubGen + 1;
  }

  /** Publishes the build buffer. */
  publish(tick: number): void {
    if (!this.building) return;
    this.pubIndex = 1 - this.pubIndex;
    this.pubGen = this.buildGenValue;
    this.building = false;
    this.publishedTick = tick;
  }

  private get build(): LiveBuffer {
    return this.buffers[1 - this.pubIndex]!;
  }

  private get pub(): LiveBuffer {
    return this.buffers[this.pubIndex]!;
  }

  /** Adds live threat of one layer to a cell of the build buffer; memory follows the live value. */
  addLive(cell: number, layer: GridLayer, value: number, tick: number): void {
    if (value <= 0) return;
    const b = this.build;
    if (b.gen[cell] !== this.buildGenValue) {
      b.gen[cell] = this.buildGenValue;
      b.v[0][cell] = 0;
      b.v[1][cell] = 0;
      b.v[2][cell] = 0;
    }
    const v = b.v[layer][cell]! + value;
    b.v[layer][cell] = v;
    if (this.useMemory) {
      // All layers of the cell move to the new time stamp together: copy the other layers' live
      // values of this pass (0 if not written yet) so no stale memory survives with a fresh stamp.
      if (this.memTick[cell] !== tick) {
        this.mem[0][cell] = b.v[0][cell]!;
        this.mem[1][cell] = b.v[1][cell]!;
        this.mem[2][cell] = b.v[2][cell]!;
        this.memTick[cell] = tick;
      } else this.mem[layer][cell] = v;
    }
  }

  /** Live value of the build buffer (0 if the cell was not written in this pass). */
  buildLive(cell: number, layer: GridLayer): number {
    const b = this.build;
    return b.gen[cell] === this.buildGenValue ? b.v[layer][cell]! : 0;
  }

  /** Own sight over a cell: lastSeen = tick; seen emptiness clears the memory. */
  markSeen(cell: number, tick: number): void {
    this.lastSeen[cell] = tick;
    if (!this.useMemory) return;
    const b = this.build;
    if (b.gen[cell] === this.buildGenValue) return; // live threat in sight ⇒ memory = live (set on add)
    if (this.memTick[cell]! >= 0) {
      this.mem[0][cell] = 0;
      this.mem[1][cell] = 0;
      this.mem[2][cell] = 0;
      this.memTick[cell] = tick;
    }
  }

  /** Adds (sign +1) or removes (−1) a structure's contribution. */
  addStructure(cell: number, surface: number, antiAir: number, sign: 1 | -1): void {
    let s = this.structSurface[cell]! + sign * surface;
    let a = this.structAntiAir[cell]! + sign * antiAir;
    if (s < SNAP) s = 0;
    if (a < SNAP) a = 0;
    this.structSurface[cell] = s;
    this.structAntiAir[cell] = a;
  }

  addStructureValue(cell: number, value: number, sign: 1 | -1): void {
    let v = this.structValue[cell]! + sign * value;
    if (v < SNAP) v = 0;
    this.structValue[cell] = v;
  }

  // ---- queries ----------------------------------------------------------------------------------

  /** Published live value of a cell. */
  live(cell: number, layer: GridLayer): number {
    const p = this.pub;
    return p.gen[cell] === this.pubGen ? p.v[layer][cell]! : 0;
  }

  /** Mobile threat of a cell: max(Live, Mem · 0.95^(t − t_mem)). */
  mobile(cell: number, layer: GridLayer, tick: number): number {
    const l = this.live(cell, layer);
    if (!this.useMemory) return l;
    const mt = this.memTick[cell]!;
    if (mt < 0) return l;
    const m = this.mem[layer][cell]!;
    if (m <= 0) return l;
    const d = m * decayFactor((tick - mt) / 10);
    return d > l ? d : l;
  }

  /** Total threat of a cell for a layer (mobile + structures). */
  cellThreat(cell: number, layer: GridLayer, tick: number): number {
    const m = this.mobile(cell, layer, tick);
    if (layer === LAYER_SURFACE) return m + this.structSurface[cell]!;
    if (layer === LAYER_ANTIAIR) return m + this.structAntiAir[cell]!;
    return m;
  }

  threatAt(layer: ThreatQueryLayer, x: number, z: number): number {
    return this.cellThreat(this.cellOf(x, z), layerIndex(layer), this.now());
  }

  /** Σ threat of the cells in the (2k+1)² window around (x, z) (platoon grid mode, ai.md §5.5 MS11+). */
  sumWindow(layer: ThreatQueryLayer, x: number, z: number, k = 1): number {
    const li = layerIndex(layer);
    const t = this.now();
    const cx = this.cx(x);
    const cz = this.cz(z);
    let s = 0;
    for (let r = Math.max(0, cz - k); r <= Math.min(this.dim - 1, cz + k); r++) {
      for (let c = Math.max(0, cx - k); c <= Math.min(this.dim - 1, cx + k); c++) s += this.cellThreat(r * this.dim + c, li, t);
    }
    return s;
  }

  /** Value of known enemy structures in the cell of (x, z). */
  valueAt(x: number, z: number): number {
    return this.structValue[this.cellOf(x, z)]!;
  }

  /** Tick of the last own sight of the cell of (x, z) (−1 = never). */
  lastSeenAt(x: number, z: number): number {
    return this.lastSeen[this.cellOf(x, z)]!;
  }
}
