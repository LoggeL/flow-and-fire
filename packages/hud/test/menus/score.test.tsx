// @vitest-environment happy-dom
import { describe, expect, test } from 'vitest';
import { applyScoreDemo, DEMO_DURATION_S, DEMO_STEP_S } from '../../src/demo/index.ts';
import {
  CHART_MARGINS,
  ScoreChart,
  ScoreScreen,
  chartGeometry,
  eventText,
  indexAtX,
  linePath,
  minuteLabel,
  niceScale,
  separateLabels,
  shortTime,
  timeTicks,
} from '../../src/menus/score/index.ts';
import type { ChartBox } from '../../src/menus/score/index.ts';
import { SCORE_TAB_CONTENT, betterSide, sampleTime, seriesSampleCount, sortUnitRows } from '../../src/model/menus/score.ts';
import type { ScoreSeries } from '../../src/model/menus/score.ts';
import { fireEvent, flushSignals, screen, within } from '../support/index.tsx';
import { callsOf, focusedId, key, names, renderMenu } from './helpers.tsx';
import { demoUnitCatalog } from '../../src/demo/catalog.ts';

const CAT = demoUnitCatalog();

const BOX: ChartBox = { width: 544, height: 222, left: 44, right: 100, top: 12, bottom: 10 };

describe('score model (pure)', () => {
  test('betterSide: higher is better unless lowerIsBetter; ties mark nothing', () => {
    expect(betterSide(18_412, 16_905)).toBe('self');
    expect(betterSide(162, 171)).toBe('enemy');
    expect(betterSide(48, 132, true)).toBe('self');
    expect(betterSide(88, 131, true)).toBe('self');
    expect(betterSide(5, 5)).toBeNull();
  });

  test('series samples: every 30 s plus the end (23:41 → 49 samples, last at 1421 s)', () => {
    expect(seriesSampleCount(DEMO_DURATION_S, DEMO_STEP_S)).toBe(49);
    expect(seriesSampleCount(600, 30)).toBe(21);
    expect(seriesSampleCount(0, 30)).toBe(1);
    expect(sampleTime(47, 30, 1421)).toBe(1410);
    expect(sampleTime(48, 30, 1421)).toBe(1421);
  });

  test('units table sorting: kills of both sides, then type id', () => {
    const rows = sortUnitRows([
      { typeId: 'b', self: { built: 1, lost: 0, kills: 1 }, enemy: { built: 0, lost: 0, kills: 1 } },
      { typeId: 'a', self: { built: 1, lost: 0, kills: 2 }, enemy: { built: 0, lost: 0, kills: 0 } },
      { typeId: 'c', self: { built: 1, lost: 0, kills: 9 }, enemy: { built: 0, lost: 0, kills: 0 } },
    ]);
    expect(rows.map((r) => r.typeId)).toEqual(['c', 'a', 'b']);
  });

  test('tab content: overview = eco + army with mass income + army value', () => {
    expect(SCORE_TAB_CONTENT.overview).toEqual({ groups: ['economy', 'army'], charts: ['massIncome', 'armyValue'] });
    expect(SCORE_TAB_CONTENT.units.charts).toBeNull();
  });
});

