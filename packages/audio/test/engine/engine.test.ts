import { describe, expect, it, vi } from 'vitest';
import { ALERT_DUCK_BED_DB, ALERT_DUCK_SFX_DB, createAudioEngine } from '../../src/engine/index.ts';
import * as barrel from '../../src/index.ts';
import { dbToGain, sliderToGain } from '../../src/mixer/index.ts';
import { memorySettingsStore } from '../../src/settings/index.ts';
import { ArrayEventSource, DEFAULT_AUDIO_SETTINGS, FX_ONE, type AlertRecord } from '../../src/types.ts';
import { DEFAULT_EVENT_TYPES } from '../../src/events/index.ts';
import { battleVisualName } from '../../bench/scenario.ts';
import { FakeAudioContext, loadRealManifest, type FakeAudioBufferSourceNode } from '../support/index.ts';
import { CountingTarget, FakeVisibilityDocument, fakeAudioServer, fakeHeaderDecoder, makeEngineRig, unlockByGesture } from './rig.ts';

const WX = Math.round(5 * FX_ONE);
const WZ = Math.round(-4 * FX_ONE);

/** A batch with a few located weapon shots and one small death. */
function smallBatch(tick = 0): ArrayEventSource {
  const b = new ArrayEventSource(16);
  for (let i = 0; i < 4; i++) b.push(DEFAULT_EVENT_TYPES.weaponFire, 1 + i, tick, i * 60, 0, WX, 0, WZ, 0, 0);
  b.push(DEFAULT_EVENT_TYPES.unitDeath, 0, tick, 10, 0, WX, 0, WZ, 0, 0);
  return b;
}

/** Latest started source of the fake context. */
function lastSource(ctx: FakeAudioContext): FakeAudioBufferSourceNode {
  const a = ctx.activeSources();
  return a[a.length - 1]!;
}

