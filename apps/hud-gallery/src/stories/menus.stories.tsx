import { MainMenu, SkirmishSetup, LoadingScreen, Settings, ScoreScreen, GameMenu, seedMenus, changedSettings } from '@faf/hud';
import type { SettingsTab, ScoreTab } from '@faf/hud';
import { defineStories } from '../story.ts';
import { REQUIRED_STATES } from '../required-states.ts';
const components = { MainMenu, SkirmishSetup, LoadingScreen, Settings, ScoreScreen, GameMenu };
const tabs: Record<string, SettingsTab> = { 'Grafik': 'graphics', 'Audio': 'audio', 'Tasten': 'keys', 'Tasten EN': 'keys', 'Barrierefreiheit': 'access', 'Spiel & Sprache': 'game', 'Farbenblind-Vorschau': 'access', 'geändert': 'graphics' };
const scoreTabs: Record<string, ScoreTab> = { 'Übersicht': 'overview', 'Wirtschaft': 'economy', 'Armee': 'army', 'Einheiten': 'units' };
export default defineStories(REQUIRED_STATES.filter(x => x.group === 'menus').flatMap(x => x.states.map((state, i) => ({ id: `${x.component.toLowerCase()}--${i}`, component: x.component, state, title: `${x.component}: ${state}`, layout: 'fullscreen' as const, scale:state==='1440'?1.25:1, viewport: state === '1440' ? { width: 2560, height: 1440 } : { width: 1920, height: 1080 }, tags: i === 0 ? ['xbrowser'] as const : [], setup: ({ model: m }) => { seedMenus(m); if (x.component === 'MainMenu') {
        if (state === 'letzte Partie leer')
            m.menus.main.lastMatch.value = null;
        if (state === 'EN')
            m.locale.value = 'en';
    } if (x.component === 'SkirmishSetup') {
        if (state === 'KI Schwer + AIx')
            m.menus.skirmish.slots.value = m.menus.skirmish.slots.value.map(s => s.ai ? { ...s, ai: { difficulty: 'hard', aix: true, aixFactor: 1.5 } } : s);
        if (state === 'Validierungsfehler')
            m.menus.skirmish.slots.value = m.menus.skirmish.slots.value.map(s => ({ ...s, color: 'blue' }));
        if (state === 'Farbenblind') {
            m.teams.value = 'cvd';
            m.menus.skirmish.rules.value = { ...m.menus.skirmish.rules.value, teamColors: 'cvd' };
        }
    } if (x.component === 'Settings') {
        m.menus.settings.tab.value = tabs[state] ?? 'graphics';
        if (state === 'Tasten EN')
            m.locale.value = 'en';
        if (state === 'Farbenblind-Vorschau')
            m.menus.settings.values.value = { ...m.menus.settings.values.value, teamColors: 'cvd' };
        if (state === 'geändert') {
            m.menus.settings.values.value = { ...m.menus.settings.values.value, renderScale: .8, bloom: false };
            m.menus.settings.dirty.value = changedSettings(m.menus.settings.values.value);
        }
    } if (x.component === 'LoadingScreen') {
        if (state === 'KI-Worker')
            m.menus.loading.phases.value = m.menus.loading.phases.value.map((p, n) => ({ ...p, state: n === 4 ? 'active' : 'done', progress: n === 4 ? .5 : 1 }));
        if (state === 'Fehler') {
            m.menus.loading.error.value = 'Demo: Prüfsumme stimmt nicht';
            m.menus.loading.phases.value = m.menus.loading.phases.value.map((p, n) => n === 1 ? { ...p, state: 'error' } : p);
        }
    } if (x.component === 'GameMenu') {
        m.menus.gameMenu.open.value = true;
        m.menus.gameMenu.confirmSurrender.value = state === 'Aufgeben-Bestätigung';
    } if (x.component === 'ScoreScreen') {
        m.menus.score.tab.value = scoreTabs[state] ?? 'overview';
        if (state === 'Niederlage')
            m.menus.score.verdict.value = 'defeat';
        if (state === 'Minimalform') {
            m.menus.score.rows.value = [];
            m.menus.score.series.value = [];
        }
    } }, render: () => { const Component = components[x.component as keyof typeof components]; return <Component />; } }))));