describe('chart maths (pure)', () => {
  test('niceScale: 4–5 intervals of 1/2/2,5/5 × 10^n, the tightest top wins', () => {
    expect(niceScale(61)).toEqual({ max: 80, step: 20, ticks: [0, 20, 40, 60, 80] });
    expect(niceScale(4300)).toEqual({ max: 5000, step: 1000, ticks: [0, 1000, 2000, 3000, 4000, 5000] });
    expect(niceScale(3264)).toEqual({ max: 4000, step: 1000, ticks: [0, 1000, 2000, 3000, 4000] });
    expect(niceScale(9).max).toBe(10);
    expect(niceScale(0)).toEqual({ max: 4, step: 1, ticks: [0, 1, 2, 3, 4] });
    expect(niceScale(Number.NaN).max).toBe(4);
    for (const v of [1, 7, 13, 99, 101, 555, 1234, 98_765]) {
      const s = niceScale(v);
      expect(s.max).toBeGreaterThanOrEqual(v);
      expect(s.ticks[0]).toBe(0);
      expect(s.ticks.at(-1)).toBe(s.max);
    }
  });

  test('timeTicks: whole minutes, at most 7 labels; minuteLabel', () => {
    expect(timeTicks(DEMO_DURATION_S)).toEqual([0, 240, 480, 720, 960, 1200]);
    expect(timeTicks(300)).toEqual([0, 60, 120, 180, 240, 300]);
    expect(timeTicks(3 * 3600).length).toBeLessThanOrEqual(7);
    expect(minuteLabel(960)).toBe('16:00');
  });

  test('ONE y axis: both series share the scale of the larger maximum', () => {
    const g = chartGeometry(BOX, 600, [
      [0, 10, 20],
      [0, 50, 61],
    ]);
    expect(g.scale.max).toBe(80);
    expect(g.x0).toBe(44);
    expect(g.x1).toBe(444);
    expect(g.y(0)).toBe(212);
    expect(g.y(80)).toBe(12);
    expect(g.y(40)).toBe(112);
    expect(g.x(0)).toBe(44);
    expect(g.x(600)).toBe(444);
    expect(g.x(900)).toBe(444);
    // Swapping the series gives the same axis.
    const g2 = chartGeometry(BOX, 600, [
      [0, 50, 61],
      [0, 10, 20],
    ]);
    expect(g2.scale).toEqual(g.scale);
  });

  test('linePath: M/L commands, last sample at the match end', () => {
    const g = chartGeometry(BOX, 70, [[0, 40, 60, 80]]);
    // 70 s at 30-s steps: samples at 0, 30, 60 and the end (70 s) → the last point sits at x1.
    expect(linePath(g, [0, 40, 60, 80], 30, 70)).toBe('M44 212 L215.4 112 L386.9 62 L444 12');
  });

  test('separateLabels pushes colliding end labels apart and keeps them inside', () => {
    expect(separateLabels([100, 104], 14, 0, 300)).toEqual([100, 114]);
    expect(separateLabels([104, 100], 14, 0, 300)).toEqual([114, 100]);
    expect(separateLabels([295, 298], 14, 0, 300)).toEqual([286, 300]);
    expect(separateLabels([2, 1], 14, 5, 300)).toEqual([19, 5]);
    expect(separateLabels([50, 200], 14, 0, 300)).toEqual([50, 200]);
  });

  test('indexAtX: nearest sample in time, clamped to the plot', () => {
    const g = chartGeometry(BOX, 90, [[0, 1, 2, 3]]);
    expect(indexAtX(g, 44, 4, 30, 90)).toBe(0);
    expect(indexAtX(g, 44 + 400 / 3, 4, 30, 90)).toBe(1);
    expect(indexAtX(g, 44 + 400 * 0.6, 4, 30, 90)).toBe(2);
    expect(indexAtX(g, 9999, 4, 30, 90)).toBe(3);
    expect(indexAtX(g, -5, 4, 30, 90)).toBe(0);
    expect(indexAtX(g, 100, 1, 30, 90)).toBe(0);
  });

  test('shortTime and event texts', () => {
    expect(shortTime(48)).toBe('0:48');
    expect(shortTime(132)).toBe('2:12');
    const houses = {
      self: { name: 'Ambrecht', color: 'team-blau', controller: 'human' as const, ai: null },
      enemy: { name: 'Dorne', color: 'team-rot', controller: 'ai' as const, ai: 'normal' as const },
    };
    expect(eventText(CAT, { timeS: 252, kind: 'firstFactory', side: 'both' }, houses)).toBe('04:12 erste Fabrik (beide)');
    expect(eventText(CAT, { timeS: 1421, kind: 'commanderLost', side: 'enemy' }, houses)).toBe('23:41 Lotbruch Dorne');
    expect(eventText(CAT, { timeS: 1111, kind: 'objective', side: 'self', note: 'ui.score.objective.bridgeHeld' }, houses)).toBe(
      '18:31 Brücke gehalten (Ambrecht)',
    );
  });
});

const SERIES: ScoreSeries = { id: 'massIncome', stepS: 30, self: [0, 20, 40, 61], enemy: [0, 30, 35, 6] };

