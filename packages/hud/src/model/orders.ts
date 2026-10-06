import { signal } from '@preact/signals';
import type { Signal } from '@preact/signals';
import type { MsgKey } from '../i18n/tables.ts';
import type { LineIconName } from '../ui/icons.ts';
import type { SlotCode } from '../ui/keys.ts';

/** Order bar / order grid (ui.md §5.8). Structure on events, toggle states at 4 Hz. */

export type OrderId =
  | 'move'
  | 'patrol'
  | 'assist'
  | 'reclaim'
  | 'repair'
  | 'attack'
  | 'stop'
  | 'pause'
  | 'fireState'
  | 'ability'
  | 'attackGround'
  | 'tapshot'
  | 'formation'
  | 'selfDestruct';

/**
 * How an order reacts to its key or click (ui.md §5.8 "Verhalten"):
 * - armed: waits for a target (orderArmed, cursor changes; Esc/right click cancels, Shift keeps it armed)
 * - toggle: on/off, mixed selections show a hollow diamond
 * - cycle: steps through modes (fire state), shown as dots
 * - instant: executes at once (stop)
 * - countdown: 5 s countdown on button and unit, pressing again aborts (self-destruct)
 */
export type OrderBehavior = 'armed' | 'toggle' | 'cycle' | 'instant' | 'countdown';

export interface OrderDef {
  readonly id: OrderId;
  /** Fixed place in the 5 × 3 grid (also in the order bar, even when disabled). */
  readonly slot: SlotCode;
  /** Grid key; null for self-destruct (R4: only click or Ctrl+Delete, never B / Alt+B). */
  readonly key: SlotCode | null;
  readonly icon: LineIconName;
  readonly behavior: OrderBehavior;
  /** Feature ids from docs/features.json (first = main feature). */
  readonly features: readonly string[];
  /** Milestone of the first appearance (ui.md §11). */
  readonly milestone: string;
}

/** Order table of ui.md §5.8 in grid order (QWERT / ASDFG / ZXC + B place). V stays free. */
export const ORDER_DEFS: readonly OrderDef[] = [
  { id: 'move', slot: 'KeyQ', key: 'KeyQ', icon: 'move', behavior: 'armed', features: ['C4'], milestone: 'MS6' },
  { id: 'patrol', slot: 'KeyW', key: 'KeyW', icon: 'patrol', behavior: 'armed', features: ['C12'], milestone: 'MS11' },
  { id: 'assist', slot: 'KeyE', key: 'KeyE', icon: 'assist', behavior: 'armed', features: ['B2'], milestone: 'MS6' },
  { id: 'reclaim', slot: 'KeyR', key: 'KeyR', icon: 'reclaim', behavior: 'armed', features: ['E7', 'E12', 'E14'], milestone: 'MS5' },
  { id: 'repair', slot: 'KeyT', key: 'KeyT', icon: 'repair', behavior: 'armed', features: ['G4'], milestone: 'MS6' },
  { id: 'attack', slot: 'KeyA', key: 'KeyA', icon: 'attackmove', behavior: 'armed', features: ['C6'], milestone: 'MS8' },
  { id: 'stop', slot: 'KeyS', key: 'KeyS', icon: 'stop', behavior: 'instant', features: ['S3'], milestone: 'MS1' },
  { id: 'pause', slot: 'KeyD', key: 'KeyD', icon: 'pause', behavior: 'toggle', features: ['E13'], milestone: 'MS10' },
  { id: 'fireState', slot: 'KeyF', key: 'KeyF', icon: 'fire_free', behavior: 'cycle', features: ['K6'], milestone: 'MS7' },
  { id: 'ability', slot: 'KeyG', key: 'KeyG', icon: 'shield', behavior: 'toggle', features: ['C17'], milestone: 'MS10' },
  { id: 'attackGround', slot: 'KeyZ', key: 'KeyZ', icon: 'attackground', behavior: 'armed', features: ['K6'], milestone: 'MS7' },
  { id: 'tapshot', slot: 'KeyX', key: 'KeyX', icon: 'tapshot', behavior: 'armed', features: ['U8'], milestone: 'MS6' },
  { id: 'formation', slot: 'KeyC', key: 'KeyC', icon: 'formation', behavior: 'armed', features: ['C13'], milestone: 'MS13' },
  { id: 'selfDestruct', slot: 'KeyB', key: null, icon: 'selfdestruct', behavior: 'countdown', features: ['C18'], milestone: 'MS11' },
];

/**
 * Fixed grid places (ui.md §5.8 table). Self-destruct sits on the B place but has NO grid key
 * (R4: only click or Ctrl+Delete), so `key` is null there.
 */
export const ORDER_GRID: readonly { readonly id: OrderId; readonly slot: SlotCode; readonly key: SlotCode | null }[] = ORDER_DEFS.map(
  (d) => ({ id: d.id, slot: d.slot, key: d.key }),
);

