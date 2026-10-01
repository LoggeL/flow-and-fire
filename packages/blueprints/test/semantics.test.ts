// MS3 (S6): semantic checks – references and reference types, MVP layers, size-class rule, category
// expressions with position, cycle-free tech tree, i18n keys (de and en), behavior/toggle registry,
// balancing gates, strict game-content rules. Every failure carries a JSON pointer.
import { describe, expect, it } from 'vitest';
import {
  ARTILLERY_RANGE_GATE,
  compileBlueprints,
  defineAiProfile,
  defineFaction,
  defineUnit,
  defineWeapon,
  MIN_MAP_DIAGONAL_WU,
  type BalancingGate,
  type UnitBlueprint,
} from '../src/index.ts';
import { compileErr, effectDef, fullUnit, gameUnit, localesFor, src, weaponDefs } from './support/fixtures.ts';

function withSim(id: string, sim: Partial<UnitBlueprint['sim']>, over: Partial<UnitBlueprint> = {}): UnitBlueprint {
  const u = fullUnit(id, over);
  return { ...u, sim: { ...u.sim, ...sim } };
}

const mount = (ref: string, priorities: string[] = ['LAND'], layers: UnitBlueprint['sim']['motion']['layer'][] = ['land']) => ({
  id: 'gun',
  ref,
  part: 'turret' as const,
  arcDeg: 360,
  yawRateDeg: 90,
  layers,
  priorities,
});

describe('references', () => {
  it('unknown references are reported at their pointer', () => {
    const e = compileErr(
      src(
        defineUnit(withSim('core:a', { weapons: [mount('core:wpn_nope')], deathWeapon: 'core:wpn_gone', upgradesTo: 'core:b' })),
        defineWeapon({ id: 'core:wpn_x', sim: { range: 5, damage: 1, reloadSec: 1, muzzleVelocity: 5, projectile: 'core:prj_missing', salvo: 1 } }),
      ),
    );
    expect(e.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'core:a', path: '/sim/weapons/0/ref', message: "unknown weapon blueprint 'core:wpn_nope'" }),
        expect.objectContaining({ id: 'core:a', path: '/sim/deathWeapon', message: "unknown weapon blueprint 'core:wpn_gone'" }),
        expect.objectContaining({ id: 'core:a', path: '/sim/upgradesTo', message: "unknown unit blueprint 'core:b'" }),
        expect.objectContaining({ id: 'core:wpn_x', path: '/sim/projectile', message: "unknown projectile blueprint 'core:prj_missing'" }),
      ]),
    );
  });

  it('references must have the right type', () => {
    const e = compileErr(
      src(
        ...weaponDefs(),
        effectDef(),
        defineUnit(withSim('core:a', { weapons: [mount('core:prj_a')], deathWeapon: 'core:fx_a' }, { view: { placeholder: { hull: 'box', size: [1, 1, 1] }, fx: { death: 'core:wpn_a' } } })),
        defineFaction({ id: 'core:f', units: ['core:a', 'core:wpn_a'], startUnit: 'core:a', color: [0, 0, 0] }),
      ),
    );
    expect(e.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: '/sim/weapons/0/ref', message: "'core:prj_a' is a projectile blueprint (expected weapon)" }),
        expect.objectContaining({ path: '/sim/deathWeapon', message: "'core:fx_a' is a effect blueprint (expected weapon)" }),
        expect.objectContaining({ path: '/view/fx/death', message: "'core:wpn_a' is a weapon blueprint (expected effect)" }),
        expect.objectContaining({ id: 'core:f', path: '/units/1', message: "'core:wpn_a' is a weapon blueprint (expected unit)" }),
      ]),
    );
  });

  it('abstract and test: blueprints cannot be referenced from game content', () => {
    const e = compileErr(
      src(
        defineWeapon({ id: 'core:wpn_base', abstract: true, sim: { range: 5 } }),
        defineUnit(withSim('core:a', { weapons: [mount('core:wpn_base')], upgradesTo: 'test:b' })),
        defineUnit(fullUnit('test:b')),
      ),
    );
    expect(e.diagnostics).toEqual([
      expect.objectContaining({ id: 'core:a', path: '/sim/upgradesTo', message: "'test:b' is in the test: namespace and cannot be referenced by 'core:a'" }),
      expect.objectContaining({ id: 'core:a', path: '/sim/weapons/0/ref', message: "'core:wpn_base' is abstract and cannot be referenced" }),
    ]);
  });

  it('faction start unit must be one of its units; a unit cannot upgrade into itself', () => {
    const e = compileErr(
      src(
        defineUnit(fullUnit('core:a')),
        defineUnit(withSim('core:b', { upgradesTo: 'core:b' })),
        defineFaction({ id: 'core:f', units: ['core:a'], startUnit: 'core:b', color: [0, 0, 0] }),
      ),
    );
    expect(e.diagnostics).toEqual([
      expect.objectContaining({ id: 'core:b', path: '/sim/upgradesTo', message: 'a unit cannot upgrade into itself' }),
      expect.objectContaining({ id: 'core:f', path: '/startUnit', message: "start unit 'core:b' is not one of the faction's units" }),
    ]);
  });
});

