import { signal } from '@preact/signals';
import type { Signal } from '@preact/signals';
import type { ClickMods } from '../commands/mods.ts';
import type { TypeCount } from './selection.ts';

/**
 * Factory detail + queue (ui.md §5.5 "Fabrik", §5.7; B2, B3, E11, E13).
 *
 * Write rules for the scheduler (ui.md §9.1): `queue` on queue events; `detail` on selection events and
 * at 4 Hz (HP); `progress` and `remainingS` at 10 Hz (bound to --v / text only, never re-render).
 */

export type RallyState = 'none' | 'point' | 'unit';

export interface FactoryDetailData {
  readonly handle: number;
  readonly typeId: string;
  readonly hp: number;
  readonly hpMax: number;
  /** Own build power. */
  readonly bpOwn: number;
  /** Build power of assisting engineers (B2). */
  readonly bpAssist: number;
  readonly helpers: readonly TypeCount[];
  /** Energy cost reduction from adjacency in percent (E11), 0 when none. */
  readonly adjacencyPct: number;
  readonly rally: RallyState;
  /** Number of selected factories (> 1: orders are distributed round robin, the queue shows the sum). */
  readonly factoryCount: number;
}

export interface FactoryCurrent {
  readonly typeId: string;
}

/** Visible queue blocks (ui.md §5.7: up to 10, then "+N"). */
export const QUEUE_MAX_BLOCKS = 10;

export interface FactoryQueueData {
  /** Item in production, null when the factory idles. */
  readonly current: FactoryCurrent | null;
  /** Merged blocks of equal units, in queue order (after the current one). */
  readonly blocks: readonly TypeCount[];
  readonly repeat: boolean;
  readonly paused: boolean;
}

export interface FactorySection {
  readonly detail: Signal<FactoryDetailData | null>;
  readonly queue: Signal<FactoryQueueData | null>;
  /** Progress of the current item, 0..1 (10 Hz, bound to --v only). */
  readonly progress: Signal<number>;
  /** Remaining seconds of the current item at the current build power (10 Hz, text only). */
  readonly remainingS: Signal<number>;
}

export function createFactorySection(): FactorySection {
  return {
    detail: signal<FactoryDetailData | null>(null),
    queue: signal<FactoryQueueData | null>(null),
    progress: signal(0),
    remainingS: signal(0),
  };
}

// ---------------------------------------------------------------------------------------------------------
// Pure derivations
// ---------------------------------------------------------------------------------------------------------

export function bpTotal(d: Pick<FactoryDetailData, 'bpOwn' | 'bpAssist'>): number {
  return d.bpOwn + d.bpAssist;
}

/** Number of queued units (blocks only, without the current one). */
export function queuedUnits(q: FactoryQueueData | null): number {
  if (q === null) return 0;
  let n = 0;
  for (const b of q.blocks) n += b.count;
  return n;
}

export function queueIsEmpty(q: FactoryQueueData | null): boolean {
  return q === null || (q.current === null && q.blocks.length === 0);
}

/** Merges consecutive equal types into blocks (`[tank, tank, arty]` → `tank ×2, arty ×1`). */
export function mergeQueue(typeIds: readonly string[]): TypeCount[] {
  const out: TypeCount[] = [];
  for (const id of typeIds) {
    const last = out[out.length - 1];
    if (last !== undefined && last.typeId === id) out[out.length - 1] = { typeId: id, count: last.count + 1 };
    else out.push({ typeId: id, count: 1 });
  }
  return out;
}

/** Queue edit triggered by a click on a queue block or a production cell (ui.md §5.7, §7.3). */
export type QueueClick =
  | { readonly op: 'add'; readonly count: number; readonly toFront: boolean }
  | { readonly op: 'remove'; readonly count: number };

/**
 * Click → queue edit: click +1, Shift+click +5, right click −1, Shift+right click −5, Ctrl+click puts the
 * units at the front (Ctrl+Shift: 5 at the front).
 */
export function queueClick(mods: Pick<ClickMods, 'shift' | 'ctrl' | 'button'>): QueueClick {
  const count = mods.shift ? 5 : 1;
  if (mods.button === 2) return { op: 'remove', count };
  return { op: 'add', count, toFront: mods.ctrl };
}

/** Structure key of the factory detail: everything except the 4 Hz HP. */
export function factoryStructureKey(d: FactoryDetailData | null): string {
  if (d === null) return '';
  let helpers = '';
  for (const h of d.helpers) helpers += `${h.typeId}×${h.count},`;
  return [d.handle, d.typeId, d.bpOwn, d.bpAssist, helpers, d.adjacencyPct, d.rally, d.factoryCount].join('|');
}
