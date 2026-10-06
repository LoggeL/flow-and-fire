// MS3 (S6): every blueprint type – valid definitions compile, invalid ones report JSON pointers;
// abstract variants, extends/merge semantics and namespace ids work for all types.
import { describe, expect, it } from 'vitest';
import {
  compileBlueprints,
  defineAiProfile,
  defineEffect,
  defineFaction,
  definePatch,
  defineProjectile,
  defineProp,
  defineUnit,
  defineWeapon,
  type BlueprintDefinition,
} from '../src/index.ts';
import { compileErr, effectDef, fullUnit, src, weaponDefs } from './support/fixtures.ts';

/** One valid definition set covering every type. */
function everyType(): BlueprintDefinition[] {
  return [
    defineUnit({
      ...fullUnit('core:tank'),
      categories: ['LAND', 'MOBILE', 'TECH1'],
      sim: {
        ...fullUnit('x:y').sim,
        economy: { mass: 50, energy: 250, buildTime: 250 },
        weapons: [{ id: 'gun', ref: 'core:wpn_a', part: 'turret', arcDeg: 360, yawRateDeg: 90, layers: ['land'], priorities: ['MOBILE'] }],
        hitbox: [0.8, 0.4, 0.6],
        wreck: { massFraction: 0.9, hpFraction: 0.5 },
        deathWeapon: null,
        veterancy: 'default',
        upgradesTo: null,
        behaviors: [],
        toggles: [],
      },
      view: { ...fullUnit('x:y').view, fx: { death: 'core:fx_a' }, hotkeySlot: 'Q', selectionRadius: 0.7 },
    }),
    ...weaponDefs(),
    effectDef(),
    defineProp({
      id: 'core:rock',
      sim: { reclaim: { mass: 10, energy: 0, timeSec: 2 }, blocksShots: true, footprint: [1, 1] },
      view: { placeholder: { hull: 'box', size: [1, 1, 1] } },
    }),
    defineFaction({ id: 'core:fac', units: ['core:tank'], startUnit: 'core:tank', color: [0.2, 0.4, 0.8] }),
    defineAiProfile({
      id: 'core:ai',
      build: [{ id: 'tanks', categories: 'MOBILE & LAND', weight: 1 }],
      attack: [{ id: 'all', categories: 'LAND', weight: 1 }],
    }),
  ];
}

