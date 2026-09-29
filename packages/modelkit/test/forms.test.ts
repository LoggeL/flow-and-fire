/** Tests of the forms for Skarn, Sael and Aurith (forms.ts, curves.ts). */
import { describe, expect, it } from 'vitest';
import {
  arcPoints,
  bezier,
  bipyramid,
  buildModel,
  catmullRom,
  checkModelDef,
  claw,
  crystal,
  crystalCluster,
  DEFAULT_PALETTE,
  defineModel,
  definePalette,
  disc,
  domeShell,
  ellipsoid,
  glyphStrip,
  legJoints,
  legPairs,
  lens,
  limb,
  limbParts,
  pathFrames,
  plate,
  spike,
  strut,
  sweep,
  torusArc,
  type Lod,
  type PrimNode,
  type Shape,
  type Vec3,
} from '../src/index.ts';
import { openEdges, primTris, signedVolume, type Tri } from './helpers.ts';

const closed: [string, PrimNode, number | null][] = [
  ['strut 4', strut({ from: [0, 0, 0], to: [0.3, 1, 0.2], radius: 0.1 }), null],
  ['strut 6 tapered', strut({ from: [0, 0, 0], to: [0, 0, 1], radius: 0.2, radiusEnd: 0.1, sides: 6 }), null],
  ['strut vertical', strut({ from: [0, 0, 0], to: [0, 1, 0], radius: 0.5 }), 0.5],
  ['spike', spike({ from: [0, 0, 0], to: [0, 1, 0], radius: 0.5 }), 0.5 / 3],
  ['claw', claw({ from: [0, 0, 0], to: [0, 0, 1], bend: [0, 0.3, 0], radius: 0.1 }), null],
  ['bipyramid', bipyramid({ radius: 0.5, length: 2 }), (2 * 0.25 * 2) / 3],
  ['bipyramid 6 front', bipyramid({ radius: 0.3, length: 1, front: 0.7, sides: 6, axis: 'x' }), null],
  ['plate flat', plate({ size: [1, 2], thickness: 0.1 }), 0.2],
  ['plate vault', plate({ size: [1, 1.4], thickness: 0.06, arch: 0.15, archZ: 0.05, segments: [4, 3] }), null],
  ['plate pointed', plate({ size: [1, 1.4], thickness: 0.06, arch: 0.1, point: 0.8 }), null],
  ['sweep straight', sweep({ path: [[0, 0, 0], [0, 0, 1]], radius: 0.2, sides: 6 }), null],
  ['sweep curve samples', sweep({ path: [[0, 0, 0], [0, 0.5, 1], [0, 0.2, 2]], radius: [0.2, [0.4, 0.2], 0.1], samples: 8 }), null],
  ['sweep pointed', sweep({ path: [[0, 0, 0], [0, 0, 1], [0, 0, 1.5]], radius: [0.3, 0.3, 0], sides: 5 }), null],
  ['sweep profile', sweep({ path: [[0, 0, -1], [0, 0, 1]], radius: [[0.5, 0.3], [0.2, 0.1]], profile: [[1, 0], [0, 1], [-1, 0], [0, -0.5]] }), null],
  ['sweep vertical', sweep({ path: [[0, 0, 0], [0, 1, 0], [0.3, 2, 0]], radius: 0.3, sides: 8 }), null],
  ['ellipsoid', ellipsoid({ radii: [1, 0.5, 0.7] }), null],
  ['ellipsoid half drop', ellipsoid({ radii: [0.6, 0.3, 0.9], half: true, drop: 0.5 }), null],
  ['ellipsoid z', ellipsoid({ radii: [0.3, 0.2, 0.25], half: true, axis: 'z' }), null],
  ['lens', lens({ radius: 0.5, thickness: 0.2 }), null],
  ['disc', disc({ radius: 1, height: 0.12, bevel: 0.06 }), null],
  ['disc flat', disc({ radius: 1, height: 0.2, bevel: 0, segments: 6 }), null],
  ['disc x', disc({ radius: 0.3, height: 0.2, axis: 'x' }), null],
  ['torusArc', torusArc({ radius: 0.6, tube: 0.1 }), null],
  ['torusArc pointed', torusArc({ radius: 0.6, tube: 0.1, arc: 200, taper: 0, flatten: 0.6, sides: 6, axis: 'z' }), null],
  ['domeShell', domeShell({ radius: 1, thickness: 0.1 }), null],
  ['domeShell flat', domeShell({ radius: 1, thickness: 0.2, arc: 50, axis: 'z' }), null],
  ['domeShell deep', domeShell({ radius: 1, thickness: 0.1, arc: 130 }), null],
  ['crystal', crystal({ radius: 0.2, height: 0.6 }), null],
  ['crystal double', crystal({ radius: 0.2, height: 0.6, bottomTip: 0.2, taper: 0.7, sides: 4 }), null],
];

