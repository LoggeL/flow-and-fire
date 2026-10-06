/**
 * Main menu (ui.md §5.15, A3; markup after docs/design/ui-mockups/menu.html): word mark, tagline, vertical
 * navigation (Gefecht · Replays [MS11] · Einstellungen · Einweisung [locked] · Mitwirkende), emblem,
 * "Letzte Partie" card with replay/rematch, footer with build/simId/transport/preset, DE/EN top right.
 * Keyboard: ↑/↓ move between enabled entries (roving tabindex), Enter opens, focus starts on "Gefecht".
 */
import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { fmtBytes, fmtTime } from '../../format/index.ts';
import { t, tn } from '../../i18n/t.ts';
import type { MsgKey } from '../../i18n/tables.ts';
import { useCommands, useHud } from '../../model/index.ts';
import { agoParts, mainNavItems, nextEnabled } from '../../model/menus/main.ts';
import type { LastMatch, MainNavId } from '../../model/menus/main.ts';
import { Button } from '../../ui/Button.tsx';
import { cx } from '../../ui/cx.ts';
import { LineIcon } from '../../ui/LineIcon.tsx';
import type { LineIconName } from '../../ui/icons.ts';
import { Panel, PanelHead } from '../../ui/Panel.tsx';
import { Segmented } from '../../ui/Segmented.tsx';
import { Emblem } from '../shared/Emblem.tsx';
import { useInitialFocus } from '../shared/focus.ts';
import { aiLevelLabel, presetLabel } from '../shared/labels.ts';
import { MenuBackground } from '../shared/MapCanvas.tsx';

interface NavText {
  readonly icon: LineIconName;
  readonly label: MsgKey;
  readonly sub?: MsgKey;
  readonly tag?: MsgKey;
  readonly locked?: MsgKey;
}

const NAV_TEXT: Readonly<Record<MainNavId, NavText>> = {
  skirmish: { icon: 'play', label: 'ui.menu.item.skirmish', sub: 'ui.menu.item.skirmish.sub' },
  replays: { icon: 'replay', label: 'ui.menu.item.replays', tag: 'ui.menu.item.replays.tag', locked: 'ui.menu.item.replays.locked' },
  settings: { icon: 'sliders', label: 'ui.menu.item.settings' },
  tutorial: { icon: 'book', label: 'ui.menu.item.tutorial', tag: 'ui.menu.item.tutorial.tag', locked: 'ui.menu.item.tutorial.locked' },
  credits: { icon: 'user', label: 'ui.menu.item.credits' },
};

/** "vor 2 Std." / "2 h ago". */
export function agoText(seconds: number): string {
  const { unit, n } = agoParts(seconds);
  return tn(unit === 'minutes' ? 'ui.menu.ago.minutes' : unit === 'hours' ? 'ui.menu.ago.hours' : 'ui.menu.ago.days', n);
}

function LastMatchCard({ match }: { readonly match: LastMatch | null }): JSX.Element {
  const cmd = useCommands();
  return (
    <Panel class="card-m" component="LastMatch" testId="last-match" label={t('ui.menu.last.title')} panelId="last-match">
      <PanelHead title={t('ui.menu.last.title')} end={match ? agoText(match.agoS) : undefined} />
      <div class="card-m__body">
        {match ? (
          <>
            <div data-testid="last-match-summary">
              <b>{t(match.verdict === 'victory' ? 'ui.menu.last.victory' : 'ui.menu.last.defeat')}</b>{' '}
              {match.opponentAi !== null
                ? t('ui.menu.last.againstAi', { house: match.opponent, level: aiLevelLabel(match.opponentAi), map: match.mapName, time: fmtTime(match.durationS) })
                : t('ui.menu.last.againstHuman', { house: match.opponent, map: match.mapName, time: fmtTime(match.durationS) })}
            </div>
            <div class="ff-dim">
              {match.replayBytes !== null ? t('ui.menu.last.replay', { size: fmtBytes(match.replayBytes) }) : t('ui.menu.last.noReplay')}
            </div>
            <div class="card-m__actions">
              <Button size="sm" icon="replay" disabled={match.replayBytes === null} onClick={() => cmd.watchReplay()} testId="last-match-watch">
                {t('ui.menu.last.watch')}
              </Button>
              <Button size="sm" icon="flag" onClick={() => cmd.rematch()} testId="last-match-rematch">
                {t('ui.menu.last.rematch')}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div data-testid="last-match-empty">
              <b>{t('ui.menu.last.empty')}</b>
            </div>
            <div class="ff-dim">{t('ui.menu.last.emptyHint')}</div>
          </>
        )}
      </div>
    </Panel>
  );
}