describe('blueprint types', () => {
  it('compiles one of every type into its own table (index = sorted id)', () => {
    const r = compileBlueprints(src(...everyType()));
    expect(r.units.map((u) => u.id)).toEqual(['core:tank']);
    expect(r.weapons.map((w) => [w.index, w.id])).toEqual([[0, 'core:wpn_a']]);
    expect(r.projectiles.map((p) => p.id)).toEqual(['core:prj_a']);
    expect(r.props.map((p) => p.id)).toEqual(['core:rock']);
    expect(r.effects.map((e) => e.id)).toEqual(['core:fx_a']);
    expect(r.factions.map((f) => f.id)).toEqual(['core:fac']);
    expect(r.aiProfiles.map((a) => a.id)).toEqual(['core:ai']);
    expect(r.view.effects.map((e) => e.id)).toEqual(['core:fx_a']);
    expect(r.view.visuals[0]).toMatchObject({ fx: { death: 'core:fx_a' }, hotkeySlot: 'Q', selectionRadius: 0.7, tech: 1 });
    const bundle = JSON.parse(r.bundleJson) as Record<string, unknown[]>;
    for (const k of ['units', 'weapons', 'projectiles', 'props', 'effects', 'factions', 'aiProfiles']) expect(bundle[k], k).toHaveLength(1);
  });

  const invalid: [string, BlueprintDefinition, string, string][] = [
    [
      'unit',
      defineUnit({ ...fullUnit('core:u'), sim: { ...fullUnit('x:y').sim, wreck: { massFraction: 1.5, hpFraction: 0.5 } } }),
      '/sim/wreck/massFraction',
      'Expected number to be less or equal to 1',
    ],
    [
      'unit (mount)',
      defineUnit({
        ...fullUnit('core:u'),
        sim: {
          ...fullUnit('x:y').sim,
          weapons: [{ id: 'gun', ref: 'core:wpn_a', part: 'barrel' as 'hull', arcDeg: 90, yawRateDeg: 90, layers: ['land'], priorities: ['LAND'] }],
        },
      }),
      '/sim/weapons/0/part',
      'Expected union value',
    ],
    [
      'weapon',
      defineWeapon({ id: 'core:w', sim: { range: -1, damage: 1, reloadSec: 1, muzzleVelocity: 1, projectile: 'core:prj_a', salvo: 1 } }),
      '/sim/range',
      'Expected number to be greater than 0',
    ],
    [
      'projectile',
      defineProjectile({ id: 'core:p', sim: { kind: 'laser' as 'linear', speed: 1, lifetimeSec: 1 } }),
      '/sim/kind',
      'Expected union value',
    ],
    [
      'prop',
      defineProp({ id: 'core:p', sim: { reclaim: { mass: 1.5, energy: 0, timeSec: 1 }, blocksShots: true, footprint: [1, 1] }, view: { placeholder: { hull: 'box', size: [1, 1, 1] } } }),
      '/sim/reclaim/mass',
      'Expected integer',
    ],
    ['effect', defineEffect({ id: 'core:e', view: { kind: 'flash', color: [1, 1, 2], size: 1, durationSec: 1 } }), '/view/color/2', 'Expected number to be less or equal to 1'],
    ['faction', defineFaction({ id: 'core:f', units: [], startUnit: 'core:u', color: [0, 0, 0] }), '/units', 'Expected array length to be greater or equal to 1'],
    [
      'aiProfile',
      defineAiProfile({ id: 'core:a', build: [{ id: 'x', categories: 'LAND', weight: -1 }], attack: [{ id: 'y', categories: 'LAND', weight: 1 }] }),
      '/build/0/weight',
      'Expected number to be greater or equal to 0',
    ],
  ];
  for (const [kind, def, path, message] of invalid) {
    it(`reports an invalid ${kind} with its JSON pointer`, () => {
      const e = compileErr(src(defineUnit(fullUnit('core:u2')), ...weaponDefs(), def));
      expect(e.diagnostics).toContainEqual(expect.objectContaining({ path, message }));
    });
  }

  it('rejects unknown fields in every type (strict schemas)', () => {
    const e = compileErr(
      src(
        defineWeapon({ id: 'core:w', sim: { range: 1, damage: 1, reloadSec: 1, muzzleVelocity: 1, projectile: 'core:prj_a', salvo: 1, dps: 3 } as never }),
        defineProjectile({ id: 'core:prj_a', sim: { kind: 'linear', speed: 1, lifetimeSec: 1 }, sound: 'x' } as never),
        defineEffect({ id: 'core:e', view: { kind: 'flash', color: [1, 1, 1], size: 1, durationSec: 1, glow: true } } as never),
        defineFaction({ id: 'core:f', units: ['core:u'], startUnit: 'core:u', color: [0, 0, 0], motto: 'x' } as never),
      ),
    );
    const got = e.diagnostics.filter((d) => d.message === 'Unexpected property').map((d) => `${d.id}${d.path}`);
    expect(got).toEqual(['core:e/view/glow', 'core:f/motto', 'core:prj_a/sound', 'core:w/sim/dps']);
  });

  it('resolves abstract bases, extends and merge patches for non-unit types', () => {
    const r = compileBlueprints(
      src(
        defineWeapon({ id: 'core:wpn_base', abstract: true, sim: { damage: 10, reloadSec: 1, muzzleVelocity: 20, projectile: 'core:prj_a', salvo: 1 } }),
        defineWeapon({ id: 'core:wpn_long', extends: 'core:wpn_base', sim: { range: 30, minRange: 4 } }),
        defineWeapon({ id: 'core:wpn_short', extends: 'core:wpn_base', sim: { range: 8 } }),
        definePatch<{ sim: { damage: number; minRange: number } }>('core:wpn_long', { sim: { damage: 25, minRange: null } }),
        defineProjectile({ id: 'core:prj_a', sim: { kind: 'linear', speed: 20, lifetimeSec: 1 } }),
        defineEffect({ id: 'core:fx_base', abstract: true, view: { kind: 'burst', color: [1, 0.5, 0], durationSec: 1 } }),
        defineEffect({ id: 'core:fx_small', extends: 'core:fx_base', view: { size: 1 } }),
        defineEffect({ id: 'core:fx_big', extends: 'core:fx_small', view: { size: 3, count: 20 } }),
      ),
    );
    expect(r.weapons.map((w) => w.id)).toEqual(['core:wpn_long', 'core:wpn_short']);
    const long = r.weapons[0]!.resolved;
    expect(long.sim).toEqual({ damage: 25, reloadSec: 1, muzzleVelocity: 20, projectile: 'core:prj_a', salvo: 1, range: 30 });
    expect(r.view.effects).toEqual([
      { id: 'core:fx_big', kind: 'burst', color: [1, 0.5, 0], size: 3, durationSec: 1, count: 20 },
      { id: 'core:fx_small', kind: 'burst', color: [1, 0.5, 0], size: 1, durationSec: 1, count: 1 },
    ]);
  });

  it('extends must stay within one type; ids are unique across all types', () => {
    const e = compileErr(
      src(
        ...weaponDefs(),
        defineUnit({ id: 'core:u', extends: 'core:wpn_a' }),
        defineEffect({ id: 'core:prj_a', view: { kind: 'flash', color: [1, 1, 1], size: 1, durationSec: 1 } }),
      ),
    );
    expect(e.diagnostics).toContainEqual(
      expect.objectContaining({ id: 'core:u', path: '/extends', message: "extends 'core:wpn_a', a weapon blueprint (expected unit)" }),
    );
    expect(e.diagnostics).toContainEqual(expect.objectContaining({ id: 'core:prj_a', path: '/id', message: expect.stringMatching(/duplicate blueprint id/) }));
  });

  it('abstract variants are validated strictly but may be incomplete', () => {
    const e = compileErr(src(defineProp({ id: 'core:p_base', abstract: true, sim: { reclaim: { mass: 1, colour: 1 } } } as never)));
    expect(e.diagnostics).toEqual([expect.objectContaining({ id: 'core:p_base', path: '/sim/reclaim/colour', message: 'Unexpected property' })]);
    const ok = compileBlueprints(src(defineProp({ id: 'core:p_base', abstract: true, sim: { blocksShots: false } })));
    expect(ok.props).toEqual([]);
  });
});
