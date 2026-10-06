/**
 * Score screen (ui.md §5.15, A13; markup after docs/design/ui-mockups/score.html): verdict large ("Sieg" /
 * "Lot gebrochen" with a lore line), meta (match time, score, efficiency, replay size), tabs Übersicht /
 * Wirtschaft / Armee / Einheiten. Overview: key figures of both houses (better value in ember AND bold),
 * best units, event strip and two history charts (one y axis, team colours, dashed second series, direct
 * labels, legend, crosshair). Footer: save/watch replay, rematch, main menu. Minimal form (A4): verdict +
 * match time + buttons only.
 */
import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';
import { IconSprite, StrategicIcon } from '../../data/StrategicIcon.tsx';
import { fmtBytes, fmtInt, fmtPct, fmtTime } from '../../format/index.ts';
import type { UnitCatalog } from '../../data/catalog.ts';
import { unitName } from '../../data/roster.ts';
import { t, tn } from '../../i18n/t.ts';
import type { MsgKey } from '../../i18n/tables.ts';
import { useCommands, useHud, useUnitCatalog } from '../../model/index.ts';
import { SCORE_TABS, SCORE_TAB_CONTENT, betterSide, sortUnitRows } from '../../model/menus/score.ts';
import type { ScoreEvent, ScoreHouse, ScoreRow, ScoreSection, ScoreSeriesId, ScoreTab } from '../../model/menus/score.ts';
import { teamColorCss } from '../../model/menus/teams.ts';
import type { TeamColorMode } from '../../model/menus/teams.ts';
import { Button } from '../../ui/Button.tsx';
import { cx } from '../../ui/cx.ts';
import { Panel, PanelHead } from '../../ui/Panel.tsx';
import { Tab, Tabs } from '../../ui/Tab.tsx';
import { useInitialFocus } from '../shared/focus.ts';
import { MenuBackground } from '../shared/MapCanvas.tsx';
import { dataText, victoryLabel } from '../shared/labels.ts';
import { ScoreChart } from './ScoreChart.tsx';

const TAB_KEY: Readonly<Record<ScoreTab, MsgKey>> = {
  overview: 'ui.score.tab.overview',
  economy: 'ui.score.tab.economy',
  army: 'ui.score.tab.army',
  units: 'ui.score.tab.units',
};

const CHART_TEXT: Readonly<Record<ScoreSeriesId, { readonly title: MsgKey; readonly sub: MsgKey; readonly unit: MsgKey }>> = {
  massIncome: { title: 'ui.score.chart.massIncome', sub: 'ui.score.chart.massIncome.sub', unit: 'ui.score.unit.massIncome' },
  energyIncome: { title: 'ui.score.chart.energyIncome', sub: 'ui.score.chart.energyIncome.sub', unit: 'ui.score.unit.energyIncome' },
  armyValue: { title: 'ui.score.chart.armyValue', sub: 'ui.score.chart.armyValue.sub', unit: 'ui.score.unit.armyValue' },
  unitsAlive: { title: 'ui.score.chart.unitsAlive', sub: 'ui.score.chart.unitsAlive.sub', unit: 'ui.score.unit.unitsAlive' },
};

const tabId = (tab: ScoreTab): string => `ffm-score-tab-${tab}`;
const paneId = 'ffm-score-pane';

/** "0:48" (short time for table cells). */
export function shortTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function cellText(row: ScoreRow, v: number): string {
  return row.isTime ? shortTime(v) : fmtInt(v);
}

/** Event strip text: "04:12 erste Fabrik (beide)", "09:40 Landwerk II (Ambrecht)", "23:41 Lotbruch Dorne". */
export function eventText(cat: UnitCatalog, e: ScoreEvent, houses: { readonly self: ScoreHouse; readonly enemy: ScoreHouse }): string {
  const who = e.side === 'both' ? null : houses[e.side].name;
  let text: string;
  if (e.kind === 'commanderLost') return `${fmtTime(e.timeS)} ${t('ui.score.event.commanderLost', { house: who ?? '' })}`;
  if (e.kind === 'firstFactory') text = t('ui.score.event.firstFactory');
  else if (e.kind === 'techUp') text = e.typeId ? unitName(cat, e.typeId) : '';
  else text = dataText(e.note ?? '');
  const full = who === null ? t('ui.score.event.both', { text }) : t('ui.score.event.by', { text, house: who });
  return `${fmtTime(e.timeS)} ${full}`;
}