describe('forms: closed volumes', () => {
  for (const [name, prim, volume] of closed) {
    for (const lod of [0, 1, 2] as Lod[]) {
      it(`${name} LOD${lod}: closed, outward, positive volume`, () => {
        const tris = primTris(prim, lod, lod === 0 ? 0 : 0.3);
        expect(tris.length).toBeGreaterThan(0);
        expect(openEdges(tris)).toBe(0);
        const v = signedVolume(tris);
        expect(v).toBeGreaterThan(0);
        if (volume !== null && lod === 0) expect(v).toBeCloseTo(volume, 9);
      });
    }
  }

  it('round forms lose segments in far LODs', () => {
    for (const p of [ellipsoid({ radii: [1, 1, 1], segments: 12 }), disc({ radius: 1, height: 0.2 }), torusArc({ radius: 1, tube: 0.1, sides: 8 }), sweep({ path: [[0, 0, 0], [0, 1, 1], [0, 0, 2]], radius: 0.2, samples: 10 })]) {
      const n = [0, 1, 2].map((l) => primTris(p, l as Lod).length);
      expect(n[1]).toBeLessThan(n[0]!);
      expect(n[2]).toBeLessThanOrEqual(n[1]!);
    }
    // design-critical faceted sections stay (Skarn 4-sided beams)
    const s = strut({ from: [0, 0, 0], to: [0, 1, 0], radius: 0.1 });
    expect(primTris(s, 2).length).toBe(primTris(s, 0).length);
  });

  it('ellipsoid and dome shell converge to their analytic volumes', () => {
    const e = signedVolume(primTris(ellipsoid({ radii: [1, 0.5, 0.7], segments: 64, rings: 32 })));
    expect(e / ((4 / 3) * Math.PI * 0.35)).toBeGreaterThan(0.98);
    const h = signedVolume(primTris(ellipsoid({ radii: [1, 0.5, 0.7], segments: 64, rings: 16, half: true })));
    expect(h / ((2 / 3) * Math.PI * 0.35)).toBeGreaterThan(0.98);
    const d = signedVolume(primTris(domeShell({ radius: 1, thickness: 0.1, segments: 64, rings: 16 })));
    expect(d / ((2 / 3) * Math.PI * (1 - 0.9 ** 3))).toBeGreaterThan(0.97);
    expect(d / ((2 / 3) * Math.PI * (1 - 0.9 ** 3))).toBeLessThan(1.001);
  });

  it('centered forms are centered on their bounding box', () => {
    for (const p of [bipyramid({ radius: 0.3, length: 1, front: 0.7 }), ellipsoid({ radii: [1, 0.5, 0.7], half: true }), domeShell({ radius: 1, thickness: 0.2, arc: 60 }), crystal({ radius: 0.2, height: 0.5, tip: 0.3 }), plate({ size: [1, 1], thickness: 0.1, arch: 0.2 }), disc({ radius: 1, height: 0.2 })]) {
      const b = bounds(primTris(p));
      expect(b.min[1] + b.max[1]).toBeCloseTo(0, 9);
      expect(b.min[2] + b.max[2]).toBeCloseTo(0, 9);
    }
  });

  it('drop narrows the front of an ellipsoid, point narrows the front of a plate', () => {
    const tris = primTris(ellipsoid({ radii: [1, 0.5, 1], drop: 0.6, segments: 16, rings: 8 }));
    const front = tris.flat().filter((p) => p[2] > 0.5);
    const back = tris.flat().filter((p) => p[2] < -0.5);
    expect(Math.max(...front.map((p) => Math.abs(p[0])))).toBeLessThan(Math.max(...back.map((p) => Math.abs(p[0]))));
    const pl = primTris(plate({ size: [1, 1], thickness: 0.1, point: 0.8 })).flat();
    expect(Math.max(...pl.filter((p) => p[2] > 0.49).map((p) => Math.abs(p[0])))).toBeCloseTo(0.1, 9);
  });

  it('torusArc spans its arc around the ring center and tapers', () => {
    const t = primTris(torusArc({ radius: 1, tube: 0.1, arc: 90, startDeg: 0, taper: 0 })).flat();
    for (const p of t) {
      expect(Math.hypot(p[0], p[2])).toBeGreaterThan(0.85);
      expect(p[0]).toBeGreaterThan(-0.11);
      expect(p[2]).toBeGreaterThan(-0.11);
    }
    // default start centers the arc on +Z (front)
    const c = bounds(primTris(torusArc({ radius: 1, tube: 0.1, arc: 120 })));
    expect(c.min[0] + c.max[0]).toBeCloseTo(0, 6);
    expect(c.max[2]).toBeGreaterThan(1);
  });

  it('input validation', () => {
    expect(() => strut({ from: [0, 0, 0], to: [0, 0, 0], radius: 0.1 })).toThrow();
    expect(() => plate({ size: [1, 1], thickness: 0.1, point: 1 })).toThrow();
    expect(() => ellipsoid({ radii: [1, 1, 1], drop: 1 })).toThrow();
    expect(() => domeShell({ radius: 1, thickness: 1 })).toThrow();
    expect(() => torusArc({ radius: 1, tube: 0.1, arc: 360 })).toThrow();
    expect(() => sweep({ path: [[0, 0, 0], [0, 0, 1], [0, 0, 2]], radius: [0.1, 0.2] })).toThrow();
    expect(() => disc({ radius: 1, height: 0.1, bevel: 0.2 })).toThrow();
  });
});

