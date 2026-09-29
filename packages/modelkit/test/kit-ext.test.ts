/** Kit extensions for the factions after Varkan: palettes, smooth normals, hover convention, T4 budget. */
import { WebIO } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';
import {
  AURITH_PALETTE,
  box,
  buildModel,
  cylinder,
  DEFAULT_BUDGETS,
  defineModel,
  exportGlb,
  HOVER_HEIGHT,
  MATERIAL_SLOTS,
  modelMeta,
  PALETTES,
  paletteByName,
  paletteSlots,
  resolvePalette,
  rosterDefaults,
  SAEL_PALETTE,
  SKARN_PALETTE,
  sphere,
  srgbToLinear,
  sweep,
  T4_BUDGET,
  T4_LOD_DISTANCES,
  VARKAN_PALETTE,
  type BuildContext,
  type LodMesh,
  type ModelDef,
} from '../src/index.ts';

const ctx: BuildContext = { faction: 'varkan', palette: VARKAN_PALETTE };

function normalsOf(l: LodMesh): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < l.vertices; i++) out.push([l.normals[3 * i]!, l.normals[3 * i + 1]!, l.normals[3 * i + 2]!]);
  return out;
}

describe('faction palettes', () => {
  it('all kit palettes are valid and named by their slug', () => {
    for (const [name, p] of Object.entries(PALETTES)) {
      expect(p.faction).toBe(name);
      expect(paletteByName(name)).toBe(p);
      expect(Object.keys(resolvePalette(p))).toEqual(paletteSlots(p));
    }
    expect(() => paletteByName('nope')).toThrow(/unknown palette/);
  });

  it('colors follow the faction documents (§4.1) and the cross-faction table', () => {
    expect(VARKAN_PALETTE.slots.base.color).toBe('#2E2B29');
    expect(SKARN_PALETTE.slots.base.color).toBe('#18171C'); // Schwarzchitin
    expect(SKARN_PALETTE.slots.metal.color).toBe('#6E1A22'); // Sehne
    expect(SKARN_PALETTE.slots.accent.color).toBe('#D6D3DC'); // Quarz
    expect(SAEL_PALETTE.slots.base.color).toBe('#E4DED2'); // Perlmutt
    expect(SAEL_PALETTE.slots.dark.color).toBe('#26302C'); // Schalenrinde
    expect(SAEL_PALETTE.slots.metal.color).toBe('#C8A24A'); // Gold
    expect(SAEL_PALETTE.slots.accent.color).toBe('#1E4A40'); // Tiefjade
    expect(SAEL_PALETTE.slots.glow2?.color).toBe('#7FE3C0'); // Jade-Lichtnaht
    expect(AURITH_PALETTE.slots.base.color).toBe('#1F1B22'); // Pechglas
    expect(AURITH_PALETTE.slots.metal.color).toBe('#C8912E'); // Bernsteinglas
    expect(AURITH_PALETTE.slots.accent.color).toBe('#D5DCE2'); // Perlglas (Eisweiß nach dem Abgleich)
    for (const p of [VARKAN_PALETTE, SKARN_PALETTE, SAEL_PALETTE, AURITH_PALETTE]) expect(p.slots.team.color).toBe('#FFFFFF');
    // team-conflict swaps (factions/README §4.3)
    expect(VARKAN_PALETTE.teamAlt?.[0]?.teams).toEqual(['red', 'orange']);
    expect(SKARN_PALETTE.teamAlt?.[0]?.teams).toEqual(['red', 'pink']);
    expect(SAEL_PALETTE.teamAlt?.map((a) => a.teams)).toEqual([
      ['orange', 'olive'],
      ['green', 'cyan'],
    ]);
    expect(AURITH_PALETTE.teamAlt?.find((a) => a.slot === 'metal')?.color).toBe('#8A8174'); // Rauchquarz
  });

  it('a model file can pick another palette by name or pass its own', () => {
    const base: ModelDef = { id: 'test:p', parts: [{ name: 'hull', shapes: [box({ size: [1, 1, 1], at: [0, 0.5, 0], mat: 'body' })] }] };
    const v = buildModel(defineModel(base), ctx);
    const s = buildModel(defineModel({ ...base, palette: 'sael' }), ctx);
    const own = buildModel(defineModel({ ...base, palette: { ...SKARN_PALETTE, faction: 'own' } }), ctx);
    expect(v.lods[0]!.colors[0]).toBeCloseTo(srgbToLinear(0x2e), 4);
    expect(s.lods[0]!.colors[0]).toBeCloseTo(srgbToLinear(0xe4), 4);
    expect(own.lods[0]!.colors[0]).toBeCloseTo(srgbToLinear(0x18), 4);
    expect(s.lods[0]!.matArea.accent2).toBe(0); // Sael defines the extra slots
    expect(v.lods[0]!.matArea.accent2).toBeUndefined();
    const bad = buildModel({ ...base, palette: 'nope' }, ctx);
    expect(bad.errors.join()).toMatch(/unknown palette/);
    // unknown alias in the chosen palette
    const alias = buildModel(defineModel({ ...base, palette: 'aurith', parts: [{ name: 'hull', shapes: [box({ size: [1, 1, 1], mat: 'copper' })] }] }), ctx);
    expect(alias.errors.join()).toMatch(/unknown material "copper"/);
  });

  it('faction aliases resolve to the documented slots', () => {
    const mats: [string, string, string][] = [
      ['skarn', 'sinew', 'metal'],
      ['skarn', 'quartz', 'accent'],
      ['skarn', 'garnet', 'glass'],
      ['skarn', 'nerve', 'glow2'],
      ['sael', 'gold', 'metal'],
      ['sael', 'jade', 'accent'],
      ['sael', 'seam', 'glow2'],
      ['aurith', 'amber', 'metal'],
      ['aurith', 'pearl', 'accent'],
      ['aurith', 'glyph', 'glow2'],
    ];
    for (const [pal, alias, slot] of mats) expect(paletteByName(pal).aliases?.[alias]).toBe(slot);
  });
});

