import { FrameReader, FrameWriter } from '@faf/protocol';
import { describe, expect, it } from 'vitest';
import type {
  AudioBufferLike,
  AudioBufferSourceNodeLike,
  AudioContextLike,
  BaseAudioContextLike,
  DynamicsCompressorNodeLike,
  GainNodeLike,
  OfflineAudioContextLike,
  StereoPannerNodeLike,
} from '../src/ports.ts';
import {
  ArrayEventSource,
  BUS_IDS,
  DECODE_PATHS,
  DEFAULT_AUDIO_SETTINGS,
  DROP_REASONS,
  FX_ONE,
  MANIFEST_BUS_TO_BUS,
  SOUND_CATEGORIES,
  categoryIndex,
  createAudioSimEvent,
  isManifestBus,
  isSoundCategory,
  type AudioEventSource,
} from '../src/types.ts';
import * as barrel from '../src/index.ts';
import { DEFAULT_EVENT_SOUND_MAP, DEFAULT_EVENT_TYPES, EVENT_FLAG_UNLOCATED } from '../src/events/index.ts';
import { EventRouter } from '../src/router/index.ts';
import { ManifestResolver, RecordingAlerts, RecordingSink } from './router/fakes.ts';
import { FakeAudioContext, FakeOfflineAudioContext } from './support/fake-audio-context.ts';
import { loadRealManifest } from './support/manifest.ts';

// ---------------------------------------------------------------------------------------------
// Static compatibility (checked by `tsc -p tsconfig.tests.json`; the functions only exist so
// the assignments are type-checked — no casts, no any).
// ---------------------------------------------------------------------------------------------

const staticCompat = [
  (c: AudioContext): AudioContextLike => c,
  (c: OfflineAudioContext): OfflineAudioContextLike => c,
  (c: BaseAudioContext): BaseAudioContextLike => c,
  (b: AudioBuffer): AudioBufferLike => b,
  (n: GainNode): GainNodeLike => n,
  (n: StereoPannerNode): StereoPannerNodeLike => n,
  (n: DynamicsCompressorNode): DynamicsCompressorNodeLike => n,
  (n: AudioBufferSourceNode): AudioBufferSourceNodeLike => n,
  (c: FakeAudioContext): AudioContextLike => c,
  (c: FakeOfflineAudioContext): OfflineAudioContextLike => c,
  // The real FrameReader of @faf/protocol (devDependency; src/ never imports protocol).
  (r: FrameReader): AudioEventSource => r,
  (s: ArrayEventSource): AudioEventSource => s,
] as const;

describe('FrameReader → EventRouter (runtime, @faf/protocol)', () => {
  it('events written with FrameWriter.writeEvent are routed like an ArrayEventSource', () => {
    const w = new FrameWriter();
    const buf = new Uint8Array(w.capacityBytes);
    w.beginFrame(buf, 1, 100, 0, 1000, 0, 0, 0, 0, 0);
    const T = DEFAULT_EVENT_TYPES;
    const X = Math.round(12.5 * FX_ONE);
    const Z = Math.round(-3.25 * FX_ONE);
    w.writeEvent(T.unitDeath, 0, 100, 0, 0, X, 0, Z, 2, 7);
    w.writeEvent(T.buildComplete, 0, 100, 128, 0, X, 0, Z, 0, 8);
    w.writeEvent(T.alert, 0, 101, 0, EVENT_FLAG_UNLOCATED, 0, 0, 0, 4, 0);
    w.writeEvent(0xfffe, 0, 101, 0, 0, 0, 0, 0, 0xffffffff, 0xffffffff); // unknown type
    const len = w.endFrame();
    const reader = new FrameReader();
    expect(reader.reset(buf.subarray(0, len))).toBe(true);

    const array = new ArrayEventSource();
    for (let i = 0; i < reader.eventCount; i++) {
      array.push(reader.eventType(i), reader.eventVisual(i), reader.eventTick(i), reader.eventSubTick(i), reader.eventFlags(i), reader.eventPos(i, 0), reader.eventPos(i, 1), reader.eventPos(i, 2), reader.eventAux(i), reader.eventHandle(i));
    }
    const route = (src: AudioEventSource): { plays: unknown[]; alerts: unknown[]; stats: unknown } => {
      const resolver = new ManifestResolver(loadRealManifest());
      const sink = new RecordingSink(resolver);
      const alerts = new RecordingAlerts();
      const r = new EventRouter({ map: DEFAULT_EVENT_SOUND_MAP, resolver, faction: 'varkan', alerts });
      r.handle(src, sink, 2, 1000);
      return { plays: sink.plays.map((p) => [p.soundId, p.x, p.z, p.when]), alerts: alerts.pushed, stats: { ...r.stats } };
    };
    const viaReader = route(reader);
    expect(viaReader).toEqual(route(array));
    expect(viaReader.plays).toContainEqual(['varkan:exp_large', 12.5, -3.25, 2]);
    expect(viaReader.alerts).toEqual([{ kind: 'alt_mass_stall', x: undefined, z: undefined }]);
    expect(viaReader.stats).toMatchObject({ events: 4, eventsUnmapped: 1 });
  });
});

