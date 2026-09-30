import { beforeEach, describe, expect, it } from 'vitest';
import { AlertQueue } from '../../src/alerts/index.ts';
import {
  DEFAULT_EVENT_MAP_JSON,
  DEFAULT_EVENT_SOUND_MAP,
  DEFAULT_EVENT_TYPES,
  EVENT_FLAG_AIR,
  EVENT_FLAG_STRUCTURE,
  EVENT_FLAG_UNLOCATED,
  parseEventSoundMap,
  type DeathProfile,
  type SimEventKind,
} from '../../src/events/index.ts';
import { EventRouter, type EventRouterOptions } from '../../src/router/index.ts';
import { CameraSpatialModel } from '../../src/spatial/index.ts';
import { ArrayEventSource, FX_ONE, type AudioManifest } from '../../src/types.ts';
import { loadRealManifest, makeManifest } from '../support/index.ts';
import { ManifestResolver, RecordingAlerts, RecordingSink } from './fakes.ts';

const manifest = loadRealManifest();
const T = DEFAULT_EVENT_TYPES;

const VISUALS: Record<number, string> = {
  1: 'core:wpn_cannon_t1',
  2: 'core:wpn_spark_mg_t1',
  3: 'core:wpn_mg_t1',
  4: 'core:wpn_slag_mortar_t1',
  5: 'core:wpn_not_in_map',
  6: 'core:wpn_scriber_rail_t3',
  7: 'core:wpn_gatling_t2',
};

let resolver: ManifestResolver;
let sink: RecordingSink;
let alerts: RecordingAlerts;
let src: ArrayEventSource;
let visualCalls: number[];

function router(opts: Partial<EventRouterOptions> = {}, m: AudioManifest = manifest): EventRouter {
  if (m !== manifest) {
    resolver = new ManifestResolver(m);
    sink = new RecordingSink(resolver);
  }
  return new EventRouter({
    map: DEFAULT_EVENT_SOUND_MAP,
    resolver,
    faction: 'varkan',
    visualName: (v) => {
      visualCalls.push(v);
      return VISUALS[v];
    },
    alerts,
    ...opts,
  });
}

/** Pushes one event; positions in WU (converted to Q20.12). */
function ev(kind: SimEventKind, o: { visual?: number; tick?: number; sub?: number; flags?: number; x?: number; z?: number; aux?: number } = {}): void {
  src.push(T[kind], o.visual ?? 0, o.tick ?? 100, o.sub ?? 0, o.flags ?? 0, Math.round((o.x ?? 0) * FX_ONE), 0, Math.round((o.z ?? 0) * FX_ONE), o.aux ?? 0, 7);
}

const dB = (db: number): number => Math.pow(10, db / 20);

beforeEach(() => {
  resolver = new ManifestResolver(manifest);
  sink = new RecordingSink(resolver);
  alerts = new RecordingAlerts();
  src = new ArrayEventSource();
  visualCalls = [];
});

