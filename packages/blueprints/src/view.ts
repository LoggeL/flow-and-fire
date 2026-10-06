/**
 * `view.json`: presentation data per blueprint sim id (PLAN §3.9 step 7). The visual index of a
 * unit equals its blueprint sim id (the sim writes `visual = bp` into UnitRecords).
 * Its hash (viewHash) is not part of simId: view changes never break replays.
 *
 * Version 2 (MS3) adds per visual: `icon` (strategic icon id from {@link ICON_IDS}),
 * `iconThreshold` (projected height in CSS px below which the icon replaces the mesh, default
 * {@link DEFAULT_ICON_THRESHOLD}; semantics in DECISIONS 23), `tech` (1–3 from TECH1..3, 0 = none),
 * `categories` (names, bit order – for UI filters), `selectionRadius` (WU), `sizeClass`,
 * `hotkeySlot`, `fx` (effect slot → effect id) and an optional placeholder `turret`; plus a
 * top-level `effects` table (effect blueprints, view only).
 *
 * `parseViewJson` reads version 1 and 2. Version-1 documents are upgraded on read (iconThreshold
 * default, tech 0, no categories, selectionRadius from the placeholder, sizeClass 1, no effects);
 * the returned bundle keeps the `version` it was read with.
 */
import { isPlainObject } from './merge.ts';
import { ASSET_ID_PATTERN } from './asset-manifest.ts';

const ASSET_ID_RE = new RegExp(ASSET_ID_PATTERN);
const CATEGORY_RE = /^[A-Z][A-Z0-9_]*$/;

export const VIEW_FORMAT = 'faf-view';
/** Written version. */
export const VIEW_VERSION = 2;
/** Oldest readable version. */
export const VIEW_MIN_VERSION = 1;

/**
 * Registry of strategic icon ids (sorted). Every game unit names one of them in `view.icon`; the
 * icon atlas (tools/assets-pipeline, MS3) has one glyph per id. Append-only in spirit: removing an
 * id breaks content.
 */
export const ICON_IDS = [
  'air_generic',
  'commander',
  'cube',
  'land_antiair',
  'land_direct',
  'land_engineer',
  'land_indirect',
  'land_scout',
  'structure_generic',
] as const;
export type IconId = (typeof ICON_IDS)[number];

/** True if `id` is a registered icon id. */
export function isIconId(id: string): id is IconId {
  return (ICON_IDS as readonly string[]).includes(id);
}

/** Default `iconThreshold` in CSS px (DECISIONS 23). */
export const DEFAULT_ICON_THRESHOLD = 14;
/** Selection ring radius = factor × max(collision radius, max(footprint) / 2), rounded to 1/100 WU. */
export const SELECTION_RADIUS_FACTOR = 1.2;

/** Default selection radius (WU) from the collision radius and the footprint (see SELECTION_RADIUS_FACTOR). */
export function defaultSelectionRadius(radius: number, footprint: readonly [number, number]): number {
  const r = Math.max(radius, Math.max(footprint[0], footprint[1]) / 2) * SELECTION_RADIUS_FACTOR;
  return Math.round(r * 100) / 100;
}

export interface ViewTurret {
  readonly hull: 'box' | 'cyl';
  readonly size: readonly [number, number, number];
  readonly offset: readonly [number, number, number];
}

export interface ViewPlaceholder {
  readonly hull: 'box' | 'cyl';
  readonly size: readonly [number, number, number];
  readonly color?: readonly [number, number, number];
  /** Turret on top of the hull (v2; renderers before MS3 wave 1 ignore it). */
  readonly turret?: ViewTurret;
}

