/**
 * Command card logic (ui.md §5.6): which page, which unit per grid key, tech stripes, locks, hotbuild cycle.
 * Derived only from a UnitCatalog (units + build table, src/data/catalog.ts); the per-catalog tables are
 * memoised on the catalog object. Components (p4) render the result and never re-derive it from unit data.
 */
import type { CardPage } from '../model/card.ts';
import { SLOT_CODES } from '../ui/keys.ts';
import type { SlotCode } from '../ui/keys.ts';
import type { UnitCatalog } from './catalog.ts';
import type { RosterSlot, UnitRecord } from './types.ts';

/** Build menus of the MVP card (Großguss/T4 is post-MVP). */
export type CardMenu = 'Bau' | 'Landwerk' | 'Luftwerk';

export type CardCellKind = 'unit' | 'upgrade' | 'ability' | 'pause' | 'empty';

/** Why a role cannot be built by the current builders; `tier` is the lowest tier that unlocks it. */
export interface CardLock {
  readonly reason: 'needBuilderTech' | 'needFactoryUpgrade';
  readonly tier: number;
}

export interface CardCellSpec {
  readonly slot: SlotCode;
  /** Unit shown in the cell (upgrade: the target type; ability/pause: the selected structure). */
  readonly typeId: string | null;
  /** Tiers of this role the CURRENT builders can build directly (ascending). */
  readonly tiers: readonly number[];
  /**
   * Tiers of this role any builder of the same kind can build directly (ascending) – the stripes of
   * ui.md §5.6 (“welche Stufen die Rolle auf dieser Taste direkt baubar hat, fehlende als Lücke”).
   */
  readonly roleTiers: readonly number[];
  /** Tier of `typeId` for unit/upgrade cells, null otherwise. */
  readonly shownTier: number | null;
  readonly locked: CardLock | null;
  readonly kind: CardCellKind;
}

export interface CardPageSpec {
  readonly page: CardPage;
  readonly menu: CardMenu | null;
  /** Head of the page: highest-ranked builder, the structure, or null (orders/empty). */
  readonly headTypeId: string | null;
  /** Number of tech tabs of the menu (0 = page without tabs). */
  readonly maxTab: number;
  /** Highest tier the current builders can build directly (preselected tab; 0 without tabs). */
  readonly defaultTab: number;
  /** Effective tab after clamping (0 without tabs). */
  readonly tab: number;
  /** 15 cells in SLOT_CODES order (QWERT / ASDFG / ZXCVB). */
  readonly cells: readonly CardCellSpec[];
}

/** Hotbuild cycle step: next tier of a role and the unit it builds. */
export interface HotbuildStep {
  readonly tier: number;
  readonly typeId: string;
}

/** Roster slot letter of a grid key (`KeyZ` → `Z`). */
export function rosterSlot(slot: SlotCode): RosterSlot {
  return slot.slice(3) as RosterSlot;
}

/** Grid key of a roster slot letter (`Z` → `KeyZ`). */
export function slotCodeOf(letter: RosterSlot): SlotCode {
  return `Key${letter}` as SlotCode;
}

function has(u: UnitRecord, cat: string): boolean {
  return u.categories.includes(cat);
}

/** Builder kind of a unit record (engineer, commander, factory) or null. */
function recordMenu(u: UnitRecord): CardMenu | null {
  if (u.postMvp || !(has(u, 'ENGINEER') || has(u, 'COMMAND') || has(u, 'FACTORY'))) return null;
  if (has(u, 'FACTORY')) {
    if (has(u, 'AIR')) return 'Luftwerk';
    if (has(u, 'LAND')) return 'Landwerk';
    return null;
  }
  return 'Bau';
}

// -----------------------------------------------------------------------------------------------------------
// Per-catalog tables (computed once per catalog object, never at module level)

interface CardTables {
  readonly mvp: readonly UnitRecord[];
  /** Direct MVP build list per builder id. */
  readonly buildable: Readonly<Record<string, readonly string[]>>;
  /** Union of what any builder of the menu can build directly. */
  readonly classBuildable: Readonly<Record<CardMenu, ReadonlySet<string>>>;
  /** MVP variants per `menu|slot`, ascending by tier (catalog order within a tier). */
  readonly variants: Readonly<Record<string, readonly UnitRecord[]>>;
}

