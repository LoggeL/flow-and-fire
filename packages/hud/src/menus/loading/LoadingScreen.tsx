/**
 * Loading screen (ui.md §5.15, P3; markup after docs/design/ui-mockups/loading.html): map name large,
 * description, rules, both houses with a readiness badge, map preview with starts; five phases with their
 * own bars, the current file with its source, bytes, total bar and a hint line. Error: badge + cause +
 * "Erneut" / "Ins Menü" (focus on "Erneut"). Data shape follows apps/game/src/loading.ts (see
 * phasesFromGameState). Bars use transform: scaleX(var(--v)).
 */
import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';
import { fmtBytes, fmtDec, fmtInt, fmtPct } from '../../format/index.ts';
import { t } from '../../i18n/t.ts';
import type { MsgKey } from '../../i18n/tables.ts';
import { useCommands, useHud } from '../../model/index.ts';
import { currentPhase, overallProgress } from '../../model/menus/loading.ts';
import type { HouseReadiness, LoadingHouse, LoadingPhase, LoadingPhaseId, LoadingPhaseState } from '../../model/menus/loading.ts';
import { compassOf } from '../../model/menus/skirmish.ts';
import { teamColorCss } from '../../model/menus/teams.ts';
import { Badge } from '../../ui/Badge.tsx';
import { Button } from '../../ui/Button.tsx';
import { cx } from '../../ui/cx.ts';
import type { Tone } from '../../ui/Key.tsx';
import { useInitialFocus } from '../shared/focus.ts';
import { aiLevelLabel, compassLabel, dataText, houseLabel, victoryLabel } from '../shared/labels.ts';
import { MapPreview, MenuBackground } from '../shared/MapCanvas.tsx';
import type { StartMarker } from '../shared/MapCanvas.tsx';

const PHASE_LABEL: Readonly<Record<LoadingPhaseId, MsgKey>> = {
  manifest: 'ui.loading.phase.manifest',
  assets: 'ui.loading.phase.assets',
  map: 'ui.loading.phase.map',
  simWorker: 'ui.loading.phase.simWorker',
  aiWorker: 'ui.loading.phase.aiWorker',
};

const PHASE_NOW: Readonly<Record<LoadingPhaseId, MsgKey>> = {
  manifest: 'ui.loading.now.manifest',
  assets: 'ui.loading.now.assets',
  map: 'ui.loading.now.map',
  simWorker: 'ui.loading.now.simWorker',
  aiWorker: 'ui.loading.now.aiWorker',
};

const PHASE_STATE: Readonly<Record<LoadingPhaseState, MsgKey>> = {
  pending: 'ui.loading.phase.state.pending',
  active: 'ui.loading.phase.state.active',
  done: 'ui.loading.phase.state.done',
  error: 'ui.loading.phase.state.error',
};

const PHASE_CLASS: Readonly<Record<LoadingPhaseState, string | undefined>> = {
  pending: undefined,
  active: 'is-now',
  done: 'is-done',
  error: 'is-error',
};

const HINT_KEYS: readonly MsgKey[] = ['ui.loading.tip.0', 'ui.loading.tip.1', 'ui.loading.tip.2', 'ui.loading.tip.3', 'ui.loading.tip.4'];

/** Hint of the rotation index (wraps around). */
export function loadingHint(index: number): string {
  const n = HINT_KEYS.length;
  return t(HINT_KEYS[((Math.floor(index) % n) + n) % n] as MsgKey);
}

function readinessBadge(h: LoadingHouse): { readonly tone: Tone; readonly key: MsgKey } {
  const map: Readonly<Record<HouseReadiness, { readonly tone: Tone; readonly key: MsgKey }>> = {
    ready: { tone: 'ok', key: 'ui.loading.ready.ready' },
    starting: { tone: 'neutral', key: h.controller === 'ai' ? 'ui.loading.ready.aiStarting' : 'ui.loading.ready.loading' },
    waiting: { tone: 'neutral', key: 'ui.loading.ready.waiting' },
    error: { tone: 'crit', key: 'ui.loading.ready.error' },
  };
  return map[h.readiness];
}

function Phase({ p }: { readonly p: LoadingPhase }): JSX.Element {
  const name = t(PHASE_LABEL[p.id]);
  const v = p.state === 'done' ? 1 : Math.max(0, Math.min(1, p.progress));
  return (
    <div class={cx('phase', PHASE_CLASS[p.state])} data-testid={`phase-${p.id}`} data-state={p.state}>
      <span data-fit="">
        {p.state === 'done' ? '✓ ' : ''}
        {name}
      </span>
      <div
        class="ff-bar"
        role="progressbar"
        aria-label={t(PHASE_STATE[p.state], { phase: name, pct: fmtPct(v) })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(v * 100)}
      >
        <i style={{ '--v': String(v) }} />
      </div>
    </div>
  );
}

