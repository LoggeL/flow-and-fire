/**
 * Openings as data: schema `faf-ai-openings/1` (docs/design/ai-openings.json, ai.md §4.1).
 * Strict parser (unknown `do`, unknown keys or missing fields throw), role resolution
 * (ai.md §1 Leitplanke 2) and weighted opening selection (ai.md §4.4).
 */
import type { CompiledCategoryExpr } from '@faf/rules';
import type { Xorshift32 } from './rng.ts';
import type { AiBlueprint, AiBlueprintTable, MapClass } from './types.ts';

export const OPENINGS_SCHEMA = 'faf-ai-openings/1';

export type Difficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];

/** Site selectors of ai.md §4.2. */
export type SiteSelector = string;

export interface BuildStep {
  readonly do: 'build';
  readonly role: string;
  readonly tech: number;
  readonly at: SiteSelector;
  readonly count: number;
  readonly fallback: FallbackStep | null;
}

export interface FallbackStep {
  readonly role: string;
  readonly tech: number;
  readonly at: SiteSelector;
  readonly count: number;
}

export interface ProduceStep {
  readonly do: 'produce';
  readonly role: string;
  readonly tech: number;
  readonly count: number;
}

export interface LoopItem {
  readonly role: string;
  readonly tech: number;
}

export interface LoopStep {
  readonly do: 'loop';
  readonly items: readonly LoopItem[];
}

export interface RallyStep {
  readonly do: 'rally';
  readonly at: SiteSelector;
}

export interface AssistStep {
  readonly do: 'assist';
  readonly target: string;
}

export type OpeningStep = BuildStep | ProduceStep | LoopStep | RallyStep | AssistStep;

export interface EngineerFollowUp {
  readonly base: number;
  readonly perFreeSpots: number;
  /** [tSeconds, n] ascending. */
  readonly cap: readonly (readonly [number, number])[];
}

export interface FollowUp {
  readonly engineers: EngineerFollowUp;
  readonly estore: { readonly atS: number };
  readonly energy: { readonly horizonS: number; readonly reserveE: number; readonly maxInflight: number };
  readonly extraFactory: {
    readonly role: string;
    readonly slots: readonly string[];
    readonly massStoreFrac: number;
    readonly forS: number;
    readonly minS: number;
  };
  readonly techT2: {
    readonly minS: number;
    readonly minMassIncome: number;
    readonly minEnergySurplus: number;
    readonly assistEngineers: number;
    readonly acuAssist: boolean;
    /** T2 engineers after Landwerk II (ai.md §5.2, default 2). */
    readonly t2Engineers: number;
  };
  readonly mexUpgrade: {
    readonly minS: number;
    readonly minMassIncome: number;
    readonly saturatedS: number;
    readonly maxParallel: number;
    readonly assistEngineers: number;
    readonly order: string;
  };
  readonly waves: { readonly first: number; readonly grow: number; readonly maxS: number; readonly airFirst: number | null };
}

/** Expected metrics of ecosim.py (per map); kept loosely typed (numbers and number maps). */
export type ExpectBlock = Readonly<Record<string, number | Readonly<Record<string, number>>>>;

export interface Opening {
  readonly id: string;
  readonly name: { readonly de: string; readonly en: string };
  readonly fromMs: string;
  /** Numeric milestone of `fromMs` (MS9 → 9). */
  readonly fromMsNumber: number;
  readonly intent: string;
  readonly weights: {
    readonly maps: Readonly<Record<string, number>>;
    readonly difficulty: Readonly<Record<Difficulty, number>>;
  };
  readonly acu: readonly OpeningStep[];
  readonly factories: Readonly<Record<string, readonly OpeningStep[]>>;
  /** Factory slot names in document order. */
  readonly factoryOrder: readonly string[];
  readonly engineers: readonly (readonly OpeningStep[])[];
  readonly followUp: FollowUp;
  readonly expect: Readonly<Record<string, ExpectBlock>>;
}

