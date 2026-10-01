/**
 * Blueprint compiler (PLAN §3.9, steps 1–7), all types: unit, weapon, projectile, prop, effect,
 * faction, aiProfile.
 *   1. merge patches            → definePatch() applied to their target (source order, any type)
 *   2. extends                  → parent (same type) first, merge.ts semantics, cycle check
 *   3. validation               → TypeBox per type (JSON pointers) + semantics: references exist
 *                                  and have the right type, MVP layers, size-class rule, category
 *                                  expressions, cycle-free tech tree, i18n keys (de and en),
 *                                  behavior/toggle registry, balancing gates
 *   4. categories → masks       → @faf/rules CategoryRegistry over all emitted units; category
 *                                  expressions → bytecode
 *   5. unit conversion          → exactly once, here (per second → per tick, ° → Ang16, decimal → Fx)
 *   6. ids                      → index in the code-unit-sorted string ids, per table
 *   7. output                   → sim.bin v2 + simHash, view.json v2 + viewHash, bundle.json, hashes.json
 *
 * All errors are collected (never fail-fast) as diagnostics with the blueprint id, its source file
 * and a JSON pointer into the resolved blueprint. Abstract blueprints are never emitted; the
 * `test:` namespace is only emitted with `includeTest` (unit tests); game bundles never contain it.
 *
 * `compileBlueprints` works on definitions; `compileBlueprintModules` is the file-system-free
 * entry point for the CLI and the Vite HMR plugin (module exports + locale tables in, bytes out,
 * diagnostics instead of exceptions).
 *
 * Floats are allowed here (and only here): the compiled integers are checked in, so the sim never
 * depends on engine float behavior. Rounding rule: round half up of the Float64 result.
 */
import { FX_ONE, xxHash32 } from '@faf/fixed';
import {
  CategoryExprError,
  CategoryRegistry,
  compareCodeUnits,
  compileCategoryExpr,
  createMask,
  matchesMask,
  motionLayerOf,
  MVP_MOTION_LAYERS,
  SIM_TICK_HZ,
  type CompiledCategoryExpr,
} from '@faf/rules';
import { Value } from '@sinclair/typebox/value';
import { canonicalJson, hex32, utf8 } from './canonical.ts';
import {
  BLUEPRINT_KINDS,
  isBlueprintDefinition,
  type BlueprintDefinition,
  type BlueprintKind,
  type BlueprintOfKind,
  type UnitBlueprint,
  type WeaponBlueprint,
} from './define.ts';
import { LOCALE_LANGS, localeSource, validateLocaleTable, type LocaleTables } from './locales.ts';
import { deepClone, isPlainObject, mergePatch } from './merge.ts';
import { ABSTRACT_SCHEMAS, BLUEPRINT_ID_PATTERN, SCHEMAS } from './schema.ts';
import {
  DEFAULT_MASS_BY_SIZE_CLASS,
  encodeSimBin,
  ProjectileKind,
  SIM_BIN_MAX_UNITS,
  VeterancyId,
  WeaponPartId,
  type SimBinExpr,
  type SimBinFaction,
  type SimBinMount,
  type SimBinProjectile,
  type SimBinProp,
  type SimBinUnit,
  type SimBinWeapon,
} from './simbin.ts';
import {
  DEFAULT_ICON_THRESHOLD,
  defaultSelectionRadius,
  ICON_IDS,
  isIconId,
  VIEW_FORMAT,
  VIEW_VERSION,
  type ViewBundle,
  type ViewEffect,
  type ViewEntry,
} from './view.ts';

/** A definition together with the file it came from (used for messages and ordering). */
export interface SourcedDefinition {
  readonly def: BlueprintDefinition;
  /** Repo-relative source path, e.g. `content/blueprints/core/units/cube.ts`. */
  readonly source: string;
}

/** A balancing gate finding (PLAN §3.9 step 3). */
export interface GateFinding {
  readonly id: string;
  readonly path: string;
  readonly message: string;
}

/** What a balancing gate sees: the emitted, validated blueprints. */
export interface GateContext {
  readonly units: readonly UnitBlueprint[];
  weapon(id: string): WeaponBlueprint | undefined;
  /** Smallest map diagonal of the game (WU). */
  readonly minMapDiagonalWu: number;
}

/** A balancing rule checked at compile time. */
export interface BalancingGate {
  readonly id: string;
  readonly description: string;
  check(ctx: GateContext): readonly GateFinding[];
}

/** Smallest MVP map edge (PLAN §3.1: played on 256–512 WU). */
export const MIN_MAP_SIZE_WU = 256;
/** Default smallest map diagonal (WU) for the balancing gates: 256 · √2. */
export const MIN_MAP_DIAGONAL_WU = MIN_MAP_SIZE_WU * Math.SQRT2;
/** Share of the smallest map diagonal that T3 artillery may reach. */
export const ARTILLERY_T3_MAX_DIAGONAL_SHARE = 0.4;

/** Gate: range of units with ARTILLERY & TECH3 ≤ 40 % of the smallest map diagonal. */
export const ARTILLERY_RANGE_GATE: BalancingGate = {
  id: 'artillery-t3-range',
  description: 'weapon range of ARTILLERY & TECH3 units ≤ 40 % of the smallest map diagonal',
  check(ctx) {
    const limit = ARTILLERY_T3_MAX_DIAGONAL_SHARE * ctx.minMapDiagonalWu;
    const out: GateFinding[] = [];
    for (const u of ctx.units) {
      if (!u.categories.includes('ARTILLERY') || !u.categories.includes('TECH3')) continue;
      (u.sim.weapons ?? []).forEach((m, i) => {
        const w = ctx.weapon(m.ref);
        if (w !== undefined && w.sim.range > limit) {
          out.push({
            id: u.id,
            path: `/sim/weapons/${i}/ref`,
            message: `balancing gate '${ARTILLERY_RANGE_GATE.id}': range ${w.sim.range} WU of '${m.ref}' exceeds ${limit.toFixed(1)} WU (40 % of the smallest map diagonal ${ctx.minMapDiagonalWu.toFixed(1)} WU)`,
          });
        }
      });
    }
    return out;
  },
};

/** Gates checked by default. */
export const DEFAULT_GATES: readonly BalancingGate[] = [ARTILLERY_RANGE_GATE];

/** Registered behavior keys (PLAN §3.1 "Behaviors per Registry-Key"). Empty in MS3. */
export const BEHAVIOR_REGISTRY: readonly string[] = [];
/** Registered toggle keys. Empty in MS3. */
export const TOGGLE_REGISTRY: readonly string[] = [];

/**
 * Default braking deceleration = factor × accel (SPK2, DECISIONS 22; mirrored by
 * `SPK2_PARAMS.brakeFactor` in tools/headless/src/spk2/params.ts – a test keeps both equal).
 */
export const DEFAULT_BRAKE_FACTOR = 2;

