import { useEffect } from 'preact/hooks';
import { useHud, useCommands } from '../../model/index.ts';
import { orderForKey, orderState, armedOrder } from '../../model/orders.ts';
import type { OrderId } from '../../model/orders.ts';
import type { CardPage } from '../../model/card.ts';
import type { CardCellSpec } from '../../data/card-logic.ts';
import { SLOT_CODES } from '../../ui/keys.ts';
import type { SlotCode } from '../../ui/keys.ts';
import { clickModsFromEvent } from '../../commands/mods.ts';
import { cardSpec } from './spec.ts';
export interface GridKey {
    readonly code: string;
    readonly alt: boolean;
    readonly shift: boolean;
    readonly ctrl: boolean;
    readonly meta: boolean;
}
export interface GridContext {
    readonly page: CardPage;
    readonly cells: readonly CardCellSpec[];
    readonly scheme: 'grid' | 'wasd';
    readonly mode: 'idle' | 'placement' | 'orderArmed';
    readonly textFocus: boolean;
    readonly modal: boolean;
}
export type GridAction = {
    readonly kind: 'card';
    readonly slot: SlotCode;
} | {
    readonly kind: 'order';
    readonly id: OrderId;
} | {
    readonly kind: 'selfDestruct' | 'cancel' | 'camera' | 'passthrough';
};
export function resolveGridKey(e: GridKey, ctx: GridContext): GridAction {
    if (ctx.textFocus || ctx.modal)
        return { kind: 'passthrough' };
    if (e.code === 'Escape' && ctx.mode !== 'idle')
        return { kind: 'cancel' };
    if (e.ctrl && (e.code === 'Delete' || e.code === 'Backspace'))
        return { kind: 'selfDestruct' };
    if (e.ctrl || e.meta)
        return { kind: 'passthrough' };
    const isGrid = (SLOT_CODES as readonly string[]).includes(e.code);
    if (!isGrid)
        return { kind: 'passthrough' };
    const slot = e.code as SlotCode;
    if (e.alt) {
        const order = orderForKey(slot);
        return order ? { kind: 'order', id: order.id } : { kind: 'passthrough' };
    }
    if (ctx.mode !== 'idle')
        return { kind: 'passthrough' };
    if (ctx.scheme === 'wasd' && ['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code))
        return { kind: 'camera' };
    if (ctx.page === 'orders') {
        const order = orderForKey(slot);
        return order ? { kind: 'order', id: order.id } : { kind: 'passthrough' };
    }
    const cell = ctx.cells.find((x) => x.slot === slot);
    return cell && cell.kind !== 'empty' && !cell.locked ? { kind: 'card', slot } : { kind: 'passthrough' };
}
export function shouldPreventDefault(e: GridKey, type: 'keydown' | 'keyup' = 'keydown'): boolean {
    return type === 'keyup' && (e.code === 'AltLeft' || e.code === 'AltRight') || e.alt && (SLOT_CODES as readonly string[]).includes(e.code);
}
export function useCardHotkeys(target?: EventTarget) {
    const model = useHud(), commands = useCommands();
    useEffect(() => {
        const el = target ?? window;
        const handler = (ev: Event) => {
            const e = ev as KeyboardEvent, focus = e.target as HTMLElement | null;
            const key = { code: e.code, alt: e.altKey, shift: e.shiftKey, ctrl: e.ctrlKey, meta: e.metaKey };
            const spec = cardSpec(model.card).peek();
            const action = resolveGridKey(key, { page: spec.page, cells: spec.cells, scheme: model.menus.settings.values.peek().keyScheme, mode: model.card.armedSlot.peek() ? 'placement' : armedOrder(model.orders.states.peek()) ? 'orderArmed' : 'idle', textFocus: !!focus && (['INPUT', 'TEXTAREA', 'SELECT'].includes(focus.tagName) || focus.isContentEditable), modal: model.menus.gameMenu.open.peek() });
            if ((!focus || !(['INPUT', 'TEXTAREA', 'SELECT'].includes(focus.tagName) || focus.isContentEditable)) && !model.menus.gameMenu.open.peek() && (shouldPreventDefault(key) || !['passthrough', 'camera'].includes(action.kind)))
                e.preventDefault();
            if (e.repeat)
                return;
            const mods = clickModsFromEvent({ ...e, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, button: 0 });
            if (action.kind === 'card' && !model.card.capReached.peek())
                commands.cardActivate(action.slot, mods);
            if (action.kind === 'order' && orderState(model.orders.states.peek(), action.id).enabled)
                commands.activateOrder(action.id, mods);
            if (action.kind === 'selfDestruct' && orderState(model.orders.states.peek(), 'selfDestruct').enabled)
                commands.activateOrder('selfDestruct', mods);
            if (action.kind === 'cancel')
                commands.cancelMode();
        };
        const up = (ev: Event) => { const e = ev as KeyboardEvent; if (shouldPreventDefault({ code: e.code, alt: e.altKey, shift: e.shiftKey, ctrl: e.ctrlKey, meta: e.metaKey }, 'keyup'))
            e.preventDefault(); };
        el.addEventListener('keydown', handler);
        el.addEventListener('keyup', up);
        return () => { el.removeEventListener('keydown', handler); el.removeEventListener('keyup', up); };
    }, [target, model, commands]);
}
