/**
 * View of the 15 command card cells (ui.md §5.6, §5.8): combines the page spec from resolveCardPage
 * (src/data/card-logic.ts – the only source of which unit sits on which key) with the event-rate model
 * state (queue badges, placement, unit cap, order states). Pure; the components only render the result.
 */
import type { CardCellSpec, CardLock, CardPageSpec } from '../../data/card-logic.ts';
import { EMPTY_UNIT_CATALOG } from '../../data/catalog.ts';
import type { UnitCatalog } from '../../data/catalog.ts';
import type { CardPage } from '../../model/card.ts';
import {
  ABILITY_ICON,
  ORDER_DEFS,
  abilityOfToggle,
  fireStateAt,
  orderAtSlot,
  orderIcon,
  orderState,
} from '../../model/orders.ts';
import type { AbilityKind, OrderDisabledReason, OrderId, OrderStates } from '../../model/orders.ts';
import type { LineIconName } from '../../ui/icons.ts';
import type { SlotCode } from '../../ui/keys.ts';

export type CellKind = 'unit' | 'upgrade' | 'ability' | 'pause' | 'order' | 'empty';

/**
 * Tech stripe per tier 1–3 (ui.md §5.6): `on` = tier shown on the key (bright), `in` = the current builders
 * can build it directly, `out` = the role has it but the current builders cannot build it directly
 * (dimmed), `none` = the role has no such tier (gap).
 */
export type TierStripe = 'on' | 'in' | 'out' | 'none';

/** Why a cell is disabled (tooltip text): unit cap, an upgrade already running, or an order reason. */
export type CellDisabledReason = 'cap' | 'upgrading' | OrderDisabledReason;

export interface CellView {
  readonly slot: SlotCode;
  readonly kind: CellKind;
  /** Unit shown (unit: the buildable type; upgrade: the target; ability/pause: the structure). */
  readonly typeId: string | null;
  /** Order of an order cell (orders page), or the order behind structure ability/pause. */
  readonly orderId: OrderId | null;
  /** Physical key whose label the cell shows (self-destruct: `Delete`, ui.md §5.8 „Entf“). */
  readonly keyCode: string;
  /** Tech stripes (three entries) or null when the role has fewer than two tiers. */
  readonly stripes: readonly TierStripe[] | null;
  /** Tier of the shown unit (null for non-unit cells). */
  readonly tier: number | null;
  readonly lock: CardLock | null;
  readonly disabled: CellDisabledReason | null;
  /** Placement for this cell running, or its order armed (is-active). */
  readonly active: boolean;
  /** Queue count (replaces the stripes) or the count badge of an order (capable units). */
  readonly badge: number;
  /** Production progress stripe rendered (the value binds at 10 Hz without re-render). */
  readonly progress: boolean;
  /** Danger tone (self-destruct). */
  readonly danger: boolean;
  /** Self-destruct countdown running on this cell. */
  readonly countdown: boolean;
  /** Toggle state of order/ability/pause cells. */
  readonly toggle: 'on' | 'off' | 'mixed' | null;
  /** Fire state cycle index (dots) or null. */
  readonly cycle: number | null;
  /** Line icon of non-unit cells. */
  readonly icon: LineIconName | null;
  /** Ability kind for ability cells (name in the cell). */
  readonly ability: AbilityKind | null;
}

export interface CellInputs {
  readonly queueCounts: Readonly<Record<string, number>>;
  readonly armedSlot: SlotCode | null;
  readonly capReached: boolean;
  readonly orderStates: OrderStates;
  /** Remaining self-destruct seconds, null when idle. */
  readonly countdown: number | null;
  /** Unit catalog (ability of a selected structure); default: empty. */
  readonly units?: UnitCatalog | undefined;
}

export const NO_CELL_INPUTS: CellInputs = { queueCounts: {}, armedSlot: null, capReached: false, orderStates: {}, countdown: null };

const BASE: Omit<CellView, 'slot' | 'kind' | 'keyCode'> = {
  typeId: null,
  orderId: null,
  stripes: null,
  tier: null,
  lock: null,
  disabled: null,
  active: false,
  badge: 0,
  progress: false,
  danger: false,
  countdown: false,
  toggle: null,
  cycle: null,
  icon: null,
  ability: null,
};

/** Stripes for a unit cell: shown only when the role has at least two tiers (mockup rule, hud.js tiersFor). */
export function tierStripes(cell: Pick<CardCellSpec, 'roleTiers' | 'tiers' | 'shownTier'>): readonly TierStripe[] | null {
  if (cell.roleTiers.length < 2) return null;
  return [1, 2, 3].map((tier): TierStripe => {
    if (!cell.roleTiers.includes(tier)) return 'none';
    if (tier === cell.shownTier) return 'on';
    return cell.tiers.includes(tier) ? 'in' : 'out';
  });
}

