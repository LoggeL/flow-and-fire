import { Hud, seedHud, computeUiScale } from '@faf/hud';
import { attachPerf } from '../app/perf.ts';
import { defineStories } from '../story.ts';
import { REQUIRED_STATES } from '../required-states.ts';
export default defineStories(REQUIRED_STATES.filter(x => x.group === 'hud').flatMap(x => x.states.map((state, i) => { const viewport = state === '720' ? { width: 1280, height: 720 } : state === '1440-kompakt' ? { width: 2560, height: 1440 } : state === '1440' ? { width: 2560, height: 1440 } : { width: 1920, height: 1080 }; return { id: `hud--${i}`, component: x.component, state, title: `HUD: ${state}`, layout: 'fullscreen' as const, viewport, scale: state==='1440-kompakt'?1:computeUiScale(viewport.width, viewport.height), tags: ['xbrowser', ...(state === 'dichtester Fall' ? ['perf'] : [])] as ('xbrowser' | 'perf')[], setup: ({ model: m }) => { seedHud(m, state.startsWith('1440') || state === '720' ? 'armee' : state); if (state === 'dichtester Fall')
        return attachPerf(m); return undefined; }, render: () => <Hud /> }; })));
