/**
 * Deterministic demo data of the top HUD zone (gallery stories, tests, later the HUD demo path): resource
 * meter states, flow details, match status, banners, alerts and tooltip targets. Values follow the mockup
 * (docs/design/ui-mockups/assets/hud.js). Live jitter uses the seeded PRNG from core.ts (no Math.random).
 */
import { batch } from '@preact/signals';
import type { HudModel } from '../model/index.ts';
import { createAlertsSection, pushAlert } from '../model/alerts.ts';
import type { AlertEvent, AlertType } from '../model/alerts.ts';
import { writeResource } from '../model/eco.ts';
import type { FlowConsumer, IncomeEntry, ResourceInit, ResourceKind, StorageEntry } from '../model/eco.ts';
import type { PauseState } from '../model/status.ts';
import type { UnitTooltipTarget } from '../model/tooltip.ts';
import { DEMO_SEED, createDemoRng, range } from './core.ts';
import type { Rng } from './core.ts';

// ---------------------------------------------------------------------------------------------------------
// Resource meters (ui.md §5.1)

export type MeterPreset = 'normal' | 'overflow' | 'stallSoon' | 'stall';
export const METER_PRESETS: readonly MeterPreset[] = ['normal', 'overflow', 'stallSoon', 'stall'];

/** Mockup flow factor while stalling ("Stall · Flow 72 %"). */
export const DEMO_STALL_FLOW = 0.72;

interface ResourceDemo extends ResourceInit {
  readonly incomeBySource: readonly IncomeEntry[];
  readonly storageByBuilding: readonly StorageEntry[];
}

const MASS_SOURCES: readonly IncomeEntry[] = [
  { source: 'mex', perSec: 24 },
  { source: 'commander', perSec: 1 },
  { source: 'reclaim', perSec: 3 },
];
const ENERGY_SOURCES: readonly IncomeEntry[] = [
  { source: 'pgen', perSec: 300 },
  { source: 'commander', perSec: 20 },
  { source: 'hydro', perSec: 20 },
];
const MASS_STORAGE: readonly StorageEntry[] = [
  { typeId: 'core:cmd_commander', count: 1, capacity: 650 },
  { typeId: 'core:str_t1_fac_land', count: 1, capacity: 80 },
  { typeId: 'core:str_t1_mstore', count: 1, capacity: 500 },
];
const ENERGY_STORAGE: readonly StorageEntry[] = [
  { typeId: 'core:cmd_commander', count: 1, capacity: 3900 },
  { typeId: 'core:str_t1_pgen', count: 5, capacity: 200 },
];

/** Per resource and state: storage, income, demand, served, flow (stall: served = income, flow 72 %). */
export const RESOURCE_DEMO: Readonly<Record<ResourceKind, Readonly<Record<MeterPreset, ResourceDemo>>>> = {
  mass: {
    normal: { stored: 312, capacity: 1230, income: 28, demand: 31.5, served: 31.5, flow: 1, incomeBySource: MASS_SOURCES, storageByBuilding: MASS_STORAGE },
    overflow: { stored: 1230, capacity: 1230, income: 28, demand: 12, served: 12, flow: 1, incomeBySource: MASS_SOURCES, storageByBuilding: MASS_STORAGE },
    stallSoon: { stored: 38, capacity: 1230, income: 28, demand: 33.5, served: 33.5, flow: 1, incomeBySource: MASS_SOURCES, storageByBuilding: MASS_STORAGE },
    stall: { stored: 0, capacity: 1230, income: 28, demand: 38.9, served: 28, flow: DEMO_STALL_FLOW, incomeBySource: MASS_SOURCES, storageByBuilding: MASS_STORAGE },
  },
  energy: {
    normal: { stored: 2840, capacity: 4900, income: 340, demand: 296, served: 296, flow: 1, incomeBySource: ENERGY_SOURCES, storageByBuilding: ENERGY_STORAGE },
    overflow: { stored: 4900, capacity: 4900, income: 340, demand: 296, served: 296, flow: 1, incomeBySource: ENERGY_SOURCES, storageByBuilding: ENERGY_STORAGE },
    stallSoon: { stored: 420, capacity: 4900, income: 220, demand: 285, served: 285, flow: 1, incomeBySource: ENERGY_SOURCES, storageByBuilding: ENERGY_STORAGE },
    stall: { stored: 0, capacity: 4900, income: 220, demand: 305.5, served: 220, flow: DEMO_STALL_FLOW, incomeBySource: ENERGY_SOURCES, storageByBuilding: ENERGY_STORAGE },
  },
};

