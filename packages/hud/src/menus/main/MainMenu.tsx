import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { useHud, useCommands } from '../../model/index.ts';
import { t } from '../../i18n/t.ts';
import { fmtTime } from '../../format/index.ts';
import { Panel, PanelHead, Button } from '../../ui/index.ts';
import { MenuShell } from '../shared/Shell.tsx';
export function MainMenu({ logo }: { readonly logo?: ComponentChildren } = {}) {
    const m = useHud(), c = useCommands(), ref = useRef<HTMLElement>(null), last = m.menus.main.lastMatch.value, wordmark = t('ui.menu.title').split('&');
    useLayoutEffect(() => { ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(); }, []);
    const meta = [t('ui.menu.build', { build: m.menus.main.build.value }), m.menus.main.simId.value && t('ui.menu.sim', { sim: m.menus.main.simId.value }), m.menus.main.preset.value && t('ui.menu.preset', { preset: m.menus.main.preset.value })].filter(Boolean).join(' · ');
    return <MenuShell title={t('ui.menu.title')} component="MainMenu" back={false} language={false} footer={<span data-testid="menu-build-meta">{meta}</span>}>
        <main class="main">
            <div class="main__command">
                <div class="logo" aria-hidden="true">{logo ?? <>{wordmark[0]}<span class="amp">{'&'}</span><br/><span class="fire">{wordmark[1]}</span></>}</div>
                <div class="tagline">{t('ui.menu.tagline')}</div>
                <nav class="mainnav" aria-label={t('ui.menu.title')} ref={ref} onKeyDown={(e) => {
                    if (!['ArrowUp', 'ArrowDown'].includes(e.key)) return;
                    e.preventDefault();
                    const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')], index = buttons.indexOf(document.activeElement as HTMLButtonElement);
                    buttons[(index + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
                }}>
                    {(['skirmish', 'replays', 'settings', 'tutorial', 'credits'] as const).map((screen) => <button type="button" class={`navbtn ${screen === 'skirmish' ? 'is-primary' : ''}`} data-menu-action={screen} disabled={screen === 'replays' && !m.menus.main.replaysAvailable.value} onClick={() => c.navigate(screen)} key={screen}>
                        <span aria-hidden="true">›</span><span>{t(`ui.menu.${screen}`)}</span>{screen === 'replays' && !m.menus.main.replaysAvailable.value && <small>{t('ui.menu.locked')}</small>}
                    </button>)}
                </nav>
            </div>
            {last && <aside class="side" data-testid="menu-last-match"><Panel class="card-m"><PanelHead title={t('ui.menu.last')}/><div class="card-m__body"><b>{last.mapName}</b><span>{t(`ui.score.${last.verdict}`)} · {fmtTime(last.durationS)} · {last.opponent}</span><div><Button disabled={!last.hasReplay} onClick={() => c.watchReplay()}>{t('ui.menu.replay')}</Button><Button onClick={() => c.rematch()}>{t('ui.menu.rematch')}</Button></div></div></Panel></aside>}
        </main>
    </MenuShell>;
}
