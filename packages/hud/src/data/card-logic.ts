/**
 * Command card logic (ui.md §5.6): which page, which unit per grid key, tech stripes, locks, hotbuild cycle.
 * Derived only from the generated roster and build table; components (p4) render the result and never
 * re-derive it from the roster.
 */
import type { CardPage } from '../model/card.ts';
import { SLOT_CODES } from '../ui/keys.ts';
import type { SlotCode } from '../ui/keys.ts';
import { BUILD_TABLE } from './build-table.gen.ts';
import { ROSTER, findUnit } from './roster.ts';
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

// -----------------------------------------------------------------------------------------------------------
// Static tables (computed once from the generated data)

const MVP = ROSTER.filter((u) => !u.postMvp);

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

/** True if selecting the type opens a build or production page (engineer, commander, factory). */
export function isBuilderType(typeId: string): boolean {
  const u = findUnit(typeId);
  return u !== undefined && !u.postMvp && (has(u, 'ENGINEER') || has(u, 'COMMAND') || has(u, 'FACTORY'));
}

/** Build menu a builder opens, or null for non-builders. */
export function builderMenu(typeId: string): CardMenu | null {
  const u = findUnit(typeId);
  if (u === undefined || !isBuilderType(u.id)) return null;
  if (has(u, 'FACTORY')) {
    if (has(u, 'AIR')) return 'Luftwerk';
    if (has(u, 'LAND')) return 'Landwerk';
    return null;
  }
  return 'Bau';
}

/** Types a builder can build directly (roster order, MVP only). */
export function buildableBy(builderTypeId: string): readonly string[] {
  const u = findUnit(builderTypeId);
  if (u === undefined) return [];
  const list = BUILD_TABLE[u.id] ?? [];
  return list.filter((id) => findUnit(id)?.postMvp === false);
}

/** True if any of the builders can build `typeId` directly. */
export function canBuild(builderTypeIds: readonly string[], typeId: string): boolean {
  const target = findUnit(typeId);
  if (target === undefined) return false;
  return builderTypeIds.some((b) => buildableBy(b).includes(target.id));
}

const MENU_BUILDERS: Readonly<Record<CardMenu, readonly string[]>> = {
  Bau: MVP.filter((u) => builderMenu(u.id) === 'Bau').map((u) => u.id),
  Landwerk: MVP.filter((u) => builderMenu(u.id) === 'Landwerk').map((u) => u.id),
  Luftwerk: MVP.filter((u) => builderMenu(u.id) === 'Luftwerk').map((u) => u.id),
};

function unionBuildable(builders: readonly string[]): ReadonlySet<string> {
  const out = new Set<string>();
  for (const b of builders) for (const id of buildableBy(b)) out.add(id);
  return out;
}

const CLASS_BUILDABLE: Readonly<Record<CardMenu, ReadonlySet<string>>> = {
  Bau: unionBuildable(MENU_BUILDERS.Bau),
  Landwerk: unionBuildable(MENU_BUILDERS.Landwerk),
  Luftwerk: unionBuildable(MENU_BUILDERS.Luftwerk),
};

