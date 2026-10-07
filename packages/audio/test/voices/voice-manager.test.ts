import { describe, expect, it } from 'vitest';
import { categoryIndex, type PlayRequest, type VoiceHandle } from '../../src/types.ts';
import { createVoiceStats, dropReasonIndex } from '../../src/voices/index.ts';
import {
  FakeAudioBufferSourceNode,
  FakeGainNode,
  FakeStereoPannerNode,
  loadRealManifest,
  makeManifest,
} from '../support/index.ts';
import { makeRig, seededRandom, type Rig } from './fakes.ts';

function lastSource(r: Rig): FakeAudioBufferSourceNode {
  const a = r.ctx.activeSources();
  return a[a.length - 1]!;
}

/** Gain and panner node behind a voice source. */
function chain(src: FakeAudioBufferSourceNode): { gain: FakeGainNode; panner: FakeStereoPannerNode } {
  const gain = src.outputs[0] as FakeGainNode;
  const panner = gain.outputs[0] as FakeStereoPannerNode;
  return { gain, panner };
}

function play(r: Rig, sound: string | number, extra: Partial<PlayRequest> = {}): VoiceHandle | null {
  return r.vm.play({ sound, ...extra }, r.ctx.nowMs);
}

describe('VoiceManager: routing and start', () => {
  it('routes each category to its bus: source > gain > panner > input > user > duck > master > mute > limiter > makeup > clip', async () => {
    const r = await makeRig(loadRealManifest());
    const g = r.mixer.graph;
    const cases: [string, keyof typeof g.input][] = [
      ['ack_command', 'alerts'],
      ['alt_base_attacked', 'alerts'],
      ['ui_click', 'ui'],
      ['ui_select', 'ui'],
      ['mus_victory', 'music'],
      ['amb_wind_loop', 'ambience'],
      ['wpn_cannon_t1_fire', 'sfx'],
      ['exp_small', 'sfx'],
    ];
    for (const [name, bus] of cases) {
      const h = play(r, name);
      expect(h, name).not.toBeNull();
      const src = lastSource(r);
      const path = r.ctx.graphPathToDestination(src)!;
      const { gain, panner } = chain(src);
      const expected: unknown[] = [
        src,
        gain,
        panner,
        g.input[bus],
        g.user[bus],
        g.duck[bus],
        g.user.master,
        g.mute,
        g.limiter,
        g.makeup,
        g.clip,
        r.ctx.destination,
      ];
      expect(path.length, name).toBe(expected.length);
      path.forEach((node, k) => expect(node === expected[k], `${name} #${k} ${node.describe()}`).toBe(true));
    }
  });

  it('resolves names with faction → common fallback, fq ids and dense indices', async () => {
    const r = await makeRig(loadRealManifest());
    expect(play(r, 'ui_click')).not.toBeNull(); // common only
    expect(play(r, 'varkan:ui_select')).not.toBeNull();
    const i = r.resolver.indexOf('varkan:exp_small');
    expect(play(r, i)).not.toBeNull();
    expect(r.resolver.variantOf('varkan:exp_small', lastSource(r).buffer)).toBeGreaterThanOrEqual(0);
  });

  it('drops unknown sounds and out-of-range indices as unknownSound', async () => {
    const r = await makeRig(loadRealManifest());
    expect(play(r, 'wpn_does_not_exist')).toBeNull();
    expect(r.vm.lastDrop).toBe('unknownSound');
    expect(play(r, 9999)).toBeNull();
    expect(play(r, -1)).toBeNull();
    expect(play(r, 1.5)).toBeNull();
    const s = r.vm.snapshotStats(createVoiceStats());
    expect(s.dropped[dropReasonIndex('unknownSound')]).toBe(4);
    expect(r.ctx.createdByKind.source).toBe(0);
  });

  it('notLoaded: drops and asks the resolver to load the sound', async () => {
    const r = await makeRig(loadRealManifest(), { loaded: false });
    expect(play(r, 'wpn_mg_t1_fire')).toBeNull();
    expect(r.vm.lastDrop).toBe('notLoaded');
    expect(r.resolver.loadRequests).toEqual([r.resolver.indexOf('varkan:wpn_mg_t1_fire')]);
    r.resolver.setLoaded('varkan:wpn_mg_t1_fire', true);
    expect(play(r, 'wpn_mg_t1_fire')).not.toBeNull();
    expect(r.vm.lastDrop).toBeNull();
  });

  it('only uses loaded variants', async () => {
    const m = makeManifest({ sounds: [{ id: 'varkan:wpn_x_fire', variants: 4, cooldownMs: 0 }] });
    const r = await makeRig(m, { random: seededRandom(3) });
    r.resolver.buffers[0]![1] = null;
    r.resolver.buffers[0]![3] = null;
    const seen = new Set<number>();
    for (let k = 0; k < 40; k++) {
      expect(play(r, 'wpn_x_fire')).not.toBeNull();
      seen.add(r.resolver.variantOf('varkan:wpn_x_fire', lastSource(r).buffer));
      r.ctx.advance(1000);
    }
    expect([...seen].sort()).toEqual([0, 2]);
  });

  it('ui/ack start synchronously at when = 0 in the same call, even with a full pool and a future when', async () => {
    const sounds = [];
    for (let k = 0; k < 40; k++) sounds.push({ id: `varkan:wpn_${k}_fire`, durationS: 10, cooldownMs: 0 });
    const m = makeManifest({
      sounds: [...sounds, { id: 'varkan:ack_command' }, { id: 'common:ui_click' }],
      categories: { weapon: { maxVoices: 40 } },
    });
    const r = await makeRig(m);
    r.ctx.advance(1000);
    for (let k = 0; k < 32; k++) expect(play(r, `wpn_${k}_fire`)).not.toBeNull();
    expect(r.vm.voiceCount).toBe(32);
    expect(play(r, 'wpn_33_fire')).toBeNull();
    expect(r.vm.lastDrop).toBe('globalLimit');
    for (const name of ['ack_command', 'ui_click']) {
      const started = r.ctx.startedSources;
      const h = play(r, name, { when: r.ctx.currentTime + 5 });
      expect(h, name).not.toBeNull();
      expect(r.ctx.startedSources).toBe(started + 1);
      const src = lastSource(r);
      expect(src.startWhen).toBe(0);
      expect(src.startAt).toBeLessThanOrEqual(r.ctx.currentTime);
      expect(src.playing).toBe(true);
      expect(r.vm.voiceCount).toBe(32);
    }
    expect(r.vm.snapshotStats(createVoiceStats()).stolen).toBe(2);
  });

  it('schedules other categories at max(req.when, 0)', async () => {
    const r = await makeRig(loadRealManifest());
    play(r, 'wpn_cannon_t1_fire', { when: 0.25 });
    expect(lastSource(r).startWhen).toBe(0.25);
    play(r, 'wpn_mg_t1_fire', { when: -3 });
    expect(lastSource(r).startWhen).toBe(0);
    play(r, 'exp_small', { when: Number.NaN });
    expect(lastSource(r).startWhen).toBe(0);
  });
});

