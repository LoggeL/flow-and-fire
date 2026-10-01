/**
 * Event→sound mapping as data (default: default-event-map.json). The router (src/router,
 * audioeng-b3) turns sim events into play requests using only this structure.
 *
 * Sounds are referenced by NAME without scope ('wpn_cannon_t1_fire'); the runtime lookup tries
 * `<faction>:<name>`, then `common:<name>`. A fully qualified id ('common:ui_click') is exact.
 *
 * The JSON form allows shorthands (a bare string for a sound reference, omitted defaults);
 * {@link parseEventSoundMap} validates everything with a JSON path in each error and returns the
 * normalized form below, where every field is present.
 */

import {
  ALERT_KINDS,
  DEATH_SIZE_CLASSES,
  EVENT_FLAG_AIR,
  EVENT_FLAG_STRUCTURE,
  IMPACT_SURFACES,
  SIM_EVENT_KINDS,
  isSimEventKind,
  type DeathSizeClass,
  type ImpactSurface,
  type SimEventKind,
} from './kinds.ts';

/** What the router does with an event kind. */
export type EventRoute = 'sfx' | 'alert' | 'ignore';

/** A sound with level/pitch offsets. */
export interface SoundRef {
  /** Sound name (or fq-id containing ':'). */
  readonly sound: string;
  /** Gain offset in dB (−24..+6), default 0. */
  readonly gainDb: number;
  /** Playback-rate factor (0.5..2), default 1. */
  readonly rate: number;
}

/** A sound that follows the main sound after a delay (e.g. the bell after bld_complete). */
export interface FollowUp extends SoundRef {
  /** Delay after the main sound in ms (0..5000). */
  readonly delayMs: number;
}

/** Rule for one event kind. */
export interface EventRule {
  readonly route: EventRoute;
  /**
   * route 'sfx': sound to play; null for the table-driven kinds (weaponFire → weapons,
   * projectileImpact → impacts, unitDeath → deaths, commanderDeath → commanderDeath).
   * route 'alert': alert name (key of `alerts`); null for kind 'alert' (aux → ALERT_KINDS).
   * route 'ignore': null.
   */
  readonly sound: string | null;
  /** false = play centred even when the event has a position. Default true. */
  readonly spatial: boolean;
  readonly gainDb: number;
  readonly rate: number;
  /** Optional second sound after `delayMs` at the same position. */
  readonly then: FollowUp | null;
  /** Optional alert (key of `alerts`) pushed in addition to the sound, with the event position. */
  readonly alert: string | null;
}

/**
 * Burst weapons (gatling): instead of one sound per shot the router keeps a keyed loop per firing
 * unit (`burst:<handle>`) while weaponFire events keep arriving within `holdMs`; `spin` variant 0
 * plays when the burst starts, variant 1 when it ends. A router without burst support plays the
 * weapon's plain `sound` per shot instead (graceful fallback).
 */
export interface BurstLoop {
  readonly loop: string;
  readonly spin: string | null;
  readonly holdMs: number;
  readonly gainDb: number;
}

/** Sound of one weapon ref. */
export interface WeaponSound extends SoundRef {
  /** Impact family (key of `impacts.families`) for projectileImpact events of this weapon. */
  readonly impact: string;
  readonly burst: BurstLoop | null;
}

/** Impact sounds per surface; a missing surface falls back to `ground`, null = silent. */
export type ImpactFamily = Readonly<Partial<Record<ImpactSurface, SoundRef | null>>>;

export interface ImpactTable {
  /** Family used for unknown weapons. */
  readonly defaultFamily: string;
  readonly families: Readonly<Record<string, ImpactFamily>>;
}

export interface StructureCollapse extends FollowUp {
  /** Minimum death size class (0..3) for the collapse to follow. */
  readonly minSizeClass: number;
}

