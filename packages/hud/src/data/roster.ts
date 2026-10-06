/**
 * Unit lookups, unit texts (P12 key schema unit.core.<id>.<field>) and derived stats/flow numbers over a
 * UnitCatalog (src/data/catalog.ts). Pure functions; no DOM, no workspace imports. Unknown type ids never
 * throw here (game data the HUD does not know yet, e.g. test or mod blueprints) – except `getUnit`, which is
 * meant for tests and demo data.
 */
import { pseudo } from '../i18n/pseudo.ts';
import { locale as localeSignal } from '../i18n/locale.ts';
import type { Locale } from '../i18n/locale.ts';
import { normalizeTypeId } from './catalog.ts';
import type { UnitCatalog } from './catalog.ts';
import type { UnitRecord } from './types.ts';

export { normalizeTypeId };

/** Catalog entry or undefined for unknown ids. */
export function findUnit(cat: UnitCatalog, typeId: string): UnitRecord | undefined {
  return cat.find(typeId);
}

/** Catalog entry; throws for unknown ids (tests and demo data only – components use findUnit). */
export function getUnit(cat: UnitCatalog, typeId: string): UnitRecord {
  const u = cat.find(typeId);
  if (u === undefined) throw new RangeError(`@faf/hud: unknown unit type '${typeId}' in catalog '${cat.label}'`);
  return u;
}

const MVP_CACHE = new WeakMap<UnitCatalog, readonly UnitRecord[]>();

/** Units in scope of the MVP (without the post-MVP experimentals), memoised per catalog. */
export function mvpUnits(cat: UnitCatalog): readonly UnitRecord[] {
  let list = MVP_CACHE.get(cat);
  if (list === undefined) {
    list = cat.units.filter((u) => !u.postMvp);
    MVP_CACHE.set(cat, list);
  }
  return list;
}

/** Text fields of a unit. name/role come from roster.json, short/desc/adjacency(EN) from scripts/unit-texts.json. */
export type UnitTextField = 'name' | 'role' | 'short' | 'desc' | 'adjacency';

export const UNIT_TEXT_FIELDS: readonly UnitTextField[] = ['name', 'role', 'short', 'desc', 'adjacency'];

/** P12 key of a unit text (faction.md §7.3): `unit.core.<id>.<field>`, e.g. `unit.core.lnd_t1_tank.short`. */
export function unitTextKey(typeId: string, field: UnitTextField): string {
  const id = normalizeTypeId(typeId);
  const colon = id.indexOf(':');
  return `unit.${id.slice(0, colon)}.${id.slice(colon + 1)}.${field}`;
}

const PSEUDO_CACHE = new WeakMap<UnitRecord, Partial<Record<UnitTextField, string>>>();

/** Accent-only pseudo form (no padding): cell labels are bounded to 10 characters in every locale. */
function pseudoAccentOnly(s: string): string {
  const p = pseudo(s);
  // pseudo() returns `[accented~~~]`; keep the accented body only.
  return p.slice(1, p.length - 1).replace(/~+$/, '');
}

/**
 * Text of a unit in the given locale. `adjacency`, `role` and `desc` are '' for unknown ids and units
 * without such a text; `name` and `short` fall back to the raw type id (never throws on unknown data).
 * Pseudo locale: German text through pseudo(); the length-bounded `short` field is accented only,
 * because ≤ 10 characters is a hard contract of the 58 px cell in every language (ui.md §5.6).
 */
export function unitText(cat: UnitCatalog, typeId: string, field: UnitTextField, loc: Locale): string {
  const u = cat.find(typeId);
  if (u === undefined) return field === 'name' || field === 'short' ? typeId : '';
  const text = field === 'adjacency' ? u.adjacency : u[field];
  if (text === null) return '';
  if (loc === 'en') return text.en;
  if (loc === 'de') return text.de;
  let perUnit = PSEUDO_CACHE.get(u);
  if (perUnit === undefined) {
    perUnit = {};
    PSEUDO_CACHE.set(u, perUnit);
  }
  let p = perUnit[field];
  if (p === undefined) {
    p = field === 'short' ? pseudoAccentOnly(text.de) : pseudo(text.de);
    perUnit[field] = p;
  }
  return p;
}

