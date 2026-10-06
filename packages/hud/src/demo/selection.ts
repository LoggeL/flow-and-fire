/**
 * Demo data of the selection panel and factory queue (hud-p3): deterministic scenarios matching the
 * mockups (hud.html?sel=vogt|army|factory|none) plus the edge case of ui.md §9.2 (60 units, 24 types).
 * Uses only the own seeded PRNG (demo/core.ts), never Math.random.
 */
import { batch } from '@preact/signals';
import { buildTimeS, getUnit, mvpUnits, unitStats } from '../data/roster.ts';
import type { UnitStats } from '../data/roster.ts';
import type { FactoryDetailData, FactoryQueueData } from '../model/factory.ts';
import type { HudModel } from '../model/index.ts';
import { TAPSHOT_THRESHOLD, aggregateMultiStats } from '../model/selection.ts';
import type { MultiSelectionData, MultiStats, MultiUnitSample, OrderEntry, SelectedUnit, TypeCount, UnitDetailData } from '../model/selection.ts';
import { demoUnitCatalog } from './catalog.ts';
import { createDemoRng } from './core.ts';

/** Stats of a demo unit (throws for ids outside the demo catalog: a bug in the demo data). */
export function demoUnitStats(typeId: string): UnitStats {
  const cat = demoUnitCatalog();
  getUnit(cat, typeId);
  return unitStats(cat, typeId)!;
}

export const SELECTION_DEMO_IDS = {
  commander: 'core:cmd_commander',
  engineer: 'core:lnd_t1_engineer',
  tank: 'core:lnd_t1_tank',
  bot: 'core:lnd_t1_bot',
  arty: 'core:lnd_t1_arty',
  aa: 'core:lnd_t1_aa',
  scout: 'core:lnd_t1_scout',
  pgen: 'core:str_t1_pgen',
  mex: 'core:str_t1_mex',
  landFactory: 'core:str_t1_fac_land',
} as const;

/** House label shown in the panel head of the single views (data, not UI text). */
export const SELECTION_DEMO_HOUSE = 'Haus Ambrecht';

function statLine(typeId: string): UnitDetailData['stats'] {
  const s = demoUnitStats(typeId);
  return { dps: s.dps, range: s.range, speed: s.speed, vision: s.vision, buildPower: s.buildPower, regen: s.regenPerS };
}

/** Vogt building a row of boilers: order chain with 5 entries (mockup sel=vogt). */
export function demoCommanderDetail(): UnitDetailData {
  const orders: OrderEntry[] = [
    { kind: 'build', typeId: SELECTION_DEMO_IDS.pgen, progress: 0.64, x: 412, z: 388 },
    { kind: 'build', typeId: SELECTION_DEMO_IDS.pgen, progress: 0, x: 428, z: 388 },
    { kind: 'build', typeId: SELECTION_DEMO_IDS.pgen, progress: 0, x: 444, z: 388 },
    { kind: 'build', typeId: SELECTION_DEMO_IDS.mex, progress: 0, x: 452, z: 430 },
    { kind: 'reclaim', targets: 3, mass: 86, x: 470, z: 402 },
  ];
  return {
    handle: 1,
    typeId: SELECTION_DEMO_IDS.commander,
    hp: 10320,
    hpMax: 12000,
    vet: { level: 1, progress: 0.42, mass: 420, massNext: 1000 },
    tapshot: { stored: 2840, threshold: TAPSHOT_THRESHOLD },
    stats: statLine(SELECTION_DEMO_IDS.commander),
    orders,
  };
}

/** Vogt with a chain longer than the panel (9 orders → 5 rows + "+4 weitere Befehle"). */
export function demoCommanderLongChain(): UnitDetailData {
  const base = demoCommanderDetail();
  const extra: OrderEntry[] = [
    { kind: 'build', typeId: SELECTION_DEMO_IDS.mex, progress: 0, x: 480, z: 440 },
    { kind: 'assist', typeId: SELECTION_DEMO_IDS.landFactory, x: 300, z: 350 },
    { kind: 'repair', typeId: SELECTION_DEMO_IDS.pgen, x: 412, z: 388 },
    { kind: 'move', x: 520, z: 400 },
  ];
  return { ...base, orders: [...base.orders, ...extra] };
}