describe('ScoreChart', () => {
  test('two paths on one axis: self solid, enemy dashed; legend; end labels; no crosshair until hover', () => {
    renderMenu(
      <ScoreChart
        series={SERIES}
        title="Mass"
        sub="sub"
        unit="M/s"
        durationS={90}
        self={{ name: 'Ambrecht', color: 'var(--team-blau)' }}
        enemy={{ name: 'Dorne', color: 'var(--team-rot)' }}
        fallback={{ width: 544, height: 222 }}
      />,
    );
    const svg = screen.getByTestId('chart-massIncome-svg');
    const self = svg.querySelector('path[data-series="self"]') as SVGPathElement;
    const enemy = svg.querySelector('path[data-series="enemy"]') as SVGPathElement;
    expect(self.getAttribute('stroke')).toBe('var(--team-blau)');
    expect(self.getAttribute('stroke-dasharray')).toBeNull();
    expect(enemy.getAttribute('stroke')).toBe('var(--team-rot)');
    expect(enemy.getAttribute('stroke-dasharray')).toBe('6 4');
    // Exactly one set of y ticks (one axis): 0, 20, 40, 60, 80 on the left.
    const yTicks = Array.from(svg.querySelectorAll('text.tk[text-anchor="end"]')).map((n) => n.textContent);
    expect(yTicks).toEqual(['0', '20', '40', '60', '80']);
    expect(svg.querySelectorAll('line.ax')).toHaveLength(1);
    // Direct labels at the line ends, right of the last sample.
    const endSelf = svg.querySelector('text[data-end="self"]') as SVGTextElement;
    const endEnemy = svg.querySelector('text[data-end="enemy"]') as SVGTextElement;
    expect(endSelf.textContent).toBe('61');
    expect(endEnemy.textContent).toBe('6');
    const x1 = 544 - CHART_MARGINS.right;
    expect(Number(endSelf.getAttribute('x'))).toBe(x1 + 8);
    // Legend with the dashed marker for the second series.
    const legend = screen.getByTestId('chart-massIncome').querySelector('.lg') as HTMLElement;
    expect(legend.textContent).toBe('AmbrechtDorne');
    expect(legend.querySelectorAll('i.dash')).toHaveLength(1);
    expect(screen.getByTestId('chart-massIncome-plot').getAttribute('aria-label')).toBe('Mass: Ambrecht 61, Dorne 6 am Ende');
    expect(screen.queryByTestId('chart-massIncome-crosshair')).toBeNull();
  });

  test('crosshair tooltip follows the pointer and shows both values of that sample', async () => {
    renderMenu(
      <ScoreChart
        series={SERIES}
        title="Mass"
        sub="sub"
        unit="M/s"
        durationS={90}
        self={{ name: 'Ambrecht', color: 'var(--team-blau)' }}
        enemy={{ name: 'Dorne', color: 'var(--team-rot)' }}
        fallback={{ width: 544, height: 222 }}
      />,
    );
    const hit = screen.getByTestId('chart-massIncome-hit');
    // svg left = 0 in happy-dom; the pointer near 56 s snaps to sample 2 (60 s).
    await flushSignals(() => fireEvent.pointerMove(hit, { clientX: 44 + (400 * 2) / 3 }));
    const tip = screen.getByTestId('chart-massIncome-tip');
    expect(tip.textContent).toBe('01:00Ambrecht 40 M/sDorne 35 M/s');
    const xh = screen.getByTestId('chart-massIncome-crosshair');
    const plotW = 544 - CHART_MARGINS.left - CHART_MARGINS.right;
    expect(Number(xh.getAttribute('x1'))).toBeCloseTo(CHART_MARGINS.left + (plotW * 2) / 3, 5);
    await flushSignals(() => fireEvent.pointerLeave(hit));
    expect(screen.queryByTestId('chart-massIncome-tip')).toBeNull();
  });

  test('keyboard: ←/→/Home/End move the crosshair when the plot has focus', async () => {
    renderMenu(
      <ScoreChart
        series={SERIES}
        title="Mass"
        sub="sub"
        unit="M/s"
        durationS={90}
        self={{ name: 'A', color: 'red' }}
        enemy={{ name: 'B', color: 'blue' }}
        fallback={{ width: 544, height: 222 }}
      />,
    );
    const plot = screen.getByTestId('chart-massIncome-plot');
    expect(plot.tabIndex).toBe(0);
    await flushSignals(() => key(plot, 'ArrowLeft'));
    expect(screen.getByTestId('chart-massIncome-tip').textContent).toContain('01:00');
    await flushSignals(() => key(plot, 'Home'));
    expect(screen.getByTestId('chart-massIncome-tip').textContent).toContain('00:00');
    await flushSignals(() => key(plot, 'End'));
    expect(screen.getByTestId('chart-massIncome-tip').textContent).toBe('01:30A 61 M/sB 6 M/s');
  });
});

