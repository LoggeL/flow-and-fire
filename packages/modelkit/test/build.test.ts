import { describe, expect, it } from 'vitest';
import {
  array,
  box,
  buildModel,
  cylinder,
  DEFAULT_BUDGETS,
  DEFAULT_PALETTE,
  defineModel,
  definePalette,
  EXPERIMENTAL_BUDGET,
  flipX,
  group,
  mirrorX,
  quad,
  radial,
  rosterDefaults,
  sphere,
  srgbToLinear,
  stripes,
  type BuildContext,
  type LodMesh,
  type ModelDef,
} from '../src/index.ts';
import { openEdges, signedVolume, type Tri } from './helpers.ts';

const ctx: BuildContext = {
  faction: 'test',
  palette: definePalette({ ...DEFAULT_PALETTE, faction: 'test', aliases: { copper: 'metal' } }),
};

function lodTris(l: LodMesh): Tri[] {
  const out: Tri[] = [];
  const p = (i: number): [number, number, number] => [l.positions[3 * i]!, l.positions[3 * i + 1]!, l.positions[3 * i + 2]!];
  for (let i = 0; i < l.indices.length; i += 3) out.push([p(l.indices[i]!), p(l.indices[i + 1]!), p(l.indices[i + 2]!)]);
  return out;
}

const tank: ModelDef = defineModel({
  id: 'test:tank',
  footprint: [1, 1],
  parts: [
    { name: 'hull', shapes: [box({ size: [1, 0.4, 1.4], at: [0, 0.2, 0], mat: 'team' }), mirrorX(box({ size: [0.2, 0.2, 1.4], at: [0.6, 0.1, 0], mat: 'dark' }))] },
    { name: 'turret', pivot: [0, 0.4, 0], shapes: [cylinder({ radius: 0.3, height: 0.2, at: [0, 0.5, 0], segments: 12 })] },
    { name: 'barrel', parent: 'turret', pivot: [0, 0.5, 0.3], anim: 'pitch', shapes: [cylinder({ radius: 0.06, height: 0.8, axis: 'z', at: [0, 0.5, 0.7], mat: 'copper', keep: true })] },
  ],
});

