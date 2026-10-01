import { signal } from '@preact/signals';
import type { Signal } from '@preact/signals';
import type { ClickMods } from '../commands/mods.ts';

/**
 * Selection panel (ui.md §5.5, C3/C9/U8/U9/K10). Structure changes on selection events;
 * HP/vet/order chain at 4 Hz.
 *
 * Write rules for the scheduler (ui.md §9.1):
 * - `kind`, `multi`, `controlGroup`, `groupLabel`: on selection events only (they rebuild the structure).
 * - `single`: may be replaced at 4 Hz (HP, vet, tap shot, order progress); components derive a structure key
 *   (singleStructureKey / orderChainKey) and bind the hot values without re-rendering.
 * - `multiStats`: 4 Hz. The typed arrays may be refilled in place; publish them with a new wrapper object
 *   (`multiStats.value = { ...stats, sumDps }`) so the signal notifies.
 */

export type SelectionKind = 'none' | 'single' | 'multi' | 'factory';

export type OrderKind =
  | 'move'
  | 'attack'
  | 'attackMove'
  | 'build'
  | 'assist'
  | 'guard'
  | 'repair'
  | 'reclaim'
  | 'patrol'
  | 'upgrade';

export const ORDER_KINDS: readonly OrderKind[] = [
  'move',
  'attack',
  'attackMove',
  'build',
  'assist',
  'guard',
  'repair',
  'reclaim',
  'patrol',
  'upgrade',
];

/** One entry of the order chain (C5); the first entry is the running order. */
export interface OrderEntry {
  readonly kind: OrderKind;
  /** Build/upgrade target or assisted/guarded/repaired unit type. */
  readonly typeId?: string;
  /** 0..1 for running build/upgrade/reclaim orders. */
  readonly progress?: number;
  readonly x: number;
  readonly z: number;
  /** Number of targets of an area order (e.g. reclaim of 3 wrecks). */
  readonly targets?: number;
  /** Mass value of reclaim targets (shown instead of a percentage). */
  readonly mass?: number;
}

export interface VetState {
  /** 0..5 */
  readonly level: number;
  /** Progress to the next level, 0..1 (U9: mass value of kills). */
  readonly progress: number;
  /** Mass value of kills counted towards the next level (U9); shown as "420 / 1.000 M" when given. */
  readonly mass?: number;
  /** Mass value needed for the next level. */
  readonly massNext?: number;
}

/** Commander tap shot (U8): stored energy against the threshold (7,500 E). */
export interface TapshotState {
  readonly stored: number;
  readonly threshold: number;
}

/** Tap shot threshold of the commander (U8). */
export const TAPSHOT_THRESHOLD = 7500;

export interface UnitStatLine {
  readonly dps: number;
  readonly range: number;
  readonly speed: number;
  readonly vision: number;
  readonly buildPower: number;
  readonly regen: number;
}

export interface ShieldState {
  readonly hp: number;
  readonly hpMax: number;
}

export interface UnitDetailData {
  readonly handle: number;
  readonly typeId: string;
  readonly hp: number;
  readonly hpMax: number;
  readonly shield?: ShieldState;
  readonly vet: VetState;
  readonly tapshot: TapshotState | null;
  readonly stats: UnitStatLine;
  readonly orders: readonly OrderEntry[];
}

export interface TypeCount {
  readonly typeId: string;
  readonly count: number;
}

export interface SelectedUnit {
  readonly handle: number;
  readonly typeId: string;
}

/** Visible single units in the multi view (ui.md §9.2: ≤ 60 leaves; above that only type tiles). */
export const MULTI_MAX_UNITS = 60;
/** Visible type tiles (≤ 24 + "+N"). */
export const MULTI_MAX_GROUPS = 24;
/** Visible order chain rows in the single view (more → the last row becomes "+N more"). */
export const ORDER_QUEUE_MAX_ROWS = 6;
/** A unit counts as damaged below this HP fraction (tile badge "2 < 50 %", Ctrl+click on a tile). */
export const DAMAGED_BELOW = 0.5;

