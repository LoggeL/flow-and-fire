/**
 * Roster lookups, unit texts (P12 key schema unit.core.<id>.<field>) and derived stats/flow numbers.
 * Pure functions over the generated tables; no DOM, no workspace imports.
 */
import { pseudo } from '../i18n/pseudo.ts';
import type { Locale } from '../i18n/locale.ts';
import { ROSTER } from './roster.gen.ts';
import type { UnitRecord } from './types.ts';

export { ROSTER };

const BY_ID: Readonly<Record<string, UnitRecord>> = (() => {
  const out: Record<string, UnitRecord> = {};
  for (const u of ROSTER) out[u.id] = u;
  return out;
})();

/** Normalises `lnd_t1_tank` and `core:lnd_t1_tank` to the full id. */
export function normalizeTypeId(typeId: string): string {
  return typeId.includes(':') ? typeId : `core:${typeId}`;
}

/** Roster entry or undefined for unknown ids. */
export function findUnit(typeId: string): UnitRecord | undefined {
  return BY_ID[normalizeTypeId(typeId)];
}

/** Roster entry; throws for unknown ids (programming error in callers/demo data). */
export function getUnit(typeId: string): UnitRecord {
  const u = findUnit(typeId);
  if (u === undefined) throw new RangeError(`@faf/hud: unknown unit type '${typeId}'`);
  return u;
}

/** Units in scope of the MVP (without the post-MVP experimentals). */
export const MVP_UNITS: readonly UnitRecord[] = ROSTER.filter((u) => !u.postMvp);

/** Text fields of a unit. name/role come from roster.json, short/desc/adjacency(EN) from scripts/unit-texts.json. */
export type UnitTextField = 'name' | 'role' | 'short' | 'desc' | 'adjacency';

export const UNIT_TEXT_FIELDS: readonly UnitTextField[] = ['name', 'role', 'short', 'desc', 'adjacency'];

/** P12 key of a unit text (faction.md §7.3): `unit.core.<id>.<field>`, e.g. `unit.core.lnd_t1_tank.short`. */
export function unitTextKey(typeId: string, field: UnitTextField): string {
  const id = normalizeTypeId(typeId);
  const colon = id.indexOf(':');
  return `unit.${id.slice(0, colon)}.${id.slice(colon + 1)}.${field}`;
}

const pseudoCache: Record<string, string> = {};

/** Accent-only pseudo form (no padding): cell labels are bounded to 10 characters in every locale. */
function pseudoAccentOnly(s: string): string {
  const p = pseudo(s);
  // pseudo() returns `[accented~~~]`; keep the accented body only.
  return p.slice(1, p.length - 1).replace(/~+$/, '');
}

/**
 * Text of a unit in the given locale. `adjacency` is '' for units without adjacency effects.
 * Pseudo locale: German text through pseudo(); the length-bounded `short` field is accented only,
 * because ≤ 10 characters is a hard contract of the 58 px cell in every language (ui.md §5.6).
 */
export function unitText(typeId: string, field: UnitTextField, loc: Locale): string {
  const u = getUnit(typeId);
  const text = field === 'adjacency' ? u.adjacency : u[field];
  if (text === null) return '';
  if (loc === 'en') return text.en;
  if (loc === 'de') return text.de;
  const key = `${u.id}|${field}`;
  let p = pseudoCache[key];
  if (p === undefined) {
    p = field === 'short' ? pseudoAccentOnly(text.de) : pseudo(text.de);
    pseudoCache[key] = p;
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

export function unitStats(typeId: string): UnitStats {
  const u = getUnit(typeId);
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

/** Seconds to build `typeId` with build power `bp` (roster convention: buildTime / BP). Infinity for bp ≤ 0. */
export function buildTimeS(typeId: string, bp: number): number {
  if (!(bp > 0)) return Number.POSITIVE_INFINITY;
  return getUnit(typeId).economy.buildTime / bp;
}

/** Resource flow while building (ui.md §5.6/§5.12): cost / (buildTime / bp) per second. */
export interface FlowDemand {
  readonly massPerS: number;
  readonly energyPerS: number;
}

export function flowDemand(typeId: string, bp: number): FlowDemand {
  const u = getUnit(typeId);
  const bt = u.economy.buildTime;
  if (!(bp > 0) || !(bt > 0)) return { massPerS: 0, energyPerS: 0 };
  return { massPerS: (u.economy.mass * bp) / bt, energyPerS: (u.economy.energy * bp) / bt };
}

/** Upgrade target of a structure (B4/B8/U5) or null. */
export function upgradeTarget(typeId: string): string | null {
  return getUnit(typeId).upgradesTo;
}