/** One visual (index = blueprint sim id). */
export interface ViewEntry {
  readonly id: string;
  readonly placeholder: ViewPlaceholder;
  /** Model asset id (asset manifest key, e.g. `units/cube_bot`); absent ⇒ placeholder. */
  readonly mesh?: string;
  /** LOD switch distances in WU [LOD0→1, LOD1→2]; absent ⇒ renderer default. */
  readonly lod?: readonly [number, number];
  /** Strategic icon id (ICON_IDS); absent only for test blueprints. */
  readonly icon?: string;
  /** Projected height (CSS px) below which the icon replaces the mesh. */
  readonly iconThreshold: number;
  /** Tech level 1–3 (0 = none). */
  readonly tech: number;
  /** Category names in bit order. */
  readonly categories: readonly string[];
  /** Selection ring radius (WU). */
  readonly selectionRadius: number;
  /** Pathing size class. */
  readonly sizeClass: number;
  readonly hotkeySlot?: string;
  /** Effect slot → effect id (index into `effects` via `ViewBundle.effects[].id`). */
  readonly fx?: Readonly<Record<string, string>>;
  readonly nameKey: string;
  readonly descKey: string;
}

/** An effect blueprint (view only). */
export interface ViewEffect {
  readonly id: string;
  readonly kind: 'flash' | 'burst' | 'trail' | 'decal';
  readonly color: readonly [number, number, number];
  readonly size: number;
  readonly durationSec: number;
  readonly count: number;
}

export interface ViewBundle {
  readonly format: typeof VIEW_FORMAT;
  /** Version the document was written with (1 or 2); the shape is always the v2 shape. */
  readonly version: number;
  readonly visuals: readonly ViewEntry[];
  /** Effects sorted by id (v1: empty). */
  readonly effects: readonly ViewEffect[];
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

function positive(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) fail(path, 'expected a number > 0');
  return v;
}

function intIn(v: unknown, path: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) fail(path, `expected an integer in ${min}..${max}`);
  return v;
}

function hull(v: unknown, path: string): 'box' | 'cyl' {
  if (v !== 'box' && v !== 'cyl') fail(path, "expected 'box' or 'cyl'");
  return v;
}

function parsePlaceholder(ph: unknown, p: string): ViewPlaceholder {
  if (!isPlainObject(ph)) fail(p, 'expected an object');
  const h = hull(ph.hull, `${p}/hull`);
  const size = num3(ph.size, `${p}/size`);
  let out: ViewPlaceholder = ph.color === undefined ? { hull: h, size } : { hull: h, size, color: num3(ph.color, `${p}/color`) };
  if (ph.turret !== undefined) {
    const t = ph.turret;
    if (!isPlainObject(t)) fail(`${p}/turret`, 'expected an object');
    out = { ...out, turret: { hull: hull(t.hull, `${p}/turret/hull`), size: num3(t.size, `${p}/turret/size`), offset: num3(t.offset, `${p}/turret/offset`) } };
  }
  return out;
}

const EFFECT_KINDS = ['flash', 'burst', 'trail', 'decal'] as const;