/** Engineer with exactly one running order (OrderQueue "laufend"). */
export function demoEngineerRunning(): UnitDetailData {
  return {
    handle: 7,
    typeId: SELECTION_DEMO_IDS.engineer,
    hp: 160,
    hpMax: 160,
    vet: { level: 0, progress: 0 },
    tapshot: null,
    stats: statLine(SELECTION_DEMO_IDS.engineer),
    orders: [{ kind: 'build', typeId: SELECTION_DEMO_IDS.mex, progress: 0.38, x: 452, z: 430 }],
  };
}

/** Idle engineer without orders (OrderQueue "leer"). */
export function demoEngineerIdle(): UnitDetailData {
  return { ...demoEngineerRunning(), handle: 8, orders: [] };
}

/** Single damaged tank (27 % HP → critical, hatched) with an attack move and a queued move. */
export function demoTankDamaged(): UnitDetailData {
  return {
    handle: 101,
    typeId: SELECTION_DEMO_IDS.tank,
    hp: 81,
    hpMax: 300,
    vet: { level: 2, progress: 0.3, mass: 45, massNext: 150 },
    tapshot: null,
    stats: statLine(SELECTION_DEMO_IDS.tank),
    orders: [
      { kind: 'attackMove', x: 610, z: 212 },
      { kind: 'move', x: 640, z: 180 },
    ],
  };
}

/** A multi selection with its hot values. */
export interface DemoMultiSelection {
  readonly multi: MultiSelectionData;
  readonly samples: readonly MultiUnitSample[];
  readonly stats: MultiStats;
}

function buildMulti(groups: readonly TypeCount[], hpOf: (typeIndex: number, k: number, unitIndex: number) => number, vetOf: (typeIndex: number, k: number) => number, firstHandle: number): DemoMultiSelection {
  const units: SelectedUnit[] = [];
  const samples: MultiUnitSample[] = [];
  let handle = firstHandle;
  groups.forEach((g, gi) => {
    const s = demoUnitStats(g.typeId);
    for (let k = 0; k < g.count; k++) {
      units.push({ handle, typeId: g.typeId });
      samples.push({ typeId: g.typeId, hp: hpOf(gi, k, units.length - 1), vet: vetOf(gi, k), dps: s.dps, mass: s.mass, speed: s.speed });
      handle++;
    }
  });
  const total = units.length;
  const multi: MultiSelectionData = { groups, units: total <= 60 ? units : [], total };
  const stats = aggregateMultiStats(groups, multi.units.length, samples);
  return { multi, samples, stats };
}

/** Army of 19 units in 5 types (mockup sel=army): 9 tanks (3 damaged), 4 bots, 3 artillery, 2 AA, 1 engineer. */
export function demoArmySelection(): DemoMultiSelection {
  const groups: TypeCount[] = [
    { typeId: SELECTION_DEMO_IDS.tank, count: 9 },
    { typeId: SELECTION_DEMO_IDS.bot, count: 4 },
    { typeId: SELECTION_DEMO_IDS.arty, count: 3 },
    { typeId: SELECTION_DEMO_IDS.aa, count: 2 },
    { typeId: SELECTION_DEMO_IDS.engineer, count: 1 },
  ];
  const tankHp = [1, 1, 1, 0.35, 1, 1, 1, 0.6, 0.2];
  return buildMulti(
    groups,
    (gi, k) => (gi === 0 ? tankHp[k]! : gi === 1 && k === 2 ? 0.8 : 1),
    (gi, k) => (gi === 0 ? (k < 2 ? 2 : 1) : gi === 1 ? (k === 0 ? 1 : 0) : 0),
    201,
  );
}

/** Edge case of ui.md §9.2: 60 units in 24 types ("select all" across units and structures). */
export function demoEdgeSelection(): DemoMultiSelection {
  const rng = createDemoRng(0x5e1ec7);
  const types = mvpUnits(demoUnitCatalog()).filter((u) => u.tech !== 0).slice(0, 24);
  const groups: TypeCount[] = types.map((u, i) => ({ typeId: u.id, count: i < 12 ? 3 : 2 }));
  return buildMulti(
    groups,
    () => {
      const r = rng();
      return r < 0.12 ? 0.15 + r : r < 0.3 ? 0.4 + r : 1;
    },
    (gi, k) => (gi + k) % 4,
    1001,
  );
}

