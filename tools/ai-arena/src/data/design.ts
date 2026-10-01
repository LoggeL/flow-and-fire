/**
 * Raw loaders for the design data the arena needs: `docs/design/roster.json` (the only source of
 * unit numbers) and `docs/design/ai-openings.json` (schema faf-ai-openings/1).
 *
 * The objects are returned raw and only minimally typed/validated; turning them into an
 * `AiBlueprintTable` or parsed openings is the job of `@faf/ai` (bpTableFromRoster, parseOpenings).
 */

import { readFileSync } from 'node:fs';
import { repoPath } from './repo.ts';

export const ROSTER_SCHEMA = 'faf-roster/1';
export const OPENINGS_SCHEMA = 'faf-ai-openings/1';

/** One unit of roster.json; everything beyond the checked keys stays `unknown`. */
export interface RosterUnitJson {
  readonly id: string;
  readonly tech: number;
  readonly categories: readonly string[];
  readonly [key: string]: unknown;
}

export interface RosterJson {
  readonly schema: string;
  readonly units: readonly RosterUnitJson[];
  readonly [key: string]: unknown;
}

export interface OpeningJson {
  readonly id: string;
  readonly [key: string]: unknown;
}

export interface OpeningsJson {
  readonly schema: string;
  readonly roles: Readonly<Record<string, unknown>>;
  readonly openings: readonly OpeningJson[];
  readonly [key: string]: unknown;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function readJson(rel: readonly string[]): unknown {
  const text = readFileSync(repoPath(...rel), 'utf8');
  return JSON.parse(text) as unknown;
}

/** Validates the minimal roster shape (schema, units with id/tech/categories). */
export function checkRosterJson(json: unknown): RosterJson {
  if (!isRecord(json)) throw new Error('roster.json: top level must be an object');
  if (json['schema'] !== ROSTER_SCHEMA) throw new Error(`roster.json: schema '${String(json['schema'])}', expected '${ROSTER_SCHEMA}'`);
  const units = json['units'];
  if (!Array.isArray(units) || units.length === 0) throw new Error('roster.json: units must be a non-empty array');
  const seen = new Set<string>();
  units.forEach((u: unknown, i: number) => {
    if (!isRecord(u)) throw new Error(`roster.json: units[${i}] must be an object`);
    const id = u['id'];
    if (typeof id !== 'string' || id.length === 0) throw new Error(`roster.json: units[${i}].id must be a string`);
    if (seen.has(id)) throw new Error(`roster.json: duplicate unit id '${id}'`);
    seen.add(id);
    if (!Number.isInteger(u['tech'])) throw new Error(`roster.json: ${id}.tech must be an integer`);
    const cats = u['categories'];
    if (!Array.isArray(cats) || !cats.every((c) => typeof c === 'string')) {
      throw new Error(`roster.json: ${id}.categories must be a string array`);
    }
  });
  return json as unknown as RosterJson;
}

/** Validates the minimal openings shape (schema, roles object, openings with unique ids). */
export function checkOpeningsJson(json: unknown): OpeningsJson {
  if (!isRecord(json)) throw new Error('ai-openings.json: top level must be an object');
  if (json['schema'] !== OPENINGS_SCHEMA) {
    throw new Error(`ai-openings.json: schema '${String(json['schema'])}', expected '${OPENINGS_SCHEMA}'`);
  }
  if (!isRecord(json['roles'])) throw new Error('ai-openings.json: roles must be an object');
  const openings = json['openings'];
  if (!Array.isArray(openings) || openings.length === 0) throw new Error('ai-openings.json: openings must be a non-empty array');
  const seen = new Set<string>();
  openings.forEach((o: unknown, i: number) => {
    if (!isRecord(o) || typeof o['id'] !== 'string') throw new Error(`ai-openings.json: openings[${i}].id must be a string`);
    if (seen.has(o['id'])) throw new Error(`ai-openings.json: duplicate opening id '${o['id']}'`);
    seen.add(o['id']);
  });
  return json as unknown as OpeningsJson;
}

/** Reads `docs/design/roster.json` (fresh object on every call). */
export function loadRosterJson(): RosterJson {
  return checkRosterJson(readJson(['docs', 'design', 'roster.json']));
}

/** Reads `docs/design/ai-openings.json` (fresh object on every call). */
export function loadOpeningsJson(): OpeningsJson {
  return checkOpeningsJson(readJson(['docs', 'design', 'ai-openings.json']));
}
