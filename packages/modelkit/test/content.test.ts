/** Contract test for all model authors: every content model builds without errors and within budget. */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { collectIcons } from '../../../content/icons/build.ts';
import { FORMS, GLYPHS, iconSvg, parseIconId } from '../../../content/icons/grammar.ts';
import { buildEntry, loadAll } from '../../../content/models/registry.ts';
import { exportGlb } from '../src/index.ts';

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
  });
});
