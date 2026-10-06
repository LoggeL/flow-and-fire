/**
 * Full-HUD scenarios (ui.md §12 mockup screenshots) and a seeded SnapshotGenerator that turns a scenario
 * into a plausible stream of HudSnapshots, one per sim tick (gallery stories, perf harness, benchmarks).
 * Scenarios are assembled from the group demo presets (top, selection, card) on a scratch model and captured
 * into a snapshot; the generator then changes economy, HP, progress, queue, alerts, minimap units, fog and
 * camera tick by tick. Own seeded PRNG only (demo/core.ts), never Math.random or the clock.
 */
import { batch } from '@preact/signals';
import { buildTimeS } from '../data/roster.ts';
import { createHudModel } from '../model/index.ts';
import type { HudModel } from '../model/index.ts';
import { ALERT_DEFS, mergeAlert, pruneAlerts } from '../model/alerts.ts';
import type { AlertEvent, AlertType } from '../model/alerts.ts';
import type { FlowConsumer } from '../model/eco.ts';
import type { FactoryQueueData } from '../model/factory.ts';
import type { MinimapMode } from '../model/minimap.ts';
import { aggregateMultiStats } from '../model/selection.ts';
import type { MultiStats, MultiUnitSample, UnitDetailData } from '../model/selection.ts';
import { captureSnapshot } from '../model/snapshot.ts';
import type { HudSnapshot, MinimapSnapshot, ResourceSnapshot } from '../model/snapshot.ts';
import type { TooltipAnchor, TooltipTarget } from '../model/tooltip.ts';
import { HudScheduler } from '../scheduler/HudScheduler.ts';
import type { HudSchedulerOptions } from '../scheduler/HudScheduler.ts';
import { ARMY_ORDERS, BUILDER_ORDERS, FACTORY_ORDERS, applyCardDemo, applyStripDemo } from './card.ts';
import { demoUnitCatalog } from './catalog.ts';
import { DEMO_SEED, createDemoRng, range } from './core.ts';
import type { Rng } from './core.ts';
import { DEMO_MAP_NAME, createMinimapDemo } from './minimap.ts';
import type { MinimapDemo } from './minimap.ts';
import { applySelectionDemo, demoArmySelection, demoEdgeSelection, demoUnitStats } from './selection.ts';
import type { SelectionDemoScenario } from './selection.ts';
import {
  DEMO_STALL_FLOW,
  DEMO_TIME_S,
  DEMO_TOOLTIPS,
  applyAlertEvents,
  applyEcoPreset,
  applyFlowDetailsPreset,
  applyMatchPreset,
  demoAlertEvent,
  demoConsumers,
} from './top.ts';

/** Team colour mode of the model (house, relation, cvd). */
type TeamColorMode = HudModel['teams']['value'];

/** Full-HUD scenarios (ui.md §12): the mockup screenshots plus the perf case of ui.md §9.3. */
export type HudScenarioId = 'vogt' | 'armee' | 'fabrik-stall' | 'fabrik' | 'pause-cvd' | 'dichtester-fall' | 'kompakt' | 'perf-500';

export const HUD_SCENARIO_IDS: readonly HudScenarioId[] = ['vogt', 'armee', 'fabrik-stall', 'fabrik', 'pause-cvd', 'dichtester-fall', 'kompakt', 'perf-500'];

/** Client-local UI state of a scenario (not part of the snapshot, written directly like the game would). */
export interface HudScenarioUi {
  readonly tooltip: TooltipTarget | null;
  readonly tooltipAnchor: TooltipAnchor;
  readonly detailsOpen: boolean;
  /** Team colour mode, null = leave the model's (gallery query) mode. */
  readonly teams: TeamColorMode | null;
  readonly minimapMode: MinimapMode;
  readonly showResources: boolean;
}

