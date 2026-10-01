/**
 * AiBlueprintTable from docs/design/roster.json (schema faf-roster/1), the single source of unit
 * numbers. Adapter boundary: from MS9 the table comes from @faf/blueprints (BlueprintViewTable);
 * the AiBlueprint shape stays.
 *
 * DPS rules (ai.md §5.5/§5.6, ecosim.py load_roster): weapons whose notes say
 * "Nicht in DPS/Mass gewertet" (the commander's overcharge) are excluded; a weapon counts for the
 * surface threat if its layers contain 'land', for the air threat if they contain 'air'. HP_eff =
 * health.max + shield.hp.
 */
import {
  CategoryRegistry,
  categoryExprNames,
  compileCategoryExpr,
  createMask,
  matchesMask,
  parseCategoryExpr,
  type CompiledCategoryExpr,
} from '@faf/rules';
import { compareStrings } from '../det.ts';
import type { AiBlueprint, AiBlueprintTable, AiMotionLayer } from '../types.ts';

/** Marker of weapons that do not count into DPS (roster notes). */
export const NOT_IN_DPS_MARKER = 'Nicht in DPS/Mass gewertet';

const LAYERS: readonly AiMotionLayer[] = ['land', 'air', 'water', 'seabed', 'hover', 'amphibious'];

type Obj = Record<string, unknown>;

function fail(path: string, msg: string): never {
  throw new Error(`roster: ${path}: ${msg}`);
}

function obj(v: unknown, path: string): Obj {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) fail(path, 'expected an object');
  return v as Obj;
}

function arr(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) fail(path, 'expected an array');
  return v;
}

function str(v: unknown, path: string): string {
  if (typeof v !== 'string' || v.length === 0) fail(path, 'expected a non-empty string');
  return v;
}

function num(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(path, 'expected a finite number');
  return v;
}

function optNum(v: unknown, path: string): number {
  if (v === undefined || v === null) return 0;
  return num(v, path);
}

interface RawUnit {
  id: string;
  name: string;
  tech: number;
  categories: string[];
  buildableBy: string | null;
  economy: Obj;
  hp: number;
  shieldHp: number;
  weapons: { dps: number; range: number; rangeMin: number; splash: number; land: boolean; air: boolean }[];
  speed: number;
  footprint: [number, number];
  isStructure: boolean;
  layer: AiMotionLayer;
  vision: number;
  radar: number;
  upgradesTo: string | null;
  upgradeFrom: string | null;
  msFirst: string;
}