interface Colors {
  readonly self: string;
  readonly enemy: string;
}

function houseColors(mode: TeamColorMode, houses: { readonly self: ScoreHouse; readonly enemy: ScoreHouse }): Colors {
  return { self: teamColorCss(mode, houses.self.color, 0, 'self'), enemy: teamColorCss(mode, houses.enemy.color, 1, 'enemy') };
}

function FigureTable({ s, groups, colors }: { readonly s: ScoreSection; readonly groups: readonly ScoreRow['group'][]; readonly colors: Colors }): JSX.Element {
  const houses = s.houses.value;
  const rows = s.rows.value;
  return (
    <table class="stbl" aria-label={t('ui.score.table')} data-testid="score-table">
      <thead>
        <tr>
          <th scope="col">{t('ui.score.col.metric')}</th>
          <th scope="col">
            <span style={{ '--team': colors.self }}>
              <i />
              {houses.self.name}
            </span>
          </th>
          <th scope="col">
            <span style={{ '--team': colors.enemy }}>
              <i />
              {houses.enemy.name}
            </span>
          </th>
        </tr>
      </thead>
      <tbody>
        {groups.map((grp) => [
          <tr key={`g-${grp}`} class="stbl__grp">
            <th colSpan={3} scope="colgroup">
              {t(grp === 'economy' ? 'ui.score.group.economy' : 'ui.score.group.army')}
            </th>
          </tr>,
          ...rows
            .filter((r) => r.group === grp)
            .map((r) => {
              const better = betterSide(r.self, r.enemy, r.lowerIsBetter);
              return (
                <tr key={r.id} data-testid={`score-row-${r.id}`} data-better={better ?? 'tie'}>
                  <th scope="row">{t(`ui.score.row.${r.id}`)}</th>
                  <td class={cx(better === 'self' && 'win')} data-side="self">
                    {cellText(r, r.self)}
                    {better === 'self' ? <span class="ff-sr">{` (${t('ui.score.better')})`}</span> : null}
                  </td>
                  <td class={cx(better === 'enemy' && 'win')} data-side="enemy">
                    {cellText(r, r.enemy)}
                    {better === 'enemy' ? <span class="ff-sr">{` (${t('ui.score.better')})`}</span> : null}
                  </td>
                </tr>
              );
            }),
        ])}
      </tbody>
    </table>
  );
}

