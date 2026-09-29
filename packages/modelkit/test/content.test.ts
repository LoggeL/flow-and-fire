/** Contract test for all model authors: every content model builds without errors and within budget. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { collectIcons } from '../../../content/icons/build.ts';
import { bracketMarkup, FORMS, GLYPHS, iconScale, iconSvg, notchMarkup, parseIconId } from '../../../content/icons/grammar.ts';
import { buildEntry, loadAll } from '../../../content/models/registry.ts';
import { exportGlb, modelMeta, type BuiltModel } from '../src/index.ts';

const factions = await loadAll();

describe('content/models', () => {
  it('has the Varkan reference model', () => {
    const varkan = factions.find((f) => f.def.slug === 'varkan');
    expect(varkan?.models.some((m) => m.def.id === 'core:lnd_t1_tank')).toBe(true);
  });

  for (const f of factions) {
    for (const m of f.models) {
      it(`${f.def.slug}/${m.unit}: builds without errors, within budget, deterministic`, async () => {
        const built = buildEntry(f, m);
        expect(built.errors).toEqual([]);
        built.lods.forEach((l, i) => expect(l.triangles).toBeLessThanOrEqual(built.budget.tris[i]!));
        expect(built.lods[0]!.matArea.team).toBeGreaterThan(0);
        const a = await exportGlb(built);
        const b = await exportGlb(buildEntry(f, m));
        expect(createHash('sha256').update(a).digest('hex')).toBe(createHash('sha256').update(b).digest('hex'));
      });
    }
  }

  it('Punze follows the direct-fire rules of faction.md §5.2', () => {
    const f = factions.find((x) => x.def.slug === 'varkan')!;
    const built = buildEntry(f, f.models.find((m) => m.unit === 'lnd_t1_tank')!);
    expect(built.warnings).toEqual([]);
    expect(built.name).toBe('Punze');
    expect(built.icon).toBe('land_direct_t1');
    expect(built.footprintCheck.ok).toBe(true);
    const hullLength = 1.36;
    // barrel reaches ≥ 60 % of the hull length beyond the bell and past the bow (+Z = 0.68)
    expect(built.bounds.max[2]).toBeGreaterThan(0.68 + 0.3);
    expect(built.bounds.max[2] - 0.3).toBeGreaterThanOrEqual(0.6 * hullLength);
    expect(built.bounds.size[1]).toBeLessThan(0.45 * 1.4 + 0.4); // low tub + bell
    expect(built.lods[0]!.teamTopShare).toBeGreaterThanOrEqual(0.3);
    expect(built.parts.map((p) => p.name)).toEqual(['hull', 'turret', 'barrel']);
    const area = built.lods[0]!.matArea;
    const total = Object.values(area).reduce((s, v) => s + v, 0);
    expect(area.glow / total).toBeLessThanOrEqual(0.02); // Glutnaht ≤ 2 % (Kampfeinheit, kein Glutkern)
    expect(area.metal / total).toBeGreaterThanOrEqual(0.06); // Kupfer ≈ 8–12 %
    expect(area.metal / total).toBeLessThanOrEqual(0.14);
  });
});

describe('Varkan stays byte-identical (kit extensions are backward compatible)', () => {
  // Baseline: packages/modelkit/scripts/varkan-hashes.ts --write before the Skarn/Sael/Aurith kit extension (50 T1–T3
  // models) plus the 6 Varkan experimentals as exported on main before the merge with the kit extension.
  const baseline = JSON.parse(readFileSync(new URL('./fixtures/varkan.sha256.json', import.meta.url), 'utf8')) as Record<string, { glb: string; json: string }>;
  const varkan = factions.find((f) => f.def.slug === 'varkan')!;

  it('has the same 56 models (50 + 6 T4)', () => {
    expect(varkan.models.map((m) => m.unit)).toEqual(Object.keys(baseline).sort());
  });

  for (const m of varkan.models) {
    it(`varkan/${m.unit}: GLB and metadata JSON unchanged`, async () => {
      const built = buildEntry(varkan, m);
      const glb = await exportGlb(built);
      const sha = createHash('sha256').update(glb).digest('hex');
      const meta = `${JSON.stringify(modelMeta(built, `varkan.${m.unit}.glb`, sha, glb.byteLength), null, 2)}\n`;
      expect(sha).toBe(baseline[m.unit]?.glb);
      expect(createHash('sha256').update(meta).digest('hex')).toBe(baseline[m.unit]?.json);
    });
  }
});

/** Material share of the LOD0 surface. */
function share(b: BuiltModel, slot: keyof BuiltModel['lods'][number]['matArea']): number {
  const a = b.lods[0]!.matArea;
  const total = Object.values(a).reduce<number>((s, v) => s + (v ?? 0), 0);
  return (a[slot] ?? 0) / total;
}

