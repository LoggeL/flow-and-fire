/**
 * Pure geometry helpers of the marker overlay (no WebGL, testable in Node): field outlines,
 * triangulation (THREE.ShapeUtils), subdivision for draping over the terrain and draped
 * polylines. Inputs in Fx raw are converted to WU here, at the three.js boundary.
 *
 * Flat 2D arrays are [x0, z0, x1, z1, …] in WU.
 */
import type { MapPoint, PropFieldShape } from '@faf/formats';
import * as THREE from 'three';
import { FX } from './style.ts';

/** Terrain height (WU) at a WU position. */
export type HeightAtWu = (xWu: number, zWu: number) => number;

/** Circle tessellation: chord <= ~3 WU, 64..512 segments (area error < 0.2 %). */
export function circleSegments(rWu: number): number {
  return Math.min(512, Math.max(64, Math.ceil((2 * Math.PI * rWu) / 3)));
}

/** Circle outline in WU (open ring, counter-clockwise in x/z). */
export function circleOutlineWu(cxWu: number, czWu: number, rWu: number, segments = circleSegments(rWu)): number[] {
  const out: number[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    out.push(cxWu + Math.cos(a) * rWu, czWu + Math.sin(a) * rWu);
  }
  return out;
}

/** Points (Fx raw) as a flat WU array. */
export function pointsToWu(points: readonly MapPoint[]): number[] {
  const out: number[] = [];
  for (const p of points) out.push(p.x / FX, p.z / FX);
  return out;
}

/** Outline of a field shape in WU (open ring). */
export function fieldOutlineWu(shape: PropFieldShape): number[] {
  if (shape.kind === 'circle') return circleOutlineWu(shape.x / FX, shape.z / FX, shape.r / FX);
  return pointsToWu(shape.points);
}

/** Absolute shoelace area (WU²) of a flat ring. */
export function polygonAreaWu(flat: ArrayLike<number>): number {
  const n = flat.length >> 1;
  let a = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    a += flat[j * 2]! * flat[i * 2 + 1]! - flat[i * 2]! * flat[j * 2 + 1]!;
  }
  return Math.abs(a) / 2;
}

/** Centre of the bounding box of a flat ring (WU). */
export function outlineCenterWu(flat: ArrayLike<number>): { x: number; z: number } {
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    x0 = Math.min(x0, flat[i]!);
    x1 = Math.max(x1, flat[i]!);
    z0 = Math.min(z0, flat[i + 1]!);
    z1 = Math.max(z1, flat[i + 1]!);
  }
  return Number.isFinite(x0) ? { x: (x0 + x1) / 2, z: (z0 + z1) / 2 } : { x: 0, z: 0 };
}

/** Triangle index triples of a flat ring (earcut via THREE.ShapeUtils; either winding). */
export function triangulateOutline(flat: ArrayLike<number>): number[] {
  const contour: THREE.Vector2[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) contour.push(new THREE.Vector2(flat[i]!, flat[i + 1]!));
  if (contour.length < 3) return [];
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  const out: number[] = [];
  for (const t of tris) out.push(t[0]!, t[1]!, t[2]!);
  return out;
}

/**
 * Splits every triangle uniformly into n² sub-triangles so that no edge exceeds `maxEdgeWu`
 * (n <= 64). Returns x/z triples per sub-triangle: [ax, az, bx, bz, cx, cz, …] in WU. The total
 * area is preserved exactly (up to float rounding).
 */
export function subdivideTriangles(flat: ArrayLike<number>, indices: readonly number[], maxEdgeWu: number): Float64Array {
  const parts: number[] = [];
  let total = 0;
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const n = subdivisionsFor(flat, indices[t]!, indices[t + 1]!, indices[t + 2]!, maxEdgeWu);
    parts.push(n);
    total += n * n;
  }
  const out = new Float64Array(total * 6);
  let o = 0;
  for (let t = 0, k = 0; t + 2 < indices.length; t += 3, k++) {
    const n = parts[k]!;
    const ax = flat[indices[t]! * 2]!;
    const az = flat[indices[t]! * 2 + 1]!;
    const ux = (flat[indices[t + 1]! * 2]! - ax) / n;
    const uz = (flat[indices[t + 1]! * 2 + 1]! - az) / n;
    const vx = (flat[indices[t + 2]! * 2]! - ax) / n;
    const vz = (flat[indices[t + 2]! * 2 + 1]! - az) / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n - i; j++) {
        // Lower triangle (i, j), (i+1, j), (i, j+1).
        const px = ax + ux * i + vx * j;
        const pz = az + uz * i + vz * j;
        out[o++] = px;
        out[o++] = pz;
        out[o++] = px + ux;
        out[o++] = pz + uz;
        out[o++] = px + vx;
        out[o++] = pz + vz;
        if (i + j + 1 < n) {
          // Upper triangle (i+1, j), (i+1, j+1), (i, j+1).
          out[o++] = px + ux;
          out[o++] = pz + uz;
          out[o++] = px + ux + vx;
          out[o++] = pz + uz + vz;
          out[o++] = px + vx;
          out[o++] = pz + vz;
        }
      }
    }
  }
  return out;
}

