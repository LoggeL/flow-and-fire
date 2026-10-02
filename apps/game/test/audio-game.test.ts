import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeSimBin } from '@faf/blueprints/simbin';
import { describe, expect, it, vi } from 'vitest';
import { CommandBatchEncoder, EcoField, EconomyEventFlags, EventType, FrameFlags, FrameReader, FrameWriter, Op, frameCapacityBytes } from '@faf/protocol';
import { DEFAULT_EVENT_SOUND_MAP, EventRouter, ArrayEventSource, weaponSound, type AlertRequest } from '@faf/audio';
import { GAME_AUDIO_EVENT_TYPES, STORAGE_FULL_ALERT_INDEX, gameAudioBaseUrl, installGameAudio, listenerFromCamera, type GameAudioOptions } from '../src/audio/index.ts';
import { FakeAudioContext, loadRealManifest } from '../../../packages/audio/test/support/index.ts';
import { CountingTarget, fakeAudioServer, fakeHeaderDecoder } from '../../../packages/audio/test/engine/rig.ts';
import { ManifestResolver, RecordingAlerts, RecordingSink } from '../../../packages/audio/test/router/fakes.ts';

const manifest = loadRealManifest();
const runtime = decodeSimBin(new Uint8Array(readFileSync(resolve(import.meta.dirname, '../../../content/generated/sim.bin'))));
// Deliberately different from @faf/audio's provisional demo IDs.
const eventTypes: Readonly<Record<number, string>> = { 101: 'weaponFire', 107: 'buildComplete', 119: 'massStall', 120: 'energyStall' };
const listener = { focusX: 16, focusZ: 16, height: 50, viewHalfWidth: 50, rightX: 1, rightZ: 0 };

async function rig(options: Partial<GameAudioOptions> = {}) {
  const ctx = new FakeAudioContext();
  ctx.setDecoder(data => fakeHeaderDecoder(data, ctx));
  const server = fakeAudioServer(manifest);
  const target = new CountingTarget();
  const bridge = installGameAudio({
    gestureTarget: target, playerArmy: 0, eventTypes, visualName: () => 'core:wpn_cannon_t1',
    preferencesStore: { load: () => null, save: () => undefined },
    engineOptions: { context: ctx, manifest, settingsStore: null, visibilityDocument: null, fetch: server.fetch as typeof fetch, clock: () => ctx.nowMs },
    ...options,
  });
  await bridge.ready;
  bridge.update(listener);
  return { bridge, ctx, target };
}

const caps = { units: 4, parts: 0, projectiles: 0, beams: 0, events: 8, debugBytes: 0, eco: 2 };
function frame(tick: number, options: { event?: number; eventFlags?: number; eventAux?: number; eventTick?: number; visual?: number; paused?: boolean; build?: number; stall?: number; army?: number } = {}): FrameReader {
  const bytes = new Uint8Array(frameCapacityBytes(caps));
  const w = new FrameWriter(caps);
  w.beginFrame(bytes, tick, tick, 0, 1000, 0, options.paused ? FrameFlags.Paused : 0, 0, 0, 0);
  if (options.event !== undefined) {
    const kind = eventTypes[options.event] ?? GAME_AUDIO_EVENT_TYPES[options.event];
    const economy = kind === 'massStall' || kind === 'energyStall' || options.event === EventType.StorageFull;
    w.writeEvent(options.event, options.visual ?? (economy ? options.army ?? 0 : 7), options.eventTick ?? tick,
      0, options.eventFlags ?? (economy ? EconomyEventFlags.NoPosition : 0), 16 * 4096, 0, 16 * 4096, options.eventAux ?? 0, 42);
  }
  if (options.build !== undefined) w.writeUnit(65536, 0, 65536, 65536, 0, 65536, 0, 0, 0, options.army ?? 0, 255, options.build, 0, 0, 42, 0, 0);
  if (options.stall !== undefined) {
    const index = w.beginEco(options.army ?? 0, options.stall, 65536, 65536, 65536);
    w.setEcoValue(index, EcoField.massStored, 0);
  }
  const reader = new FrameReader();
  expect(reader.reset(bytes.subarray(0, w.endFrame()))).toBe(true);
  return reader;
}

