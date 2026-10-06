/**
 * Test helpers of @faf/nav: map loading and independent brute-force references (Dijkstra,
 * clearance, components, supercover). The references are written separately from the package
 * code on purpose (simple data structures, no shared helpers).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mapSimData, readRtsMap } from '@faf/formats';
import type { NavMapInput, NavRegions } from '../src/index.ts';

export const ROOT = resolve(import.meta.dirname, '../../..');

let hollow: NavMapInput | null = null;

/** content/maps/hollow-ridge.rtsmap as nav input (cached). */
export function hollowRidge(): NavMapInput {
  if (hollow === null) {
    const md = mapSimData(readRtsMap(new Uint8Array(readFileSync(resolve(ROOT, 'content/maps/hollow-ridge.rtsmap')))));
    hollow = { sizeWu: md.sizeWu, dim: md.dim, heights: md.heights, heightScaleRaw: md.heightScaleRaw, waterLevelRaw: md.waterLevelRaw };
  }
  return hollow;
}

/** Flat dry map (all heights `h`). */
export function flatMap(size: number, h = 2560): NavMapInput {
  const dim = size + 1;
  return { sizeWu: size, dim, heights: new Uint16Array(dim * dim).fill(h), heightScaleRaw: 32, waterLevelRaw: null };
}

/** Deterministic xorshift for tests (not the sim RNG). */
export function testRng(seed: number): () => number {
  let s = (seed ^ 0x9e3779b9) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s;
  };
}

// ---------------------------------------------------------------------------------------------
// Reference Dijkstra (lazy deletion, plain arrays)

const DX = [1, -1, 0, 0, 1, -1, 1, -1];
const DZ = [0, 0, 1, -1, 1, 1, -1, -1];

/**
 * Costs from `src` to every cell inside [x0, x1) × [z0, z1) under the nav move rules (octile, no
 * corner cutting, passable ⇔ clearance ≥ cls, step cost base + s·(ka + kb)). −1 = unreachable.
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

// ---------------------------------------------------------------------------------------------
// Brute-force clearance and components

/** Clearance by definition: min Chebyshev distance to a blocked cell, capped at 15. */
export function bruteClearance(terrain: Uint8Array, foot: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size * size);
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      let best = 15;
      // search only the 31×31 window (distances ≥ 15 are capped anyway)
      for (let dz = -14; dz <= 14 && best > 0; dz++) {
        const zz = z + dz;
        if (zz < 0 || zz >= size) continue;
        for (let dx = -14; dx <= 14; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= size) continue;
          const i = zz * size + xx;
          if (terrain[i] === 0 || foot[i] !== 0) {
            const d = Math.max(Math.abs(dx), Math.abs(dz));
            if (d < best) best = d;
          }
        }
      }
      out[z * size + x] = best;
    }
  }
  return out;
}

/** Canonical component labels (scan order of the smallest cell), BFS with the nav move rules. */
export function bruteComponents(clear: Uint8Array, size: number, cls: number): { labels: Uint16Array; count: number } {
  const labels = new Uint16Array(size * size);
  let count = 0;
  for (let i = 0; i < size * size; i++) {
    if (clear[i]! < cls || labels[i] !== 0) continue;
    count++;
    const q = [i];
    labels[i] = count;
    while (q.length > 0) {
      const c = q.pop()!;
      const x = c % size;
      const z = Math.floor(c / size);
      for (let k = 0; k < 8; k++) {
        const nx = x + DX[k]!;
        const nz = z + DZ[k]!;
        if (nx < 0 || nx >= size || nz < 0 || nz >= size) continue;
        const j = nz * size + nx;
        if (clear[j]! < cls || labels[j] !== 0) continue;
        if (k >= 4 && (clear[z * size + nx]! < cls || clear[nz * size + x]! < cls)) continue;
        labels[j] = count;
        q.push(j);
      }
    }
  }
  return { labels, count };
}

// ---------------------------------------------------------------------------------------------
// Supercover by geometry: cells whose closed square intersects the segment between two centres

/**
 * All cells whose closed unit square touches the closed segment between the centres of cells
 * (ax, az) and (bx, bz). Exact integer arithmetic (coordinates doubled: centres are odd).
 */
export function geometricSupercover(ax: number, az: number, bx: number, bz: number): [number, number][] {
  const out: [number, number][] = [];
  const Ax = 2 * ax + 1;
  const Az = 2 * az + 1;
  const Bx = 2 * bx + 1;
  const Bz = 2 * bz + 1;
  for (let z = Math.min(az, bz) - 1; z <= Math.max(az, bz) + 1; z++) {
    for (let x = Math.min(ax, bx) - 1; x <= Math.max(ax, bx) + 1; x++) {
      // square [2x, 2x+2] × [2z, 2z+2]
      const sx0 = 2 * x;
      const sx1 = 2 * x + 2;
      const sz0 = 2 * z;
      const sz1 = 2 * z + 2;
      if (Math.max(Ax, Bx) < sx0 || Math.min(Ax, Bx) > sx1 || Math.max(Az, Bz) < sz0 || Math.min(Az, Bz) > sz1) continue;
      // line side test of the 4 corners: the segment touches the square iff not all strictly on one side
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

/** Names of the derived nav regions. */
export const DERIVED = ['clear', 'comp', 'compMeta', 'secInfo', 'nodes', 'edges', 'back'] as const;

/** Copies of the derived region bytes. */
export function derivedBytes(regions: NavRegions): Uint8Array[] {
  return DERIVED.map((n) => regions[n].u8.slice());
}

/** Index of the first differing byte per region (−1 = equal), for readable failures. */
export function firstDiffs(a: readonly Uint8Array[], b: readonly Uint8Array[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (let r = 0; r < a.length; r++) {
    let d = -1;
    const x = a[r]!;
    const y = b[r]!;
    for (let i = 0; i < x.length; i++) {
      if (x[i] !== y[i]) {
        d = i;
        break;
      }
    }
    out[DERIVED[r]!] = d;
  }
  return out;
}
