import type { ArmyMatchStats as Army, MatchStatsSnapshot } from '@faf/protocol';
import type { ScoreCoverage, ScoreEvent, ScoreRow, ScoreSeries } from '@faf/hud';

export interface ScoreView {
  readonly rows: readonly ScoreRow[];
  readonly series: readonly ScoreSeries[];
  readonly events: readonly ScoreEvent[];
  readonly coverage: ScoreCoverage;
  readonly enemyLabel: 'enemy' | 'enemyTotal';
}

/**
 * Maps the host's recorded totals to score rows. Only recorded values are shown: without a
 * snapshot no row exists, and a partial record says which span it covers.
 */
export function scoreFromStats(stats: MatchStatsSnapshot | null, player: number, opponents: readonly number[], pending: boolean): ScoreView {
  const enemyLabel = opponents.length > 1 ? 'enemyTotal' : 'enemy';
  if (stats === null) return { rows: [], series: [], events: [], coverage: { kind: pending ? 'pending' : 'unavailable' }, enemyLabel };
  const own = stats.armies.find(army => army.army === player);
  const enemies = stats.armies.filter(army => opponents.includes(army.army));
  if (own === undefined || enemies.length !== opponents.length || opponents.length === 0) return { rows: [], series: [], events: [], coverage: { kind: 'unavailable' }, enemyLabel };
  const sum = (pick: (army: Army) => number) => enemies.reduce((total, army) => total + pick(army), 0);
  const row = (id: string, group: ScoreRow['group'], pick: (army: Army) => number, lowerIsBetter = false): ScoreRow =>
    ({ id, group, self: pick(own), enemy: sum(pick), ...(lowerIsBetter ? { lowerIsBetter } : {}) });
  const rows: ScoreRow[] = [
    row('mass', 'economy', army => army.massProduced), row('energy', 'economy', army => army.energyProduced),
    row('massSpent', 'economy', army => army.massSpent), row('energySpent', 'economy', army => army.energySpent),
    row('built', 'units', army => army.unitsBuilt), row('structures', 'units', army => army.structuresBuilt),
    row('losses', 'units', army => army.unitsLost, true), row('massLost', 'army', army => army.massLost, true),
  ];
  const seriesOf = (id: ScoreSeries['id'], pick: (army: Army) => readonly number[]): ScoreSeries => ({
    id, stepS: stats.sampleTicks / 10, self: pick(own),
    enemy: pick(own).map((_, i) => enemies.reduce((total, army) => total + (pick(army)[i] ?? 0), 0)),
  });
  const series = own.massIncomeSeries.length > 1 ? [seriesOf('massIncome', army => army.massIncomeSeries), seriesOf('armyValue', army => army.armyValueSeries)] : [];
  const events: ScoreEvent[] = [];
  const picks: readonly [ScoreEvent['kind'], (army: Army) => number | null][] = [['firstFactory', army => army.firstFactoryTick], ['commanderLost', army => army.commanderLostTick]];
  for (const [kind, pick] of picks) {
    const self = pick(own), enemy = enemies.map(pick).filter((tick): tick is number => tick !== null).sort((a, b) => a - b)[0];
    if (self !== null) events.push({ timeS: self / 10, kind, side: 'self' });
    if (enemy !== undefined) events.push({ timeS: enemy / 10, kind, side: 'enemy' });
  }
  events.sort((a, b) => a.timeS - b.timeS);
  const coverage: ScoreCoverage = stats.complete ? { kind: 'complete' } : { kind: 'partial', fromS: Math.max(0, stats.fromTick) / 10, toS: Math.max(0, stats.toTick) / 10 };
  return { rows, series, events, coverage, enemyLabel };
}