export interface MultiSelectionData {
  /** Type tiles in display order. */
  readonly groups: readonly TypeCount[];
  /** Up to 60 single units (empty when the selection has more than 60 units). */
  readonly units: readonly SelectedUnit[];
  readonly total: number;
}

/**
 * Hot multi-selection values (4 Hz), index-aligned with `groups` / `units`.
 * Typed arrays so the scheduler can refill them without allocation.
 */
export interface MultiStats {
  /** Average HP fraction per group (0..1). */
  readonly groupHp: Float32Array;
  /** Units below 50 % HP per group. */
  readonly groupDamaged: Uint16Array;
  /** Highest vet level per group. */
  readonly groupVet: Uint8Array;
  /** HP fraction per visible unit (0..1). */
  readonly unitHp: Float32Array;
  readonly sumDps: number;
  readonly sumMass: number;
  /** Average HP in percent (0..100). */
  readonly avgHpPct: number;
  readonly slowestSpeed: number;
}

export interface SelectionSection {
  readonly kind: Signal<SelectionKind>;
  readonly single: Signal<UnitDetailData | null>;
  readonly multi: Signal<MultiSelectionData | null>;
  readonly multiStats: Signal<MultiStats | null>;
  /** Focus type in a multi selection (Tab cycles; drives tooltip and command card focus). */
  readonly focusTypeId: Signal<string | null>;
  /**
   * House name or free label in the panel head (data, not UI text, e.g. "Haus Ambrecht"); shown when
   * `controlGroup` is null.
   */
  readonly groupLabel: Signal<string | null>;
  /** Control group the selection was recalled from (1..10, 10 = key 0); the head shows "Gruppe N". */
  readonly controlGroup: Signal<number | null>;
}

/** HP bar level (ui.md §3.7: warning below 55 %, critical below 30 %). */
export function hpLevel(fraction: number): 'ok' | 'warn' | 'crit' {
  if (fraction < 0.3) return 'crit';
  if (fraction < 0.55) return 'warn';
  return 'ok';
}

export function createMultiStats(groups: number, units: number): MultiStats {
  return {
    groupHp: new Float32Array(groups),
    groupDamaged: new Uint16Array(groups),
    groupVet: new Uint8Array(groups),
    unitHp: new Float32Array(units),
    sumDps: 0,
    sumMass: 0,
    avgHpPct: 100,
    slowestSpeed: 0,
  };
}

export function createSelectionSection(): SelectionSection {
  return {
    kind: signal<SelectionKind>('none'),
    single: signal<UnitDetailData | null>(null),
    multi: signal<MultiSelectionData | null>(null),
    multiStats: signal<MultiStats | null>(null),
    focusTypeId: signal<string | null>(null),
    groupLabel: signal<string | null>(null),
    controlGroup: signal<number | null>(null),
  };
}

// ---------------------------------------------------------------------------------------------------------
// Pure derivations
// ---------------------------------------------------------------------------------------------------------

/** What a click on a type tile does (ui.md §7.3: plain = only this type, Shift = remove, Ctrl = only damaged). */
export type TileAction = 'select' | 'deselect' | 'damaged';

export function tileAction(mods: Pick<ClickMods, 'shift' | 'ctrl'>): TileAction {
  if (mods.shift) return 'deselect';
  if (mods.ctrl) return 'damaged';
  return 'select';
}

/**
 * Next focus type for Tab (Shift+Tab = previous) in a multi selection; wraps around. Unknown or null
 * current focus starts at the first (last) type. Null without groups.
 */
export function nextFocusType(groups: readonly TypeCount[], current: string | null, reverse = false): string | null {
  const n = groups.length;
  if (n === 0) return null;
  let i = -1;
  for (let k = 0; k < n; k++) if (groups[k]!.typeId === current) i = k;
  if (i < 0) return groups[reverse ? n - 1 : 0]!.typeId;
  return groups[(i + (reverse ? n - 1 : 1)) % n]!.typeId;
}

/**
 * Structure key of the single view: changes only when the rendered structure changes (unit, shield or
 * tap-shot rows, static stat line), not for the 4 Hz values (HP, vet, tap shot, order progress).
 */
