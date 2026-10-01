import type { HudModel } from '../model/index.ts';
import { DEFAULT_SETTINGS, changedSettings } from '../model/menus/settings.ts';
import { initialPhases } from '../model/menus/loading.ts';
import { createDemoRng } from './core.ts';
export function seedMenus(m: HudModel): void {
    m.menus.main.build.value = '0.0.0-local';
    m.menus.main.simId.value = 'demo-2026';
    m.menus.main.transport.value = 'SAB';
    m.menus.main.preset.value = 'medium';
    m.menus.main.lastMatch.value = { mapName: 'Setons', verdict: 'victory', durationS: 1421, opponent: 'Haus Rabenau', hasReplay: true };
    m.menus.skirmish.maps.value = [['setons', 'Setons', 1024, 24], ['hollow-ridge', 'Hollow Ridge', 512, 12], ['tessera', 'Tessera', 512, 16], ['braidwater', 'Braidwater', 1024, 20]].map(([id, name, size, mass]) => ({ id: String(id), name: String(name), sizeWu: Number(size), starts: 2, massSpots: Number(mass), hydroSpots: 2, available: true, startPositions: [[.2, .25], [.8, .75]] }));
    m.menus.skirmish.selectedMap.value = 'setons';
    m.menus.skirmish.slots.value = [{ index: 0, name: 'Haus Ambrecht', controller: 'human', faction: 'varkan', color: 'blue', team: 1, start: 0, ai: null }, { index: 1, name: 'Haus Rabenau', controller: 'ai', faction: 'varkan', color: 'red', team: 2, start: 1, ai: { difficulty: 'normal', aix: false, aixFactor: 1 } }];
    m.menus.skirmish.validation.value = { state: 'ok', simId: 'demo-2026', message: null };
    m.menus.loading.mapName.value = 'Setons';
    m.menus.loading.phases.value = initialPhases().map((p, i) => ({ ...p, state: i === 0 ? 'done' : i === 1 ? 'active' : 'pending', progress: i === 0 ? 1 : i === 1 ? .45 : 0 }));
    m.menus.loading.currentFile.value = { path: 'units/varkan/tank.glb', source: 'cache' };
    m.menus.loading.bytes.value = { loaded: 4000000, total: 12000000 };
    m.menus.settings.values.value = { ...DEFAULT_SETTINGS };
    m.menus.settings.dirty.value = changedSettings(m.menus.settings.values.value);
    m.menus.settings.gpuName.value = 'Demo GPU (keine Hardwaremessung)';
    m.menus.score.durationS.value = 1421;
    m.menus.score.rows.value = [{ id: 'mass', group: 'economy', self: 74210, enemy: 60180 }, { id: 'energy', group: 'economy', self: 890000, enemy: 760000 }, { id: 'efficiency', group: 'economy', self: 92, enemy: 83 }, { id: 'kills', group: 'army', self: 301, enemy: 220 }, { id: 'losses', group: 'army', self: 220, enemy: 301, lowerIsBetter: true }, { id: 'built', group: 'units', self: 420, enemy: 380 }];
    const rng = createDemoRng();
    m.menus.score.series.value = (['massIncome', 'armyValue'] as const).map(id => ({ id, stepS: 30, self: Array.from({ length: 48 }, (_, i) => Math.round(i * (id === 'massIncome' ? 1.5 : 400) + rng() * 20)), enemy: Array.from({ length: 48 }, (_, i) => Math.round(i * (id === 'massIncome' ? 1.2 : 300) + rng() * 20)) }));
    m.menus.score.events.value = [{ timeS: 90, kind: 'firstFactory', side: 'self' }, { timeS: 530, kind: 'techUp', side: 'enemy' }, { timeS: 1421, kind: 'commanderLost', side: 'enemy' }];
}
