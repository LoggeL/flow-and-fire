import { signal } from '@preact/signals';
import type { Signal } from '@preact/signals';

/** Loading screen (ui.md §5.15, P3): five phases with their own bars, current file, bytes, error. */

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
  readonly path: string;
  readonly source: 'cache' | 'network';
}

export interface LoadingBytes {
  readonly loaded: number;
  readonly total: number;
}

export interface LoadingSection {
  readonly mapName: Signal<string>;
  readonly phases: Signal<readonly LoadingPhase[]>;
  readonly currentFile: Signal<LoadingFile | null>;
  readonly bytes: Signal<LoadingBytes>;
  /** Error cause (already human readable), null while loading works. */
  readonly error: Signal<string | null>;
}

export function initialPhases(): readonly LoadingPhase[] {
  return LOADING_PHASE_IDS.map((id) => ({ id, progress: 0, state: 'pending' as const }));
}

export function createLoadingSection(): LoadingSection {
  return {
    mapName: signal(''),
    phases: signal(initialPhases()),
    currentFile: signal<LoadingFile | null>(null),
    bytes: signal<LoadingBytes>({ loaded: 0, total: 0 }),
    error: signal<string | null>(null),
  };
}