export interface AlertRule {
  /** Alert sound (alt_* name). */
  readonly sound: string;
  /** Repeat interval override in ms; null = the sound's manifest cooldownMs. */
  readonly repeatMs: number | null;
  /**
   * The same alert at a location farther than this (WU) from the previous one may repeat before
   * the interval (after the queue's minimum spacing); null = the queue default (48 WU).
   */
  readonly radiusWu: number | null;
}

/** Normalized event→sound map. */
export interface EventSoundMap {
  readonly version: 1;
  /** One rule per kind; kinds missing in the JSON are `ignore`. */
  readonly kinds: Readonly<Record<SimEventKind, EventRule>>;
  /** Weapon ref ('core:wpn_*') → sound. */
  readonly weapons: Readonly<Record<string, WeaponSound>>;
  /** Sound for weapons missing in `weapons` (unknown visual); null = silent (counted as unmapped). */
  readonly weaponDefault: SoundRef | null;
  readonly impacts: ImpactTable;
  /** unitDeath by size class (aux 0..3). */
  readonly deaths: Readonly<Record<DeathSizeClass, SoundRef>>;
  /** unitDeath with the AIR flag; null = use the size class. */
  readonly airDeath: SoundRef | null;
  /** Follows a structure's death (STRUCTURE flag, size ≥ minSizeClass); null = none. */
  readonly structureCollapse: StructureCollapse | null;
  readonly commanderDeath: SoundRef;
  /** Alert name (alt_*) → rule. */
  readonly alerts: Readonly<Record<string, AlertRule>>;
}

/** Validation error with the JSON path of the offending value. */
export class EventMapError extends Error {
  readonly path: string;
  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'EventMapError';
    this.path = path;
  }
}

/** Kinds whose sound comes from a table instead of `rule.sound`. */
export const TABLE_KINDS: readonly SimEventKind[] = ['weaponFire', 'projectileImpact', 'unitDeath', 'commanderDeath'];

export const GAIN_DB_MIN = -24;
export const GAIN_DB_MAX = 6;
export const RATE_MIN = 0.5;
export const RATE_MAX = 2;
export const DELAY_MS_MAX = 5000;

const SOUND_NAME = /^(?:[a-z][a-z0-9_]*:)?[a-z][a-z0-9_]*$/;
const WEAPON_REF = /^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/;
const ALERT_NAME = /^alt_[a-z0-9_]+$/;

// ---------------------------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------------------------

type Obj = Readonly<Record<string, unknown>>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function obj(v: unknown, path: string): Obj {
  if (!isObj(v)) throw new EventMapError(path, `expected an object, got ${describe(v)}`);
  return v;
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'an array';
  return typeof v === 'string' ? `'${v}'` : typeof v;
}

function onlyKeys(o: Obj, allowed: readonly string[], path: string): void {
  for (const k of Object.keys(o)) {
    if (!allowed.includes(k)) throw new EventMapError(`${path}.${k}`, `unknown property (allowed: ${allowed.join(', ')})`);
  }
}

function soundName(v: unknown, path: string): string {
  if (typeof v !== 'string' || !SOUND_NAME.test(v)) throw new EventMapError(path, `expected a sound name like 'wpn_cannon_t1_fire', got ${describe(v)}`);
  return v;
}

function num(v: unknown, path: string, min: number, max: number, dflt: number): number {
  if (v === undefined) return dflt;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new EventMapError(path, `expected a number, got ${describe(v)}`);
  if (v < min || v > max) throw new EventMapError(path, `${v} out of range ${min}..${max}`);
  return v;
}

function bool(v: unknown, path: string, dflt: boolean): boolean {
  if (v === undefined) return dflt;
  if (typeof v !== 'boolean') throw new EventMapError(path, `expected a boolean, got ${describe(v)}`);
  return v;
}

function gainDb(o: Obj, path: string): number {
  return num(o.gainDb, `${path}.gainDb`, GAIN_DB_MIN, GAIN_DB_MAX, 0);
}

function rate(o: Obj, path: string): number {
  return num(o.rate, `${path}.rate`, RATE_MIN, RATE_MAX, 1);
}

