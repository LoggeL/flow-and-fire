/**
 * Unit catalog: the only source of unit data (stats, costs, tech, icon, hotbuild slot, buildable-by, texts)
 * inside @faf/hud. The game builds it from its blueprints (PLAN §3.9: view.json + content/locales, mods and
 * a second faction are pure data) and hands it over through `HudModel.units`; the gallery, tests and
 * benchmarks use the generated demo catalog (src/demo/catalog.ts). No module-level unit tables: everything
 * derived from a catalog (card tables, pseudo texts) is memoised per catalog object.
 */
import type { UnitRecord } from './types.ts';

/** Plain catalog data as the producer hands it over. */
export interface UnitCatalogSource {
  /** Units in display order (roster order: selection panel, score, key legend). */
  readonly units: readonly UnitRecord[];
  /**
   * Builder type id → type ids it can build directly (evaluated buildableBy of the blueprints, same order as
   * `units`). Upgrade-only tiers never appear; they are reached through `UnitRecord.upgradesTo`.
   */
  readonly buildTable: Readonly<Record<string, readonly string[]>>;
}

/** Immutable, indexed catalog (create with `createUnitCatalog`). Identity is the memoisation key. */
export interface UnitCatalog extends UnitCatalogSource {
  /** Short label for diagnostics (`demo`, `empty`, `match:…`). */
  readonly label: string;
  /** Entry for a full or short type id (`core:lnd_t1_tank` / `lnd_t1_tank`), undefined when unknown. */
  find(typeId: string): UnitRecord | undefined;
  /** Position in `units`, -1 when unknown. */
  indexOf(typeId: string): number;
}

/** Normalises `lnd_t1_tank` and `core:lnd_t1_tank` to the full id (short ids live in the core namespace). */
export function normalizeTypeId(typeId: string): string {
  return typeId.includes(':') ? typeId : `core:${typeId}`;
}

/**
 * Builds an indexed catalog. Duplicate ids are a producer error and throw at creation time (never while
 * rendering); build table entries that name unknown units are dropped, so the card never shows a gap it
 * cannot describe.
 */
export function createUnitCatalog(source: UnitCatalogSource, label = 'custom'): UnitCatalog {
  const byId: Record<string, UnitRecord> = Object.create(null) as Record<string, UnitRecord>;
  const index: Record<string, number> = Object.create(null) as Record<string, number>;
  source.units.forEach((u, i) => {
    if (byId[u.id] !== undefined) throw new RangeError(`@faf/hud: duplicate unit '${u.id}' in catalog '${label}'`);
    byId[u.id] = u;
    index[u.id] = i;
  });
  const buildTable: Record<string, readonly string[]> = {};
  for (const [builder, list] of Object.entries(source.buildTable)) {
    if (byId[builder] === undefined) continue;
    buildTable[builder] = Object.freeze(list.filter((id) => byId[id] !== undefined));
  }
  const units = Object.freeze([...source.units]);
  return Object.freeze({
    label,
    units,
    buildTable: Object.freeze(buildTable),
    find: (typeId: string): UnitRecord | undefined => byId[normalizeTypeId(typeId)],
    indexOf: (typeId: string): number => index[normalizeTypeId(typeId)] ?? -1,
  });
}

/** Catalog without units (default of a fresh HudModel until the game hands over its catalog). */
export const EMPTY_UNIT_CATALOG: UnitCatalog = createUnitCatalog({ units: [], buildTable: {} }, 'empty');