describe('layers, motion and the size-class rule', () => {
  it('weapon target layers must be MVP layers', () => {
    const e = compileErr(src(...weaponDefs(), defineUnit(withSim('core:a', { weapons: [mount('core:wpn_a', ['LAND'], ['land', 'water'])] }))));
    expect(e.diagnostics).toEqual([expect.objectContaining({ path: '/sim/weapons/0/layers/1', message: expect.stringMatching(/layer 'water' is not active in the MVP/) })]);
  });

  it('mobile land units: sizeClass ≤ 3 and radius ≤ max(0.5, sizeClass − 0.5)', () => {
    const m = fullUnit('x:y').sim.motion;
    const e = compileErr(
      src(
        defineUnit(withSim('core:big', { motion: { ...m, sizeClass: 1, radius: 0.8 } })),
        defineUnit(withSim('core:huge', { motion: { ...m, sizeClass: 5, radius: 2 } })),
        defineUnit(withSim('core:ok2', { motion: { ...m, sizeClass: 2, radius: 1.5 } })),
        defineUnit(withSim('core:ok0', { motion: { ...m, sizeClass: 0, radius: 0.5 } })),
        // Structures are not bound by the rule.
        defineUnit(withSim('core:house', { motion: { ...m, speed: 0, accel: 0, turnRateDeg: 0, sizeClass: 1, footprint: [6, 6] } }, { categories: ['STRUCTURE', 'LAND'] })),
      ),
    );
    expect(e.diagnostics).toEqual([
      expect.objectContaining({ id: 'core:big', path: '/sim/motion/radius', message: 'radius 0.8 WU does not fit size class 1 (max 0.5 WU)' }),
      expect.objectContaining({ id: 'core:huge', path: '/sim/motion/sizeClass', message: 'mobile land units use size classes 0..3 (got 5)' }),
    ]);
  });

  it('a moving unit needs accel and turn rate', () => {
    const m = fullUnit('x:y').sim.motion;
    const e = compileErr(src(defineUnit(withSim('core:a', { motion: { ...m, accel: 0, turnRateDeg: 0 } }))));
    expect(e.diagnostics.map((d) => d.path)).toEqual(['/sim/motion/accel', '/sim/motion/turnRateDeg']);
  });
});

describe('category expressions', () => {
  it('invalid expressions report the position inside the expression', () => {
    const e = compileErr(
      src(
        ...weaponDefs(),
        defineUnit(withSim('core:a', { weapons: [mount('core:wpn_a', ['LAND', 'MOBILE & (LAND |'])], economy: { mass: 1, energy: 1, buildTime: 1, buildableBy: 'FACTORY & LAND' } })),
        defineAiProfile({ id: 'core:ai', build: [{ id: 'x', categories: 'land', weight: 1 }], attack: [{ id: 'y', categories: 'LAND', weight: 1 }] }),
      ),
    );
    expect(e.diagnostics).toEqual([
      expect.objectContaining({ id: 'core:a', path: '/sim/economy/buildableBy', message: "category expression 'FACTORY & LAND' at 0: unknown category 'FACTORY'" }),
      expect.objectContaining({
        id: 'core:a',
        path: '/sim/weapons/0/priorities/1',
        message: "category expression 'MOBILE & (LAND |' at 16: expected a category name, '!' or '(', got end of expression",
      }),
      expect.objectContaining({
        id: 'core:ai',
        path: '/build/0/categories',
        message: "category expression 'land' at 0: unexpected character 'l' (category names are upper case)",
      }),
    ]);
  });

  it('compiles expressions into deduplicated, sorted bytecode shared by all units', () => {
    const r = compileBlueprints(
      src(
        ...weaponDefs(),
        defineUnit(withSim('core:fac', {}, { categories: ['FACTORY', 'LAND'] })),
        defineUnit(withSim('core:a', { weapons: [mount('core:wpn_a', ['MOBILE', 'LAND'])], economy: { mass: 1, energy: 1, buildTime: 1, buildableBy: 'FACTORY & LAND' } })),
        defineUnit(withSim('core:b', { weapons: [mount('core:wpn_a', ['LAND'])], economy: { mass: 1, energy: 1, buildTime: 1, buildableBy: 'FACTORY & LAND' } })),
      ),
    );
    expect(r.exprs).toEqual(['FACTORY & LAND', 'LAND', 'MOBILE']);
    expect(r.units.map((u) => u.sim.buildableBy)).toEqual([0, 0, -1]);
  });
});

