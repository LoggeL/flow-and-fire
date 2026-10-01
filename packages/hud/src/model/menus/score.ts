import { signal } from '@preact/signals';
import type { Signal } from '@preact/signals';

/** Score screen (ui.md §5.15, A13; minimal form A4). Values come 1:1 from sim stats. */

export type ScoreTab = 'overview' | 'economy' | 'army' | 'units';
export const SCORE_TABS: readonly ScoreTab[] = ['overview', 'economy', 'army', 'units'];

export type Verdict = 'victory' | 'defeat' | 'draw';
/** Whether rows are recorded totals, still pending, unavailable or only partial. */
export type ScoreCoverage = { readonly kind: 'complete' | 'pending' | 'unavailable' } | { readonly kind: 'partial'; readonly fromS: number; readonly toS: number };

/** A table row; a row without values is a group header. `lowerIsBetter` flips the ember highlight. */
export interface ScoreRow {
  readonly id: string;
  readonly group: 'economy' | 'army' | 'units';
  readonly self: number | null;
  readonly enemy: number | null;
  /** Value is a duration in seconds (formatted as time). */
  readonly isTime?: boolean;
  readonly lowerIsBetter?: boolean;
}

export interface ScoreSeries {
  readonly id: 'massIncome' | 'armyValue';
  /** Sample interval in seconds. */
  readonly stepS: number;
  readonly self: readonly number[];
  readonly enemy: readonly number[];
}

export interface ScoreEvent {
  readonly timeS: number;
  readonly kind: 'firstFactory' | 'techUp' | 'commanderLost' | 'objective';
  readonly side: 'self' | 'enemy' | 'both';
  readonly typeId?: string;
}

export interface ScoreSection {
  readonly verdict: Signal<Verdict>;
  readonly coverage: Signal<ScoreCoverage>;
  /** Column label of the opponents: one enemy, or the sum of several. */
  readonly enemyLabel: Signal<'enemy' | 'enemyTotal'>;
  readonly durationS: Signal<number>;
  readonly tab: Signal<ScoreTab>;
  readonly rows: Signal<readonly ScoreRow[]>;
  readonly series: Signal<readonly ScoreSeries[]>;
  readonly events: Signal<readonly ScoreEvent[]>;
}

export function createScoreSection(): ScoreSection {
  return {
    verdict: signal<Verdict>('victory'),
    coverage: signal<ScoreCoverage>({ kind: 'complete' }),
    enemyLabel: signal<'enemy' | 'enemyTotal'>('enemy'),
    durationS: signal(0),
    tab: signal<ScoreTab>('overview'),
    rows: signal<readonly ScoreRow[]>([]),
    series: signal<readonly ScoreSeries[]>([]),
    events: signal<readonly ScoreEvent[]>([]),
  };
}