export function singleStructureKey(d: UnitDetailData | null): string {
  if (d === null) return '';
  const s = d.stats;
  return [
    d.handle,
    d.typeId,
    d.shield ? 's' : '',
    d.tapshot ? 't' : '',
    d.vet.massNext !== undefined ? 'm' : '',
    s.dps,
    s.range,
    s.speed,
    s.vision,
    s.buildPower,
    s.regen,
  ].join('|');
}

/** Structure key of an order chain: kinds, targets and static values, without the running progress. */
export function orderChainKey(orders: readonly OrderEntry[]): string {
  let key = '';
  for (let i = 0; i < orders.length; i++) {
    const o = orders[i]!;
    // The running order's mass/progress are hot values; queued entries show them statically.
    const hotFree = i === 0 ? (o.progress !== undefined ? 'p' : o.mass !== undefined ? 'm' : '') : `${o.progress ?? ''}:${o.mass ?? ''}`;
    key += `${o.kind}:${o.typeId ?? ''}:${o.targets ?? ''}:${hotFree};`;
  }
  return key;
}

/** Visible type tiles for a capacity: all when they fit, else `capacity - 1` tiles plus a "+N" tile. */
export function visibleCount(total: number, capacity: number): { readonly shown: number; readonly more: number } {
  const cap = Math.max(1, Math.floor(capacity));
  if (total <= cap) return { shown: total, more: 0 };
  return { shown: cap - 1, more: total - (cap - 1) };
}

/** Per-unit input of aggregateMultiStats (index-aligned with `multi.units` for the first 60). */
export interface MultiUnitSample {
  readonly typeId: string;
  /** HP fraction 0..1. */
  readonly hp: number;
  readonly vet: number;
  readonly dps: number;
  readonly mass: number;
  readonly speed: number;
}

/**
 * Aggregates per-unit samples into MultiStats (group averages, damaged counts below 50 %, highest vet,
 * Σ DPS, Σ Mass, Ø HP, slowest speed). `into` is refilled in place when it has the right sizes.
 * Structures (speed 0) do not count for the slowest speed.
 */
export function aggregateMultiStats(
  groups: readonly TypeCount[],
  unitCount: number,
  samples: readonly MultiUnitSample[],
  into?: MultiStats,
): MultiStats {
  const out =
    into && into.groupHp.length === groups.length && into.unitHp.length === unitCount
      ? into
      : createMultiStats(groups.length, unitCount);
  out.groupHp.fill(0);
  out.groupDamaged.fill(0);
  out.groupVet.fill(0);
  const index: Record<string, number> = {};
  for (let g = 0; g < groups.length; g++) index[groups[g]!.typeId] = g;
  const counts = new Uint32Array(groups.length);
  let sumDps = 0;
  let sumMass = 0;
  let sumHp = 0;
  let slowest = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!;
    const hp = s.hp > 1 ? 1 : s.hp < 0 ? 0 : s.hp;
    if (i < unitCount) out.unitHp[i] = hp;
    sumDps += s.dps;
    sumMass += s.mass;
    sumHp += hp;
    if (s.speed > 0 && (slowest === 0 || s.speed < slowest)) slowest = s.speed;
    const g = index[s.typeId];
    if (g === undefined) continue;
    counts[g]! += 1;
    out.groupHp[g]! += hp;
    if (hp < DAMAGED_BELOW) out.groupDamaged[g]! += 1;
    if (s.vet > out.groupVet[g]!) out.groupVet[g] = s.vet;
  }
  for (let g = 0; g < groups.length; g++) out.groupHp[g] = counts[g]! > 0 ? out.groupHp[g]! / counts[g]! : 1;
  return {
    groupHp: out.groupHp,
    groupDamaged: out.groupDamaged,
    groupVet: out.groupVet,
    unitHp: out.unitHp,
    sumDps,
    sumMass,
    avgHpPct: samples.length > 0 ? (sumHp / samples.length) * 100 : 100,
    slowestSpeed: slowest,
  };
}