describe('VoiceManager: cooldown, variants, rate', () => {
  it('cooldown per sound: 49 ms later drops, 50 ms later plays; different sounds are independent', async () => {
    const r = await makeRig(loadRealManifest());
    expect(play(r, 'wpn_cannon_t1_fire')).not.toBeNull(); // cooldown 50 ms
    r.ctx.advance(49);
    expect(play(r, 'wpn_cannon_t1_fire')).toBeNull();
    expect(r.vm.lastDrop).toBe('cooldown');
    expect(play(r, 'wpn_cannon_t2_fire')).not.toBeNull();
    r.ctx.advance(1);
    expect(play(r, 'wpn_cannon_t1_fire')).not.toBeNull();
    r.ctx.advance(10);
    expect(play(r, 'wpn_cannon_t2_fire')).toBeNull();
    // A dropped request does not restart the cooldown.
    r.ctx.advance(40);
    expect(play(r, 'wpn_cannon_t2_fire')).not.toBeNull();
  });

  it('never repeats a variant directly and reaches all variants', async () => {
    const m = makeManifest({
      sounds: [
        { id: 'varkan:wpn_a_fire', variants: 2, cooldownMs: 0, maxVoices: 10 },
        { id: 'varkan:wpn_b_fire', variants: 6, cooldownMs: 0, maxVoices: 10 },
      ],
    });
    const r = await makeRig(m, { random: seededRandom(42) });
    for (const id of ['varkan:wpn_a_fire', 'varkan:wpn_b_fire']) {
      const counts = new Map<number, number>();
      let prev = -1;
      for (let k = 0; k < 600; k++) {
        expect(r.vm.play({ sound: id }, r.ctx.nowMs)).not.toBeNull();
        const v = r.resolver.variantOf(id, lastSource(r).buffer);
        expect(v).not.toBe(prev);
        prev = v;
        counts.set(v, (counts.get(v) ?? 0) + 1);
        r.ctx.advance(600);
      }
      const n = m.sounds.find((s) => s.id === id)!.variants.length;
      expect(counts.size).toBe(n);
      for (const c of counts.values()) expect(c).toBeGreaterThan(600 / n / 2);
    }
  });

  it('jitters one-shots within ±3 % of req.rate, never loops, music or alerts', async () => {
    const r = await makeRig(loadRealManifest());
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0; k < 400; k++) {
      play(r, 'wpn_mg_t1_fire', { rate: 1.2 });
      const v = lastSource(r).playbackRate.value / 1.2;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
      r.ctx.advance(300);
    }
    expect(lo).toBeGreaterThanOrEqual(0.97 - 1e-12);
    expect(hi).toBeLessThanOrEqual(1.03 + 1e-12);
    expect(hi - lo).toBeGreaterThan(0.04); // the band is actually used
    for (const name of ['bld_pour_loop', 'mus_victory', 'alt_base_attacked', 'amb_wind_loop']) {
      expect(play(r, name, { rate: 0.9, x: 0, z: 0 }), name).not.toBeNull();
      expect(lastSource(r).playbackRate.value, name).toBe(0.9);
    }
  });
});