describe('buildModel', () => {
  const m = buildModel(tank, ctx);

  it('builds three valid LODs', () => {
    expect(m.errors).toEqual([]);
    expect(m.lods).toHaveLength(3);
    for (const l of m.lods) {
      const n = l.vertices;
      expect(l.positions.length).toBe(3 * n);
      expect(l.normals.length).toBe(3 * n);
      expect(l.colors.length).toBe(3 * n);
      expect(l.partIds.length).toBe(n);
      expect(l.mask.length).toBe(4 * n);
      expect(l.indices.length).toBe(3 * l.triangles);
      for (const i of l.indices) expect(i).toBeLessThan(n);
      for (let i = 0; i < n; i++) {
        const len = Math.hypot(l.normals[3 * i]!, l.normals[3 * i + 1]!, l.normals[3 * i + 2]!);
        expect(len).toBeCloseTo(1, 4);
        expect(l.partIds[i]).toBeLessThan(3);
      }
      for (const v of l.positions) expect(Number.isFinite(v)).toBe(true);
    }
    expect(m.lods[1]!.triangles).toBeLessThanOrEqual(m.lods[0]!.triangles);
    expect(m.lods[2]!.triangles).toBeLessThanOrEqual(m.lods[1]!.triangles);
    expect(m.lods[0]!.triangles).toBeLessThan(m.lods[0]!.triangles + 1);
  });

  it('flat shading: every triangle normal equals its geometric normal', () => {
    for (const l of m.lods) {
      for (let t = 0; t < l.indices.length; t += 3) {
        const [a, b, c] = [l.indices[t]!, l.indices[t + 1]!, l.indices[t + 2]!];
        const P = (i: number) => [l.positions[3 * i]!, l.positions[3 * i + 1]!, l.positions[3 * i + 2]!];
        const [pa, pb, pc] = [P(a), P(b), P(c)];
        const u = [pb[0]! - pa[0]!, pb[1]! - pa[1]!, pb[2]! - pa[2]!];
        const v = [pc[0]! - pa[0]!, pc[1]! - pa[1]!, pc[2]! - pa[2]!];
        const g = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
        const gl = Math.hypot(g[0]!, g[1]!, g[2]!);
        for (const i of [a, b, c]) {
          const d = (g[0]! * l.normals[3 * i]! + g[1]! * l.normals[3 * i + 1]! + g[2]! * l.normals[3 * i + 2]!) / gl;
          expect(d).toBeGreaterThan(0.999);
        }
      }
    }
  });

  it('parts: indices, parents, pivots, triangles per part', () => {
    expect(m.parts.map((p) => [p.name, p.parent, p.anim])).toEqual([
      ['hull', 0, 'none'],
      ['turret', 0, 'yaw'],
      ['barrel', 1, 'pitch'],
    ]);
    expect(m.parts[2]!.pivot).toEqual([0, 0.5, 0.3]);
    expect(m.lods[0]!.partTris.every((t) => t > 0)).toBe(true);
  });

  it('materials: team mask, metal via alias, linear vertex colors, AO', () => {
    const l = m.lods[0]!;
    let team = 0;
    let metal = 0;
    for (let i = 0; i < l.vertices; i++) {
      if (l.mask[4 * i] === 255) team++;
      if (l.mask[4 * i + 2]! > 0) metal++;
      expect(l.mask[4 * i + 3]!).toBeGreaterThanOrEqual(150);
    }
    expect(team).toBeGreaterThan(0);
    expect(metal).toBeGreaterThan(0);
    expect(l.matArea.team).toBeCloseTo(2 * (1 * 0.4 + 0.4 * 1.4 + 1 * 1.4), 6);
    expect(srgbToLinear(255)).toBe(1);
    expect(m.lods[0]!.teamTopShare).toBeGreaterThan(0.3);
  });

  it('mirrorX / flipX keep outward winding (positive volume) and mirror positions', () => {
    const b = box({ size: [0.2, 0.2, 0.2], at: [0.5, 0.1, 0] });
    for (const shape of [mirrorX(b), flipX(b), group([flipX(b)], { rot: [0, 90, 0] })]) {
      const built = buildModel(defineModel({ id: 't:m', parts: [{ name: 'hull', shapes: [shape] }] }), ctx);
      const tris = lodTris(built.lods[0]!);
      expect(signedVolume(tris)).toBeGreaterThan(0);
      expect(openEdges(tris)).toBe(0);
    }
    const mx = buildModel(defineModel({ id: 't:m', parts: [{ name: 'hull', shapes: [mirrorX(b)] }] }), ctx);
    expect(mx.bounds.min[0]).toBeCloseTo(-0.6, 6);
    expect(mx.bounds.max[0]).toBeCloseTo(0.6, 6);
  });

  it('array / radial / stripes place copies', () => {
    const arr = buildModel(defineModel({ id: 't:a', parts: [{ name: 'hull', shapes: [array(box({ size: [0.1, 0.1, 0.1] }), { count: 3, step: [1, 0, 0] })] }] }), ctx);
    expect(arr.bounds.size[0]).toBeCloseTo(2.1, 6);
    expect(arr.lods[0]!.triangles).toBe(36);
    const rad = buildModel(defineModel({ id: 't:r', parts: [{ name: 'hull', shapes: [radial(box({ size: [0.1, 0.1, 0.1], at: [1, 0, 0] }), { count: 4 })] }] }), ctx);
    expect(rad.bounds.size[0]).toBeCloseTo(2.1, 6);
    expect(rad.bounds.size[2]).toBeCloseTo(2.1, 6);
    const st = buildModel(defineModel({ id: 't:s', parts: [{ name: 'hull', shapes: [box({ size: [1, 1, 1] }), stripes({ count: 3, width: 0.5, at: [0, 0.504, 0] })] }] }), ctx);
    expect(st.lods[0]!.matArea.accent).toBeCloseTo(3 * 0.5 * 0.1, 6);
  });

  it('automatic LODs: small shapes vanish, keep/maxLod/minLod respected', () => {
    const def = defineModel({
      id: 't:l',
      parts: [
        {
          name: 'hull',
          shapes: [
            box({ size: [2, 1, 2] }),
            box({ size: [0.1, 0.1, 0.1], at: [0, 0.6, 0] }), // tiny → gone in LOD1
            box({ size: [0.1, 0.1, 0.1], at: [0.5, 0.6, 0], keep: true }), // kept
            sphere({ radius: 0.5, at: [0, 1, 0], maxLod: 0 }), // detail only in LOD0
            box({ size: [1, 1, 1], at: [0, 1, 0], minLod: 2 }), // LOD2 stand-in
          ],
        },
      ],
    });
    const b = buildModel(def, ctx);
    expect(b.errors).toEqual([]);
    expect(b.lods.map((l) => l.triangles)).toEqual([12 + 12 + 12 + 48, 12 + 12, 12 + 12 + 12]);
  });

  it('reports budget, part limit and structure errors', () => {
    const big = buildModel(defineModel({ id: 't:b', budget: { tris: [50, 40, 30] }, parts: [{ name: 'hull', shapes: [sphere({ radius: 1, segments: 16, rings: 8 })] }] }), ctx);
    expect(big.errors.some((e) => e.includes('LOD0'))).toBe(true);
    const parts = Array.from({ length: 9 }, (_, i) => ({ name: `p${i}`, shapes: [quad({ size: [1, 1] })] }));
    expect(() => defineModel({ id: 't:p', parts: [{ name: 'hull', shapes: [quad({ size: [1, 1] })] }, ...parts] })).toThrow(/PartStream/);
    expect(() => defineModel({ id: 't:p', parts: [{ name: 'turret', shapes: [quad({ size: [1, 1] })] }] })).toThrow(/hull/);
    expect(() => defineModel({ id: 't:p', parts: [{ name: 'hull', shapes: [quad({ size: [1, 1] })] }, { name: 'b', parent: 'x', shapes: [quad({ size: [1, 1] })] }] })).toThrow(/parent/);
    const badMat = buildModel(defineModel({ id: 't:m', parts: [{ name: 'hull', shapes: [box({ size: [1, 1, 1], mat: 'gold' })] }] }), ctx);
    expect(badMat.errors.some((e) => e.includes('gold'))).toBe(true);
  });

  it('footprint check and roster defaults (scale is baked in)', () => {
    const s = buildModel(defineModel({ id: 't:s', parts: [{ name: 'hull', shapes: [box({ size: [2, 1, 2], at: [0, 0.5, 0] })] }] }), {
      ...ctx,
      defaults: { class: 'struct', footprint: [2, 2], scale: { xz: 1, y: 1.4 }, name: 'Sockel', tech: 2, icon: 'struct_mass_t2' },
    });
    expect(s.footprintCheck.ok).toBe(true);
    expect(s.bounds.size[1]).toBeCloseTo(1.4, 6);
    expect(s.name).toBe('Sockel');
    const tooBig = buildModel(defineModel({ id: 't:s', class: 'struct', footprint: [1, 1], parts: [{ name: 'hull', shapes: [box({ size: [2, 1, 2] })] }] }), ctx);
    expect(tooBig.footprintCheck.ok).toBe(false);
    expect(tooBig.warnings.some((w) => w.includes('footprint'))).toBe(true);
  });
});

