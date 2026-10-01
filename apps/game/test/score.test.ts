import { describe, expect, it } from 'vitest';
import type { ArmyMatchStats, MatchStatsSnapshot } from '@faf/protocol';
import { scoreFromStats } from '../src/hud/score.ts';
import { loadLastMatch, saveLastMatch, LAST_MATCH_KEY } from '../src/last-match.ts';

const army = (n: number, over: Partial<ArmyMatchStats> = {}): ArmyMatchStats => ({
  army: n, massProduced: 100 * (n + 1), energyProduced: 2000, massSpent: 80, energySpent: 900, unitsBuilt: 3 + n, structuresBuilt: 2,
  massBuilt: 276, unitsLost: n, massLost: 36 * n, firstFactoryTick: 300 + n, commanderLostTick: null,
  massIncomeSeries: [1, 2, 3], armyValueSeries: [0, 50, 100], ...over,
});
const snapshot = (armies: ArmyMatchStats[], complete = true): MatchStatsSnapshot => ({ fromTick: 1, toTick: 620, complete, sampleTicks: 100, armies });

describe('score screen data', () => {
  it('shows only recorded totals; several enemies are summed and labelled as a total', () => {
    const view = scoreFromStats(snapshot([army(0), army(1), army(2, { commanderLostTick: 610 })]), 0, [1, 2], false);
    expect(view.enemyLabel).toBe('enemyTotal');
    expect(view.rows.find(r => r.id === 'mass')).toMatchObject({ self: 100, enemy: 500 });
    expect(view.rows.find(r => r.id === 'losses')).toMatchObject({ self: 0, enemy: 3, lowerIsBetter: true });
    expect(view.series.find(s => s.id === 'armyValue')).toMatchObject({ stepS: 10, self: [0, 50, 100], enemy: [0, 100, 200] });
    expect(view.events).toEqual([{ timeS: 30, kind: 'firstFactory', side: 'self' }, { timeS: 30.1, kind: 'firstFactory', side: 'enemy' }, { timeS: 61, kind: 'commanderLost', side: 'enemy' }]);
    expect(view.coverage).toEqual({ kind: 'complete' });
  });
  it('never invents numbers: missing, pending and partial records are labelled', () => {
    expect(scoreFromStats(null, 0, [1], true)).toMatchObject({ rows: [], series: [], coverage: { kind: 'pending' } });
    expect(scoreFromStats(null, 0, [1], false)).toMatchObject({ rows: [], coverage: { kind: 'unavailable' } });
    expect(scoreFromStats(snapshot([army(0)]), 0, [1], false)).toMatchObject({ rows: [], coverage: { kind: 'unavailable' } });
    expect(scoreFromStats(snapshot([army(0), army(1)], false), 0, [1], false).coverage).toEqual({ kind: 'partial', fromS: 0.1, toS: 62 });
  });
  it('persists the last match summary and rejects malformed stored values', () => {
    const store = new Map<string, string>(), storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
    expect(loadLastMatch(storage)).toBeNull();
    saveLastMatch({ mapName: 'Hollow Ridge', verdict: 'draw', durationS: 61.5, opponent: 'KI Normal' }, storage);
    expect(loadLastMatch(storage)).toEqual({ mapName: 'Hollow Ridge', verdict: 'draw', durationS: 61.5, opponent: 'KI Normal' });
    store.set(LAST_MATCH_KEY, '{"mapName":1}'); expect(loadLastMatch(storage)).toBeNull();
    store.set(LAST_MATCH_KEY, 'not json'); expect(loadLastMatch(storage)).toBeNull();
  });
});