describe('smooth normals', () => {
  const ball = (smooth?: boolean | number, shapeSmooth?: boolean) =>
    buildModel(
      defineModel({
        id: 'test:ball',
        parts: [
          {
            name: 'hull',
            ...(smooth === undefined ? {} : { smooth }),
            shapes: [sphere({ radius: 1, segments: 12, rings: 6, at: [0, 1, 0], ...(shapeSmooth === undefined ? {} : { smooth: shapeSmooth }) })],
          },
        ],
      }),
      ctx,
    );

  it('smooth parts get radial normals on a sphere, flat parts face normals', () => {
    const s = ball(true).lods[0]!;
    const f = ball().lods[0]!;
    let maxDev = 0;
    normalsOf(s).forEach((n, i) => {
      const p = [s.positions[3 * i]!, s.positions[3 * i + 1]! - 1, s.positions[3 * i + 2]!];
      const l = Math.hypot(p[0]!, p[1]!, p[2]!);
      maxDev = Math.max(maxDev, 1 - (n[0] * p[0]! + n[1] * p[1]! + n[2] * p[2]!) / l);
    });
    expect(maxDev).toBeLessThan(0.02);
    expect(s.vertices).toBeLessThan(f.vertices); // shared normals merge vertices
    expect(s.triangles).toBe(f.triangles);
  });

  it('shape `smooth: false` overrides the part; crease keeps cylinder caps hard', () => {
    expect(ball(true, false).lods[0]!.vertices).toBe(ball().lods[0]!.vertices);
    const cyl = buildModel(
      defineModel({ id: 'test:cyl', parts: [{ name: 'hull', smooth: true, shapes: [cylinder({ radius: 1, height: 1, segments: 12, at: [0, 0.5, 0] })] }] }),
      ctx,
    ).lods[0]!;
    const ns = normalsOf(cyl);
    const caps = ns.filter((n) => Math.abs(Math.abs(n[1]) - 1) < 1e-6).length;
    const sides = ns.filter((n) => Math.abs(n[1]) < 1e-6).length;
    expect(caps).toBe(24); // 12 top + 12 bottom, flat
    expect(sides).toBe(24); // smooth ring normals, not mixed with the caps
    expect(ns.length).toBe(48);
    expect(() => buildModel(defineModel({ id: 'test:bad', parts: [{ name: 'hull', smooth: 200, shapes: [box({ size: [1, 1, 1] })] }] }), ctx)).not.toThrow();
    expect(buildModel(defineModel({ id: 'test:bad', parts: [{ name: 'hull', smooth: 200, shapes: [box({ size: [1, 1, 1] })] }] }), ctx).errors.join()).toMatch(/crease/);
  });
});

describe('smoothing groups', () => {
  /** Two open half-cylinder panels meeting at x = ±1 (like skirt lanes). */
  const panels = (group?: string) =>
    buildModel(
      defineModel({
        id: 'test:panels',
        parts: [
          {
            name: 'hull',
            smooth: true,
            shapes: [0, 180].map((start) =>
              sweep({
                path: [
                  [0, 0, 0],
                  [0, 1, 0],
                ],
                radius: 1,
                profile: Array.from({ length: 7 }, (_, i): [number, number] => {
                  const a = ((start + i * 30) * Math.PI) / 180;
                  return [Math.cos(a), Math.sin(a)];
                }),
                open: true,
                mat: start === 0 ? 'team' : 'base',
                ...(group === undefined ? {} : { smoothGroup: group }),
              }),
            ),
          },
        ],
      }),
      ctx,
    ).lods[0]!;

  it('shapes of one group share normals across the seam, separate shapes do not', () => {
    const seamNormals = (l: LodMesh) =>
      normalsOf(l).filter((_, i) => Math.abs(Math.abs(l.positions[3 * i]!) - 1) < 1e-6 && Math.abs(l.positions[3 * i + 2]!) < 1e-6);
    for (const n of seamNormals(panels('skirt'))) expect(Math.abs(n[0])).toBeCloseTo(1, 2); // radial at the seam (area-weighted)
    expect(seamNormals(panels()).some((n) => Math.abs(Math.abs(n[0]) - 1) > 0.01)).toBe(true);
    // materials stay per shape
    expect(panels('skirt').matArea.team).toBeCloseTo(panels('skirt').matArea.base, 9);
  });
});

