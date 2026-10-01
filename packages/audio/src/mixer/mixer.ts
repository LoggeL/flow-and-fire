/**
 * Mixer of the audio engine.
 *
 * Graph per channel bus:
 *
 *   input(bus) → user(bus) → duck(bus) ─┐
 *                                       ├→ user(master) → mute → limiter → peak guard → destination
 *   input(…)   → user(…)   → duck(…)   ─┘
 *
 * - `input`: unity gain, the node voices connect to (`busInput`).
 * - `user`: slider volume through {@link sliderToGain}.
 * - `duck`: temporary attenuation (alerts duck sfx/music); overlapping ducks: the deepest
 *   attenuation wins and the hold time extends.
 * - `mute`: 0/1, combining several mute sources (user setting, hidden tab, …).
 * - `limiter`: safety DynamicsCompressor (−6 dB, knee 0, ratio 20, 3 ms / 120 ms) so that many
 *   loud voices at once never clip the output.
 *
 * Every parameter change after construction goes through `setTargetAtTime` (τ 15 ms), never a
 * jump, so volume changes cannot click.
 */

import type { BaseAudioContextLike, AudioNodeLike, DynamicsCompressorNodeLike, GainNodeLike } from '../ports.ts';
import { BUS_IDS, type BusId, type ChannelBus } from '../types.ts';
import { clamp01, dbToGain, sliderToGain } from './curve.ts';

/** Time constant of all volume/mute changes in seconds (≈ 95 % after 45 ms). */
export const RAMP_TAU_S = 0.015;

/** Parameters of the master safety limiter. */
export const LIMITER_SETTINGS = Object.freeze({
  thresholdDb: -6,
  kneeDb: 0,
  ratio: 20,
  attackS: 0.003,
  releaseS: 0.12,
});

/** Optional browser-only final ceiling. The fixed ports contract stays compatible with fakes. */
interface PeakGuardNode extends AudioNodeLike { curve: Float32Array<ArrayBuffer> | null; oversample: 'none' | '2x' | '4x' }
interface PeakGuardContext { createWaveShaper?: () => PeakGuardNode }
const PEAK_GUARD_CURVE = Float32Array.from({ length: 257 }, (_, i) => i / 128 - 1);

/** Channel buses (everything below master) in fixed order. */
export const CHANNEL_BUSES: readonly ChannelBus[] = ['sfx', 'ui', 'alerts', 'music', 'ambience'];

/** Reasons the output can be muted; the output is silent while any of them is active. */
export type MuteSource = 'user' | 'hidden' | 'system';

const MUTE_BITS: Readonly<Record<MuteSource, number>> = { user: 1, hidden: 2, system: 4 };

/** Options of {@link Mixer}. */
export interface MixerOptions {
  /** Initial slider values 0..1 per bus (default 1), applied without ramp. */
  volumes?: Partial<Record<BusId, number>> | undefined;
  /** Initially muted by the user (default false). */
  muted?: boolean | undefined;
  /** Output node (default `ctx.destination`). */
  destination?: AudioNodeLike | undefined;
}

/** The mixer nodes (read-only; for diagnostics, metering and tests). */
export interface MixerGraph {
  readonly input: Readonly<Record<ChannelBus, GainNodeLike>>;
  readonly user: Readonly<Record<BusId, GainNodeLike>>;
  readonly duck: Readonly<Record<ChannelBus, GainNodeLike>>;
  readonly mute: GainNodeLike;
  readonly limiter: DynamicsCompressorNodeLike;
}

const BUS_INDEX: Readonly<Record<ChannelBus, number>> = { sfx: 0, ui: 1, alerts: 2, music: 3, ambience: 4 };

export class Mixer {
  readonly graph: MixerGraph;
  private readonly sliders: Record<BusId, number> = { master: 1, sfx: 1, ui: 1, alerts: 1, music: 1, ambience: 1 };
  private muteMask = 0;
  private disposed = false;
  private readonly peakGuard: PeakGuardNode | null;
  /** Active duck per channel bus: gain (1 = none) and context time the release starts. */
  private readonly duckGain = new Float64Array(5).fill(1);
  private readonly duckReleaseAt = new Float64Array(5);

  constructor(
    readonly ctx: BaseAudioContextLike,
    opts: MixerOptions = {},
  ) {
    const input = {} as Record<ChannelBus, GainNodeLike>;
    const user = {} as Record<BusId, GainNodeLike>;
    const duck = {} as Record<ChannelBus, GainNodeLike>;
    user.master = ctx.createGain();
    const mute = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = LIMITER_SETTINGS.thresholdDb;
    limiter.knee.value = LIMITER_SETTINGS.kneeDb;
    limiter.ratio.value = LIMITER_SETTINGS.ratio;
    limiter.attack.value = LIMITER_SETTINGS.attackS;
    limiter.release.value = LIMITER_SETTINGS.releaseS;
    for (const b of CHANNEL_BUSES) {
      input[b] = ctx.createGain();
      user[b] = ctx.createGain();
      duck[b] = ctx.createGain();
      input[b].connect(user[b]);
      user[b].connect(duck[b]);
      duck[b].connect(user.master);
    }
    user.master.connect(mute);
    mute.connect(limiter);
    // A DynamicsCompressor is not a brick-wall limiter: Chromium/WebKit transient
    // overshoot reached 1.17267 for the real 32-voice test. Headroom reduces this,
    // and an identity WaveShaper with clamped endpoints guarantees the final ceiling.
    const peakContext = ctx as BaseAudioContextLike & PeakGuardContext;
    this.peakGuard = peakContext.createWaveShaper?.() ?? null;
    if (this.peakGuard !== null) {
      this.peakGuard.curve = PEAK_GUARD_CURVE;
      this.peakGuard.oversample = 'none'; // Oversampling filters can introduce their own overshoot.
      limiter.connect(this.peakGuard);
      this.peakGuard.connect(opts.destination ?? ctx.destination);
    } else limiter.connect(opts.destination ?? ctx.destination);
    this.graph = { input, user, duck, mute, limiter };

    for (const b of BUS_IDS) {
      const v = opts.volumes?.[b];
      if (v !== undefined) this.sliders[b] = clamp01(v);
      user[b].gain.value = sliderToGain(this.sliders[b]);
    }
    if (opts.muted === true) this.muteMask = MUTE_BITS.user;
    mute.gain.value = this.muteMask === 0 ? 1 : 0;
  }