export interface CompileOptions {
  /** Emit `test:` blueprints (unit tests only). Default false. */
  readonly includeTest?: boolean;
  /** Locale tables; when given, every referenced i18n key must exist in each language. */
  readonly locales?: LocaleTables;
  /**
   * Game-content rules: every unit needs a registered `view.icon` and exactly one TECH1..3
   * category. Default: on when `locales` is given (CLI/HMR), off for bare unit-test bundles.
   */
  readonly strict?: boolean;
  /** Smallest map diagonal (WU) for the balancing gates. Default {@link MIN_MAP_DIAGONAL_WU}. */
  readonly minMapDiagonalWu?: number;
  /** Balancing gates. Default {@link DEFAULT_GATES}. */
  readonly gates?: readonly BalancingGate[];
  /** Behavior registry. Default {@link BEHAVIOR_REGISTRY}. */
  readonly behaviors?: readonly string[];
  /** Toggle registry. Default {@link TOGGLE_REGISTRY}. */
  readonly toggles?: readonly string[];
}

/** One compiler finding. `path` is a JSON pointer into the (resolved) blueprint. */
export interface BlueprintDiagnostic {
  readonly id: string;
  readonly source: string;
  readonly path: string;
  readonly message: string;
}

function formatDiagnostic(d: BlueprintDiagnostic): string {
  return `${d.source} ${d.id}${d.path}: ${d.message}`;
}

export class BlueprintCompileError extends Error {
  readonly diagnostics: readonly BlueprintDiagnostic[];

  constructor(diagnostics: readonly BlueprintDiagnostic[]) {
    super(`blueprint compilation failed with ${diagnostics.length} error(s):\n` + diagnostics.map((d) => `  ${formatDiagnostic(d)}`).join('\n'));
    this.name = 'BlueprintCompileError';
    this.diagnostics = diagnostics;
  }
}

/** A compiled (emitted) unit. */
export interface CompiledUnit {
  readonly simId: number;
  readonly id: string;
  readonly source: string;
  /** Fully resolved blueprint (after patches and extends, defaults applied). */
  readonly resolved: UnitBlueprint;
  readonly sim: SimBinUnit;
  readonly view: ViewEntry;
}

/** A compiled blueprint of another type; `index` is its position in its (sorted) table. */
export interface CompiledEntry<K extends BlueprintKind> {
  readonly index: number;
  readonly id: string;
  readonly source: string;
  readonly resolved: BlueprintOfKind[K];
}

export interface CompileResult {
  readonly units: readonly CompiledUnit[];
  readonly weapons: readonly CompiledEntry<'weapon'>[];
  readonly projectiles: readonly CompiledEntry<'projectile'>[];
  readonly props: readonly CompiledEntry<'prop'>[];
  readonly effects: readonly CompiledEntry<'effect'>[];
  readonly factions: readonly CompiledEntry<'faction'>[];
  readonly aiProfiles: readonly CompiledEntry<'aiProfile'>[];
  /** Category names in bit order. */
  readonly categories: readonly string[];
  /** Category expression sources in sim.bin index order. */
  readonly exprs: readonly string[];
  readonly simBin: Uint8Array;
  /** xxHash32(sim.bin), seed 0. */
  readonly simHash: number;
  readonly view: ViewBundle;
  /** view.json file content (canonical, pretty-printed). */
  readonly viewJson: string;
  /** xxHash32 of the compact canonical view.json (UTF-8), seed 0. */
  readonly viewHash: number;
  /** bundle.json file content (canonical, pretty-printed). */
  readonly bundleJson: string;
  /** hashes.json file content. */
  readonly hashesJson: string;
}

export const NAMESPACE_TEST = 'test';

/** Namespace of an id (`core` for `core:cube`). */
export function namespaceOf(id: string): string {
  const i = id.indexOf(':');
  return i < 0 ? '' : id.slice(0, i);
}

function nameOf(id: string): string {
  return id.slice(id.indexOf(':') + 1);
}

function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5);
}

/** WU/s → Fx per tick (round half up; a non-zero value never rounds to 0). */
export function perSecondToFxPerTick(v: number): number {
  const r = roundHalfUp((v * FX_ONE) / SIM_TICK_HZ);
  return v > 0 && r === 0 ? 1 : r;
}

/** WU/s² → Fx per tick² (round half up; non-zero stays ≥ 1). */
export function perSecond2ToFxPerTick2(v: number): number {
  const r = roundHalfUp((v * FX_ONE) / (SIM_TICK_HZ * SIM_TICK_HZ));
  return v > 0 && r === 0 ? 1 : r;
}

/** °/s → Ang16 per tick (round half up; non-zero stays ≥ 1; capped at a half turn). */
export function degPerSecondToAng16PerTick(v: number): number {
  const r = roundHalfUp((v * 65536) / 360 / SIM_TICK_HZ);
  return Math.min(32768, v > 0 && r === 0 ? 1 : r);
}

/** Degrees → Ang16 (round half up; capped at a full turn − 0 = 65536). */
export function degToAng16(v: number): number {
  return Math.min(65536, roundHalfUp((v * 65536) / 360));
}

/** Seconds → ticks (round half up; non-zero stays ≥ 1). */
export function secondsToTicks(v: number): number {
  const r = roundHalfUp(v * SIM_TICK_HZ);
  return v > 0 && r === 0 ? 1 : r;
}

/** Decimal → Fx raw (round half up). */
export function decimalToFx(v: number): number {
  return roundHalfUp(v * FX_ONE);
}

/** Default collision mass of a size class (SPK2/DECISIONS 23). */
export function defaultMass(sizeClass: number): number {
  return DEFAULT_MASS_BY_SIZE_CLASS[Math.min(sizeClass, DEFAULT_MASS_BY_SIZE_CLASS.length - 1)]!;
}

/**
 * Size-class rule for mobile land units (DECISIONS 23): pathing class = sizeClass (0 counts as 1,
 * nav supports 1..3) and the collision radius must fit the class: radius ≤ max(0.5, sizeClass − 0.5) WU.
 */
export const MAX_LAND_SIZE_CLASS = 3;
export function maxRadiusForSizeClass(sizeClass: number): number {
  return Math.max(0.5, sizeClass - 0.5);
}

const ID_RE = new RegExp(BLUEPRINT_ID_PATTERN);
const TECH_CATEGORIES = ['TECH1', 'TECH2', 'TECH3'] as const;

interface Entry {
  readonly id: string;
  readonly kind: BlueprintKind;
  readonly source: string;
  data: Record<string, unknown>;
}

function schemaErrors(kind: BlueprintKind, abstract: boolean, value: unknown): { path: string; message: string }[] {
  const schema = abstract ? ABSTRACT_SCHEMAS[kind] : SCHEMAS[kind];
  const out: { path: string; message: string }[] = [];
  const seen: string[] = [];
  for (const e of Value.Errors(schema, value)) {
    const key = `${e.path}\u0000${e.message}`;
    if (seen.includes(key)) continue;
    seen.push(key);
    out.push({ path: e.path, message: e.message });
  }
  return out;
}