describe('EventRouter mapping per kind', () => {
  it('weaponFire: visual → ref → sound with position in WU', () => {
    const r = router();
    ev('weaponFire', { visual: 1, x: 12.5, z: -3.25 });
    r.handle(src, sink, 10, 1000);
    expect(sink.plays).toEqual([
      { sound: resolver.idx('varkan:wpn_cannon_t1_fire'), soundId: 'varkan:wpn_cannon_t1_fire', x: 12.5, z: -3.25, gain: 1, rate: 1, when: 10, nowMs: 1000 },
    ]);
    expect(r.stats).toMatchObject({ events: 1, eventsUnmapped: 0, plays: 1 });
  });

  it('weapon alias with rate and gain (core:wpn_spark_mg_t1 → wpn_mg_t1_fire, 1.2, −3 dB)', () => {
    const r = router();
    ev('weaponFire', { visual: 2 });
    ev('weaponFire', { visual: 3, sub: 128 });
    r.handle(src, sink, 0, 0);
    expect(sink.plays.map((p) => [p.soundId, p.rate, p.gain])).toEqual([
      ['varkan:wpn_mg_t1_fire', 1.2, dB(-3)],
      ['varkan:wpn_mg_t1_fire', 1, 1],
    ]);
  });

  it('resolves visualName once per visual id; unknown refs are unmapped (weaponDefault null)', () => {
    const r = router();
    for (let i = 0; i < 5; i++) ev('weaponFire', { visual: 1, sub: i * 40 });
    ev('weaponFire', { visual: 5 });
    ev('weaponFire', { visual: 999 });
    r.handle(src, sink, 0, 0);
    r.handle(src, sink, 0, 0);
    expect(visualCalls).toEqual([1, 5, 999]);
    expect(r.stats.eventsUnmapped).toBe(4);
  });

  it('burst weapon (gatling) plays its per-shot fallback, never the loop', () => {
    const r = router();
    ev('weaponFire', { visual: 7 });
    r.handle(src, sink, 0, 0);
    expect(sink.plays.map((p) => [p.soundId, p.rate])).toEqual([['varkan:wpn_mg_t1_fire', 0.85]]);
  });

  it('projectileImpact: weapon impact family × surface (aux), common fallback', () => {
    const r = router();
    ev('projectileImpact', { visual: 3, aux: 0 }); // bullet ground
    ev('projectileImpact', { visual: 3, aux: 1, sub: 40 }); // bullet metal
    ev('projectileImpact', { visual: 3, aux: 2, sub: 80 }); // water → ground −6 dB, 0.8
    ev('projectileImpact', { visual: 3, aux: 3, sub: 120 }); // shield → silent
    ev('projectileImpact', { visual: 1, aux: 4, sub: 160 }); // shell structure
    ev('projectileImpact', { visual: 4, aux: 1, sub: 200 }); // slag: metal missing → ground (varkan)
    ev('projectileImpact', { visual: 6, aux: 9, sub: 240 }); // rail, unknown surface → ground
    ev('projectileImpact', { visual: 5, aux: 1, tick: 101 }); // unknown weapon → default family shell
    r.handle(src, sink, 0, 0);
    expect(sink.plays.map((p) => [p.soundId, p.gain, p.rate])).toEqual([
      ['common:imp_bullet_ground', 1, 1],
      ['common:imp_bullet_metal', 1, 1],
      ['common:imp_bullet_ground', dB(-6), 0.8],
      ['common:imp_structure_metal', 1, 1],
      ['varkan:imp_slag_splash', 1, 1],
      ['common:imp_shell_ground', 1, 1],
      ['common:imp_shell_metal', 1, 1],
    ]);
    expect(r.stats.eventsIgnored).toBe(1);
    expect(r.stats.eventsUnmapped).toBe(0);
  });

  it('unitDeath: size class, air crash, structure collapse after its delay', () => {
    const r = router();
    ev('unitDeath', { aux: 0, x: 1, z: 1 });
    ev('unitDeath', { aux: 1, sub: 64, flags: EVENT_FLAG_AIR });
    ev('unitDeath', { aux: 3, sub: 128 });
    ev('unitDeath', { aux: 0, tick: 101, flags: EVENT_FLAG_STRUCTURE }); // too small to collapse
    ev('unitDeath', { aux: 2, tick: 102, flags: EVENT_FLAG_STRUCTURE, x: 5, z: 6 });
    ev('unitDeath', { aux: 77, tick: 103 }); // clamped to huge
    r.handle(src, sink, 1, 0);
    const got = sink.plays.map((p) => [p.soundId, +(p.when! - 1).toFixed(6), +p.gain!.toFixed(6), p.rate]);
    expect(got).toEqual([
      ['varkan:exp_small', 0, 1, 1],
      ['varkan:exp_air_crash', 0.025, 1, 1],
      ['varkan:exp_large', 0.05, +dB(3).toFixed(6), 0.85],
      ['varkan:exp_small', 0.1, 1, 1],
      ['varkan:exp_structure_collapse', 0.8, 1, 1],
      ['varkan:exp_large', 0.2, 1, 1],
      ['varkan:exp_large', 0.3, +dB(3).toFixed(6), 0.85],
    ]);
    const collapse = sink.plays.find((p) => p.soundId === 'varkan:exp_structure_collapse')!;
    expect([collapse.x, collapse.z]).toEqual([5, 6]);
  });

  it('codec.visualDeathProfile: death class from the view data per visual id (cached), aux/flags only as fallback', () => {
    const asked: number[] = [];
    const profiles: Record<number, DeathProfile> = {
      40: { sizeClass: 3, air: false, structure: false }, // experimental
      41: { sizeClass: 2, air: false, structure: true }, // T2 factory
      42: { sizeClass: 0, air: true, structure: false }, // gunship
    };
    const r = router({
      codec: {
        visualDeathProfile: (v) => {
          asked.push(v);
          return profiles[v];
        },
      },
    });
    // aux/flags deliberately contradict the profiles: the sim does not have to fill them.
    ev('unitDeath', { visual: 40, aux: 0 });
    ev('unitDeath', { visual: 41, aux: 0, sub: 64, x: 5, z: 6 });
    ev('unitDeath', { visual: 42, aux: 3, sub: 128, flags: EVENT_FLAG_STRUCTURE });
    ev('unitDeath', { visual: 99, aux: 1, tick: 101 }); // no profile → provisional aux fallback
    ev('unitDeath', { visual: 40, aux: 1, tick: 102 }); // cached
    r.handle(src, sink, 1, 0);
    expect(sink.plays.map((p) => [p.soundId, +(p.when! - 1).toFixed(6)])).toEqual([
      ['varkan:exp_large', 0],
      ['varkan:exp_structure_collapse', 0.625], // staged before its death sound
      ['varkan:exp_large', 0.025],
      ['varkan:exp_air_crash', 0.05],
      ['varkan:exp_medium', 0.1],
      ['varkan:exp_large', 0.2],
    ]);
    expect(asked).toEqual([40, 41, 42, 99]);
  });

  it('codec.impactSurface / alertIndex / unlocatedMask translate a foreign field encoding', () => {
    // E.g. render-fx-like impact classes 0 ground, 1 ground_large, 2 unit, 3 shield, 4 water.
    const FOREIGN_TO_AUDIO = [0, 0, 1, 3, 2];
    const r = router({
      codec: {
        impactSurface: (aux) => FOREIGN_TO_AUDIO[aux] ?? -1,
        alertIndex: (aux) => aux - 100,
        unlocatedMask: 0x40,
      },
    });
    ev('projectileImpact', { visual: 3, aux: 2 }); // unit → metal
    ev('projectileImpact', { visual: 3, aux: 4, sub: 64 }); // water
    ev('projectileImpact', { visual: 3, aux: 7, sub: 128 }); // unknown → silent
    ev('alert', { aux: 103, x: 7, z: 8 });
    ev('alert', { aux: 104, flags: 0x40, x: 7, z: 8 });
    ev('alert', { aux: 3 }); // → −97: unknown
    r.handle(src, sink, 0, 0);
    expect(sink.plays.map((p) => [p.soundId, p.rate])).toEqual([
      ['common:imp_bullet_metal', 1],
      ['common:imp_bullet_ground', 0.8],
    ]);
    expect(alerts.pushed).toEqual([
      { kind: 'alt_base_attacked', x: 7, z: 8 },
      { kind: 'alt_mass_stall', x: undefined, z: undefined },
    ]);
    expect(r.stats).toMatchObject({ eventsIgnored: 1, eventsUnmapped: 1 });
  });

  it('commanderDeath plays map-wide by default, positioned on request', () => {
    ev('commanderDeath', { x: 300, z: 400 });
    router().handle(src, sink, 0, 0);
    router({ commanderDeathGlobal: false }).handle(src, sink, 0, 0);
    expect(sink.plays.map((p) => [p.soundId, p.x, p.z])).toEqual([
      ['varkan:exp_commander', undefined, undefined],
      ['varkan:exp_commander', 300, 400],
    ]);
  });

  it('rule sounds, follow-ups, extra alerts, unlocated and non-spatial rules', () => {
    const r = router();
    ev('buildComplete', { x: 1, z: 2 });
    ev('upgradeComplete', { x: 3, z: 4, tick: 101 });
    ev('energyStall', { x: 9, z: 9, tick: 102 });
    ev('massStall', { flags: EVENT_FLAG_UNLOCATED, tick: 102 });
    ev('radarContact', { flags: EVENT_FLAG_UNLOCATED, x: 50, z: 50, tick: 103 });
    ev('reclaimStart', { x: 1, z: 1 });
    ev('unitRollOff', { x: 1, z: 1 });
    r.handle(src, sink, 0, 0);
    expect(sink.plays.map((p) => [p.soundId, +p.when!.toFixed(6), p.x, p.z])).toEqual([
      ['varkan:bld_complete', 0, 1, 2],
      ['varkan:sig_bell_small', 0.35, 1, 2],
      ['varkan:sig_bell_mid', 0.1, 3, 4],
      ['varkan:eco_flow_stall', 0.2, undefined, undefined],
      ['common:int_contact_new', 0.3, undefined, undefined],
    ]);
    expect(alerts.pushed).toEqual([
      { kind: 'alt_factory_upgraded', x: 3, z: 4 },
      { kind: 'alt_energy_stall', x: 9, z: 9 },
      { kind: 'alt_mass_stall', x: undefined, z: undefined },
    ]);
    expect(r.stats).toMatchObject({ events: 7, eventsIgnored: 2, eventsUnmapped: 0, alertsPushed: 3 });
  });

  it('alert kind: aux → ALERT_KINDS, position unless unlocated, unknown index unmapped', () => {
    const r = router();
    ev('alert', { aux: 3, x: 40, z: 41 });
    ev('alert', { aux: 4, flags: EVENT_FLAG_UNLOCATED, x: 1, z: 1 });
    ev('alert', { aux: 99 });
    r.handle(src, sink, 0, 0);
    expect(alerts.pushed).toEqual([
      { kind: 'alt_base_attacked', x: 40, z: 41 },
      { kind: 'alt_mass_stall', x: undefined, z: undefined },
    ]);
    expect(sink.plays).toEqual([]);
    expect(r.stats.eventsUnmapped).toBe(1);
    alerts.accept = false;
    src.clear();
    ev('alert', { aux: 1 });
    r.handle(src, sink, 0, 0);
    expect(r.stats.alertsSuppressed).toBe(1);
  });

  it('routes alerts through a real AlertQueue end to end', () => {
    const now = 0;
    const jumps: [number, number][] = [];
    const q = new AlertQueue({ resolver, faction: 'varkan', clockMs: () => now, rules: DEFAULT_EVENT_SOUND_MAP.alerts, onJumpTo: (x, z) => jumps.push([x, z]) });
    const r = router({ alerts: q });
    ev('alert', { aux: 3, x: 64, z: 32 });
    ev('alert', { aux: 3, x: 65, z: 32 }); // same place → suppressed
    r.handle(src, sink, 0, 0);
    q.update(now, sink);
    expect(sink.plays.map((p) => p.soundId)).toEqual(['common:alt_base_attacked']);
    expect(r.stats).toMatchObject({ alertsPushed: 1, alertsSuppressed: 1 });
    expect(q.jumpToLast()).toBe(true);
    expect(jumps).toEqual([[64, 32]]);
  });

  it('counts unknown event types as unmapped and accepts custom type tables', () => {
    const r = router();
    src.push(0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    src.push(500, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    r.handle(src, sink, 0, 0);
    expect(r.stats).toMatchObject({ events: 2, eventsUnmapped: 2, plays: 0 });

    const custom = router({ eventTypes: { 4000: 'weaponFire', 4001: 'commanderDeath' } });
    src.clear();
    src.push(4000, 1, 0, 0, 0, 0, 0, 0, 0, 0);
    src.push(4001, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    src.push(T.weaponFire, 1, 0, 0, 0, 0, 0, 0, 0, 0);
    custom.handle(src, sink, 0, 0);
    expect(sink.plays.map((p) => p.soundId)).toEqual(['varkan:wpn_cannon_t1_fire', 'varkan:exp_commander']);
    expect(custom.stats.eventsUnmapped).toBe(1);
    expect(() => router({ eventTypes: { 1: 'notAKind' } })).toThrow(/unknown kind/);
    expect(() => router({ eventTypes: { 70000: 'weaponFire' } })).toThrow(/u16/);
  });

  it('prefers the faction override and falls back to common (synthetic manifest)', () => {
    const m = makeManifest({
      sounds: [
        { id: 'common:imp_bullet_ground' },
        { id: 'varkan:imp_bullet_ground' },
        { id: 'common:imp_bullet_metal' },
        { id: 'varkan:wpn_mg_t1_fire' },
        { id: 'common:exp_commander' },
      ],
    });
    const r = router({}, m);
    ev('projectileImpact', { visual: 3, aux: 0 });
    ev('projectileImpact', { visual: 3, aux: 1, sub: 64 });
    ev('weaponFire', { visual: 3, sub: 128 });
    ev('commanderDeath', { sub: 192 });
    ev('unitDeath', { tick: 101 }); // exp_small missing in this manifest
    r.handle(src, sink, 0, 0);
    expect(sink.plays.map((p) => p.soundId)).toEqual([
      'varkan:imp_bullet_ground',
      'common:imp_bullet_metal',
      'varkan:wpn_mg_t1_fire',
      'common:exp_commander',
    ]);
    expect(r.stats.eventsUnmapped).toBe(1);
    // Another faction without overrides gets common only.
    const other = new EventRouter({ map: DEFAULT_EVENT_SOUND_MAP, resolver, faction: 'kessel', visualName: (v) => VISUALS[v], alerts });
    src.clear();
    ev('projectileImpact', { visual: 3, aux: 0 });
    sink.plays.length = 0;
    other.handle(src, sink, 0, 0);
    expect(sink.plays.map((p) => p.soundId)).toEqual(['common:imp_bullet_ground']);
  });
});

describe('EventRouter timing', () => {
  it('schedules by subTick and tick (when = ctxTime + (Δtick + subTick/256) × tick) and passes scheduled nowMs (whole ms)', () => {
    const r = router();
    ev('weaponFire', { visual: 1, sub: 0 });
    ev('weaponFire', { visual: 3, sub: 64 });
    ev('weaponFire', { visual: 4, sub: 255 });
    ev('weaponFire', { visual: 2, tick: 101, sub: 128 });
    ev('weaponFire', { visual: 6, tick: 110, sub: 0 }); // clamped to +3 ticks
    ev('weaponFire', { visual: 6, tick: 99, sub: 32 }); // earlier tick → offset 0
    r.handle(src, sink, 5, 2000);
    expect(sink.plays.map((p) => +(p.when! - 5).toFixed(9))).toEqual([0, 0.025, +((255 / 256) * 0.1).toFixed(9), 0.15, 0.3, 0.0125]);
    // Rounded to whole ms (Smi, no HeapNumber per play): 2099.61 → 2100, 2012.5 → 2013.
    expect(sink.plays.map((p) => p.nowMs)).toEqual([2000, 2025, 2100, 2150, 2300, 2013]);
  });

  it('scales with the sim speed', () => {
    const r = router();
    r.setSimSpeed(2);
    expect(r.simTickDurationS).toBe(0.05);
    ev('weaponFire', { visual: 1, sub: 128 });
    ev('weaponFire', { visual: 3, tick: 101 });
    r.handle(src, sink, 0, 0);
    r.setSimSpeed(0.25);
    r.handle(src, sink, 0, 0);
    r.setSimSpeed(0);
    r.setSimSpeed(Number.NaN);
    expect(r.simTickDurationS).toBe(0.4);
    expect(sink.plays.map((p) => p.when)).toEqual([0.025, 0.05, 0.2, 0.4]);
  });
});

describe('EventRouter aggregation', () => {
  it('merges the same sound in the same subTick cell into one louder play', () => {
    const r = router();
    // 10 shots of the same weapon in cell 0 (subTick 0..31), 2 in cell 1, 1 other weapon in cell 0.
    for (let i = 0; i < 10; i++) ev('weaponFire', { visual: 1, sub: 31 - i * 3, x: i, z: 0 });
    ev('weaponFire', { visual: 1, sub: 32, x: 50 });
    ev('weaponFire', { visual: 1, sub: 60, x: 51 });
    ev('weaponFire', { visual: 4, sub: 5 });
    r.handle(src, sink, 0, 0);
    expect(sink.plays.map((p) => [p.soundId, +p.gain!.toFixed(9), +(p.when! * 256 / 0.1).toFixed(3), p.x])).toEqual([
      // n = 10 → capped at 4 → +6.02 dB (×2); earliest subTick 4 of the cell; first (loudest equal) position.
      ['varkan:wpn_cannon_t1_fire', 2, 4, 0],
      ['varkan:wpn_cannon_t1_fire', +Math.SQRT2.toFixed(9), 32, 50],
      ['varkan:wpn_slag_mortar_t1_fire', 1, 5, 0],
    ]);
    expect(r.stats).toMatchObject({ events: 13, plays: 3, aggregated: 10 });
  });

  it('keeps the rule gain of the loudest event and adds +10·log10(n) dB', () => {
    const r = router();
    ev('weaponFire', { visual: 2, sub: 1 }); // −3 dB alias
    ev('weaponFire', { visual: 2, sub: 2 });
    ev('weaponFire', { visual: 3, sub: 3, x: 7 }); // 0 dB, same sound → louder wins
    r.handle(src, sink, 0, 0);
    expect(sink.plays).toHaveLength(1);
    const p = sink.plays[0]!;
    expect(p.gain).toBeCloseTo(Math.sqrt(3), 12);
    expect([p.x, p.rate]).toEqual([7, 1]);
  });

  it('picks the nearest (least attenuated) position with a spatial model and ignores culled events', () => {
    const spatial = new CameraSpatialModel();
    spatial.setListener({ focusX: 100, focusZ: 100, height: 40, viewHalfWidth: 20, rightX: 1, rightZ: 0 });
    const r = router({ spatial });
    ev('weaponFire', { visual: 1, sub: 1, x: 150, z: 100 }); // off-screen (r = 2.5)
    ev('weaponFire', { visual: 1, sub: 2, x: 104, z: 100 }); // on screen
    ev('weaponFire', { visual: 1, sub: 3, x: 900, z: 900 }); // culled
    ev('weaponFire', { visual: 1, sub: 4, x: 130, z: 100 });
    r.handle(src, sink, 0, 0);
    expect(sink.plays).toHaveLength(1);
    const p = sink.plays[0]!;
    expect([p.x, p.z]).toEqual([104, 100]);
    expect(p.gain).toBeCloseTo(Math.sqrt(3), 12); // 3 audible of 4
  });

  it('does not aggregate across handle() calls and handles large batches (table growth)', () => {
    const r = router();
    for (let i = 0; i < 2000; i++) ev('projectileImpact', { visual: 1 + (i % 7), aux: i % 5, tick: 100 + (i % 4), sub: (i * 37) % 256, x: i, z: i });
    r.handle(src, sink, 0, 0);
    const first = sink.plays.length;
    r.handle(src, sink, 0, 0);
    expect(sink.plays.length).toBe(first * 2);
    expect(first).toBeGreaterThan(20);
    expect(r.stats.plays + r.stats.aggregated + r.stats.eventsIgnored + r.stats.eventsUnmapped).toBe(4000);
    // Each (sound, cell) at most once per call.
    const keys = sink.plays.slice(0, first).map((p) => `${p.soundId}@${Math.floor((p.when! / 0.1) * 8)}`);
    expect(new Set(keys).size).toBe(first);
  });

  it('counts dropped plays', () => {
    const r = router();
    sink.dropAll = 'globalLimit';
    ev('weaponFire', { visual: 1 });
    r.handle(src, sink, 0, 0);
    expect(r.stats).toMatchObject({ plays: 1, dropped: 1 });
    r.resetStats();
    expect(r.stats.plays).toBe(0);
  });

  it('works with a map parsed from JSON and does not resolve sounds per event', () => {
    const r = router({ map: parseEventSoundMap(DEFAULT_EVENT_MAP_JSON) });
    for (let i = 0; i < 50; i++) ev('weaponFire', { visual: 1 + (i % 4), sub: i * 5 });
    r.handle(src, sink, 0, 0);
    const calls = resolver.resolveCalls;
    r.handle(src, sink, 0, 0);
    r.handle(src, sink, 0, 0);
    expect(resolver.resolveCalls).toBe(calls);
  });
});