/** Observe requests while keeping the real queue/interval/voice behavior intact. */
function alertRequests(bridge: ReturnType<typeof installGameAudio>): AlertRequest[] {
  const requests: AlertRequest[] = [], alerts = bridge.engine.alerts!;
  const push = alerts.push.bind(alerts);
  vi.spyOn(alerts, 'push').mockImplementation(request => { requests.push({ ...request }); return push(request); });
  return requests;
}

function command(op: number, army = 0, tick = 0, units: number[] = [42]): Uint8Array {
  return new CommandBatchEncoder().addRaw(tick, army, 1, op, 0, units, new Uint8Array(0)).view();
}

describe('compiled runtime audio mapping', () => {
  it('routes every actual mounted weapon through the Game protocol to a loaded manifest sound', async () => {
    // Mounts emit Shot; death/blast-only weapon records are not firing mounts.
    const weapons = [...new Set(runtime.mountWeaponCol)];
    expect(weapons.length).toBeGreaterThan(0);
    expect(weapons.map((index) => runtime.weaponIds[index])).toContain('core:wpn_arty_t1');
    const { bridge, ctx } = await rig({ eventTypes: GAME_AUDIO_EVENT_TYPES, visualName: (index) => runtime.weaponIds[index] });
    await bridge.engine.unlock();
    for (const [i, weapon] of weapons.entries()) {
      const ref = runtime.weaponIds[weapon]!;
      expect(DEFAULT_EVENT_SOUND_MAP.weapons[ref], ref).toBeDefined();
      const played = bridge.engine.stats().played;
      bridge.onFrame(frame(i + 1, { event: EventType.Shot, visual: weapon }));
      expect(bridge.engine.stats().played, ref).toBe(played + 1);
      ctx.advance(1000); // Preserve real sound cooldown policy between distinct events.
    }
    expect(bridge.engine.stats()).toMatchObject({ events: weapons.length, eventsUnmapped: 0 });
    expect(bridge.engine.stats().dropped.notLoaded).toBe(0);
    expect(bridge.engine.stats().dropped.unknownSound).toBe(0);
    expect(DEFAULT_EVENT_SOUND_MAP.weaponDefault).toBeNull();
    expect(weaponSound(DEFAULT_EVENT_SOUND_MAP, 'core:wpn_not_in_map')).toBeNull();
    await bridge.dispose();
  });

  it('uses stock mortar fire and shell impact for the real compiled T1 artillery mount', () => {
    const unit = runtime.indexOf('core:lnd_t1_arty');
    expect(unit).toBeGreaterThanOrEqual(0);
    expect(runtime.mountCount(unit)).toBe(1);
    const weapon = runtime.mountWeapon(runtime.firstMount(unit));
    expect(runtime.weaponIds[weapon]).toBe('core:wpn_arty_t1');
    expect(runtime.projectileIds[runtime.weaponProjectile(weapon)]).toBe('core:prj_arty_shell');
    const resolver = new ManifestResolver(manifest), sink = new RecordingSink(resolver);
    const router = new EventRouter({ map: DEFAULT_EVENT_SOUND_MAP, resolver, faction: 'varkan',
      eventTypes: GAME_AUDIO_EVENT_TYPES, visualName: (index) => runtime.weaponIds[index], alerts: new RecordingAlerts() });
    const source = new ArrayEventSource();
    source.push(EventType.Shot, weapon, 100, 0, 0, 0, 0, 0, 0, 7);
    source.push(EventType.Impact, weapon, 101, 0, 0, 0, 0, 0, 0, 7);
    router.handle(source, sink, 10, 1000);
    expect(sink.plays.map((p) => p.soundId)).toEqual(['varkan:wpn_slag_mortar_t1_fire', 'common:imp_shell_ground']);
    expect(router.stats).toMatchObject({ events: 2, eventsUnmapped: 0, plays: 2 });
  });

  it('uses the Reeve cannon fire and shell impact for its compiled commander enhancement', () => {
    const unit = runtime.indexOf('core:cmd_commander_cannon');
    expect(unit).toBeGreaterThanOrEqual(0);
    expect(runtime.mountCount(unit)).toBe(1);
    const weapon = runtime.mountWeapon(runtime.firstMount(unit));
    expect(runtime.weaponIds[weapon]).toBe('core:wpn_reeve_cannon_enhanced');
    expect(runtime.projectileIds[runtime.weaponProjectile(weapon)]).toBe('core:prj_shell_heavy');
    const resolver = new ManifestResolver(manifest), sink = new RecordingSink(resolver);
    const router = new EventRouter({ map: DEFAULT_EVENT_SOUND_MAP, resolver, faction: 'varkan',
      eventTypes: GAME_AUDIO_EVENT_TYPES, visualName: index => runtime.weaponIds[index], alerts: new RecordingAlerts() });
    const source = new ArrayEventSource();
    source.push(EventType.Shot, weapon, 100, 0, 0, 0, 0, 0, 0, 7);
    source.push(EventType.Impact, weapon, 101, 0, 0, 0, 0, 0, 0, 7);
    router.handle(source, sink, 10, 1000);
    expect(sink.plays.map(p => p.soundId)).toEqual(['varkan:wpn_reeve_cannon_fire', 'common:imp_shell_ground']);
    expect(router.stats).toMatchObject({ events: 2, eventsUnmapped: 0, plays: 2 });
  });
});

