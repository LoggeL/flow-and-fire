import { describe, expect, it } from 'vitest';
import { LoopSet, createVoiceStats } from '../../src/voices/index.ts';
import type { FakeAudioBufferSourceNode, FakeGainNode, FakeStereoPannerNode } from '../support/index.ts';
import { loadRealManifest } from '../support/index.ts';
import { makeRig } from './fakes.ts';

function lastSource(src: readonly FakeAudioBufferSourceNode[]): FakeAudioBufferSourceNode {
  return src[src.length - 1]!;
}

describe('LoopSet', () => {
  it('starts a keyed loop, updates gain/position/rate with ramps and stops it with a fade', async () => {
    const manifest = loadRealManifest();
    const r = await makeRig(manifest);
    r.ctx.advance(100);
    const loops = new LoopSet(r.vm);
    const h = loops.set('build:1', { sound: 'bld_pour_loop', x: 0, z: 0, gain: 0.5 }, r.ctx.nowMs)!;
    expect(h).not.toBeNull();
    expect(loops.size).toBe(1);
    const src = lastSource(r.ctx.activeSources());
    expect(src.loop).toBe(true);
    const loop = manifest.sounds.find((s) => s.id === 'varkan:bld_pour_loop')!.loop!;
    expect([src.loopStart, src.loopEnd]).toEqual([loop.startS, loop.endS]);
    const gain = src.outputs[0] as FakeGainNode;
    const panner = gain.outputs[0] as FakeStereoPannerNode;

    // Same values: nothing is re-sent.
    const g0 = gain.gain.calls.length;
    expect(loops.set('build:1', { sound: 'bld_pour_loop', x: 0, z: 0, gain: 0.5 }, r.ctx.nowMs)).toBe(h);
    expect(gain.gain.calls.length).toBe(g0);
    expect(r.ctx.startedSources).toBe(1);

    loops.set('build:1', { sound: 'bld_pour_loop', x: 50, z: 0, gain: 1, rate: 1.25 }, r.ctx.nowMs);
    expect(gain.gain.count('setTargetAtTime')).toBeGreaterThan(0);
    expect(panner.pan.count('setTargetAtTime')).toBe(1);
    expect(src.playbackRate.count('setTargetAtTime')).toBe(1);
    r.ctx.advance(200);
    expect(gain.gain.value).toBeCloseTo(1, 3);
    expect(panner.pan.value).toBeCloseTo(0.5, 3);
    expect(src.playbackRate.value).toBeCloseTo(1.25, 3);
    expect(r.ctx.startedSources).toBe(1);

    const t0 = r.ctx.currentTime;
    expect(loops.set('build:1', null, r.ctx.nowMs)).toBeNull();
    expect(loops.size).toBe(0);
    expect(h.alive).toBe(false);
    expect(src.stopWhen).toBeCloseTo(t0 + 0.04, 9);
    expect(gain.gain.count('linearRampToValueAtTime')).toBe(1);
    r.ctx.advance(50);
    expect(src.ended).toBe(true);
    expect(r.vm.tails).toBe(0);
  });

  it('restarts a stolen loop at the next opportunity (retry interval)', async () => {
    const r = await makeRig(loadRealManifest(), { maxVoices: 1 });
    const loops = new LoopSet(r.vm, { retryMs: 100 });
    const req = { sound: 'amb_wind_loop' };
    const h1 = loops.set('amb', req, r.ctx.nowMs)!;
    expect(h1).not.toBeNull();
    const alert = r.vm.play({ sound: 'alt_base_attacked' }, r.ctx.nowMs)!;
    expect(h1.alive).toBe(false);
    expect(loops.handle('amb')).toBeNull();
    // While the alert holds the only voice, restarts fail (global limit) and are retried at most every 100 ms.
    expect(loops.set('amb', req, r.ctx.nowMs)).toBeNull();
    const dropsAfterFirstRetry = r.vm.snapshotStats(createVoiceStats()).dropped.reduce((a, b) => a + b, 0);
    for (let k = 0; k < 5; k++) {
      r.ctx.advance(10);
      loops.update(r.ctx.nowMs);
      loops.set('amb', req, r.ctx.nowMs);
    }
    expect(r.vm.snapshotStats(createVoiceStats()).dropped.reduce((a, b) => a + b, 0)).toBe(dropsAfterFirstRetry);
    // Alert over (1.25 s) → the next update brings the loop back.
    r.ctx.advance(1300);
    expect(alert.alive).toBe(false);
    loops.update(r.ctx.nowMs);
    const h2 = loops.handle('amb');
    expect(h2).not.toBeNull();
    expect(h2).not.toBe(h1);
    expect(r.ctx.activeSources().filter((s) => s.loop)).toHaveLength(1);
  });

  it('switching the sound of a key stops the old loop and starts the new one', async () => {
    const r = await makeRig(loadRealManifest());
    const loops = new LoopSet(r.vm);
    const a = loops.set('eco', { sound: 'eco_mex_loop', x: 0, z: 0 }, r.ctx.nowMs)!;
    const b = loops.set('eco', { sound: 'eco_pgen_loop', x: 0, z: 0 }, r.ctx.nowMs)!;
    expect(a.alive).toBe(false);
    expect(b.alive).toBe(true);
    expect(loops.size).toBe(1);
    expect(r.vm.voiceCount).toBe(1);
    expect(r.vm.tails).toBe(1);
  });

  it('keeps independent keys; removal keeps the others addressable; clear stops everything', async () => {
    const r = await makeRig(loadRealManifest());
    const loops = new LoopSet(r.vm);
    loops.set('a', { sound: 'eco_mex_loop', x: 0, z: 0 }, r.ctx.nowMs);
    loops.set('b', { sound: 'eco_pgen_loop', x: 0, z: 0 }, r.ctx.nowMs);
    loops.set('c', { sound: 'eco_hydro_loop', x: 0, z: 0 }, r.ctx.nowMs);
    loops.set('a', null, r.ctx.nowMs);
    expect(loops.has('a')).toBe(false);
    expect(loops.handle('b')!.alive && loops.handle('c')!.alive).toBe(true);
    loops.set('c', { sound: 'eco_hydro_loop', x: 10, z: 0 }, r.ctx.nowMs);
    expect(loops.size).toBe(2);
    loops.clear();
    expect(loops.size).toBe(0);
    expect(r.vm.voiceCount).toBe(0);
    r.ctx.advance(50);
    expect(r.ctx.liveSources).toBe(0);
  });

  it('a culled or not yet loaded loop starts once it becomes possible', async () => {
    const r = await makeRig(loadRealManifest(), { loaded: false });
    const loops = new LoopSet(r.vm, { retryMs: 0 });
    expect(loops.set('m', { sound: 'mov_tracks_loop', x: 0, z: 5000 }, r.ctx.nowMs)).toBeNull();
    expect(r.resolver.loadRequests.length).toBe(1);
    r.resolver.setLoaded('varkan:mov_tracks_loop', true);
    expect(loops.set('m', { sound: 'mov_tracks_loop', x: 0, z: 5000 }, r.ctx.nowMs)).toBeNull();
    expect(r.vm.lastDrop).toBe('culled');
    expect(loops.set('m', { sound: 'mov_tracks_loop', x: 0, z: 100 }, r.ctx.nowMs)).not.toBeNull();
  });
});