describe('curves', () => {
  it('Bézier, Catmull-Rom and arcs keep their end points', () => {
    const b = bezier([[0, 0, 0], [1, 2, 0], [2, 0, 0]], 4);
    expect(b).toHaveLength(5);
    expect(b[0]).toEqual([0, 0, 0]);
    expect(b[4]).toEqual([2, 0, 0]);
    expect(b[2]![1]).toBeCloseTo(1, 12);
    const c = catmullRom([[0, 0, 0], [1, 1, 0], [2, 0, 0], [3, 1, 0]], 9);
    expect(c).toHaveLength(9);
    expect(c[0]).toEqual([0, 0, 0]);
    expect(c[8]).toEqual([3, 1, 0]);
    const a = arcPoints(2, 0, 90, 3);
    expect(a[0]![0]).toBeCloseTo(2, 12);
    expect(a[3]![2]).toBeCloseTo(2, 12);
    for (const p of a) expect(Math.hypot(p[0], p[2])).toBeCloseTo(2, 12);
  });

  it('path frames are orthonormal and rotation-minimizing', () => {
    const path = catmullRom([[0, 0, 0], [0, 1, 1], [1, 1, 2], [1, 3, 3]], 12);
    const f = pathFrames(path);
    const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    for (const fr of f) {
      expect(dot(fr.t, fr.t)).toBeCloseTo(1, 9);
      expect(dot(fr.n, fr.n)).toBeCloseTo(1, 9);
      expect(dot(fr.t, fr.n)).toBeCloseTo(0, 9);
      expect(dot(fr.b, fr.t)).toBeCloseTo(0, 9);
    }
    // horizontal path along +Z: b points up (profile v = up), n sideways
    const h = pathFrames([[0, 0, 0], [0, 0, 1]]);
    expect(h[0]!.b[1]).toBeCloseTo(1, 12);
    expect(Math.abs(h[0]!.n[0])).toBeCloseTo(1, 12);
    expect(() => pathFrames([[0, 0, 0], [0, 0, 0]])).toThrow();
  });
});