/** 'name' or {sound, gainDb?, rate?} (plus `extra` allowed keys). */
function soundRef(v: unknown, path: string, extra: readonly string[] = []): SoundRef {
  if (typeof v === 'string') return { sound: soundName(v, path), gainDb: 0, rate: 1 };
  const o = obj(v, path);
  onlyKeys(o, ['sound', 'gainDb', 'rate', ...extra], path);
  return { sound: soundName(o.sound, `${path}.sound`), gainDb: gainDb(o, path), rate: rate(o, path) };
}

function followUp(v: unknown, path: string): FollowUp {
  const o = obj(v, path);
  const ref = soundRef(o, path, ['delayMs']);
  return { ...ref, delayMs: num(o.delayMs, `${path}.delayMs`, 0, DELAY_MS_MAX, 0) };
}

function parseRule(kind: SimEventKind, v: unknown, path: string): EventRule {
  const o = obj(v, path);
  onlyKeys(o, ['route', 'sound', 'spatial', 'gainDb', 'rate', 'then', 'alert'], path);
  const route = o.route;
  if (route !== 'sfx' && route !== 'alert' && route !== 'ignore') {
    throw new EventMapError(`${path}.route`, `expected 'sfx' | 'alert' | 'ignore', got ${describe(route)}`);
  }
  const table = TABLE_KINDS.includes(kind);
  let sound: string | null = null;
  if (o.sound !== undefined) {
    if (route === 'ignore') throw new EventMapError(`${path}.sound`, "not allowed with route 'ignore'");
    if (route === 'sfx' && table) throw new EventMapError(`${path}.sound`, `not allowed: '${kind}' takes its sound from a table`);
    if (route === 'alert' && kind === 'alert') throw new EventMapError(`${path}.sound`, "not allowed: kind 'alert' takes the alert from aux");
    sound = soundName(o.sound, `${path}.sound`);
  } else if (route === 'sfx' && !table) {
    throw new EventMapError(`${path}.sound`, `required for route 'sfx' of '${kind}'`);
  } else if (route === 'alert' && kind !== 'alert') {
    throw new EventMapError(`${path}.sound`, `required for route 'alert' of '${kind}' (alert name)`);
  }
  if (route === 'alert' && sound !== null && !ALERT_NAME.test(sound)) {
    throw new EventMapError(`${path}.sound`, `route 'alert' needs an alert name (alt_*), got '${sound}'`);
  }
  const then = o.then === undefined || o.then === null ? null : followUp(o.then, `${path}.then`);
  let alert: string | null = null;
  if (o.alert !== undefined && o.alert !== null) {
    if (typeof o.alert !== 'string' || !ALERT_NAME.test(o.alert)) throw new EventMapError(`${path}.alert`, `expected an alert name (alt_*), got ${describe(o.alert)}`);
    alert = o.alert;
  }
  if (route !== 'sfx' && (then !== null || alert !== null)) {
    throw new EventMapError(path, "'then' and 'alert' are only allowed with route 'sfx'");
  }
  return {
    route,
    sound,
    spatial: bool(o.spatial, `${path}.spatial`, true),
    gainDb: gainDb(o, path),
    rate: rate(o, path),
    then,
    alert,
  };
}

