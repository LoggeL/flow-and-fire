import { batch, computed, signal } from '@preact/signals';
import type { ReadonlySignal, Signal } from '@preact/signals';

/** Economy section (ui.md §5.1, C10/E1–E4, E13). Bound at 10 Hz (details at 4 Hz while open). */

export type ResourceKind = 'mass' | 'energy';
export const RESOURCE_KINDS: readonly ResourceKind[] = ['mass', 'energy'];

export type IncomeSource = 'mex' | 'pgen' | 'hydro' | 'reclaim' | 'commander' | 'other';

export interface IncomeEntry {
  readonly source: IncomeSource;
  readonly perSec: number;
}

/** Storage per building type (resource tooltip: "Speicher nach Gebäude"). */
export interface StorageEntry {
  readonly typeId: string;
  readonly count: number;
  readonly capacity: number;
}

/** Display state of a resource meter (ui.md §5.1). */
export type ResourceStatus = 'normal' | 'overflow' | 'stallSoon' | 'stall';

/** "Stall droht": net negative and storage empty in less than this many seconds. */
export const STALL_SOON_S = 10;

export interface ResourceSignals {
  /** Stored amount. */
  readonly stored: Signal<number>;
  /** Storage capacity. */
  readonly capacity: Signal<number>;
  /** Income per second. */
  readonly income: Signal<number>;
  /** Requested consumption per second (all consumers at full rate). */
  readonly demand: Signal<number>;
  /** Actually served consumption per second. */
  readonly served: Signal<number>;
  /** Served share of the demand, 0..1 (1 = no bottleneck; E2/E3). */
  readonly flow: Signal<number>;
  readonly incomeBySource: Signal<readonly IncomeEntry[]>;
  readonly storageByBuilding: Signal<readonly StorageEntry[]>;
  /** Derived: income − demand (the deficit while stalling). */
  readonly net: ReadonlySignal<number>;
  /** Derived: meter state. */
  readonly status: ReadonlySignal<ResourceStatus>;
}

export type FlowConsumerKind = 'factory' | 'engineer' | 'upgrade' | 'upkeep';
export const FLOW_CONSUMER_KINDS: readonly FlowConsumerKind[] = ['factory', 'engineer', 'upgrade', 'upkeep'];

export interface FlowConsumer {
  readonly id: number;
  /** Type of the consuming unit/structure (factory, engineer, upgrading structure, upkeep structure). */
  readonly typeId: string;
  readonly kind: FlowConsumerKind;
  /** What is being built (factory/engineer) or the upgrade target (upgrade); absent for upkeep. */
  readonly targetTypeId?: string | undefined;
  /** Several identical consumers merged into one row (e.g. "Lehrling ×2"); default 1. */
  readonly count?: number | undefined;
  readonly massReq: number;
  readonly massGot: number;
  readonly energyReq: number;
  readonly energyGot: number;
  readonly paused: boolean;
}

export interface EcoSection {
  readonly mass: ResourceSignals;
  readonly energy: ResourceSignals;
  /** Largest consumers (flow details). */
  readonly consumers: Signal<readonly FlowConsumer[]>;
  readonly detailsOpen: Signal<boolean>;
  /** Pause buttons in flow details are live (E13, from MS10); read-only before. */
  readonly interactive: Signal<boolean>;
  /** Stall priority, highest first (who is served first when flow < 1). */
  readonly stallPriority: Signal<readonly FlowConsumerKind[]>;
}

/** Net rate: income − requested demand. */
export function net(income: number, demand: number): number {
  return income - demand;
}

/** Seconds until storage is empty at `netPerSec` (Infinity when not draining). */
export function secondsToEmpty(stored: number, netPerSec: number): number {
  if (netPerSec >= 0) return Number.POSITIVE_INFINITY;
  return Math.max(0, stored) / -netPerSec;
}

/** Seconds until storage is full at `netPerSec` (0 when full, Infinity when not filling). */
export function secondsToFull(stored: number, capacity: number, netPerSec: number): number {
  if (stored >= capacity) return 0;
  if (netPerSec <= 0) return Number.POSITIVE_INFINITY;
  return (capacity - stored) / netPerSec;
}

const FLOW_EPS = 1e-6;

/**
 * Meter state (ui.md §5.1): stall = flow < 1; overflow = storage full and net > 0;
 * stall soon = net < 0 and empty in less than 10 s; otherwise normal.
 */
export function resourceStatus(
  stored: number,
  capacity: number,
  income: number,
  demand: number,
  flow: number,
): ResourceStatus {
  if (flow < 1 - FLOW_EPS) return 'stall';
  const n = net(income, demand);
  if (capacity > 0 && stored >= capacity && n > 0) return 'overflow';
  if (n < 0 && secondsToEmpty(stored, n) < STALL_SOON_S) return 'stallSoon';
  return 'normal';
}

export interface ResourceInit {
  readonly stored?: number;
  readonly capacity?: number;
  readonly income?: number;
  readonly demand?: number;
  readonly served?: number;
  readonly flow?: number;
}

