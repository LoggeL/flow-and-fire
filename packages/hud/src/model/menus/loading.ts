import { signal } from '@preact/signals';
import type { Signal } from '@preact/signals';
import type { MapPreviewSpec, SlotAi, SlotController, VictoryCondition } from './skirmish.ts';

/**
 * Loading screen (ui.md §5.15, P3): map name, description, rules, both houses with a readiness badge,
 * map preview with starts; five phases with their own bars, current file with source, bytes, total bar,
 * hint line; error state with cause, retry and back to menu. Data shape follows apps/game/src/loading.ts.
 */

export type LoadingPhaseId = 'manifest' | 'assets' | 'map' | 'simWorker' | 'aiWorker';
export const LOADING_PHASE_IDS: readonly LoadingPhaseId[] = ['manifest', 'assets', 'map', 'simWorker', 'aiWorker'];

export type LoadingPhaseState = 'pending' | 'active' | 'done' | 'error';

export interface LoadingPhase {
  readonly id: LoadingPhaseId;
  /** 0..1 */
  readonly progress: number;
  readonly state: LoadingPhaseState;
}

export interface LoadingFile {
  /** Logical asset id / path. */
  readonly path: string;
  readonly source: 'cache' | 'network';
}

export interface LoadingBytes {
  readonly loaded: number;
  readonly total: number;
}

export interface LoadingCounts {
  /** Assets served from the Cache API / the network so far. */
  readonly cache: number;
  readonly network: number;
}

export type HouseReadiness = 'ready' | 'starting' | 'waiting' | 'error';

export interface LoadingHouse {
  /** House name without "Haus". */
  readonly name: string;
  readonly controller: SlotController;
  /** House colour token (e.g. "team-blau"). */
  readonly color: string;
  /** Start index (0-based). */
  readonly start: number;
  readonly ai: SlotAi | null;
  readonly readiness: HouseReadiness;
}

export interface LoadingRules {
  readonly victory: VictoryCondition;
  readonly unitCap: number;
  readonly seed: number;
}

export interface LoadingSection {
  readonly mapName: Signal<string>;
  /** i18n key or literal text. */
  readonly mapDescription: Signal<string>;
  readonly mapSizeWu: Signal<number>;
  readonly preview: Signal<MapPreviewSpec | null>;
  readonly startPositions: Signal<readonly (readonly [number, number])[]>;
  readonly rules: Signal<LoadingRules>;
  readonly houses: Signal<readonly LoadingHouse[]>;
  readonly phases: Signal<readonly LoadingPhase[]>;
  readonly currentFile: Signal<LoadingFile | null>;
  readonly bytes: Signal<LoadingBytes>;
  readonly counts: Signal<LoadingCounts>;
  /** Error cause (already human readable, e.g. "tex/…ktx2: HTTP 404"), null while loading works. */
  readonly error: Signal<string | null>;
  /** Index into the hint list (rotated by the game). */
  readonly hintIndex: Signal<number>;
  readonly build: Signal<string>;
}

export function initialPhases(): readonly LoadingPhase[] {
  return LOADING_PHASE_IDS.map((id) => ({ id, progress: 0, state: 'pending' as const }));
}

export function createLoadingSection(): LoadingSection {
  return {
    mapName: signal(''),
    mapDescription: signal(''),
    mapSizeWu: signal(0),
    preview: signal<MapPreviewSpec | null>(null),
    startPositions: signal<readonly (readonly [number, number])[]>([]),
    rules: signal<LoadingRules>({ victory: 'assassination', unitCap: 500, seed: 1 }),
    houses: signal<readonly LoadingHouse[]>([]),
    phases: signal(initialPhases()),
    currentFile: signal<LoadingFile | null>(null),
    bytes: signal<LoadingBytes>({ loaded: 0, total: 0 }),
    counts: signal<LoadingCounts>({ cache: 0, network: 0 }),
    error: signal<string | null>(null),
    hintIndex: signal(0),
    build: signal(''),
  };
}