export interface HudScenario {
  readonly id: HudScenarioId;
  readonly seed: number;
  /** Own units (match counter and minimap). */
  readonly units: number;
  readonly speed: number;
  readonly paused: boolean;
  readonly ui: HudScenarioUi;
  /** Snapshot at tick 0. */
  readonly snapshot: HudSnapshot;
  /** Live minimap state the generator advances. */
  readonly minimap: MinimapDemo;
  /** Per-unit samples of a multi selection (the generator varies their HP), empty otherwise. */
  readonly samples: readonly MultiUnitSample[];
  /** Queue the factory restarts from once it ran empty (the demo factory never idles). */
  readonly baseQueue: FactoryQueueData | null;
}

export interface HudScenarioOptions {
  /** Own units (default 64, perf-500: 500). */
  readonly units?: number | undefined;
  /** Enemy entries on the minimap (default 48, perf-500: 300). */
  readonly enemy?: number | undefined;
  readonly seed?: number | undefined;
  /** false = the dock slot shows the map key figures (UI-E2). */
  readonly minimapAvailable?: boolean | undefined;
}

type AlertSpec = readonly [AlertType, number];

interface Recipe {
  readonly selection: SelectionDemoScenario;
  readonly card: 'vogt' | 'army' | 'landFactory' | 'edge';
  readonly eco: 'normal' | 'stall' | 'flowOpen' | 'flowStall' | 'flowStallPaused';
  /** Alert types with their age in seconds at DEMO_TIME_S (oldest first). */
  readonly alerts: readonly AlertSpec[];
  readonly activeGroup: number | null;
  readonly tooltip: TooltipTarget | null;
  readonly paused: boolean;
  readonly speed: number;
  readonly teams: TeamColorMode | null;
  readonly units: number;
  readonly enemy: number;
}

const ALERTS_VOGT: readonly AlertSpec[] = [
  ['enemyCommanderSpotted', 48],
  ['unitAttacked', 9],
  ['buildComplete', 3],
];
const ALERTS_ARMY: readonly AlertSpec[] = [
  ['enemyCommanderSpotted', 51],
  ['baseAttacked', 6],
  ['commanderDanger', 1],
];
const ALERTS_FACTORY: readonly AlertSpec[] = [
  ['buildComplete', 14],
  ['factoryUpgraded', 2],
];
const ALERTS_STALL: readonly AlertSpec[] = [...ALERTS_FACTORY, ['energyStall', 0]];
/** Densest case (mockup hud.html?sel=factory&stall=1&flow=1&paused=1): 3 visible + older ones. */
const ALERTS_DENSE: readonly AlertSpec[] = [['enemyCommanderSpotted', 40], ['unitAttacked', 25], ...ALERTS_STALL];
const ALERTS_PERF: readonly AlertSpec[] = [
  ['enemyCommanderSpotted', 48],
  ['baseAttacked', 12],
  ['unitAttacked', 9],
  ['buildComplete', 3],
  ['commanderDanger', 1],
];

const BOILER: TooltipTarget = DEMO_TOOLTIPS.boiler;
const PUNCH: TooltipTarget = DEMO_TOOLTIPS.punch;

const RECIPES: Readonly<Record<HudScenarioId, Recipe>> = {
  vogt: { selection: 'commander', card: 'vogt', eco: 'normal', alerts: ALERTS_VOGT, activeGroup: null, tooltip: BOILER, paused: false, speed: 1, teams: null, units: 64, enemy: 48 },
  armee: { selection: 'army', card: 'army', eco: 'normal', alerts: ALERTS_ARMY, activeGroup: 0, tooltip: null, paused: false, speed: 1, teams: null, units: 64, enemy: 48 },
  'fabrik-stall': { selection: 'factory', card: 'landFactory', eco: 'flowStall', alerts: ALERTS_STALL, activeGroup: 2, tooltip: PUNCH, paused: false, speed: 1, teams: null, units: 64, enemy: 48 },
  fabrik: { selection: 'factory', card: 'landFactory', eco: 'flowOpen', alerts: ALERTS_FACTORY, activeGroup: 2, tooltip: null, paused: false, speed: 1, teams: null, units: 64, enemy: 48 },
  'pause-cvd': { selection: 'army', card: 'army', eco: 'normal', alerts: ALERTS_ARMY, activeGroup: 0, tooltip: null, paused: true, speed: 1, teams: 'cvd', units: 64, enemy: 48 },
  'dichtester-fall': { selection: 'factoryRepeat', card: 'landFactory', eco: 'flowStallPaused', alerts: ALERTS_DENSE, activeGroup: 2, tooltip: PUNCH, paused: true, speed: 1, teams: null, units: 64, enemy: 48 },
  kompakt: { selection: 'army', card: 'army', eco: 'normal', alerts: ALERTS_ARMY, activeGroup: 0, tooltip: null, paused: false, speed: 2, teams: null, units: 64, enemy: 48 },
  'perf-500': { selection: 'edge', card: 'edge', eco: 'flowOpen', alerts: ALERTS_PERF, activeGroup: 0, tooltip: null, paused: false, speed: 1, teams: null, units: 500, enemy: 300 },
};