const TABLES = new WeakMap<UnitCatalog, CardTables>();

function tables(cat: UnitCatalog): CardTables {
  let t = TABLES.get(cat);
  if (t !== undefined) return t;
  const mvp = cat.units.filter((u) => !u.postMvp);
  const buildable: Record<string, readonly string[]> = {};
  for (const [builder, list] of Object.entries(cat.buildTable)) {
    buildable[builder] = list.filter((id) => cat.find(id)?.postMvp === false);
  }
  const union = (menu: CardMenu): ReadonlySet<string> => {
    const out = new Set<string>();
    for (const u of mvp) if (recordMenu(u) === menu) for (const id of buildable[u.id] ?? []) out.add(id);
    return out;
  };
  const variants: Record<string, UnitRecord[]> = {};
  mvp.forEach((u) => {
    if (u.hotbuild === null) return;
    (variants[`${u.hotbuild.menu}|${u.hotbuild.slot}`] ??= []).push(u);
  });
  for (const list of Object.values(variants)) {
    const order = new Map(list.map((u, i) => [u, i]));
    list.sort((a, b) => a.tech - b.tech || order.get(a)! - order.get(b)!);
  }
  t = { mvp, buildable, classBuildable: { Bau: union('Bau'), Landwerk: union('Landwerk'), Luftwerk: union('Luftwerk') }, variants };
  TABLES.set(cat, t);
  return t;
}

/** True if selecting the type opens a build or production page (engineer, commander, factory). */
export function isBuilderType(cat: UnitCatalog, typeId: string): boolean {
  const u = cat.find(typeId);
  return u !== undefined && recordMenu(u) !== null;
}

/** Build menu a builder opens, or null for non-builders and unknown ids. */
export function builderMenu(cat: UnitCatalog, typeId: string): CardMenu | null {
  const u = cat.find(typeId);
  return u === undefined ? null : recordMenu(u);
}

/** Types a builder can build directly (catalog order, MVP only). */
export function buildableBy(cat: UnitCatalog, builderTypeId: string): readonly string[] {
  const u = cat.find(builderTypeId);
  if (u === undefined) return [];
  return tables(cat).buildable[u.id] ?? [];
}

/** True if any of the builders can build `typeId` directly. */
export function canBuild(cat: UnitCatalog, builderTypeIds: readonly string[], typeId: string): boolean {
  const target = cat.find(typeId);
  if (target === undefined) return false;
  return builderTypeIds.some((b) => buildableBy(cat, b).includes(target.id));
}

function unionBuildable(cat: UnitCatalog, builders: readonly string[]): ReadonlySet<string> {
  const out = new Set<string>();
  for (const b of builders) for (const id of buildableBy(cat, b)) out.add(id);
  return out;
}

/** MVP units whose hotbuild role sits on `slot` of `menu`, ascending by tier (catalog order within a tier). */
function roleVariants(cat: UnitCatalog, menu: CardMenu, letter: RosterSlot): readonly UnitRecord[] {
  return tables(cat).variants[`${menu}|${letter}`] ?? [];
}

function tiersIn(variants: readonly UnitRecord[], buildable: ReadonlySet<string>): number[] {
  const out: number[] = [];
  for (const v of variants) if (buildable.has(v.id) && !out.includes(v.tech)) out.push(v.tech);
  return out.sort((a, b) => a - b);
}

function variantAt(variants: readonly UnitRecord[], buildable: ReadonlySet<string>, tier: number): UnitRecord | undefined {
  return variants.find((v) => v.tech === tier && buildable.has(v.id)) ?? variants.find((v) => v.tech === tier);
}

/** Number of tabs of a menu: highest tier any builder of the menu can build directly. */
export function menuMaxTab(cat: UnitCatalog, menu: CardMenu): number {
  let max = 0;
  for (const id of tables(cat).classBuildable[menu]) {
    const u = cat.find(id);
    if (u !== undefined && u.hotbuild?.menu === menu && u.tech > max) max = u.tech;
  }
  return max;
}

/** Highest tier `builder` can build directly within its menu (rank for mixed selections). */
function builderReach(cat: UnitCatalog, builderTypeId: string): number {
  const menu = builderMenu(cat, builderTypeId);
  let max = 0;
  for (const id of buildableBy(cat, builderTypeId)) {
    const u = cat.find(id);
    if (u !== undefined && u.hotbuild?.menu === menu && u.tech > max) max = u.tech;
  }
  return max;
}