/** Share of each phase in the total bar (asset bytes dominate, like apps/game/src/loading.ts: 0–90 % = bytes). */
export const PHASE_WEIGHTS: Readonly<Record<LoadingPhaseId, number>> = {
  manifest: 0.02,
  assets: 0.86,
  map: 0.05,
  simWorker: 0.04,
  aiWorker: 0.03,
};

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

/** Total progress 0..1 (done phases count fully). */
export function overallProgress(phases: readonly LoadingPhase[]): number {
  let sum = 0;
  for (const p of phases) sum += PHASE_WEIGHTS[p.id] * (p.state === 'done' ? 1 : clamp01(p.progress));
  return clamp01(Math.round(sum * 10_000) / 10_000);
}

/** The phase to describe: the failed one, else the first active, else the first pending; null when all are done. */
export function currentPhase(phases: readonly LoadingPhase[]): LoadingPhase | null {
  return (
    phases.find((p) => p.state === 'error') ??
    phases.find((p) => p.state === 'active') ??
    phases.find((p) => p.state === 'pending') ??
    null
  );
}

/** Phase list with one phase replaced (others keep their state). */
export function withPhase(phases: readonly LoadingPhase[], id: LoadingPhaseId, patch: Partial<Omit<LoadingPhase, 'id'>>): readonly LoadingPhase[] {
  return phases.map((p) => (p.id === id ? { ...p, ...patch } : p));
}

/** Structural shape of apps/game/src/loading.ts LoadState (no import: @faf/hud never imports the game). */
export interface GameLoadStateLike {
  readonly phase: 'manifest' | 'assets' | 'sim' | 'ready' | 'error';
  readonly asset: string | null;
  readonly source: 'cache' | 'network' | null;
  readonly bytesLoaded: number;
  readonly bytesTotal: number;
  readonly fromCache: number;
  readonly fromNetwork: number;
  readonly message: string | null;
}

export interface WorkerReadiness {
  /** Sim worker answered `ready`. */
  readonly simWorker: boolean;
  /** AI worker started (null = no AI in this match: phase counts as done). */
  readonly aiWorker: boolean | null;
}

/**
 * Maps the game's loading state (+ worker readiness) onto the five phases of the screen. The game phase
 * "sim" covers map → sim and the sim-worker start; the AI worker phase follows the sim.
 */
export function phasesFromGameState(s: GameLoadStateLike, workers: WorkerReadiness): readonly LoadingPhase[] {
  const order: readonly LoadingPhaseId[] = LOADING_PHASE_IDS;
  const bytes = s.bytesTotal > 0 ? clamp01(s.bytesLoaded / s.bytesTotal) : 0;
  const reached: Readonly<Record<GameLoadStateLike['phase'], number>> = { manifest: 0, assets: 1, sim: 2, ready: 3, error: -1 };
  let active = reached[s.phase];
  if (s.phase === 'sim' && workers.simWorker) active = 3;
  if (s.phase === 'ready') active = workers.simWorker ? (workers.aiWorker === false ? 4 : 5) : 3;
  if (s.phase === 'error') {
    // Error: everything before the first incomplete phase is done, that phase failed.
    const failedAt = s.bytesTotal > 0 && bytes < 1 ? 1 : s.bytesTotal === 0 ? 0 : 2;
    return order.map((id, i) => ({
      id,
      progress: i < failedAt ? 1 : i === failedAt && id === 'assets' ? bytes : 0,
      state: i < failedAt ? ('done' as const) : i === failedAt ? ('error' as const) : ('pending' as const),
    }));
  }
  return order.map((id, i) => {
    if (id === 'aiWorker' && workers.aiWorker === null) return { id, progress: 1, state: 'done' as const };
    if (i < active) return { id, progress: 1, state: 'done' as const };
    if (i === active) return { id, progress: id === 'assets' ? bytes : 0, state: 'active' as const };
    return { id, progress: 0, state: 'pending' as const };
  });
}