function readUnit(v: unknown, i: number): RawUnit {
  const p = `units[${i}]`;
  const u = obj(v, p);
  const id = str(u.id, `${p}.id`);
  const nameObj = obj(u.name, `${p}.name`);
  const name = str(nameObj.de, `${p}.name.de`);
  const tech = num(u.tech, `${p}.tech`);
  if (!Number.isInteger(tech) || tech < 0 || tech > 4) fail(`${p}.tech`, `bad tech ${tech}`);
  const categories = arr(u.categories, `${p}.categories`).map((c, j) => str(c, `${p}.categories[${j}]`));
  const bb = u.buildableBy;
  const buildableBy = bb === null || bb === undefined ? null : str(bb, `${p}.buildableBy`);
  const economy = obj(u.economy, `${p}.economy`);
  const health = obj(u.health, `${p}.health`);
  const hp = num(health.max, `${p}.health.max`);
  const shield = u.shield === null || u.shield === undefined ? null : obj(u.shield, `${p}.shield`);
  const shieldHp = shield === null ? 0 : optNum(shield.hp, `${p}.shield.hp`);
  const weapons: RawUnit['weapons'] = [];
  const ws = u.weapons === null || u.weapons === undefined ? [] : arr(u.weapons, `${p}.weapons`);
  for (let j = 0; j < ws.length; j++) {
    const wp = `${p}.weapons[${j}]`;
    const w = obj(ws[j], wp);
    const notes = typeof w.notes === 'string' ? w.notes : '';
    if (notes.includes(NOT_IN_DPS_MARKER)) continue;
    const layers = arr(w.layers, `${wp}.layers`).map((l, k) => str(l, `${wp}.layers[${k}]`));
    weapons.push({
      dps: num(w.dps, `${wp}.dps`),
      range: num(w.range, `${wp}.range`),
      rangeMin: optNum(w.rangeMin, `${wp}.rangeMin`),
      splash: optNum(w.splash, `${wp}.splash`),
      land: layers.includes('land'),
      air: layers.includes('air'),
    });
  }
  const motion = u.motion === null || u.motion === undefined ? null : obj(u.motion, `${p}.motion`);
  let footprint: [number, number] = [1, 1];
  let layer: AiMotionLayer = 'land';
  let speed = 0;
  let isStructure = categories.includes('STRUCTURE');
  if (motion !== null) {
    if (motion.footprint !== undefined) {
      const fp = arr(motion.footprint, `${p}.motion.footprint`);
      if (fp.length !== 2) fail(`${p}.motion.footprint`, 'expected [w, d]');
      footprint = [num(fp[0], `${p}.motion.footprint[0]`), num(fp[1], `${p}.motion.footprint[1]`)];
    }
    if (motion.layer !== undefined) {
      const l = str(motion.layer, `${p}.motion.layer`);
      if (!(LAYERS as readonly string[]).includes(l)) fail(`${p}.motion.layer`, `unknown layer '${l}'`);
      layer = l as AiMotionLayer;
    }
    speed = optNum(motion.speed, `${p}.motion.speed`);
    if (motion.structure === true) isStructure = true;
  }
  const intel = u.intel === null || u.intel === undefined ? {} : obj(u.intel, `${p}.intel`);
  const special = u.special === null || u.special === undefined ? {} : obj(u.special, `${p}.special`);
  const up = special.upgradesTo;
  const from = special.upgradeFrom;
  return {
    id,
    name,
    tech,
    categories,
    buildableBy,
    economy,
    hp,
    shieldHp,
    weapons,
    speed,
    footprint,
    isStructure,
    layer,
    vision: optNum(intel.vision, `${p}.intel.vision`),
    radar: optNum(intel.radar, `${p}.intel.radar`),
    upgradesTo: up === null || up === undefined ? null : str(up, `${p}.special.upgradesTo`),
    upgradeFrom: from === null || from === undefined ? null : str(from, `${p}.special.upgradeFrom`),
    msFirst: typeof u.msFirst === 'string' ? u.msFirst : '',
  };
}

export class RosterTable implements AiBlueprintTable {
  readonly list: readonly AiBlueprint[];
  readonly registry: CategoryRegistry;
  private readonly ids: readonly string[];
  private readonly compiled = new Map<string, CompiledCategoryExpr>();

  constructor(list: AiBlueprint[], registry: CategoryRegistry) {
    this.list = list;
    this.registry = registry;
    this.ids = list.map((b) => b.id);
  }

  byId(id: string): AiBlueprint | undefined {
    const ids = this.ids;
    let lo = 0;
    let hi = ids.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const c = compareStrings(ids[mid]!, id);
      if (c === 0) return this.list[mid];
      if (c < 0) lo = mid + 1;
      else hi = mid - 1;
    }
    return undefined;
  }

  canBuild(builder: AiBlueprint, target: AiBlueprint): boolean {
    const e = target.buildableBy;
    return e !== null && matchesMask(builder.categories, e, 0);
  }

  matches(bp: AiBlueprint, expr: CompiledCategoryExpr): boolean {
    return matchesMask(bp.categories, expr, 0);
  }

  compile(source: string): CompiledCategoryExpr {
    let c = this.compiled.get(source);
    if (c === undefined) {
      c = compileCategoryExpr(source, this.registry);
      this.compiled.set(source, c);
    }
    return c;
  }
}