function parseWeapon(v: unknown, path: string, families: Readonly<Record<string, ImpactFamily>>, defaultFamily: string): WeaponSound {
  if (typeof v === 'string') return { sound: soundName(v, path), gainDb: 0, rate: 1, impact: defaultFamily, burst: null };
  const o = obj(v, path);
  const ref = soundRef(o, path, ['impact', 'burst']);
  let impact = defaultFamily;
  if (o.impact !== undefined) {
    if (typeof o.impact !== 'string' || !Object.prototype.hasOwnProperty.call(families, o.impact)) {
      throw new EventMapError(`${path}.impact`, `unknown impact family ${describe(o.impact)} (known: ${Object.keys(families).join(', ')})`);
    }
    impact = o.impact;
  }
  let burst: BurstLoop | null = null;
  if (o.burst !== undefined && o.burst !== null) {
    const bp = `${path}.burst`;
    const b = obj(o.burst, bp);
    onlyKeys(b, ['loop', 'spin', 'holdMs', 'gainDb'], bp);
    burst = {
      loop: soundName(b.loop, `${bp}.loop`),
      spin: b.spin === undefined || b.spin === null ? null : soundName(b.spin, `${bp}.spin`),
      holdMs: num(b.holdMs, `${bp}.holdMs`, 20, 5000, 250),
      gainDb: gainDb(b, bp),
    };
  }
  return { ...ref, impact, burst };
}

function parseImpacts(v: unknown, path: string): ImpactTable {
  const o = obj(v, path);
  onlyKeys(o, ['defaultFamily', 'families'], path);
  const fo = obj(o.families, `${path}.families`);
  const families: Record<string, ImpactFamily> = {};
  for (const [name, fv] of Object.entries(fo)) {
    const fp = `${path}.families.${name}`;
    if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new EventMapError(fp, 'invalid family name');
    const f = obj(fv, fp);
    onlyKeys(f, IMPACT_SURFACES, fp);
    const fam: Partial<Record<ImpactSurface, SoundRef | null>> = {};
    for (const surface of IMPACT_SURFACES) {
      const sv = f[surface];
      if (sv === undefined) continue;
      fam[surface] = sv === null ? null : soundRef(sv, `${fp}.${surface}`);
    }
    if (fam.ground === undefined || fam.ground === null) throw new EventMapError(`${fp}.ground`, 'every family needs a ground sound (fallback of missing surfaces)');
    families[name] = fam;
  }
  if (Object.keys(families).length === 0) throw new EventMapError(`${path}.families`, 'at least one family required');
  const def = o.defaultFamily;
  if (typeof def !== 'string' || !Object.prototype.hasOwnProperty.call(families, def)) {
    throw new EventMapError(`${path}.defaultFamily`, `unknown family ${describe(def)}`);
  }
  return { defaultFamily: def, families };
}

/**
 * Validates an event map JSON value and returns its normalized form.
 * @throws EventMapError with the JSON path of the first problem
 */