function kindLabel(k: BlueprintKind): string {
  return k === 'aiProfile' ? 'aiProfile' : k;
}

function sortDiagnostics(d: BlueprintDiagnostic[]): BlueprintDiagnostic[] {
  return d.sort(
    (a, b) =>
      compareCodeUnits(a.id, b.id) || compareCodeUnits(a.path, b.path) || compareCodeUnits(a.message, b.message) || compareCodeUnits(a.source, b.source),
  );
}

interface Emitted<K extends BlueprintKind> {
  readonly entry: Entry;
  readonly bp: BlueprintOfKind[K];
}

/** Compiles blueprint definitions (see module docs). Throws BlueprintCompileError on any error. */
export function compileBlueprints(defs: readonly SourcedDefinition[], options: CompileOptions = {}): CompileResult {
  const includeTest = options.includeTest === true;
  const locales = options.locales;
  const strict = options.strict ?? locales !== undefined;
  const minDiagonal = options.minMapDiagonalWu ?? MIN_MAP_DIAGONAL_WU;
  const gates = options.gates ?? DEFAULT_GATES;
  const behaviors = options.behaviors ?? BEHAVIOR_REGISTRY;
  const toggles = options.toggles ?? TOGGLE_REGISTRY;
  const diags: BlueprintDiagnostic[] = [];
  const report = (id: string, source: string, path: string, message: string): void => {
    diags.push({ id, source, path, message });
  };
  const included = (id: string): boolean => includeTest || namespaceOf(id) !== NAMESPACE_TEST;

  // ---- collect ------------------------------------------------------------------------------
  const entries: Entry[] = [];
  const byId = new Map<string, Entry>();
  for (const { def, source } of defs) {
    if (def.kind === 'patch') continue;
    const data = def.data as unknown;
    if (!isPlainObject(data)) {
      report('?', source, '', `${def.kind} definition must be an object`);
      continue;
    }
    const id = data.id;
    if (typeof id !== 'string' || !ID_RE.test(id)) {
      report(String(id), source, '/id', `invalid blueprint id (expected 'namespace:name', ${BLUEPRINT_ID_PATTERN})`);
      continue;
    }
    const prev = byId.get(id);
    if (prev !== undefined) {
      report(id, source, '/id', `duplicate blueprint id (already defined in ${prev.source})`);
      continue;
    }
    const e: Entry = { id, kind: def.kind, source, data: deepClone(data) };
    byId.set(id, e);
    entries.push(e);
  }

  // ---- 1. merge patches (definition order) --------------------------------------------------
  for (const { def, source } of defs) {
    if (def.kind !== 'patch') continue;
    const target = byId.get(def.target);
    if (target === undefined) {
      report(def.target, source, '', `patch targets unknown blueprint '${def.target}'`);
      continue;
    }
    if (!isPlainObject(def.patch)) {
      report(def.target, source, '', 'patch must be an object');
      continue;
    }
    if ('id' in def.patch) {
      report(def.target, source, '/id', 'a patch must not change the blueprint id');
      continue;
    }
    target.data = mergePatch(target.data, def.patch) as Record<string, unknown>;
  }

  // ---- 2. extends ---------------------------------------------------------------------------
  entries.sort((a, b) => compareCodeUnits(a.id, b.id));
  const resolved = new Map<string, Record<string, unknown> | null>();
  const resolve = (e: Entry, chain: string[]): Record<string, unknown> | null => {
    const done = resolved.get(e.id);
    if (done !== undefined) return done;
    const parentId = e.data.extends;
    let result: Record<string, unknown> | null;
    if (parentId === undefined) {
      // Root: `null` (= "none") entries are dropped like in a merge.
      result = mergePatch({}, e.data) as Record<string, unknown>;
    } else if (typeof parentId !== 'string') {
      report(e.id, e.source, '/extends', 'extends must be a blueprint id string');
      result = null;
    } else {
      const parent = byId.get(parentId);
      if (parent === undefined) {
        report(e.id, e.source, '/extends', `extends unknown blueprint '${parentId}'`);
        result = null;
      } else if (parent.kind !== e.kind) {
        report(e.id, e.source, '/extends', `extends '${parentId}', a ${kindLabel(parent.kind)} blueprint (expected ${kindLabel(e.kind)})`);
        result = null;
      } else if (namespaceOf(parentId) === NAMESPACE_TEST && namespaceOf(e.id) !== NAMESPACE_TEST) {
        report(e.id, e.source, '/extends', `'${parentId}' is in the test: namespace and cannot be a base of '${e.id}'`);
        result = null;
      } else if (chain.includes(parentId)) {
        const cycle = [...chain.slice(chain.indexOf(parentId)), parentId].join(' -> ');
        report(e.id, e.source, '/extends', `extends cycle: ${cycle}`);
        result = null;
      } else {
        const base = resolve(parent, [...chain, parentId]);
        if (base === null) {
          result = null; // the parent reported its own error
        } else {
          const inherited = deepClone(base);
          delete inherited.id;
          delete inherited.abstract;
          delete inherited.extends;
          result = mergePatch(inherited, e.data) as Record<string, unknown>;
        }
      }
    }
    resolved.set(e.id, result);
    return result;
  };
  for (const e of entries) resolve(e, [e.id]);

  // ---- 3a. schema validation ---------------------------------------------------------------------
  const valid = new Map<string, { entry: Entry; data: Record<string, unknown>; abstract: boolean }>();
  for (const e of entries) {
    const r = resolved.get(e.id);
    if (r === null || r === undefined) continue;
    const isAbstract = r.abstract === true;
    const errs = schemaErrors(e.kind, isAbstract, r);
    for (const err of errs) report(e.id, e.source, err.path, err.message);
    if (errs.length > 0) continue;
    valid.set(e.id, { entry: e, data: r, abstract: isAbstract });
  }
  const emittedOf = <K extends BlueprintKind>(kind: K): Emitted<K>[] => {
    const out: Emitted<K>[] = [];
    for (const e of entries) {
      if (e.kind !== kind) continue;
      const v = valid.get(e.id);
      if (v === undefined || v.abstract || !included(e.id)) continue;
      out.push({ entry: e, bp: v.data as unknown as BlueprintOfKind[K] });
    }
    return out;
  };
  const units = emittedOf('unit');
  const weapons = emittedOf('weapon');
  const projectiles = emittedOf('projectile');
  const props = emittedOf('prop');
  const effects = emittedOf('effect');
  const factions = emittedOf('faction');
  const aiProfiles = emittedOf('aiProfile');
  for (const [what, list] of [
    ['unit', units],
    ['weapon', weapons],
    ['projectile', projectiles],
    ['prop', props],
    ['faction', factions],
  ] as const) {
    if (list.length > SIM_BIN_MAX_UNITS) report('*', '*', '', `too many ${what} blueprints (${list.length} > ${SIM_BIN_MAX_UNITS})`);
  }

  // ---- 3b. semantics -----------------------------------------------------------------------------
  /** Checks a reference `ref` (at `path` of `from`) against the expected kind. True if usable. */
  const checkRef = (from: Entry, path: string, ref: string, kind: BlueprintKind): boolean => {
    const target = byId.get(ref);
    if (target === undefined) {
      report(from.id, from.source, path, `unknown ${kindLabel(kind)} blueprint '${ref}'`);
      return false;
    }
    if (target.kind !== kind) {
      report(from.id, from.source, path, `'${ref}' is a ${kindLabel(target.kind)} blueprint (expected ${kindLabel(kind)})`);
      return false;
    }
    if (namespaceOf(ref) === NAMESPACE_TEST && namespaceOf(from.id) !== NAMESPACE_TEST) {
      report(from.id, from.source, path, `'${ref}' is in the test: namespace and cannot be referenced by '${from.id}'`);
      return false;
    }
    const v = valid.get(ref);
    if (v === undefined) return false; // the target reported its own errors
    if (v.abstract) {
      report(from.id, from.source, path, `'${ref}' is abstract and cannot be referenced`);
      return false;
    }
    return included(ref);
  };
  const checkLayer = (e: Entry, path: string, layer: string): boolean => {
    if ((MVP_MOTION_LAYERS as readonly string[]).includes(layer)) return true;
    report(e.id, e.source, path, `layer '${layer}' is not active in the MVP (allowed: ${MVP_MOTION_LAYERS.join(', ')})`);
    return false;
  };
  const checkLod = (e: Entry, path: string, lod: readonly [number, number] | undefined): void => {
    if (lod !== undefined && !(lod[0] < lod[1])) report(e.id, e.source, path, `LOD distances must increase (got [${lod[0]}, ${lod[1]}])`);
  };
  const checkKey = (e: Entry, path: string, key: string): void => {
    if (locales === undefined || !gameContent(e.id)) return;
    for (const lang of LOCALE_LANGS) {
      if (!Object.hasOwn(locales[lang], key)) report(e.id, e.source, path, `i18n key '${key}' is missing in ${localeSource(lang)}`);
    }
  };
  const checkFx = (e: Entry, path: string, fx: Readonly<Record<string, string>> | undefined): void => {
    if (fx === undefined) return;
    for (const slot of Object.keys(fx).sort(compareCodeUnits)) checkRef(e, `${path}/${slot}`, fx[slot]!, 'effect');
  };

  // Category registry over all emitted units that passed the schema.
  let registry: CategoryRegistry;
  try {
    registry = new CategoryRegistry(units.flatMap((u) => u.bp.categories));
  } catch (err) {
    report('*', '*', '/categories', (err as Error).message);
    registry = new CategoryRegistry([]);
  }
  const exprCache = new Map<string, { readonly compiled: CompiledCategoryExpr | null; readonly error: string }>();
  const compileExpr = (e: Entry, path: string, src: string): CompiledCategoryExpr | null => {
    let c = exprCache.get(src);
    if (c === undefined) {
      try {
        c = { compiled: compileCategoryExpr(src, registry), error: '' };
      } catch (err) {
        if (!(err instanceof CategoryExprError)) throw err;
        c = { compiled: null, error: err.message };
      }
      exprCache.set(src, c);
    }
    if (c.compiled === null) report(e.id, e.source, path, c.error);
    return c.compiled;
  };
  /** Test blueprints are exempt from the game-content rules (icon, tech, i18n). */
  const gameContent = (id: string): boolean => namespaceOf(id) !== NAMESPACE_TEST;

  const nameKeyOf = (prefix: string, id: string, key: string | undefined): string => key ?? `${prefix}.${namespaceOf(id)}.${nameOf(id)}.name`;

  for (const { entry: e, bp } of units) {
    const m = bp.sim.motion;
    checkLayer(e, '/sim/motion/layer', m.layer);
    checkLod(e, '/view/lod', bp.view.lod);
    if (m.speed > 0 && !(m.accel > 0)) report(e.id, e.source, '/sim/motion/accel', 'a moving unit (speed > 0) needs accel > 0');
    if (m.speed > 0 && !(m.turnRateDeg > 0)) report(e.id, e.source, '/sim/motion/turnRateDeg', 'a moving unit (speed > 0) needs turnRateDeg > 0');
    if (m.layer === 'land' && bp.categories.includes('MOBILE')) {
      const radius = m.radius ?? Math.max(m.footprint[0], m.footprint[1]) / 2;
      if (m.sizeClass > MAX_LAND_SIZE_CLASS) {
        report(e.id, e.source, '/sim/motion/sizeClass', `mobile land units use size classes 0..${MAX_LAND_SIZE_CLASS} (got ${m.sizeClass})`);
      } else if (radius > maxRadiusForSizeClass(m.sizeClass)) {
        report(
          e.id,
          e.source,
          '/sim/motion/radius',
          `radius ${radius} WU does not fit size class ${m.sizeClass} (max ${maxRadiusForSizeClass(m.sizeClass)} WU)`,
        );
      }
    }
    const mounts = bp.sim.weapons ?? [];
    mounts.forEach((w, i) => {
      const p = `/sim/weapons/${i}`;
      if (mounts.findIndex((x) => x.id === w.id) !== i) report(e.id, e.source, `${p}/id`, `duplicate weapon mount id '${w.id}'`);
      checkRef(e, `${p}/ref`, w.ref, 'weapon');
      w.layers.forEach((l, k) => checkLayer(e, `${p}/layers/${k}`, l));
      w.priorities.forEach((src, k) => compileExpr(e, `${p}/priorities/${k}`, src));
    });
    if (bp.sim.economy?.buildableBy !== undefined) compileExpr(e, '/sim/economy/buildableBy', bp.sim.economy.buildableBy);
    if (bp.sim.deathWeapon != null) checkRef(e, '/sim/deathWeapon', bp.sim.deathWeapon, 'weapon');
    if (bp.sim.upgradesTo != null) {
      if (bp.sim.upgradesTo === e.id) report(e.id, e.source, '/sim/upgradesTo', 'a unit cannot upgrade into itself');
      else checkRef(e, '/sim/upgradesTo', bp.sim.upgradesTo, 'unit');
    }
    (bp.sim.behaviors ?? []).forEach((b, i) => {
      if (!behaviors.includes(b)) report(e.id, e.source, `/sim/behaviors/${i}`, `unknown behavior '${b}' (registered: ${behaviors.length === 0 ? 'none' : behaviors.join(', ')})`);
    });
    (bp.sim.toggles ?? []).forEach((t, i) => {
      if (!toggles.includes(t)) report(e.id, e.source, `/sim/toggles/${i}`, `unknown toggle '${t}' (registered: ${toggles.length === 0 ? 'none' : toggles.join(', ')})`);
    });
    checkFx(e, '/view/fx', bp.view.fx);
    if (strict && gameContent(e.id)) {
      if (bp.view.icon === undefined) report(e.id, e.source, '/view/icon', `missing strategic icon (one of ${ICON_IDS.join(', ')})`);
      else if (!isIconId(bp.view.icon)) report(e.id, e.source, '/view/icon', `unknown icon '${bp.view.icon}' (registered: ${ICON_IDS.join(', ')})`);
      const tech = TECH_CATEGORIES.filter((t) => bp.categories.includes(t));
      if (tech.length !== 1 && !(tech.length === 0 && bp.categories.includes('COMMAND'))) report(e.id, e.source, '/categories', `a unit needs exactly one of ${TECH_CATEGORIES.join(', ')} (got ${tech.length})`);
    }
    checkKey(e, '/view/nameKey', bp.view.nameKey ?? `unit.${namespaceOf(e.id)}.${nameOf(e.id)}.name`);
    checkKey(e, '/view/descKey', bp.view.descKey ?? `unit.${namespaceOf(e.id)}.${nameOf(e.id)}.desc`);
  }
  for (const { entry: e, bp } of weapons) {
    checkRef(e, '/sim/projectile', bp.sim.projectile, 'projectile');
    if ((bp.sim.minRange ?? 0) > bp.sim.range) report(e.id, e.source, '/sim/minRange', `minRange ${bp.sim.minRange} exceeds range ${bp.sim.range}`);
    checkFx(e, '/view/fx', bp.view?.fx);
  }
  for (const { entry: e, bp } of projectiles) {
    const s = bp.sim;
    if (s.kind === 'ballistic' && !((s.gravity ?? 0) > 0)) report(e.id, e.source, '/sim/gravity', 'ballistic projectiles need gravity > 0');
    if (s.kind !== 'ballistic' && (s.gravity ?? 0) > 0) report(e.id, e.source, '/sim/gravity', `gravity only applies to ballistic projectiles (kind '${s.kind}')`);
    if (s.kind === 'homing' && s.turnRateDeg === undefined) report(e.id, e.source, '/sim/turnRateDeg', 'homing projectiles need turnRateDeg');
    if (s.kind !== 'homing' && s.turnRateDeg !== undefined) report(e.id, e.source, '/sim/turnRateDeg', `turnRateDeg only applies to homing projectiles (kind '${s.kind}')`);
    if (bp.view?.trailFx !== undefined) checkRef(e, '/view/trailFx', bp.view.trailFx, 'effect');
  }
  for (const { entry: e, bp } of props) checkLod(e, '/view/lod', bp.view.lod);
  for (const { entry: e, bp } of factions) {
    bp.units.forEach((u, i) => checkRef(e, `/units/${i}`, u, 'unit'));
    if (checkRef(e, '/startUnit', bp.startUnit, 'unit') && !bp.units.includes(bp.startUnit)) {
      report(e.id, e.source, '/startUnit', `start unit '${bp.startUnit}' is not one of the faction's units`);
    }
    checkKey(e, '/nameKey', nameKeyOf('faction', e.id, bp.nameKey));
  }
  for (const { entry: e, bp } of aiProfiles) {
    for (const list of ['build', 'attack'] as const) {
      bp[list].forEach((w, i) => {
        if (bp[list].findIndex((x) => x.id === w.id) !== i) report(e.id, e.source, `/${list}/${i}/id`, `duplicate rule id '${w.id}'`);
        compileExpr(e, `/${list}/${i}/categories`, w.categories);
      });
    }
    checkKey(e, '/nameKey', nameKeyOf('ai', e.id, bp.nameKey));
  }

  // ---- 3c. tech tree (build/upgrade graph over emitted units) ---------------------------------
  const unitIndex = new Map<string, number>();
  units.forEach((u, i) => unitIndex.set(u.entry.id, i));
  const masks = createMask(units.length);
  units.forEach((u, i) => registry.maskOf(u.bp.categories, masks, i * 4));
  if (diags.length === 0) checkTechTree(units, factions, unitIndex, masks, exprCache, report);

  // ---- 3d. balancing gates ------------------------------------------------------------------
  if (diags.length === 0) {
    const weaponById = new Map(weapons.map((w) => [w.entry.id, w.bp]));
    const ctx: GateContext = { units: units.map((u) => u.bp), weapon: (id) => weaponById.get(id), minMapDiagonalWu: minDiagonal };
    for (const g of gates) {
      for (const f of g.check(ctx)) report(f.id, byId.get(f.id)?.source ?? '*', f.path, f.message);
    }
  }

  if (diags.length > 0) throw new BlueprintCompileError(sortDiagnostics(diags));

  // ---- 4./5./6. conversion + ids (every table is sorted by id) --------------------------------
  const weaponIndex = new Map(weapons.map((w, i) => [w.entry.id, i]));
  const projectileIndex = new Map(projectiles.map((p, i) => [p.entry.id, i]));
  const exprSources: string[] = [];
  for (const u of units) {
    for (const w of u.bp.sim.weapons ?? []) exprSources.push(...w.priorities);
    if (u.bp.sim.economy?.buildableBy !== undefined) exprSources.push(u.bp.sim.economy.buildableBy);
  }
  const exprList = [...new Set(exprSources)].sort(compareCodeUnits);
  const exprIndexOf = (src: string): number => exprList.indexOf(src);
  const exprs: SimBinExpr[] = exprList.map((src) => {
    const c = exprCache.get(src)!.compiled!;
    return { source: src, code: c.code, maxDepth: c.maxDepth };
  });

  const mounts: SimBinMount[] = [];
  const priorities: number[] = [];
  const compiled: CompiledUnit[] = [];
  for (let simId = 0; simId < units.length; simId++) {
    const { entry, bp: raw } = units[simId]!;
    const [ns, name] = [namespaceOf(raw.id), nameOf(raw.id)];
    const m = raw.sim.motion;
    const radius = m.radius ?? Math.max(m.footprint[0], m.footprint[1]) / 2;
    const bp: UnitBlueprint = {
      ...raw,
      sim: { ...raw.sim, motion: { ...m, radius } },
      view: {
        ...raw.view,
        nameKey: raw.view.nameKey ?? `unit.${ns}.${name}.name`,
        descKey: raw.view.descKey ?? `unit.${ns}.${name}.desc`,
      },
    };
    const mask = registry.maskOf(bp.categories, createMask());
    const firstMount = mounts.length;
    for (const w of bp.sim.weapons ?? []) {
      mounts.push({
        unit: simId,
        weapon: weaponIndex.get(w.ref)!,
        halfArc: Math.max(1, Math.min(32768, roundHalfUp((w.arcDeg * 65536) / 720))),
        yawRatePerTick: degPerSecondToAng16PerTick(w.yawRateDeg),
        layerMask: w.layers.reduce((acc, l) => acc | (1 << motionLayerOf(l)), 0),
        part: w.part === 'turret' ? WeaponPartId.Turret : WeaponPartId.Hull,
        priorityFirst: priorities.length,
        priorityCount: w.priorities.length,
      });
      for (const p of w.priorities) priorities.push(exprIndexOf(p));
    }
    const eco = bp.sim.economy;
    // Default hit box: the collision diameter on every axis (sim data only – never the view size).
    const hit = bp.sim.hitbox ?? [2 * radius, 2 * radius, 2 * radius];
    const sim: SimBinUnit = {
      id: bp.id,
      speedPerTick: perSecondToFxPerTick(m.speed),
      accelPerTick: perSecond2ToFxPerTick2(m.accel),
      turnRatePerTick: degPerSecondToAng16PerTick(m.turnRateDeg),
      layer: motionLayerOf(m.layer),
      sizeClass: m.sizeClass,
      maxHp: bp.sim.health.max,
      radius: Math.max(1, decimalToFx(radius)),
      vision: decimalToFx(bp.sim.intel?.vision ?? 0),
      maxSlope: decimalToFx(m.maxSlope),
      footprintW: m.footprint[0],
      footprintH: m.footprint[1],
      categories: [mask[0]!, mask[1]!, mask[2]!, mask[3]!],
      mass: m.mass ?? defaultMass(m.sizeClass),
      turnInPlace: m.turnInPlace ?? m.layer === 'land',
      brakePerTick: perSecond2ToFxPerTick2(m.brake ?? m.accel * DEFAULT_BRAKE_FACTOR),
      upgradesTo: bp.sim.upgradesTo == null ? -1 : unitIndex.get(bp.sim.upgradesTo)!,
      buildableBy: eco?.buildableBy === undefined ? -1 : exprIndexOf(eco.buildableBy),
      deathWeapon: bp.sim.deathWeapon == null ? -1 : weaponIndex.get(bp.sim.deathWeapon)!,
      veterancy: bp.sim.veterancy === 'none' ? VeterancyId.None : VeterancyId.Default,
      firstMount: mounts.length > firstMount ? firstMount : 0,
      mountCount: mounts.length - firstMount,
      buildPowerQ16PerTick: Math.floor((eco?.buildPower ?? 0) * 65536 / 10),
      buildRangeRaw: decimalToFx(eco?.buildRange ?? 5),
      massIncomeMilliPerTick: Math.floor((eco?.massIncome ?? 0) * 100),
      energyIncomeMilliPerTick: Math.floor((eco?.energyIncome ?? 0) * 100),
      massStorageMilli: Math.floor((eco?.massStorage ?? 0) * 1000),
      energyStorageMilli: Math.floor((eco?.energyStorage ?? 0) * 1000),
      massUpkeepMilliPerTick: Math.floor((eco?.massUpkeep ?? 0) * 100),
      energyUpkeepMilliPerTick: Math.floor((eco?.energyUpkeep ?? 0) * 100),
      ecoFlags: eco?.stallsOff === true ? 1 : 0,
      spotKind: eco?.spotKind === 'mass' ? 0 : eco?.spotKind === 'hydro' ? 1 : -1,
      radar: decimalToFx(bp.sim.intel?.radar ?? 0),
      massCost: eco?.mass ?? 0,
      energyCost: eco?.energy ?? 0,
      buildTime: eco?.buildTime ?? 0,
      wreckMass: decimalToFx(bp.sim.wreck?.massFraction ?? 0),
      wreckHp: decimalToFx(bp.sim.wreck?.hpFraction ?? 0),
      hitbox: [Math.max(1, decimalToFx(hit[0])), Math.max(1, decimalToFx(hit[1])), Math.max(1, decimalToFx(hit[2]))],
    };
    const ph = bp.view.placeholder;
    const tech = TECH_CATEGORIES.findIndex((t) => bp.categories.includes(t)) + 1;
    const view: ViewEntry = {
      id: bp.id,
      placeholder: {
        hull: ph.hull,
        size: ph.size,
        ...(ph.color === undefined ? {} : { color: ph.color }),
        ...(ph.turret === undefined ? {} : { turret: { hull: ph.turret.hull, size: ph.turret.size, offset: ph.turret.offset } }),
      },
      iconThreshold: bp.view.iconThreshold ?? DEFAULT_ICON_THRESHOLD,
      tech,
      categories: registry.namesOf(mask),
      selectionRadius: bp.view.selectionRadius ?? defaultSelectionRadius(radius, m.footprint),
      sizeClass: m.sizeClass,
      nameKey: bp.view.nameKey!,
      descKey: bp.view.descKey!,
      ...(bp.view.mesh === undefined ? {} : { mesh: bp.view.mesh }),
      ...(bp.view.lod === undefined ? {} : { lod: [bp.view.lod[0], bp.view.lod[1]] as const }),
      ...(bp.view.icon === undefined ? {} : { icon: bp.view.icon }),
      ...(bp.view.hotkeySlot === undefined ? {} : { hotkeySlot: bp.view.hotkeySlot }),
      ...(bp.view.fx === undefined ? {} : { fx: { ...bp.view.fx } }),
    };
    compiled.push({ simId, id: bp.id, source: entry.source, resolved: bp, sim, view });
  }
  const simWeapons: SimBinWeapon[] = weapons.map(({ bp }) => ({
    id: bp.id,
    range: decimalToFx(bp.sim.range),
    minRange: decimalToFx(bp.sim.minRange ?? 0),
    damage: bp.sim.damage,
    damageRadius: decimalToFx(bp.sim.damageRadius ?? 0),
    reloadTicks: Math.min(0xffff, secondsToTicks(bp.sim.reloadSec)),
    salvo: bp.sim.salvo,
    muzzleVelocityPerTick: perSecondToFxPerTick(bp.sim.muzzleVelocity),
    projectile: projectileIndex.get(bp.sim.projectile)!,
    salvoIntervalTicks: Math.min(0xffff, secondsToTicks(bp.sim.salvoIntervalSec ?? 0)),
    flags:(bp.sim.overcharge?1:0)|(bp.sim.damageFalloff==='quarter'?2:0)| (Math.round((bp.sim.damageInnerRadius??0)*64)<<16),
  }));
  const simProjectiles: SimBinProjectile[] = projectiles.map(({ bp }) => ({
    id: bp.id,
    kind: bp.sim.kind === 'linear' ? ProjectileKind.Linear : bp.sim.kind === 'ballistic' ? ProjectileKind.Ballistic : ProjectileKind.Homing,
    turnRatePerTick: bp.sim.turnRateDeg === undefined ? 0 : degPerSecondToAng16PerTick(bp.sim.turnRateDeg),
    speedPerTick: perSecondToFxPerTick(bp.sim.speed),
    gravityPerTick2: perSecond2ToFxPerTick2(bp.sim.gravity ?? 0),
    lifetimeTicks: secondsToTicks(bp.sim.lifetimeSec),
  }));
  const simProps: SimBinProp[] = props.map(({ bp }) => ({
    id: bp.id,
    maxHp: bp.sim.health ?? 0,
    reclaimMass: bp.sim.reclaim.mass,
    reclaimEnergy: bp.sim.reclaim.energy,
    reclaimTicks: secondsToTicks(bp.sim.reclaim.timeSec),
    footprintW: bp.sim.footprint[0],
    footprintH: bp.sim.footprint[1],
    blocksShots: bp.sim.blocksShots,
  }));
  const simFactions: SimBinFaction[] = factions.map(({ bp }) => ({
    id: bp.id,
    startUnit: unitIndex.get(bp.startUnit)!,
    units: bp.units.map((u) => unitIndex.get(u)!),
  }));

  // ---- 7. output --------------------------------------------------------------------------------
  const simBin = encodeSimBin({
    units: compiled.map((c) => c.sim),
    categoryNames: registry.names,
    weapons: simWeapons,
    projectiles: simProjectiles,
    mounts,
    priorities,
    exprs,
    props: simProps,
    factions: simFactions,
  });
  const simHash = xxHash32(simBin, 0, simBin.length, 0);
  const viewEffects: ViewEffect[] = effects.map(({ bp }) => ({
    id: bp.id,
    kind: bp.view.kind,
    color: bp.view.color,
    size: bp.view.size,
    durationSec: bp.view.durationSec,
    count: bp.view.count ?? 1,
  }));
  const view: ViewBundle = { format: VIEW_FORMAT, version: VIEW_VERSION, visuals: compiled.map((c) => c.view), effects: viewEffects };
  const viewCompact = utf8(canonicalJson(view));
  const viewHash = xxHash32(viewCompact, 0, viewCompact.length, 0);
  const entryOut = <K extends BlueprintKind>(list: readonly Emitted<K>[]): CompiledEntry<K>[] =>
    list.map((x, index) => ({ index, id: x.entry.id, source: x.entry.source, resolved: x.bp }));
  const cWeapons = entryOut(weapons);
  const cProjectiles = entryOut(projectiles);
  const cProps = entryOut(props);
  const cEffects = entryOut(effects);
  const cFactions = entryOut(factions);
  const cAi = entryOut(aiProfiles);
  const bundle = {
    format: 'faf-bundle',
    version: 2,
    simHash: hex32(simHash),
    viewHash: hex32(viewHash),
    categories: registry.names,
    exprs: exprList,
    units: compiled.map((c) => ({
      simId: c.simId,
      id: c.id,
      source: c.source,
      blueprint: c.resolved,
      simUnits: { ...c.sim, id: undefined, categories: undefined, categoryMask: c.sim.categories.map(hex32) },
    })),
    weapons: cWeapons.map((w) => ({ index: w.index, id: w.id, source: w.source, blueprint: w.resolved, simUnits: { ...simWeapons[w.index]!, id: undefined } })),
    projectiles: cProjectiles.map((p) => ({ index: p.index, id: p.id, source: p.source, blueprint: p.resolved, simUnits: { ...simProjectiles[p.index]!, id: undefined } })),
    props: cProps.map((p) => ({ index: p.index, id: p.id, source: p.source, blueprint: p.resolved, simUnits: { ...simProps[p.index]!, id: undefined } })),
    effects: cEffects.map((f) => ({ index: f.index, id: f.id, source: f.source, blueprint: f.resolved })),
    factions: cFactions.map((f) => ({ index: f.index, id: f.id, source: f.source, blueprint: f.resolved, simUnits: { ...simFactions[f.index]!, id: undefined } })),
    aiProfiles: cAi.map((a) => ({ index: a.index, id: a.id, source: a.source, blueprint: a.resolved })),
  };
  const hashes = {
    format: 'faf-hashes',
    simHash: hex32(simHash),
    viewHash: hex32(viewHash),
    units: compiled.length,
    weapons: cWeapons.length,
    projectiles: cProjectiles.length,
    props: cProps.length,
    effects: cEffects.length,
    factions: cFactions.length,
    aiProfiles: cAi.length,
    categories: registry.size,
    exprs: exprList.length,
    simBinBytes: simBin.length,
  };
  return {
    units: compiled,
    weapons: cWeapons,
    projectiles: cProjectiles,
    props: cProps,
    effects: cEffects,
    factions: cFactions,
    aiProfiles: cAi,
    categories: registry.names,
    exprs: exprList,
    simBin,
    simHash,
    view,
    viewJson: canonicalJson(view, 2) + '\n',
    viewHash,
    bundleJson: canonicalJson(bundle, 2) + '\n',
    hashesJson: canonicalJson(hashes, 2) + '\n',
  };
}