function subdivisionsFor(flat: ArrayLike<number>, a: number, b: number, c: number, maxEdgeWu: number): number {
  const d = (i: number, j: number): number => Math.hypot(flat[i * 2]! - flat[j * 2]!, flat[i * 2 + 1]! - flat[j * 2 + 1]!);
  const longest = Math.max(d(a, b), d(b, c), d(c, a));
  return Math.min(64, Math.max(1, Math.ceil(longest / Math.max(1e-6, maxEdgeWu))));
}

/** Sum of the triangle areas (WU²) of x/z triples. */
export function trianglesAreaWu(xz: ArrayLike<number>): number {
  let a = 0;
  for (let i = 0; i + 5 < xz.length; i += 6) {
    a += Math.abs((xz[i + 2]! - xz[i]!) * (xz[i + 5]! - xz[i + 1]!) - (xz[i + 4]! - xz[i]!) * (xz[i + 3]! - xz[i + 1]!)) / 2;
  }
  return a;
}

/** Target edge length for draping a field of `areaWu` WU²: >= 2 WU, about <= `budget` triangles. */
export function drapeEdgeWu(areaWu: number, budget: number): number {
  return Math.max(2, Math.sqrt((2 * areaWu) / Math.max(1, budget)));
}

/** x/z triples to xyz positions with y = terrain height + lift. */
export function drapeTriangles(xz: ArrayLike<number>, heightAt: HeightAtWu, liftWu: number): Float32Array {
  const n = xz.length >> 1;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = xz[i * 2]!;
    const z = xz[i * 2 + 1]!;
    out[i * 3] = x;
    out[i * 3 + 1] = heightAt(x, z) + liftWu;
    out[i * 3 + 2] = z;
  }
  return out;
}

/**
 * A polyline over the terrain as segment pairs (LineSegmentsGeometry layout: x,y,z,x,y,z per
 * segment). Each edge is split so that no piece is longer than `maxSegWu`.
 */
export function drapePolyline(flat: ArrayLike<number>, closed: boolean, maxSegWu: number, heightAt: HeightAtWu, liftWu: number): Float32Array {
  const n = flat.length >> 1;
  const edges = closed ? n : n - 1;
  if (n < 2 || edges < 1) return new Float32Array(0);
  const counts: number[] = [];
  let total = 0;
  for (let e = 0; e < edges; e++) {
    const j = (e + 1) % n;
    const len = Math.hypot(flat[j * 2]! - flat[e * 2]!, flat[j * 2 + 1]! - flat[e * 2 + 1]!);
    const c = Math.min(4096, Math.max(1, Math.ceil(len / Math.max(1e-6, maxSegWu))));
    counts.push(c);
    total += c;
  }
  const out = new Float32Array(total * 6);
  let o = 0;
  for (let e = 0; e < edges; e++) {
    const j = (e + 1) % n;
    const ax = flat[e * 2]!;
    const az = flat[e * 2 + 1]!;
    const dx = flat[j * 2]! - ax;
    const dz = flat[j * 2 + 1]! - az;
    const c = counts[e]!;
    let px = ax;
    let pz = az;
    let py = heightAt(px, pz) + liftWu;
    for (let s = 1; s <= c; s++) {
      const qx = ax + (dx * s) / c;
      const qz = az + (dz * s) / c;
      const qy = heightAt(qx, qz) + liftWu;
      out[o++] = px;
      out[o++] = py;
      out[o++] = pz;
      out[o++] = qx;
      out[o++] = qy;
      out[o++] = qz;
      px = qx;
      py = qy;
      pz = qz;
    }
  }
  return out;
}

/**
 * Symmetry guide for a map of `sizeWu`: axis endpoints (WU) as flat pairs of segments, or a
 * cross around the centre for point symmetry; empty for 'none'.
 */
export function symmetryGuideWu(mode: string, sizeWu: number): number[][] {
  const s = sizeWu;
  const c = s / 2;
  switch (mode) {
    case 'mirrorX':
      return [[c, 0, c, s]];
    case 'mirrorZ':
      return [[0, c, s, c]];
    case 'diagonal':
      return [[0, 0, s, s]];
    case 'antiDiagonal':
      return [[s, 0, 0, s]];
    case 'point': {
      const a = s * 0.06;
      return [
        [c - a, c, c + a, c],
        [c, c - a, c, c + a],
      ];
    }
    default:
      return [];
  }
}
