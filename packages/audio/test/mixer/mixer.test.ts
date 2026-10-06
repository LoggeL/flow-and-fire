import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CHANNEL_BUSES,
  LIMITER_MAKEUP_DB,
  LIMITER_SETTINGS,
  Mixer,
  RAMP_TAU_S,
  compressorMakeupDb,
  dbToGain,
  gainToDb,
  gainToSlider,
  sliderToGain,
} from '../../src/mixer/index.ts';
import { BUS_IDS } from '../../src/types.ts';
import { FakeAudioContext, type FakeAudioParam, type FakeDynamicsCompressorNode, type FakeGainNode, type FakeWaveShaperNode } from '../support/index.ts';

async function running(): Promise<FakeAudioContext> {
  const ctx = new FakeAudioContext();
  await ctx.resume();
  return ctx;
}

function param(node: unknown): FakeAudioParam {
  return (node as FakeGainNode).gain;
}

describe('sliderToGain', () => {
  it('maps 0 → 0 and 1 → 1, clamps and treats non-finite input as 0', () => {
    expect(sliderToGain(0)).toBe(0);
    expect(sliderToGain(1)).toBe(1);
    expect(sliderToGain(-0.5)).toBe(0);
    expect(sliderToGain(7)).toBe(1);
    expect(sliderToGain(Number.NaN)).toBe(0);
    expect(sliderToGain(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it('is monotonic on [0, 1] (strictly on a 0.001 grid)', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (a, b) => {
        if (a < b) expect(sliderToGain(a)).toBeLessThanOrEqual(sliderToGain(b)); // strict except for underflow of tiny v
        if (a === b) expect(sliderToGain(a)).toBe(sliderToGain(b));
      }),
      { numRuns: 2000 },
    );
    let prev = -1;
    for (let i = 0; i <= 1000; i++) {
      const g = sliderToGain(i / 1000);
      expect(g).toBeGreaterThan(prev);
      prev = g;
    }
  });

  it('follows the v² reference points and inverts via gainToSlider', () => {
    expect(gainToDb(sliderToGain(0.5))).toBeCloseTo(-12.04, 2);
    expect(gainToDb(sliderToGain(0.25))).toBeCloseTo(-24.08, 2);
    expect(gainToDb(sliderToGain(0.1))).toBeCloseTo(-40, 6);
    for (const v of [0, 0.1, 0.33, 0.5, 0.9, 1]) expect(gainToSlider(sliderToGain(v))).toBeCloseTo(v, 12);
    expect(dbToGain(-6)).toBeCloseTo(0.501187, 6);
  });
});

describe('Mixer graph', () => {
  it('builds input → user → duck → master → mute → limiter → makeup → clip → destination for every channel bus', async () => {
    const ctx = await running();
    const mixer = new Mixer(ctx);
    const g = mixer.graph;
    for (const b of CHANNEL_BUSES) {
      expect(mixer.busInput(b)).toBe(g.input[b]);
      const path = ctx.graphPathToDestination(mixer.busInput(b))!;
      const expected: unknown[] = [g.input[b], g.user[b], g.duck[b], g.user.master, g.mute, g.limiter, g.makeup, g.clip, ctx.destination];
      expect(path.length).toBe(expected.length);
      path.forEach((n, i) => expect(n === expected[i], `${b} #${i}`).toBe(true));
    }
    expect(ctx.createdByKind.compressor).toBe(1);
    expect(ctx.createdByKind.shaper).toBe(1);
    expect(ctx.createdByKind.gain).toBe(CHANNEL_BUSES.length * 3 + 3);
  });

  it('compensates the compressor makeup gain and ends in a hard clip at ±1', async () => {
    const ctx = await running();
    const mixer = new Mixer(ctx);
    // Spec: makeup = (1 / fullRangeGain)^0.6; fullRange at 0 dBFS = −3 + 3/20 = −2.85 dB → +1.71 dB.
    expect(compressorMakeupDb(-3, 20)).toBeCloseTo(1.71, 10);
    expect(LIMITER_MAKEUP_DB).toBeCloseTo(1.71, 10);
    expect(compressorMakeupDb(0, 20)).toBe(0);
    expect(compressorMakeupDb(-12, 1)).toBeCloseTo(0, 12);
    expect(param(mixer.graph.makeup).value).toBeCloseTo(dbToGain(-1.71), 12);
    expect(param(mixer.graph.makeup).events).toHaveLength(0);
    const clip = mixer.graph.clip as FakeWaveShaperNode;
    expect(Array.from(clip.curve!)).toEqual([-1, 1]);
    expect(clip.oversample).toBe('none');
  });

  it('skips the clip when disabled or when the context cannot create a WaveShaper', async () => {
    const ctx = await running();
    const noClip = new Mixer(ctx, { safetyClip: false });
    expect(noClip.graph.clip).toBeNull();
    const path = ctx.graphPathToDestination(noClip.busInput('ui'))!;
    expect(path[path.length - 2]).toBe(noClip.graph.makeup);

    const bare = await running();
    Object.defineProperty(bare, 'createWaveShaper', { value: undefined });
    const m = new Mixer(bare);
    expect(m.graph.clip).toBeNull();
    expect(bare.graphPathToDestination(m.busInput('sfx'))).not.toBeNull();
  });

  it('configures the safety limiter (−3 dB, knee 0, ratio 20, 3 ms / 120 ms)', async () => {
    const ctx = await running();
    const mixer = new Mixer(ctx);
    const l = mixer.graph.limiter as FakeDynamicsCompressorNode;
    expect(l.threshold.value).toBe(-3);
    expect(l.knee.value).toBe(0);
    expect(l.ratio.value).toBe(20);
    expect(l.attack.value).toBe(0.003);
    expect(l.release.value).toBe(0.12);
    expect(LIMITER_SETTINGS.thresholdDb).toBe(-3);
    l.reduction = -2.5;
    expect(mixer.limiterReductionDb).toBe(-2.5);
  });

  it('applies initial volumes and mute without automation events', async () => {
    const ctx = await running();
    const mixer = new Mixer(ctx, { volumes: { master: 0.5, music: 0 }, muted: true });
    expect(param(mixer.graph.user.master).value).toBe(0.25);
    expect(param(mixer.graph.user.music).value).toBe(0);
    expect(param(mixer.graph.user.sfx).value).toBe(1);
    expect(param(mixer.graph.mute).value).toBe(0);
    expect(mixer.volume('master')).toBe(0.5);
    for (const b of BUS_IDS) expect(param(mixer.graph.user[b]).events).toHaveLength(0);
  });

  it('ramps volume changes with setTargetAtTime (τ 15 ms), never jumps', async () => {
    const ctx = await running();
    const mixer = new Mixer(ctx);
    ctx.advance(100);
    const t0 = ctx.currentTime;
    mixer.setVolume('sfx', 0.5);
    mixer.setVolume('master', 2); // clamped
    const p = param(mixer.graph.user.sfx);
    expect(p.count('setTargetAtTime')).toBe(1);
    expect(p.count('setValueAtTime')).toBe(0);
    expect(p.calls.find((c) => c.method === 'setTargetAtTime')!.timeConstant).toBe(RAMP_TAU_S);
    expect(p.valueAt(t0)).toBe(1);
    expect(p.valueAt(t0 + RAMP_TAU_S)).toBeCloseTo(0.25 + 0.75 * Math.exp(-1), 9);
    expect(p.valueAt(t0 + 0.2)).toBeCloseTo(0.25, 4);
    expect(mixer.volume('master')).toBe(1);
    // A second change while the first is still ramping continues from the current value.
    ctx.advance(10);
    const mid = p.value;
    mixer.setVolume('sfx', 1);
    expect(p.valueAt(ctx.currentTime)).toBeCloseTo(mid, 9);
    ctx.advance(300);
    expect(p.value).toBeCloseTo(1, 4);
    // Only the explicit immediate flag jumps.
    mixer.setVolume('ui', 0, true);
    expect(param(mixer.graph.user.ui).value).toBe(0);
  });

  it('mutes per source: the output is silent while any source mutes', async () => {
    const ctx = await running();
    const mixer = new Mixer(ctx);
    const p = param(mixer.graph.mute);
    mixer.setMuted(true);
    expect(mixer.muted).toBe(true);
    expect(p.count('setTargetAtTime')).toBe(1);
    ctx.advance(200);
    expect(p.value).toBeCloseTo(0, 4);
    mixer.setMuted(true, 'hidden');
    mixer.setMuted(false); // user unmutes, tab still hidden
    expect(mixer.muted).toBe(true);
    expect(mixer.isMutedBy('hidden')).toBe(true);
    expect(mixer.isMutedBy('user')).toBe(false);
    ctx.advance(200);
    expect(p.value).toBeCloseTo(0, 4);
    mixer.setMuted(false, 'hidden');
    ctx.advance(200);
    expect(p.value).toBeCloseTo(1, 4);
    expect(p.count('setTargetAtTime')).toBe(2);
  });
});

describe('Mixer ducking', () => {
  it('ducks with attack, hold and release', async () => {
    const ctx = await running();
    const mixer = new Mixer(ctx);
    ctx.advance(1000);
    const t0 = ctx.currentTime;
    mixer.duck(['sfx', 'music'], -6, 30, 500, 300);
    const sfx = param(mixer.graph.duck.sfx);
    const g6 = dbToGain(-6);
    expect(sfx.valueAt(t0)).toBe(1);
    expect(sfx.valueAt(t0 + 0.03)).toBeCloseTo(g6 + (1 - g6) * Math.exp(-3), 6); // 95 % after attack
    expect(sfx.valueAt(t0 + 0.3)).toBeCloseTo(g6, 6);
    expect(sfx.valueAt(t0 + 0.53)).toBeCloseTo(g6, 6);
    expect(sfx.valueAt(t0 + 0.53 + 0.3)).toBeCloseTo(1 - (1 - g6) * Math.exp(-3), 4);
    expect(sfx.valueAt(t0 + 2)).toBeCloseTo(1, 6);
    expect(param(mixer.graph.duck.music).valueAt(t0 + 0.3)).toBeCloseTo(g6, 6);
    expect(param(mixer.graph.duck.ui).events).toHaveLength(0);
    expect(mixer.duckLevel('sfx')).toBeCloseTo(g6, 12);
    expect(mixer.duckLevel('ui')).toBe(1);
    expect(sfx.count('setValueAtTime') + sfx.count('linearRampToValueAtTime')).toBe(0);
  });

  it('overlapping ducks: the deepest attenuation wins and the hold extends', async () => {
    const ctx = await running();
    const mixer = new Mixer(ctx);
    ctx.advance(1000);
    const t0 = ctx.currentTime;
    const sfx = param(mixer.graph.duck.sfx);
    mixer.duck(['sfx'], -6, 30, 500, 300); // hold until t0 + 0.53
    ctx.advance(200);
    mixer.duck(['sfx'], -12, 30, 100, 300); // deeper, shorter hold (t0 + 0.33) → keeps t0 + 0.53
    const g12 = dbToGain(-12);
    expect(sfx.valueAt(t0 + 0.45)).toBeCloseTo(g12, 5);
    expect(sfx.valueAt(t0 + 0.52)).toBeCloseTo(g12, 5);
    ctx.advance(200); // t0 + 0.4
    mixer.duck(['sfx'], -3, 30, 400, 300); // shallower, longer hold (t0 + 0.83) → stays at −12 dB, hold extended
    expect(mixer.duckLevel('sfx')).toBeCloseTo(g12, 12);
    expect(sfx.valueAt(t0 + 0.8)).toBeCloseTo(g12, 5);
    expect(sfx.valueAt(t0 + 0.83 + 0.3)).toBeCloseTo(1 - (1 - g12) * Math.exp(-3), 4);
    expect(sfx.valueAt(t0 + 3)).toBeCloseTo(1, 6);
    // After the release a new duck starts fresh at its own depth.
    ctx.advance(3000);
    expect(mixer.duckLevel('sfx')).toBe(1);
    mixer.duck(['sfx'], -3, 30, 100, 100);
    expect(mixer.duckLevel('sfx')).toBeCloseTo(dbToGain(-3), 12);
  });

  it('ignores positive dB (never boosts) and non-finite values', async () => {
    const ctx = await running();
    const mixer = new Mixer(ctx);
    mixer.duck(['ambience'], 6, 10, 10, 10);
    mixer.duck(['ui'], Number.NaN, 10, 10, 10);
    ctx.advance(5);
    expect(param(mixer.graph.duck.ambience).value).toBe(1);
    expect(param(mixer.graph.duck.ui).value).toBe(1);
  });
});

describe('Mixer.dispose', () => {
  it('disconnects all nodes and turns later calls into no-ops', async () => {
    const ctx = await running();
    const mixer = new Mixer(ctx);
    mixer.dispose();
    expect(ctx.graphPathToDestination(mixer.busInput('sfx'))).toBeNull();
    expect((ctx.destination as { inputs: unknown[] }).inputs).toHaveLength(0);
    const calls = param(mixer.graph.user.sfx).calls.length;
    mixer.setVolume('sfx', 0.2);
    mixer.setMuted(true);
    mixer.duck(['sfx'], -6, 10, 10, 10);
    mixer.dispose();
    expect(param(mixer.graph.user.sfx).calls.length).toBe(calls);
  });
});