/** Parses and validates view.json (text or already parsed JSON), version 1 or 2. */
export function parseViewJson(input: string | unknown): ViewBundle {
  const v: unknown = typeof input === 'string' ? JSON.parse(input) : input;
  if (!isPlainObject(v)) fail('/', 'expected an object');
  if (v.format !== VIEW_FORMAT) fail('/format', `expected '${VIEW_FORMAT}'`);
  const version = v.version;
  if (version !== 1 && version !== 2) fail('/version', `unsupported version ${String(version)} (readable: ${VIEW_MIN_VERSION}..${VIEW_VERSION})`);
  if (!Array.isArray(v.visuals)) fail('/visuals', 'expected an array');
  const visuals: ViewEntry[] = [];
  v.visuals.forEach((e: unknown, i: number) => {
    const p = `/visuals/${i}`;
    if (!isPlainObject(e)) fail(p, 'expected an object');
    if (typeof e.id !== 'string') fail(`${p}/id`, 'expected a string');
    if (typeof e.nameKey !== 'string') fail(`${p}/nameKey`, 'expected a string');
    if (typeof e.descKey !== 'string') fail(`${p}/descKey`, 'expected a string');
    const placeholder = parsePlaceholder(e.placeholder, `${p}/placeholder`);
    let iconThreshold = DEFAULT_ICON_THRESHOLD;
    if (e.iconThreshold !== undefined) {
      if (typeof e.iconThreshold !== 'number' || !Number.isFinite(e.iconThreshold) || e.iconThreshold < 0) fail(`${p}/iconThreshold`, 'expected a number ≥ 0');
      iconThreshold = e.iconThreshold;
    }
    let entry: ViewEntry;
    if (version === 2) {
      if (!Array.isArray(e.categories) || !e.categories.every((c) => typeof c === 'string' && CATEGORY_RE.test(c))) {
        fail(`${p}/categories`, 'expected an array of category names');
      }
      if (e.iconThreshold === undefined) fail(`${p}/iconThreshold`, 'expected a number ≥ 0');
      entry = {
        id: e.id,
        placeholder,
        iconThreshold,
        tech: intIn(e.tech, `${p}/tech`, 0, 3),
        categories: [...(e.categories as string[])],
        selectionRadius: positive(e.selectionRadius, `${p}/selectionRadius`),
        sizeClass: intIn(e.sizeClass, `${p}/sizeClass`, 0, 7),
        nameKey: e.nameKey,
        descKey: e.descKey,
      };
    } else {
      entry = {
        id: e.id,
        placeholder,
        iconThreshold,
        tech: 0,
        categories: [],
        selectionRadius: defaultSelectionRadius(Math.max(placeholder.size[0], placeholder.size[2]) / 2, [1, 1]),
        sizeClass: 1,
        nameKey: e.nameKey,
        descKey: e.descKey,
      };
    }
    if (e.mesh !== undefined) {
      if (typeof e.mesh !== 'string' || !ASSET_ID_RE.test(e.mesh)) fail(`${p}/mesh`, 'expected an asset id');
      entry = { ...entry, mesh: e.mesh };
    }
    if (e.lod !== undefined) {
      const l = e.lod;
      if (!Array.isArray(l) || l.length !== 2 || !l.every((x) => typeof x === 'number' && Number.isFinite(x) && x > 0)) {
        fail(`${p}/lod`, 'expected [number, number] (> 0)');
      }
      const lod: readonly [number, number] = [l[0] as number, l[1] as number];
      if (!(lod[0] < lod[1])) fail(`${p}/lod`, 'expected lod[0] < lod[1]');
      entry = { ...entry, lod };
    }
    if (e.icon !== undefined) {
      if (typeof e.icon !== 'string') fail(`${p}/icon`, 'expected a string');
      entry = { ...entry, icon: e.icon };
    }
    if (version === 2 && e.hotkeySlot !== undefined) {
      if (typeof e.hotkeySlot !== 'string') fail(`${p}/hotkeySlot`, 'expected a string');
      entry = { ...entry, hotkeySlot: e.hotkeySlot };
    }
    if (version === 2 && e.fx !== undefined) {
      const fx = e.fx;
      if (!isPlainObject(fx) || !Object.values(fx).every((x) => typeof x === 'string')) fail(`${p}/fx`, 'expected an object of effect ids');
      entry = { ...entry, fx: { ...(fx as Record<string, string>) } };
    }
    visuals.push(entry);
  });
  const effects: ViewEffect[] = [];
  if (version === 2) {
    if (!Array.isArray(v.effects)) fail('/effects', 'expected an array');
    v.effects.forEach((e: unknown, i: number) => {
      const p = `/effects/${i}`;
      if (!isPlainObject(e)) fail(p, 'expected an object');
      if (typeof e.id !== 'string') fail(`${p}/id`, 'expected a string');
      if (!(EFFECT_KINDS as readonly unknown[]).includes(e.kind)) fail(`${p}/kind`, `expected one of ${EFFECT_KINDS.join(', ')}`);
      effects.push({
        id: e.id,
        kind: e.kind as ViewEffect['kind'],
        color: num3(e.color, `${p}/color`),
        size: positive(e.size, `${p}/size`),
        durationSec: positive(e.durationSec, `${p}/durationSec`),
        count: intIn(e.count, `${p}/count`, 1, 256),
      });
    });
  }
  return { format: VIEW_FORMAT, version, visuals, effects };
}