/** Land factory I with 2 + 1 blocks … (mockup sel=factory): BP 20 + 15, 3 prentices assisting, adjacency −9 % E. */
export function demoLandFactoryDetail(): FactoryDetailData {
  return {
    handle: 500,
    typeId: SELECTION_DEMO_IDS.landFactory,
    hp: 4200,
    hpMax: 4200,
    bpOwn: 20,
    bpAssist: 15,
    helpers: [{ typeId: SELECTION_DEMO_IDS.engineer, count: 3 }],
    adjacencyPct: 9,
    rally: 'point',
    factoryCount: 1,
  };
}

export function demoLandFactoryQueue(): FactoryQueueData {
  return {
    current: { typeId: SELECTION_DEMO_IDS.tank },
    blocks: [
      { typeId: SELECTION_DEMO_IDS.tank, count: 5 },
      { typeId: SELECTION_DEMO_IDS.arty, count: 2 },
      { typeId: SELECTION_DEMO_IDS.engineer, count: 1 },
      { typeId: SELECTION_DEMO_IDS.aa, count: 1 },
    ],
    repeat: false,
    paused: false,
  };
}

/** Queue with more blocks than slots (12 → 9 shown + "+3"). */
export function demoLongFactoryQueue(): FactoryQueueData {
  const cycle = [SELECTION_DEMO_IDS.tank, SELECTION_DEMO_IDS.arty, SELECTION_DEMO_IDS.aa, SELECTION_DEMO_IDS.bot];
  const blocks: TypeCount[] = [];
  for (let i = 0; i < 12; i++) blocks.push({ typeId: cycle[i % cycle.length]!, count: 1 + (i % 3) });
  return { current: { typeId: SELECTION_DEMO_IDS.tank }, blocks, repeat: true, paused: false };
}

/** Remaining seconds of the item in production at the factory's build power. */
export function demoFactoryRemainingS(typeId: string, bp: number, progress: number): number {
  return buildTimeS(demoUnitCatalog(), typeId, bp) * (1 - progress);
}

export type SelectionDemoScenario =
  | 'none'
  | 'commander'
  | 'commanderLongChain'
  | 'engineerRunning'
  | 'engineerIdle'
  | 'tankDamaged'
  | 'army'
  | 'armyFocus'
  | 'edge'
  | 'factory'
  | 'factoryRepeat'
  | 'factoryPaused'
  | 'factoryEmpty'
  | 'factoryLong'
  | 'factoryMulti';

export const SELECTION_DEMO_SCENARIOS: readonly SelectionDemoScenario[] = [
  'none',
  'commander',
  'commanderLongChain',
  'engineerRunning',
  'engineerIdle',
  'tankDamaged',
  'army',
  'armyFocus',
  'edge',
  'factory',
  'factoryRepeat',
  'factoryPaused',
  'factoryEmpty',
  'factoryLong',
  'factoryMulti',
];

function clearSelection(m: HudModel): void {
  const s = m.selection;
  s.single.value = null;
  s.multi.value = null;
  s.multiStats.value = null;
  s.focusTypeId.value = null;
  s.controlGroup.value = null;
  s.groupLabel.value = null;
  m.factory.detail.value = null;
  m.factory.queue.value = null;
  m.factory.progress.value = 0;
  m.factory.remainingS.value = 0;
}

function applyFactory(m: HudModel, detail: FactoryDetailData, queue: FactoryQueueData, progress: number, group: number | null): void {
  m.selection.kind.value = 'factory';
  m.selection.controlGroup.value = group;
  m.factory.detail.value = detail;
  m.factory.queue.value = queue;
  const current = queue.current;
  m.factory.progress.value = current ? progress : 0;
  m.factory.remainingS.value = current ? demoFactoryRemainingS(current.typeId, detail.bpOwn + detail.bpAssist, progress) : 0;
}

