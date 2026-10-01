import type { HudModel } from '../model/index.ts';
import type { HudSnapshot } from '../model/snapshot.ts';
import { aggregateMultiStats } from '../model/selection.ts';
import { writeResource } from '../model/eco.ts';
import { ROSTER } from '../data/roster.gen.ts';
import { createDemoRng } from './core.ts';
export function seedHud(m: HudModel, scenario = 'vogt'): void {
    const ids = ROSTER.map(x => x.id), commander = ids.find(x => x.includes('commander')) ?? ids[0]!, factory = ids.find(x => x === 'core:str_t1_fac_land') ?? ids.find(x => x.includes('fac_land'))!, tank = ids.find(x => x.includes('tank_t1')) ?? ids.find(x => x.includes('tank'))!, engineer = ids.find(x => x.includes('engineer'))!;
    writeResource(m.eco.mass, { stored: 320, capacity: 1000, income: 24, demand: 20, served: 20, flow: 1 });
    writeResource(m.eco.energy, { stored: 12000, capacity: 20000, income: 240, demand: 200, served: 200, flow: 1 });
    m.match.timeS.value = 804;
    m.match.units.value = 260;
    m.match.unitCap.value = 500;
    m.eco.consumers.value = [{ id: 1, typeId: factory, kind: 'factory', massReq: 12, massGot: 12, energyReq: 120, energyGot: 120, paused: false }, { id: 2, typeId: engineer, kind: 'engineer', massReq: 8, massGot: 8, energyReq: 80, energyGot: 80, paused: false }];
    m.eco.interactive.value = true;
    m.selection.kind.value = 'single';
    m.selection.single.value = { handle: 1, typeId: commander, hp: 7200, hpMax: 10000, vet: { level: 2, progress: .6 }, tapshot: { stored: 6000, threshold: 7500 }, stats: { dps: 100, range: 22, speed: 3, vision: 28, buildPower: 10, regen: 10 }, orders: [{ kind: 'build', typeId: factory, progress: .4, x: 100, z: 100 }, { kind: 'move', x: 200, z: 200 }] };
    m.card.selectedTypes.value = [commander];
    m.card.unitCount.value = 1;
    m.factory.detail.value = { handle: 3, typeId: factory, hp: 3500, hpMax: 4000, bpOwn: 20, bpAssist: 10, helpers: [{ typeId: engineer, count: 2 }], adjacencyPct: 15, rally: 'point', factoryCount: 1 };
    m.factory.queue.value = { current: { typeId: tank }, blocks: [{ typeId: tank, count: 5 }, { typeId: engineer, count: 2 }], repeat: false, paused: false };
    m.factory.progress.value = .55;
    m.factory.remainingS.value = 7;
    m.strip.groups.value = Array.from({ length: 10 }, (_, i) => ({ count: i === 0 ? 24 : 0, iconTypeId: i === 0 ? tank : null }));
    m.strip.activeGroup.value = 0;
    m.strip.idleEngineers.value = 3;
    m.strip.idleFactories.value = 1;
    const rng = createDemoRng(), count = scenario === 'perf-500' ? 500 : 100, rgba = new Uint8ClampedArray(64 * 64 * 4);
    for (let i = 0; i < rgba.length; i += 4) {
        rgba[i] = 45 + Math.floor(rng() * 35);
        rgba[i + 1] = 55 + Math.floor(rng() * 35);
        rgba[i + 2] = 40;
        rgba[i + 3] = 255;
    }
    m.minimap.available.value = true;
    m.minimap.mapName.value = 'Setons';
    m.minimap.mapSizeWu.value = 1024;
    m.minimap.terrain.value = { width: 64, height: 64, rgba };
    m.minimap.fog.value = { res: 16, cells: Uint8Array.from({ length: 256 }, (_, i) => i % 3) };
    m.minimap.units.value = { count, x: Float32Array.from({ length: count }, () => rng() * 1024), z: Float32Array.from({ length: count }, () => rng() * 1024), army: Uint8Array.from({ length: count }, (_, i) => scenario === 'perf-500' ? 0 : i % 2), kind: Uint8Array.from({ length: count }, (_, i) => scenario === 'perf-500' ? 0 : i % 4) };
    m.minimap.spots.value = Array.from({ length: 24 }, () => ({ x: rng() * 1024, z: rng() * 1024, kind: 'mass', taken: false }));
    m.minimap.camera.value = [[300, 300], [600, 300], [600, 600], [300, 600]];
    if (scenario === 'armee' || scenario === 'dichtester Fall' || scenario === 'perf-500') {
        const groups = ids.filter(x => !x.includes('factory')).slice(0, scenario === 'dichtester Fall' || scenario === 'perf-500' ? 24 : 6).map((typeId,i) => ({ typeId, count: scenario==='perf-500'?(i<12?3:2):10 })), samples = groups.flatMap(g => Array.from({ length: g.count }, () => ({ typeId: g.typeId, hp: rng(), vet: 2, dps: 25, mass: 80, speed: 3 })));
        m.selection.kind.value = 'multi';
        m.selection.multi.value = { groups, units: (scenario === 'perf-500' ? samples.slice(0, 60) : samples.length > 60 ? [] : samples).map((x, i) => ({ handle: i + 1, typeId: x.typeId })), total: samples.length };
        m.selection.multiStats.value = aggregateMultiStats(groups, scenario === 'perf-500' ? 60 : samples.length > 60 ? 0 : 60, samples);
        m.card.selectedTypes.value = groups.map(x => x.typeId);
        m.card.unitCount.value = samples.length;
    }
    if (scenario === 'fabrik-stall') {
        m.selection.kind.value = 'factory';
        m.card.selectedTypes.value = [factory];
        writeResource(m.eco.energy, { stored: 0, demand: 400, served: 240, flow: .6 });
        m.eco.detailsOpen.value = true;
    }
    if (scenario === 'perf-500' || scenario === 'dichtester Fall') {
        m.match.units.value = 500;
        if(scenario==='dichtester Fall'){m.match.pause.value='user';writeResource(m.eco.energy,{stored:0,demand:400,served:240,flow:.6});m.tooltip.target.value={kind:'unit',typeId:tank,builderBp:20};m.tooltip.viaKeyboard.value=true;}
        m.eco.detailsOpen.value = true;
        m.alerts.items.value = ([{ id: 1, type: 'commanderDanger', count: 1, createdAtS: 804, lastAtS: 804, location: { x: 200, z: 200 } }, { id: 2, type: 'baseAttacked', count: 2, createdAtS: 800, lastAtS: 804, location: { x: 500, z: 500 } }, { id: 3, type: 'enemyAir', count: 1, createdAtS: 803, lastAtS: 803, location: { x: 800, z: 800 } }]);
    }
    if (scenario === 'pause-cvd') {
        m.match.pause.value = 'user';
        m.teams.value = 'cvd';
    }
}
/** Snapshot copies wrappers; buffers belong to the publisher, as in the scheduler contract. */
export function snapshotOf(m: HudModel, version = 1): HudSnapshot {
    const values = (section: object) => Object.fromEntries(Object.entries(section).filter(([, v]) => typeof v === 'object' && v !== null && 'value' in v).map(([k, v]) => [k, (v as {
            value: unknown;
        }).value]));
    return { versions: { selection: version, card: version, alerts: version, banners: version, minimap: version, queue: version }, eco: { mass: values(m.eco.mass), energy: values(m.eco.energy), consumers: m.eco.consumers.value }, match: values(m.match), selection: values(m.selection), factory: values(m.factory), card: values(m.card), orders: values(m.orders), strip: values(m.strip), alerts: values(m.alerts), minimap: values(m.minimap) } as unknown as HudSnapshot;
}