export function MainMenu(): JSX.Element {
  const model = useHud();
  const cmd = useCommands();
  const main = model.menus.main;
  const items = mainNavItems(main.replaysAvailable.value);
  const locked = items.map((i) => i.locked);
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const first = useRef<HTMLButtonElement>(null);
  useInitialFocus(first);

  const move = (to: number): void => {
    if (to < 0) return;
    setActive(to);
    refs.current[to]?.focus();
  };

  const onNavKey = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      move(nextEnabled(locked, active, e.key === 'ArrowDown' ? 1 : -1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      move(nextEnabled(locked, -1, 1));
    } else if (e.key === 'End') {
      e.preventDefault();
      move(nextEnabled(locked, 0, -1));
    }
  };

  const lang = model.locale.value === 'en' ? 'en' : 'de';
  const preset = presetLabel(main.preset.value);

  return (
    <div class="menu-page" data-component="MainMenu" data-testid="main-menu">
      <MenuBackground seed={23} />
      <Emblem />
      <div class="menu-root">
        <div class="menu-top">
          <span class="crumb">{t('ui.menu.crumb')}</span>
          <div class="sp">
            <Segmented
              label={t('ui.menu.language')}
              value={lang}
              options={[
                { value: 'de', label: t('ui.menu.lang.de') },
                { value: 'en', label: t('ui.menu.lang.en') },
              ]}
              onChange={(l) => cmd.setLocale(l)}
              testId="menu-language"
            />
            <Button variant="ghost" size="icon" icon="fullscreen" label={t('ui.menu.fullscreen')} onClick={() => cmd.toggleFullscreen()} testId="menu-fullscreen" />
          </div>
        </div>
        <div class="main">
          <div>
            <div class="logo" role="heading" aria-level={1} aria-label={t('ui.menu.wordmark.label')} data-testid="wordmark">
              <span aria-hidden="true">
                {t('ui.menu.wordmark.flow')}
                <span class="amp">{t('ui.menu.wordmark.amp')}</span>
                <br />
                <span class="fire">{t('ui.menu.wordmark.fire')}</span>
              </span>
            </div>
            <div class="tagline">{t('ui.menu.tagline')}</div>
            <nav class="mainnav" aria-label={t('ui.menu.nav')} onKeyDown={onNavKey} data-testid="main-nav">
              {items.map((item, i) => {
                const txt = NAV_TEXT[item.id];
                const reason = item.locked && txt.locked ? t(txt.locked) : undefined;
                return (
                  <button
                    key={item.id}
                    ref={(el) => {
                      refs.current[i] = el;
                      if (i === 0) first.current = el;
                    }}
                    type="button"
                    class={cx('navbtn', item.id === 'skirmish' && 'is-primary', i === active && 'is-hover', item.locked && 'is-disabled')}
                    tabIndex={i === active ? 0 : -1}
                    aria-disabled={item.locked || undefined}
                    aria-describedby={reason ? `ffm-nav-${item.id}-why` : undefined}
                    title={reason}
                    onFocus={() => setActive(i)}
                    onMouseEnter={() => !item.locked && setActive(i)}
                    onClick={() => {
                      if (!item.locked) cmd.navigate(item.screen);
                    }}
                    data-testid={`nav-${item.id}`}
                    data-locked={item.locked ? '' : undefined}
                  >
                    <LineIcon name={txt.icon} />
                    <span data-fit="">{t(txt.label)}</span>
                    {txt.tag && item.locked ? <span class="tag">{t(txt.tag)}</span> : null}
                    {txt.sub ? <small>{t(txt.sub)}</small> : null}
                    {reason ? (
                      <span id={`ffm-nav-${item.id}-why`} class="ff-sr">
                        {t('ui.menu.locked', { reason })}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </nav>
          </div>
          <div />
        </div>
        <div class="menu-foot">
          <span data-testid="menu-build">{t('ui.menu.foot.build', { build: main.build.value, simId: main.simId.value })}</span>
          <span aria-hidden="true">·</span>
          <span data-testid="menu-tech">
            {t('ui.menu.foot.tech', { renderer: main.renderer.value, transport: main.transport.value, preset })}
          </span>
          <div class="sp">
            <LastMatchCard match={main.lastMatch.value} />
          </div>
        </div>
      </div>
    </div>
  );
}

