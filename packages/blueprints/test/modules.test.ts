// MS3: file-system-free compilation (compileBlueprintModules, the HMR contract), view.json v2
// (and v1 compatibility), determinism, the checked-in core content.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  compileBlueprintModules,
  decodeSimBin,
  defineUnit,
  DEFAULT_ICON_THRESHOLD,
  defaultSelectionRadius,
  ICON_IDS,
  parseViewJson,
  VIEW_VERSION,
  type BlueprintModule,
} from '../src/index.ts';
import { CONTENT_GENERATED, loadLocales, loadModules } from '../scripts/content.ts';
import { gameUnit, localesFor } from './support/fixtures.ts';

describe('compileBlueprintModules (HMR contract)', () => {
  const locales = localesFor(['core:a', 'core:b']);

  it('compiles module exports (namespace or default) with locales, without file access', () => {
    const modules: BlueprintModule[] = [
      { source: 'content/blueprints/core/units/b.ts', exports: { default: defineUnit(gameUnit('core:b')) } },
      { source: 'content/blueprints/core/units/a.ts', exports: [defineUnit(gameUnit('core:a'))] },
    ];
    const r = compileBlueprintModules(modules, locales);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.diagnostics).toEqual([]);
    expect(decodeSimBin(r.simBin).ids).toEqual(['core:a', 'core:b']);
    expect(r.result.units.map((u) => u.source)).toEqual(['content/blueprints/core/units/a.ts', 'content/blueprints/core/units/b.ts']);
    expect(parseViewJson(r.viewJson).visuals).toHaveLength(2);
    expect(JSON.parse(r.hashesJson)).toMatchObject({ units: 2 });
    expect(r.hashes.simHash).toBe(r.result.simHash);
    // Same input twice (any module order) ⇒ identical bytes.
    const again = compileBlueprintModules([...modules].reverse(), locales);
    expect(again.ok && Buffer.from(again.simBin).equals(Buffer.from(r.simBin)) && again.viewJson === r.viewJson && again.bundleJson === r.bundleJson).toBe(true);
  });

  it('returns diagnostics instead of throwing (bad exports, bad locales, content errors)', () => {
    const bad = compileBlueprintModules(
      [
        { source: 'x/one.ts', exports: { default: { kind: 'tank' } } },
        { source: 'x/two.ts', exports: { default: [] } },
      ],
      { de: { 'unit.core.a.name': '' }, en: 'nope' },
    );
    expect(bad.ok).toBe(false);
    expect(bad.diagnostics.map((d) => `${d.source}${d.path}: ${d.message}`)).toEqual([
      'x/two.ts: default export is an empty array',
      'x/one.ts: default export must be a define*(...) result or an array of them (kinds: unit, weapon, projectile, prop, effect, faction, aiProfile, patch)',
      'content/locales/de.json/unit.core.a.name: Expected string length greater or equal to 1',
      'content/locales/en.json: locale table must be a JSON object',
    ]);
    const content = compileBlueprintModules([{ source: 'x/a.ts', exports: { default: defineUnit({ ...gameUnit('core:a'), categories: ['LAND'] }) } }], locales);
    expect(content.ok).toBe(false);
    expect(content.diagnostics).toEqual([
      { id: 'core:a', source: 'x/a.ts', path: '/categories', message: 'a unit needs exactly one of TECH1, TECH2, TECH3 (got 0)' },
    ]);
  });
});