/**
 * Tech tree check (DECISIONS 23). Graph over emitted units: X requires B if B's categories match
 * X's `economy.buildableBy`, or if B `upgradesTo` X. Roots are units that cannot be built or
 * upgraded into (spawned units) and faction start units. Every unit must be reachable from a root;
 * an unreachable unit whose requirements exist is part of (or behind) a closed cycle, which is
 * reported with its path. `upgradesTo` chains must be acyclic on their own.
 */
function checkTechTree(
  units: readonly Emitted<'unit'>[],
  factions: readonly Emitted<'faction'>[],
  unitIndex: ReadonlyMap<string, number>,
  masks: Uint32Array,
  exprs: ReadonlyMap<string, { readonly compiled: CompiledCategoryExpr | null }>,
  report: (id: string, source: string, path: string, message: string) => void,
): void {
  const n = units.length;
  const requires: number[][] = units.map(() => []);
  const buildable: boolean[] = units.map((u) => u.bp.sim.economy?.buildableBy !== undefined);
  const upgradeTarget: boolean[] = new Array<boolean>(n).fill(false);
  for (let x = 0; x < n; x++) {
    const src = units[x]!.bp.sim.economy?.buildableBy;
    if (src === undefined) continue;
    const c = exprs.get(src)!.compiled!;
    for (let b = 0; b < n; b++) if (matchesMask(masks, c, b * 4)) requires[x]!.push(b);
  }
  for (let b = 0; b < n; b++) {
    const to = units[b]!.bp.sim.upgradesTo;
    if (to == null) continue;
    const x = unitIndex.get(to)!;
    upgradeTarget[x] = true;
    if (!requires[x]!.includes(b)) requires[x]!.push(b);
  }
  // upgradesTo chains: acyclic.
  const reportedUpgrade: boolean[] = new Array<boolean>(n).fill(false);
  for (let s = 0; s < n; s++) {
    const path: number[] = [];
    let cur = s;
    while (cur >= 0 && !path.includes(cur) && !reportedUpgrade[cur]) {
      path.push(cur);
      const to = units[cur]!.bp.sim.upgradesTo;
      cur = to == null ? -1 : unitIndex.get(to)!;
    }
    if (cur >= 0 && path.includes(cur) && !reportedUpgrade[cur]) {
      const cyc = path.slice(path.indexOf(cur));
      for (const c of cyc) reportedUpgrade[c] = true;
      const start = cyc.reduce((a, b) => (units[a]!.entry.id < units[b]!.entry.id ? a : b));
      const rot = [...cyc.slice(cyc.indexOf(start)), ...cyc.slice(0, cyc.indexOf(start)), start];
      const e = units[start]!.entry;
      report(e.id, e.source, '/sim/upgradesTo', `upgradesTo cycle: ${rot.map((i) => units[i]!.entry.id).join(' -> ')}`);
    }
  }
  // Reachability from the roots.
  const reach: boolean[] = new Array<boolean>(n).fill(false);
  const queue: number[] = [];
  for (let x = 0; x < n; x++) {
    if (!buildable[x] && !upgradeTarget[x]) {
      reach[x] = true;
      queue.push(x);
    }
  }
  for (const f of factions) {
    const s = unitIndex.get(f.bp.startUnit);
    if (s !== undefined && !reach[s]) {
      reach[s] = true;
      queue.push(s);
    }
  }
  const builds: number[][] = units.map(() => []);
  for (let x = 0; x < n; x++) for (const b of requires[x]!) builds[b]!.push(x);
  while (queue.length > 0) {
    const b = queue.shift()!;
    for (const x of builds[b]!) {
      if (!reach[x]) {
        reach[x] = true;
        queue.push(x);
      }
    }
  }
  const inReported: boolean[] = new Array<boolean>(n).fill(false);
  for (let x = 0; x < n; x++) {
    if (reach[x] || inReported[x]) continue;
    const e = units[x]!.entry;
    if (requires[x]!.length === 0) {
      report(e.id, e.source, '/sim/economy/buildableBy', `buildableBy '${units[x]!.bp.sim.economy!.buildableBy!}' matches no unit`);
      inReported[x] = true;
      continue;
    }
    // Follow the smallest unreachable requirement until a unit repeats: that is a closed cycle.
    const path: number[] = [];
    let cur = x;
    while (!path.includes(cur)) {
      path.push(cur);
      const next = requires[cur]!.filter((b) => !reach[b]).sort((a, b) => a - b)[0];
      if (next === undefined) break;
      cur = next;
    }
    const cyc = path.slice(path.indexOf(cur));
    if (cyc.some((c) => inReported[c])) {
      inReported[x] = true;
      continue;
    }
    for (const c of cyc) inReported[c] = true;
    const start = cyc.reduce((a, b) => (units[a]!.entry.id < units[b]!.entry.id ? a : b));
    const rot = [...cyc.slice(cyc.indexOf(start)), ...cyc.slice(0, cyc.indexOf(start)), start];
    const s = units[start]!.entry;
    const where = units[start]!.bp.sim.economy?.buildableBy !== undefined ? '/sim/economy/buildableBy' : '/sim/upgradesTo';
    report(
      s.id,
      s.source,
      where,
      `tech tree cycle: ${rot.map((i) => units[i]!.entry.id).join(' -> ')} (each unit is only buildable/upgradable from the next one; no unit outside the cycle can build it)`,
    );
    inReported[x] = true;
  }
}