function structureAbility(units: UnitCatalog, typeId: string | null): AbilityKind | null {
  const u = typeId === null ? undefined : units.find(typeId);
  if (u === undefined) return null;
  for (const toggle of u.toggles) {
    const a = abilityOfToggle(toggle);
    if (a !== null) return a;
  }
  return null;
}

function orderCell(slot: SlotCode, inputs: CellInputs): CellView {
  const def = orderAtSlot(slot);
  if (def === undefined) return { ...BASE, slot, kind: 'empty', keyCode: slot };
  const st = orderState(inputs.orderStates, def.id);
  const countdown = def.id === 'selfDestruct' && inputs.countdown !== null;
  return {
    ...BASE,
    slot,
    kind: 'order',
    orderId: def.id,
    keyCode: def.key ?? 'Delete',
    disabled: st.enabled ? null : (st.reason ?? 'noSelection'),
    active: st.armed === true,
    badge: st.badge !== undefined && st.badge > 0 ? st.badge : 0,
    danger: def.id === 'selfDestruct',
    countdown,
    toggle: def.behavior === 'toggle' ? (st.toggle ?? 'off') : null,
    cycle: def.behavior === 'cycle' ? fireCycleIndex(st.cycle) : null,
    icon: orderIcon(def.id, st),
    ability: def.id === 'ability' ? (st.ability ?? 'shield') : null,
  };
}

function fireCycleIndex(cycle: number | undefined): number {
  const s = fireStateAt(cycle);
  return s === 'free' ? 0 : s === 'return' ? 1 : 2;
}

function specCell(cell: CardCellSpec, page: CardPage, inputs: CellInputs): CellView {
  const { slot } = cell;
  switch (cell.kind) {
    case 'empty':
      return { ...BASE, slot, kind: 'empty', keyCode: slot };
    case 'upgrade': {
      const queued = cell.typeId !== null ? (inputs.queueCounts[cell.typeId] ?? 0) : 0;
      return {
        ...BASE,
        slot,
        kind: 'upgrade',
        typeId: cell.typeId,
        keyCode: slot,
        tier: cell.shownTier,
        icon: 'upgrade',
        progress: queued > 0,
        active: inputs.armedSlot === slot,
      };
    }
    case 'ability': {
      const st = orderState(inputs.orderStates, 'ability');
      const ability = st.ability ?? structureAbility(inputs.units ?? EMPTY_UNIT_CATALOG, cell.typeId) ?? 'shield';
      return {
        ...BASE,
        slot,
        kind: 'ability',
        typeId: cell.typeId,
        orderId: 'ability',
        keyCode: slot,
        toggle: st.toggle ?? 'off',
        icon: ABILITY_ICON[ability],
        ability,
      };
    }
    case 'pause': {
      const st = orderState(inputs.orderStates, 'pause');
      return {
        ...BASE,
        slot,
        kind: 'pause',
        typeId: cell.typeId,
        orderId: 'pause',
        keyCode: slot,
        toggle: st.toggle ?? 'off',
        icon: 'pause',
        disabled: st.enabled ? null : (st.reason ?? 'nothingToPause'),
      };
    }
    case 'unit': {
      const typeId = cell.typeId;
      const queued = typeId !== null && cell.locked === null ? (inputs.queueCounts[typeId] ?? 0) : 0;
      const cap = inputs.capReached && cell.locked === null && (page === 'build' || page === 'production');
      return {
        ...BASE,
        slot,
        kind: 'unit',
        typeId,
        keyCode: slot,
        stripes: queued > 0 ? null : tierStripes(cell),
        tier: cell.shownTier,
        lock: cell.locked,
        disabled: cap ? 'cap' : null,
        active: inputs.armedSlot === slot && cell.locked === null,
        badge: queued,
        progress: page === 'production' && queued > 0,
      };
    }
  }
}

/** The 15 cell views of a page in SLOT_CODES order. */
export function cellViews(spec: CardPageSpec, inputs: CellInputs = NO_CELL_INPUTS): readonly CellView[] {
  if (spec.page === 'orders') return spec.cells.map((c) => orderCell(c.slot, inputs));
  return spec.cells.map((c) => specCell(c, spec.page, inputs));
}

/** True if a click or key on the cell may issue a command (not empty, locked or disabled). */
export function cellActionable(v: CellView): boolean {
  return v.kind !== 'empty' && v.lock === null && v.disabled === null;
}

/** Orders in grid order (for the order bar and tests). */
export const ORDER_IDS_IN_GRID: readonly OrderId[] = ORDER_DEFS.map((d) => d.id);