describe('VoiceManager: loops', () => {
  it('sets loop points in seconds (correct for a 44.1 kHz context) and starts at offset 0', async () => {
    const manifest = loadRealManifest();
    const r = await makeRig(manifest, { sampleRate: 44100 });
    const s = manifest.sounds.find((x) => x.id === 'varkan:bld_pour_loop')!;
    const h = play(r, 'bld_pour_loop', { x: 0, z: 0 });
    expect(h).not.toBeNull();
    const src = lastSource(r);
    expect(src.buffer!.sampleRate).toBe(44100);
    expect(src.loop).toBe(true);
    expect(src.loopStart).toBe(s.loop!.startS);
    expect(src.loopEnd).toBe(s.loop!.endS);
    // Seconds, not samples: at 44.1 kHz the sample positions would be 8.8 % off.
    expect(src.loopStart * 44100).toBeCloseTo((s.loop!.startSample / 48000) * 44100, 6);
    expect(src.loopEnd).toBeLessThanOrEqual(src.buffer!.duration + 1e-9);
    expect(src.startOffset).toBe(0);
    r.ctx.advance(20_000);
    expect(src.playing).toBe(true);
    expect(h!.alive).toBe(true);
  });

  it('req.loop = true loops a one-shot sound over the whole buffer', async () => {
    const r = await makeRig(loadRealManifest());
    play(r, 'wpn_mg_t1_fire', { loop: true, x: 0, z: 0 });
    const src = lastSource(r);
    expect(src.loop).toBe(true);
    expect(src.loopStart).toBe(0);
    expect(src.loopEnd).toBe(0);
    expect(src.playbackRate.value).toBe(1);
  });

  it('stop() fades a loop out (default 40 ms) and frees the logical voice at once', async () => {
    const r = await makeRig(loadRealManifest());
    r.ctx.advance(500);
    const h = play(r, 'amb_wind_loop', { gain: 0.8 })!;
    const src = lastSource(r);
    const { gain } = chain(src);
    const t0 = r.ctx.currentTime;
    h.stop();
    expect(h.alive).toBe(false);
    expect(r.vm.voiceCount).toBe(0);
    expect(r.vm.tails).toBe(1);
    expect(src.stopWhen).toBeCloseTo(t0 + 0.04, 9);
    expect(gain.gain.valueAt(t0)).toBeCloseTo(0.8, 9);
    expect(gain.gain.valueAt(t0 + 0.02)).toBeCloseTo(0.4, 6);
    expect(gain.gain.valueAt(t0 + 0.04)).toBe(0);
    expect(gain.gain.count('linearRampToValueAtTime')).toBe(1);
    r.ctx.advance(41);
    expect(src.ended).toBe(true);
    expect(r.vm.tails).toBe(0);
    expect(src.outputs).toHaveLength(0);
    h.stop(); // no-op
    expect(r.vm.tails).toBe(0);
  });

  it('a stop during a running gain ramp fades from the value actually playing (no jump)', async () => {
    const r = await makeRig(loadRealManifest());
    r.ctx.advance(100);
    const h = play(r, 'amb_wind_loop', { gain: 0.1 })!;
    const { gain } = chain(lastSource(r));
    h.setGain(1, 300); // τ 100 ms
    r.ctx.advance(20);
    const cur = gain.gain.value;
    expect(cur).toBeGreaterThan(0.1);
    expect(cur).toBeLessThan(0.5);
    const t0 = r.ctx.currentTime;
    h.stop(40);
    expect(gain.gain.valueAt(t0)).toBeCloseTo(cur, 9);
    expect(gain.gain.valueAt(t0 + 0.01)).toBeLessThan(cur);
  });

  it('stop(0) cuts immediately without a tail', async () => {
    const r = await makeRig(loadRealManifest());
    const h = play(r, 'amb_wind_loop')!;
    const src = lastSource(r);
    h.stop(0);
    expect(r.vm.tails).toBe(0);
    expect(r.vm.voiceCount).toBe(0);
    expect(src.onended).toBeNull();
    r.ctx.advance(0);
    expect(src.ended).toBe(true);
  });
});