describe('hover convention', () => {
  const pad: ModelDef = defineModel({
    id: 'test:hover',
    parts: [
      { name: 'hull', shapes: [cylinder({ radius: 0.6, height: 0.2, at: [0, 0.1, 0], mat: 'team' })] },
      { name: 'turret', pivot: [0, 0.2, 0], shapes: [box({ size: [0.3, 0.3, 0.3], at: [0, 0.35, 0] })] },
    ],
  });

  it('lifts geometry and pivots after the roster scale; metadata and scene extras carry it', async () => {
    const m = buildModel({ ...pad, hover: 0.3, scale: 2, footprint: [2, 2] }, ctx);
    expect(m.errors).toEqual([]);
    expect(m.warnings).toEqual([]);
    expect(m.hover).toBe(0.3);
    expect(m.bounds.min[1]).toBeCloseTo(0.3, 6); // not 0.6: the lift is not scaled
    expect(m.parts[1]!.pivot[1]).toBeCloseTo(0.2 * 2 + 0.3, 6);
    const glb = await exportGlb(m);
    const doc = await new WebIO().readBinary(glb);
    const extras = doc.getRoot().getDefaultScene()!.getExtras() as { faf: { hover?: number } };
    expect(extras.faf.hover).toBe(0.3);
    expect(modelMeta(m, 'x.glb', '', glb.byteLength).hover).toBe(0.3);
  });

  it('ground units have no hover key; roster hoverHeightView is the default', () => {
    const g = buildModel(pad, ctx);
    expect(g.hover).toBe(0);
    expect('hover' in modelMeta(g, 'x.glb', '', 0)).toBe(false);
    const d = rosterDefaults({ id: 'f3:x', tech: 2, motion: { gait: 'hover', hoverHeightView: 0.3 } });
    expect(d.hover).toBe(0.3);
    expect(rosterDefaults({ id: 'f3:y', motion: { gait: 'walker', hoverHeightView: 0.3 } }).hover).toBeUndefined();
    const r = buildModel(pad, { ...ctx, defaults: d });
    expect(r.hover).toBe(0.3);
    expect(HOVER_HEIGHT[1]).toBe(0.25);
    expect(HOVER_HEIGHT[3]).toBe(0.35);
  });

  it('warns when a hover model reaches below its hover height', () => {
    const low = defineModel({ ...pad, hover: 0.25, parts: [{ name: 'hull', shapes: [box({ size: [1, 1, 1], at: [0, 0.3, 0], mat: 'team' })] }] });
    expect(buildModel(low, ctx).warnings.join()).toMatch(/below its hover height/);
  });
});

describe('T4 budget class', () => {
  const big = (n: number): ModelDef =>
    defineModel({
      id: 'test:t4',
      tech: 4,
      parts: [{ name: 'hull', shapes: [sphere({ radius: 3, segments: n, rings: n / 2, at: [0, 3, 0], mat: 'team' })] }],
    });

  it('tech 4 uses the T4 budget and LOD distances for every class', () => {
    const m = buildModel(big(24), { ...ctx, defaults: { class: 'land' } });
    expect(m.tech).toBe(4);
    expect(m.budget).toBe(T4_BUDGET);
    expect(m.lodDistances).toEqual(T4_LOD_DISTANCES);
    expect(m.lods[0]!.triangles).toBeGreaterThan(DEFAULT_BUDGETS.land.tris[0]);
    expect(m.errors).toEqual([]);
    const t3 = buildModel({ ...big(24), tech: 3 }, ctx);
    expect(t3.errors.join()).toMatch(/budget 350/);
  });

  it('factions can override the T4 budget; roster tech 4 is accepted', () => {
    const m = buildModel(big(24), { ...ctx, budgets: { t4: { tris: [400, 300, 200] } } });
    expect(m.errors.join()).toMatch(/budget 400/);
    expect(rosterDefaults({ id: 'x:y', tech: 4 }).tech).toBe(4);
    expect(() => defineModel({ ...big(8), tech: 5 as 4 })).toThrow(/tech/);
  });
});

describe('core slots stay unchanged', () => {
  it('the 7 core slots and their order', () => {
    expect([...MATERIAL_SLOTS]).toEqual(['base', 'dark', 'metal', 'team', 'glow', 'glass', 'accent']);
    expect(paletteSlots(VARKAN_PALETTE)).toEqual([...MATERIAL_SLOTS]);
    expect(paletteSlots(SAEL_PALETTE)).toEqual([...MATERIAL_SLOTS, 'accent2', 'glow2']);
  });
});