/**
 * Builds the AI blueprint table from the parsed roster JSON (validating). The category registry
 * contains every category of any unit plus every name used in a `buildableBy` expression (e.g. the
 * pseudo category UPGRADE) and in `extraCategoryNames` (e.g. names used by AI role expressions).
 */
export function bpTableFromRoster(json: unknown, extraCategoryNames: readonly string[] = []): AiBlueprintTable {
  const root = obj(json, '$');
  if (root.schema !== 'faf-roster/1') fail('$.schema', `expected 'faf-roster/1', got ${String(root.schema)}`);
  const units = arr(root.units, '$.units').map(readUnit);
  units.sort((a, b) => compareStrings(a.id, b.id));
  for (let i = 1; i < units.length; i++) {
    if (units[i]!.id === units[i - 1]!.id) fail('$.units', `duplicate id '${units[i]!.id}'`);
  }
  const names: string[] = [...extraCategoryNames];
  for (const u of units) {
    for (const c of u.categories) names.push(c);
    if (u.buildableBy !== null) categoryExprNames(parseCategoryExpr(u.buildableBy), names);
  }
  const registry = new CategoryRegistry(names);
  const indexOf = (id: string | null, path: string): number => {
    if (id === null) return -1;
    let lo = 0;
    let hi = units.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const c = compareStrings(units[mid]!.id, id);
      if (c === 0) return mid;
      if (c < 0) lo = mid + 1;
      else hi = mid - 1;
    }
    return fail(path, `unknown blueprint '${id}'`);
  };
  const list: AiBlueprint[] = units.map((u, index) => {
    let dpsSurface = 0;
    let dpsAir = 0;
    let rangeMax = 0;
    let rangeMin = Infinity;
    let splash = 0;
    for (const w of u.weapons) {
      if (w.land) dpsSurface += w.dps;
      if (w.air) dpsAir += w.dps;
      if (w.range > rangeMax) rangeMax = w.range;
      if (w.rangeMin < rangeMin) rangeMin = w.rangeMin;
      if (w.splash > splash) splash = w.splash;
    }
    if (rangeMin === Infinity) rangeMin = 0;
    const hpEff = u.hp + u.shieldHp;
    const e = u.economy;
    const p = `units['${u.id}'].economy`;
    const bp: AiBlueprint = {
      index,
      id: u.id,
      name: u.name,
      tech: u.tech,
      categories: registry.maskOf(u.categories, createMask()),
      categoryNames: [...u.categories],
      mass: optNum(e.mass, `${p}.mass`),
      energy: optNum(e.energy, `${p}.energy`),
      buildTime: optNum(e.buildTime, `${p}.buildTime`),
      buildPower: optNum(e.buildPower, `${p}.buildPower`),
      massPerSec: optNum(e.massPerSec, `${p}.massPerSec`),
      energyPerSec: optNum(e.energyPerSec, `${p}.energyPerSec`),
      upkeepEnergyPerSec: optNum(e.upkeepEnergyPerSec, `${p}.upkeepEnergyPerSec`),
      storageMass: optNum(e.storageMass, `${p}.storageMass`),
      storageEnergy: optNum(e.storageEnergy, `${p}.storageEnergy`),
      hp: u.hp,
      shieldHp: u.shieldHp,
      hpEff,
      speed: u.speed,
      footprint: u.footprint,
      isStructure: u.isStructure,
      layer: u.layer,
      vision: u.vision,
      radar: u.radar,
      dpsSurface,
      dpsAir,
      threatSurface: Math.sqrt(dpsSurface * hpEff),
      threatAir: Math.sqrt(dpsAir * hpEff),
      rangeMax,
      rangeMin,
      splash,
      upgradesTo: indexOf(u.upgradesTo, `units['${u.id}'].special.upgradesTo`),
      upgradeFrom: indexOf(u.upgradeFrom, `units['${u.id}'].special.upgradeFrom`),
      buildableBy: u.buildableBy === null ? null : compileCategoryExpr(u.buildableBy, registry),
      msFirst: u.msFirst,
    };
    return bp;
  });
  return new RosterTable(list, registry);
}