describe('VoiceManager: priority and stealing', () => {
  it('an alert (99) displaces a weapon (50) in a full pool; a weapon never displaces alert or ack', async () => {
    const r = await makeRig(loadRealManifest(), { maxVoices: 3 });
    r.ctx.advance(1000);
    const w = play(r, 'wpn_cannon_t3_fire', { x: 0, z: 0 })!;
    const ack = play(r, 'ack_command')!;
    const w2 = play(r, 'wpn_mg_t1_fire', { x: 0, z: 0 })!;
    expect(r.vm.voiceCount).toBe(3);
    const alert = play(r, 'alt_base_attacked');
    expect(alert).not.toBeNull();
    expect(r.vm.voiceCount).toBe(3);
    expect(ack.alive).toBe(true);
    expect(w.alive && w2.alive).toBe(false);
    // Fill the remaining weapon slot with an ack, then weapons cannot get in.
    r.ctx.advance(200);
    const ack2 = play(r, 'ack_structure')!;
    expect(ack2).not.toBeNull();
    expect(r.vm.categoryVoices(categoryIndex('weapon'))).toBe(0);
    for (const name of ['wpn_cannon_t1_fire', 'wpn_missile_fire']) {
      expect(play(r, name, { x: 0, z: 0, gain: 4 })).toBeNull();
      expect(r.vm.lastDrop).toBe('globalLimit');
    }
    expect(alert!.alive && ack.alive && ack2.alive).toBe(true);
  });

  it('global stealing takes the quietest voice with a lower priority', async () => {
    const r = await makeRig(loadRealManifest(), { maxVoices: 3 });
    const a = play(r, 'wpn_cannon_t1_fire', { x: 0, z: 0, gain: 0.9 })!;
    const b = play(r, 'wpn_cannon_t2_fire', { x: 0, z: 0, gain: 0.2 })!;
    const c = play(r, 'imp_bomb', { x: 0, z: 0, gain: 0.5 })!;
    const e = play(r, 'exp_small', { x: 0, z: 0, gain: 0.01 });
    expect(e).not.toBeNull(); // global stealing has no loudness condition
    expect([a.alive, b.alive, c.alive]).toEqual([true, false, true]);
    expect(r.vm.snapshotStats(createVoiceStats()).stolen).toBe(1);
  });

  it('remaining length counts: an almost finished voice is quieter than a fresh one', async () => {
    const r = await makeRig(loadRealManifest(), { maxVoices: 2 });
    const old = play(r, 'wpn_cannon_t3_fire', { x: 0, z: 0, gain: 1 })!; // 1.33 s
    r.ctx.advance(1200);
    const fresh = play(r, 'wpn_cannon_t2_fire', { x: 0, z: 0, gain: 0.3 })!;
    expect(play(r, 'exp_large', { x: 0, z: 0 })).not.toBeNull();
    expect(old.alive).toBe(false);
    expect(fresh.alive).toBe(true);
  });

  it('priority ties are broken by age (oldest first)', async () => {
    const r = await makeRig(loadRealManifest(), { maxVoices: 2 });
    const first = play(r, 'amb_wind_loop', { gain: 0.5 })!;
    const second = play(r, 'amb_water_loop', { gain: 0.5 })!;
    expect(play(r, 'wpn_mg_t1_fire', { x: 0, z: 0 })).not.toBeNull();
    expect(first.alive).toBe(false);
    expect(second.alive).toBe(true);
  });

  it('sound limit: steals the quietest voice of that sound only if the new one is at least as loud', async () => {
    const m = makeManifest({ sounds: [{ id: 'varkan:wpn_x_fire', cooldownMs: 0, maxVoices: 2, durationS: 2 }] });
    const r = await makeRig(m);
    const loud = play(r, 'wpn_x_fire', { gain: 1 })!;
    const quiet = play(r, 'wpn_x_fire', { gain: 0.5 })!;
    expect(play(r, 'wpn_x_fire', { gain: 0.1 })).toBeNull();
    expect(r.vm.lastDrop).toBe('soundLimit');
    const mid = play(r, 'wpn_x_fire', { gain: 0.5 })!; // equal loudness is enough
    expect(mid).not.toBeNull();
    expect([loud.alive, quiet.alive, mid.alive]).toEqual([true, false, true]);
    expect(r.vm.soundVoices(0)).toBe(2);
  });

  it('category limit: steals inside the category, never across', async () => {
    const m = makeManifest({
      sounds: [
        { id: 'varkan:imp_a', category: 'impact', cooldownMs: 0, maxVoices: 8, durationS: 1 },
        { id: 'varkan:imp_b', category: 'impact', cooldownMs: 0, maxVoices: 8, durationS: 1 },
        { id: 'varkan:wpn_c_fire', category: 'weapon', cooldownMs: 0, maxVoices: 8, durationS: 1 },
      ],
      categories: { impact: { maxVoices: 2 } },
    });
    const r = await makeRig(m);
    const w = play(r, 'wpn_c_fire', { gain: 0.01 })!;
    const a = play(r, 'imp_a', { gain: 0.6 })!;
    const b = play(r, 'imp_b', { gain: 0.3 })!;
    expect(play(r, 'imp_a', { gain: 0.2 })).toBeNull();
    expect(r.vm.lastDrop).toBe('categoryLimit');
    expect(play(r, 'imp_a', { gain: 0.4 })).not.toBeNull();
    expect([w.alive, a.alive, b.alive]).toEqual([true, true, false]);
    expect(r.vm.categoryVoices(categoryIndex('impact'))).toBe(2);
  });

  it('running loops are only displaced by a strictly higher priority', async () => {
    const m = makeManifest({
      sounds: [
        { id: 'varkan:bld_x_loop', category: 'build', loop: true, durationS: 2, cooldownMs: 0, maxVoices: 2 },
        { id: 'varkan:bld_y', category: 'build', durationS: 1, cooldownMs: 0, maxVoices: 3 },
      ],
      categories: { build: { maxVoices: 2 } },
    });
    const r = await makeRig(m);
    const l1 = play(r, 'bld_x_loop', { gain: 0.1 })!;
    const l2 = play(r, 'bld_x_loop', { gain: 0.1 })!;
    expect(play(r, 'bld_y', { gain: 1 })).toBeNull();
    expect(r.vm.lastDrop).toBe('categoryLimit');
    expect(play(r, 'bld_x_loop', { gain: 1 })).toBeNull();
    expect(r.vm.lastDrop).toBe('soundLimit');
    expect(l1.alive && l2.alive).toBe(true);
    expect(play(r, 'bld_y', { gain: 1, priorityBoost: 1 })).not.toBeNull();
    expect(l1.alive).toBe(false); // oldest of the two equally quiet loops
    expect(l2.alive).toBe(true);
  });

  it('a boosted voice is never displaced by the plain priority', async () => {
    const r = await makeRig(loadRealManifest(), { maxVoices: 1 });
    const boosted = play(r, 'wpn_mg_t1_fire', { x: 0, z: 0, priorityBoost: 30, gain: 0.01 })!;
    expect(play(r, 'exp_small', { x: 0, z: 0 })).toBeNull(); // 70 < 80
    expect(boosted.alive).toBe(true);
    expect(play(r, 'ack_command')).not.toBeNull(); // 85 > 80
    expect(boosted.alive).toBe(false);
  });

  it('stolen voices fade linearly to 0 within stealFadeMs as tails', async () => {
    const r = await makeRig(loadRealManifest(), { maxVoices: 1 });
    r.ctx.advance(100);
    play(r, 'wpn_cannon_t3_fire', { x: 0, z: 0, gain: 0.7 });
    const victim = lastSource(r);
    const { gain } = chain(victim);
    const t0 = r.ctx.currentTime;
    play(r, 'alt_base_attacked');
    expect(r.vm.tails).toBe(1);
    expect(r.vm.voiceCount).toBe(1);
    expect(victim.stopWhen).toBeCloseTo(t0 + 0.008, 9);
    expect(gain.gain.valueAt(t0)).toBeCloseTo(0.7, 9);
    expect(gain.gain.valueAt(t0 + 0.004)).toBeCloseTo(0.35, 6);
    expect(gain.gain.valueAt(t0 + 0.008)).toBe(0);
    r.ctx.advance(9);
    expect(victim.ended).toBe(true);
    expect(r.vm.tails).toBe(0);
  });

  it('limits tails to tailBudget by cutting the oldest tail', async () => {
    const r = await makeRig(loadRealManifest(), { maxVoices: 1, tailBudget: 2 });
    const sources: FakeAudioBufferSourceNode[] = [];
    const names = ['wpn_cannon_t1_fire', 'exp_small', 'sig_sounding', 'mus_victory', 'alt_commander_danger'];
    for (const n of names) {
      expect(play(r, n, { x: 0, z: 0 }), n).not.toBeNull();
      sources.push(lastSource(r));
      expect(r.vm.tails).toBeLessThanOrEqual(2);
    }
    expect(r.vm.tails).toBe(2);
    // The first two victims were cut hard (no handler, stop now), the last two fade.
    expect(sources[0]!.onended).toBeNull();
    expect(sources[1]!.onended).toBeNull();
    expect(sources[2]!.onended).not.toBeNull();
    r.ctx.advance(0);
    expect(r.ctx.liveSources).toBe(1 + 2);
  });

  it('a late onended of an earlier voice never frees the voice now in the slot', async () => {
    const r = await makeRig(loadRealManifest(), { maxVoices: 1 });
    const hA = play(r, 'wpn_cannon_t3_fire', { x: 0, z: 0 })!;
    const srcA = lastSource(r);
    const slotHandler = srcA.onended!;
    const hB = play(r, 'alt_base_attacked')!; // steals A, reuses the slot
    const srcB = lastSource(r);
    expect(hA.alive).toBe(false);
    expect(srcA.onended).not.toBe(slotHandler); // re-pointed to the tail record
    // The slot handler fires late for A (real browsers set target = A).
    const late = new Event('ended');
    Object.defineProperty(late, 'target', { value: srcA });
    slotHandler(late);
    expect(hB.alive).toBe(true);
    expect(r.vm.voiceCount).toBe(1);
    // A's real end only frees its tail.
    r.ctx.advance(20);
    expect(srcA.ended).toBe(true);
    expect(hB.alive).toBe(true);
    expect(r.vm.tails).toBe(0);
    // Stale handle operations are no-ops for the new voice.
    const gB = chain(srcB).gain;
    const before = gB.gain.calls.length;
    hA.setGain(0.1);
    hA.setPosition(50, 50);
    hA.setRate(2);
    hA.stop(0);
    expect(gB.gain.calls.length).toBe(before);
    expect(hB.alive).toBe(true);
    expect(srcB.stopWhen).toBeNull();
    // After B ends the slot is free again and a new voice gets a new handle.
    r.ctx.advance(3000);
    expect(hB.alive).toBe(false);
    const hC = play(r, 'ack_command')!;
    expect(hC.id).not.toBe(hB.id);
    expect(hB.alive).toBe(false);
  });
});

