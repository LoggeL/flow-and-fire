import type { JSX } from 'preact';
import { computed } from '@preact/signals';
import { useMemo } from 'preact/hooks';
import { useHud, useCommands } from '../../model/index.ts';
import { ORDER_DEFS, orderDef, orderAtSlot, orderState, orderIcon } from '../../model/orders.ts';
import type { OrderId } from '../../model/orders.ts';
import type { CardCellSpec } from '../../data/card-logic.ts';
import { StrategicIcon } from '../../data/StrategicIcon.tsx';
import { unitText } from '../../data/roster.ts';
import { clickModsFromEvent } from '../../commands/mods.ts';
import { Panel, PanelHead, LineIcon, TooltipFrame, Bar, Num, demoClass } from '../../ui/index.ts';
import type { DemoState } from '../../ui/Button.tsx';
import { keyLabel } from '../../ui/keys.ts';
import { TECH_TIERS } from '../../model/card.ts';
import { t, tn } from '../../i18n/t.ts';
import { cardSpec, isTabLocked, orderBarVisible } from './spec.ts';
import '../../styles/hud.css';
import './card.css';
export function CardCell({ cell, demoState, danger = false, builderPower, buildCost, glyph, name }: {
    readonly cell: CardCellSpec;
    /** Optional class silhouette replacing the strategic icon (the live game build card). */
    readonly glyph?: JSX.Element | undefined;
    /** Optional short name for compiled units outside the design roster. */
    readonly name?: string | undefined;
    readonly demoState?: DemoState;
    readonly danger?: boolean;
    readonly builderPower?: number | undefined;
    readonly buildCost?: { readonly mass: number; readonly energy: number; readonly buildTime: number } | undefined;
}) {
    const m = useHud(), c = useCommands(), disabled = m.card.capReached.value && cell.kind === 'unit', empty = cell.kind === 'empty';
    const label = cell.typeId ? cell.kind === 'unit' ? name ?? unitText(cell.typeId, 'short', m.locale.value) : t(`ui.card.cell.${cell.kind === 'empty' ? 'pause' : cell.kind}`) : '';
    const progress = useMemo(() => computed(() => m.card.progress.value[cell.typeId ?? ''] ?? 0), [m, cell.typeId]);
    const count = m.card.queueCounts.value[cell.typeId ?? ''] ?? 0;
    const hint = (keyboard: boolean) => { if (!cell.typeId)
        return; m.tooltip.target.value = { kind: 'unit', typeId: cell.typeId, slot: cell.slot, builderBp: builderPower && builderPower > 0 ? builderPower : undefined, buildCost, locked: cell.locked, disabledReason: disabled ? t('ui.card.disabled.cap') : undefined }; m.tooltip.anchor.value = { kind: 'card' }; m.tooltip.viaKeyboard.value = keyboard; };
    return <button type="button" role="gridcell" class={`ff-cell ${empty ? 'is-empty' : ''} ${cell.locked ? 'is-locked' : ''} ${disabled ? 'is-disabled' : ''} ${m.card.armedSlot.value === cell.slot ? 'is-active' : ''} ${m.card.flashSlot.value === cell.slot ? 'is-pressed' : ''} ${danger ? 'is-danger' : ''} ${demoClass(demoState) ?? ''}`} data-component="CardCell" data-testid={`card-${cell.slot}`} aria-disabled={!!cell.locked || disabled || empty} aria-label={t('ui.card.cell.label', { name: label, key: keyLabel(cell.slot, m.keyboardLayout.value) })} onClick={(e) => { if (!cell.locked && !disabled && !empty)
        c.cardActivate(cell.slot, clickModsFromEvent(e)); }} onContextMenu={(e) => { e.preventDefault(); if (!cell.locked && !empty)
        c.cardActivate(cell.slot, clickModsFromEvent(e)); }} onMouseEnter={() => hint(false)} onFocus={() => hint(true)} onBlur={() => { m.tooltip.target.value = null; }} onMouseLeave={() => { m.tooltip.target.value = null; }}><span class="ff-cell__key">{keyLabel(cell.slot, m.keyboardLayout.value)}</span>{cell.typeId && (glyph ?? <StrategicIcon typeId={cell.typeId} class="ff-cell__icon"/>)}<span class="ff-cell__name" data-fit="">{label}</span>{cell.locked && <span class="ff-cell__lock">⌑</span>}{count > 0 ? <span class="ff-cell__badge">{count > 99 ? '99+' : count}</span> : <span class="ff-cell__tiers">{[1, 2, 3].map((tier) => <i key={tier} class={cell.roleTiers.includes(tier) ? cell.shownTier === tier ? 'is-current' : '' : 'is-missing'}/>)}</span>}<Bar kind="build" value={progress} class="ff-cell__progress"/></button>;
}
export function OrderButton({ id, compact = false, demoState, glyph }: {
    readonly id: OrderId;
    readonly compact?: boolean;
    readonly demoState?: DemoState;
    /** Decorative live-game art; labels, state and interaction stay on the button. */
    readonly glyph?: JSX.Element | undefined;
}) {
    const m = useHud(), c = useCommands(), state = orderState(m.orders.states.value, id), def = orderDef(id), countdown = id === 'selfDestruct' ? m.orders.selfDestructCountdown.value : null;
    const key = def.key ? keyLabel(def.key, m.keyboardLayout.value) : t('ui.orders.key.selfDestruct');
    const hint = (keyboard: boolean) => { m.tooltip.target.value = { kind: 'order', orderId: id }; m.tooltip.anchor.value = { kind: 'card' }; m.tooltip.viaKeyboard.value = keyboard; };
    return <button class={`${compact ? 'ff-order' : 'ff-cell'} ${state.armed ? 'is-armed' : ''} ${state.toggle === 'on' ? 'is-on' : ''} ${state.toggle === 'mixed' ? 'is-mixed' : ''} ${!state.enabled ? 'is-disabled' : ''} ${id === 'selfDestruct' ? 'is-danger' : ''} ${countdown !== null ? 'is-countdown' : ''} ${demoClass(demoState) ?? ''}`} data-component="OrderButton" data-testid={`order-${id}`} aria-label={t('ui.orders.label', { name: t(`ui.orders.${id}.name`), keys: key })} aria-disabled={!state.enabled} aria-pressed={!!state.armed || state.toggle === 'on'} onClick={(e) => { if (state.enabled)
        c.activateOrder(id, clickModsFromEvent(e)); }} onMouseEnter={() => hint(false)} onFocus={() => hint(true)} onBlur={() => { m.tooltip.target.value = null; }} onMouseLeave={() => { m.tooltip.target.value = null; }}><span class={compact ? 'ff-order__key' : 'ff-cell__key'}>{id === 'selfDestruct' ? '⌫' : compact ? `⌥${key}` : key}</span>{glyph ?? <LineIcon name={orderIcon(id, state)}/>}{!compact && <span class="ff-cell__name" data-fit="">{t(`ui.orders.${id}.short`)}</span>}{state.cycle !== undefined && <span class="ff-order__state">{'●'.repeat((state.cycle % 3) + 1)}</span>}{state.toggle === 'mixed' && <span class="ff-order__state">◇</span>}{countdown !== null && <span class="ff-cell__badge">{countdown}</span>}{state.badge !== undefined && <Num value={state.badge}/>}</button>;
}
export function OrderBar() { const m = useHud(); return orderBarVisible(m.card.page.value) ? <div class="orders" data-panel="orders" data-component="OrderBar" data-testid="order-bar">{ORDER_DEFS.map((d) => <OrderButton key={d.id} id={d.id} compact/>)}</div> : null; }
export function OrderTooltip({ orderId }: {
    readonly orderId: OrderId;
}) {
    const m = useHud(), def = orderDef(orderId), state = orderState(m.orders.states.value, orderId);
    return <TooltipFrame name={t(`ui.orders.${orderId}.name`)} icon={<LineIcon name={orderIcon(orderId, state)}/>} keyHint={def.key ? keyLabel(def.key, m.keyboardLayout.value) : t('ui.orders.key.selfDestruct')} body={<div><p>{t(`ui.orders.${orderId}.desc`)}</p><p>{t(`ui.orders.behavior.${def.behavior}`)}</p>{!state.enabled && <p>{t('ui.orders.unavailable', { reason: t(`ui.orders.reason.${state.reason ?? 'noSelection'}`) })}</p>}</div>} testId="order-tooltip"/>;
}
export function CommandCard() {
    const m = useHud(), c = useCommands(), spec = cardSpec(m.card).value;
    const title = spec.page === 'orders' ? tn('ui.card.head.orders', m.card.unitCount.value) : spec.page === 'empty' ? t('ui.card.head.empty') : t(`ui.card.head.${spec.page}`, { name: spec.headTypeId ? unitText(spec.headTypeId, 'name', m.locale.value) : '' });
    return <Panel component="CommandCard" testId="command-card" panelId="card" class="card"><PanelHead title={title} end={spec.maxTab > 0 && <span class="ff-tabs" role="tablist" aria-label={t('ui.card.tabs')}>{TECH_TIERS.map((tier) => <button role="tab" class={`ff-tab ${tier === spec.tab ? 'is-active' : ''}`} key={tier} aria-selected={tier === spec.tab} disabled={isTabLocked(spec, tier)} onClick={() => c.setTab(tier)}>{`T${tier}`}</button>)}</span>}/><div role="grid" class="card__grid" aria-label={t(`ui.card.grid.${spec.page}`)} onKeyDown={(e) => { const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -5, ArrowDown: 5 }[e.key]; if (delta === undefined)
        return; const cells = [...e.currentTarget.querySelectorAll<HTMLButtonElement>(':scope > button')]; const idx = cells.indexOf(e.target as HTMLButtonElement); if (idx < 0)
        return; e.preventDefault(); cells[(idx + delta + cells.length) % cells.length]?.focus(); }}>{spec.cells.map((cell) => { const order = spec.page === 'orders' ? orderAtSlot(cell.slot) : null; return order ? <OrderButton key={cell.slot} id={order.id}/> : <CardCell key={cell.slot} cell={cell}/>; })}</div></Panel>;
}
