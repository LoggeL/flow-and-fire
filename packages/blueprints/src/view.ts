/**
 * `view.json`: presentation data per blueprint sim id (PLAN §3.9 step 7). The visual index of a
 * unit equals its blueprint sim id (the sim writes `visual = bp` into UnitRecords).
 * Its hash (viewHash) is not part of simId: view changes never break replays.
 */
import { isPlainObject } from './merge.ts';

export const VIEW_FORMAT = 'faf-view';
export const VIEW_VERSION = 1;

export interface ViewPlaceholder {
  readonly hull: 'box' | 'cyl';
  readonly size: readonly [number, number, number];
  readonly color?: readonly [number, number, number];
}

/** One visual (index = blueprint sim id). */
export interface ViewEntry {
  readonly id: string;
  readonly placeholder: ViewPlaceholder;
  readonly icon?: string;
  readonly iconThreshold?: number;
  readonly nameKey: string;
  readonly descKey: string;
}

export interface ViewBundle {
  readonly format: typeof VIEW_FORMAT;
  readonly version: number;
  readonly visuals: readonly ViewEntry[];
}

function fail(path: string, msg: string): never {
  throw new RangeError(`view.json ${path}: ${msg}`);
}

function num3(v: unknown, path: string): readonly [number, number, number] {
  if (!Array.isArray(v) || v.length !== 3 || !v.every((x) => typeof x === 'number' && Number.isFinite(x))) {
    fail(path, 'expected [number, number, number]');
  }
  return [v[0] as number, v[1] as number, v[2] as number];
}

/** Parses and validates view.json (text or already parsed JSON). */
export function parseViewJson(input: string | unknown): ViewBundle {
  const v: unknown = typeof input === 'string' ? JSON.parse(input) : input;
  if (!isPlainObject(v)) fail('/', 'expected an object');
  if (v.format !== VIEW_FORMAT) fail('/format', `expected '${VIEW_FORMAT}'`);
  if (v.version !== VIEW_VERSION) fail('/version', `unsupported version ${String(v.version)}`);
  if (!Array.isArray(v.visuals)) fail('/visuals', 'expected an array');
  const visuals: ViewEntry[] = [];
  v.visuals.forEach((e: unknown, i: number) => {
    const p = `/visuals/${i}`;
    if (!isPlainObject(e)) fail(p, 'expected an object');
    if (typeof e.id !== 'string') fail(`${p}/id`, 'expected a string');
    if (typeof e.nameKey !== 'string') fail(`${p}/nameKey`, 'expected a string');
    if (typeof e.descKey !== 'string') fail(`${p}/descKey`, 'expected a string');
    const ph = e.placeholder;
    if (!isPlainObject(ph)) fail(`${p}/placeholder`, 'expected an object');
    if (ph.hull !== 'box' && ph.hull !== 'cyl') fail(`${p}/placeholder/hull`, "expected 'box' or 'cyl'");
    const placeholder: ViewPlaceholder =
      ph.color === undefined
        ? { hull: ph.hull, size: num3(ph.size, `${p}/placeholder/size`) }
        : { hull: ph.hull, size: num3(ph.size, `${p}/placeholder/size`), color: num3(ph.color, `${p}/placeholder/color`) };
    let entry: ViewEntry = { id: e.id, placeholder, nameKey: e.nameKey, descKey: e.descKey };
    if (e.icon !== undefined) {
      if (typeof e.icon !== 'string') fail(`${p}/icon`, 'expected a string');
      entry = { ...entry, icon: e.icon };
    }
    if (e.iconThreshold !== undefined) {
      if (typeof e.iconThreshold !== 'number') fail(`${p}/iconThreshold`, 'expected a number');
      entry = { ...entry, iconThreshold: e.iconThreshold };
    }
    visuals.push(entry);
  });
  return { format: VIEW_FORMAT, version: VIEW_VERSION, visuals };
}
