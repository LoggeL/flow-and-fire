import type { AlertItem, AlertsSection } from './alerts.ts';
import type { CardSection } from './card.ts';
import type { EcoSection, FlowConsumer, FlowConsumerKind, IncomeEntry, ResourceSignals, StorageEntry } from './eco.ts';
import type { FactoryDetailData, FactoryQueueData, FactorySection } from './factory.ts';
import type { MinimapFog, MinimapPing, MinimapSection, MinimapSpot, MinimapTerrain, MinimapUnits } from './minimap.ts';
import type { OrderStates, OrdersSection } from './orders.ts';
import type { MultiSelectionData, MultiStats, SelectionKind, SelectionSection, UnitDetailData } from './selection.ts';
import type { MatchScores, MatchSection } from './status.ts';
import type { ControlGroupData, StripSection } from './strip.ts';

/**
 * HudSnapshot: plain data the game hands to the HudScheduler once per sim tick (PLAN §3.6 frame sections
 * Eco, Watch, Intents → HudModel, ui.md §9.1). The scheduler diffs it against the model and writes the
 * signals at fixed wall-clock rates; nothing here is a signal.
 *
 * Rate classes (see src/scheduler): 10 Hz economy + progress, 4 Hz HP/vet/order chain/toggles/minimap units,
 * 2 Hz fog, 1 Hz timer/cap/idle/groups; event sections carry a `version` counter and are written at once
 * (on the next flush, also while paused) whenever it changes – together with their hot values, so a new
 * structure never shows stale numbers.
 *
 * Producer rules:
 * - Keep references of unchanged sub-objects (the diff is cheap on identical references).
 * - Bump the section `version` on every structural change (new selection, queue edit, alert, …).
 * - Objects holding typed arrays that are refilled in place (minimap units/fog, multi stats) are compared by
 *   reference only: publish a new wrapper object when their content changed.
 * - Client-local UI state (flow details open, tooltip, tech tab, placement, minimap mode/resources) is not
 *   part of the snapshot; the game writes those signals directly on the input event.
 */

export interface ResourceSnapshot {
  readonly stored: number;
  readonly capacity: number;
  readonly income: number;
  readonly demand: number;
  readonly served: number;
  readonly flow: number;
  /** 4 Hz (resource tooltip). */
  readonly incomeBySource: readonly IncomeEntry[];
  /** 4 Hz (resource tooltip). */
  readonly storageByBuilding: readonly StorageEntry[];
}

export interface EcoSnapshot {
  /** Bumped when `interactive` or `stallPriority` change. */
  readonly version: number;
  readonly mass: ResourceSnapshot;
  readonly energy: ResourceSnapshot;
  /** Largest consumers; written at 4 Hz and only while the flow details are open. */
  readonly consumers: readonly FlowConsumer[];
  readonly stallPriority: readonly FlowConsumerKind[];
  /** Pause buttons in the flow details are live (E13). */
  readonly interactive: boolean;
}

export interface MatchSnapshot {
  /** Sim time in seconds (1 Hz). */
  readonly timeS: number;
  /** Own units (1 Hz). */
  readonly units: number;
  readonly unitCap: number;
  /** Effective speed while the sim lags, null when on time (banner: event). */
  readonly simLag: number | null;
  /** WebGL context lost (banner: event). */
  readonly contextLost: boolean;
  /** Replay scores (1 Hz), null outside replays. */
  readonly scores: MatchScores | null;
  readonly replay: boolean;
  /** Why the sim stands still when `push(…, paused = true)`: the P key or a hidden tab (S9). */
  readonly pauseReason: 'user' | 'background';
}

export interface AlertsSnapshot {
  /** Bumped on every new, merged or expired alert. */
  readonly version: number;
  /** Active alerts, newest first (merging/pruning is done by the producer, see model/alerts.ts). */
  readonly items: readonly AlertItem[];
  readonly historyCount: number;
  readonly nextId: number;
}

export interface SelectionSnapshot {
  /** Bumped on every selection event (structure: kind, multi, focus, head). */
  readonly version: number;
  readonly kind: SelectionKind;
  readonly multi: MultiSelectionData | null;
  readonly focusTypeId: string | null;
  readonly groupLabel: string | null;
  readonly controlGroup: number | null;
  /** Single unit incl. HP/vet/order chain (4 Hz). */
  readonly single: UnitDetailData | null;
  /** Hot multi-selection values (4 Hz, compared by reference). */
  readonly multiStats: MultiStats | null;
}