/** Queue counts (badges) of a factory queue: the item in production plus all queued blocks. */
export function queueCountsOf(q: FactoryQueueData | null): Readonly<Record<string, number>> {
  const out: Record<string, number> = {};
  if (q === null) return out;
  if (q.current !== null) out[q.current.typeId] = 1;
  for (const b of q.blocks) out[b.typeId] = (out[b.typeId] ?? 0) + b.count;
  return out;
}

function applyEco(model: HudModel, eco: Recipe['eco']): void {
  if (eco === 'normal') {
    applyFlowDetailsPreset(model, 'closed');
    applyEcoPreset(model, 'normal');
  } else if (eco === 'stall') {
    applyFlowDetailsPreset(model, 'closed');
    applyEcoPreset(model, 'stall');
  } else if (eco === 'flowOpen') {
    applyFlowDetailsPreset(model, 'open');
  } else {
    applyFlowDetailsPreset(model, 'bottleneck');
    applyEcoPreset(model, 'stall');
    // flowStallPaused: the Zapfstelle upgrade (consumer 4) is paused like in the mockup's densest case.
    model.eco.consumers.value = demoConsumers(DEMO_STALL_FLOW, eco === 'flowStallPaused' ? [4] : []);
  }
}

function applyCard(model: HudModel, card: Recipe['card']): void {
  if (card === 'edge') {
    const edge = demoEdgeSelection();
    batch(() => {
      model.card.selectedTypes.value = edge.multi.groups.map((g) => g.typeId);
      model.card.unitCount.value = edge.multi.total;
      model.card.tab.value = null;
      model.card.queueCounts.value = {};
      model.card.progress.value = {};
      model.card.capReached.value = false;
      model.card.buildPower.value = null;
      model.orders.states.value = BUILDER_ORDERS;
      model.orders.selfDestructCountdown.value = null;
    });
    return;
  }
  applyCardDemo(model, card);
  if (card === 'army') model.orders.states.value = { ...ARMY_ORDERS, attack: { enabled: true, armed: true } };
  if (card === 'vogt') model.orders.states.value = BUILDER_ORDERS;
  if (card === 'landFactory') model.orders.states.value = FACTORY_ORDERS;
}

function minimapSnapshot(demo: MinimapDemo, available: boolean): MinimapSnapshot {
  return {
    version: 1,
    mapName: DEMO_MAP_NAME,
    mapSizeWu: demo.mapSizeWu,
    terrain: demo.terrain,
    spots: demo.spots,
    available,
    units: demo.units(),
    pings: demo.pings(),
    fog: demo.fog(),
    camera: demo.camera(),
  };
}