export const ORDER_IDS: readonly OrderId[] = ORDER_DEFS.map((o) => o.id);

/** Order bar groups in grid order: [Q W E R T] [A S D F G] [Z X C B] (ui.md §4.2, §5.8). */
export const ORDER_BAR_GROUPS: readonly (readonly OrderId[])[] = [
  ['move', 'patrol', 'assist', 'reclaim', 'repair'],
  ['attack', 'stop', 'pause', 'fireState', 'ability'],
  ['attackGround', 'tapshot', 'formation', 'selfDestruct'],
];

const DEF_BY_ID = Object.fromEntries(ORDER_DEFS.map((d) => [d.id, d])) as Readonly<Record<OrderId, OrderDef>>;

export function orderDef(id: OrderId): OrderDef {
  return DEF_BY_ID[id];
}

/** Order on a grid place (V → undefined). */
export function orderAtSlot(slot: SlotCode): OrderDef | undefined {
  return ORDER_DEFS.find((d) => d.slot === slot);
}

/** Order bound to a grid key (B → undefined: self-destruct has no grid key). */
export function orderForKey(code: SlotCode): OrderDef | undefined {
  return ORDER_DEFS.find((d) => d.key === code);
}

/** Fire states of the cycle order (K6), in cycle order: fire at will → return fire → hold fire. */
export type FireState = 'free' | 'return' | 'hold';

export const FIRE_STATES: readonly FireState[] = ['free', 'return', 'hold'];

export const FIRE_STATE_ICON: Readonly<Record<FireState, LineIconName>> = {
  free: 'fire_free',
  return: 'fire_return',
  hold: 'fire_hold',
};

/** Fire state of a cycle index (wraps; negative or non-finite → first). */
export function fireStateAt(cycle: number | undefined): FireState {
  const n = FIRE_STATES.length;
  const i = cycle === undefined || !Number.isFinite(cycle) ? 0 : ((Math.trunc(cycle) % n) + n) % n;
  return FIRE_STATES[i]!;
}

/** Unit ability behind G (C17): roster toggles shield, radar and auto tap shot. */
export type AbilityKind = 'shield' | 'radar' | 'autoTapshot';

export const ABILITY_ICON: Readonly<Record<AbilityKind, LineIconName>> = {
  shield: 'shield',
  radar: 'radar',
  autoTapshot: 'tapshot',
};

/** Why an order is not available for the selection (tooltip text `ui.orders.reason.<reason>`). */
export type OrderDisabledReason =
  | 'immobile'
  | 'noEngineer'
  | 'noWeapon'
  | 'noArtillery'
  | 'noCommander'
  | 'tapshotCharge'
  | 'noAbility'
  | 'nothingToPause'
  | 'noFormation'
  | 'noSelection'
  | 'factoryOnly';

export const ORDER_DISABLED_REASONS: readonly OrderDisabledReason[] = [
  'immobile',
  'noEngineer',
  'noWeapon',
  'noArtillery',
  'noCommander',
  'tapshotCharge',
  'noAbility',
  'nothingToPause',
  'noFormation',
  'noSelection',
  'factoryOnly',
];

export interface OrderState {
  readonly enabled: boolean;
  /** Reason shown in the tooltip when disabled. */
  readonly reason?: OrderDisabledReason;
  /** Waiting for a target (is-armed). */
  readonly armed?: boolean;
  /** Toggle orders: on / off / mixed selection. */
  readonly toggle?: 'off' | 'on' | 'mixed';
  /** Cycle orders (fire state): current index into FIRE_STATES. */
  readonly cycle?: number;
  /** Count badge (e.g. units able to attack ground). */
  readonly badge?: number;
  /** Ability behind G (icon and name); default shield. */
  readonly ability?: AbilityKind;
}

/** State used for orders the game did not report (enabled, idle). */
export const DEFAULT_ORDER_STATE: OrderState = { enabled: true };

export type OrderStates = Readonly<Partial<Record<OrderId, OrderState>>>;

export interface OrdersSection {
  readonly states: Signal<OrderStates>;
  /** Remaining self-destruct countdown in seconds, null when idle. */
  readonly selfDestructCountdown: Signal<number | null>;
}

export function createOrdersSection(): OrdersSection {
  return {
    states: signal<OrderStates>({}),
    selfDestructCountdown: signal<number | null>(null),
  };
}

/** State of one order (missing → enabled, idle). */
export function orderState(states: OrderStates, id: OrderId): OrderState {
  return states[id] ?? DEFAULT_ORDER_STATE;
}

/** Order currently waiting for a target, or null. */
export function armedOrder(states: OrderStates): OrderId | null {
  for (const d of ORDER_DEFS) if (states[d.id]?.armed === true) return d.id;
  return null;
}

/** Duration of the self-destruct countdown in seconds (ui.md §5.8, C18). */
export const SELF_DESTRUCT_SECONDS = 5;