export interface FactorySnapshot {
  /** Bumped on selection and queue events. */
  readonly version: number;
  /** Factory detail (structure on events, HP at 4 Hz). */
  readonly detail: FactoryDetailData | null;
  readonly queue: FactoryQueueData | null;
  /** 10 Hz. */
  readonly progress: number;
  /** 10 Hz. */
  readonly remainingS: number;
}

export interface CardSnapshot {
  /** Bumped on selection events, cap changes and queue edits (badges). */
  readonly version: number;
  readonly selectedTypes: readonly string[];
  readonly unitCount: number;
  readonly capReached: boolean;
  readonly buildPower: number | null;
  readonly queueCounts: Readonly<Record<string, number>>;
  /** Production progress per type id (10 Hz). */
  readonly progress: Readonly<Record<string, number>>;
}

export interface OrdersSnapshot {
  /** Bumped on selection events and when an order is armed/released. */
  readonly version: number;
  /** Toggle/cycle states (4 Hz). */
  readonly states: OrderStates;
  /** Self-destruct countdown in seconds (4 Hz), null when idle. */
  readonly selfDestructCountdown: number | null;
}

export interface StripSnapshot {
  /** Bumped when a group is saved/recalled (active group, group icons). */
  readonly version: number;
  /** Ten groups (counts at 1 Hz). */
  readonly groups: readonly ControlGroupData[];
  readonly activeGroup: number | null;
  /** 1 Hz. */
  readonly idleEngineers: number;
  /** 1 Hz. */
  readonly idleFactories: number;
}

export interface MinimapSnapshot {
  /** Bumped when map, terrain, spots or availability change. */
  readonly version: number;
  readonly mapName: string;
  readonly mapSizeWu: number;
  readonly terrain: MinimapTerrain | null;
  readonly spots: readonly MinimapSpot[];
  readonly available: boolean;
  /** Units, blips, ghosts (4 Hz, compared by reference). */
  readonly units: MinimapUnits;
  /** Alert pings (4 Hz). */
  readonly pings: readonly MinimapPing[];
  /** Fog cells (2 Hz, compared by reference). */
  readonly fog: MinimapFog | null;
  /**
   * Camera trapezoid in world units; written whenever it changes (also while paused). Omit it when the game
   * writes `model.minimap.camera` itself on camera movement.
   */
  readonly camera?: readonly (readonly [number, number])[] | undefined;
}

export interface HudSnapshot {
  /** Sim tick the snapshot belongs to. */
  readonly tick: number;
  /** Sim time in seconds at that tick. */
  readonly timeS: number;
  readonly eco: EcoSnapshot;
  readonly match: MatchSnapshot;
  readonly alerts: AlertsSnapshot;
  readonly selection: SelectionSnapshot;
  readonly factory: FactorySnapshot;
  readonly card: CardSnapshot;
  readonly orders: OrdersSnapshot;
  readonly strip: StripSnapshot;
  readonly minimap: MinimapSnapshot;
}

/** Section names of a snapshot (for statistics and tests). */
export const SNAPSHOT_SECTIONS = ['eco', 'match', 'alerts', 'selection', 'factory', 'card', 'orders', 'strip', 'minimap'] as const;
export type SnapshotSection = (typeof SNAPSHOT_SECTIONS)[number];

/** Version counters of the event sections, e.g. from the previous snapshot of a producer. */
export type SnapshotVersions = Readonly<Record<Exclude<SnapshotSection, 'match'>, number>>;

export const ZERO_VERSIONS: SnapshotVersions = { eco: 0, alerts: 0, selection: 0, factory: 0, card: 0, orders: 0, strip: 0, minimap: 0 };

/** The model sections a snapshot maps onto (HudModel satisfies it; kept structural to avoid an import cycle). */
export interface SnapshotTarget {
  readonly eco: EcoSection;
  readonly match: MatchSection;
  readonly alerts: AlertsSection;
  readonly selection: SelectionSection;
  readonly factory: FactorySection;
  readonly card: CardSection;
  readonly orders: OrdersSection;
  readonly strip: StripSection;
  readonly minimap: MinimapSection;
}

