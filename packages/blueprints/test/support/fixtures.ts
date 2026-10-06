import { expect } from 'vitest';
import {
  BlueprintCompileError,
  compileBlueprints,
  defineEffect,
  defineProjectile,
  defineWeapon,
  type BlueprintDefinition,
  type CompileOptions,
  type LocaleTables,
  type SourcedDefinition,
  type UnitBlueprint,
} from '../../src/index.ts';

/** A complete, valid concrete unit for tests (no TECH category, no icon: non-strict bundles). */
export function fullUnit(id: string, over: Partial<UnitBlueprint> = {}): UnitBlueprint {
  return {
    id,
    categories: ['LAND', 'MOBILE'],
    sim: {
      health: { max: 100 },
      motion: { layer: 'land', speed: 3, accel: 3, turnRateDeg: 180, sizeClass: 1, footprint: [1, 1], maxSlope: 0.6 },
    },
    view: { placeholder: { hull: 'box', size: [0.5, 0.5, 0.5] } },
    ...over,
  };
}

/** A unit that satisfies the strict game-content rules (icon, exactly one TECH category). */
export function gameUnit(id: string, over: Partial<UnitBlueprint> = {}): UnitBlueprint {
  const u = fullUnit(id, over);
  return {
    ...u,
    categories: over.categories ?? ['LAND', 'MOBILE', 'TECH1'],
    view: { ...u.view, icon: u.view.icon ?? 'land_direct' },
  };
}

/** A minimal weapon + projectile pair. */
export function weaponDefs(weaponId = 'core:wpn_a', projectileId = 'core:prj_a', range = 10): BlueprintDefinition[] {
  return [
    defineWeapon({ id: weaponId, sim: { range, damage: 10, reloadSec: 1, muzzleVelocity: 20, projectile: projectileId, salvo: 1 } }),
    defineProjectile({ id: projectileId, sim: { kind: 'linear', speed: 20, lifetimeSec: 1 } }),
  ];
}

export function effectDef(id = 'core:fx_a') {
  return defineEffect({ id, view: { kind: 'flash', color: [1, 1, 1], size: 1, durationSec: 0.1 } });
}

export function src(...defs: BlueprintDefinition[]): SourcedDefinition[] {
  return defs.map((def, i) => ({ def, source: `mem/${i}.ts` }));
}

export function compileErr(defs: SourcedDefinition[], options: CompileOptions = { includeTest: true }): BlueprintCompileError {
  try {
    compileBlueprints(defs, options);
  } catch (e) {
    expect(e).toBeInstanceOf(BlueprintCompileError);
    return e as BlueprintCompileError;
  }
  throw new Error('expected compilation to fail');
}

/** Locale tables with name/desc keys for the given unit ids (plus extra keys). */
export function localesFor(unitIds: readonly string[], extra: readonly string[] = []): LocaleTables {
  const t: Record<string, string> = {};
  for (const id of unitIds) {
    const [ns, name] = id.split(':') as [string, string];
    t[`unit.${ns}.${name}.name`] = `${name} name`;
    t[`unit.${ns}.${name}.desc`] = `${name} desc`;
  }
  for (const k of extra) t[k] = k;
  return { de: { ...t }, en: { ...t } };
}