/** i18n keys of an order: full name (tooltip), short label (≤ 10 characters, 58-px cell), description. */
export interface OrderTextKeys {
  readonly name: MsgKey;
  readonly short: MsgKey;
  readonly desc: MsgKey;
}

/** Text keys per order (namespace orders, ui.md §10: `ui.order.<id>.short` is `ui.orders.<id>.short` here). */
export const ORDER_TEXT: Readonly<Record<OrderId, OrderTextKeys>> = {
  move: { name: 'ui.orders.move.name', short: 'ui.orders.move.short', desc: 'ui.orders.move.desc' },
  patrol: { name: 'ui.orders.patrol.name', short: 'ui.orders.patrol.short', desc: 'ui.orders.patrol.desc' },
  assist: { name: 'ui.orders.assist.name', short: 'ui.orders.assist.short', desc: 'ui.orders.assist.desc' },
  reclaim: { name: 'ui.orders.reclaim.name', short: 'ui.orders.reclaim.short', desc: 'ui.orders.reclaim.desc' },
  repair: { name: 'ui.orders.repair.name', short: 'ui.orders.repair.short', desc: 'ui.orders.repair.desc' },
  attack: { name: 'ui.orders.attack.name', short: 'ui.orders.attack.short', desc: 'ui.orders.attack.desc' },
  stop: { name: 'ui.orders.stop.name', short: 'ui.orders.stop.short', desc: 'ui.orders.stop.desc' },
  pause: { name: 'ui.orders.pause.name', short: 'ui.orders.pause.short', desc: 'ui.orders.pause.desc' },
  fireState: { name: 'ui.orders.fireState.name', short: 'ui.orders.fireState.short', desc: 'ui.orders.fireState.desc' },
  ability: { name: 'ui.orders.ability.name', short: 'ui.orders.ability.short', desc: 'ui.orders.ability.desc' },
  attackGround: {
    name: 'ui.orders.attackGround.name',
    short: 'ui.orders.attackGround.short',
    desc: 'ui.orders.attackGround.desc',
  },
  tapshot: { name: 'ui.orders.tapshot.name', short: 'ui.orders.tapshot.short', desc: 'ui.orders.tapshot.desc' },
  formation: { name: 'ui.orders.formation.name', short: 'ui.orders.formation.short', desc: 'ui.orders.formation.desc' },
  selfDestruct: {
    name: 'ui.orders.selfDestruct.name',
    short: 'ui.orders.selfDestruct.short',
    desc: 'ui.orders.selfDestruct.desc',
  },
};

/** Text key of a fire state (`ui.orders.fire.<state>`). */
export const FIRE_STATE_TEXT: Readonly<Record<FireState, MsgKey>> = {
  free: 'ui.orders.fire.free',
  return: 'ui.orders.fire.return',
  hold: 'ui.orders.fire.hold',
};

/** Text key of an ability (`ui.orders.ability.<kind>`). */
export const ABILITY_TEXT: Readonly<Record<AbilityKind, MsgKey>> = {
  shield: 'ui.orders.ability.shield',
  radar: 'ui.orders.ability.radar',
  autoTapshot: 'ui.orders.ability.autoTapshot',
};

/** Ability of a roster toggle (`shield`, `radar`, `auto_tapshot`), or null for unknown toggles. */
export function abilityOfToggle(toggle: string): AbilityKind | null {
  if (toggle === 'shield') return 'shield';
  if (toggle === 'radar') return 'radar';
  if (toggle === 'auto_tapshot') return 'autoTapshot';
  return null;
}

/**
 * Where the key of an order lives for a card page (ui.md §5.8, §7.2): on the orders page the grid key
 * itself, on every other page Alt + grid key (order bar). Self-destruct never has a grid key.
 */
export function orderUsesAlt(page: 'build' | 'production' | 'structure' | 'orders' | 'empty'): boolean {
  return page !== 'orders';
}

/**
 * Compact, order-independent fingerprint of the order states (components re-render only when the visible
 * state changes, although the game rewrites the object at 4 Hz, ui.md §9.1).
 */
export function orderStatesKey(states: OrderStates): string {
  let out = '';
  for (const d of ORDER_DEFS) {
    const s = states[d.id];
    if (s === undefined) continue;
    out += `${d.id}:${s.enabled ? 1 : 0}${s.reason ?? ''}|${s.armed === true ? 1 : 0}|${s.toggle ?? ''}|${s.cycle ?? ''}|${s.badge ?? ''}|${s.ability ?? ''};`;
  }
  return out;
}

/** Icon of an order in its current state (fire state and ability change the symbol). */
export function orderIcon(id: OrderId, state: OrderState): LineIconName {
  if (id === 'fireState') return FIRE_STATE_ICON[fireStateAt(state.cycle)];
  if (id === 'ability') return ABILITY_ICON[state.ability ?? 'shield'];
  return orderDef(id).icon;
}
