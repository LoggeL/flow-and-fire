import { describe, expect, it } from 'vitest';
import {
  circleOutlineWu,
  drapePolyline,
  drapeTriangles,
  fieldOutlineWu,
  polygonAreaWu,
  subdivideTriangles,
  symmetryGuideWu,
  trianglesAreaWu,
  triangulateOutline,
} from '../../src/overlay/geometry.ts';
import { WU } from '../pick/support.ts';

const POLYGONS: Record<string, number[]> = {
  square: [10, 10, 50, 10, 50, 50, 10, 50],
  // Concave L shape, clockwise.
  lShape: [0, 0, 0, 40, 40, 40, 40, 30, 10, 30, 10, 0],
  // Star with 7 spikes (concave, 14 vertices).
  star: Array.from({ length: 14 }, (_, i) => {
    const a = (i / 14) * Math.PI * 2;
    const r = i % 2 === 0 ? 60 : 22;
    return [100 + Math.cos(a) * r, 100 + Math.sin(a) * r];
  }).flat(),
  sliver: [0, 0, 200, 3, 0, 6],
};

describe('field triangulation', () => {
  for (const [name, poly] of Object.entries(POLYGONS)) {
    it(`${name}: triangle area == polygon area ±1 % (also after subdivision)`, () => {
      const area = polygonAreaWu(poly);
      const tris = triangulateOutline(poly);
      expect(tris.length % 3).toBe(0);
      expect(tris.length / 3).toBe(poly.length / 2 - 2);
      const flatXz = subdivideTriangles(poly, tris, 1e9);
      expect(Math.abs(trianglesAreaWu(flatXz) - area) / area).toBeLessThan(0.01);
      const fine = subdivideTriangles(poly, tris, 4);
      expect(Math.abs(trianglesAreaWu(fine) - area) / area).toBeLessThan(0.01);
      // Every sub-triangle edge is <= the target (up to float rounding).
      for (let i = 0; i < fine.length; i += 6) {
        for (const [a, b] of [
          [0, 2],
          [2, 4],
          [4, 0],
        ] as const) {
          expect(Math.hypot(fine[i + a]! - fine[i + b]!, fine[i + a + 1]! - fine[i + b + 1]!)).toBeLessThanOrEqual(4 + 1e-9);
        }
      }
    });
  }

  it('circle fields: tessellated area within 1 % of πr²', () => {
    for (const r of [1, 5, 40, 300, 2000]) {
      const outline = fieldOutlineWu({ kind: 'circle', x: 3000 * WU, z: 3000 * WU, r: r * WU });
      const tris = triangulateOutline(outline);
      const area = trianglesAreaWu(subdivideTriangles(outline, tris, Math.max(2, r / 20)));
      expect(Math.abs(area - Math.PI * r * r) / (Math.PI * r * r)).toBeLessThan(0.01);
    }
  });

  it('polygon outlines convert Fx raw to WU', () => {
    expect(
      fieldOutlineWu({
        kind: 'polygon',
        points: [
          { x: 4096, z: 8192 },
          { x: 6144, z: 8192 },
          { x: 6144, z: 2048 },
        ],
      }),
    ).toEqual([1, 2, 1.5, 2, 1.5, 0.5]);
  });

  it('degenerate input yields no triangles', () => {
    expect(triangulateOutline([0, 0, 1, 1])).toEqual([]);
    expect(trianglesAreaWu(subdivideTriangles([0, 0, 1, 1], [], 1))).toBe(0);
  });
});

describe('draping', () => {
  const ramp = (x: number, z: number): number => 0.5 * x + 0.25 * z;

  it('drapeTriangles puts every vertex on the terrain plus lift', () => {
    const xz = subdivideTriangles(POLYGONS['square']!, triangulateOutline(POLYGONS['square']!), 4);
    const pos = drapeTriangles(xz, ramp, 0.1);
    expect(pos.length).toBe((xz.length / 2) * 3);
    for (let i = 0; i < pos.length; i += 3) expect(pos[i + 1]!).toBeCloseTo(ramp(pos[i]!, pos[i + 2]!) + 0.1, 4);
  });

  it('drapePolyline splits edges to the max segment length and closes rings', () => {
    const closed = drapePolyline([0, 0, 10, 0, 10, 10], true, 1, ramp, 0);
    const open = drapePolyline([0, 0, 10, 0, 10, 10], false, 1, ramp, 0);
    // Edges 10 + 10 (+ 14.14 → 15 pieces when closed).
    expect(open.length / 6).toBe(20);
    expect(closed.length / 6).toBe(35);
    for (let i = 0; i < closed.length; i += 6) {
      expect(Math.hypot(closed[i + 3]! - closed[i]!, closed[i + 5]! - closed[i + 2]!)).toBeLessThanOrEqual(1 + 1e-6);
      expect(closed[i + 1]!).toBeCloseTo(ramp(closed[i]!, closed[i + 2]!), 4);
    }
    // Consecutive segments connect.
    for (let i = 6; i < closed.length; i += 6) {
      expect(closed[i]).toBe(closed[i - 3]);
      expect(closed[i + 2]).toBe(closed[i - 1]);
    }
    expect(drapePolyline([0, 0], false, 1, ramp, 0).length).toBe(0);
  });

  it('circle outline has the requested segments on the radius', () => {
    const c = circleOutlineWu(5, 6, 3, 32);
    expect(c.length).toBe(64);
    for (let i = 0; i < c.length; i += 2) expect(Math.hypot(c[i]! - 5, c[i + 1]! - 6)).toBeCloseTo(3, 9);
  });
});

describe('symmetry guides', () => {
  it('axes follow the P2 mirror definitions (S = sizeWu)', () => {
    expect(symmetryGuideWu('none', 512)).toEqual([]);
    expect(symmetryGuideWu('mirrorX', 512)).toEqual([[256, 0, 256, 512]]); // (S−x, z): axis x = S/2
    expect(symmetryGuideWu('mirrorZ', 512)).toEqual([[0, 256, 512, 256]]); // (x, S−z): axis z = S/2
    expect(symmetryGuideWu('diagonal', 512)).toEqual([[0, 0, 512, 512]]); // (z, x): axis x = z
    expect(symmetryGuideWu('antiDiagonal', 512)).toEqual([[512, 0, 0, 512]]); // (S−z, S−x): x + z = S
    const cross = symmetryGuideWu('point', 512);
    expect(cross).toHaveLength(2);
    for (const seg of cross) expect((seg[0]! + seg[2]!) / 2).toBe(256);
  });
});