function resourceOf(r: ResourceSignals): ResourceSnapshot {
  return {
    stored: r.stored.peek(),
    capacity: r.capacity.peek(),
    income: r.income.peek(),
    demand: r.demand.peek(),
    served: r.served.peek(),
    flow: r.flow.peek(),
    incomeBySource: r.incomeBySource.peek(),
    storageByBuilding: r.storageByBuilding.peek(),
  };
}

/**
 * Reads the current model into a snapshot (without subscribing). Used to turn the per-group demo presets
 * into full-HUD scenarios and by tests; the game builds snapshots from frame sections instead.
 */
export function captureSnapshot(model: SnapshotTarget, tick: number, versions: SnapshotVersions = ZERO_VERSIONS): HudSnapshot {
  const m = model.match;
  const mm = model.minimap;
  const camera = mm.camera.peek();
  return {
    tick,
    timeS: m.timeS.peek(),
    eco: {
      version: versions.eco,
      mass: resourceOf(model.eco.mass),
      energy: resourceOf(model.eco.energy),
      consumers: model.eco.consumers.peek(),
      stallPriority: model.eco.stallPriority.peek(),
      interactive: model.eco.interactive.peek(),
    },
    match: {
      timeS: m.timeS.peek(),
      units: m.units.peek(),
      unitCap: m.unitCap.peek(),
      simLag: m.simLag.peek(),
      contextLost: m.contextLost.peek(),
      scores: m.scores.peek(),
      replay: m.replay.peek(),
      pauseReason: m.pause.peek() === 'background' ? 'background' : 'user',
    },
    alerts: {
      version: versions.alerts,
      items: model.alerts.items.peek(),
      historyCount: model.alerts.historyCount.peek(),
      nextId: model.alerts.nextId.peek(),
    },
    selection: {
      version: versions.selection,
      kind: model.selection.kind.peek(),
      multi: model.selection.multi.peek(),
      focusTypeId: model.selection.focusTypeId.peek(),
      groupLabel: model.selection.groupLabel.peek(),
      controlGroup: model.selection.controlGroup.peek(),
      single: model.selection.single.peek(),
      multiStats: model.selection.multiStats.peek(),
    },
    factory: {
      version: versions.factory,
      detail: model.factory.detail.peek(),
      queue: model.factory.queue.peek(),
      progress: model.factory.progress.peek(),
      remainingS: model.factory.remainingS.peek(),
    },
    card: {
      version: versions.card,
      selectedTypes: model.card.selectedTypes.peek(),
      unitCount: model.card.unitCount.peek(),
      capReached: model.card.capReached.peek(),
      buildPower: model.card.buildPower.peek(),
      queueCounts: model.card.queueCounts.peek(),
      progress: model.card.progress.peek(),
    },
    orders: {
      version: versions.orders,
      states: model.orders.states.peek(),
      selfDestructCountdown: model.orders.selfDestructCountdown.peek(),
    },
    strip: {
      version: versions.strip,
      groups: model.strip.groups.peek(),
      activeGroup: model.strip.activeGroup.peek(),
      idleEngineers: model.strip.idleEngineers.peek(),
      idleFactories: model.strip.idleFactories.peek(),
    },
    minimap: {
      version: versions.minimap,
      mapName: mm.mapName.peek(),
      mapSizeWu: mm.mapSizeWu.peek(),
      terrain: mm.terrain.peek(),
      spots: mm.spots.peek(),
      available: mm.available.peek(),
      units: mm.units.peek(),
      pings: mm.pings.peek(),
      fog: mm.fog.peek(),
      ...(camera.length > 0 ? { camera } : {}),
    },
  };
}

/** Version counters of a snapshot. */
export function snapshotVersions(s: HudSnapshot): SnapshotVersions {
  return {
    eco: s.eco.version,
    alerts: s.alerts.version,
    selection: s.selection.version,
    factory: s.factory.version,
    card: s.card.version,
    orders: s.orders.version,
    strip: s.strip.version,
    minimap: s.minimap.version,
  };
}
