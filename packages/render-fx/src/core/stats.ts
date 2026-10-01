/** Draw/instance statistics shared by the FX passes and the fx-lab benchmarks. */

/** Frame segments timed and counted separately (PLAN §3.7 pass order). */
export const FX_SEGMENTS = ['shadow', 'opaque', 'shields', 'particles', 'beams', 'post'] as const;
export type FxSegment = (typeof FX_SEGMENTS)[number];

/** Per-pass counters (reset by the pass each frame). */
export interface FxPassStats {
  /** Draw calls of the last `encode`. */
  draws: number;
  /** Instances drawn by the last `encode`. */
  instances: number;
  /** Bytes uploaded during the last update/encode. */
  uploadBytes: number;
}

/** Aggregated counters of one frame, per segment and in total. */
export interface FxDrawStats {
  draws: number;
  instances: number;
  uploadBytes: number;
  readonly drawsBySegment: Record<FxSegment, number>;
}

export function createFxPassStats(): FxPassStats {
  return { draws: 0, instances: 0, uploadBytes: 0 };
}

export function createFxDrawStats(): FxDrawStats {
  return {
    draws: 0,
    instances: 0,
    uploadBytes: 0,
    drawsBySegment: { shadow: 0, opaque: 0, shields: 0, particles: 0, beams: 0, post: 0 },
  };
}

/** Zeroes all counters in place (no allocation). */
export function resetFxDrawStats(s: FxDrawStats): void {
  s.draws = 0;
  s.instances = 0;
  s.uploadBytes = 0;
  for (const k of FX_SEGMENTS) s.drawsBySegment[k] = 0;
}

/** Adds a pass's counters to segment `seg` of `s`. */
export function addFxPassStats(s: FxDrawStats, seg: FxSegment, p: Readonly<FxPassStats>): void {
  s.draws += p.draws;
  s.instances += p.instances;
  s.uploadBytes += p.uploadBytes;
  s.drawsBySegment[seg] += p.draws;
}