describe('ScoreScreen (A13)', () => {
  test('verdict, lore, meta and crumb of the 23:41 victory', () => {
    renderMenu(<ScoreScreen />, { setup: (m) => applyScoreDemo(m) });
    const v = screen.getByTestId('score-verdict');
    expect(v.dataset['verdict']).toBe('victory');
    expect(v.querySelector('h2')?.textContent).toBe('Sieg');
    expect(v.querySelector('p')?.textContent).toBe('Das Lot von Haus Dorne ist gebrochen. Die Ader gehört Haus Ambrecht.');
    expect(screen.getByTestId('score-time').textContent).toBe('23:41');
    expect(v.textContent).toMatch(/Punkte18\.240/);
    expect(v.textContent).toMatch(/Effizienz91\s%/);
    expect(screen.getByTestId('score-crumb').textContent).toBe('Setons · Assassination · 1v1 · 23:41');
    expect(screen.getByTestId('score-screen').getAttribute('aria-labelledby')).toBe('ffm-score-verdict');
    expect(focusedId()).toBe('score-main-menu');
  });

  test('better value in ember (class win) AND bold, lower-is-better rows flip, screen-reader note', () => {
    renderMenu(<ScoreScreen />, { setup: (m) => applyScoreDemo(m) });
    const row = (id: string): HTMLElement => screen.getByTestId(`score-row-${id}`);
    const cell = (id: string, side: 'self' | 'enemy'): HTMLElement => row(id).querySelector(`td[data-side="${side}"]`) as HTMLElement;
    expect(cell('massProduced', 'self').className).toBe('win');
    expect(cell('massProduced', 'enemy').className).toBe('');
    expect(cell('unitsBuilt', 'enemy').className).toBe('win');
    expect(row('stallTime').dataset['better']).toBe('self');
    expect(cell('stallTime', 'self').textContent).toBe('0:48 (besser)');
    expect(cell('stallTime', 'enemy').textContent).toBe('2:12');
    expect(row('unitsLost').dataset['better']).toBe('self');
    expect(screen.getByTestId('score-table').querySelectorAll('td.win')).toHaveLength(10);
    // Groups in the overview: economy + army.
    expect(Array.from(screen.getByTestId('score-table').querySelectorAll('.stbl__grp th')).map((t) => t.textContent)).toEqual([
      'Wirtschaft',
      'Armee',
    ]);
    const best = screen.getByTestId('best-units');
    expect(within(best).getAllByText(/Abschüsse|Abschuss/)).toHaveLength(4);
    expect(best.textContent).toContain('48 Abschüsse');
  });

  test('overview charts: mass income and army value, events strip', () => {
    renderMenu(<ScoreScreen />, { setup: (m) => applyScoreDemo(m) });
    expect(screen.getByTestId('chart-massIncome')).toBeTruthy();
    expect(screen.getByTestId('chart-armyValue')).toBeTruthy();
    expect(screen.queryByTestId('chart-energyIncome')).toBeNull();
    const events = screen.getByTestId('score-events').textContent ?? '';
    expect(events).toContain('04:12 erste Fabrik (beide)');
    expect(events).toContain('23:41 Lotbruch Dorne');
  });

  test('tabs: setScoreTab via click; economy/army/units content', async () => {
    const r = renderMenu(<ScoreScreen />, { setup: (m) => applyScoreDemo(m), controller: true });
    await flushSignals(() => fireEvent.click(screen.getByTestId('score-tab-economy')));
    expect(callsOf(r.calls, 'setScoreTab')).toEqual([['economy']]);
    expect(screen.getByTestId('score-screen').dataset['tab']).toBe('economy');
    expect(screen.getByTestId('chart-energyIncome')).toBeTruthy();
    expect(screen.queryByTestId('score-row-unitsBuilt')).toBeNull();
    await flushSignals(() => fireEvent.click(screen.getByTestId('score-tab-army')));
    expect(screen.getByTestId('chart-unitsAlive')).toBeTruthy();
    expect(screen.queryByTestId('score-row-massProduced')).toBeNull();
    await flushSignals(() => fireEvent.click(screen.getByTestId('score-tab-units')));
    const table = screen.getByTestId('units-table');
    const firstRow = table.querySelector('tbody tr') as HTMLElement;
    expect(firstRow.dataset['testid']).toBe('unit-row-core:lnd_t1_tank');
    expect(firstRow.querySelectorAll('td.win')).toHaveLength(1);
    expect(screen.getByTestId('score-tab-units').getAttribute('aria-selected')).toBe('true');
    // Clicking the selected tab does not send a command.
    fireEvent.click(screen.getByTestId('score-tab-units'));
    expect(callsOf(r.calls, 'setScoreTab')).toEqual([['economy'], ['army'], ['units']]);
  });

  test('footer: save replay (then disabled), watch, rematch, main menu', async () => {
    const r = renderMenu(<ScoreScreen />, { setup: (m) => applyScoreDemo(m), controller: true });
    await flushSignals(() => fireEvent.click(screen.getByTestId('score-save-replay')));
    fireEvent.click(screen.getByTestId('score-watch-replay'));
    fireEvent.click(screen.getByTestId('score-rematch'));
    fireEvent.click(screen.getByTestId('score-main-menu'));
    expect(names(r.calls)).toEqual(['saveReplay', 'watchReplay', 'rematch', 'navigate']);
    expect(callsOf(r.calls, 'navigate')).toEqual([['main']]);
    const save = screen.getByTestId('score-save-replay') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(save.textContent).toContain('Replay gespeichert');
  });

  test('defeat: "Lot gebrochen" with its lore line, commander lost on our side', () => {
    renderMenu(<ScoreScreen />, { setup: (m) => applyScoreDemo(m, 'defeat') });
    const v = screen.getByTestId('score-verdict');
    expect(v.className).toContain('is-defeat');
    expect(v.querySelector('h2')?.textContent).toBe('Lot gebrochen');
    expect(v.querySelector('p')?.textContent).toBe('Anspruch erloschen. Die Charta erklärt alles Gegossene zu Schlacke.');
    expect(screen.getByTestId('score-events').textContent).toContain('23:41 Lotbruch Ambrecht');
    expect(screen.getByTestId('score-row-massProduced').dataset['better']).toBe('enemy');
  });

  test('minimal form: verdict + match time + buttons only', () => {
    renderMenu(<ScoreScreen />, { setup: (m) => applyScoreDemo(m, 'minimal') });
    expect(screen.getByTestId('score-screen').dataset['tab']).toBe('minimal');
    expect(screen.getByTestId('score-time').textContent).toBe('23:41');
    expect(screen.queryByTestId('score-tabs')).toBeNull();
    expect(screen.queryByTestId('score-table')).toBeNull();
    expect(screen.getByTestId('score-verdict').textContent).not.toContain('Punkte');
    expect(screen.getByTestId('score-rematch')).toBeTruthy();
    expect(screen.getByTestId('score-main-menu')).toBeTruthy();
  });

  test('team colours follow the mode (cvd: palette by slot order)', async () => {
    const r = renderMenu(<ScoreScreen />, { setup: (m) => applyScoreDemo(m) });
    const selfPath = (): string | null => screen.getByTestId('chart-massIncome-svg').querySelector('path[data-series="self"]')?.getAttribute('stroke') ?? null;
    expect(selfPath()).toBe('var(--team-blau)');
    await flushSignals(() => {
      r.model.teams.value = 'cvd';
    });
    expect(selfPath()).toBe('var(--cvd-blau)');
    expect(screen.getByTestId('chart-massIncome-svg').querySelector('path[data-series="enemy"]')?.getAttribute('stroke')).toBe('var(--cvd-rot)');
    await flushSignals(() => {
      r.model.teams.value = 'relation';
    });
    expect(selfPath()).toBe('var(--rel-self)');
  });
});
