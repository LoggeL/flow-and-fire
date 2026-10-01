import { useState, useLayoutEffect, useRef, useEffect } from 'preact/hooks';
import { effect } from '@preact/signals';
import { useHud, useCommands } from '../../model/index.ts';
import type { TooltipTarget } from '../../model/tooltip.ts';
import { ResourceBar, MatchStatus, PauseBanner, AlertFeed, UnitTooltip, ResourceTooltip } from '../top/index.ts';
import { SelectionPanel } from '../selection/index.ts';
import { CommandCard, OrderBar, OrderTooltip, useCardHotkeys } from '../card/index.ts';
import { SelectionFilter, ControlGroups } from '../strip/index.ts';
import { Minimap } from '../minimap/index.ts';
import { IconSprite } from '../../data/StrategicIcon.tsx';
import { GameMenu } from '../../menus/gamemenu/index.ts';
import './root.css';
export function computeUiScale(width: number, height: number): number {
    if (width < 1280 || height < 720)
        return .8;
    return Math.min(1.5, Math.max(.8, Math.round(Math.pow(height / 1080, .78) * 20) / 20));
}
export function TooltipLayer() {
    const m = useHud(), [shown, setShown] = useState<TooltipTarget | null>(null), ref = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => effect(() => {
        const target = m.tooltip.target.value, instant = m.tooltip.viaKeyboard.value;
        setShown(null);
        if (!target)
            return;
        if (instant) {
            setShown(target);
            return;
        }
        const timer = setTimeout(() => setShown(target), 350);
        return () => clearTimeout(timer);
    }), [m]);
    useLayoutEffect(() => {
        if (!shown || !ref.current)
            return;
        const box = ref.current, anchor = m.tooltip.anchor.peek();
        if (anchor.kind === 'card') {
            box.style.right = 'var(--hud-gutter)';
            box.style.bottom = 'calc(var(--hud-dock-h) + 3.5rem)';
            box.style.left = '';
            box.style.top = '';
        }
        else {
            const rect = box.getBoundingClientRect();
            box.style.left = `${Math.max(8, Math.min(anchor.x, window.innerWidth - rect.width - 8))}px`;
            box.style.top = `${Math.max(8, Math.min(anchor.y + (anchor.kind === 'rect' ? anchor.h : 0), window.innerHeight - rect.height - 8))}px`;
            box.style.right = '';
            box.style.bottom = '';
        }
    }, [shown, m]);
    return <div ref={ref} class="tipbox" data-component="TooltipLayer" data-testid="tooltip-layer">{shown?.kind === 'unit' ? <UnitTooltip {...shown}/> : shown?.kind === 'resource' ? <ResourceTooltip resource={shown.resource}/> : shown?.kind === 'order' ? <OrderTooltip orderId={shown.orderId}/> : null}</div>;
}
export function Hud({ hotkeys = true }: {
    readonly hotkeys?: boolean;
}) {
    return <div class="hud" data-component="Hud" data-testid="hud" data-hud-root=""><IconSprite />{hotkeys && <Hotkeys />}<div class="hud-layer"><ResourceBar /><MatchStatus /><PauseBanner /><AlertFeed /><div class="strip"><SelectionFilter /><ControlGroups /><OrderBar /></div><div class="dock"><Minimap /><SelectionPanel /><CommandCard /></div><TooltipLayer /><GameMenu /></div></div>;
}
function Hotkeys() { useCardHotkeys(); const m = useHud(), c = useCommands(); useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.defaultPrevented || e.repeat || e.key !== 'Escape' || m.menus.gameMenu.open.peek())
    return; const target = e.target as HTMLElement | null; if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable))
    return; e.preventDefault(); c.openGameMenu(); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [m, c]); return null; }