/** Builds a full-HUD scenario (deterministic for a seed). */
export function createHudScenario(id: HudScenarioId, opts: HudScenarioOptions = {}): HudScenario {
  const r = RECIPES[id];
  const seed = opts.seed ?? DEMO_SEED;
  const units = opts.units ?? r.units;
  const enemy = opts.enemy ?? r.enemy;
  const model = createHudModel({ units: demoUnitCatalog() });
  let samples: readonly MultiUnitSample[] = [];
  batch(() => {
    applyMatchPreset(model, 'normal');
    model.match.units.value = units;
    model.match.unitCap.value = units > 450 ? 1000 : 500;
    applySelectionDemo(model, r.selection);
    applyEco(model, r.eco);
    applyCard(model, r.card);
    applyStripDemo(model, { active: r.activeGroup, idle: 2, idleFactories: 1 });
    applyAlertEvents(
      model,
      r.alerts.map(([type, age]) => demoAlertEvent(type, DEMO_TIME_S - age)),
      DEMO_TIME_S,
      r.alerts.length > 3 ? 2 : 0,
    );
    if (r.paused) model.match.pause.value = 'user';
  });
  if (r.selection === 'army') samples = demoArmySelection().samples;
  if (r.selection === 'edge') samples = demoEdgeSelection().samples;
  const queue = model.factory.queue.peek();
  if (queue !== null) model.card.queueCounts.value = queueCountsOf(queue);
  const minimap = createMinimapDemo({ seed: seed ^ 0x5a5a, own: units, enemy });
  for (const a of model.alerts.items.peek()) {
    if (a.location !== null) minimap.addPing(a.location.x, a.location.z, a.lastAtS, ALERT_DEFS[a.type].level);
  }
  const base = captureSnapshot(model, 0, { eco: 1, alerts: 1, selection: 1, factory: 1, card: 1, orders: 1, strip: 1, minimap: 1 });
  const snapshot: HudSnapshot = { ...base, minimap: minimapSnapshot(minimap, opts.minimapAvailable ?? true) };
  return {
    id,
    seed,
    units,
    speed: r.speed,
    paused: r.paused,
    ui: {
      tooltip: r.tooltip,
      tooltipAnchor: { kind: 'card' },
      detailsOpen: model.eco.detailsOpen.peek(),
      teams: r.teams,
      minimapMode: 'terrain',
      showResources: true,
    },
    snapshot,
    minimap,
    samples,
    baseQueue: queue,
  };
}

/** Writes the client-local UI state of a scenario (tooltip shown at once, flow details, team mode, minimap). */
export function applyHudScenarioUi(model: HudModel, scenario: HudScenario): void {
  const ui = scenario.ui;
  batch(() => {
    model.eco.detailsOpen.value = ui.detailsOpen;
    if (ui.teams !== null) model.teams.value = ui.teams;
    model.minimap.mode.value = ui.minimapMode;
    model.minimap.showResources.value = ui.showResources;
    model.card.tab.value = null;
    model.card.armedSlot.value = null;
    model.card.placingTypeId.value = null;
    model.tooltip.anchor.value = ui.tooltipAnchor;
    model.tooltip.viaKeyboard.value = true;
    model.tooltip.target.value = ui.tooltip;
  });
}

// ---------------------------------------------------------------------------------------------------------
// SnapshotGenerator

export interface SnapshotGenerator {
  /** Current sim tick (0 = the scenario snapshot). */
  readonly tick: number;
  /** Snapshot of the current tick. */
  current(): HudSnapshot;
  /** Advances one sim tick (0.1 s) and returns its snapshot. */
  next(): HudSnapshot;
}

/** Sim seconds per tick (10 Hz sim). */
export const SIM_TICK_S = 0.1;

/** Alerts the generator raises in turn (every ALERT_EVERY_TICKS). */
const ALERT_ROTATION: readonly AlertType[] = ['unitAttacked', 'buildComplete', 'baseAttacked', 'enemyAir', 'unitAttacked', 'enemyCommanderSpotted', 'buildComplete'];
export const ALERT_EVERY_TICKS = 150;

