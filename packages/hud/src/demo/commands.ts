import { batch } from '@preact/signals';
import type { HudModel } from '../model/index.ts';
import type { HudCommands } from '../commands/index.ts';
import { setLocale } from '../i18n/locale.ts';
import { DEFAULT_SETTINGS, applySettingsPreset, changedSettings, validateSettings } from '../model/menus/settings.ts';
import { validateSkirmish } from '../model/menus/skirmish.ts';
/** Presentation-only demo adapter. Recording commands still record before these model writes. */
export function demoCommandHandlers(m: HudModel): Partial<HudCommands> {
    return {
        setLocale(value) { setLocale(value); },
        updateSkirmish(patch) { batch(() => { const s = m.menus.skirmish; if (patch.mapId !== undefined)
            s.selectedMap.value = patch.mapId; if (patch.rules)
            s.rules.value = patch.rules; if (patch.slots)
            s.slots.value = patch.slots; const error = validateSkirmish({ mapId: s.selectedMap.value, slots: s.slots.value, rules: s.rules.value }, s.maps.value); s.validation.value = { ...s.validation.value, state: error ? 'error' : 'ok', message: error }; m.teams.value = s.rules.value.teamColors; }); },
        setSetting(key, value) { let values = { ...m.menus.settings.values.value, [key]: value }; if (key === 'preset')
            values = applySettingsPreset(values, values.preset); if (validateSettings(values).length)
            return; batch(() => { m.menus.settings.values.value = values; m.menus.settings.dirty.value = changedSettings(values); if (key === 'locale')
            setLocale(values.locale); if (key === 'teamColors')
            m.teams.value = values.teamColors; if (key === 'uiScale' && typeof values.uiScale === 'number')
            m.scale.value = values.uiScale; if (key === 'reducedMotion')
            m.reducedMotion.value = values.reducedMotion; }); },
        resetSettings() { m.menus.settings.values.value = { ...DEFAULT_SETTINGS }; m.menus.settings.dirty.value = []; },
        requestAutodetect() { m.menus.settings.detectState.value = 'done'; },
        toggleFlowDetails() { m.eco.detailsOpen.value = !m.eco.detailsOpen.peek(); },
        pauseConsumer(id, paused) { m.eco.consumers.value = m.eco.consumers.peek().map(v => v.id === id ? { ...v, paused } : v); },
        changeSpeed(delta) { m.match.speed.value = Math.min(3, Math.max(.25, m.match.speed.peek() + delta * .25)); },
        togglePause() { m.match.pause.value = m.match.pause.peek() === 'none' ? 'user' : 'none'; },
        openGameMenu() { m.menus.gameMenu.open.value = true; }, resume() { m.menus.gameMenu.open.value = false; },
        setTab(tier) { m.card.tab.value = tier; }, cancelMode() { m.card.armedSlot.value = null; m.card.placingTypeId.value = null; },
        cardActivate(slot) { m.card.armedSlot.value = slot; },
        focusType(typeId) { m.selection.focusTypeId.value = typeId; },
        toggleRepeat() { const q = m.factory.queue.peek(); if (q)
            m.factory.queue.value = { ...q, repeat: !q.repeat }; },
        togglePauseProduction() { const q = m.factory.queue.peek(); if (q)
            m.factory.queue.value = { ...q, paused: !q.paused }; },
        clearQueue() { const q = m.factory.queue.peek(); if (q)
            m.factory.queue.value = { ...q, current: null, blocks: [] }; },
        queueAdd(typeId, count, toFront) { const q = m.factory.queue.peek(); if (q)
            m.factory.queue.value = { ...q, blocks: toFront ? [{ typeId, count }, ...q.blocks] : [...q.blocks, { typeId, count }] }; },
        queueRemove(typeId, count) { const q = m.factory.queue.peek(); if (q)
            m.factory.queue.value = { ...q, blocks: q.blocks.map(b => b.typeId === typeId ? { ...b, count: Math.max(0, b.count - count) } : b).filter(b => b.count > 0) }; },
        recallGroup(index) { m.strip.activeGroup.value = index; },
        setMinimapMode(mode) { m.minimap.mode.value = mode; }, toggleResources() { m.minimap.showResources.value = !m.minimap.showResources.peek(); },
        setCamera(x, z) { m.minimap.camera.value = [[x - 100, z - 100], [x + 100, z - 100], [x + 100, z + 100], [x - 100, z + 100]]; },
    };
}