export function parseEventSoundMap(json: unknown): EventSoundMap {
  const root = obj(json, '$');
  onlyKeys(root, ['version', 'kinds', 'weapons', 'weaponDefault', 'impacts', 'deaths', 'airDeath', 'structureCollapse', 'commanderDeath', 'alerts'], '$');
  if (root.version !== 1) throw new EventMapError('$.version', `expected 1, got ${describe(root.version)}`);

  const ko = obj(root.kinds, '$.kinds');
  const kinds = {} as Record<SimEventKind, EventRule>;
  for (const k of Object.keys(ko)) {
    if (!isSimEventKind(k)) throw new EventMapError(`$.kinds.${k}`, `unknown event kind (known: ${SIM_EVENT_KINDS.join(', ')})`);
  }
  for (const k of SIM_EVENT_KINDS) {
    kinds[k] =
      ko[k] === undefined
        ? { route: 'ignore', sound: null, spatial: true, gainDb: 0, rate: 1, then: null, alert: null }
        : parseRule(k, ko[k], `$.kinds.${k}`);
  }

  const impacts = parseImpacts(root.impacts, '$.impacts');

  const wo = obj(root.weapons, '$.weapons');
  const weapons: Record<string, WeaponSound> = {};
  for (const [ref, wv] of Object.entries(wo)) {
    const wp = `$.weapons.${ref}`;
    if (!WEAPON_REF.test(ref)) throw new EventMapError(wp, "weapon ref must look like 'core:wpn_name'");
    weapons[ref] = parseWeapon(wv, wp, impacts.families, impacts.defaultFamily);
  }
  const weaponDefault = root.weaponDefault === undefined || root.weaponDefault === null ? null : soundRef(root.weaponDefault, '$.weaponDefault');

  const dobj = obj(root.deaths, '$.deaths');
  onlyKeys(dobj, DEATH_SIZE_CLASSES, '$.deaths');
  const deaths = {} as Record<DeathSizeClass, SoundRef>;
  for (const c of DEATH_SIZE_CLASSES) {
    if (dobj[c] === undefined) throw new EventMapError(`$.deaths.${c}`, 'required');
    deaths[c] = soundRef(dobj[c], `$.deaths.${c}`);
  }
  const airDeath = root.airDeath === undefined || root.airDeath === null ? null : soundRef(root.airDeath, '$.airDeath');
  let structureCollapse: StructureCollapse | null = null;
  if (root.structureCollapse !== undefined && root.structureCollapse !== null) {
    const sp = '$.structureCollapse';
    const so = obj(root.structureCollapse, sp);
    const f = followUp(Object.fromEntries(Object.entries(so).filter(([k]) => k !== 'minSizeClass')), sp);
    structureCollapse = { ...f, minSizeClass: num(so.minSizeClass, `${sp}.minSizeClass`, 0, DEATH_SIZE_CLASSES.length - 1, 1) };
  }
  if (root.commanderDeath === undefined) throw new EventMapError('$.commanderDeath', 'required');
  const commanderDeath = soundRef(root.commanderDeath, '$.commanderDeath');

  const ao = obj(root.alerts, '$.alerts');
  const alerts: Record<string, AlertRule> = {};
  for (const [name, av] of Object.entries(ao)) {
    const ap = `$.alerts.${name}`;
    if (!ALERT_NAME.test(name)) throw new EventMapError(ap, 'alert names must start with alt_');
    const a = obj(av, ap);
    onlyKeys(a, ['sound', 'repeatMs', 'radiusWu'], ap);
    alerts[name] = {
      sound: a.sound === undefined ? name : soundName(a.sound, `${ap}.sound`),
      repeatMs: a.repeatMs === undefined || a.repeatMs === null ? null : num(a.repeatMs, `${ap}.repeatMs`, 0, 600_000, 0),
      radiusWu: a.radiusWu === undefined || a.radiusWu === null ? null : num(a.radiusWu, `${ap}.radiusWu`, 1, 4096, 48),
    };
  }
  // Cross references to alerts.
  for (const k of SIM_EVENT_KINDS) {
    const r = kinds[k];
    if (r.route === 'alert' && r.sound !== null && !alerts[r.sound]) throw new EventMapError(`$.kinds.${k}.sound`, `alert '${r.sound}' is not defined in $.alerts`);
    if (r.alert !== null && !alerts[r.alert]) throw new EventMapError(`$.kinds.${k}.alert`, `alert '${r.alert}' is not defined in $.alerts`);
  }
  if (kinds.alert.route === 'alert') {
    for (const a of ALERT_KINDS) {
      if (!alerts[a.name]) throw new EventMapError('$.alerts', `missing alert '${a.name}' (index ${a.index}) required by kind 'alert'`);
    }
  }

  return { version: 1, kinds, weapons, weaponDefault, impacts, deaths, airDeath, structureCollapse, commanderDeath, alerts };
}

// ---------------------------------------------------------------------------------------------
// Lookups (pure; the router calls them when building its caches, not per event)
// ---------------------------------------------------------------------------------------------

/** Sound of a weapon ref, falling back to `weaponDefault`; null = silent. */
export function weaponSound(map: EventSoundMap, ref: string | undefined): SoundRef | null {
  if (ref !== undefined) {
    const w = map.weapons[ref];
    if (w) return w;
  }
  return map.weaponDefault;
}

/** Impact family of a weapon ref (default family for unknown refs). */
export function impactFamilyOf(map: EventSoundMap, ref: string | undefined): string {
  const w = ref === undefined ? undefined : map.weapons[ref];
  return w ? w.impact : map.impacts.defaultFamily;
}