describe('view.json v2', () => {
  it('carries icon, iconThreshold, tech, categories, selectionRadius, sizeClass and the turret', async () => {
    const view = parseViewJson(await readFile(join(CONTENT_GENERATED, 'view.json'), 'utf8'));
    expect(view.version).toBe(VIEW_VERSION);
    const byId = new Map(view.visuals.map((v) => [v.id, v]));
    const tank = byId.get('core:lnd_t1_tank')!;
    expect(tank).toMatchObject({
      icon: 'land_direct',
      iconThreshold: DEFAULT_ICON_THRESHOLD,
      tech: 1,
      categories: ['DIRECTFIRE', 'LAND', 'MOBILE', 'TECH1'],
      selectionRadius: defaultSelectionRadius(0.45, [1, 1]),
      sizeClass: 1,
    });
    expect(tank.placeholder.turret).toEqual({ hull: 'cyl', size: [0.36, 0.18, 0.36], offset: [-0.08, 0.34, 0] });
    expect(byId.get('core:lnd_t3_heavy')).toMatchObject({ tech: 3, sizeClass: 3 });
    expect(byId.get('core:cube')).toMatchObject({ icon: 'cube', iconThreshold: 8 });
    for (const v of view.visuals) expect(ICON_IDS as readonly string[]).toContain(v.icon);
    expect(view.effects.map((e) => e.id)).toContain('core:fx_explosion_large');
  });

  it('reads version 1 documents (MS2) and upgrades them', () => {
    const v1 = {
      format: 'faf-view',
      version: 1,
      visuals: [
        {
          id: 'core:cube',
          descKey: 'unit.core.cube.desc',
          nameKey: 'unit.core.cube.name',
          icon: 'land_cube',
          iconThreshold: 8,
          lod: [60, 180],
          mesh: 'units/cube_bot',
          placeholder: { hull: 'box', size: [0.5, 0.5, 0.5], color: [0.62, 0.66, 0.72] },
        },
        { id: 'core:x', nameKey: 'a.b', descKey: 'a.c', placeholder: { hull: 'cyl', size: [1, 1, 2] } },
      ],
    };
    const b = parseViewJson(JSON.stringify(v1));
    expect(b.version).toBe(1);
    expect(b.effects).toEqual([]);
    expect(b.visuals[0]).toMatchObject({ icon: 'land_cube', iconThreshold: 8, tech: 0, categories: [], sizeClass: 1, mesh: 'units/cube_bot' });
    expect(b.visuals[1]).toMatchObject({ iconThreshold: DEFAULT_ICON_THRESHOLD, selectionRadius: 1.2 }); // max(1, 2) / 2 · 1.2
    expect(() => parseViewJson({ ...v1, version: 3 })).toThrow(/\/version: unsupported version 3 \(readable: 1\.\.2\)/);
    // v2 requires its fields.
    expect(() => parseViewJson({ format: 'faf-view', version: 2, effects: [], visuals: [v1.visuals[1]] })).toThrow(/\/visuals\/0\/categories/);
    const turret = { format: 'faf-view', version: 2, effects: [], visuals: [{ ...v1.visuals[1], iconThreshold: 14, tech: 1, categories: ['LAND'], selectionRadius: 1, sizeClass: 1, placeholder: { hull: 'box', size: [1, 1, 1], turret: { hull: 'box', size: [1, 1] } } }] };
    expect(() => parseViewJson(turret)).toThrow(/\/visuals\/0\/placeholder\/turret\/size/);
  });
});

