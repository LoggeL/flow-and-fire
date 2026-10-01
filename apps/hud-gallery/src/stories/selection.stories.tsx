import { SelectionPanel, FactoryQueue, OrderQueue, seedHud } from '@faf/hud';
import { defineStories } from '../story.ts';
import { REQUIRED_STATES } from '../required-states.ts';
export default defineStories(REQUIRED_STATES.filter(x => x.group === 'selection').flatMap(x => x.states.map((state, i) => ({ id: `${x.component.toLowerCase()}--${i}`, component: x.component, state, title: `${x.component}: ${state}`, layout: 'component' as const, viewport: { width: 1200, height: 640 }, tags: i === 0 ? ['xbrowser'] as const : [], setup: ({ model: m }) => { seedHud(m, state === 'mehrfach' || state === 'Kachel-Fokus' ? 'armee' : 'vogt'); if (state === 'leer') {
        if (x.component === 'SelectionPanel')
            m.selection.kind.value = 'none';
        if (x.component === 'OrderQueue' && m.selection.single.value)
            m.selection.single.value = { ...m.selection.single.value, orders: [] };
        if (x.component === 'FactoryQueue')
            m.factory.queue.value = { current: null, blocks: [], repeat: false, paused: false };
    } if (state === 'Fabrik')
        m.selection.kind.value = 'factory'; if (state === 'Kachel-Fokus')
        m.selection.focusTypeId.value = m.selection.multi.value?.groups[0]?.typeId ?? null; if (state === 'gehängt' && m.selection.single.value)
        m.selection.single.value = { ...m.selection.single.value, orders: Array.from({ length: 9 }, () => ({ kind: 'move', x: 100, z: 100 })) }; if (m.factory.queue.value)
        m.factory.queue.value = { ...m.factory.queue.value, repeat: state === 'Wiederholen an', paused: state === 'pausiert' }; if (state === 'Mehrfach-Fabrik' && m.factory.detail.value)
        m.factory.detail.value = { ...m.factory.detail.value, factoryCount: 3 }; }, render: () => x.component === 'SelectionPanel' ? <SelectionPanel /> : x.component === 'FactoryQueue' ? <FactoryQueue /> : <OrderQueue /> }))));
