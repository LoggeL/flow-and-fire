/**
 * Reusable sound-design recipes built from the DSP blocks. Every recipe returns a mono layer
 * normalized to peak 1, so layer gains in `mix` are relative dB values.
 */
import { decay, envelope, sweep } from './env.ts';
import { bandpass, highpass, lowpass } from './filter.ts';
import { shape } from './fx.ts';
import { crackle, noise, type NoiseColor } from './noise.ts';
import { BELL_PARTIALS, type Partial, fm, modal, osc, scaleDecay } from './osc.ts';
import { convolve, makeIR } from './reverb.ts';
import type { Rng } from './rng.ts';
import { type Mono, mixMono, mul, peakOf } from './signal.ts';

/** Scale to peak 1 (silence stays silence). */
export function normPeak(sig: Mono): Mono {
  const p = peakOf(sig);
  return p > 0 ? sig.map((v) => v / p) : sig;
}

export interface CrackOptions {
  rng: Rng;
  durS?: number;
  /** Center frequency of the blast band (Hz). */
  freq?: number;
  q?: number;
  t60?: number;
  drive?: number;
}

/** Muzzle blast / transient: a saturated, band-limited noise burst with a falling band. */
export function crack(o: CrackOptions): Mono {
  const dur = o.durS ?? 0.08;
  const f = o.freq ?? 1800;
  const n = mul(noise('white', dur, o.rng), decay(o.t60 ?? 0.03, dur, 0.0002));
  const band = bandpass(n, sweep(f * 1.5, f * 0.6, dur * 0.6, dur), o.q ?? 0.8);
  return normPeak(shape(band, { kind: 'tanh', drive: o.drive ?? 3 }));
}

export interface BoomOptions {
  from?: number;
  to?: number;
  sweepS?: number;
  t60?: number;
  durS?: number;
  drive?: number;
}

/** Pitched low "Wumm"/Knall body: falling sine, asymmetrically saturated for weight. */
export function boom(o: BoomOptions = {}): Mono {
  const t60 = o.t60 ?? 0.3;
  const dur = o.durS ?? t60 * 1.3;
  const s = osc('sine', sweep(o.from ?? 160, o.to ?? 45, o.sweepS ?? 0.09, dur, 'exp'), dur);
  return normPeak(shape(mul(s, decay(t60, dur, 0.001)), { kind: 'asym', drive: o.drive ?? 2.5 }));
}

export interface ThumpOptions {
  rng: Rng;
  durS?: number;
  t60?: number;
  lpFrom?: number;
  lpTo?: number;
  color?: NoiseColor;
}

/** Noisy low body (air push, earth): enveloped noise through a closing 24 dB low-pass. */
export function thump(o: ThumpOptions): Mono {
  const t60 = o.t60 ?? 0.35;
  const dur = o.durS ?? t60 * 1.3;
  const n = mul(noise(o.color ?? 'pink', dur, o.rng), decay(t60, dur, 0.001));
  return normPeak(lowpass(n, sweep(o.lpFrom ?? 900, o.lpTo ?? 120, t60 * 0.5, dur, 'exp'), 0.7, 2));
}

export interface ClangOptions {
  f0: number;
  rng: Rng;
  durS?: number;
  /** Multiplies all partial decays (small = short hammer ping, 1 = full bell). */
  decayScale?: number;
  partials?: readonly Partial[];
  /** 0..1 level of the bright FM strike transient. */
  strike?: number;
  /** Relative pitch drop at impact (e.g. 0.01 = 1 % above, settling in 30 ms). */
  pitchDrop?: number;
}

/**
 * Metallic strike ("Glockenhammer"): modal bell/plate body plus a short inharmonic FM strike.
 */
export function clang(o: ClangOptions): Mono {
  const dur = o.durS ?? 1;
  const body = modal(o.f0, scaleDecay(o.partials ?? BELL_PARTIALS, o.decayScale ?? 1), {
    durS: dur,
    rng: o.rng,
    jitter: 0.008,
    pitch: sweep(1 + (o.pitchDrop ?? 0.008), 1, 0.03, dur),
  });
  const strikeDur = Math.min(dur, 0.08);
  const strike = mul(
    fm({ carrier: o.f0 * 2.76, ratio: 1.414, index: envelope([[0, 7], [strikeDur, 0.2, 'exp']], strikeDur), durS: strikeDur }),
    decay(0.05, strikeDur, 0.0002),
  );
  return normPeak(mixMono([{ sig: normPeak(body) }, { sig: strike, db: 20 * Math.log10(Math.max(1e-4, o.strike ?? 0.5)) }], dur));
}

export interface SizzleOptions {
  rng: Rng;
  durS?: number;
  t60?: number;
  /** High-pass of the hiss (Hz). */
  hp?: number;
  /** Crackle impulses per second at the start. */
  density?: number;
  /** Hiss vs crackle balance 0..1 (default 0.5). */
  hiss?: number;
}

/** Glowing slag / ember: high hiss plus sparse crackle, both fading. */
export function sizzle(o: SizzleOptions): Mono {
  const dur = o.durS ?? 0.8;
  const t60 = o.t60 ?? 0.6;
  const env = envelope([[0, 0], [0.015, 1, 'lin'], [t60, 0.001, 'exp']], dur);
  const hiss = mul(highpass(noise('pink', dur, o.rng.fork('hiss')), o.hp ?? 3000, 0.7, 2), env);
  const cr = mul(crackle(dur, o.rng.fork('crackle'), { density: o.density ?? 300, grainS: 0.0003 }), env);
  const h = o.hiss ?? 0.5;
  return normPeak(mixMono([{ sig: normPeak(hiss), db: 20 * Math.log10(Math.max(1e-4, h)) }, { sig: normPeak(cr), db: 20 * Math.log10(Math.max(1e-4, 1 - h)) }], dur));
}

export interface RoomOptions {
  t60?: number;
  wet?: number;
  seed?: number;
  predelayS?: number;
  brightHz?: number;
  darkHz?: number;
}

/** Small, dry room (faction rule: "nah und trocken, wenig Hall") via a generated IR. Mono in/out. */
export function room(sig: Mono, o: RoomOptions = {}): Mono {
  const ir = makeIR({
    t60: o.t60 ?? 0.4,
    predelayS: o.predelayS ?? 0.006,
    brightHz: o.brightHz ?? 6500,
    darkHz: o.darkHz ?? 1100,
    seed: o.seed ?? 7,
  }) as Mono;
  return convolve(sig, ir, o.wet ?? 0.2, 1) as Mono;
}

/** Short metallic tick (breech, latch, relay). */
export function tick(f: number, rng: Rng, t60 = 0.03): Mono {
  return normPeak(
    modal(
      f,
      [
        { ratio: 1, amp: 1, t60 },
        { ratio: 1.37, amp: 0.7, t60: t60 * 0.8 },
        { ratio: 2.08, amp: 0.5, t60: t60 * 0.6 },
        { ratio: 2.9, amp: 0.3, t60: t60 * 0.5 },
      ],
      { durS: t60 * 2, rng, jitter: 0.02 },
    ),
  );
}