function jitterResource(r: ResourceSnapshot, base: { income: number; demand: number }, rng: Rng, tick: number, stall: boolean): ResourceSnapshot {
  const income = base.income * range(rng, 0.97, 1.03);
  if (stall) {
    const demand = base.demand * (1 + 0.02 * Math.sin(tick / 23));
    return { ...r, stored: 0, income, demand, served: income, flow: income / demand };
  }
  // Demand drifts ±12 % so the storage fills and drains instead of pinning at a bound.
  const demand = base.demand * (1 + 0.12 * Math.sin(tick / 90));
  let stored = r.stored + (income - demand) * SIM_TICK_S;
  stored = stored < 0 ? 0 : stored > r.capacity ? r.capacity : stored;
  const starving = stored <= 0 && demand > income;
  const flow = starving ? income / demand : 1;
  return { ...r, stored, income, demand, served: demand * flow, flow };
}

/**
 * Share of the selected units whose HP changes per tick. Heavy battle: 60 units under fire from a similar
 * army that shoots every 1–3 s take ≈ 20–60 hits per second, i.e. 2–6 per 0.1-s tick (≈ 3–10 %); 5 % sits in
 * the middle. Units out of combat keep their HP (frame HP is u8, unchanged values are not re-sent).
 */
export const COMBAT_SHARE = 0.05;

/** HP as the frame transports it (UnitRecord hp u8, PLAN §3.6): 1/255 steps. */
export function quantizeHp(fraction: number): number {
  return Math.round(fraction * 255) / 255;
}

function stepSingle(d: UnitDetailData, rng: Rng): UnitDetailData {
  const frac = quantizeHp((d.hp + d.hpMax * range(rng, -0.004, 0.003)) / d.hpMax);
  const hp = Math.max(d.hpMax * 0.2, Math.min(d.hpMax, frac * d.hpMax));
  const first = d.orders[0];
  let orders = d.orders;
  if (first !== undefined && first.progress !== undefined) {
    const p = first.progress + 0.012;
    orders = [{ ...first, progress: p >= 1 ? 0 : p }, ...d.orders.slice(1)];
  }
  const vet = d.vet.progress < 1 ? { ...d.vet, progress: Math.min(1, d.vet.progress + 0.0005) } : d.vet;
  const tapshot = d.tapshot !== null ? { ...d.tapshot, stored: Math.min(d.tapshot.threshold, d.tapshot.stored + 3) } : null;
  return { ...d, hp: Math.round(hp), orders, vet, tapshot };
}

/**
 * Seeded snapshot stream of a scenario: every call of next() is one sim tick. Unchanged sections keep their
 * references; event sections bump their version when their structure changes (factory completes an item,
 * alert raised or expired).
 */