function catalogIndex(cat: UnitCatalog, typeId: string): number {
  const i = cat.indexOf(typeId);
  return i < 0 ? Number.MAX_SAFE_INTEGER : i;
}

function uniqueKnown(cat: UnitCatalog, typeIds: readonly string[]): UnitRecord[] {
  const out: UnitRecord[] = [];
  for (const id of typeIds) {
    const u = cat.find(id);
    if (u !== undefined && !out.includes(u)) out.push(u);
  }
  return out;
}

/**
 * Highest-ranked builder of a selection (C8): highest direct tier first, then mobile builders before
 * factories (engineers assist factories, not the other way round), the Reeve before engineers, catalog order.
 */
export function headBuilder(cat: UnitCatalog, typeIds: readonly string[]): string | null {
  const builders = uniqueKnown(cat, typeIds).filter((u) => recordMenu(u) !== null);
  if (builders.length === 0) return null;
  const score = (u: UnitRecord): readonly number[] => [
    builderReach(cat, u.id),
    has(u, 'FACTORY') ? 0 : 1,
    has(u, 'COMMAND') ? 1 : 0,
    -catalogIndex(cat, u.id),
  ];
  let best = builders[0]!;
  for (const u of builders.slice(1)) {
    const a = score(u);
    const b = score(best);
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        if (a[i]! > b[i]!) best = u;
        break;
      }
    }
  }
  return best.id;
}

function emptyCell(slot: SlotCode): CardCellSpec {
  return { slot, typeId: null, tiers: [], roleTiers: [], shownTier: null, locked: null, kind: 'empty' };
}

function emptyPage(page: CardPage, headTypeId: string | null): CardPageSpec {
  return { page, menu: null, headTypeId, maxTab: 0, defaultTab: 0, tab: 0, cells: SLOT_CODES.map(emptyCell) };
}

interface BuildGroup {
  readonly menu: CardMenu;
  readonly head: UnitRecord;
  readonly buildable: ReadonlySet<string>;
}

function buildGroup(cat: UnitCatalog, typeIds: readonly string[]): BuildGroup | null {
  const headId = headBuilder(cat, typeIds);
  if (headId === null) return null;
  const head = cat.find(headId)!;
  const menu = recordMenu(head)!;
  const group = uniqueKnown(cat, typeIds)
    .filter((u) => recordMenu(u) === menu)
    .map((u) => u.id);
  return { menu, head, buildable: unionBuildable(cat, group) };
}

function clampTab(tab: number | null | undefined, maxTab: number, defaultTab: number): number {
  if (maxTab === 0) return 0;
  if (tab === null || tab === undefined || !Number.isFinite(tab)) return defaultTab;
  return Math.min(maxTab, Math.max(1, Math.trunc(tab)));
}

function upgradeCell(cat: UnitCatalog, slot: SlotCode, targetId: string): CardCellSpec {
  const target = cat.find(targetId);
  // An upgrade target missing from the catalog is still shown (raw id as name), without a tier.
  return { slot, typeId: target?.id ?? targetId, tiers: [], roleTiers: [], shownTier: target?.tech ?? null, locked: null, kind: 'upgrade' };
}

function structurePage(cat: UnitCatalog, structures: readonly UnitRecord[]): CardPageSpec {
  // Highest tier first, then catalog order.
  const head = [...structures].sort((a, b) => b.tech - a.tech || catalogIndex(cat, a.id) - catalogIndex(cat, b.id))[0]!;
  const cells = SLOT_CODES.map((slot): CardCellSpec => {
    const letter = rosterSlot(slot);
    if (letter === 'B' && head.upgradesTo !== null) return upgradeCell(cat, slot, head.upgradesTo);
    if (letter === 'G' && head.toggles.length > 0) {
      return { slot, typeId: head.id, tiers: [], roleTiers: [], shownTier: null, locked: null, kind: 'ability' };
    }
    const pausable = head.upgradesTo !== null || head.toggles.length > 0 || head.economy.upkeepEnergyPerS > 0;
    if (letter === 'D' && pausable) {
      return { slot, typeId: head.id, tiers: [], roleTiers: [], shownTier: null, locked: null, kind: 'pause' };
    }
    return emptyCell(slot);
  });
  return { page: 'structure', menu: null, headTypeId: head.id, maxTab: 0, defaultTab: 0, tab: 0, cells };
}

