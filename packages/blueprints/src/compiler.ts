/**
 * Blueprint compiler (PLAN §3.9, steps 1–7):
 *   1. merge patches            → definePatch() applied to their target (source order)
 *   2. extends                  → parent first, merged with merge.ts semantics, cycle check
 *   3. validation               → TypeBox (JSON paths) + semantics (references, layers, namespaces)
 *   4. categories → masks       → @faf/rules CategoryRegistry over all emitted units
 *   5. unit conversion          → exactly once, here (per second → per tick, ° → Ang16, decimal → Fx)
 *   6. ids                      → u16 sim id = index in the code-unit-sorted string ids
 *   7. output                   → sim.bin + simHash, view.json + viewHash, bundle.json, hashes.json
 *
 * Abstract blueprints are never emitted. The `test:` namespace is only emitted with
 * `includeTest` (unit tests); game bundles never contain it.
 *
 * Floats are allowed here (and only here): the compiled integers are checked in, so the sim never
 * depends on engine float behavior. Rounding rule: round half up of the Float64 result.
 */
import { FX_ONE, xxHash32 } from '@faf/fixed';
import { CategoryRegistry, compareCodeUnits, createMask, motionLayerOf, MVP_MOTION_LAYERS, SIM_TICK_HZ } from '@faf/rules';
import type { TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { canonicalJson, hex32, utf8 } from './canonical.ts';
import type { BlueprintDefinition, UnitBlueprint } from './define.ts';
import { deepClone, isPlainObject, mergePatch } from './merge.ts';
import { AbstractUnitSchema, BLUEPRINT_ID_PATTERN, UnitSchema } from './schema.ts';
import { encodeSimBin, SIM_BIN_MAX_UNITS, type SimBinUnit } from './simbin.ts';
import { VIEW_FORMAT, VIEW_VERSION, type ViewBundle, type ViewEntry } from './view.ts';

/** A definition together with the file it came from (used for messages and ordering). */
export interface SourcedDefinition {
  readonly def: BlueprintDefinition;
  /** Repo-relative source path, e.g. `content/blueprints/core/units/cube.ts`. */
  readonly source: string;
}

export interface CompileOptions {
  /** Emit `test:` blueprints (unit tests only). Default false. */
  readonly includeTest?: boolean;
}

/** One compiler finding. `path` is a JSON pointer into the (resolved) blueprint. */
export interface BlueprintDiagnostic {
  readonly id: string;
  readonly source: string;
  readonly path: string;
  readonly message: string;
}

export class BlueprintCompileError extends Error {
  readonly diagnostics: readonly BlueprintDiagnostic[];

  constructor(diagnostics: readonly BlueprintDiagnostic[]) {
    super(
      `blueprint compilation failed with ${diagnostics.length} error(s):\n` +
        diagnostics.map((d) => `  ${d.source} ${d.id}${d.path}: ${d.message}`).join('\n'),
    );
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

export interface CompileResult {
  readonly units: readonly CompiledUnit[];
  /** Category names in bit order. */
  readonly categories: readonly string[];
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

/** Decimal → Fx raw (round half up). */
export function decimalToFx(v: number): number {
  return roundHalfUp(v * FX_ONE);
}

const ID_RE = new RegExp(BLUEPRINT_ID_PATTERN);

interface UnitEntry {
  readonly id: string;
  readonly source: string;
  data: Record<string, unknown>;
}

function schemaErrors(schema: TSchema, value: unknown): { path: string; message: string }[] {
  const out: { path: string; message: string }[] = [];
  const seen = new Set<string>();
  for (const e of Value.Errors(schema, value)) {
    const key = `${e.path}\u0000${e.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ path: e.path, message: e.message });
  }
  return out;
}

/** Compiles blueprint definitions (see module docs). Throws BlueprintCompileError on any error. */
export function compileBlueprints(defs: readonly SourcedDefinition[], options: CompileOptions = {}): CompileResult {
  const includeTest = options.includeTest === true;
  const diags: BlueprintDiagnostic[] = [];
  const report = (id: string, source: string, path: string, message: string): void => {
    diags.push({ id, source, path, message });
  };
  const included = (id: string): boolean => includeTest || namespaceOf(id) !== NAMESPACE_TEST;

  // ---- collect ------------------------------------------------------------------------------
  const units: UnitEntry[] = [];
  const byId = new Map<string, UnitEntry>();
  for (const { def, source } of defs) {
    if (def.kind !== 'unit') continue;
    const data = def.data as unknown;
    if (!isPlainObject(data)) {
      report('?', source, '', 'unit definition must be an object');
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
    const e: UnitEntry = { id, source, data: deepClone(data) };
    byId.set(id, e);
    units.push(e);
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
  units.sort((a, b) => compareCodeUnits(a.id, b.id));
  const resolved = new Map<string, Record<string, unknown> | null>();
  const resolve = (e: UnitEntry, chain: string[]): Record<string, unknown> | null => {
    const done = resolved.get(e.id);
    if (done !== undefined) return done;
    const parentId = e.data.extends;
    let result: Record<string, unknown> | null;
    if (parentId === undefined) {
      result = e.data;
    } else if (typeof parentId !== 'string') {
      report(e.id, e.source, '/extends', 'extends must be a blueprint id string');
      result = null;
    } else {
      const parent = byId.get(parentId);
      if (parent === undefined) {
        report(e.id, e.source, '/extends', `extends unknown blueprint '${parentId}'`);
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
  for (const e of units) resolve(e, [e.id]);

  // ---- 3. validation + semantics --------------------------------------------------------------
  const emitted: { entry: UnitEntry; bp: UnitBlueprint }[] = [];
  for (const e of units) {
    const r = resolved.get(e.id);
    if (r === null || r === undefined) continue;
    const isAbstract = r.abstract === true;
    const errs = schemaErrors(isAbstract ? AbstractUnitSchema : UnitSchema, r);
    for (const err of errs) report(e.id, e.source, err.path, err.message);
    if (errs.length > 0 || isAbstract) continue;
    const bp = r as unknown as UnitBlueprint;
    const layer = bp.sim.motion.layer;
    if (!MVP_MOTION_LAYERS.includes(layer)) {
      report(e.id, e.source, '/sim/motion/layer', `layer '${layer}' is not active in the MVP (allowed: ${MVP_MOTION_LAYERS.join(', ')})`);
      continue;
    }
    const lod = bp.view.lod;
    if (lod !== undefined && !(lod[0] < lod[1])) {
      report(e.id, e.source, '/view/lod', `LOD distances must increase (got [${lod[0]}, ${lod[1]}])`);
      continue;
    }
    if (!included(e.id)) continue;
    emitted.push({ entry: e, bp });
  }
  if (emitted.length > SIM_BIN_MAX_UNITS) {
    report('*', '*', '', `too many unit blueprints (${emitted.length} > ${SIM_BIN_MAX_UNITS})`);
  }
  if (diags.length > 0) {
    diags.sort((a, b) => compareCodeUnits(a.id, b.id) || compareCodeUnits(a.path, b.path) || compareCodeUnits(a.message, b.message));
    throw new BlueprintCompileError(diags);
  }

  // ---- 4. categories → masks ------------------------------------------------------------------
  const allCats: string[] = [];
  for (const { bp } of emitted) allCats.push(...bp.categories);
  const registry = new CategoryRegistry(allCats);

  // ---- 5./6. conversion + ids (emitted is sorted by id) ---------------------------------------
  const compiled: CompiledUnit[] = [];
  for (let simId = 0; simId < emitted.length; simId++) {
    const { entry, bp: raw } = emitted[simId]!;
    const [ns, name] = [namespaceOf(raw.id), raw.id.slice(raw.id.indexOf(':') + 1)];
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
    };
    const ph = bp.view.placeholder;
    const view: ViewEntry = {
      id: bp.id,
      placeholder: ph.color === undefined ? { hull: ph.hull, size: ph.size } : { hull: ph.hull, size: ph.size, color: ph.color },
      nameKey: bp.view.nameKey!,
      descKey: bp.view.descKey!,
      ...(bp.view.mesh === undefined ? {} : { mesh: bp.view.mesh }),
      ...(bp.view.lod === undefined ? {} : { lod: [bp.view.lod[0], bp.view.lod[1]] as const }),
      ...(bp.view.icon === undefined ? {} : { icon: bp.view.icon }),
      ...(bp.view.iconThreshold === undefined ? {} : { iconThreshold: bp.view.iconThreshold }),
    };
    compiled.push({ simId, id: bp.id, source: entry.source, resolved: bp, sim, view });
  }

  // ---- 7. output --------------------------------------------------------------------------------
  const simBin = encodeSimBin(
    compiled.map((c) => c.sim),
    registry.names,
  );
  const simHash = xxHash32(simBin, 0, simBin.length, 0);
  const view: ViewBundle = { format: VIEW_FORMAT, version: VIEW_VERSION, visuals: compiled.map((c) => c.view) };
  const viewCompact = utf8(canonicalJson(view));
  const viewHash = xxHash32(viewCompact, 0, viewCompact.length, 0);
  const bundle = {
    format: 'faf-bundle',
    version: 1,
    simHash: hex32(simHash),
    viewHash: hex32(viewHash),
    categories: registry.names,
    units: compiled.map((c) => ({
      simId: c.simId,
      id: c.id,
      source: c.source,
      blueprint: c.resolved,
      simUnits: {
        speedPerTick: c.sim.speedPerTick,
        accelPerTick: c.sim.accelPerTick,
        turnRatePerTick: c.sim.turnRatePerTick,
        layer: c.sim.layer,
        maxHp: c.sim.maxHp,
        radius: c.sim.radius,
        vision: c.sim.vision,
        maxSlope: c.sim.maxSlope,
        categoryMask: c.sim.categories.map(hex32),
      },
    })),
  };
  const hashes = {
    format: 'faf-hashes',
    simHash: hex32(simHash),
    viewHash: hex32(viewHash),
    units: compiled.length,
    categories: registry.size,
    simBinBytes: simBin.length,
  };
  return {
    units: compiled,
    categories: registry.names,
    simBin,
    simHash,
    view,
    viewJson: canonicalJson(view, 2) + '\n',
    viewHash,
    bundleJson: canonicalJson(bundle, 2) + '\n',
    hashesJson: canonicalJson(hashes, 2) + '\n',
  };
}
