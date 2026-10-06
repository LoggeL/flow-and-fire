import { signal } from '@preact/signals';
import type { Signal } from '@preact/signals';
import type { AiDifficulty, SlotController, VictoryCondition } from './skirmish.ts';

/** Score screen (ui.md §5.15, A13; minimal form A4). Values come 1:1 from sim stats. */

export type ScoreTab = 'overview' | 'economy' | 'army' | 'units';
export const SCORE_TABS: readonly ScoreTab[] = ['overview', 'economy', 'army', 'units'];

export type Verdict = 'victory' | 'defeat';
export type ScoreSide = 'self' | 'enemy';

export interface ScoreHouse {
  /** House name without "Haus". */
  readonly name: string;
  /** House colour token (e.g. "team-blau"). */
  readonly color: string;
  readonly controller: SlotController;
  readonly ai: AiDifficulty | null;
}

export type ScoreRowId =
  | 'massProduced'
  | 'energyProduced'
  | 'massReclaimed'
  | 'stallTime'
  | 'mexPeak'
  | 'unitsBuilt'
  | 'unitsLost'
  | 'enemiesKilled'
  | 'massValueKilled'
  | 'vetPeak';

/** A table row. `lowerIsBetter` flips the ember highlight; `isTime` formats seconds as m:ss. */
export interface ScoreRow {
  readonly id: ScoreRowId;
  readonly group: 'economy' | 'army';
  readonly self: number;
  readonly enemy: number;
  readonly isTime?: boolean;
  readonly lowerIsBetter?: boolean;
}

export type ScoreSeriesId = 'massIncome' | 'energyIncome' | 'armyValue' | 'unitsAlive';

export interface ScoreSeries {
  readonly id: ScoreSeriesId;
  /** Sample interval in seconds; sample i is at min(i × stepS, durationS). */
  readonly stepS: number;
  readonly self: readonly number[];
  readonly enemy: readonly number[];
}

export type ScoreEventKind = 'firstFactory' | 'techUp' | 'objective' | 'commanderLost';

export interface ScoreEvent {
  readonly timeS: number;
  readonly kind: ScoreEventKind;
  readonly side: ScoreSide | 'both';
  /** Unit/building type (techUp: the new factory). */
  readonly typeId?: string;
  /** Objective name for kind "objective": i18n key or literal text. */
  readonly note?: string;
}

export interface BestUnit {
  readonly typeId: string;
  readonly kills: number;
}

export interface UnitScore {
  readonly typeId: string;
  readonly built: number;
  readonly lost: number;
  readonly kills: number;
}

export interface ScoreUnitRow {
  readonly typeId: string;
  readonly self: Omit<UnitScore, 'typeId'>;
  readonly enemy: Omit<UnitScore, 'typeId'>;
}

export interface ScoreSection {
  readonly verdict: Signal<Verdict>;
  /** Minimal end screen (A4, MS5/MS9): verdict + match time + buttons only. */
  readonly minimal: Signal<boolean>;
  readonly durationS: Signal<number>;
  readonly tab: Signal<ScoreTab>;
  readonly mapName: Signal<string>;
  readonly victory: Signal<VictoryCondition>;
  readonly houses: Signal<{ readonly self: ScoreHouse; readonly enemy: ScoreHouse }>;
  readonly points: Signal<number>;
  /** Share of spent mass that ended in value (0..1). */
  readonly efficiency: Signal<number>;
  /** Replay size in bytes (null: no replay recorded). */
  readonly replayBytes: Signal<number | null>;
  /** Replay already saved to the replay list. */
  readonly replaySaved: Signal<boolean>;
  readonly rows: Signal<readonly ScoreRow[]>;
  readonly series: Signal<readonly ScoreSeries[]>;
  readonly events: Signal<readonly ScoreEvent[]>;
  readonly bestUnits: Signal<readonly BestUnit[]>;
  readonly units: Signal<readonly ScoreUnitRow[]>;
}

const NO_HOUSE: ScoreHouse = { name: '', color: 'team-blau', controller: 'human', ai: null };

export function createScoreSection(): ScoreSection {
  return {
    verdict: signal<Verdict>('victory'),
    minimal: signal(false),
    durationS: signal(0),
    tab: signal<ScoreTab>('overview'),
    mapName: signal(''),
    victory: signal<VictoryCondition>('assassination'),
    houses: signal({ self: NO_HOUSE, enemy: { ...NO_HOUSE, color: 'team-rot', controller: 'ai' as const, ai: 'normal' as const } }),
    points: signal(0),
    efficiency: signal(0),
    replayBytes: signal<number | null>(null),
    replaySaved: signal(false),
    rows: signal<readonly ScoreRow[]>([]),
    series: signal<readonly ScoreSeries[]>([]),
    events: signal<readonly ScoreEvent[]>([]),
    bestUnits: signal<readonly BestUnit[]>([]),
    units: signal<readonly ScoreUnitRow[]>([]),
  };
}

/** Which side has the better value (ember + bold, ui.md §8.1); null on a tie. */
export function betterSide(self: number, enemy: number, lowerIsBetter = false): ScoreSide | null {
  if (self === enemy) return null;
  return (lowerIsBetter ? self < enemy : self > enemy) ? 'self' : 'enemy';
}

/** Rows and charts per tab. */
export const SCORE_TAB_CONTENT: Readonly<
  Record<ScoreTab, { readonly groups: readonly ScoreRow['group'][]; readonly charts: readonly [ScoreSeriesId, ScoreSeriesId] | null }>
> = {
  overview: { groups: ['economy', 'army'], charts: ['massIncome', 'armyValue'] },
  economy: { groups: ['economy'], charts: ['massIncome', 'energyIncome'] },
  army: { groups: ['army'], charts: ['armyValue', 'unitsAlive'] },
  units: { groups: [], charts: null },
};

/** Units table sorted by kills of both sides (descending), then type id (stable). */
export function sortUnitRows(rows: readonly ScoreUnitRow[]): readonly ScoreUnitRow[] {
  return rows
    .slice()
    .sort((a, b) => b.self.kills + b.enemy.kills - (a.self.kills + a.enemy.kills) || (a.typeId < b.typeId ? -1 : a.typeId > b.typeId ? 1 : 0));
}

/** Number of samples of a series over a match: every `stepS` from 0, plus the end if it is off the grid. */
export function seriesSampleCount(durationS: number, stepS: number): number {
  if (durationS <= 0 || stepS <= 0) return 1;
  const full = Math.floor(durationS / stepS);
  return full + (durationS % stepS === 0 ? 1 : 2);
}

/** Time of sample i (the last sample sits at the match end). */
export function sampleTime(i: number, stepS: number, durationS: number): number {
  return Math.min(i * stepS, durationS);
}