/** Sets one resource meter to a preset. */
export function applyResourcePreset(model: HudModel, kind: ResourceKind, preset: MeterPreset): void {
  const d = RESOURCE_DEMO[kind][preset];
  const r = model.eco[kind];
  batch(() => {
    writeResource(r, d);
    r.incomeBySource.value = d.incomeBySource;
    r.storageByBuilding.value = d.storageByBuilding;
  });
}

/** Named eco presets of the gallery (mass state, energy state). */
export const ECO_PRESETS = {
  normal: ['normal', 'normal'],
  overflow: ['normal', 'overflow'],
  stallSoon: ['stallSoon', 'normal'],
  stallMass: ['stall', 'normal'],
  stallEnergy: ['normal', 'stall'],
  stall: ['stall', 'stall'],
} as const satisfies Readonly<Record<string, readonly [MeterPreset, MeterPreset]>>;
export type EcoPresetName = keyof typeof ECO_PRESETS;

export function applyEcoPreset(model: HudModel, name: EcoPresetName): void {
  const [mass, energy] = ECO_PRESETS[name];
  batch(() => {
    applyResourcePreset(model, 'mass', mass);
    applyResourcePreset(model, 'energy', energy);
  });
}

// ---------------------------------------------------------------------------------------------------------
// Flow details (ui.md §5.1, mockup rows)

/** Consumers at full rate (flow 1). */
export const DEMO_CONSUMERS: readonly FlowConsumer[] = [
  { id: 1, typeId: 'core:str_t1_fac_land', kind: 'factory', targetTypeId: 'core:lnd_t1_tank', massReq: 10.9, massGot: 10.9, energyReq: 54.4, energyGot: 54.4, paused: false },
  { id: 2, typeId: 'core:cmd_commander', kind: 'engineer', targetTypeId: 'core:str_t1_pgen', massReq: 6, massGot: 6, energyReq: 60, energyGot: 60, paused: false },
  { id: 3, typeId: 'core:lnd_t1_engineer', kind: 'engineer', targetTypeId: 'core:str_t1_mex', count: 2, massReq: 6, massGot: 6, energyReq: 60, energyGot: 60, paused: false },
  { id: 4, typeId: 'core:str_t1_mex', kind: 'upgrade', targetTypeId: 'core:str_t2_mex', massReq: 7.3, massGot: 7.3, energyReq: 43.6, energyGot: 43.6, paused: false },
  { id: 5, typeId: 'core:str_t1_radar', kind: 'upkeep', massReq: 0, massGot: 0, energyReq: 20, energyGot: 20, paused: false },
];

/** Consumers throttled to `flow` (every running consumer gets flow × its request); `pausedIds` get nothing. */
export function demoConsumers(flow: number, pausedIds: readonly number[] = []): readonly FlowConsumer[] {
  return DEMO_CONSUMERS.map((c) => {
    const paused = pausedIds.includes(c.id);
    return {
      ...c,
      paused,
      massGot: paused ? 0 : c.massReq * flow,
      energyGot: paused ? 0 : c.energyReq * flow,
    };
  });
}

export type FlowDetailsPreset = 'closed' | 'open' | 'paused' | 'bottleneck';

/**
 * closed: details hidden · open: read-only (before E13), no bottleneck · paused: interactive, the upgrade row
 * paused · bottleneck: energy stall, all consumers at 72 %.
 */
export function applyFlowDetailsPreset(model: HudModel, preset: FlowDetailsPreset): void {
  batch(() => {
    const eco = model.eco;
    applyEcoPreset(model, preset === 'bottleneck' ? 'stallEnergy' : 'normal');
    eco.detailsOpen.value = preset !== 'closed';
    eco.interactive.value = preset === 'paused' || preset === 'bottleneck';
    eco.stallPriority.value = ['factory', 'engineer', 'upgrade', 'upkeep'];
    eco.consumers.value =
      preset === 'bottleneck' ? demoConsumers(DEMO_STALL_FLOW) : preset === 'paused' ? demoConsumers(1, [4]) : demoConsumers(1);
  });
}

