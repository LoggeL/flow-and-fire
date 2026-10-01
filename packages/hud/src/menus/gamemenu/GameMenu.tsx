import { useLayoutEffect, useRef } from 'preact/hooks';
import { useHud, useCommands } from '../../model/index.ts';
import { t } from '../../i18n/t.ts';
import { Button } from '../../ui/index.ts';
import '../shared/menus.css';
export function GameMenu() {
    const m = useHud(), c = useCommands(), ref = useRef<HTMLDivElement>(null), open = m.menus.gameMenu.open.value, confirm = m.menus.gameMenu.confirmSurrender.value;
    useLayoutEffect(() => { if (!open)
        return; const previous = document.activeElement as HTMLElement | null; ref.current?.querySelector<HTMLButtonElement>('button')?.focus(); return () => previous?.focus(); }, [open, confirm]);
    if (!open)
        return null;
    return <div class="menu-modal-backdrop"><div ref={ref} role="dialog" aria-modal="true" aria-label={t('ui.gamemenu.title')} class="ff-panel menu-modal" data-component="GameMenu" data-testid="game-menu" onKeyDown={(e) => { if (e.key === 'Escape') {
        e.preventDefault();
        if (confirm)
            m.menus.gameMenu.confirmSurrender.value = false;
        else
            c.resume();
    } if (e.key === 'Tab') {
        const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')], index = items.indexOf(document.activeElement as HTMLButtonElement);
        e.preventDefault();
        items[(index + (e.shiftKey ? items.length - 1 : 1)) % items.length]?.focus();
    } }}><h2>{t(confirm ? 'ui.gamemenu.confirm' : 'ui.gamemenu.title')}</h2>{confirm ? <><Button variant="danger" onClick={() => c.surrender()}>{t('ui.common.confirm')}</Button><Button onClick={() => { m.menus.gameMenu.confirmSurrender.value = false; }}>{t('ui.common.cancel')}</Button></> : <><Button variant="primary" onClick={() => c.resume()}>{t('ui.gamemenu.resume')}</Button><Button onClick={() => c.navigate('settings')}>{t('ui.gamemenu.settings')}</Button><Button onClick={() => { m.menus.settings.tab.value = 'keys'; c.navigate('settings'); }}>{t('ui.gamemenu.keys')}</Button><Button variant="danger" onClick={() => { m.menus.gameMenu.confirmSurrender.value = true; }}>{t('ui.gamemenu.surrender')}</Button><Button onClick={() => c.quitToMenu()}>{t('ui.gamemenu.quit')}</Button></>}</div></div>;
}