describe('tech tree', () => {
  const eco = (buildableBy?: string) => ({ mass: 1, energy: 1, buildTime: 1, ...(buildableBy === undefined ? {} : { buildableBy }) });

  it('reports a closed build cycle with its path', () => {
    const e = compileErr(
      src(
        defineUnit(withSim('core:alpha', { economy: eco('BETA') }, { categories: ['ALPHA', 'LAND'] })),
        defineUnit(withSim('core:beta', { economy: eco('GAMMA') }, { categories: ['BETA', 'LAND'] })),
        defineUnit(withSim('core:gamma', { economy: eco('ALPHA') }, { categories: ['GAMMA', 'LAND'] })),
        defineUnit(withSim('core:root', {}, { categories: ['ROOT', 'LAND'] })),
      ),
    );
    expect(e.diagnostics).toEqual([
      expect.objectContaining({
        id: 'core:alpha',
        path: '/sim/economy/buildableBy',
        message: expect.stringMatching(/^tech tree cycle: core:alpha -> core:beta -> core:gamma -> core:alpha /),
      }),
    ]);
  });

  it('accepts FA-style cycles that are reachable from a root (engineer ↔ factory)', () => {
    const r = compileBlueprints(
      src(
        defineUnit(withSim('core:acu', { economy: eco() }, { categories: ['COMMAND', 'ENGINEER', 'LAND'] })),
        defineUnit(withSim('core:factory', { economy: eco('ENGINEER') }, { categories: ['FACTORY', 'LAND'] })),
        defineUnit(withSim('core:engineer', { economy: eco('FACTORY') }, { categories: ['ENGINEER', 'LAND', 'MOBILE'] })),
      ),
    );
    expect(r.units).toHaveLength(3);
  });

  it('reports upgrade cycles (each once, with the path) and self-only builders', () => {
    const e = compileErr(
      src(
        defineUnit(withSim('core:t1', { upgradesTo: 'core:t2' })),
        defineUnit(withSim('core:t2', { upgradesTo: 'core:t3' })),
        defineUnit(withSim('core:t3', { upgradesTo: 'core:t1' })),
        defineUnit(withSim('core:orphan', { economy: eco('NAVAL') }, { categories: ['NAVAL', 'LAND'] })),
      ),
    );
    expect(e.diagnostics.map((d) => `${d.id}${d.path}: ${d.message.replace(/ \(each.*$/, '')}`)).toEqual([
      'core:orphan/sim/economy/buildableBy: tech tree cycle: core:orphan -> core:orphan',
      'core:t1/sim/upgradesTo: tech tree cycle: core:t1 -> core:t3 -> core:t2 -> core:t1',
      'core:t1/sim/upgradesTo: upgradesTo cycle: core:t1 -> core:t2 -> core:t3 -> core:t1',
    ]);
  });

  it('a self-only buildable unit is an unreachable cycle; an unmatched expression is reported', () => {
    const e = compileErr(
      src(
        defineUnit(fullUnit('core:root')),
        defineUnit(withSim('core:selfish', { economy: eco('SELFISH') }, { categories: ['SELFISH', 'LAND'] })),
        defineUnit(withSim('core:lonely', { economy: eco('MOBILE - LAND') })),
      ),
    );
    expect(e.diagnostics).toEqual([
      expect.objectContaining({ id: 'core:lonely', path: '/sim/economy/buildableBy', message: "buildableBy 'MOBILE - LAND' matches no unit" }),
      expect.objectContaining({ id: 'core:selfish', message: expect.stringMatching(/^tech tree cycle: core:selfish -> core:selfish/) }),
    ]);
  });
});