export function LoadingScreen(): JSX.Element {
  const model = useHud();
  const cmd = useCommands();
  const l = model.menus.loading;
  const teams = model.teams.value;
  const phases = l.phases.value;
  const error = l.error.value;
  const total = overallProgress(phases);
  const now = currentPhase(phases);
  const file = l.currentFile.value;
  const bytes = l.bytes.value;
  const counts = l.counts.value;
  const rules = l.rules.value;
  const starts = l.startPositions.value;
  const houses = l.houses.value;
  const retry = useRef<HTMLButtonElement>(null);
  useInitialFocus(retry, error !== null);

  const houseColor = (h: LoadingHouse, i: number): string => teamColorCss(teams, h.color, i, h.controller === 'human' ? 'self' : 'enemy');
  const markers: StartMarker[] = houses.flatMap((h, i) => {
    const pos = starts[h.start];
    if (!pos) return [];
    return [{ index: h.start, x: pos[0], y: pos[1], color: houseColor(h, i), label: t('ui.loading.start', { n: h.start + 1, house: h.name }) }];
  });

  const houseLine = (h: LoadingHouse): string => {
    const pos = starts[h.start];
    const region = pos ? compassLabel(compassOf(pos[0], pos[1])) : '';
    const n = h.start + 1;
    if (h.controller === 'human') return t('ui.loading.house.human', { faction: t('ui.skirmish.faction.varkan'), n, region });
    if (h.ai?.aix) return t('ui.loading.house.aiAix', { level: aiLevelLabel(h.ai.difficulty), factor: fmtDec(h.ai.aixFactor, 1), n, region });
    return t('ui.loading.house.ai', { level: aiLevelLabel(h.ai?.difficulty ?? 'normal'), n, region });
  };

  const crumb = error !== null ? 'ui.loading.crumbError' : now === null ? 'ui.loading.crumbReady' : 'ui.loading.crumb';

  return (
    <div class="menu-page" data-component="LoadingScreen" data-testid="loading-screen" data-state={error !== null ? 'error' : now === null ? 'ready' : now.id}>
      <MenuBackground seed={41} view={[0.05, 0.25, 0.95, 0.75]} />
      <div class="load" role="region" aria-label={t('ui.loading.screen')}>
        <div class="load__center">
          <div>
            <div class="load__crumb">{t(crumb)}</div>
            <div class="logo load__title" role="heading" aria-level={1} data-testid="loading-map">
              {l.mapName.value}
            </div>
            <div class="ff-dim load__desc">{t('ui.loading.desc', { size: fmtInt(l.mapSizeWu.value), desc: dataText(l.mapDescription.value) })}</div>
            <div class="mapfacts load__facts">
              <span>
                <b>{victoryLabel(rules.victory)}</b>
              </span>
              <span>
                {t('ui.loading.facts.unitCap')} <b class="num">{fmtInt(rules.unitCap)}</b>
              </span>
              <span>
                {t('ui.loading.facts.seed')} <b class="num">{String(rules.seed)}</b>
              </span>
            </div>
            <div class="load__vs" data-testid="loading-houses">
              {houses.map((h, i) => {
                const badge = readinessBadge(h);
                return [
                  i > 0 ? (
                    <div key={`vs-${i}`} class="vs">
                      {t('ui.loading.vs')}
                    </div>
                  ) : null,
                  <div key={`h-${i}`} class="vsrow" style={{ '--team': houseColor(h, i) }} data-testid={`loading-house-${i}`}>
                    <i />
                    <div>
                      <b>{houseLabel(h.name)}</b>
                      <small>{houseLine(h)}</small>
                    </div>
                    <Badge tone={badge.tone} icon={badge.tone === 'ok' ? 'ok' : badge.tone === 'crit' ? 'crit' : undefined} testId={`loading-ready-${i}`}>
                      {t(badge.key)}
                    </Badge>
                  </div>,
                ];
              })}
            </div>
          </div>
          <MapPreview
            class="load__map"
            spec={l.preview.value}
            resources={[]}
            markers={markers}
            label={t('ui.loading.preview')}
            size={520}
            testId="loading-preview"
          />
        </div>
        <div class="load__bar">
          <div class="phases" role="group" aria-label={t('ui.loading.phases')}>
            {phases.map((p) => (
              <Phase key={p.id} p={p} />
            ))}
          </div>
          <div class="load__status">
            <span class="load__phase" aria-live="polite" data-testid="loading-now">
              {error !== null ? (
                <>
                  <Badge tone="crit" icon="crit" testId="loading-failed">
                    {t('ui.loading.failed')}
                  </Badge>
                  <span class="load__cause" data-testid="loading-cause">
                    {error}
                  </span>
                  <button ref={retry} type="button" class="ff-btn ff-btn--sm" onClick={() => cmd.retryLoading()} data-testid="loading-retry">
                    {t('ui.loading.retry')}
                  </button>
                  <Button variant="ghost" size="sm" onClick={() => cmd.backToMenu()} testId="loading-to-menu">
                    {t('ui.loading.toMenu')}
                  </Button>
                </>
              ) : (
                <>
                  {t(now === null ? 'ui.loading.now.ready' : PHASE_NOW[now.id])}{' '}
                  {file !== null ? (
                    <span class="ff-lo" data-testid="loading-file">
                      {t('ui.loading.file', { path: file.path, source: t(file.source === 'cache' ? 'ui.loading.source.cache' : 'ui.loading.source.network') })}
                    </span>
                  ) : null}
                </>
              )}
            </span>
            <span class="num" data-testid="loading-bytes">
              <b class="pct">{fmtPct(total)}</b>
              {' · '}
              {t('ui.loading.bytes', { loaded: fmtBytes(bytes.loaded), total: fmtBytes(bytes.total) })}
              {' · '}
              {t('ui.loading.counts', { cache: fmtInt(counts.cache), network: fmtInt(counts.network) })}
            </span>
          </div>
          <div
            class={cx('ff-bar bigbar ff-bar--build', error !== null && 'is-crit')}
            role="progressbar"
            aria-label={t('ui.loading.total')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(total * 100)}
            data-testid="loading-total"
          >
            <i style={{ '--v': String(total) }} />
          </div>
          <div class="tip">
            <b>{t('ui.loading.hint')}</b>
            <span data-testid="loading-hint">{loadingHint(l.hintIndex.value)}</span>
            <span class="ff-lo build">{t('ui.loading.build', { build: l.build.value })}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