export interface DifficultyTiming {
  readonly stepDelayS: number;
  readonly skipChance: number;
  readonly techDelayS: number;
  readonly engineerCapFactor: number;
  readonly waveExtra: number;
}

export interface BaseSlot {
  readonly f: number;
  readonly s: number;
  readonly footprint: number;
}

export interface OpeningsAssumptions {
  readonly startStorage: string;
  readonly warpInS: number;
  /** Category expression → build range in WU. */
  readonly buildRangeWu: Readonly<Record<string, number>>;
  readonly rollOffS: number;
  readonly passability: { readonly maxSlope: number; readonly maxWaterDepthWu: number; readonly gridWu: number };
  readonly straightLineDetour: number;
  readonly platoonSpeedFactor: number;
}

export interface OpeningsDoc {
  readonly schema: typeof OPENINGS_SCHEMA;
  readonly faction: string;
  readonly language: string;
  readonly assumptions: OpeningsAssumptions;
  /** role → category expression. */
  readonly roles: Readonly<Record<string, string>>;
  /** Role names in document order. */
  readonly roleNames: readonly string[];
  readonly sites: Readonly<Record<string, string>>;
  readonly baseTemplate: { readonly slots: Readonly<Record<string, BaseSlot>>; readonly slotNames: readonly string[] };
  readonly difficultyTiming: Readonly<Record<Difficulty, DifficultyTiming>>;
  readonly openings: readonly Opening[];
}

// ---- strict JSON reading ------------------------------------------------------------------------

type Obj = Record<string, unknown>;