describe('AudioEngine facade', () => {
  it('exposes the documented API through the barrel and the engine module', () => {
    expect(typeof barrel.createAudioEngine).toBe('function');
    for (const name of [
      'parseManifest',
      'SoundCatalog',
      'createDecodeChain',
      'SoundLoader',
      'Mixer',
      'VoiceManager',
      'LoopSet',
      'CameraSpatialModel',
      'AlertQueue',
      'EventRouter',
      'parseEventSoundMap',
      'demuxWebmOpus',
      'AutoplayUnlocker',
      'createSettingsController',
      'ArrayEventSource',
    ]) {
      expect(barrel, name).toHaveProperty(name);
    }
  });

  it('unlock flow: locked → gesture → running; earlier events are dropped, not replayed', async () => {
    const r = makeEngineRig({ engine: { visualName: battleVisualName } });
    const { engine, ctx, target } = r;
    const states: string[] = [];
    engine.onStateChange((s) => states.push(s));
    expect(engine.state).toBe('locked');
    expect(target.listeners).toBeGreaterThan(0);

    engine.handleEvents(smallBatch());
    expect(engine.playUi('ack_pip_direct')).toBeNull();
    expect(engine.play({ sound: 'exp_small' })).toBeNull();
    engine.update();
    let s = engine.stats();
    expect(s.played).toBe(0);
    expect(s.voices).toBe(0);
    expect(s.dropped.locked).toBeGreaterThanOrEqual(7);
    expect(s.events).toBe(5);
    expect(ctx.startedSources).toBe(0);

    await unlockByGesture(r);
    expect(engine.state).toBe('running');
    expect(states).toEqual(['running']);
    expect(target.listeners).toBe(0);
    const silent = ctx.startedSources; // the unlocker's one-sample silence
    // Nothing from the locked phase is played afterwards.
    for (let i = 0; i < 10; i++) {
      ctx.advance(16);
      engine.update();
    }
    expect(engine.stats().played).toBe(0);
    expect(ctx.startedSources).toBe(silent);

    engine.handleEvents(smallBatch(1));
    s = engine.stats();
    expect(s.played).toBeGreaterThanOrEqual(2);
    expect(s.voices).toBe(s.played);
    await engine.dispose();
  });

  it('weaponSounds merge over the map; eventCodec reaches the router', async () => {
    const profiles: number[] = [];
    const run = async (withData: boolean): Promise<{ played: number; unmapped: number }> => {
      const r = makeEngineRig({
        engine: {
          visualName: (v) => (v === 77 ? 'core:wpn_new_gun' : undefined),
          ...(withData
            ? {
                weaponSounds: { 'core:wpn_new_gun': { sound: 'wpn_cannon_t2_fire', impact: 'shell' } },
                eventCodec: { visualDeathProfile: (v: number) => (profiles.push(v), { sizeClass: 1, air: false, structure: false }) },
              }
            : {}),
        },
      });
      await unlockByGesture(r);
      const b = new ArrayEventSource(4);
      b.push(DEFAULT_EVENT_TYPES.weaponFire, 77, 0, 0, 0, WX, 0, WZ, 0, 0);
      b.push(DEFAULT_EVENT_TYPES.unitDeath, 55, 0, 128, 0, WX, 0, WZ, 3, 0);
      r.engine.handleEvents(b);
      const s = r.engine.stats();
      await r.engine.dispose();
      return { played: s.played, unmapped: s.eventsUnmapped };
    };
    const without = await run(false);
    const withData = await run(true);
    expect(withData.played).toBe(2);
    expect(withData.unmapped).toBe(0);
    expect(without.played + without.unmapped).toBeGreaterThanOrEqual(1);
    expect(profiles).toEqual([55]);
    expect(() => createAudioEngine({ baseUrl: '/', context: new FakeAudioContext(), manifest: loadRealManifest(), weaponSounds: { 'bad ref': 'x' }, settingsStore: null, unlockTarget: null })).toThrow(/weapon ref/);
  });

  it('autoplay blocked: stays locked until the browser grants the gesture', async () => {
    const r = makeEngineRig({ context: { autoplay: 'blocked' } });
    r.target.gesture();
    await Promise.resolve();
    expect(r.engine.state).toBe('locked');
    r.ctx.grantAutoplay();
    await Promise.resolve();
    await Promise.resolve();
    expect(r.engine.state).toBe('running');
    // A later OS suspension re-locks the gate as 'suspended' (events dropped again).
    r.ctx.simulateStateChange('interrupted');
    expect(r.engine.state).toBe('suspended');
    r.engine.handleEvents(smallBatch());
    expect(r.engine.stats().played).toBe(0);
    await r.engine.dispose();
  });

  it('explicit unlock() resolves true and starts keyed loops that were set while locked', async () => {
    const r = makeEngineRig();
    r.engine.setLoop('build:0', { sound: 'bld_pour_loop', x: 0, z: 0 });
    expect(r.engine.stats().voices).toBe(0);
    expect(r.engine.stats().dropped.locked).toBe(0); // loop retries are not counted as drops
    await expect(r.engine.unlock()).resolves.toBe(true);
    expect(r.engine.stats().voices).toBe(1);
    expect(r.engine.loops!.handle('build:0')!.alive).toBe(true);
    await r.engine.dispose();
  });

  it('ack under full load starts synchronously (stealing a lower priority voice)', async () => {
    const r = makeEngineRig();
    await unlockByGesture(r);
    const cat = r.engine.catalog!;
    // Fill all 32 voices with looping low-priority sounds (they never end on their own).
    for (let i = 0; i < cat.size && r.engine.voices!.voiceCount < 32; i++) {
      const s = cat.byIndex(i);
      if (s.priority >= 80) continue;
      for (let k = 0; k < s.maxVoices && r.engine.voices!.voiceCount < 32; k++) {
        r.engine.play({ sound: i, x: 0, z: 0, loop: true });
        r.ctx.advance(s.cooldownMs + 1);
      }
    }
    expect(r.engine.voices!.voiceCount).toBe(32);
    const stolenBefore = r.engine.stats().stolen;
    const started = r.ctx.startedSources;
    const h = r.engine.playUi('ack_pip_direct');
    expect(h).not.toBeNull();
    expect(h!.alive).toBe(true);
    // Started inside the call: a new source exists and was started at time 0 (= immediately).
    expect(r.ctx.startedSources).toBe(started + 1);
    const src = lastSource(r.ctx);
    expect(src.started).toBe(true);
    expect(src.startWhen).toBe(0);
    expect(r.engine.stats().stolen).toBe(stolenBefore + 1);
    expect(r.engine.stats().voices).toBe(32);
    const ui = r.engine.playUi('ui_cmd_move');
    expect(ui).not.toBeNull();
    expect(lastSource(r.ctx).startWhen).toBe(0);
    expect(r.engine.stats().stolen).toBe(stolenBefore + 2);
    await r.engine.dispose();
  });

  it('alert: ducks sfx (−6 dB) and music/ambience (−8 dB), history + jumpToLastAlert', async () => {
    const records: AlertRecord[] = [];
    const r = makeEngineRig({ engine: { onAlert: (a) => records.push(a) } });
    await unlockByGesture(r);
    expect(r.engine.alert({ kind: 'alt_base_attacked', x: 10, z: 20 })).toBe(true);
    r.engine.update();
    expect(records).toHaveLength(1);
    expect(records[0]!.soundId).toBe('common:alt_base_attacked');
    expect(r.engine.stats().voicesByCategory.alert).toBe(1);
    expect(r.engine.mixer.duckLevel('sfx')).toBeCloseTo(dbToGain(ALERT_DUCK_SFX_DB), 6);
    expect(r.engine.mixer.duckLevel('music')).toBeCloseTo(dbToGain(ALERT_DUCK_BED_DB), 6);
    expect(r.engine.mixer.duckLevel('ambience')).toBeCloseTo(dbToGain(ALERT_DUCK_BED_DB), 6);
    expect(r.engine.mixer.duckLevel('alerts')).toBe(1);
    r.ctx.advance(30);
    expect(r.engine.mixer.graph.duck.sfx.gain.value).toBeLessThan(0.7);

    expect(r.engine.jumpToLastAlert()).toBe(true);
    expect(r.jumps).toEqual([{ x: 10, z: 20 }]);
    expect(r.engine.alertHistory()[0]!.kind).toBe('alt_base_attacked');
    expect(r.engine.stats().alertsQueued).toBe(1);
    await r.engine.dispose();
  });

  it('alert location exception is voiced (alert sounds bypass the voice-manager cooldown)', async () => {
    const r = makeEngineRig();
    await unlockByGesture(r);
    expect(r.engine.alert({ kind: 'alt_base_attacked', x: 0, z: 0 })).toBe(true);
    r.engine.update();
    for (let i = 0; i < 120; i++) {
      r.ctx.advance(16);
      r.engine.update();
    }
    // 15 s repeat interval, but a clearly different location after ≥ 1.5 s is announced.
    expect(r.engine.alert({ kind: 'alt_base_attacked', x: 300, z: 300 })).toBe(true);
    r.engine.update();
    expect(r.engine.alerts!.stats.voiced).toBe(2);
    expect(r.engine.stats().dropped.cooldown).toBe(0);
    // Same location inside the interval stays suppressed by the queue.
    expect(r.engine.alert({ kind: 'alt_base_attacked', x: 301, z: 300 })).toBe(false);
    await r.engine.dispose();
  });

  it('alerts while locked are announced silently and can be jumped to', async () => {
    const r = makeEngineRig();
    const b = new ArrayEventSource(4);
    b.push(DEFAULT_EVENT_TYPES.alert, 0, 0, 0, 0, Math.round(-30 * FX_ONE), 0, Math.round(12 * FX_ONE), 3, 0);
    r.engine.handleEvents(b);
    r.engine.update();
    expect(r.engine.alertHistory()).toHaveLength(1);
    expect(r.engine.alerts!.stats.voiced).toBe(0);
    expect(r.ctx.startedSources).toBe(0);
    expect(r.engine.jumpToLastAlert()).toBe(true);
    expect(r.jumps).toEqual([{ x: -30, z: 12 }]);
    await r.engine.dispose();
  });

  it('settings change bus gains (ramped) and is persisted; mute drops one-shots', async () => {
    const r = makeEngineRig();
    await unlockByGesture(r);
    const user = r.engine.mixer.graph.user;
    expect(user.sfx.gain.value).toBeCloseTo(sliderToGain(DEFAULT_AUDIO_SETTINGS.sfx), 6);
    r.engine.settings.set({ sfx: 0.5, master: 1 });
    expect(r.store.saves).toBeGreaterThan(0);
    expect(r.store.value).toMatchObject({ sfx: 0.5, master: 1 });
    r.ctx.advance(200);
    expect(user.sfx.gain.value).toBeCloseTo(0.25, 3);
    expect(user.master.gain.value).toBeCloseTo(1, 3);

    // Persisted values win on the next start.
    const again = createAudioEngine({
      context: new FakeAudioContext(),
      manifest: r.manifest,
      baseUrl: '/audio/',
      settingsStore: r.store,
      unlockTarget: null,
      visibilityDocument: null,
    });
    expect(again.settings.get().sfx).toBe(0.5);
    expect(again.mixer.volume('sfx')).toBe(0.5);
    await again.dispose();

    r.engine.settings.set({ muted: true });
    expect(r.engine.muted).toBe(true);
    expect(r.engine.play({ sound: 'exp_small', x: 0, z: 0 })).toBeNull();
    expect(r.engine.stats().dropped.muted).toBe(1);
    r.engine.settings.set({ muted: false });
    expect(r.engine.play({ sound: 'exp_small', x: 0, z: 0 })).not.toBeNull();

    // Hidden tab mutes (source 'hidden'); visible again lifts it.
    r.doc.setHidden(true);
    expect(r.engine.mixer.isMutedBy('hidden')).toBe(true);
    r.doc.setHidden(false);
    expect(r.engine.mixer.isMutedBy('hidden')).toBe(false);
    await r.engine.dispose();
  });

  it('lazy loading: a notLoaded sound is fetched and plays on the next request', async () => {
    const manifest = loadRealManifest();
    const server = fakeAudioServer(manifest);
    const r = makeEngineRig({ manifest, preload: false, engine: { fetch: server.fetch as unknown as typeof fetch } });
    r.ctx.setDecoder(fakeHeaderDecoder);
    await unlockByGesture(r);
    expect(r.engine.play({ sound: 'exp_small', x: 0, z: 0 })).toBeNull();
    expect(r.engine.stats().dropped.notLoaded).toBe(1);
    const idx = r.engine.catalog!.resolveIndex('exp_small', 'varkan');
    await r.engine.loader!.ensure(idx);
    expect(server.requests.some((u) => u.startsWith('/audio/varkan/exp_small.v'))).toBe(true);
    expect(r.engine.play({ sound: 'exp_small', x: 0, z: 0 })).not.toBeNull();

    const report = await r.engine.load({ tags: ['MS5'] });
    expect(report.requested).toBe(17);
    expect(report.failed).toBe(0);
    const s = r.engine.stats();
    expect(s.loadedSounds).toBe(17);
    expect(s.decodedBytes).toBeGreaterThan(0);
    expect(s.decodePaths.native).toBeGreaterThan(0);
    await r.engine.dispose();
  });

  it('manifestUrl: engine is usable before the manifest arrives, core built on ready', async () => {
    const manifest = loadRealManifest();
    const server = fakeAudioServer(manifest);
    const ctx = new FakeAudioContext();
    const engine = createAudioEngine({
      context: ctx,
      baseUrl: '/audio/',
      fetch: server.fetch as unknown as typeof fetch,
      settingsStore: null,
      unlockTarget: null,
      visibilityDocument: null,
      clock: () => ctx.nowMs,
    });
    expect(engine.catalog).toBeNull();
    engine.handleEvents(smallBatch());
    engine.setLoop('amb', { sound: 'amb_wind_loop' });
    engine.setListener({ focusX: 0, focusZ: 0, height: 40, viewHalfWidth: 20, rightX: 1, rightZ: 0 });
    expect(engine.stats().dropped.notLoaded).toBe(5);
    await engine.ready;
    expect(server.requests[0]).toBe('/audio/manifest.json');
    expect(engine.catalog!.size).toBe(manifest.sounds.length);
    expect(engine.loops!.has('amb')).toBe(true);
    await engine.dispose();
  });

  it('manifestUrl failure rejects ready and load()', async () => {
    const engine = createAudioEngine({
      context: new FakeAudioContext(),
      baseUrl: '/audio/',
      manifestUrl: '/nope.json',
      fetch: (() => Promise.resolve({ ok: false, status: 404 })) as unknown as typeof fetch,
      settingsStore: null,
      unlockTarget: null,
      visibilityDocument: null,
    });
    await expect(engine.ready).rejects.toThrow(/404/);
    await expect(engine.load()).rejects.toThrow(/404/);
    await engine.dispose();
  });

  it('stats: latencies in ms, main-thread timing ring per frame', async () => {
    let t = 0;
    const r = makeEngineRig({ engine: { timer: () => (t += 0.01) } });
    await unlockByGesture(r);
    for (let f = 0; f < 50; f++) {
      r.engine.handleEvents(smallBatch(f));
      r.engine.update();
      r.ctx.advance(16);
    }
    const s = r.engine.stats();
    expect(s.baseLatencyMs).toBeCloseTo(5, 9);
    expect(s.outputLatencyMs).toBeCloseTo(20, 9);
    expect(s.mainJs.samples).toBe(50);
    // Each frame: handleEvents + update, each measured as one 0.01 ms step.
    expect(s.mainJs.p50).toBeCloseTo(0.02, 9);
    expect(s.mainJs.max).toBeCloseTo(0.02, 9);
    r.engine.resetStats();
    expect(r.engine.stats().mainJs.samples).toBe(0);
    expect(r.engine.stats().played).toBe(0);
    await r.engine.dispose();
  });

  it('dispose: stops loops, removes all listeners, closes an owned context', async () => {
    const ctx = new FakeAudioContext();
    const target = new CountingTarget();
    const doc = new FakeVisibilityDocument();
    const engine = createAudioEngine({
      context: () => ctx,
      manifest: loadRealManifest(),
      baseUrl: '/audio/',
      settingsStore: memorySettingsStore(),
      unlockTarget: target,
      visibilityDocument: doc,
      clock: () => ctx.nowMs,
    });
    const sub = vi.fn();
    engine.onStateChange(sub);
    expect(target.listeners).toBeGreaterThan(0);
    expect(doc.listeners).toBe(1);
    expect(ctx.onstatechange).not.toBeNull();
    await engine.dispose();
    expect(engine.state).toBe('closed');
    expect(target.listeners).toBe(0);
    expect(doc.listeners).toBe(0);
    expect(ctx.onstatechange).toBeNull();
    expect(ctx.state).toBe('closed');
    expect(ctx.liveSources).toBe(0);
    expect(engine.play({ sound: 'exp_small' })).toBeNull();
    expect(engine.alert({ kind: 'alt_gong' })).toBe(false);
    await expect(engine.unlock()).resolves.toBe(false);
    await engine.dispose(); // idempotent
    expect(ctx.closeCalls).toBe(1);
    expect(sub).not.toHaveBeenCalled();
  });

  it('dispose leaves a context passed in by the caller open and stops running loops', async () => {
    const r = makeEngineRig();
    await unlockByGesture(r);
    r.engine.setLoop('build:0', { sound: 'bld_pour_loop', x: 0, z: 0 });
    expect(r.ctx.liveSources).toBeGreaterThan(0);
    const loopSrc = lastSource(r.ctx);
    await r.engine.dispose();
    expect(r.ctx.state).toBe('running');
    // Hard stop at the current time (the fake ends stopped sources on the next clock step).
    expect(loopSrc.stopWhen).toBe(r.ctx.currentTime);
    r.ctx.advance(1);
    expect(r.ctx.liveSources).toBe(0);
    expect(r.ctx.closeCalls).toBe(0);
  });
});
