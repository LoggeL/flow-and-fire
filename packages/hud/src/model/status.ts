import { signal } from '@preact/signals';
import type { Signal } from '@preact/signals';

/** Match status + pause/speed banner (ui.md §5.2, §5.3; A5, A6, U7, S9, P10, A19). */

export type PauseState = 'none' | 'user' | 'background';

export interface MatchScores {
  readonly self: number;
  readonly enemy: number;
}

export interface MatchSection {
  /** Sim time in seconds (1 Hz binding). */
  readonly timeS: Signal<number>;
  /** Requested sim speed factor (1 = normal). */
  readonly speed: Signal<number>;
  readonly pause: Signal<PauseState>;
  /** Effective speed while the sim lags behind (e.g. 0.8), null when on time. */
  readonly simLag: Signal<number | null>;
  /** WebGL context lost, graphics restoring (P10). */
  readonly contextLost: Signal<boolean>;
  readonly units: Signal<number>;
  readonly unitCap: Signal<number>;
  /** Scores of both houses; shown only in replays in the MVP (UI-E3, A19). */
  readonly scores: Signal<MatchScores | null>;
  readonly replay: Signal<boolean>;
}

export type CapLevel = 'normal' | 'near' | 'reached';

/** Unit cap display level (ui.md §5.2: yellow from 90 %, red at the cap). */
export function capLevel(units: number, cap: number): CapLevel {
  if (cap <= 0) return 'normal';
  if (units >= cap) return 'reached';
  if (units >= cap * 0.9) return 'near';
  return 'normal';
}

export function createMatchSection(): MatchSection {
  return {
    timeS: signal(0),
    speed: signal(1),
    pause: signal<PauseState>('none'),
    simLag: signal<number | null>(null),
    contextLost: signal(false),
    units: signal(0),
    unitCap: signal(500),
    scores: signal<MatchScores | null>(null),
    replay: signal(false),
  };
}

const SPEED_EPS = 1e-6;

/** Sim speed differs from ×1.0 (ember in the status, speed banner). */
export function isSpeedChanged(speed: number): boolean {
  return Math.abs(speed - 1) > SPEED_EPS;
}

/** Which banner shows at the top centre (ui.md §5.3); only one at a time. */
export type BannerKind = 'pause' | 'background' | 'contextLoss' | 'simLag' | 'speed';

/**
 * Banner priority: a stopped sim first (user pause, then background pause), then the graphics
 * context loss, then sim lag, then a changed speed. Null when nothing is shown.
 */
export function bannerKind(pause: PauseState, speed: number, simLag: number | null, contextLost: boolean): BannerKind | null {
  if (pause === 'user') return 'pause';
  if (pause === 'background') return 'background';
  if (contextLost) return 'contextLoss';
  if (simLag !== null && simLag < speed - SPEED_EPS) return 'simLag';
  if (isSpeedChanged(speed)) return 'speed';
  return null;
}