function fail(path: string, msg: string): never {
  throw new Error(`openings: ${path}: ${msg}`);
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

function int(v: unknown, path: string, min: number): number {
  const n = num(v, path);
  if (!Number.isInteger(n) || n < min) fail(path, `expected an integer ≥ ${min}`);
  return n;
}

function bool(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') fail(path, 'expected a boolean');
  return v;
}

/** Rejects keys outside `allowed` (`note` is always allowed as documentation). */
function keys(o: Obj, path: string, allowed: readonly string[]): void {
  for (const k of Object.keys(o)) {
    if (k !== 'note' && !allowed.includes(k)) fail(path, `unknown key '${k}'`);
  }
}

function numRecord(v: unknown, path: string): Record<string, number> {
  const o = obj(v, path);
  const out: Record<string, number> = {};
  for (const k of Object.keys(o)) {
    if (k === 'note') continue;
    out[k] = num(o[k], `${path}.${k}`);
  }
  return out;
}

function strRecord(v: unknown, path: string): { rec: Record<string, string>; order: string[] } {
  const o = obj(v, path);
  const rec: Record<string, string> = {};
  const order: string[] = [];
  for (const k of Object.keys(o)) {
    if (k === 'note') continue;
    rec[k] = str(o[k], `${path}.${k}`);
    order.push(k);
  }
  return { rec, order };
}

const FIXED_SELECTORS = ['ring', 'mex:next', 'hydro:next', 'kranz'];

/** Validates a site selector against ai.md §4.2 and the base template. */
function checkSelector(at: string, path: string, slotNames: readonly string[]): string {
  if (FIXED_SELECTORS.includes(at)) return at;
  if (at.startsWith('slot:')) {
    const name = at.slice(5);
    if (slotNames.includes(name)) return at;
    if (/^fac[0-9]+$/.test(name)) return at; // further factory slots are generated (ai.md §4.2)
    fail(path, `unknown slot '${name}'`);
  }
  if (at.startsWith('near:')) {
    const name = at.slice(5);
    if (slotNames.includes(name)) return at;
    fail(path, `near: references unknown slot '${name}'`);
  }
  return fail(path, `unknown site selector '${at}'`);
}

function roleRef(v: unknown, path: string, roles: Readonly<Record<string, string>>): string {
  const r = str(v, path);
  if (!Object.prototype.hasOwnProperty.call(roles, r)) fail(path, `unknown role '${r}'`);
  return r;
}

function techOf(v: unknown, path: string): number {
  const t = int(v, path, 1);
  if (t > 4) fail(path, `tech ${t} out of range`);
  return t;
}

function parseStep(v: unknown, path: string, roles: Readonly<Record<string, string>>, slots: readonly string[]): OpeningStep {
  const o = obj(v, path);
  const d = str(o.do, `${path}.do`);
  switch (d) {
    case 'build': {
      keys(o, path, ['do', 'role', 'tech', 'at', 'count', 'fallback']);
      let fallback: FallbackStep | null = null;
      if (o.fallback !== undefined) {
        const fp = `${path}.fallback`;
        const f = obj(o.fallback, fp);
        keys(f, fp, ['role', 'tech', 'at', 'count', 'do']);
        if (f.do !== undefined && f.do !== 'build') fail(`${fp}.do`, 'fallback must be a build step');
        fallback = {
          role: roleRef(f.role, `${fp}.role`, roles),
          tech: techOf(f.tech, `${fp}.tech`),
          at: checkSelector(str(f.at, `${fp}.at`), `${fp}.at`, slots),
          count: f.count === undefined ? 1 : int(f.count, `${fp}.count`, 1),
        };
      }
      return {
        do: 'build',
        role: roleRef(o.role, `${path}.role`, roles),
        tech: techOf(o.tech, `${path}.tech`),
        at: checkSelector(str(o.at, `${path}.at`), `${path}.at`, slots),
        count: o.count === undefined ? 1 : int(o.count, `${path}.count`, 1),
        fallback,
      };
    }
    case 'produce':
      keys(o, path, ['do', 'role', 'tech', 'count']);
      return {
        do: 'produce',
        role: roleRef(o.role, `${path}.role`, roles),
        tech: techOf(o.tech, `${path}.tech`),
        count: o.count === undefined ? 1 : int(o.count, `${path}.count`, 1),
      };
    case 'loop': {
      keys(o, path, ['do', 'items']);
      const items = arr(o.items, `${path}.items`).map((it, i) => {
        const ip = `${path}.items[${i}]`;
        const io = obj(it, ip);
        keys(io, ip, ['role', 'tech']);
        return { role: roleRef(io.role, `${ip}.role`, roles), tech: techOf(io.tech, `${ip}.tech`) };
      });
      if (items.length === 0) fail(`${path}.items`, 'loop needs at least one item');
      return { do: 'loop', items };
    }
    case 'rally':
      keys(o, path, ['do', 'at']);
      return { do: 'rally', at: checkSelector(str(o.at, `${path}.at`), `${path}.at`, slots) };
    case 'assist':
      keys(o, path, ['do', 'target']);
      return { do: 'assist', target: str(o.target, `${path}.target`) };
    default:
      return fail(`${path}.do`, `unknown step '${d}'`);
  }
}

function parseFollowUp(v: unknown, path: string, roles: Readonly<Record<string, string>>): FollowUp {
  const o = obj(v, path);
  keys(o, path, ['engineers', 'estore', 'energy', 'extraFactory', 'techT2', 'mexUpgrade', 'waves']);
  const e = obj(o.engineers, `${path}.engineers`);
  keys(e, `${path}.engineers`, ['base', 'perFreeSpots', 'cap']);
  const cap = arr(e.cap, `${path}.engineers.cap`).map((c, i) => {
    const cp = `${path}.engineers.cap[${i}]`;
    const pair = arr(c, cp);
    if (pair.length !== 2) fail(cp, 'expected [t, n]');
    return [num(pair[0], `${cp}[0]`), int(pair[1], `${cp}[1]`, 0)] as const;
  });
  for (let i = 1; i < cap.length; i++) {
    if (!(cap[i]![0] > cap[i - 1]![0])) fail(`${path}.engineers.cap`, 'times must be strictly ascending');
  }
  const es = obj(o.estore, `${path}.estore`);
  keys(es, `${path}.estore`, ['atS']);
  const en = obj(o.energy, `${path}.energy`);
  keys(en, `${path}.energy`, ['horizonS', 'reserveE', 'maxInflight']);
  const xf = obj(o.extraFactory, `${path}.extraFactory`);
  keys(xf, `${path}.extraFactory`, ['role', 'slots', 'massStoreFrac', 'forS', 'minS']);
  const t2 = obj(o.techT2, `${path}.techT2`);
  keys(t2, `${path}.techT2`, ['minS', 'minMassIncome', 'minEnergySurplus', 'assistEngineers', 'acuAssist', 't2Engineers']);
  const mu = obj(o.mexUpgrade, `${path}.mexUpgrade`);
  keys(mu, `${path}.mexUpgrade`, ['minS', 'minMassIncome', 'saturatedS', 'maxParallel', 'assistEngineers', 'order']);
  const wv = obj(o.waves, `${path}.waves`);
  keys(wv, `${path}.waves`, ['first', 'grow', 'maxS', 'airFirst']);
  return {
    engineers: {
      base: int(e.base, `${path}.engineers.base`, 0),
      perFreeSpots: int(e.perFreeSpots, `${path}.engineers.perFreeSpots`, 1),
      cap,
    },
    estore: { atS: num(es.atS, `${path}.estore.atS`) },
    energy: {
      horizonS: num(en.horizonS, `${path}.energy.horizonS`),
      reserveE: num(en.reserveE, `${path}.energy.reserveE`),
      maxInflight: int(en.maxInflight, `${path}.energy.maxInflight`, 0),
    },
    extraFactory: {
      role: roleRef(xf.role, `${path}.extraFactory.role`, roles),
      slots: arr(xf.slots, `${path}.extraFactory.slots`).map((s, i) => str(s, `${path}.extraFactory.slots[${i}]`)),
      massStoreFrac: num(xf.massStoreFrac, `${path}.extraFactory.massStoreFrac`),
      forS: num(xf.forS, `${path}.extraFactory.forS`),
      minS: num(xf.minS, `${path}.extraFactory.minS`),
    },
    techT2: {
      minS: num(t2.minS, `${path}.techT2.minS`),
      minMassIncome: num(t2.minMassIncome, `${path}.techT2.minMassIncome`),
      minEnergySurplus: num(t2.minEnergySurplus, `${path}.techT2.minEnergySurplus`),
      assistEngineers: int(t2.assistEngineers, `${path}.techT2.assistEngineers`, 0),
      acuAssist: bool(t2.acuAssist, `${path}.techT2.acuAssist`),
      t2Engineers: t2.t2Engineers === undefined ? 2 : int(t2.t2Engineers, `${path}.techT2.t2Engineers`, 0),
    },
    mexUpgrade: {
      minS: num(mu.minS, `${path}.mexUpgrade.minS`),
      minMassIncome: num(mu.minMassIncome, `${path}.mexUpgrade.minMassIncome`),
      saturatedS: num(mu.saturatedS, `${path}.mexUpgrade.saturatedS`),
      maxParallel: int(mu.maxParallel, `${path}.mexUpgrade.maxParallel`, 0),
      assistEngineers: int(mu.assistEngineers, `${path}.mexUpgrade.assistEngineers`, 0),
      order: str(mu.order, `${path}.mexUpgrade.order`),
    },
    waves: {
      first: int(wv.first, `${path}.waves.first`, 1),
      grow: int(wv.grow, `${path}.waves.grow`, 0),
      maxS: num(wv.maxS, `${path}.waves.maxS`),
      airFirst: wv.airFirst === undefined ? null : int(wv.airFirst, `${path}.waves.airFirst`, 0),
    },
  };
}

function parseExpect(v: unknown, path: string): Record<string, ExpectBlock> {
  const o = obj(v, path);
  const out: Record<string, ExpectBlock> = {};
  for (const map of Object.keys(o)) {
    const mp = `${path}.${map}`;
    const b = obj(o[map], mp);
    const blk: Record<string, number | Record<string, number>> = {};
    for (const k of Object.keys(b)) {
      const val = b[k];
      if (typeof val === 'number') blk[k] = num(val, `${mp}.${k}`);
      else blk[k] = numRecord(val, `${mp}.${k}`);
    }
    out[map] = blk;
  }
  return out;
}

function msNumber(ms: string, path: string): number {
  const m = /^MS([0-9]+)$/.exec(ms);
  if (m === null) fail(path, `expected 'MS<n>', got '${ms}'`);
  return Number(m[1]);
}

/** Parses and validates `ai-openings.json` (strict). */
export function parseOpenings(json: unknown): OpeningsDoc {
  const root = obj(json, '$');
  keys(root, '$', [
    'schema',
    'faction',
    'language',
    'sourceOfTruth',
    'assumptions',
    'roles',
    'sites',
    'baseTemplate',
    'difficultyTiming',
    'openings',
  ]);
  if (root.schema !== OPENINGS_SCHEMA) fail('$.schema', `expected '${OPENINGS_SCHEMA}', got ${String(root.schema)}`);
  const faction = str(root.faction, '$.faction');
  const language = str(root.language, '$.language');
  str(root.sourceOfTruth, '$.sourceOfTruth');

  const as = obj(root.assumptions, '$.assumptions');
  keys(as, '$.assumptions', [
    'startStorage',
    'warpInS',
    'buildRangeWu',
    'rollOffS',
    'passability',
    'straightLineDetour',
    'platoonSpeedFactor',
  ]);
  const pa = obj(as.passability, '$.assumptions.passability');
  keys(pa, '$.assumptions.passability', ['maxSlope', 'maxWaterDepthWu', 'gridWu']);
  const assumptions: OpeningsAssumptions = {
    startStorage: str(as.startStorage, '$.assumptions.startStorage'),
    warpInS: num(as.warpInS, '$.assumptions.warpInS'),
    buildRangeWu: numRecord(as.buildRangeWu, '$.assumptions.buildRangeWu'),
    rollOffS: num(as.rollOffS, '$.assumptions.rollOffS'),
    passability: {
      maxSlope: num(pa.maxSlope, '$.assumptions.passability.maxSlope'),
      maxWaterDepthWu: num(pa.maxWaterDepthWu, '$.assumptions.passability.maxWaterDepthWu'),
      gridWu: int(pa.gridWu, '$.assumptions.passability.gridWu', 1),
    },
    straightLineDetour: num(as.straightLineDetour, '$.assumptions.straightLineDetour'),
    platoonSpeedFactor: num(as.platoonSpeedFactor, '$.assumptions.platoonSpeedFactor'),
  };

  const { rec: roles, order: roleNames } = strRecord(root.roles, '$.roles');
  const { rec: sites } = strRecord(root.sites, '$.sites');

  const bt = obj(root.baseTemplate, '$.baseTemplate');
  keys(bt, '$.baseTemplate', ['slots']);
  const so = obj(bt.slots, '$.baseTemplate.slots');
  const slots: Record<string, BaseSlot> = {};
  const slotNames: string[] = [];
  for (const k of Object.keys(so)) {
    const sp = `$.baseTemplate.slots.${k}`;
    const s = obj(so[k], sp);
    keys(s, sp, ['f', 's', 'footprint']);
    slots[k] = { f: num(s.f, `${sp}.f`), s: num(s.s, `${sp}.s`), footprint: num(s.footprint, `${sp}.footprint`) };
    slotNames.push(k);
  }

  const dt = obj(root.difficultyTiming, '$.difficultyTiming');
  keys(dt, '$.difficultyTiming', DIFFICULTIES);
  const timing = {} as Record<Difficulty, DifficultyTiming>;
  for (const d of DIFFICULTIES) {
    const tp = `$.difficultyTiming.${d}`;
    const t = obj(dt[d], tp);
    keys(t, tp, ['stepDelayS', 'skipChance', 'techDelayS', 'engineerCapFactor', 'waveExtra']);
    timing[d] = {
      stepDelayS: num(t.stepDelayS, `${tp}.stepDelayS`),
      skipChance: num(t.skipChance, `${tp}.skipChance`),
      techDelayS: num(t.techDelayS, `${tp}.techDelayS`),
      engineerCapFactor: num(t.engineerCapFactor, `${tp}.engineerCapFactor`),
      waveExtra: int(t.waveExtra, `${tp}.waveExtra`, 0),
    };
  }

  const openings: Opening[] = [];
  const ids: string[] = [];
  const list = arr(root.openings, '$.openings');
  for (let i = 0; i < list.length; i++) {
    const op = `$.openings[${i}]`;
    const o = obj(list[i], op);
    keys(o, op, ['id', 'name', 'fromMs', 'intent', 'weights', 'acu', 'factories', 'engineers', 'followUp', 'expect']);
    const id = str(o.id, `${op}.id`);
    if (ids.includes(id)) fail(`${op}.id`, `duplicate opening '${id}'`);
    ids.push(id);
    const nm = obj(o.name, `${op}.name`);
    keys(nm, `${op}.name`, ['de', 'en']);
    const fromMs = str(o.fromMs, `${op}.fromMs`);
    const w = obj(o.weights, `${op}.weights`);
    keys(w, `${op}.weights`, ['maps', 'difficulty']);
    const wd = obj(w.difficulty, `${op}.weights.difficulty`);
    keys(wd, `${op}.weights.difficulty`, DIFFICULTIES);
    const diff = {} as Record<Difficulty, number>;
    for (const d of DIFFICULTIES) diff[d] = num(wd[d], `${op}.weights.difficulty.${d}`);
    const fo = obj(o.factories, `${op}.factories`);
    const factories: Record<string, OpeningStep[]> = {};
    const factoryOrder: string[] = [];
    for (const slot of Object.keys(fo)) {
      if (!slotNames.includes(slot)) fail(`${op}.factories`, `unknown factory slot '${slot}'`);
      factories[slot] = arr(fo[slot], `${op}.factories.${slot}`).map((s, j) =>
        parseStep(s, `${op}.factories.${slot}[${j}]`, roles, slotNames),
      );
      factoryOrder.push(slot);
    }
    openings.push({
      id,
      name: { de: str(nm.de, `${op}.name.de`), en: str(nm.en, `${op}.name.en`) },
      fromMs,
      fromMsNumber: msNumber(fromMs, `${op}.fromMs`),
      intent: str(o.intent, `${op}.intent`),
      weights: { maps: numRecord(w.maps, `${op}.weights.maps`), difficulty: diff },
      acu: arr(o.acu, `${op}.acu`).map((s, j) => parseStep(s, `${op}.acu[${j}]`, roles, slotNames)),
      factories,
      factoryOrder,
      engineers: arr(o.engineers, `${op}.engineers`).map((plan, j) =>
        arr(plan, `${op}.engineers[${j}]`).map((s, k) => parseStep(s, `${op}.engineers[${j}][${k}]`, roles, slotNames)),
      ),
      followUp: parseFollowUp(o.followUp, `${op}.followUp`, roles),
      expect: parseExpect(o.expect, `${op}.expect`),
    });
  }
  if (openings.length === 0) fail('$.openings', 'no openings');
  return {
    schema: OPENINGS_SCHEMA,
    faction,
    language,
    assumptions,
    roles,
    roleNames,
    sites,
    baseTemplate: { slots, slotNames },
    difficultyTiming: timing,
    openings,
  };
}

/** Expands `count` of build/produce steps into single steps (count 1), keeping order. */
export function expandSteps(steps: readonly OpeningStep[]): OpeningStep[] {
  const out: OpeningStep[] = [];
  for (const s of steps) {
    if (s.do === 'build' || s.do === 'produce') {
      for (let i = 0; i < s.count; i++) out.push({ ...s, count: 1 });
    } else out.push(s);
  }
  return out;
}

// ---- roles ------------------------------------------------------------------------------------

/**
 * Resolves a role at a tech level to exactly one blueprint (ai.md §1 Leitplanke 2, ecosim Roles):
 * candidates match `roles[role] & TECH<tech>`; base stages (no upgradeFrom) first, upgrade stages
 * only if no base stage matches. Throws unless exactly one blueprint remains.
 */
export function resolveRole(
  role: string,
  tech: number,
  table: AiBlueprintTable,
  roles: Readonly<Record<string, string>>,
): AiBlueprint {
  const r = tryResolveRole(role, tech, table, roles);
  if (r.bp === null) throw new Error(`role ${role}@T${tech}: ${r.error}`);
  return r.bp;
}

function tryResolveRole(
  role: string,
  tech: number,
  table: AiBlueprintTable,
  roles: Readonly<Record<string, string>>,
): { bp: AiBlueprint | null; error: string } {
  if (!Object.prototype.hasOwnProperty.call(roles, role)) return { bp: null, error: 'unknown role' };
  const techName = `TECH${tech}`;
  if (table.registry.bitOf(techName) < 0) return { bp: null, error: `no category ${techName}` };
  const expr = table.compile(`(${roles[role]!}) & ${techName}`);
  const base: AiBlueprint[] = [];
  const all: AiBlueprint[] = [];
  for (const bp of table.list) {
    if (!table.matches(bp, expr)) continue;
    all.push(bp);
    if (bp.upgradeFrom === -1) base.push(bp);
  }
  const hits = base.length > 0 ? base : all;
  if (hits.length !== 1) return { bp: null, error: `not unique: [${hits.map((h) => h.id).join(', ')}]` };
  return { bp: hits[0]!, error: '' };
}

/** Cached role resolution against one table. */
export class RoleTable {
  private readonly cache = new Map<string, AiBlueprint | null>();
  private readonly exprs = new Map<string, CompiledCategoryExpr>();

  constructor(
    readonly table: AiBlueprintTable,
    readonly roles: Readonly<Record<string, string>>,
  ) {}

  /** Blueprint of role@tech; throws if not exactly one. */
  resolve(role: string, tech: number): AiBlueprint {
    const bp = this.tryResolve(role, tech);
    if (bp === null) return resolveRole(role, tech, this.table, this.roles);
    return bp;
  }

  /** Blueprint of role@tech or null. */
  tryResolve(role: string, tech: number): AiBlueprint | null {
    const key = `${role}@${tech}`;
    let v = this.cache.get(key);
    if (v === undefined) {
      v = tryResolveRole(role, tech, this.table, this.roles).bp;
      this.cache.set(key, v);
    }
    return v;
  }

  /** Compiled role expression (without tech). */
  expr(role: string): CompiledCategoryExpr {
    let e = this.exprs.get(role);
    if (e === undefined) {
      const src = this.roles[role];
      if (src === undefined) throw new Error(`unknown role '${role}'`);
      e = this.table.compile(src);
      this.exprs.set(role, e);
    }
    return e;
  }

  /** True if `bp` belongs to `role` (any tech). */
  isRole(bp: AiBlueprint, role: string): boolean {
    return this.table.matches(bp, this.expr(role));
  }

  /**
   * Highest tech ≥ minTech (up to 4) at which `role` resolves and `builder` can build it — the
   * `loop` semantics of ai.md §4.1 ("tech ist die Mindeststufe"). Null if none.
   */
  bestFor(role: string, minTech: number, builder: AiBlueprint): AiBlueprint | null {
    for (let t = 4; t >= minTech; t--) {
      const bp = this.tryResolve(role, t);
      if (bp !== null && this.table.canBuild(builder, bp)) return bp;
    }
    return null;
  }
}

/** Build range of a builder (ai-openings.json assumptions.buildRangeWu; first matching expression). */
export function buildRangeOf(bp: AiBlueprint, doc: OpeningsDoc, table: AiBlueprintTable): number {
  const br = doc.assumptions.buildRangeWu;
  for (const src of Object.keys(br)) {
    if (table.matches(bp, table.compile(src))) return br[src]!;
  }
  return 0;
}

// ---- selection ----------------------------------------------------------------------------------

/** Map class of `weights.maps`: Setons by name, otherwise by edge length (ai.md §4.1). */
export function mapClassOf(name: string, sizeWu: number): MapClass {
  if (name.toLowerCase() === 'setons') return 'setons';
  if (sizeWu <= 256) return 'size256';
  if (sizeWu <= 512) return 'size512';
  return 'size1024';
}

export interface SelectOptions {
  /** Highest milestone whose openings are allowed (default 11: air_opener = MS12 is off). */
  readonly maxMs?: number;
  /** Allowed opening ids (profile filter, e.g. Easy → eco_standard), null = all. */
  readonly allow?: readonly string[] | null;
}

export interface OpeningWeight {
  readonly id: string;
  readonly weight: number;
  /** weight / Σ weights (0 if Σ = 0). */
  readonly share: number;
}

/** Selection weights in document order: weights.maps[class] × weights.difficulty[level] (ai.md §4.4). */
export function openingWeights(
  doc: OpeningsDoc,
  mapClass: MapClass,
  difficulty: Difficulty,
  opts: SelectOptions = {},
): OpeningWeight[] {
  const maxMs = opts.maxMs ?? 11;
  const allow = opts.allow ?? null;
  const ws: { id: string; weight: number }[] = [];
  let total = 0;
  for (const o of doc.openings) {
    let w = 0;
    if (o.fromMsNumber <= maxMs && (allow === null || allow.includes(o.id))) {
      w = (o.weights.maps[mapClass] ?? 0) * o.weights.difficulty[difficulty];
    }
    ws.push({ id: o.id, weight: w });
    total += w;
  }
  return ws.map((w) => ({ id: w.id, weight: w.weight, share: total > 0 ? w.weight / total : 0 }));
}

/**
 * Draws an opening with the AI RNG (one u32). Falls back to the first allowed opening when all
 * weights are 0.
 */
export function selectOpening(
  doc: OpeningsDoc,
  mapClass: MapClass,
  difficulty: Difficulty,
  rng: Xorshift32,
  opts: SelectOptions = {},
): Opening {
  const ws = openingWeights(doc, mapClass, difficulty, opts);
  let total = 0;
  for (const w of ws) total += w.weight;
  const r = rng.nextFloat() * total;
  if (total > 0) {
    let acc = 0;
    let last = -1;
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i]!.weight;
      if (w <= 0) continue;
      last = i;
      acc += w;
      if (r < acc) return doc.openings[i]!;
    }
    return doc.openings[last]!;
  }
  const maxMs = opts.maxMs ?? 11;
  const allow = opts.allow ?? null;
  for (const o of doc.openings) {
    if (o.fromMsNumber <= maxMs && (allow === null || allow.includes(o.id))) return o;
  }
  return doc.openings[0]!;
}

/** Every (role, tech) pair an opening document references (steps, fallbacks, loops, extraFactory). */
export function referencedRoles(doc: OpeningsDoc): { role: string; tech: number }[] {
  const out: { role: string; tech: number }[] = [];
  const add = (role: string, tech: number): void => {
    if (!out.some((p) => p.role === role && p.tech === tech)) out.push({ role, tech });
  };
  const visit = (s: OpeningStep): void => {
    if (s.do === 'build') {
      add(s.role, s.tech);
      if (s.fallback !== null) add(s.fallback.role, s.fallback.tech);
    } else if (s.do === 'produce') add(s.role, s.tech);
    else if (s.do === 'loop') for (const it of s.items) add(it.role, it.tech);
  };
  for (const o of doc.openings) {
    o.acu.forEach(visit);
    for (const slot of o.factoryOrder) o.factories[slot]!.forEach(visit);
    for (const plan of o.engineers) plan.forEach(visit);
    add(o.followUp.extraFactory.role, 1);
  }
  return out;
}
