import { describe, expect, it } from 'vitest';
import {
  beveledBox,
  box,
  capsule,
  cone,
  cylinder,
  extrude,
  frustum,
  icosphere,
  lodSegments,
  prism,
  quad,
  sphere,
  torus,
  tube,
  wedge,
  type Lod,
  type PrimNode,
} from '../src/index.ts';
import { openEdges, primTris, signedVolume } from './helpers.ts';

const closed: [string, PrimNode, number | null][] = [
  ['box', box({ size: [1, 2, 3] }), 6],
  ['beveledBox all', beveledBox({ size: [1, 0.5, 1.4], bevel: 0.1 }), null],
  ['beveledBox hull', beveledBox({ size: [1, 0.18, 1.36], bevel: { top: 0.05, topFront: 0.14, topBack: 0.07 } }), null],
  ['beveledBox bottom', beveledBox({ size: [0.6, 0.2, 1.2], bevel: { bottomFront: 0.08, bottomBack: 0.06, side: 0.05 } }), null],
  ['wedge', wedge({ size: [1, 0.5, 2] }), 0.5],
  ['wedge ramp', wedge({ size: [1, 0.5, 2], front: 0.2 }), 0.7],
  ['prism', prism({ sides: 6, radius: 0.5, height: 1 }), null],
  ['cylinder', cylinder({ radius: 0.5, height: 1, segments: 12 }), null],
  ['cylinder z', cylinder({ radius: 0.2, height: 1, axis: 'z', segments: 6 }), null],
  ['cylinder x', cylinder({ radius: 0.2, height: 1, axis: 'x', segments: 7 }), null],
  ['frustum', frustum({ radius: 0.5, radiusTop: 0.3, height: 1 }), null],
  ['cone', cone({ radius: 0.5, height: 1 }), null],
  ['sphere', sphere({ radius: 0.5, segments: 10, rings: 5 }), null],
  ['hemisphere', sphere({ radius: 0.5, hemi: true }), null],
  ['icosphere', icosphere({ radius: 0.5, detail: 2 }), null],
  ['capsule', capsule({ radius: 0.2, length: 1 }), null],
  ['torus', torus({ radius: 0.6, tube: 0.1 }), null],
  ['torus x', torus({ radius: 0.6, tube: 0.1, axis: 'x' }), null],
  ['tube', tube({ outer: 0.5, inner: 0.4, height: 0.3 }), null],
  ['bowl', tube({ outer: 0.5, inner: 0.4, height: 0.3, floor: 0.05 }), null],
  ['extrude concave', extrude({ profile: [[0, 0], [2, 0], [2, 1], [1, 0.4], [0, 1]], depth: 0.5 }), null],
  ['extrude y cw', extrude({ profile: [[0, 0], [0, 1], [1, 1], [1, 0]], depth: 0.5, axis: 'y' }), 0.5],
];

describe('primitives', () => {
  for (const [name, prim, volume] of closed) {
    for (const lod of [0, 1, 2] as Lod[]) {
      it(`${name} LOD${lod}: closed, outward, positive volume`, () => {
        const tris = primTris(prim, lod, lod === 0 ? 0 : 0.3);
        expect(tris.length).toBeGreaterThan(0);
        expect(openEdges(tris)).toBe(0);
        const v = signedVolume(tris);
        expect(v).toBeGreaterThan(0);
        if (volume !== null) expect(v).toBeCloseTo(volume, 9);
      });
    }
  }

  it('beveled box loses exactly the chamfer prisms', () => {
    // top chamfer t on all four edges of 1 × 0.5 × 2: box part (h − t)·w·d plus a prismatoid of height t,
    // V = t/6 · (A_bottom + 4·A_mid + A_top) with A = w·d, (w − t)(d − t), (w − 2t)(d − 2t)
    const t = 0.1;
    const v = signedVolume(primTris(beveledBox({ size: [1, 0.5, 2], bevel: { top: t } })));
    expect(v).toBeCloseTo(0.4 * 2 + (t / 6) * (2 + 4 * 0.9 * 1.9 + 0.8 * 1.8), 9);
  });

  it('cylinder volume converges with segments and LODs reduce segments', () => {
    const v = signedVolume(primTris(cylinder({ radius: 1, height: 1, segments: 64 })));
    expect(v).toBeGreaterThan(Math.PI * 0.99);
    expect(v).toBeLessThan(Math.PI);
    expect(lodSegments(8, 0)).toBe(8);
    expect(lodSegments(8, 1)).toBe(4);
    expect(lodSegments(12, 1)).toBe(8);
    expect(lodSegments(6, 2)).toBe(4);
    expect(lodSegments(16, 2)).toBe(6);
    expect(() => lodSegments(2, 0)).toThrow();
  });

  it('quad is one-sided facing +Y', () => {
    const tris = primTris(quad({ size: [1, 2] }));
    expect(tris).toHaveLength(2);
    for (const [a, b, c] of tris) {
      const n = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
      expect(n).toBeGreaterThan(0);
    }
  });

  it('extrude LOD drops small corners (Visvalingam)', () => {
    const e = extrude({ profile: [[-0.58, 0], [0.56, 0], [0.68, 0.12], [0.62, 0.24], [-0.62, 0.24], [-0.68, 0.12]], depth: 0.22 });
    expect(primTris(e, 0).length).toBe(20);
    expect(primTris(e, 2, 0.3).length).toBe(12);
  });

  it('rejects invalid sizes', () => {
    expect(() => box({ size: [0, 1, 1] }).gen(0, 0)).toThrow();
    expect(() => beveledBox({ size: [1, 0.1, 1], bevel: { top: 0.1, bottom: 0.1 } }).gen(0, 0)).toThrow();
    expect(() => tube({ outer: 0.3, inner: 0.4, height: 1 }).gen(0, 0)).toThrow();
    expect(() => extrude({ profile: [[0, 0], [1, 1], [1, 0], [0, 1]], depth: 1 }).gen(0, 0)).toThrow();
  });
});