// ---------------------------------------------------------------------------------------------------------
// Match status and banners (ui.md §5.2, §5.3)

/** 11:42 like the mockup. */
export const DEMO_TIME_S = 702;

export type MatchPreset = 'normal' | 'speed' | 'capNear' | 'capReached' | 'replay' | 'long';

export function applyMatchPreset(model: HudModel, preset: MatchPreset): void {
  const m = model.match;
  batch(() => {
    m.timeS.value = preset === 'long' ? 3725 : DEMO_TIME_S;
    m.speed.value = preset === 'speed' ? 2 : 1;
    m.pause.value = 'none';
    m.simLag.value = null;
    m.contextLost.value = false;
    m.unitCap.value = 500;
    m.units.value = preset === 'capNear' ? 462 : preset === 'capReached' ? 500 : 64;
    m.replay.value = preset === 'replay';
    m.scores.value = preset === 'replay' ? { self: 8412, enemy: 7980 } : null;
  });
}

export type BannerPreset = 'none' | 'pause' | 'background' | 'speed' | 'lag' | 'contextLoss';

export function applyBannerPreset(model: HudModel, preset: BannerPreset): void {
  const m = model.match;
  const pause: PauseState = preset === 'pause' ? 'user' : preset === 'background' ? 'background' : 'none';
  batch(() => {
    m.pause.value = pause;
    m.speed.value = preset === 'speed' ? 2 : 1;
    m.simLag.value = preset === 'lag' ? 0.8 : null;
    m.contextLost.value = preset === 'contextLoss';
  });
}

// ---------------------------------------------------------------------------------------------------------
// Alerts (ui.md §5.11)

/** One representative event per alert type (subject, place, flow as in the mockup). */
export const DEMO_ALERT_EVENTS: Readonly<Record<AlertType, Omit<AlertEvent, 'atS'>>> = {
  commanderDanger: { type: 'commanderDanger', region: 'base', location: { x: 96, z: 400 }, subjectTypeId: 'core:cmd_commander' },
  energyStall: { type: 'energyStall', flow: DEMO_STALL_FLOW },
  massStall: { type: 'massStall', flow: 0.81 },
  baseAttacked: { type: 'baseAttacked', region: 'east', location: { x: 420, z: 250 }, subjectTypeId: 'core:str_t1_pd' },
  unitAttacked: { type: 'unitAttacked', region: 'center', location: { x: 256, z: 256 }, subjectTypeId: 'core:lnd_t1_scout' },
  enemyAir: { type: 'enemyAir', region: 'north', location: { x: 250, z: 40 }, subjectTypeId: 'core:air_t1_bomber' },
  enemyCommanderSpotted: { type: 'enemyCommanderSpotted', region: 'northEast', location: { x: 430, z: 80 } },
  storageFull: { type: 'storageFull' },
  buildComplete: { type: 'buildComplete', region: 'south', location: { x: 240, z: 470 }, subjectTypeId: 'core:str_t1_mex' },
  factoryUpgraded: { type: 'factoryUpgraded', region: 'base', location: { x: 110, z: 420 }, subjectTypeId: 'core:str_t2_fac_land' },
};

export function demoAlertEvent(type: AlertType, atS: number): AlertEvent {
  return { ...DEMO_ALERT_EVENTS[type], atS };
}

/** Resets the alert section and match time, then pushes `events` in order (merging like the live feed). */
export function applyAlertEvents(model: HudModel, events: readonly AlertEvent[], nowS: number, historyCount = 0): void {
  const fresh = createAlertsSection();
  batch(() => {
    model.alerts.items.value = fresh.items.peek();
    model.alerts.nextId.value = fresh.nextId.peek();
    model.alerts.historyCount.value = historyCount;
    model.match.timeS.value = nowS;
    for (const ev of events) pushAlert(model.alerts, ev);
  });
}