describe('i18n, registries, gates, strict content', () => {
  it('missing i18n keys are reported per language (de and en separately)', () => {
    const locales = localesFor(['core:a']);
    const onlyEn = { de: { ...locales.de }, en: { ...locales.en } };
    delete onlyEn.de['unit.core.a.desc'];
    const e1 = compileErr(src(defineUnit(gameUnit('core:a'))), { locales: onlyEn });
    expect(e1.diagnostics).toEqual([
      { id: 'core:a', source: 'mem/0.ts', path: '/view/descKey', message: "i18n key 'unit.core.a.desc' is missing in content/locales/de.json" },
    ]);
    const onlyDe = { de: { ...locales.de }, en: { ...locales.en } };
    delete onlyDe.en['unit.core.a.name'];
    const e2 = compileErr(src(defineUnit(gameUnit('core:a'))), { locales: onlyDe });
    expect(e2.diagnostics).toEqual([
      { id: 'core:a', source: 'mem/0.ts', path: '/view/nameKey', message: "i18n key 'unit.core.a.name' is missing in content/locales/en.json" },
    ]);
    // Faction/AI names and explicit keys are checked too; test: blueprints are exempt.
    const e3 = compileErr(
      src(
        defineUnit(gameUnit('core:a', { view: { placeholder: { hull: 'box', size: [1, 1, 1] }, icon: 'land_direct', nameKey: 'custom.name' } })),
        defineUnit(fullUnit('test:t')),
        defineFaction({ id: 'core:f', units: ['core:a'], startUnit: 'core:a', color: [0, 0, 0] }),
      ),
      { locales, includeTest: true },
    );
    expect(e3.diagnostics.map((d) => `${d.id}${d.path}`)).toEqual(['core:a/view/nameKey', 'core:a/view/nameKey', 'core:f/nameKey', 'core:f/nameKey']);
    expect(compileBlueprints(src(defineUnit(gameUnit('core:a'))), { locales }).units).toHaveLength(1);
  });

  it('behaviors and toggles must be registered (the MS3 registries are empty)', () => {
    const e = compileErr(src(defineUnit(withSim('core:a', { behaviors: ['cloak'], toggles: ['shield'] }))));
    expect(e.diagnostics).toEqual([
      expect.objectContaining({ path: '/sim/behaviors/0', message: "unknown behavior 'cloak' (registered: none)" }),
      expect.objectContaining({ path: '/sim/toggles/0', message: "unknown toggle 'shield' (registered: none)" }),
    ]);
    const ok = compileBlueprints(src(defineUnit(withSim('core:a', { behaviors: ['cloak'], toggles: ['shield'] }))), { behaviors: ['cloak'], toggles: ['shield'] });
    expect(ok.units).toHaveLength(1);
  });

  it('balancing gate: ARTILLERY & TECH3 range ≤ 40 % of the smallest map diagonal (compile option)', () => {
    const defs = src(
      ...weaponDefs('core:wpn_big', 'core:prj_a', 200),
      defineUnit(withSim('core:arty3', { weapons: [mount('core:wpn_big')] }, { categories: ['ARTILLERY', 'TECH3', 'LAND'] })),
    );
    const e = compileErr(defs);
    expect(MIN_MAP_DIAGONAL_WU).toBeCloseTo(362.04, 2);
    expect(e.diagnostics).toEqual([
      expect.objectContaining({
        id: 'core:arty3',
        source: 'mem/2.ts',
        path: '/sim/weapons/0/ref',
        message: expect.stringMatching(/^balancing gate 'artillery-t3-range': range 200 WU of 'core:wpn_big' exceeds 144\.8 WU/),
      }),
    ]);
    // A larger smallest map (1,024 WU) admits it; other gates can be plugged in.
    expect(compileBlueprints(defs, { minMapDiagonalWu: 1024 * Math.SQRT2 }).units).toHaveLength(1);
    const hpGate: BalancingGate = {
      id: 'hp',
      description: 'max hp ≤ 50',
      check: (ctx) => ctx.units.filter((u) => u.sim.health.max > 50).map((u) => ({ id: u.id, path: '/sim/health/max', message: 'too tough' })),
    };
    const g = compileErr(src(defineUnit(fullUnit('core:a'))), { gates: [ARTILLERY_RANGE_GATE, hpGate] });
    expect(g.diagnostics).toEqual([expect.objectContaining({ id: 'core:a', path: '/sim/health/max', message: 'too tough' })]);
  });

  it('strict content: registered icon and exactly one TECH category', () => {
    const e = compileErr(
      src(
        defineUnit(fullUnit('core:noicon', { categories: ['LAND', 'TECH1'] })),
        defineUnit(gameUnit('core:badicon', { view: { placeholder: { hull: 'box', size: [1, 1, 1] }, icon: 'land_cube' } })),
        defineUnit(gameUnit('core:twotech', { categories: ['LAND', 'TECH1', 'TECH2'] })),
      ),
      { strict: true },
    );
    expect(e.diagnostics.map((d) => `${d.id}${d.path}`)).toEqual(['core:badicon/view/icon', 'core:noicon/view/icon', 'core:twotech/categories']);
    expect(e.diagnostics[0]!.message).toMatch(/unknown icon 'land_cube' \(registered: air_generic, commander, cube/);
  });
});