/**
 * Impact sound for `family` and surface index (projectileImpact aux). Unknown surfaces and
 * surfaces missing in the family use `ground`; an explicit null means silent.
 */
export function impactSound(map: EventSoundMap, family: string, surface: number): SoundRef | null {
  const fam = map.impacts.families[family] ?? map.impacts.families[map.impacts.defaultFamily]!;
  const name = IMPACT_SURFACES[surface];
  if (name !== undefined) {
    const s = fam[name];
    if (s !== undefined) return s;
  }
  return fam.ground ?? null;
}

/** Death sound for size class (aux, clamped to 0..3) and event flags. */
export function deathSound(map: EventSoundMap, sizeClass: number, flags: number): SoundRef {
  if ((flags & EVENT_FLAG_AIR) !== 0 && map.airDeath) return map.airDeath;
  const c = sizeClass < 0 ? 0 : sizeClass >= DEATH_SIZE_CLASSES.length ? DEATH_SIZE_CLASSES.length - 1 : sizeClass | 0;
  return map.deaths[DEATH_SIZE_CLASSES[c]!];
}

/** Structure collapse that follows a death with these flags/size, or null. */
export function collapseAfterDeath(map: EventSoundMap, sizeClass: number, flags: number): StructureCollapse | null {
  const c = map.structureCollapse;
  if (!c || (flags & EVENT_FLAG_STRUCTURE) === 0 || (flags & EVENT_FLAG_AIR) !== 0) return null;
  return sizeClass >= c.minSizeClass ? c : null;
}

/** Alert name + rule for an `alert` event's aux, or null for an unknown index. */
export function alertForIndex(map: EventSoundMap, aux: number): { readonly name: string; readonly rule: AlertRule } | null {
  const k = ALERT_KINDS[aux];
  if (!k) return null;
  const rule = map.alerts[k.name];
  return rule ? { name: k.name, rule } : null;
}

/** How a referenced sound is used (validation: one-shot contexts must not reference loops). */
export type SoundUse = 'oneShot' | 'loop' | 'alert';

/** One sound reference inside a map, with its JSON path. */
export interface SoundReference {
  readonly path: string;
  readonly sound: string;
  readonly use: SoundUse;
}

/** Every sound the map references (for validation and coverage checks). */
export function referencedSounds(map: EventSoundMap): SoundReference[] {
  const out: SoundReference[] = [];
  const one = (path: string, s: SoundRef | null): void => {
    if (s) out.push({ path, sound: s.sound, use: 'oneShot' });
  };
  for (const k of SIM_EVENT_KINDS) {
    const r = map.kinds[k];
    if (r.route === 'sfx' && r.sound !== null) out.push({ path: `$.kinds.${k}.sound`, sound: r.sound, use: 'oneShot' });
    one(`$.kinds.${k}.then`, r.then);
  }
  for (const [ref, w] of Object.entries(map.weapons)) {
    one(`$.weapons.${ref}`, w);
    if (w.burst) {
      out.push({ path: `$.weapons.${ref}.burst.loop`, sound: w.burst.loop, use: 'loop' });
      if (w.burst.spin !== null) out.push({ path: `$.weapons.${ref}.burst.spin`, sound: w.burst.spin, use: 'oneShot' });
    }
  }
  one('$.weaponDefault', map.weaponDefault);
  for (const [name, fam] of Object.entries(map.impacts.families)) {
    for (const surface of IMPACT_SURFACES) one(`$.impacts.families.${name}.${surface}`, fam[surface] ?? null);
  }
  for (const c of DEATH_SIZE_CLASSES) one(`$.deaths.${c}`, map.deaths[c]);
  one('$.airDeath', map.airDeath);
  one('$.structureCollapse', map.structureCollapse);
  one('$.commanderDeath', map.commanderDeath);
  for (const [name, a] of Object.entries(map.alerts)) out.push({ path: `$.alerts.${name}`, sound: a.sound, use: 'alert' });
  return out;
}
