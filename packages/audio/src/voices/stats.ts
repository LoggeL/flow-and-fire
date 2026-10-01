/** Voice-manager counters, filled into caller-owned objects without allocation. */

import { DROP_REASONS, SOUND_CATEGORIES, type DropReason } from '../types.ts';

/** Snapshot of the voice-manager counters (see `VoiceManager.snapshotStats`). */
export interface VoiceStats {
  /** Logical voices currently allocated (≤ maxVoices). */
  voices: number;
  /** Highest `voices` since construction / the last reset. */
  peakVoices: number;
  /** Stolen/stopped voices still fading out (not counted in `voices`, ≤ tailBudget). */
  tails: number;
  /** Logical voices per category, indexed by `categoryIndex` (SOUND_CATEGORIES order). */
  readonly byCategory: Int32Array;
  /** Voices started. */
  played: number;
  /** Voices stolen to make room for another voice. */
  stolen: number;
  /** Dropped requests per reason, indexed like DROP_REASONS. */
  readonly dropped: Int32Array;
  /** Most recent drop reason since construction / reset (sticky), null if none. */
  lastDrop: DropReason | null;
}

/** A zeroed stats object to pass to `snapshotStats` repeatedly. */
export function createVoiceStats(): VoiceStats {
  return {
    voices: 0,
    peakVoices: 0,
    tails: 0,
    byCategory: new Int32Array(SOUND_CATEGORIES.length),
    played: 0,
    stolen: 0,
    dropped: new Int32Array(DROP_REASONS.length),
    lastDrop: null,
  };
}

/** Index of `r` in DROP_REASONS. */
export function dropReasonIndex(r: DropReason): number {
  return DROP_REASONS.indexOf(r);
}
