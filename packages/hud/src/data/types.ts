/**
 * Types of the generated roster/icon tables (scripts/gen-data.ts writes *.gen.ts against these).
 * Pure data, no DOM, no workspace imports (dependency rule hud-deps).
 */

/** Text in both source languages (DE is the source, EN the translation). */
export interface LocalizedText {
  readonly de: string;
  readonly en: string;
}

/** Hotbuild menus of the MVP command card (roster.json → hotbuildGrid). */
export type HotbuildMenu = 'Bau' | 'Landwerk' | 'Luftwerk' | 'Großguss';

/** Roster slot letter (physical key position, `Z` = KeyZ, labelled `Y` on German keyboards). */
export type RosterSlot = 'Q' | 'W' | 'E' | 'R' | 'T' | 'A' | 'S' | 'D' | 'F' | 'G' | 'Z' | 'X' | 'C' | 'V' | 'B';

export interface UnitHotbuild {
  readonly menu: HotbuildMenu;
  /** Grid slot of the role. Upgrade-only tiers inherit the slot of their upgrade chain. */
  readonly slot: RosterSlot;
  /** True if roster.json marks the slot as reachable via the upgrade command (e.g. `Q (Upgrade: Command Card)`). */
  readonly viaUpgrade: boolean;
}

export interface UnitEconomy {
  /** Build cost (for upgrade tiers: the upgrade cost, FA semantics). */
  readonly mass: number;
  readonly energy: number;
  /** Build time in BP-seconds (seconds = buildTime / build power of the builder). */
  readonly buildTime: number;
  /** Own build power (0 = cannot build/assist). */
  readonly buildPower: number;
  /** Production per second. */
  readonly massPerS: number;
  readonly energyPerS: number;
  readonly storageMass: number;
  readonly storageEnergy: number;
  /** Permanent energy upkeep per second (radar, shield, mex …). */
  readonly upkeepEnergyPerS: number;
}

export interface UnitShield {
  readonly hp: number;
  readonly radius: number;
  readonly regenPerS: number;
  readonly upkeepEnergyPerS: number;
}

/** Weapon summary: DPS sum without tap shot/overcharge, maximum range. */
export interface UnitWeapons {
  readonly count: number;
  readonly dps: number;
  readonly range: number;
  readonly rangeMin: number;
  /** Target layers of all counted weapons (sorted, e.g. `['air']`, `['land']`). */
  readonly layers: readonly string[];
}

/** One roster entry (generated from docs/design/roster.json + scripts/unit-texts.json). */
export interface UnitRecord {
  /** Full type id, e.g. `core:lnd_t1_tank`. */
  readonly id: string;
  /** Id without the `core:` namespace, used in i18n keys (`unit.core.<key>.<field>`). */
  readonly key: string;
  readonly name: LocalizedText;
  readonly role: LocalizedText;
  /** Cell label (≤ 10 characters, without roman tier). */
  readonly short: LocalizedText;
  /** Tooltip description (≤ 2 sentences). */
  readonly desc: LocalizedText;
  /** Adjacency effects (E11) or null. */
  readonly adjacency: LocalizedText | null;
  /** Tech tier 1–3, 0 = commander, 4 = experimental. */
  readonly tech: number;
  readonly group: string;
  readonly icon: string;
  readonly postMvp: boolean;
  readonly ms9Core: boolean;
  readonly msFirst: string;
  readonly categories: readonly string[];
  readonly structure: boolean;
  /** Movement layer (`land`, `air`) or `structure`. */
  readonly layer: string;
  readonly footprint: readonly [number, number];
  readonly hotbuild: UnitHotbuild | null;
  readonly economy: UnitEconomy;
  readonly health: { readonly max: number; readonly regenPerS: number };
  readonly shield: UnitShield | null;
  readonly weapons: UnitWeapons;
  /** WU/s, 0 for structures. */
  readonly speed: number;
  readonly vision: number;
  readonly radar: number;
  readonly upgradesTo: string | null;
  readonly upgradeFrom: string | null;
  /** Toggle abilities (C17), normalised ids such as `radar`, `shield`, `auto_tapshot`. */
  readonly toggles: readonly string[];
}
