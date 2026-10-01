import { Minimap, seedHud } from '@faf/hud';
import { defineStories } from '../story.ts';
import { REQUIRED_STATES } from '../required-states.ts';
export default defineStories(REQUIRED_STATES.filter(x => x.group === 'minimap').flatMap(x => x.states.map((state, i) => ({ id: `minimap--${i}`, component: x.component, state, title: `Minimap: ${state}`, layout: 'component' as const, tags: i === 0 ? ['xbrowser'] as const : [], setup: ({ model: m }) => { seedHud(m); m.minimap.mode.value = state === 'Taktisch' ? 'tactical' : 'terrain'; m.minimap.available.value = state !== 'Karten-Kennzahlen'; m.minimap.showResources.value = state !== 'Ressourcen aus'; if (state === 'Ping')
        m.minimap.pings.value = [{ x: 500, z: 500, bornS: 804, level: 'crit' }]; }, render: () => <div class="gal-minimap-sample"><Minimap /></div> }))));
