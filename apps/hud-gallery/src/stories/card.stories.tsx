import { CommandCard, CardCell, OrderBar, OrderButton, OrderTooltip, SelectionFilter, IdleButton, ControlGroups, seedHud, resolveCardSpec } from '@faf/hud';
import { defineStories } from '../story.ts';
import { REQUIRED_STATES } from '../required-states.ts';
export default defineStories(REQUIRED_STATES.filter(x => x.group === 'card').flatMap(x => x.states.map((state, i) => ({ id: `${x.component.toLowerCase()}--${i}`, component: x.component, state, title: `${x.component}: ${state}`, layout: 'component' as const, tags: i === 0 ? ['xbrowser'] as const : [], setup: ({ model: m }) => { seedHud(m); if (x.component === 'CommandCard' || x.component === 'OrderBar') {
        m.card.selectedTypes.value = state === 'Produktion' ? ['core:str_t1_fac_land'] : state === 'Gebäude' ? ['core:str_t1_mex'] : state === 'Befehle' || state === 'ausgeblendet' ? ['core:lnd_t1_tank'] : state === 'leer' ? [] : state.startsWith('Tab') ? ['core:lnd_t3_engineer'] : ['core:cmd_commander'];
        if (state.startsWith('Tab'))
            m.card.tab.value = Number(state.at(-1)) as 1 | 2 | 3;
    } if (state === 'Aktiv (Platzieren)') {
        m.card.placingTypeId.value = 'core:str_t1_mex';
        m.card.armedSlot.value = 'KeyQ';
    } if (state === 'Queue-Badge')
        m.card.queueCounts.value = { 'core:str_t1_mex': 5 }; if (state === 'Fortschritt')
        m.card.progress.value = { 'core:str_t1_mex': .5 }; if (state === 'Deaktiviert')
        m.card.capReached.value = true; if (x.component === 'OrderButton' || x.component === 'OrderTooltip')
        m.orders.states.value = { move: { enabled: state !== 'Deaktiviert' && state !== 'deaktiviert mit Grund', reason: 'noSelection', armed: state === 'Scharf', toggle: state === 'An' ? 'on' : state === 'Gemischt' ? 'mixed' : 'off', cycle: state === 'Zyklus' ? 2 : 0 } }; if (state === 'Countdown')
        m.orders.selfDestructCountdown.value = 3; if (state === 'Idle-Zähler 0')
        m.strip.idleEngineers.value = 0; if (state === 'leer' && x.component === 'ControlGroups')
        m.strip.groups.value = Array.from({ length: 10 }, () => ({ count: 0, iconTypeId: null })); if (state === 'aktiv')
        m.strip.activeGroup.value = 0; }, render: () => { const demoState = state === 'Hover' ? 'hover' : state === 'Fokus' ? 'focus' : state === 'Gedrückt' ? 'pressed' : undefined; if (x.component === 'CommandCard')
        return <CommandCard />; if (x.component === 'CardCell') {
        const cell = resolveCardSpec(['core:cmd_commander'], 1).cells.find(v => state === 'Leer' ? v.kind === 'empty' : v.typeId === 'core:str_t1_mex')!;
        return <CardCell cell={state === 'Gesperrt' ? { ...cell, locked: { reason: 'needBuilderTech', tier: 3 } } : cell} {...(demoState ? { demoState } : {})} danger={state === 'Gefahr'}/>;
    } if (x.component === 'OrderBar')
        return <OrderBar />; if (x.component === 'OrderButton')
        return <OrderButton id={state === 'Gefahr' || state === 'Countdown' ? 'selfDestruct' : 'move'} {...(demoState ? { demoState } : {})}/>; if (x.component === 'OrderTooltip')
        return <OrderTooltip orderId="move"/>; if (x.component === 'SelectionFilter')
        return <SelectionFilter />; if (x.component === 'IdleButton')
        return <IdleButton />; return <ControlGroups />; } }))));
