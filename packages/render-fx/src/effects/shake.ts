/**
 * Camera shake (PLAN §3.7 "ACU-Explosion mit Kamera-Shake"). Up to {@link MAX_SHAKES} sources, each
 * a smooth deterministic value noise (fxHash32 lattice, smoothstep interpolation) scaled by
 *
 *   strength = amplitude · (1 − age/duration)² · max(0, 1 − dist/radius)²
 *
 * where dist is the distance from the camera target to the epicenter. The camera applies
 * (dx, dy, dz) to its eye and target and `rollRad` around the view axis. `sample()` does not
 * allocate (it fills and returns the same result object).
 */
import type { EffectShakeDef } from './define.ts';
import { fxHash32, hashToUnit } from './random.ts';

export const MAX_SHAKES = 16;
/** Roll per WU of displacement (rad), clamped to {@link MAX_SHAKE_ROLL_RAD}. */
export const SHAKE_ROLL_PER_WU = 0.012;
export const MAX_SHAKE_ROLL_RAD = 0.06;

export interface ShakeSample {
  dx: number;
  dy: number;
  dz: number;
  rollRad: number;
  /** At least one shake source is still running (regardless of distance). */
  active: boolean;
}

/** Smooth value noise in [−1, 1] along x for lattice seed `seed` (deterministic). */
export function shakeNoise(seed: number, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = hashToUnit(fxHash32(seed, i >>> 0, 0x5eed)) * 2 - 1;
  const b = hashToUnit(fxHash32(seed, (i + 1) >>> 0, 0x5eed)) * 2 - 1;
  const s = f * f * (3 - 2 * f);
  return a + (b - a) * s;
}

export class CameraShake {
  private readonly posX = new Float64Array(MAX_SHAKES);
  private readonly posY = new Float64Array(MAX_SHAKES);
  private readonly posZ = new Float64Array(MAX_SHAKES);
  private readonly amp = new Float64Array(MAX_SHAKES);
  private readonly dur = new Float64Array(MAX_SHAKES);
  private readonly radius = new Float64Array(MAX_SHAKES);
  private readonly freq = new Float64Array(MAX_SHAKES);
  private readonly t0 = new Float64Array(MAX_SHAKES);
  private readonly seed = new Uint32Array(MAX_SHAKES);
  private readonly live = new Uint8Array(MAX_SHAKES);
  private serial = 0;
  private readonly accum = new Float64Array(4);
  private readonly result: ShakeSample = { dx: 0, dy: 0, dz: 0, rollRad: 0, active: false };

  /** Number of running sources. */
  get activeCount(): number {
    let n = 0;
    for (let i = 0; i < MAX_SHAKES; i++) n += this.live[i]!;
    return n;
  }

  /**
   * Adds a shake source at `posWu` starting at `tS`. When all {@link MAX_SHAKES} slots are busy the
   * weakest source (remaining strength at tS) is replaced, unless the new one is weaker still.
   */
  add(
    posWu: ArrayLike<number>,
    amplitudeWu: number,
    durationS: number,
    radiusWu: number,
    frequencyHz: number,
    tS: number,
  ): void {
    if (!(amplitudeWu > 0 && durationS > 0 && radiusWu > 0 && frequencyHz > 0)) return;
    let slot = -1;
    let weakest = amplitudeWu;
    for (let i = 0; i < MAX_SHAKES; i++) {
      if (this.live[i] === 0) {
        slot = i;
        break;
      }
      const age = tS - this.t0[i]!;
      const k = age >= this.dur[i]! ? 0 : 1 - Math.max(0, age) / this.dur[i]!;
      const rest = this.amp[i]! * k * k;
      if (rest < weakest) {
        weakest = rest;
        slot = i;
      }
    }
    if (slot < 0) return;
    this.posX[slot] = posWu[0]!;
    this.posY[slot] = posWu[1]!;
    this.posZ[slot] = posWu[2]!;
    this.amp[slot] = amplitudeWu;
    this.dur[slot] = durationS;
    this.radius[slot] = radiusWu;
    this.freq[slot] = frequencyHz;
    this.t0[slot] = tS;
    this.seed[slot] = fxHash32(0x5a4e, this.serial++) & 0x3fffffff;
    this.live[slot] = 1;
  }

  /** Adds the shake of an effect (no-op when it has none); `scale` multiplies the amplitude. */
  addFromEffect(
    effect: { readonly shake?: EffectShakeDef | null },
    posWu: ArrayLike<number>,
    tS: number,
    scale = 1,
  ): void {
    const s = effect.shake;
    if (s === undefined || s === null) return;
    this.add(posWu, s.amplitudeWu * scale, s.durationS, s.radiusWu, s.frequencyHz, tS);
  }

  /** Evaluates all sources at tS for a camera looking at camTargetWu. Returns a reused object. */
  sample(tS: number, camTargetWu: ArrayLike<number>): ShakeSample {
    const r = this.result;
    let active = false;
    const cx = camTargetWu[0]!;
    const cy = camTargetWu[1]!;
    const cz = camTargetWu[2]!;
    for (let i = 0; i < MAX_SHAKES; i++) {
      if (this.live[i] === 0) continue;
      const age = tS - this.t0[i]!;
      if (age >= this.dur[i]!) {
        this.live[i] = 0;
        continue;
      }
      active = true;
      if (age < 0) continue;
      const k = 1 - age / this.dur[i]!;
      const ex = cx - this.posX[i]!;
      const ey = cy - this.posY[i]!;
      const ez = cz - this.posZ[i]!;
      const dist = Math.sqrt(ex * ex + ey * ey + ez * ez);
      const rad = this.radius[i]!;
      if (dist >= rad) continue;
      const fall = 1 - dist / rad;
      const s = this.amp[i]! * k * k * fall * fall;
      const x = age * this.freq[i]!;
      const seed = this.seed[i]!;
      // shakeNoise(seed + c, c === 3 ? x/2 : x) for the 4 channels, inlined so that no double is
      // returned from (or passed to) a non-inlined call – V8 would box it (allocation).
      for (let c = 0; c < 4; c++) {
        const xx = c === 3 ? x * 0.5 : x;
        const li = Math.floor(xx);
        const f = xx - li;
        let a = 0;
        let b = 0;
        for (let j = 0; j < 2; j++) {
          let h = (seed + c + 0x9e3779b9) | 0;
          for (let round = 0; round < 3; round++) {
            h ^= h >>> 16;
            h = Math.imul(h, 0x85ebca6b);
            h ^= h >>> 13;
            h = Math.imul(h, 0xc2b2ae35);
            h ^= h >>> 16;
            if (round === 0) h ^= ((li + j) >>> 0) + 0x7f4a7c15;
            else if (round === 1) h ^= 0x5eed + 0x94d049bb;
          }
          const v = ((h >>> 8) / 16777216) * 2 - 1;
          if (j === 0) a = v;
          else b = v;
        }
        const n = a + (b - a) * (f * f * (3 - 2 * f));
        const acc = this.accum;
        acc[c] = acc[c]! + s * n;
      }
    }
    const acc = this.accum;
    const dx = acc[0]!;
    const dy = acc[1]!;
    const dz = acc[2]!;
    const roll = acc[3]!;
    acc.fill(0);
    r.dx = dx;
    r.dy = dy;
    r.dz = dz;
    r.rollRad = Math.max(-MAX_SHAKE_ROLL_RAD, Math.min(MAX_SHAKE_ROLL_RAD, roll * SHAKE_ROLL_PER_WU));
    r.active = active;
    return r;
  }

  clear(): void {
    this.live.fill(0);
  }
}