function BestUnits({ s, color }: { readonly s: ScoreSection; readonly color: string }): JSX.Element {
  const units = useUnitCatalog();
  return (
    <>
      <PanelHead class="score-best__head" title={t('ui.score.best', { house: s.houses.value.self.name })} />
      <div class="score-best" data-testid="best-units">
        {s.bestUnits.value.map((u) => (
          <div key={u.typeId} class="score-best__unit">
            <StrategicIcon typeId={u.typeId} color={color} />
            <b>{unitName(units, u.typeId)}</b>
            <span class="num ff-dim">{tn('ui.score.kills', u.kills)}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function UnitsTable({ s, colors }: { readonly s: ScoreSection; readonly colors: Colors }): JSX.Element {
  const units = useUnitCatalog();
  const houses = s.houses.value;
  const rows = sortUnitRows(s.units.value);
  const head = (side: 'self' | 'enemy'): JSX.Element => (
    <span style={{ '--team': colors[side] }}>
      <i />
      {houses[side].name}
    </span>
  );
  return (
    <table class="stbl score-units" aria-label={t('ui.score.units.table')} data-testid="units-table">
      <thead>
        <tr>
          <th scope="col">{t('ui.score.units.type')}</th>
          <th scope="colgroup" colSpan={3}>
            {head('self')}
          </th>
          <th scope="colgroup" colSpan={3}>
            {head('enemy')}
          </th>
        </tr>
        <tr class="stbl__grp">
          <th />
          {(['self', 'enemy'] as const).flatMap((side) => [
            <th key={`${side}-b`} scope="col">
              {t('ui.score.units.built')}
            </th>,
            <th key={`${side}-l`} scope="col">
              {t('ui.score.units.lost')}
            </th>,
            <th key={`${side}-k`} scope="col">
              {t('ui.score.units.kills')}
            </th>,
          ])}
        </tr>
      </thead>
      <tbody>
        {rows.map((u) => {
          const better = betterSide(u.self.kills, u.enemy.kills);
          return (
            <tr key={u.typeId} data-testid={`unit-row-${u.typeId}`}>
              <th scope="row">
                <span class="score-units__name">
                  <StrategicIcon typeId={u.typeId} color={colors.self} />
                  {unitName(units, u.typeId)}
                </span>
              </th>
              <td>{fmtInt(u.self.built)}</td>
              <td>{fmtInt(u.self.lost)}</td>
              <td class={cx(better === 'self' && 'win')}>{fmtInt(u.self.kills)}</td>
              <td>{fmtInt(u.enemy.built)}</td>
              <td>{fmtInt(u.enemy.lost)}</td>
              <td class={cx(better === 'enemy' && 'win')}>{fmtInt(u.enemy.kills)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Charts({ s, ids, colors }: { readonly s: ScoreSection; readonly ids: readonly [ScoreSeriesId, ScoreSeriesId]; readonly colors: Colors }): JSX.Element {
  const units = useUnitCatalog();
  const houses = s.houses.value;
  const series = s.series.value;
  const events = s.events.value;
  return (
    <div class="charts">
      <ul class="events" aria-label={t('ui.score.events')} data-testid="score-events">
        <li aria-hidden="true">{t('ui.score.events')}</li>
        {events.map((e, i) => (
          <li key={i}>
            {i > 0 ? <span aria-hidden="true">{'· '}</span> : null}
            {eventText(units, e, houses)}
          </li>
        ))}
      </ul>
      {ids.map((id) => {
        const ser = series.find((x) => x.id === id);
        if (!ser) return <div key={id} class="chart ff-panel" />;
        const txt = CHART_TEXT[id];
        return (
          <ScoreChart
            key={id}
            series={ser}
            title={t(txt.title)}
            sub={t(txt.sub)}
            unit={t(txt.unit)}
            durationS={s.durationS.value}
            self={{ name: houses.self.name, color: colors.self }}
            enemy={{ name: houses.enemy.name, color: colors.enemy }}
          />
        );
      })}
    </div>
  );
}

function Verdict({ s, minimal }: { readonly s: ScoreSection; readonly minimal: boolean }): JSX.Element {
  const houses = s.houses.value;
  const win = s.verdict.value === 'victory';
  const replay = s.replayBytes.value;
  return (
    <div class={cx('verdict', !win && 'is-defeat')} data-testid="score-verdict" data-verdict={s.verdict.value}>
      <div>
        <h2 id="ffm-score-verdict">{t(win ? 'ui.score.verdict.victory' : 'ui.score.verdict.defeat')}</h2>
        <p>{win ? t('ui.score.lore.victory', { enemy: houses.enemy.name, self: houses.self.name }) : t('ui.score.lore.defeat')}</p>
      </div>
      <div class="meta">
        <span>
          {t('ui.score.meta.time')}
          <b class="num" data-testid="score-time">
            {fmtTime(s.durationS.value)}
          </b>
        </span>
        {minimal ? null : (
          <>
            <span>
              {t('ui.score.meta.points')}
              <b class="num">{fmtInt(s.points.value)}</b>
            </span>
            <span>
              {t('ui.score.meta.efficiency')}
              <b class="num">{fmtPct(s.efficiency.value)}</b>
            </span>
            <span>
              {t('ui.score.meta.replay')}
              <b class="num">{replay !== null ? fmtBytes(replay) : t('ui.score.meta.noReplay')}</b>
            </span>
          </>
        )}
      </div>
    </div>
  );
}

export function ScoreScreen(): JSX.Element {
  const model = useHud();
  const cmd = useCommands();
  const s = model.menus.score;
  const minimal = s.minimal.value;
  const tab = s.tab.value;
  const houses = s.houses.value;
  const colors = houseColors(model.teams.value, houses);
  const content = SCORE_TAB_CONTENT[tab];
  const replay = s.replayBytes.value;
  const saved = s.replaySaved.value;
  const home = useRef<HTMLButtonElement>(null);
  useInitialFocus(home);

  return (
    <div
      class="menu-page"
      data-component="ScoreScreen"
      data-testid="score-screen"
      data-tab={minimal ? 'minimal' : tab}
      role="region"
      aria-labelledby="ffm-score-verdict"
    >
      <IconSprite />
      <MenuBackground seed={41} view={[0.3, 0.3, 0.9, 0.62]} />
      <div class="menu-root">
        <div class="menu-top">
          <span class="crumb" data-testid="score-crumb">
            {t('ui.score.crumb', { map: s.mapName.value, victory: victoryLabel(s.victory.value), time: fmtTime(s.durationS.value) })}
          </span>
          {minimal ? null : (
            <div class="sp">
              <Tabs label={t('ui.score.tabs')} testId="score-tabs">
                {SCORE_TABS.map((id) => (
                  <Tab key={id} selected={id === tab} controls={paneId} onSelect={() => id !== tab && cmd.setScoreTab(id)} testId={`score-tab-${id}`}>
                    <span id={tabId(id)}>{t(TAB_KEY[id])}</span>
                  </Tab>
                ))}
              </Tabs>
            </div>
          )}
        </div>
        <div class={cx('score', minimal && 'score--minimal')}>
          <Verdict s={s} minimal={minimal} />
          <div class="rule" />
          {minimal ? (
            <div />
          ) : (
            <div id={paneId} role="tabpanel" aria-labelledby={tabId(tab)} class={cx('sgrid', tab === 'units' && 'sgrid--units')} data-testid={`score-pane-${tab}`}>
              {tab === 'units' ? (
                <>
                  <Panel class="score-left" component="ScoreUnits" testId="score-units-panel" panelId="score-units">
                    <UnitsTable s={s} colors={colors} />
                  </Panel>
                  <Panel class="score-left" component="ScoreBest" testId="score-best-panel" panelId="score-best">
                    <BestUnits s={s} color={colors.self} />
                  </Panel>
                </>
              ) : (
                <>
                  <Panel class="score-left" component="ScoreTable" testId="score-table-panel" panelId="score-table">
                    <FigureTable s={s} groups={content.groups} colors={colors} />
                    {tab === 'overview' ? <BestUnits s={s} color={colors.self} /> : null}
                  </Panel>
                  {content.charts ? <Charts s={s} ids={content.charts} colors={colors} /> : null}
                </>
              )}
            </div>
          )}
        </div>
        <div class="menu-foot">
          <span>{minimal ? '' : t('ui.score.foot')}</span>
          <div class="sp">
            <Button disabled={replay === null || saved} icon={saved ? 'ok' : undefined} onClick={() => cmd.saveReplay()} testId="score-save-replay">
              {t(saved ? 'ui.score.replaySaved' : 'ui.score.saveReplay')}
            </Button>
            <Button disabled={replay === null} onClick={() => cmd.watchReplay()} testId="score-watch-replay">
              {t('ui.score.watchReplay')}
            </Button>
            <Button onClick={() => cmd.rematch()} testId="score-rematch">
              {t('ui.score.rematch')}
            </Button>
            <button ref={home} type="button" class="ff-btn ff-btn--primary" onClick={() => cmd.navigate('main')} data-testid="score-main-menu">
              {t('ui.score.mainMenu')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