/**
 * Resolves the command card for a selection (ui.md §5.6).
 * @param cat unit catalog of the match
 * @param selectedTypeIds type ids of the selection (duplicates and unknown ids are ignored)
 * @param tab requested tech tab; null/undefined = highest directly buildable tier
 */
export function resolveCardPage(cat: UnitCatalog, selectedTypeIds: readonly string[], tab?: number | null): CardPageSpec {
  const units = uniqueKnown(cat, selectedTypeIds);
  if (units.length === 0) return emptyPage(selectedTypeIds.length === 0 ? 'empty' : 'orders', null);
  const group = buildGroup(cat, selectedTypeIds);
  if (group === null) {
    if (units.every((u) => u.structure)) return structurePage(cat, units);
    return emptyPage('orders', null);
  }
  const { menu, head, buildable } = group;
  const classBuildable = tables(cat).classBuildable[menu];
  const isFactory = has(head, 'FACTORY');
  const maxTab = menuMaxTab(cat, menu);

  const perSlot = SLOT_CODES.map((slot) => {
    const variants = roleVariants(cat, menu, rosterSlot(slot));
    return { slot, variants, direct: tiersIn(variants, buildable), role: tiersIn(variants, classBuildable) };
  });
  let defaultTab = 1;
  for (const s of perSlot) for (const t of s.direct) if (t > defaultTab) defaultTab = t;
  if (defaultTab > maxTab) defaultTab = maxTab;
  const effTab = clampTab(tab, maxTab, defaultTab);

  const cells = perSlot.map(({ slot, variants, direct, role }): CardCellSpec => {
    if (isFactory && rosterSlot(slot) === 'B' && variants.length === 0) {
      if (head.upgradesTo === null) return emptyCell(slot);
      return upgradeCell(cat, slot, head.upgradesTo);
    }
    if (direct.length > 0) {
      // Highest tier ≤ tab; keys without a variant in that tier show a lower one, never a gap. A role whose
      // lowest direct tier lies above the tab shows that tier (positions never change, only tiers).
      let shown = direct[0]!;
      for (const t of direct) if (t <= effTab) shown = t;
      const v = variantAt(variants, buildable, shown)!;
      return { slot, typeId: v.id, tiers: direct, roleTiers: role, shownTier: shown, locked: null, kind: 'unit' };
    }
    if (role.length > 0) {
      const tier = role[0]!;
      const v = variantAt(variants, classBuildable, tier)!;
      return {
        slot,
        typeId: v.id,
        tiers: [],
        roleTiers: role,
        shownTier: tier,
        locked: { reason: isFactory ? 'needFactoryUpgrade' : 'needBuilderTech', tier },
        kind: 'unit',
      };
    }
    return emptyCell(slot);
  });
  return {
    page: isFactory ? 'production' : 'build',
    menu,
    headTypeId: head.id,
    maxTab,
    defaultTab,
    tab: effTab,
    cells,
  };
}

/**
 * Hotbuild cycle (roster.json hotbuildGrid.rule): pressing the same key again changes only the tier of the
 * role, never the type; highest buildable tier first, then downwards, then wrapping to the highest.
 * Returns null if the builders cannot build the role on `slot` directly.
 */
export function nextHotbuildTier(
  cat: UnitCatalog,
  slot: SlotCode,
  currentTier: number | null,
  builderTypeIds: readonly string[],
): HotbuildStep | null {
  const group = buildGroup(cat, builderTypeIds);
  if (group === null) return null;
  const variants = roleVariants(cat, group.menu, rosterSlot(slot));
  const direct = tiersIn(variants, group.buildable);
  if (direct.length === 0) return null;
  const desc = [...direct].sort((a, b) => b - a);
  const idx = currentTier === null ? -1 : desc.indexOf(currentTier);
  const tier = idx < 0 ? desc[0]! : desc[(idx + 1) % desc.length]!;
  return { tier, typeId: variantAt(variants, group.buildable, tier)!.id };
}