describe('limbs', () => {
  const hip: Vec3 = [0.4, 1, 0.3];
  const foot: Vec3 = [1.6, 0, 0.6];

  it('legJoints: knee between hip and foot, lifted and bent back', () => {
    const [h, k, f] = legJoints(hip, foot, { kneeAt: 0.5, kneeUp: 0.6, kneeBack: 0.2 });
    expect(h).toEqual(hip);
    expect(f).toEqual(foot);
    expect(k[0]).toBeCloseTo(1, 12);
    expect(k[1]).toBeCloseTo(1.1, 12);
    expect(k[2]).toBeCloseTo(0.25, 12);
  });

  it('limb: one closed strut per segment, pointed foot, optional caps', () => {
    const l = limb({ joints: legJoints(hip, foot, { kneeUp: 0.6 }), radius: [0.12, 0.11, 0] });
    expect(l.children).toHaveLength(2);
    for (const s of l.children) expect(openEdges(primTris(s as PrimNode))).toBe(0);
    const tip = primTris(l.children[1] as PrimNode).flat();
    expect(tip.some((p) => Math.abs(p[0] - foot[0]) < 1e-9 && Math.abs(p[1]) < 1e-9)).toBe(true);
    const open = limb({ joints: legJoints(hip, foot), radius: 0.1, hipCap: false, jointCaps: false });
    const a = primTris(open.children[0] as PrimNode).length;
    const b = primTris(l.children[0] as PrimNode).length;
    expect(a).toBeLessThan(b);
  });

  it('legPairs: mirrored sets, pivots at the mean hip', () => {
    const lp = legPairs({ hips: [[0.4, 1, 0.4], [0.4, 1, 0], [0.4, 1, -0.4]], footOut: 1.2, kneeUp: 0.8, radius: [0.12, 0.1, 0], mat: 'team' });
    expect(lp.joints).toHaveLength(3);
    lp.pivotL.forEach((v, i) => expect(v).toBeCloseTo([0.4, 1, 0][i]!, 12));
    lp.pivotR.forEach((v, i) => expect(v).toBeCloseTo([-0.4, 1, 0][i]!, 12));
    expect(lp.joints[0]![2][2]).toBeCloseTo(0.4 * 1.4, 12);
    const m = buildModel(
      defineModel({ id: 'test:spider', parts: [{ name: 'hull', shapes: [lp.left, lp.right] }] }),
      { faction: 'test', palette: DEFAULT_PALETTE },
    );
    expect(m.errors).toEqual([]);
    expect(m.bounds.min[0]).toBeCloseTo(-m.bounds.max[0], 6);
    expect(m.bounds.max[0]).toBeGreaterThan(1.5);
    expect(m.bounds.min[1]).toBeCloseTo(0, 6);
  });

  it('limbParts: one part per segment, pivots at the joints, parent chain', () => {
    const parts = limbParts({ name: 'leg', joints: [[0, 2, 0], [0.5, 1, 0.2], [0.6, 0, 0.3]], radius: 0.15, mat: 'dark' });
    expect(parts.map((p) => [p.name, p.parent, p.anim])).toEqual([
      ['leg_0', 'hull', 'pitch'],
      ['leg_1', 'leg_0', 'pitch'],
    ]);
    expect(parts[1]!.pivot).toEqual([0.5, 1, 0.2]);
    const def = { id: 'test:walker', parts: [{ name: 'hull', shapes: [strut({ from: [0, 1.9, 0], to: [0, 2.4, 0], radius: 0.3 })] }, ...parts] };
    expect(checkModelDef(def)).toEqual([]);
    const m = buildModel(def, { faction: 'test', palette: DEFAULT_PALETTE });
    expect(m.errors).toEqual([]);
    expect(m.parts.map((p) => p.parent)).toEqual([0, 0, 1]);
  });
});