describe('core content (MS6)', () => {
  it('compiles the real roster through the module path with a commander start and factory tech tree', async () => {
    const r = compileBlueprintModules(await loadModules(), await loadLocales());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t = decodeSimBin(r.simBin);
    expect(t.indexOf('core:cube')).toBe(r.result.units.find((u) => u.id === 'core:cube')!.simId);
    const tanks = ['core:lnd_t1_scout', 'core:lnd_t1_tank', 'core:lnd_t1_arty', 'core:lnd_t2_tank', 'core:lnd_t3_heavy'];
    for (const id of tanks) {
      const u = r.result.units.find((x) => x.id === id)!;
      expect(u.view.placeholder.turret, id).toBeDefined();
      expect(u.sim.mountCount, id).toBeGreaterThan(0);
      expect(u.sim.massCost, id).toBeGreaterThan(0);
    }
    expect(r.result.units.filter((u) => tanks.includes(u.id)).map((u) => u.sim.sizeClass)).toEqual([1, 1, 1, 2, 3]);
    const heavy = t.indexOf('core:lnd_t3_heavy');
    const scout = t.indexOf('core:lnd_t1_scout');
    expect(t.mass(heavy)).toBeGreaterThan(t.mass(t.indexOf('core:lnd_t2_tank')));
    expect(t.speedPerTick(scout)).toBeGreaterThan(t.speedPerTick(t.indexOf('core:lnd_t1_tank')));
    expect(t.speedPerTick(t.indexOf('core:lnd_t1_arty'))).toBeLessThan(t.speedPerTick(t.indexOf('core:lnd_t1_tank')));
    expect(t.deathWeapon(heavy)).toBe(t.weaponIndexOf('core:wpn_death_heavy'));
    // Tech tree (ms6.3): the T1 factory builds the T1 units; its paid upgrades Landwerk II/III add
    // the T2 tank and the T3 heavy tank while still building every lower tier.
    const f1 = t.indexOf('core:fac_land_t1'), f2 = t.indexOf('core:fac_land_t2'), f3 = t.indexOf('core:fac_land_t3');
    expect([t.upgradesTo(f1), t.upgradesTo(f2), t.upgradesTo(f3)]).toEqual([f2, f3, -1]);
    for (const id of ['core:lnd_t1_scout', 'core:lnd_t1_tank', 'core:lnd_t1_arty']) for (const f of [f1, f2, f3]) expect(t.canBuild(f, t.indexOf(id)), id).toBe(true);
    expect([t.canBuild(f1, t.indexOf('core:lnd_t2_tank')), t.canBuild(f2, t.indexOf('core:lnd_t2_tank')), t.canBuild(f3, t.indexOf('core:lnd_t2_tank'))]).toEqual([false, true, true]);
    expect([t.canBuild(f1, heavy), t.canBuild(f2, heavy), t.canBuild(f3, heavy)]).toEqual([false, false, true]);
    expect([t.buildableByExpr(f2), t.buildableByExpr(f3)]).toEqual([-1, -1]);
    for (const id of ['core:str_t1_pd', 'core:str_t1_radar']) expect(t.canBuild(t.indexOf('core:cmd_commander'), t.indexOf(id)), id).toBe(true);
    expect(t.radarCol[t.indexOf('core:str_t1_radar')]).toBeGreaterThan(0);
    expect(t.ids).toEqual(r.result.units.map((u) => u.id));
    for (const id of ['core:cmd_commander', 'core:eng_t1', 'core:str_t1_mex', 'core:str_t1_pgen', 'core:str_t1_estorage']) {
      expect(t.indexOf(id), id).toBeGreaterThanOrEqual(0);
    }
    expect(t.factionIds).toEqual(['core:faction_core']);
    expect(t.factionStartUnit(0)).toBe(t.indexOf('core:cmd_commander'));
    // Every weapon references an existing projectile; all mounts point at known weapons.
    for (let m = 0; m < t.mountTotal; m++) expect(t.mountWeapon(m)).toBeLessThan(t.weaponCount);
    // The game bundle equals the checked-in files (freshness).
    expect(Buffer.from(r.simBin).equals(await readFile(join(CONTENT_GENERATED, 'sim.bin')))).toBe(true);
    expect(r.viewJson).toBe(await readFile(join(CONTENT_GENERATED, 'view.json'), 'utf8'));
    expect(r.bundleJson).toBe(await readFile(join(CONTENT_GENERATED, 'bundle.json'), 'utf8'));
  });

  it('locale tables have the same keys in de and en', async () => {
    const l = (await loadLocales()) as { de: Record<string, string>; en: Record<string, string> };
    expect(Object.keys(l.de).sort()).toEqual(Object.keys(l.en).sort());
  });
});