// ---- file-system-free entry point (CLI, Vite HMR) ------------------------------------------------

/** A loaded content module: its repo-relative path and its exports (module namespace or default export). */
export interface BlueprintModule {
  readonly source: string;
  readonly exports: unknown;
}

/** Hashes of a successful compilation. */
export interface CompileHashes {
  readonly simHash: number;
  readonly viewHash: number;
}

export type ModuleCompileResult =
  | {
      readonly ok: true;
      readonly simBin: Uint8Array;
      readonly viewJson: string;
      readonly bundleJson: string;
      readonly hashesJson: string;
      readonly hashes: CompileHashes;
      readonly diagnostics: readonly BlueprintDiagnostic[];
      /** Full result (tables, resolved blueprints). */
      readonly result: CompileResult;
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly BlueprintDiagnostic[];
    };

/** Options of compileBlueprintModules (locales come as a separate argument). */
export type ModuleCompileOptions = Omit<CompileOptions, 'locales'>;

/**
 * Compiles content modules without touching the file system (the Vite HMR plugin passes
 * `server.ssrLoadModule` results, the CLI dynamic imports). Modules are ordered by `source`
 * (code units), each module's `default` export (or the value itself) must be a definition or an
 * array of definitions. `locales` are the parsed de/en tables. Never throws for content errors:
 * `ok: false` carries the diagnostics. Compiling the same input twice gives identical bytes.
 */