/** Stats shown in selection panel and tooltip (ui.md §5.5, §5.12). Upgrade tiers carry upgrade costs. */
export interface UnitStats {
  readonly hp: number;
  readonly regenPerS: number;
  readonly shieldHp: number;
  /** DPS sum without tap shot. */
  readonly dps: number;
  readonly range: number;
  readonly rangeMin: number;
  /** Target layers of the weapons (`land`, `air`). */
  readonly targetLayers: readonly string[];
  /** WU/s (0 for structures). */
  readonly speed: number;
  readonly vision: number;
  readonly radar: number;
  readonly buildPower: number;
  readonly mass: number;
  readonly energy: number;
  /** Raw build time (BP-seconds). */
  readonly buildTime: number;
  readonly storageMass: number;
  readonly storageEnergy: number;
  /** Production per second. */
  readonly massPerS: number;
  readonly energyPerS: number;
  /** Energy upkeep per second (unit + shield). */
  readonly upkeepEnergyPerS: number;
  readonly tech: number;
  readonly structure: boolean;
  readonly layer: string;
}

/** Stats of a unit, or null for ids the catalog does not know. */
export function unitStats(cat: UnitCatalog, typeId: string): UnitStats | null {
  const u = cat.find(typeId);
  if (u === undefined) return null;
  const e = u.economy;
  return {
    hp: u.health.max,
    regenPerS: u.health.regenPerS,
    shieldHp: u.shield?.hp ?? 0,
    dps: u.weapons.dps,
    range: u.weapons.range,
    rangeMin: u.weapons.rangeMin,
    targetLayers: u.weapons.layers,
    speed: u.speed,
    vision: u.vision,
    radar: u.radar,
    buildPower: e.buildPower,
    mass: e.mass,
    energy: e.energy,
    buildTime: e.buildTime,
    storageMass: e.storageMass,
    storageEnergy: e.storageEnergy,
    massPerS: e.massPerS,
    energyPerS: e.energyPerS,
    // Shield upkeep is part of economy.upkeepEnergyPerSec for structures; mobile shields only list it on the shield.
    upkeepEnergyPerS: e.upkeepEnergyPerS > 0 ? e.upkeepEnergyPerS : (u.shield?.upkeepEnergyPerS ?? 0),
    tech: u.tech,
    structure: u.structure,
    layer: u.layer,
  };
}

/** Seconds to build `typeId` with build power `bp` (buildTime / BP). Infinity for bp ≤ 0 or unknown ids. */
export function buildTimeS(cat: UnitCatalog, typeId: string, bp: number): number {
  const u = cat.find(typeId);
  if (!(bp > 0) || u === undefined) return Number.POSITIVE_INFINITY;
  return u.economy.buildTime / bp;
}

/** Resource flow while building (ui.md §5.6/§5.12): cost / (buildTime / bp) per second. */
export interface FlowDemand {
  readonly massPerS: number;
  readonly energyPerS: number;
}

/**
 * Flow demand of building `typeId` at build power `bp`; null for unknown ids. The formula is the FA build
 * rate (cost · bp / buildTime) – MS4 may replace it by the rules implementation through the catalog.
 */
export function flowDemand(cat: UnitCatalog, typeId: string, bp: number): FlowDemand | null {
  const u = cat.find(typeId);
  if (u === undefined) return null;
  const bt = u.economy.buildTime;
  if (!(bp > 0) || !(bt > 0)) return { massPerS: 0, energyPerS: 0 };
  return { massPerS: (u.economy.mass * bp) / bt, energyPerS: (u.economy.energy * bp) / bt };
}

/** Upgrade target of a structure (B4/B8/U5) or null (also for unknown ids). */
export function upgradeTarget(cat: UnitCatalog, typeId: string): string | null {
  return cat.find(typeId)?.upgradesTo ?? null;
}

/**
 * Full unit name in the given locale (default: the current UI locale). Unknown ids fall back to the raw id,
 * so the HUD never throws on game data it does not know yet (shared by top, selection, card and score).
 */
export function unitName(cat: UnitCatalog, typeId: string, loc: Locale = localeSignal.value): string {
  return unitText(cat, typeId, 'name', loc);
}