export function createSnapshotGenerator(scenario: HudScenario, seed: number = scenario.seed): SnapshotGenerator {
  const rng = createDemoRng(seed ^ 0x9e3779b9);
  let snap = scenario.snapshot;
  let tick = 0;
  const base = {
    mass: { income: snap.eco.mass.income, demand: snap.eco.mass.demand },
    energy: { income: snap.eco.energy.income, demand: snap.eco.energy.demand },
  };
  const stall = { mass: snap.eco.mass.flow < 1, energy: snap.eco.energy.flow < 1 };
  const samples: { -readonly [K in keyof MultiUnitSample]: MultiUnitSample[K] }[] = scenario.samples.map((s) => ({ ...s, hp: quantizeHp(s.hp) }));
  let stats: MultiStats | null = snap.selection.multiStats;
  const baseConsumers: readonly FlowConsumer[] = snap.eco.consumers;
  let alertTurn = 0;
  let camT = 0;

  const next = (): HudSnapshot => {
    tick++;
    const timeS = snap.timeS + SIM_TICK_S;
    const prev = snap;

    // Economy (10 Hz).
    const mass = jitterResource(prev.eco.mass, base.mass, rng, tick, stall.mass);
    const energy = jitterResource(prev.eco.energy, base.energy, rng, tick, stall.energy);
    // Consumers receive flow × request (exactly their request without a bottleneck); refreshed every 5 ticks.
    let consumers = prev.eco.consumers;
    if (tick % 5 === 0 && baseConsumers.length > 0) {
      const f = Math.round(Math.min(mass.flow, energy.flow, 1) * 100) / 100;
      consumers = baseConsumers.map((c) => (c.paused ? c : { ...c, massGot: c.massReq * f, energyGot: c.energyReq * f }));
    }
    const eco = { ...prev.eco, mass, energy, consumers };

    // Selection hot values (4 Hz in the model; they change every tick here).
    let selection = prev.selection;
    if (selection.single !== null) selection = { ...selection, single: stepSingle(selection.single, rng) };
    if (selection.multi !== null && samples.length > 0) {
      // Like the frame's u8 HP: COMBAT_SHARE of the units is hit or repaired each tick, the rest keeps its value.
      const hits = Math.max(1, Math.round(samples.length * COMBAT_SHARE));
      for (let h = 0; h < hits; h++) {
        const s = samples[Math.floor(rng() * samples.length)]!;
        const hp = s.hp + (rng() < 0.7 ? -range(rng, 0.01, 0.05) : range(rng, 0.01, 0.04));
        s.hp = quantizeHp(hp < 0.08 ? 0.08 : hp > 1 ? 1 : hp);
      }
      stats = aggregateMultiStats(selection.multi.groups, selection.multi.units.length, samples, stats ?? undefined);
      selection = { ...selection, multiStats: stats };
    }

    // Factory progress (10 Hz) and queue events.
    let factory = prev.factory;
    let card = prev.card;
    const q = factory.queue;
    const d = factory.detail;
    if (q !== null && d !== null && q.current !== null && !q.paused) {
      const bp = d.bpOwn + d.bpAssist;
      const total = buildTimeS(demoUnitCatalog(), q.current.typeId, bp);
      const f = Math.min(mass.flow, energy.flow);
      let progress = factory.progress + (Number.isFinite(total) && total > 0 ? (SIM_TICK_S * f) / total : 0);
      let queue: FactoryQueueData = q;
      let version = factory.version;
      if (progress >= 1) {
        progress -= 1;
        const blocks = q.blocks.slice();
        const head = blocks[0];
        let current = q.current;
        if (head !== undefined) {
          current = { typeId: head.typeId };
          if (head.count > 1) blocks[0] = { ...head, count: head.count - 1 };
          else blocks.shift();
          if (q.repeat) blocks.push({ typeId: q.current.typeId, count: 1 });
        } else if (scenario.baseQueue !== null) {
          queue = scenario.baseQueue;
        }
        queue = head !== undefined ? { ...q, current, blocks } : queue;
        version++;
      }
      const remainingS = Number.isFinite(total) ? (total * (1 - progress)) / (f > 0 ? f : 1) : 0;
      factory = { ...factory, version, queue, progress, remainingS };
      const curType = queue.current?.typeId;
      card = {
        ...card,
        version: version !== prev.factory.version ? card.version + 1 : card.version,
        queueCounts: version !== prev.factory.version ? queueCountsOf(queue) : card.queueCounts,
        progress: curType !== undefined ? { [curType]: progress } : {},
      };
    }

    // Alerts: one every 15 s from a rotation; expired ones drop out (60 s).
    let alerts = prev.alerts;
    const demo = scenario.minimap;
    if (tick % ALERT_EVERY_TICKS === 0) {
      const type = ALERT_ROTATION[alertTurn % ALERT_ROTATION.length]!;
      alertTurn++;
      const ev: AlertEvent = demoAlertEvent(type, timeS);
      const r = mergeAlert(alerts.items, ev, alerts.nextId);
      alerts = { version: alerts.version + 1, items: r.items, historyCount: alerts.historyCount, nextId: r.merged ? alerts.nextId : r.id + 1 };
      if (ev.location) demo.addPing(ev.location.x, ev.location.z, timeS, ALERT_DEFS[type].level);
    }
    if (tick % 10 === 0) {
      const pr = pruneAlerts(alerts.items, timeS);
      if (pr.removed > 0) alerts = { ...alerts, version: alerts.version + 1, items: pr.items, historyCount: alerts.historyCount + pr.removed };
    }

    // Match + strip counters (1 Hz in the model).
    let units = prev.match.units;
    if (tick % 40 === 0) units = Math.max(1, Math.min(prev.match.unitCap, units + (rng() < 0.5 ? -1 : 1)));
    const match = { ...prev.match, timeS, units };
    let strip = prev.strip;
    if (tick % 70 === 0) strip = { ...strip, idleEngineers: Math.max(0, strip.idleEngineers + (rng() < 0.5 ? -1 : 1)) };

    // Minimap: units move every tick, fog every 5 ticks, camera pans slowly.
    demo.step(timeS, 5);
    if (tick % 4 === 0) {
      camT += 0.02;
      const s = demo.mapSizeWu;
      demo.moveCamera(s * (0.34 + 0.06 * Math.sin(camT)), s * (0.66 + 0.04 * Math.cos(camT * 0.7)));
    }
    const mm = prev.minimap;
    const minimap: MinimapSnapshot = { ...mm, units: demo.units(), fog: demo.fog(), pings: demo.pings(), camera: demo.camera() };

    snap = { tick, timeS, eco, match, alerts, selection, factory, card, orders: prev.orders, strip, minimap };
    return snap;
  };

  return {
    get tick() {
      return tick;
    },
    current: () => snap,
    next,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Demo driver (gallery): scheduler + generator on a timer

export interface HudDemoDriver {
  readonly scenario: HudScenario;
  readonly scheduler: HudScheduler;
  readonly generator: SnapshotGenerator;
  /** Advances one sim tick by hand (no-op while paused, but still pushes the events). */
  step(): void;
  stop(): void;
}

export interface HudDemoOptions {
  /** Start the 10 Hz timer (default true); false = drive with step(). */
  readonly autoStart?: boolean | undefined;
  readonly scheduler?: HudSchedulerOptions | undefined;
}

/**
 * Wires a scenario to a model: client-local UI state, a HudScheduler (first snapshot written at once) and a
 * timer that pushes one generated snapshot per sim tick (every 100 ms / speed). While the scenario is paused
 * only the unchanged snapshot is pushed (events only), exactly like a paused sim.
 */
export function startHudDemo(model: HudModel, scenario: HudScenario, opts: HudDemoOptions = {}): HudDemoDriver {
  applyHudScenarioUi(model, scenario);
  const scheduler = new HudScheduler(model, opts.scheduler);
  const generator = createSnapshotGenerator(scenario);
  scheduler.push(generator.current(), 0, scenario.speed, scenario.paused);
  scheduler.flush();
  const step = (): void => {
    const s = scenario.paused ? generator.current() : generator.next();
    scheduler.push(s, generator.tick, scenario.speed, scenario.paused);
  };
  let timer: ReturnType<typeof setInterval> | null = null;
  if (opts.autoStart !== false) timer = setInterval(step, 100 / scenario.speed);
  return {
    scenario,
    scheduler,
    generator,
    step,
    stop: () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
      scheduler.dispose();
    },
  };
}

/** Writes a scenario into a model at once (tests, static previews): UI state + the tick-0 snapshot. */
export function applyHudScenario(model: HudModel, scenario: HudScenario): void {
  applyHudScenarioUi(model, scenario);
  const scheduler = new HudScheduler(model, { measure: false, requestFrame: () => undefined });
  scheduler.push(scenario.snapshot, 0, scenario.speed, scenario.paused);
  scheduler.flush();
  scheduler.dispose();
}

/** Own-unit samples for a multi selection of `total` units (perf helper, deterministic). */
export function demoUnitSamples(typeIds: readonly string[], total: number, seed: number = DEMO_SEED): MultiUnitSample[] {
  const rng = createDemoRng(seed);
  const out: MultiUnitSample[] = [];
  for (let i = 0; i < total; i++) {
    const typeId = typeIds[i % typeIds.length]!;
    const s = demoUnitStats(typeId);
    out.push({ typeId, hp: range(rng, 0.3, 1), vet: i % 3, dps: s.dps, mass: s.mass, speed: s.speed });
  }
  return out;
}