describe('crystals and glyphs', () => {
  it('crystalCluster is deterministic, stands on its origin and leans outwards', () => {
    const a = crystalCluster({ count: 4, radius: 0.1, height: 0.4, seed: 5 });
    const b = crystalCluster({ count: 4, radius: 0.1, height: 0.4, seed: 5 });
    const c = crystalCluster({ count: 4, radius: 0.1, height: 0.4, seed: 6 });
    expect(a.children).toHaveLength(4);
    const build = (g: Shape) => buildModel(defineModel({ id: 'test:c', parts: [{ name: 'hull', shapes: [g] }] }), { faction: 't', palette: DEFAULT_PALETTE });
    const ma = build(a);
    expect(ma.errors).toEqual([]);
    expect(Array.from(ma.lods[0]!.positions)).toEqual(Array.from(build(b).lods[0]!.positions));
    expect(Array.from(ma.lods[0]!.positions)).not.toEqual(Array.from(build(c).lods[0]!.positions));
    expect(ma.bounds.min[1]).toBeGreaterThan(-0.1);
    expect(ma.bounds.min[1]).toBeLessThan(0);
    expect(ma.bounds.max[1]).toBeCloseTo(0.4 * 0.92 + 0.15, 6); // central crystal: height − sink + tip
  });

  it('glyphStrip: dashes follow the pattern, face the normal, lie lifted on the surface', () => {
    const g = glyphStrip({ path: [[0, 0, 0], [0, 0, 1]], width: 0.1, pattern: [0.2, -0.1], widths: [1, 0.5], lift: 0.01 });
    const polys = g.gen(0, 0);
    expect(polys).toHaveLength(4); // 0–0.2, 0.3–0.5, 0.6–0.8, 0.9–1.0
    for (const p of polys) for (const v of p) expect(v[1]).toBeCloseTo(0.01, 12);
    const widths = polys.map((p) => Math.max(...p.map((v) => v[0])) - Math.min(...p.map((v) => v[0])));
    expect(widths[0]).toBeCloseTo(0.1, 12);
    expect(widths[1]).toBeCloseTo(0.05, 12);
    for (const tri of primTris(g)) {
      const [a, b, c] = tri;
      const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
      expect(ny).toBeGreaterThan(0);
    }
    const side = glyphStrip({ path: [[0.5, 0, 0], [0.5, 1, 0]], normal: [1, 0, 0] });
    for (const p of side.gen(0, 0)) for (const v of p) expect(v[0]).toBeCloseTo(0.506, 12);
    expect(() => glyphStrip({ path: [[0, 0, 0], [0, 0, 1]], pattern: [-0.1] })).toThrow();
  });
});

describe('palette extras', () => {
  it('extra slots are optional; using an undefined one is a build error', () => {
    const def = defineModel({ id: 'test:x', parts: [{ name: 'hull', shapes: [strut({ from: [0, 0, 0], to: [0, 1, 0], radius: 0.2, mat: 'glow2' })] }] });
    const m = buildModel(def, { faction: 't', palette: DEFAULT_PALETTE });
    expect(m.errors.join()).toMatch(/glow2/);
    const pal = definePalette({ ...DEFAULT_PALETTE, faction: 't', slots: { ...DEFAULT_PALETTE.slots, glow2: { color: '#00FF00' } } });
    const ok = buildModel(def, { faction: 't', palette: pal });
    expect(ok.errors).toEqual([]);
    expect(ok.lods[0]!.matArea.glow2).toBeGreaterThan(0);
    expect(ok.lods[0]!.mask[1]).toBe(Math.round(0.6 * 255)); // glow2 default strength
    expect(Object.keys(m.lods[0]!.matArea)).toEqual(['base', 'dark', 'metal', 'team', 'glow', 'glass', 'accent']);
  });
});

function bounds(tris: Tri[]): { min: Vec3; max: Vec3 } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) {
    for (const p of t) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k]!, p[k]!);
        max[k] = Math.max(max[k]!, p[k]!);
      }
    }
  }
  return { min: min as unknown as Vec3, max: max as unknown as Vec3 };
}
