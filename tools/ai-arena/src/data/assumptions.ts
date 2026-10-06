/**
 * Arena model assumptions and the default blueprint table.
 *
 * The numbers the roster does not contain yet (build ranges, roll-off, warp-in, passability grid,
 * starting storage) come from `docs/design/ai-openings.json → assumptions`, exactly like
 * tools/ai-sim/ecosim.py uses them (ai.md §11 point 1/2). Unit numbers come only from roster.json
 * (via `bpTableFromRoster` of @faf/ai).
 */
import { bpTableFromRoster, DEFAULT_PASS_OPTIONS, type AiBlueprint, type AiBlueprintTable, type PassOptions } from '@faf/ai';
import { loadOpeningsJson, loadRosterJson, type OpeningsJson } from './design.ts';

/** Build range of builders matching a category expression (first match wins, document order). */
export interface BuildRangeRule {
  readonly expr: string;
  readonly rangeWu: number;
}

export interface ArenaAssumptions {
  /** `assumptions.buildRangeWu` in document order. */
  readonly buildRange: readonly BuildRangeRule[];
  /** Roll-off after a factory item is finished (s). */
  readonly rollOffS: number;
  /** Warp-in delay of the commander (s); the arena supports only 0. */
  readonly warpInS: number;
  /** Land passability (slope, water depth, grid). */
  readonly pass: PassOptions;
  /** Start with full commander storage (650 M / 3,900 E) — "voll" in the JSON. */
  readonly startStorageFull: boolean;
}

function num(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`ai-openings.json assumptions: ${what} must be a number`);
  return v;
}

function rec(v: unknown, what: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`ai-openings.json assumptions: ${what} must be an object`);
  return v as Record<string, unknown>;
}

/** Parses `assumptions` of an ai-openings.json document. */
export function parseArenaAssumptions(json: OpeningsJson): ArenaAssumptions {
  const a = rec(json['assumptions'], 'assumptions');
  const br = rec(a['buildRangeWu'], 'buildRangeWu');
  const buildRange: BuildRangeRule[] = [];
  for (const [expr, v] of Object.entries(br)) buildRange.push({ expr, rangeWu: num(v, `buildRangeWu['${expr}']`) });
  const p = rec(a['passability'], 'passability');
  const startStorage = a['startStorage'];
  return {
    buildRange,
    rollOffS: num(a['rollOffS'], 'rollOffS'),
    warpInS: num(a['warpInS'], 'warpInS'),
    pass: {
      maxSlope: num(p['maxSlope'], 'passability.maxSlope'),
      maxWaterDepthWu: num(p['maxWaterDepthWu'], 'passability.maxWaterDepthWu'),
      cellWu: num(p['gridWu'], 'passability.gridWu'),
    },
    startStorageFull: typeof startStorage === 'string' ? startStorage.startsWith('voll') : true,
  };
}

let assumptionsCache: ArenaAssumptions | null = null;
let rolesCache: Readonly<Record<string, string>> | null = null;
let bpsCache: AiBlueprintTable | null = null;

/** Assumptions of docs/design/ai-openings.json (cached per process). */
export function getArenaAssumptions(): ArenaAssumptions {
  if (assumptionsCache === null) assumptionsCache = parseArenaAssumptions(loadOpeningsJson());
  return assumptionsCache;
}

/** Role → category expression of docs/design/ai-openings.json (cached; document order). */
export function getArenaRoles(): Readonly<Record<string, string>> {
  if (rolesCache === null) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(loadOpeningsJson().roles)) {
      if (typeof v !== 'string') throw new Error(`ai-openings.json: role '${k}' must be a string`);
      out[k] = v;
    }
    rolesCache = out;
  }
  return rolesCache;
}

/** Blueprint table of docs/design/roster.json (cached per process; shared, read-only). */
export function getArenaBps(): AiBlueprintTable {
  if (bpsCache === null) bpsCache = bpTableFromRoster(loadRosterJson());
  return bpsCache;
}

/** Fallback assumptions identical to the current JSON (for synthetic setups without file access). */
export const FALLBACK_ASSUMPTIONS: ArenaAssumptions = {
  buildRange: [
    { expr: 'COMMAND', rangeWu: 10 },
    { expr: 'ENGINEER & TECH1', rangeWu: 6 },
    { expr: 'ENGINEER & TECH2', rangeWu: 7 },
    { expr: 'ENGINEER & TECH3', rangeWu: 8 },
  ],
  rollOffS: 2,
  warpInS: 0,
  pass: DEFAULT_PASS_OPTIONS,
  startStorageFull: true,
};

/** Build range of a builder blueprint (first matching rule; 6 WU if none matches). */
export function buildRangeFor(table: AiBlueprintTable, bp: AiBlueprint, a: ArenaAssumptions): number {
  for (const r of a.buildRange) {
    if (table.matches(bp, table.compile(r.expr))) return r.rangeWu;
  }
  return 6;
}