describe('game audio bridge, fake context only (no speaker API)', () => {
  it('resolves audio assets next to both dev and hash-versioned build entry pages', () => {
    expect(gameAudioBaseUrl('http://localhost:5173/')).toBe('http://localhost:5173/audio/');
    expect(gameAudioBaseUrl('http://localhost:5173/b/abc/index.html')).toBe('http://localhost:5173/b/abc/audio/');
  });
  it('loads the real bank while locked, refuses synthetic gestures and removes gesture hooks', async () => {
    const { bridge, ctx, target } = await rig();
    expect(bridge.engine.stats().loadedSounds).toBe(manifest.sounds.length);
    target.gesture();
    expect(ctx.resumeCalls).toBe(0);
    bridge.onCommandBatch(command(Op.Move));
    expect(bridge.engine.stats().played).toBe(0);
    expect(bridge.engine.stats().dropped.locked).toBe(2);
    expect(target.listeners).toBe(2);
    await bridge.dispose();
    expect(target.listeners).toBe(0);
    expect(bridge.dispose()).toBe(bridge.dispose());
    target.gesture();
    expect(ctx.resumeCalls).toBe(0);
  });

  it('confirms an issued player command immediately and ignores AI/replay/cheat/empty batches', async () => {
    const { bridge } = await rig();
    await bridge.engine.unlock();
    const play = vi.spyOn(bridge.engine, 'playUi');
    bridge.onCommandBatch(command(Op.Move));
    expect(play.mock.calls).toEqual([['ui_cmd_move'], ['ack_pip_direct']]);
    expect(bridge.engine.stats().played).toBe(2);
    bridge.onCommandBatch(command(Op.Attack, 1));
    bridge.onCommandBatch(command(Op.Attack, 0, 4));
    bridge.onCommandBatch(command(Op.Cheat));
    bridge.onCommandBatch(command(Op.Move, 0, 0, []));
    expect(play).toHaveBeenCalledTimes(2);
    await bridge.dispose();
    const replay = await rig({ replayMode: true });
    const replayPlay = vi.spyOn(replay.bridge.engine, 'playUi');
    replay.bridge.onCommandBatch(command(Op.Move));
    expect(replayPlay).not.toHaveBeenCalled();
    await replay.bridge.dispose();
  });

  it('retains only first-gesture UI feedback through resume, while combat events remain dropped', async () => {
    const target = new EventTarget();
    const add = vi.spyOn(target, 'addEventListener');
    const { bridge, ctx } = await rig({ gestureTarget: target });
    const callback = add.mock.calls.find(call => call[0] === 'keydown')?.[1] as EventListener;
    // Unit model of the trusted browser callback, no synthetic DOM event grants autoplay.
    callback({ isTrusted: true } as Event);
    bridge.onCommandBatch(command(Op.Move));
    bridge.onFrame(frame(1, { event: 101 }));
    expect(bridge.engine.stats().played).toBe(0);
    expect(ctx.resumeCalls).toBe(1);
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(bridge.engine.stats().played).toBe(2);
    expect(bridge.engine.stats().dropped.locked).toBe(1);
    await bridge.dispose();
  });

  it('routes the real protocol frame table once per event tick and drops paused/seek historical sounds', async () => {
    const { bridge } = await rig();
    await bridge.engine.unlock();
    const source = frame(5, { event: 101 });
    bridge.onFrame(source);
    bridge.onFrame(source);
    bridge.onFrame(frame(5, { event: 101 }));
    expect(bridge.engine.stats().events).toBe(1);
    expect(bridge.engine.stats().eventsUnmapped).toBe(0);
    expect(bridge.engine.stats().played).toBe(1);
    bridge.onFrame(frame(6, { event: 101, paused: true }));
    bridge.onFrame(frame(2, { event: 101 }));
    expect(bridge.engine.stats().events).toBe(1);
    bridge.onFrame(frame(3, { event: 101 }));
    expect(bridge.engine.stats().events).toBe(2);
    await bridge.dispose();
  });

  it('uses own real stall transitions and suppresses duplicated protocol stalls and disabled sounds', async () => {
    const { bridge } = await rig();
    const alert = vi.spyOn(bridge.engine, 'alert');
    bridge.onFrame(frame(1, { stall: 0 }));
    bridge.onFrame(frame(2, { stall: 1 }));
    bridge.onFrame(frame(3, { stall: 1 }));
    expect(alert.mock.calls).toEqual([[{ kind: 'alt_mass_stall' }]]);
    bridge.onFrame(frame(4, { stall: 3, event: 120 }));
    expect(alert).toHaveBeenCalledTimes(1);
    bridge.setHudSetting('audibleStall', false);
    bridge.onFrame(frame(5, { stall: 0 }));
    bridge.onFrame(frame(6, { stall: 3, event: 119 }));
    bridge.onFrame(frame(7, { stall: 3, army: 1 }));
    expect(alert).toHaveBeenCalledTimes(1);
    expect(bridge.engine.stats().events).toBe(1);
    await bridge.dispose();
  });

  it('routes the actual own stall and storage events, translates overflow aux and deduplicates the same own eco transition', async () => {
    const { bridge } = await rig({ eventTypes: GAME_AUDIO_EVENT_TYPES });
    await bridge.engine.unlock();
    const requests = alertRequests(bridge), fallback = vi.spyOn(bridge.engine, 'alert');
    bridge.onFrame(frame(1, { stall: 0 }));
    bridge.onFrame(frame(2, { event: EventType.MassStall, eventAux: 32768, stall: 1 }));
    expect(requests.map(r => r.kind)).toEqual(['alt_mass_stall']);
    expect(fallback).not.toHaveBeenCalled();
    bridge.onFrame(frame(3, { event: EventType.EnergyStall, eventAux: 16384, stall: 3 }));
    expect(requests.map(r => r.kind)).toEqual(['alt_mass_stall', 'alt_energy_stall']);
    expect(fallback).not.toHaveBeenCalled();
    const storage = frame(4, { event: EventType.StorageFull, eventAux: 0xffffffff, stall: 3 });
    bridge.onFrame(storage);
    expect(storage.eventAux(0)).toBe(0xffffffff); // adapter never mutates the source overflow
    expect(STORAGE_FULL_ALERT_INDEX).toBe(10);
    expect(requests.at(-1)).toMatchObject({ kind: 'alt_storage_full', x: undefined, z: undefined });
    const energyStorage = frame(5, { event: EventType.StorageFull, eventAux: 999999,
      eventFlags: EconomyEventFlags.NoPosition | EconomyEventFlags.Energy });
    bridge.onFrame(energyStorage);
    expect(requests.at(-1)?.kind).toBe('alt_storage_full');
    expect(energyStorage.eventAux(0)).toBe(999999);
    expect(bridge.engine.stats().events).toBe(4);
    expect(bridge.engine.stats().eventsUnmapped).toBe(0);
    await bridge.dispose();
  });

  it('rejects allied and observer economy events and an allied event cannot suppress the player stall fallback', async () => {
    for (const playerArmy of [0, -1]) {
      const { bridge } = await rig({ eventTypes: GAME_AUDIO_EVENT_TYPES, playerArmy });
      await bridge.engine.unlock();
      const requests = alertRequests(bridge);
      bridge.onFrame(frame(1, { event: EventType.MassStall, visual: 1 }));
      bridge.onFrame(frame(2, { event: EventType.EnergyStall, visual: 1 }));
      bridge.onFrame(frame(3, { event: EventType.StorageFull, visual: 1, eventAux: 10 }));
      expect(requests).toEqual([]);
      expect(bridge.engine.stats().events).toBe(0);
      bridge.onFrame(frame(4, { event: EventType.MassStall, visual: 1, stall: 1, army: 0 }));
      expect(requests.map(r => r.kind)).toEqual(playerArmy === 0 ? ['alt_mass_stall'] : []);
      expect(bridge.engine.stats().events).toBe(0);
      await bridge.dispose();
    }
  });

  it('keeps paused, rewind, retained-event and audibleStall policies with the actual economy event IDs', async () => {
    const { bridge } = await rig({ eventTypes: GAME_AUDIO_EVENT_TYPES });
    await bridge.engine.unlock();
    const requests = alertRequests(bridge), play = vi.spyOn(bridge.engine, 'playUi');
    bridge.onFrame(frame(5, { event: EventType.MassStall, stall: 1, paused: true }));
    bridge.onFrame(frame(5, { event: EventType.MassStall, stall: 1 }));
    bridge.onFrame(frame(2, { event: EventType.EnergyStall, stall: 3 }));
    expect(requests).toEqual([]);
    expect(bridge.engine.stats().events).toBe(0);
    bridge.onFrame(frame(3, { stall: 0 }));
    // The retained old own event is already below the bridge's watermark; it must not
    // suppress a new authoritative eco rise when no fresh event is actually routed.
    bridge.onFrame(frame(4, { event: EventType.MassStall, eventTick: 2, stall: 1 }));
    expect(requests.map(r => r.kind)).toEqual(['alt_mass_stall']);
    expect(bridge.engine.stats().events).toBe(0);
    bridge.setHudSetting('audibleStall', false);
    bridge.onFrame(frame(5, { event: EventType.EnergyStall, stall: 3 }));
    expect(requests).toHaveLength(1);
    expect(play).not.toHaveBeenCalledWith('eco_flow_stall');
    bridge.onFrame(frame(6, { event: EventType.StorageFull, eventAux: 123456 }));
    expect(requests.at(-1)?.kind).toBe('alt_storage_full'); // stall preference does not mute storage
    expect(bridge.engine.stats().events).toBe(1);
    expect(bridge.engine.stats().eventsUnmapped).toBe(0);
    await bridge.dispose();
  });

  it('starts a build loop on real progress, completes only a known incomplete unit and avoids event duplicates', async () => {
    const { bridge } = await rig();
    const play = vi.spyOn(bridge.engine, 'play');
    const loop = vi.spyOn(bridge.engine, 'setLoop');
    bridge.onFrame(frame(1, { build: 255 }));
    expect(play).not.toHaveBeenCalled();
    bridge.onFrame(frame(2, { build: 100 }));
    bridge.onFrame(frame(3, { build: 150 }));
    expect(loop).toHaveBeenLastCalledWith('build:0', expect.objectContaining({ sound: 'bld_pour_loop', x: 16, z: 16 }));
    bridge.onFrame(frame(4, { build: 255 }));
    expect(play.mock.calls.map(c => c[0].sound)).toEqual(['bld_complete', 'sig_bell_small']);
    bridge.onFrame(frame(5, { build: 150 }));
    bridge.onFrame(frame(6, { build: 255, event: 107 }));
    expect(play).toHaveBeenCalledTimes(2);
    expect(loop).toHaveBeenLastCalledWith('build:0', null);
    await bridge.dispose();
  });

  it('applies and persists sliders, background mute and dedicated alert policy without muting ack', async () => {
    const save = vi.fn();
    const { bridge } = await rig({ preferencesStore: { load: () => ({ audibleStall: false, alertVoice: 'gong' }), save } });
    expect(bridge.hudSettings()).toMatchObject({ audibleStall: false, alertVoice: 'gong' });
    expect(bridge.setHudSetting('volMaster', 37)).toBe(true);
    expect(bridge.engine.settings.get().master).toBe(0.37);
    expect(bridge.setHudSetting('audioInBackground', true)).toBe(true);
    expect(bridge.engine.settings.get().muteWhenHidden).toBe(false);
    expect(bridge.setHudSetting('volUi', Number.NaN)).toBe(false);
    expect(bridge.setHudSetting('alertVoice', 'invalid')).toBe(false);
    await bridge.engine.unlock();
    bridge.setHudSetting('alertVoice', 'off');
    bridge.engine.alert({ kind: 'alt_base_attacked', x: 16, z: 16 });
    bridge.update(listener);
    expect(bridge.engine.alertHistory()[0]?.kind).toBe('alt_base_attacked');
    expect(bridge.engine.stats().played).toBe(0);
    bridge.onCommandBatch(command(Op.Move));
    expect(bridge.engine.stats().played).toBe(2);
    expect(save).toHaveBeenCalledWith({ audibleStall: false, alertVoice: 'off' });
    await bridge.dispose();
  });

  it('keeps spatial positioning correct when the actual camera rotates and zooms', () => {
    const out = { ...listener };
    const same = listenerFromCamera({ targetX: 20 * 4096, targetZ: -30 * 4096, distance: 100, pitch: Math.PI / 6, yaw: 0, fovY: Math.PI / 2, viewportWidth: 800, viewportHeight: 400 }, out);
    expect(same).toBe(out);
    expect(out).toMatchObject({ focusX: 20, focusZ: -30, rightZ: 1 });
    expect(out.height).toBeCloseTo(50);
    expect(out.viewHalfWidth).toBeCloseTo(200);
    expect(out.rightX).toBeCloseTo(0);
  });

  it('maps the actual commander flag and match-end protocol without replaying the stinger', async () => {
    const { bridge } = await rig({ eventTypes: GAME_AUDIO_EVENT_TYPES });
    await bridge.engine.unlock();
    bridge.onFrame(frame(1, { event: EventType.UnitDeath, eventFlags: 4 }));
    expect(bridge.engine.stats().voicesByCategory.explosion).toBe(1);
    expect(bridge.engine.stats().eventsUnmapped).toBe(0);
    const play = vi.spyOn(bridge.engine, 'playUi');
    bridge.onFrame(frame(2, { event: EventType.MatchEnd, visual: 0, paused: true }));
    bridge.onFrame(frame(2, { event: EventType.MatchEnd, visual: 0 }));
    expect(play.mock.calls).toEqual([['mus_victory']]);
    expect(bridge.engine.stats().eventsUnmapped).toBe(0);
    await bridge.dispose();
  });
});
