/**
 * Camera-based spatial model: stereo pan along the camera's right vector, attenuation by the
 * distance to the screen centre (in view half widths) and by camera zoom, per category profile.
 * `spatialize` is on the hot path (one call per started voice): no allocation, per-listener work
 * (zoom gains, inverse half width, normalized right vector) is precomputed in `setListener`.
 */

import { SOUND_CATEGORIES, type ListenerState, type SoundCategory, type SpatialModel, type SpatialResult } from '../types.ts';
import { SPATIAL_PROFILES, profilesByIndex, validateSpatialProfile, zoomAttenuationDb, type SpatialProfile } from './profiles.ts';

const N = SOUND_CATEGORIES.length;

/** Listener before the first `setListener`: origin, no zoom, 32 WU half width, x = right. */
export const DEFAULT_LISTENER: Readonly<ListenerState> = Object.freeze({
  focusX: 0,
  focusZ: 0,
  height: 0,
  viewHalfWidth: 32,
  rightX: 1,
  rightZ: 0,
});

/** Smallest accepted view half width (WU); protects the 1 / halfWidth division. */
export const MIN_VIEW_HALF_WIDTH = 1e-3;

export class CameraSpatialModel implements SpatialModel {
  readonly profiles: Readonly<Record<SoundCategory, SpatialProfile>>;
  private readonly byIndex: readonly SpatialProfile[];
  private readonly isSpatial = new Uint8Array(N);
  private readonly rolloff = new Float64Array(N);
  private readonly cutoff = new Float64Array(N);
  private readonly maxPan = new Float64Array(N);
  /** Linear zoom gain per category for the current listener. */
  private readonly zoomGain = new Float64Array(N);
  private readonly listenerState: ListenerState = { ...DEFAULT_LISTENER };
  private invHalfWidth = 1 / DEFAULT_LISTENER.viewHalfWidth;
  private rx = 1;
  private rz = 0;

  constructor(profiles: Readonly<Record<SoundCategory, SpatialProfile>> = SPATIAL_PROFILES) {
    for (const c of SOUND_CATEGORIES) {
      const pr = profiles[c];
      if (pr === undefined) throw new RangeError(`spatial profile for category '${c}' missing`);
      validateSpatialProfile(c, pr);
    }
    this.profiles = profiles;
    this.byIndex = profilesByIndex(profiles);
    for (let i = 0; i < N; i++) {
      const pr = this.byIndex[i]!;
      this.isSpatial[i] = pr.spatial ? 1 : 0;
      this.rolloff[i] = pr.offscreenRolloff;
      this.cutoff[i] = pr.cutoffRadius;
      this.maxPan[i] = pr.maxPan;
    }
    this.setListener(DEFAULT_LISTENER);
  }

  /** Copy of the last listener (sanitized: positive half width, unit right vector). */
  get listener(): Readonly<ListenerState> {
    return this.listenerState;
  }

  setListener(l: ListenerState): void {
    const s = this.listenerState;
    s.focusX = Number.isFinite(l.focusX) ? l.focusX : 0;
    s.focusZ = Number.isFinite(l.focusZ) ? l.focusZ : 0;
    s.height = Number.isFinite(l.height) && l.height > 0 ? l.height : 0;
    s.viewHalfWidth = Number.isFinite(l.viewHalfWidth) && l.viewHalfWidth > MIN_VIEW_HALF_WIDTH ? l.viewHalfWidth : MIN_VIEW_HALF_WIDTH;
    let rx = Number.isFinite(l.rightX) ? l.rightX : 0;
    let rz = Number.isFinite(l.rightZ) ? l.rightZ : 0;
    const len = Math.sqrt(rx * rx + rz * rz);
    if (len > 1e-9) {
      rx /= len;
      rz /= len;
    } else {
      rx = 1;
      rz = 0;
    }
    s.rightX = rx;
    s.rightZ = rz;
    this.rx = rx;
    this.rz = rz;
    this.invHalfWidth = 1 / s.viewHalfWidth;
    for (let i = 0; i < N; i++) this.zoomGain[i] = Math.pow(10, zoomAttenuationDb(this.byIndex[i]!, s.height) / 20);
  }

  /** Current zoom attenuation of a category in dB (HUD/diagnostics). */
  zoomDb(categoryIndex: number): number {
    const g = this.zoomGain[categoryIndex];
    return g === undefined ? 0 : 20 * Math.log10(g);
  }

  spatialize(categoryIndex: number, x: number, z: number, out: SpatialResult): boolean {
    if (!(categoryIndex >= 0 && categoryIndex < N) || this.isSpatial[categoryIndex] === 0) {
      out.gain = 1;
      out.pan = 0;
      return true;
    }
    const s = this.listenerState;
    const dx = x - s.focusX;
    const dz = z - s.focusZ;
    const inv = this.invHalfWidth;
    const r = Math.sqrt(dx * dx + dz * dz) * inv;
    // NaN positions fail `r <= cutoff` as well.
    if (!(r <= this.cutoff[categoryIndex]!)) {
      out.gain = 0;
      out.pan = 0;
      return false;
    }
    let gain = this.zoomGain[categoryIndex]!;
    if (r > 1) {
      const d = 1 + this.rolloff[categoryIndex]! * (r - 1);
      gain /= d * d;
    }
    let pan = (dx * this.rx + dz * this.rz) * inv;
    if (pan > 1) pan = 1;
    else if (pan < -1) pan = -1;
    out.gain = gain;
    out.pan = pan * this.maxPan[categoryIndex]!;
    return gain > 0;
  }
}
