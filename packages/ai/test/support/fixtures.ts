/**
 * Node-only test fixtures of @faf/ai (also used by the manager packages of TRACK-AI):
 * roster → AiBlueprintTable, ai-openings.json → OpeningsDoc, content/maps/<name>.rtsmap → AiStatic.
 * Everything is cached per process.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRtsMap, type RtsMap } from '@faf/formats';
import {
  analyzeMap,
  bpTableFromRoster,
  createAiStatic,
  parseOpenings,
  RoleTable,
  type AiBlueprintTable,
  type AiStatic,
  type MapAnalysis,
  type OpeningsDoc,
} from '../../src/index.ts';

/** Repository root (directory containing pnpm-workspace.yaml). */
export function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const up = resolve(dir, '..');
    if (up === dir) throw new Error('repo root not found');
    dir = up;
  }
}

let rosterJson: unknown = null;
let openingsJson: unknown = null;
let roster: AiBlueprintTable | null = null;
let openings: OpeningsDoc | null = null;
const maps = new Map<string, RtsMap>();
const statics = new Map<string, AiStatic>();
const analyses = new Map<string, MapAnalysis>();

/** Raw docs/design/roster.json. */
export function loadRosterJson(): unknown {
  if (rosterJson === null) rosterJson = JSON.parse(readFileSync(join(repoRoot(), 'docs/design/roster.json'), 'utf8')) as unknown;
  return rosterJson;
}

/** Raw docs/design/ai-openings.json. */
export function loadOpeningsJson(): unknown {
  if (openingsJson === null) {
    openingsJson = JSON.parse(readFileSync(join(repoRoot(), 'docs/design/ai-openings.json'), 'utf8')) as unknown;
  }
  return openingsJson;
}

/** AiBlueprintTable of the roster (cached). */
export function loadRoster(): AiBlueprintTable {
  if (roster === null) roster = bpTableFromRoster(loadRosterJson());
  return roster;
}

/** Parsed openings document (cached). */
export function loadOpenings(): OpeningsDoc {
  if (openings === null) openings = parseOpenings(loadOpeningsJson());
  return openings;
}

/** Role table (roster × openings roles). */
export function loadRoles(): RoleTable {
  const doc = loadOpenings();
  return new RoleTable(loadRoster(), doc.roles);
}

/** content/maps/<name>.rtsmap (cached). */
export function loadMap(name: string): RtsMap {
  let m = maps.get(name);
  if (m === undefined) {
    m = readRtsMap(new Uint8Array(readFileSync(join(repoRoot(), 'content/maps', `${name}.rtsmap`))));
    maps.set(name, m);
  }
  return m;
}

/**
 * AiStatic of `army` on map `name` (1v1 setup: active armies default [0, 1]); the grids are shared
 * between armies of the same map.
 */
export function loadStatic(name: string, army = 0, gameSeed = 1, activeArmies: readonly number[] = [0, 1]): AiStatic {
  const key = `${name}|${army}|${gameSeed}|${activeArmies.join(',')}`;
  let s = statics.get(key);
  if (s === undefined) {
    const base = [...statics.values()].find((x) => x.map.name === loadMap(name).meta.name && x.activeArmies.join(',') === activeArmies.join(','));
    if (base !== undefined) {
      s = { ...base, army, gameSeed: gameSeed >>> 0 };
    } else {
      const m = loadMap(name);
      const doc = loadOpenings();
      s = createAiStatic({
        name: m.meta.name,
        sizeWu: m.meta.sizeWu,
        dim: m.meta.sizeWu + 1,
        heights: m.heights,
        heightScaleRaw: m.meta.heightScaleRaw,
        waterLevelRaw: m.meta.waterLevelRaw,
        spots: m.meta.spots,
        starts: m.meta.starts,
        coords: 'fxRaw',
        army,
        gameSeed,
        activeArmies,
        bps: loadRoster(),
        pass: {
          maxSlope: doc.assumptions.passability.maxSlope,
          maxWaterDepthWu: doc.assumptions.passability.maxWaterDepthWu,
          cellWu: doc.assumptions.passability.gridWu,
        },
      });
    }
    statics.set(key, s);
  }
  return s;
}

/** Map analysis of `army` on map `name` (cached). */
export function loadAnalysis(name: string, army = 0): MapAnalysis {
  const key = `${name}|${army}`;
  let a = analyses.get(key);
  if (a === undefined) {
    a = analyzeMap(loadStatic(name, army), loadOpenings());
    analyses.set(key, a);
  }
  return a;
}

export const ARENA_MAP_NAMES = ['setons', 'hollow-ridge', 'tessera', 'braidwater'] as const;