describe('VoiceManager: spatial', () => {
  it('culls inaudible requests before allocating or stealing a voice', async () => {
    const r = await makeRig(loadRealManifest(), { maxVoices: 1 });
    const w = play(r, 'wpn_mg_t1_fire', { x: 0, z: 0, gain: 0.01 })!;
    const created = r.ctx.createdByKind.source;
    expect(play(r, 'exp_large', { x: 0, z: 5000 })).toBeNull(); // spatialize → false
    expect(r.vm.lastDrop).toBe('culled');
    expect(play(r, 'exp_large', { x: 0, z: 999.999 })).toBeNull(); // gain 1e-6 < −48 dB
    expect(r.vm.lastDrop).toBe('culled');
    expect(play(r, 'exp_large', { x: 0, z: 0, gain: 0.001 })).toBeNull();
    expect(r.ctx.createdByKind.source).toBe(created);
    expect(w.alive).toBe(true);
    expect(r.vm.snapshotStats(createVoiceStats()).stolen).toBe(0);
  });

  it('applies gain × spatial gain and pan; non-spatial sounds or requests without x/z play centred', async () => {
    const r = await makeRig(loadRealManifest());
    play(r, 'wpn_mg_t1_fire', { x: -50, z: 500, gain: 0.8 });
    let c = chain(lastSource(r));
    expect(c.gain.gain.value).toBeCloseTo(0.4, 9);
    expect(c.panner.pan.value).toBeCloseTo(-0.5, 9);
    const calls = r.spatial.calls;
    play(r, 'ui_click', { x: 90, z: 0 }); // ui is not spatial
    c = chain(lastSource(r));
    expect(c.panner.pan.value).toBe(0);
    play(r, 'exp_small', { gain: 0.5 }); // no position
    c = chain(lastSource(r));
    expect(c.panner.pan.value).toBe(0);
    expect(c.gain.gain.value).toBe(0.5);
    expect(r.spatial.calls).toBe(calls);
  });

  it('setPosition re-spatialises with ramps; setGain/setRate ramp', async () => {
    const r = await makeRig(loadRealManifest());
    r.ctx.advance(100);
    const h = play(r, 'bld_pour_loop', { x: 0, z: 0 })!;
    const src = lastSource(r);
    const c = chain(src);
    h.setPosition(100, 500);
    expect(c.panner.pan.count('setTargetAtTime')).toBe(1);
    expect(c.gain.gain.count('setTargetAtTime')).toBe(1);
    r.ctx.advance(200);
    expect(c.panner.pan.value).toBeCloseTo(1, 3);
    expect(c.gain.gain.value).toBeCloseTo(0.5, 3);
    h.setGain(0.5);
    r.ctx.advance(200);
    expect(c.gain.gain.value).toBeCloseTo(0.25, 3);
    h.setGain(1, 0);
    expect(c.gain.gain.value).toBeCloseTo(0.5, 9);
    h.setRate(1.5);
    expect(src.playbackRate.count('setTargetAtTime')).toBe(1);
    r.ctx.advance(200);
    expect(src.playbackRate.value).toBeCloseTo(1.5, 3);
    // Out of range: silent but alive (loops keep their place until stolen).
    h.setPosition(0, 5000);
    r.ctx.advance(200);
    expect(c.gain.gain.value).toBeCloseTo(0, 3);
    expect(h.alive).toBe(true);
    expect(c.gain.gain.count('setValueAtTime')).toBe(1); // only the explicit rampMs = 0
  });

  it('refreshSpatial re-applies the model to running spatial voices', async () => {
    const r = await makeRig(loadRealManifest());
    play(r, 'bld_pour_loop', { x: 20, z: 0 });
    const c = chain(lastSource(r));
    r.vm.setSpatialModel({
      setListener: () => {},
      spatialize: (_c, _x, _z, out) => {
        out.gain = 0.25;
        out.pan = -1;
        return true;
      },
    });
    r.vm.refreshSpatial();
    r.ctx.advance(300);
    expect(c.gain.gain.value).toBeCloseTo(0.25, 3);
    expect(c.panner.pan.value).toBeCloseTo(-1, 3);
  });
});