describe('experimentals (tech 4)', () => {
  it('get the experimental budget instead of the class budget, unless a model sets its own', () => {
    const def = defineModel({ id: 'test:exp_walker', tech: 4, parts: [{ name: 'hull', shapes: [box({ size: [6, 4, 6], at: [0, 2, 0], mat: 'team' })] }] });
    const built = buildModel(def, ctx);
    expect(built.tech).toBe(4);
    expect(built.budget.tris).toEqual(EXPERIMENTAL_BUDGET.tris);
    expect(built.budget.tris).not.toEqual(DEFAULT_BUDGETS.land.tris);
    const own = buildModel({ ...def, budget: { tris: [100, 50, 20] } }, ctx);
    expect(own.budget.tris).toEqual([100, 50, 20]);
    const { tech: _t, ...noTech } = def;
    const fromRoster = buildModel(noTech, { ...ctx, defaults: { tech: 4 } });
    expect(fromRoster.budget.tris).toEqual(EXPERIMENTAL_BUDGET.tris);
  });

  it('rosterDefaults passes tech 4 through', () => {
    expect(rosterDefaults({ id: 'core:exp_str_arty', tech: 4, icon: 'struct_arty_t4' }).tech).toBe(4);
    expect(rosterDefaults({ id: 'core:exp_str_arty', tech: 4, icon: 'struct_arty_t4' }).class).toBe('struct');
  });
});