function commander(slug: string): BuiltModel {
  const f = factions.find((x) => x.def.slug === slug)!;
  return buildEntry(f, f.models.find((m) => m.unit === 'cmd_commander')!);
}

/** Vertices with a normal equal to the geometric normal of every triangle they belong to (flat shading). */
function isFlat(b: BuiltModel): boolean {
  const l = b.lods[0]!;
  for (let t = 0; t < l.indices.length; t += 3) {
    const [a, c, d] = [l.indices[t]!, l.indices[t + 1]!, l.indices[t + 2]!];
    const P = (i: number) => [l.positions[3 * i]!, l.positions[3 * i + 1]!, l.positions[3 * i + 2]!];
    const [pa, pb, pc] = [P(a), P(c), P(d)];
    const u = [pb[0]! - pa[0]!, pb[1]! - pa[1]!, pb[2]! - pa[2]!];
    const v = [pc[0]! - pa[0]!, pc[1]! - pa[1]!, pc[2]! - pa[2]!];
    const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    const len = Math.hypot(n[0]!, n[1]!, n[2]!);
    for (const i of [a, c, d]) {
      const dot = (l.normals[3 * i]! * n[0]! + l.normals[3 * i + 1]! * n[1]! + l.normals[3 * i + 2]! * n[2]!) / len;
      if (dot < 0.999) return false;
    }
  }
  return true;
}

describe('reference commanders of the new factions', () => {
  it('Skarn Rädelsführer (f2 §5.2): 6-legged, flat-shaded, legs spread, heart druse', () => {
    const b = commander('skarn');
    expect(b.id).toBe('f2:cmd_commander');
    expect(b.name).toBe('Rädelsführer');
    expect(b.warnings).toEqual([]);
    expect(b.bounds.size[1]).toBeGreaterThanOrEqual(2.0); // Höhe ≥ 2,0 WU
    expect(b.bounds.size[0]).toBeGreaterThanOrEqual(3.2); // Beinspanne ≥ 3,2 WU
    expect(b.bounds.min[1]).toBe(0);
    expect(b.lods[0]!.teamTopShare).toBeGreaterThanOrEqual(0.35);
    expect(share(b, 'glow')).toBeGreaterThanOrEqual(0.03); // Herzkern 3–6 %
    expect(share(b, 'glow')).toBeLessThanOrEqual(0.065);
    expect(share(b, 'metal') + share(b, 'glass')).toBeLessThanOrEqual(0.12); // Sehne/Granatglas
    expect(isFlat(b)).toBe(true); // streng eckig, Flat Shading
    expect(b.parts.map((p) => p.name)).toEqual(['hull', 'legs_l', 'legs_r', 'torso', 'lens']);
  });

  it('Sael Prior (f3 §5.2): hovers at the roster height, wide skirt, smooth, gold core', () => {
    const b = commander('sael');
    expect(b.id).toBe('f3:cmd_commander');
    expect(b.warnings).toEqual([]);
    expect(b.hover).toBe(0.25);
    expect(b.bounds.min[1]).toBeCloseTo(0.25, 6); // Schwebespalt im Mesh
    expect(b.bounds.max[1] - b.hover).toBeGreaterThanOrEqual(2.4);
    expect(b.bounds.size[0]).toBeGreaterThanOrEqual(2.0); // Rockbreite ≥ 2,0 WU (+ Tellersaum)
    expect(b.lods[0]!.teamTopShare).toBeGreaterThanOrEqual(0.35);
    expect(share(b, 'glow')).toBeGreaterThanOrEqual(0.025);
    expect(share(b, 'glow')).toBeLessThanOrEqual(0.06);
    expect(share(b, 'glow2')).toBeLessThanOrEqual(0.02); // Lichtnaht
    expect(share(b, 'metal')).toBeLessThanOrEqual(0.2); // Gold (Prior ≤ 20 %)
    expect(isFlat(b)).toBe(false);
  });

  it('Aurith Kantor (f4 §5.2): tall tripod, crown glow, glyph bands, smooth', () => {
    const b = commander('aurith');
    expect(b.id).toBe('f4:cmd_commander');
    expect(b.warnings).toEqual([]);
    expect(b.bounds.size[1]).toBeGreaterThanOrEqual(2.8); // Höhe ≥ 2,8 WU
    expect(b.bounds.size[1]).toBeGreaterThanOrEqual(0.6 * b.bounds.size[2]); // hoch und schlank
    expect(b.lods[0]!.teamTopShare).toBeGreaterThanOrEqual(0.35);
    expect(share(b, 'glow')).toBeGreaterThanOrEqual(0.03);
    expect(share(b, 'glow')).toBeLessThanOrEqual(0.06);
    expect(share(b, 'glow2')).toBeLessThanOrEqual(0.03); // Glyphenbänder ≤ 3 %
    expect(b.parts.filter((p) => p.anim === 'legs')).toHaveLength(3); // Dreibein
    expect(isFlat(b)).toBe(false);
  });
});