describe('type contract', () => {
  it('static compatibility functions exist (checked by tsc)', () => {
    expect(staticCompat).toHaveLength(12);
  });

  it('categories: fixed order, dense unique index, guards', () => {
    expect(SOUND_CATEGORIES).toHaveLength(15);
    expect(new Set(SOUND_CATEGORIES).size).toBe(15);
    SOUND_CATEGORIES.forEach((c, i) => expect(categoryIndex(c)).toBe(i));
    expect(SOUND_CATEGORIES.slice(0, 5)).toEqual(['alert', 'music', 'signature', 'ack', 'ui']);
    expect(isSoundCategory('weapon')).toBe(true);
    expect(isSoundCategory('toString')).toBe(false);
    expect(isManifestBus('voice')).toBe(true);
    expect(isManifestBus('alerts')).toBe(false);
  });

  it('buses: voice → alerts, every channel bus reachable', () => {
    expect(BUS_IDS).toEqual(['master', 'sfx', 'ui', 'alerts', 'music', 'ambience']);
    expect(MANIFEST_BUS_TO_BUS.voice).toBe('alerts');
    expect(new Set(Object.values(MANIFEST_BUS_TO_BUS))).toEqual(new Set(BUS_IDS.filter((b) => b !== 'master')));
  });

  it('drop reasons, decode paths and default settings', () => {
    expect(new Set(DROP_REASONS).size).toBe(DROP_REASONS.length);
    expect(DROP_REASONS).toHaveLength(9);
    expect(DECODE_PATHS).toEqual(['native', 'webcodecs', 'wasm']);
    expect(DEFAULT_AUDIO_SETTINGS).toEqual({
      master: 0.8,
      sfx: 0.8,
      ui: 0.7,
      alerts: 0.9,
      music: 0.6,
      ambience: 0.5,
      muted: false,
      muteWhenHidden: true,
    });
    expect(Object.isFrozen(DEFAULT_AUDIO_SETTINGS)).toBe(true);
    expect(FX_ONE).toBe(4096);
  });

  it('barrel re-exports the runtime values of types.ts', () => {
    expect(barrel.SOUND_CATEGORIES).toBe(SOUND_CATEGORIES);
    expect(barrel.ArrayEventSource).toBe(ArrayEventSource);
    expect(barrel.categoryIndex).toBe(categoryIndex);
  });
});

describe('real manifest against the contract', () => {
  const m = loadRealManifest();

  it('every category of the manifest is a SoundCategory and vice versa', () => {
    expect(new Set(Object.keys(m.categories))).toEqual(new Set(SOUND_CATEGORIES));
    for (const s of m.sounds) expect(isSoundCategory(s.category), s.id).toBe(true);
  });

  it('every bus (categories and sounds) maps to a mixer bus', () => {
    const buses = new Set<string>();
    for (const c of SOUND_CATEGORIES) buses.add(m.categories[c].bus);
    for (const s of m.sounds) {
      buses.add(s.bus);
      expect(s.bus, s.id).toBe(m.categories[s.category].bus);
    }
    for (const b of buses) {
      expect(isManifestBus(b), b).toBe(true);
      if (isManifestBus(b)) expect(MANIFEST_BUS_TO_BUS[b]).toBeDefined();
    }
    expect(buses).toEqual(new Set(['sfx', 'ui', 'voice', 'music', 'ambience']));
  });

  it('SOUND_CATEGORIES is sorted by descending manifest priority', () => {
    for (let i = 1; i < SOUND_CATEGORIES.length; i++) {
      const a = m.categories[SOUND_CATEGORIES[i - 1]!].priority;
      const b = m.categories[SOUND_CATEGORIES[i]!].priority;
      expect(a, SOUND_CATEGORIES[i]).toBeGreaterThanOrEqual(b);
    }
  });

  it('ids are unique, scope:name, loops carry consistent points', () => {
    const ids = new Set<string>();
    for (const s of m.sounds) {
      expect(s.id).toBe(`${s.scope}:${s.name}`);
      expect(ids.has(s.id)).toBe(false);
      ids.add(s.id);
      if (s.loop !== null) {
        expect(s.loop.startS).toBeCloseTo(s.loop.startSample / m.sampleRate, 9);
        expect(s.loop.endS).toBeCloseTo(s.loop.endSample / m.sampleRate, 9);
        for (const v of s.variants) expect(v.samples).toBeGreaterThanOrEqual(s.loop.endSample);
      }
    }
  });
});

describe('ArrayEventSource', () => {
  it('reads back what was pushed (raw Q20.12 positions)', () => {
    const src = new ArrayEventSource(1);
    expect(src.eventCount).toBe(0);
    src.push(3, 17, 1200, 128, 5, -10 * FX_ONE, 2 * FX_ONE, 300 * FX_ONE + 1, 2, 0xdeadbeef);
    const e = createAudioSimEvent();
    e.type = 7;
    e.visual = 65535;
    e.subTick = 255;
    e.aux = 4294967295;
    src.pushEvent(e); // grows capacity
    expect(src.eventCount).toBe(2);
    const reader: AudioEventSource = src;
    expect([reader.eventType(0), reader.eventVisual(0), reader.eventTick(0), reader.eventSubTick(0), reader.eventFlags(0)]).toEqual([
      3, 17, 1200, 128, 5,
    ]);
    expect([reader.eventPos(0, 0), reader.eventPos(0, 1), reader.eventPos(0, 2)]).toEqual([-40960, 8192, 1228801]);
    expect(reader.eventAux(0)).toBe(2);
    expect(reader.eventHandle(0)).toBe(0xdeadbeef);
    expect([reader.eventType(1), reader.eventVisual(1), reader.eventSubTick(1), reader.eventAux(1)]).toEqual([7, 65535, 255, 4294967295]);
    expect(() => reader.eventType(2)).toThrow(RangeError);
  });

  it('reuses its records after clear()', () => {
    const src = new ArrayEventSource(4);
    const records = src.events.slice();
    for (let round = 0; round < 3; round++) {
      src.clear();
      for (let i = 0; i < 4; i++) src.push(i, 0, round, 0, 0, 0, 0, 0, 0, 0);
    }
    expect(src.events).toHaveLength(4);
    src.events.forEach((r, i) => expect(r).toBe(records[i]));
    expect(src.eventTick(3)).toBe(2);
  });
});
