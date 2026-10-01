/**
 * Land passability on the 2-WU grid — exact port of `analyze_map` in tools/ai-sim/ecosim.py.
 * Adapter boundary: from MS9 nav delivers `passLowRes` (same semantics: slope ≤ 0.6, water depth
 * ≤ 0.5 WU, 2-WU cells).
 *
 * Heightfield: dim = sizeWu + 1 samples per edge, index z·dim + x, height in WU = raw ·
 * heightScaleRaw / 4096. Gradient with numpy.gradient semantics (central differences inside,
 * one-sided at the border, spacing 1 WU); a sample is passable if (waterLevel − h) ≤ maxWaterDepth
 * and |∇h| ≤ maxSlope; a cell of `cellWu`² samples is passable if all its samples are.
 */

export interface HeightInput {
  readonly sizeWu: number;
  /** sizeWu + 1. */
  readonly dim: number;
  readonly heights: Uint16Array;
  readonly heightScaleRaw: number;
  /** Water surface in Fx raw, null = no water. */
  readonly waterLevelRaw: number | null;
}

export interface PassOptions {
  readonly maxSlope: number;
  readonly maxWaterDepthWu: number;
  readonly cellWu: number;
}

export const DEFAULT_PASS_OPTIONS: PassOptions = { maxSlope: 0.6, maxWaterDepthWu: 0.5, cellWu: 2 };

const FX_ONE = 4096;

function checkInput(h: HeightInput, cellWu: number): number {
  if (h.dim !== h.sizeWu + 1) throw new RangeError(`passability: dim ${h.dim} != sizeWu + 1`);
  if (h.heights.length !== h.dim * h.dim) throw new RangeError('passability: heights length mismatch');
  if (!Number.isInteger(cellWu) || cellWu < 1) throw new RangeError(`passability: bad cellWu ${cellWu}`);
  return Math.floor((h.dim - 1) / cellWu);
}

/** Height of sample (x, z) in WU. */
export function sampleHeightWu(h: HeightInput, x: number, z: number): number {
  return (h.heights[z * h.dim + x]! * h.heightScaleRaw) / FX_ONE;
}

/**
 * Per-sample passability (dim² bytes, 1 = passable) — the full-resolution mask before the 2-WU
 * reduction; exposed for tests and tools.
 */
export function computePassSamples(h: HeightInput, opts: PassOptions = DEFAULT_PASS_OPTIONS): Uint8Array {
  const dim = h.dim;
  const hs = new Float64Array(dim * dim);
  for (let i = 0; i < hs.length; i++) hs[i] = (h.heights[i]! * h.heightScaleRaw) / FX_ONE;
  const wl = h.waterLevelRaw === null ? null : h.waterLevelRaw / FX_ONE;
  const out = new Uint8Array(dim * dim);
  const maxSlope = opts.maxSlope;
  const maxDepth = opts.maxWaterDepthWu;
  for (let z = 0; z < dim; z++) {
    const row = z * dim;
    for (let x = 0; x < dim; x++) {
      const i = row + x;
      const hv = hs[i]!;
      if (wl !== null && !(wl - hv <= maxDepth)) continue;
      // numpy.gradient(h): axis 0 = z (rows), axis 1 = x (columns), edge_order 1.
      let gx: number;
      if (dim === 1) gx = 0;
      else if (x === 0) gx = hs[i + 1]! - hv;
      else if (x === dim - 1) gx = hv - hs[i - 1]!;
      else gx = (hs[i + 1]! - hs[i - 1]!) / 2;
      let gz: number;
      if (dim === 1) gz = 0;
      else if (z === 0) gz = hs[i + dim]! - hv;
      else if (z === dim - 1) gz = hv - hs[i - dim]!;
      else gz = (hs[i + dim]! - hs[i - dim]!) / 2;
      if (Math.sqrt(gx * gx + gz * gz) <= maxSlope) out[i] = 1;
    }
  }
  return out;
}

/**
 * Land passability on the `cellWu` grid: n = floor((dim − 1) / cellWu) cells per edge, index
 * cz·n + cx; a cell is passable if all samples [cx·g, cx·g + g) × [cz·g, cz·g + g) are.
 */
export function computePassLowRes(h: HeightInput, opts: PassOptions = DEFAULT_PASS_OPTIONS): Uint8Array {
  const g = opts.cellWu;
  const n = checkInput(h, g);
  const samples = computePassSamples(h, opts);
  const dim = h.dim;
  const out = new Uint8Array(n * n);
  for (let cz = 0; cz < n; cz++) {
    for (let cx = 0; cx < n; cx++) {
      let ok = 1;
      for (let dz = 0; dz < g && ok; dz++) {
        const row = (cz * g + dz) * dim + cx * g;
        for (let dx = 0; dx < g; dx++) {
          if (samples[row + dx] === 0) {
            ok = 0;
            break;
          }
        }
      }
      out[cz * n + cx] = ok;
    }
  }
  return out;
}

/** Terrain height per cell in WU: the sample at the cell centre (cx·g + ⌊g/2⌋, cz·g + ⌊g/2⌋). */
export function heightLowRes(h: HeightInput, cellWu: number = DEFAULT_PASS_OPTIONS.cellWu): Float64Array {
  const n = checkInput(h, cellWu);
  const half = Math.floor(cellWu / 2);
  const out = new Float64Array(n * n);
  for (let cz = 0; cz < n; cz++) {
    for (let cx = 0; cx < n; cx++) out[cz * n + cx] = sampleHeightWu(h, cx * cellWu + half, cz * cellWu + half);
  }
  return out;
}

export interface Components {
  /** Label per cell, −1 = impassable; labels 0..count−1 in scan order of their first cell. */
  readonly labels: Int32Array;
  readonly count: number;
}

/**
 * Connected components of a passability grid (8-neighbourhood; a diagonal step needs both
 * orthogonal neighbours passable, like the Dijkstra graph of ecosim.py). Flood fill with an
 * explicit queue, scan order row-major.
 */
export function labelComponents(pass: Uint8Array, dim: number): Components {
  if (pass.length !== dim * dim) throw new RangeError('labelComponents: size mismatch');
  const labels = new Int32Array(dim * dim).fill(-1);
  const queue = new Int32Array(dim * dim);
  let count = 0;
  for (let start = 0; start < pass.length; start++) {
    if (pass[start] === 0 || labels[start] !== -1) continue;
    const label = count++;
    let head = 0;
    let tail = 0;
    labels[start] = label;
    queue[tail++] = start;
    while (head < tail) {
      const c = queue[head++]!;
      const cx = c % dim;
      const cz = (c - cx) / dim;
      for (let dz = -1; dz <= 1; dz++) {
        const nz = cz + dz;
        if (nz < 0 || nz >= dim) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const nx = cx + dx;
          if (nx < 0 || nx >= dim) continue;
          const ni = nz * dim + nx;
          if (pass[ni] === 0 || labels[ni] !== -1) continue;
          if (dx !== 0 && dz !== 0 && (pass[cz * dim + nx] === 0 || pass[nz * dim + cx] === 0)) continue;
          labels[ni] = label;
          queue[tail++] = ni;
        }
      }
    }
  }
  return { labels, count };
}