  /** The node voices of `bus` connect to. */
  busInput(bus: ChannelBus): AudioNodeLike {
    return this.graph.input[bus];
  }

  /** Current slider value of `bus` (0..1). */
  volume(bus: BusId): number {
    return this.sliders[bus];
  }

  /**
   * Sets the slider of `bus` (clamped 0..1, mapped through {@link sliderToGain}). Ramped with τ 15 ms;
   * `immediate` jumps (only for the initial state before anything plays).
   */
  setVolume(bus: BusId, slider01: number, immediate = false): void {
    if (this.disposed) return;
    const v = clamp01(slider01);
    this.sliders[bus] = v;
    this.rampTo(this.graph.user[bus], sliderToGain(v), immediate);
  }

  /** True while any mute source is active. */
  get muted(): boolean {
    return this.muteMask !== 0;
  }

  /** True if `source` currently mutes the output. */
  isMutedBy(source: MuteSource): boolean {
    return (this.muteMask & MUTE_BITS[source]) !== 0;
  }

  /** Mutes/unmutes for one source (default: the user setting); ramped with τ 15 ms. */
  setMuted(muted: boolean, source: MuteSource = 'user', immediate = false): void {
    if (this.disposed) return;
    const bit = MUTE_BITS[source];
    const before = this.muteMask;
    this.muteMask = muted ? before | bit : before & ~bit;
    if ((before === 0) !== (this.muteMask === 0) || immediate) this.rampTo(this.graph.mute, this.muteMask === 0 ? 1 : 0, immediate);
  }

  /**
   * Ducks `buses` by `db` (≤ 0): attack towards the ducked gain, hold, then release back to 1.
   * Overlapping ducks on a bus: the deepest attenuation wins and the release is pushed out to the
   * later of both hold ends. Attack/release are exponential approaches with τ = time / 3
   * (≈ 95 % of the way after the given time).
   */
  duck(buses: readonly ChannelBus[], db: number, attackMs: number, holdMs: number, releaseMs: number): void {
    if (this.disposed) return;
    const now = this.ctx.currentTime;
    const target = dbToGain(Math.min(0, Number.isFinite(db) ? db : 0));
    const attackS = Math.max(0, attackMs) / 1000;
    const holdEnd = now + attackS + Math.max(0, holdMs) / 1000;
    const attackTau = attackS / 3;
    const releaseTau = Math.max(0, releaseMs) / 3000;
    for (let k = 0; k < buses.length; k++) {
      const i = BUS_INDEX[buses[k]!];
      const active = now < this.duckReleaseAt[i]!;
      const g = active ? Math.min(this.duckGain[i]!, target) : target;
      const releaseAt = active ? Math.max(this.duckReleaseAt[i]!, holdEnd) : holdEnd;
      this.duckGain[i] = g;
      this.duckReleaseAt[i] = releaseAt;
      const p = this.graph.duck[CHANNEL_BUSES[i]!].gain;
      // Only setTarget events live on duck params, so cancelling future ones never causes a jump.
      p.cancelScheduledValues(now);
      p.setTargetAtTime(g, now, attackTau);
      p.setTargetAtTime(1, releaseAt, releaseTau);
    }
  }

  /** Current duck gain target of `bus` (1 = not ducked). */
  duckLevel(bus: ChannelBus): number {
    const i = BUS_INDEX[bus];
    return this.ctx.currentTime < this.duckReleaseAt[i]! ? this.duckGain[i]! : 1;
  }

  /** Current gain reduction of the safety limiter in dB (≤ 0). */
  get limiterReductionDb(): number {
    return this.graph.limiter.reduction;
  }

  /** Disconnects every mixer node. Further calls are no-ops. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const g = this.graph;
    for (const b of CHANNEL_BUSES) {
      g.input[b].disconnect();
      g.user[b].disconnect();
      g.duck[b].disconnect();
    }
    g.user.master.disconnect();
    g.mute.disconnect();
    g.limiter.disconnect();
    this.peakGuard?.disconnect();
  }

  private rampTo(node: GainNodeLike, value: number, immediate: boolean): void {
    const p = node.gain;
    const now = this.ctx.currentTime;
    p.cancelScheduledValues(now);
    if (immediate) p.setValueAtTime(value, now);
    else p.setTargetAtTime(value, now, RAMP_TAU_S);
  }
}