export function compileBlueprintModules(
  modules: readonly BlueprintModule[],
  locales: { readonly de: unknown; readonly en: unknown },
  opts: ModuleCompileOptions = {},
): ModuleCompileResult {
  const diags: BlueprintDiagnostic[] = [];
  const tables: Record<string, Readonly<Record<string, string>>> = {};
  for (const lang of LOCALE_LANGS) {
    const { table, issues } = validateLocaleTable(locales[lang]);
    for (const i of issues) diags.push({ id: `locale:${lang}`, source: localeSource(lang), path: i.path, message: i.message });
    if (table !== null) tables[lang] = table;
  }
  const sorted = [...modules].sort((a, b) => compareCodeUnits(a.source, b.source));
  const defs: SourcedDefinition[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const m = sorted[i]!;
    if (i > 0 && sorted[i - 1]!.source === m.source) {
      diags.push({ id: '?', source: m.source, path: '', message: 'module listed twice' });
      continue;
    }
    const exp = isPlainObject(m.exports) && 'default' in m.exports ? m.exports.default : m.exports;
    const list = Array.isArray(exp) ? exp : [exp];
    if (list.length === 0) {
      diags.push({ id: '?', source: m.source, path: '', message: 'default export is an empty array' });
      continue;
    }
    list.forEach((d, k) => {
      if (isBlueprintDefinition(d)) defs.push({ def: d, source: m.source });
      else {
        diags.push({
          id: '?',
          source: m.source,
          path: Array.isArray(exp) ? `/${k}` : '',
          message: `default export must be a define*(...) result or an array of them (kinds: ${BLUEPRINT_KINDS.join(', ')}, patch)`,
        });
      }
    });
  }
  if (diags.length > 0) return { ok: false, diagnostics: sortDiagnostics(diags) };
  try {
    const result = compileBlueprints(defs, { ...opts, locales: { de: tables.de!, en: tables.en! } });
    return {
      ok: true,
      simBin: result.simBin,
      viewJson: result.viewJson,
      bundleJson: result.bundleJson,
      hashesJson: result.hashesJson,
      hashes: { simHash: result.simHash, viewHash: result.viewHash },
      diagnostics: [],
      result,
    };
  } catch (e) {
    if (e instanceof BlueprintCompileError) return { ok: false, diagnostics: e.diagnostics };
    throw e;
  }
}

/** Human-readable multi-line form of diagnostics (CLI, HUD). */
export function formatDiagnostics(diagnostics: readonly BlueprintDiagnostic[]): string {
  return diagnostics.map(formatDiagnostic).join('\n');
}