/** Fills the selection and factory sections of `model` with one scenario (one batch). */
export function applySelectionDemo(model: HudModel, scenario: SelectionDemoScenario): void {
  batch(() => {
    clearSelection(model);
    const s = model.selection;
    switch (scenario) {
      case 'none':
        s.kind.value = 'none';
        return;
      case 'commander':
      case 'commanderLongChain':
      case 'engineerRunning':
      case 'engineerIdle':
      case 'tankDamaged': {
        const d =
          scenario === 'commander'
            ? demoCommanderDetail()
            : scenario === 'commanderLongChain'
              ? demoCommanderLongChain()
              : scenario === 'engineerRunning'
                ? demoEngineerRunning()
                : scenario === 'engineerIdle'
                  ? demoEngineerIdle()
                  : demoTankDamaged();
        s.kind.value = 'single';
        s.single.value = d;
        if (scenario === 'tankDamaged') s.controlGroup.value = 2;
        else s.groupLabel.value = SELECTION_DEMO_HOUSE;
        return;
      }
      case 'army':
      case 'armyFocus':
      case 'edge': {
        const demo = scenario === 'edge' ? demoEdgeSelection() : demoArmySelection();
        s.kind.value = 'multi';
        s.multi.value = demo.multi;
        s.multiStats.value = demo.stats;
        s.controlGroup.value = scenario === 'edge' ? null : 1;
        if (scenario === 'edge') s.groupLabel.value = SELECTION_DEMO_HOUSE;
        s.focusTypeId.value = demo.multi.groups[scenario === 'armyFocus' ? 2 : 0]!.typeId;
        return;
      }
      case 'factory':
        applyFactory(model, demoLandFactoryDetail(), demoLandFactoryQueue(), 0.64, 3);
        return;
      case 'factoryRepeat':
        applyFactory(model, demoLandFactoryDetail(), { ...demoLandFactoryQueue(), repeat: true }, 0.64, 3);
        return;
      case 'factoryPaused':
        applyFactory(model, { ...demoLandFactoryDetail(), hp: 2650 }, { ...demoLandFactoryQueue(), paused: true }, 0.31, 3);
        return;
      case 'factoryEmpty':
        applyFactory(
          model,
          { ...demoLandFactoryDetail(), bpAssist: 0, helpers: [], adjacencyPct: 0, rally: 'none' },
          { current: null, blocks: [], repeat: false, paused: false },
          0,
          null,
        );
        s.groupLabel.value = SELECTION_DEMO_HOUSE;
        return;
      case 'factoryLong':
        applyFactory(model, demoLandFactoryDetail(), demoLongFactoryQueue(), 0.2, 3);
        return;
      case 'factoryMulti':
        applyFactory(
          model,
          { ...demoLandFactoryDetail(), bpAssist: 0, helpers: [], rally: 'point', factoryCount: 3 },
          {
            current: { typeId: SELECTION_DEMO_IDS.tank },
            blocks: [
              { typeId: SELECTION_DEMO_IDS.tank, count: 12 },
              { typeId: SELECTION_DEMO_IDS.arty, count: 6 },
              { typeId: SELECTION_DEMO_IDS.aa, count: 3 },
              { typeId: SELECTION_DEMO_IDS.engineer, count: 3 },
              { typeId: SELECTION_DEMO_IDS.scout, count: 1 },
            ],
            repeat: false,
            paused: false,
          },
          0.42,
          4,
        );
        return;
    }
  });
}

/**
 * Deterministic hot-value tick (4 Hz values + 10 Hz progress) for live demos and benchmarks: HP of the
 * single unit, running order progress, multi stats (refilled in place) and factory progress. Structure
 * signals are never touched, so a tick must not re-render any component.
 */
export function tickSelectionDemo(model: HudModel, step: number, samples?: readonly MultiUnitSample[]): void {
  const phase = (step % 40) / 40;
  batch(() => {
    const s = model.selection;
    const single = s.single.peek();
    if (single !== null) {
      const hpFrac = 0.35 + 0.6 * Math.abs(1 - 2 * phase);
      const orders = single.orders.length > 0 && single.orders[0]!.progress !== undefined ? [{ ...single.orders[0]!, progress: phase }, ...single.orders.slice(1)] : single.orders;
      s.single.value = { ...single, hp: Math.round(single.hpMax * hpFrac), orders };
    }
    const multi = s.multi.peek();
    const stats = s.multiStats.peek();
    if (multi !== null && samples !== undefined) {
      const moved = samples.map((u, i) => ({ ...u, hp: ((i * 37 + step * 3) % 100) / 100 }));
      s.multiStats.value = aggregateMultiStats(multi.groups, multi.units.length, moved, stats ?? undefined);
    }
    const q = model.factory.queue.peek();
    const d = model.factory.detail.peek();
    if (q !== null && q.current !== null && d !== null && !q.paused) {
      model.factory.progress.value = phase;
      model.factory.remainingS.value = demoFactoryRemainingS(q.current.typeId, d.bpOwn + d.bpAssist, phase);
    }
  });
}