export type AlertPreset = AlertType | 'stale' | 'merged' | 'mixed' | 'all';

/**
 * Single alerts (one per type, newest), `stale` (seen 48 s ago), `merged` (unit attacked ×3 within 10 s),
 * `mixed` (5 alerts: 3 visible + "2 ältere") and `all` (all 10 types, one after another).
 */
export function applyAlertPreset(model: HudModel, preset: AlertPreset): void {
  const now = DEMO_TIME_S;
  if (preset === 'stale') {
    applyAlertEvents(model, [demoAlertEvent('enemyCommanderSpotted', now - 48)], now);
  } else if (preset === 'merged') {
    applyAlertEvents(model, [demoAlertEvent('unitAttacked', now - 9), demoAlertEvent('unitAttacked', now - 5), demoAlertEvent('unitAttacked', now - 1)], now);
  } else if (preset === 'mixed') {
    applyAlertEvents(
      model,
      [
        demoAlertEvent('enemyCommanderSpotted', now - 48),
        demoAlertEvent('baseAttacked', now - 12),
        demoAlertEvent('unitAttacked', now - 9),
        demoAlertEvent('buildComplete', now - 3),
        demoAlertEvent('commanderDanger', now - 1),
      ],
      now,
    );
  } else if (preset === 'all') {
    const types = Object.keys(DEMO_ALERT_EVENTS) as AlertType[];
    applyAlertEvents(model, types.map((type, i) => demoAlertEvent(type, now - (types.length - i) * 2)), now);
  } else {
    applyAlertEvents(model, [demoAlertEvent(preset, now - (preset === 'commanderDanger' || preset === 'energyStall' ? 0 : 4))], now);
  }
}

// ---------------------------------------------------------------------------------------------------------
// Tooltips (ui.md §5.12)

/** Tooltip targets: Ember Boiler I in the Reeve's build grid (adjacency), Punch in the land works, the Reeve itself. */
export const DEMO_TOOLTIPS = {
  boiler: { kind: 'unit', typeId: 'core:str_t1_pgen', builderBp: 10, slot: 'KeyW', mode: 'build' },
  punch: { kind: 'unit', typeId: 'core:lnd_t1_tank', builderBp: 35, slot: 'KeyQ', mode: 'factory' },
  reeve: { kind: 'unit', typeId: 'core:cmd_commander', mode: 'info' },
  canopyLocked: { kind: 'unit', typeId: 'core:str_t2_shield', builderBp: 10, slot: 'KeyF', mode: 'build', locked: { reason: 'needBuilderTech', tier: 2 } },
  tapDisabled: { kind: 'unit', typeId: 'core:str_t1_mex', builderBp: 10, slot: 'KeyQ', mode: 'build' },
} as const satisfies Readonly<Record<string, UnitTooltipTarget>>;

// ---------------------------------------------------------------------------------------------------------
// Live jitter (perf and interactive demo)

export interface EcoDemoTicker {
  /** Advances the demo economy by one sim tick (0.1 s): storage follows net, income jitters deterministically. */
  step(): void;
}

/**
 * Deterministic 10 Hz eco driver on top of the current values: income jitters ±5 % around its base, storage
 * integrates the net and clamps to capacity, flow drops below 1 while empty and demand exceeds income.
 */
export function createEcoDemoTicker(model: HudModel, seed: number = DEMO_SEED): EcoDemoTicker {
  const rng: Rng = createDemoRng(seed);
  const base = { mass: model.eco.mass.income.peek(), energy: model.eco.energy.income.peek() };
  const stepOne = (kind: ResourceKind): void => {
    const r = model.eco[kind];
    const income = base[kind] * range(rng, 0.95, 1.05);
    const demand = r.demand.peek();
    const cap = r.capacity.peek();
    let stored = r.stored.peek() + (income - demand) * 0.1;
    stored = stored < 0 ? 0 : stored > cap ? cap : stored;
    const starving = stored <= 0 && demand > income;
    const flow = starving ? income / demand : 1;
    writeResource(r, { income, stored, flow, served: demand * flow });
  };
  return {
    step: () =>
      batch(() => {
        stepOne('mass');
        stepOne('energy');
      }),
  };
}