describe('content/icons', () => {
  it('parses every roster icon and renders all variants', () => {
    const icons = collectIcons();
    expect(icons.length).toBeGreaterThanOrEqual(50);
    for (const i of icons) {
      const p = parseIconId(i.id);
      expect(p.form in FORMS).toBe(true);
      if (p.glyph !== null) expect(p.glyph in GLYPHS).toBe(true);
      for (const variant of ['normal', 'selected', 'blip', 'ghost'] as const) expect(iconSvg(i.id, { variant })).toMatch(/^<svg [^>]+>.*<\/svg>$/);
    }
    expect(Object.keys(GLYPHS)).toHaveLength(19);
    expect(() => parseIconId('land_nope_t1')).toThrow();
    expect(() => parseIconId('land_bot_t5')).toThrow();
  });

  it('marks experimentals (t4) with the bracket instead of notches', () => {
    const p = parseIconId('land_bot_t4');
    expect(p.tech).toBe(4);
    expect(p.glyph).toBe('bot');
    expect(iconScale(p)).toBe(1.5);
    const svg = iconSvg('land_bot_t4');
    expect(svg).toContain(bracketMarkup());
    expect(svg).not.toContain(notchMarkup(3));
    expect(iconSvg('land_bot_t3')).not.toContain(bracketMarkup());
    expect(iconSvg('struct_arty_t4', { variant: 'ghost' })).toContain(bracketMarkup());
    const t4 = collectIcons().filter((i) => i.tech === 4);
    expect(t4.map((i) => i.id).sort()).toEqual(['air_direct_t4', 'land_bot_t4', 'land_fac_land_t4', 'struct_arty_t4', 'struct_mass_t4', 'struct_shield_t4']);
  });

  it('experimental models use the T4 budget and the ceramic bracket', () => {
    const f = factions.find((x) => x.def.slug === 'varkan')!;
    const exps = f.models.filter((m) => m.unit.startsWith('exp_'));
    expect(exps).toHaveLength(6);
    for (const m of exps) {
      const built = buildEntry(f, m);
      expect(built.tech).toBe(4);
      expect(built.budget.tris).toEqual([1600, 800, 320]);
      expect(built.lods[0]!.triangles).toBeGreaterThan(350); // sichtbar mehr Detail als T1–T3
      expect(built.lods[0]!.matArea.accent).toBeGreaterThan(0); // Keramik-Klammer
      expect(built.footprintCheck.ok).toBe(true);
      expect(built.warnings).toEqual([]);
    }
  });
});