describe('VoiceManager: stats and housekeeping', () => {
  it('fills a caller-owned stats object', async () => {
    const r = await makeRig(loadRealManifest(), { maxVoices: 2 });
    const s = createVoiceStats();
    play(r, 'wpn_mg_t1_fire', { x: 0, z: 0 });
    play(r, 'wpn_mg_t1_fire', { x: 0, z: 0 }); // cooldown
    play(r, 'ack_command');
    play(r, 'alt_gong'); // steals the weapon
    play(r, 'nope');
    r.vm.countDrop('locked');
    const out = r.vm.snapshotStats(s);
    expect(out).toBe(s);
    expect(s.voices).toBe(2);
    expect(s.peakVoices).toBe(2);
    expect(s.tails).toBe(1);
    expect(s.played).toBe(3);
    expect(s.stolen).toBe(1);
    expect(s.byCategory[categoryIndex('ack')]).toBe(1);
    expect(s.byCategory[categoryIndex('alert')]).toBe(1);
    expect(s.byCategory[categoryIndex('weapon')]).toBe(0);
    expect(s.dropped[dropReasonIndex('cooldown')]).toBe(1);
    expect(s.dropped[dropReasonIndex('unknownSound')]).toBe(1);
    expect(s.dropped[dropReasonIndex('locked')]).toBe(1);
    expect(s.lastDrop).toBe('locked');
    expect(r.vm.lastDrop).toBe('locked');
    r.vm.resetStats();
    r.vm.snapshotStats(s);
    expect([s.played, s.stolen, s.peakVoices, s.lastDrop]).toEqual([0, 0, 2, null]);
    expect(s.dropped.every((d) => d === 0)).toBe(true);
  });

  it('update() reclaims a voice whose onended never arrives', async () => {
    const r = await makeRig(loadRealManifest());
    const h = play(r, 'ui_click')!; // 0.05 s
    const src = lastSource(r);
    src.onended = null; // lost event
    r.ctx.advance(400);
    r.vm.update();
    expect(h.alive).toBe(true); // within the grace period
    r.ctx.advance(300);
    r.vm.update();
    expect(h.alive).toBe(false);
    expect(r.vm.voiceCount).toBe(0);
  });

  it('stopAll and dispose leave no voices or tails behind', async () => {
    const r = await makeRig(loadRealManifest());
    for (const n of ['amb_wind_loop', 'bld_pour_loop', 'mus_victory', 'ui_click']) play(r, n, { x: 0, z: 0 });
    r.vm.stopAll();
    expect(r.vm.voiceCount).toBe(0);
    expect(r.vm.tails).toBe(4);
    r.ctx.advance(50);
    expect(r.vm.tails).toBe(0);
    expect(r.ctx.liveSources).toBe(0);
    play(r, 'amb_wind_loop');
    r.vm.dispose();
    expect(r.vm.voiceCount).toBe(0);
    r.ctx.advance(0);
    expect(r.ctx.liveSources).toBe(0);
    expect((r.mixer.graph.input.ambience as FakeGainNode).inputs).toHaveLength(0);
  });
});