export function createResourceSignals(init: ResourceInit = {}): ResourceSignals {
  const stored = signal(init.stored ?? 0);
  const capacity = signal(init.capacity ?? 0);
  const income = signal(init.income ?? 0);
  const demand = signal(init.demand ?? 0);
  const served = signal(init.served ?? init.demand ?? 0);
  const flow = signal(init.flow ?? 1);
  return {
    stored,
    capacity,
    income,
    demand,
    served,
    flow,
    incomeBySource: signal<readonly IncomeEntry[]>([]),
    storageByBuilding: signal<readonly StorageEntry[]>([]),
    net: computed(() => net(income.value, demand.value)),
    status: computed(() => resourceStatus(stored.value, capacity.value, income.value, demand.value, flow.value)),
  };
}

export function createEcoSection(): EcoSection {
  return {
    mass: createResourceSignals(),
    energy: createResourceSignals(),
    consumers: signal<readonly FlowConsumer[]>([]),
    detailsOpen: signal(false),
    interactive: signal(false),
    stallPriority: signal<readonly FlowConsumerKind[]>(['upkeep', 'factory', 'upgrade', 'engineer']),
  };
}

/** Rows per resource column in flow details (ui.md §5.1: the largest consumers). */
export const FLOW_DETAILS_MAX_ROWS = 5;

/** Net values within ±0.05/s render grey (ui.md §5.1: green / red / grey). */
export const NET_ZERO_EPS = 0.05;

export type NetLevel = 'pos' | 'neg' | 'zero';

export function netLevel(netPerSec: number): NetLevel {
  if (netPerSec > NET_ZERO_EPS) return 'pos';
  if (netPerSec < -NET_ZERO_EPS) return 'neg';
  return 'zero';
}

/** Fill of the storage bar, 0..1 (0 without capacity). */
export function storageFill(stored: number, capacity: number): number {
  if (!(capacity > 0)) return 0;
  const v = stored / capacity;
  return v > 1 ? 1 : v < 0 ? 0 : v;
}

/** Whole seconds until empty, rounded up ("leer in 7 s"); Infinity when not draining. */
export function wholeSecondsToEmpty(stored: number, netPerSec: number): number {
  const s = secondsToEmpty(stored, netPerSec);
  return Number.isFinite(s) ? Math.ceil(s) : s;
}

/** Whole seconds until full, rounded up; 0 when full, Infinity when not filling. */
export function wholeSecondsToFull(stored: number, capacity: number, netPerSec: number): number {
  const s = secondsToFull(stored, capacity, netPerSec);
  return Number.isFinite(s) ? Math.ceil(s) : s;
}

/** Requested rate of a consumer for one resource. */
export function consumerRequest(c: FlowConsumer, res: ResourceKind): number {
  return res === 'mass' ? c.massReq : c.energyReq;
}

/** Served rate of a consumer for one resource (0 while paused). */
export function consumerServed(c: FlowConsumer, res: ResourceKind): number {
  if (c.paused) return 0;
  return res === 'mass' ? c.massGot : c.energyGot;
}

const SERVED_EPS = 1e-3;

/** Consumer is throttled for this resource (receives less than it requests, not paused): "Engpass". */
export function isBottleneck(c: FlowConsumer, res: ResourceKind): boolean {
  if (c.paused) return false;
  const req = consumerRequest(c, res);
  return req > 0 && consumerServed(c, res) < req * (1 - SERVED_EPS);
}

/**
 * Largest consumers of one resource for flow details: request > 0, sorted by request (desc),
 * ties by id (asc) so the order is stable between 4 Hz updates.
 */
export function topConsumers(
  consumers: readonly FlowConsumer[],
  res: ResourceKind,
  max: number = FLOW_DETAILS_MAX_ROWS,
): readonly FlowConsumer[] {
  const rows = consumers.filter((c) => consumerRequest(c, res) > 0);
  rows.sort((a, b) => consumerRequest(b, res) - consumerRequest(a, res) || a.id - b.id);
  return rows.length > max ? rows.slice(0, max) : rows;
}

/** Number of paused consumers (flow details footer). */
export function pausedCount(consumers: readonly FlowConsumer[]): number {
  let n = 0;
  for (const c of consumers) if (c.paused) n++;
  return n;
}

/** The flow factor all consumers currently run at (the smaller of both resources), 0..1. */
export function overallFlow(massFlow: number, energyFlow: number): number {
  const f = Math.min(massFlow, energyFlow);
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

/** Writes several resource values in one batch (scheduler / demo). */
export function writeResource(r: ResourceSignals, v: ResourceInit): void {
  batch(() => {
    if (v.stored !== undefined) r.stored.value = v.stored;
    if (v.capacity !== undefined) r.capacity.value = v.capacity;
    if (v.income !== undefined) r.income.value = v.income;
    if (v.demand !== undefined) r.demand.value = v.demand;
    if (v.served !== undefined) r.served.value = v.served;
    if (v.flow !== undefined) r.flow.value = v.flow;
  });
}