/** MVP units whose hotbuild role sits on `slot` of `menu`, ascending by tier (roster order within a tier). */
function roleVariants(menu: CardMenu, letter: RosterSlot): readonly UnitRecord[] {
  return MVP.filter((u) => u.hotbuild !== null && u.hotbuild.menu === menu && u.hotbuild.slot === letter)
    .map((u, i) => ({ u, i }))
    .sort((a, b) => a.u.tech - b.u.tech || a.i - b.i)
    .map((x) => x.u);
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
export function menuMaxTab(menu: CardMenu): number {
  let max = 0;
  for (const id of CLASS_BUILDABLE[menu]) {
    const u = findUnit(id);
    if (u !== undefined && u.hotbuild?.menu === menu && u.tech > max) max = u.tech;
  }
  return max;
}

/** Highest tier `builder` can build directly within its menu (rank for mixed selections). */
function builderReach(builderTypeId: string): number {
  const menu = builderMenu(builderTypeId);
  let max = 0;
  for (const id of buildableBy(builderTypeId)) {
    const u = findUnit(id);
    if (u !== undefined && u.hotbuild?.menu === menu && u.tech > max) max = u.tech;
  }
  return max;
}

function rosterIndex(typeId: string): number {
  const u = findUnit(typeId);
  return u === undefined ? Number.MAX_SAFE_INTEGER : ROSTER.indexOf(u);
}

function uniqueKnown(typeIds: readonly string[]): UnitRecord[] {
  const out: UnitRecord[] = [];
  for (const id of typeIds) {
    const u = findUnit(id);
    if (u !== undefined && !out.includes(u)) out.push(u);
  }
  return out;
}

/**
 * Highest-ranked builder of a selection (C8): highest direct tier first, then mobile builders before
 * factories (engineers assist factories, not the other way round), the Reeve before engineers, roster order.
 */
export function headBuilder(typeIds: readonly string[]): string | null {
  const builders = uniqueKnown(typeIds).filter((u) => isBuilderType(u.id));
  if (builders.length === 0) return null;
  const score = (u: UnitRecord): readonly number[] => [
    builderReach(u.id),
    has(u, 'FACTORY') ? 0 : 1,
    has(u, 'COMMAND') ? 1 : 0,
    -rosterIndex(u.id),
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

function buildGroup(typeIds: readonly string[]): BuildGroup | null {
  const headId = headBuilder(typeIds);
  if (headId === null) return null;
  const menu = builderMenu(headId)!;
  const group = uniqueKnown(typeIds)
    .filter((u) => builderMenu(u.id) === menu)
    .map((u) => u.id);
  return { menu, head: findUnit(headId)!, buildable: unionBuildable(group) };
}

function clampTab(tab: number | null | undefined, maxTab: number, defaultTab: number): number {
  if (maxTab === 0) return 0;
  if (tab === null || tab === undefined || !Number.isFinite(tab)) return defaultTab;
  return Math.min(maxTab, Math.max(1, Math.trunc(tab)));
}

function structurePage(structures: readonly UnitRecord[]): CardPageSpec {
  // Highest tier first, then roster order.
  const head = [...structures].sort((a, b) => b.tech - a.tech || ROSTER.indexOf(a) - ROSTER.indexOf(b))[0]!;
  const cells = SLOT_CODES.map((slot): CardCellSpec => {
    const letter = rosterSlot(slot);
    if (letter === 'B' && head.upgradesTo !== null) {
      const target = findUnit(head.upgradesTo)!;
      return { slot, typeId: target.id, tiers: [], roleTiers: [], shownTier: target.tech, locked: null, kind: 'upgrade' };
    }
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
 * @param selectedTypeIds type ids of the selection (duplicates and unknown ids are ignored)
 * @param tab requested tech tab; null/undefined = highest directly buildable tier
 */
export function resolveCardPage(selectedTypeIds: readonly string[], tab?: number | null): CardPageSpec {
  const units = uniqueKnown(selectedTypeIds);
  if (units.length === 0) return emptyPage('empty', null);
  const group = buildGroup(selectedTypeIds);
  if (group === null) {
    if (units.every((u) => u.structure)) return structurePage(units);
    return emptyPage('orders', null);
  }
  const { menu, head, buildable } = group;
  const classBuildable = CLASS_BUILDABLE[menu];
  const isFactory = has(head, 'FACTORY');
  const maxTab = menuMaxTab(menu);

  const perSlot = SLOT_CODES.map((slot) => {
    const variants = roleVariants(menu, rosterSlot(slot));
    return { slot, variants, direct: tiersIn(variants, buildable), role: tiersIn(variants, classBuildable) };
  });
  let defaultTab = 1;
  for (const s of perSlot) for (const t of s.direct) if (t > defaultTab) defaultTab = t;
  if (defaultTab > maxTab) defaultTab = maxTab;
  const effTab = clampTab(tab, maxTab, defaultTab);

  const cells = perSlot.map(({ slot, variants, direct, role }): CardCellSpec => {
    if (isFactory && rosterSlot(slot) === 'B' && variants.length === 0) {
      if (head.upgradesTo === null) return emptyCell(slot);
      const target = findUnit(head.upgradesTo)!;
      return { slot, typeId: target.id, tiers: [], roleTiers: [], shownTier: target.tech, locked: null, kind: 'upgrade' };
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
  slot: SlotCode,
  currentTier: number | null,
  builderTypeIds: readonly string[],
): HotbuildStep | null {
  const group = buildGroup(builderTypeIds);
  if (group === null) return null;
  const variants = roleVariants(group.menu, rosterSlot(slot));
  const direct = tiersIn(variants, group.buildable);
  if (direct.length === 0) return null;
  const desc = [...direct].sort((a, b) => b - a);
  const idx = currentTier === null ? -1 : desc.indexOf(currentTier);
  const tier = idx < 0 ? desc[0]! : desc[(idx + 1) % desc.length]!;
  return { tier, typeId: variantAt(variants, group.buildable, tier)!.id };
}
