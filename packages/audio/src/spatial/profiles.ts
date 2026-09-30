/**
 * Per-category spatial profiles of the camera-based spatial model.
 *
 * Reference scale (packages/client camera): minimum camera distance ≈ 6 WU, typical play height
 * 40–80 WU (view half width ≈ 15–35 WU), full-map strategic zoom up to ≈ 1400 WU on a 1024-WU map.
 * Units are 1–3 WU in size, so a single rifle shot matters at 60 WU camera height but should be
 * a faint crackle when the whole map is on screen, while explosions and bells stay readable.
 */

import { SOUND_CATEGORIES, type SoundCategory } from '../types.ts';

/** How one sound category reacts to distance and zoom. */
export interface SpatialProfile {
  /** false: centred at full gain (ui, ack, alert, music, ambience). */
  readonly spatial: boolean;
  /** Camera height (WU) up to which zoom does not attenuate. */
  readonly zoomRefHeight: number;
  /** Attenuation in dB per doubling of the camera height above `zoomRefHeight` (≤ 0). */
  readonly zoomDbPerDoubling: number;
  /** Lowest zoom attenuation in dB (≤ 0): the floor reached in full strategic zoom. */
  readonly zoomFloorDb: number;
  /**
   * Off-screen rolloff k: for r = distance / viewHalfWidth > 1 the gain is 1 / (1 + k (r − 1))².
   * 0 = no distance attenuation.
   */
  readonly offscreenRolloff: number;
  /** Inaudible (culled) beyond this distance, in view half widths (≥ 1). */
  readonly cutoffRadius: number;
  /** Largest absolute stereo pan (0..1); 0.8 keeps hard-left sounds audible on both ears. */
  readonly maxPan: number;
}

const NON_SPATIAL: SpatialProfile = Object.freeze({
  spatial: false,
  zoomRefHeight: 1,
  zoomDbPerDoubling: 0,
  zoomFloorDb: 0,
  offscreenRolloff: 0,
  cutoffRadius: Number.POSITIVE_INFINITY,
  maxPan: 0,
});

function p(zoomRefHeight: number, zoomDbPerDoubling: number, zoomFloorDb: number, offscreenRolloff: number, cutoffRadius: number): SpatialProfile {
  return Object.freeze({ spatial: true, zoomRefHeight, zoomDbPerDoubling, zoomFloorDb, offscreenRolloff, cutoffRadius, maxPan: 0.8 });
}

/**
 * Default profiles (rationale per row in docs/status/audioeng-b3.md):
 * - small, frequent battle sounds (weapon, impact) fade strongly with zoom (−6 dB per doubling,
 *   floor −30 dB) and are culled 2.5 half widths off-screen;
 * - projectile/unit/build/eco loops and whirs are even more local (−7/−6 dB, cutoff 2);
 * - shields sit between (−5 dB); intel pings are information (−3 dB, cutoff 3);
 * - explosions stay audible in strategic zoom (−3 dB per doubling, floor −12 dB, cutoff 4);
 * - signature bells barely attenuate (−1.5 dB, floor −6 dB, cutoff 6).
 */
export const SPATIAL_PROFILES: Readonly<Record<SoundCategory, SpatialProfile>> = Object.freeze({
  alert: NON_SPATIAL,
  music: NON_SPATIAL,
  signature: p(120, -1.5, -6, 0.5, 6),
  ack: NON_SPATIAL,
  ui: NON_SPATIAL,
  explosion: p(80, -3, -12, 0.8, 4),
  weapon: p(60, -6, -30, 1.5, 2.5),
  shield: p(60, -5, -24, 1.5, 2.5),
  impact: p(60, -6, -30, 1.5, 2.5),
  projectile: p(50, -7, -36, 2, 2),
  build: p(50, -6, -30, 2, 2),
  intel: p(80, -3, -18, 1, 3),
  unit: p(50, -7, -36, 2, 2),
  ambience: NON_SPATIAL,
  eco: p(50, -6, -30, 2, 2),
});

/** Throws RangeError for an inconsistent profile (custom profiles in tests / tuning). */
export function validateSpatialProfile(c: string, pr: SpatialProfile): void {
  const bad = (field: string, v: number): never => {
    throw new RangeError(`spatial profile '${c}': ${field} = ${v} out of range`);
  };
  if (!pr.spatial) return;
  if (!(pr.zoomRefHeight > 0) || !Number.isFinite(pr.zoomRefHeight)) bad('zoomRefHeight', pr.zoomRefHeight);
  if (!(pr.zoomDbPerDoubling <= 0) || !Number.isFinite(pr.zoomDbPerDoubling)) bad('zoomDbPerDoubling', pr.zoomDbPerDoubling);
  if (!(pr.zoomFloorDb <= 0)) bad('zoomFloorDb', pr.zoomFloorDb);
  if (!(pr.offscreenRolloff >= 0) || !Number.isFinite(pr.offscreenRolloff)) bad('offscreenRolloff', pr.offscreenRolloff);
  if (!(pr.cutoffRadius >= 1)) bad('cutoffRadius', pr.cutoffRadius);
  if (!(pr.maxPan >= 0 && pr.maxPan <= 1)) bad('maxPan', pr.maxPan);
}

/** Zoom attenuation in dB of a profile at camera height `height` (0 at or below the reference). */
export function zoomAttenuationDb(pr: SpatialProfile, height: number): number {
  if (!pr.spatial || !(height > pr.zoomRefHeight)) return 0;
  const db = pr.zoomDbPerDoubling * Math.log2(height / pr.zoomRefHeight);
  return db < pr.zoomFloorDb ? pr.zoomFloorDb : db;
}

/** Profiles in {@link SOUND_CATEGORIES} order (index = categoryIndex). */
export function profilesByIndex(profiles: Readonly<Record<SoundCategory, SpatialProfile>>): readonly SpatialProfile[] {
  return SOUND_CATEGORIES.map((c) => profiles[c]);
}
