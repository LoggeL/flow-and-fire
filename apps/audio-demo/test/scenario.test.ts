/**
 * Scenario generator 'gefecht' of the audio demo: shot rate, determinism per seed, event field
 * semantics (a1 §4), coverage of the default event map, alerts, build loops and allocation.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ArrayEventSource, FX_ONE, type AlertRequest, type DropReason, type PlayRequest, type SoundSink, type VoiceHandle } from '@faf/audio';
import { SoundCatalog } from '@faf/audio/catalog';
import {
  ALERT_KINDS,
  DEFAULT_EVENT_SOUND_MAP,
  DEFAULT_EVENT_TYPES,
  EVENT_FLAG_AIR,
  EVENT_FLAG_STRUCTURE,
  type SimEventKind,
} from '@faf/audio/events';
import { EventRouter } from '@faf/audio/router';
import {
  FIELD_SIZE,
  GefechtScenario,
  Prng,
  SCENARIO_ALERTS,
  TICK_S,
  UNITS_PER_ARMY,
  UNIT_KINDS,
  WEAPONS,
  copyScenarioStats,
  visualName,
  weaponVisual,
  type ScenarioLoopSink,
} from '../src/demo/scenario.ts';
import { measureAllocatedBytes } from './heap.ts';

const KIND_OF_TYPE = new Map<number, SimEventKind>(Object.entries(DEFAULT_EVENT_TYPES).map(([k, t]) => [t, k as SimEventKind]));

interface LoopCall {
  tick: number;
  key: string;
  sound: string | number | null;
  gain: number | undefined;
  x: number | undefined;
}

class LoopRecorder implements ScenarioLoopSink {
  readonly calls: LoopCall[] = [];
  tick = 0;
  setLoop(key: string, req: PlayRequest | null): void {
    this.calls.push({ tick: this.tick, key, sound: req === null ? null : req.sound, gain: req?.gain, x: req?.x });
  }
}

/** Runs `ticks` steps and calls `each` for every event (kind resolved). */
function run(
  sc: GefechtScenario,
  ticks: number,
  each?: (kind: SimEventKind, src: ArrayEventSource, i: number) => void,
  loops: LoopRecorder | null = null,
): void {
  const out = new ArrayEventSource();
  for (let t = 0; t < ticks; t++) {
    if (loops !== null) loops.tick = sc.tick + 1;
    sc.step(out, loops);
    if (each === undefined) continue;
    for (let i = 0; i < out.count; i++) {
      const kind = KIND_OF_TYPE.get(out.eventType(i));
      if (kind === undefined) throw new Error(`unknown event type ${out.eventType(i)}`);
      each(kind, out, i);
    }
  }
}

/** FNV-1a over all event fields and loop calls. */
function streamHash(seed: number, shots: number, ticks: number): { hash: number; events: number } {
  const sc = new GefechtScenario({ seed, shotsPerSecond: shots });
  const loops = new LoopRecorder();
  let h = 0x811c9dc5;
  let events = 0;
  const mix = (v: number): void => {
    h = Math.imul(h ^ (v | 0), 0x01000193) >>> 0;
  };
  run(
    sc,
    ticks,
    (_k, s, i) => {
      events++;
      mix(s.eventType(i));
      mix(s.eventVisual(i));
      mix(s.eventTick(i));
      mix(s.eventSubTick(i));
      mix(s.eventFlags(i));
      mix(s.eventPos(i, 0));
      mix(s.eventPos(i, 2));
      mix(s.eventAux(i));
      mix(s.eventHandle(i));
    },
    loops,
  );
  for (const c of loops.calls) {
    mix(c.tick);
    mix(c.key.length);
    mix(Math.round((c.gain ?? -1) * 1e6));
  }
  return { hash: h, events };
}

describe('Prng', () => {
  it('is deterministic per seed and uniform enough', () => {
    const a = new Prng(42);
    const b = new Prng(42);
    const c = new Prng(43);
    const xs = Array.from({ length: 1000 }, () => a.next());
    expect(xs).toEqual(Array.from({ length: 1000 }, () => b.next()));
    expect(xs.slice(0, 10)).not.toEqual(Array.from({ length: 10 }, () => c.next()));
    const buckets = new Array<number>(10).fill(0);
    const r = new Prng(1);
    for (let i = 0; i < 100_000; i++) buckets[r.int(10)]!++;
    for (const n of buckets) expect(Math.abs(n - 10_000)).toBeLessThan(500);
    for (const x of xs) expect(x >= 0 && x < 1).toBe(true);
  });
});

describe('GefechtScenario', () => {
  it('builds two armies of 150 units with one commander each', () => {
    const sc = new GefechtScenario();
    expect(UNITS_PER_ARMY).toBe(150);
    expect(sc.unitCount).toBe(300);
    expect(sc.stats.alive).toEqual([150, 150]);
    expect(UNIT_KINDS.filter((k) => k.role === 'commander').map((k) => k.count)).toEqual([1]);
  });

  it.each([50, 200, 400])('fires %i shots per sim second (±5 %%)', (sps) => {
    const sc = new GefechtScenario({ seed: 3, shotsPerSecond: sps });
    const perTick: number[] = [];
    const out = new ArrayEventSource();
    for (let t = 0; t < 600; t++) {
      sc.step(out, null);
      let n = 0;
      for (let i = 0; i < out.count; i++) if (out.eventType(i) === DEFAULT_EVENT_TYPES.weaponFire) n++;
      perTick.push(n);
    }
    const expected = sps * 60;
    expect(Math.abs(sc.stats.shots - expected)).toBeLessThanOrEqual(expected * 0.05);
    // Every second holds the rate as well, not only the total.
    for (let s = 0; s < 60; s++) {
      const n = perTick.slice(s * 10, s * 10 + 10).reduce((a, b) => a + b, 0);
      expect(Math.abs(n - sps)).toBeLessThanOrEqual(Math.max(1, sps * 0.05));
    }
    expect(sc.simTimeS).toBeCloseTo(60, 9);
    expect(sc.stats.impacts).toBe(sc.stats.shots - sc.inFlight);
  });

  it('handles fractional rates by carrying the budget', () => {
    const sc = new GefechtScenario({ seed: 1, shotsPerSecond: 7 });
    run(sc, 1000);
    expect(sc.stats.shots).toBe(700);
  });

  it('is deterministic per seed and differs between seeds', () => {
    const a = streamHash(11, 200, 900);
    const b = streamHash(11, 200, 900);
    const c = streamHash(12, 200, 900);
    expect(a).toEqual(b);
    expect(a.events).toBeGreaterThan(30_000);
    expect(c.hash).not.toBe(a.hash);
  });

  it('writes events with the documented field semantics', () => {
    const sc = new GefechtScenario({ seed: 5, shotsPerSecond: 200 });
    const counts = new Map<SimEventKind, number>();
    const surfaces = new Set<number>();
    const sizes = new Set<number>();
    let prevTick = 0;
    run(sc, 3000, (kind, s, i) => {
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
      const tick = s.eventTick(i);
      expect(tick).toBeGreaterThanOrEqual(prevTick);
      prevTick = tick;
      expect(tick).toBe(sc.tick);
      const sub = s.eventSubTick(i);
      expect(Number.isInteger(sub) && sub >= 0 && sub <= 255).toBe(true);
      const x = s.eventPos(i, 0) / FX_ONE;
      const z = s.eventPos(i, 2) / FX_ONE;
      expect(Number.isInteger(s.eventPos(i, 0))).toBe(true);
      expect(x).toBeGreaterThanOrEqual(-64);
      expect(x).toBeLessThanOrEqual(FIELD_SIZE + 64);
      expect(z).toBeGreaterThanOrEqual(-64);
      expect(z).toBeLessThanOrEqual(FIELD_SIZE + 64);
      if (kind === 'weaponFire' || kind === 'projectileImpact') {
        expect(visualName(s.eventVisual(i))).toMatch(/^core:wpn_/);
      }
      if (kind === 'projectileImpact') {
        surfaces.add(s.eventAux(i));
        expect(s.eventFlags(i) === 0 || s.eventFlags(i) === EVENT_FLAG_STRUCTURE).toBe(true);
        if (s.eventAux(i) === 4) expect(s.eventFlags(i)).toBe(EVENT_FLAG_STRUCTURE);
      }
      if (kind === 'unitDeath') {
        sizes.add(s.eventAux(i));
        expect([0, EVENT_FLAG_AIR, EVENT_FLAG_STRUCTURE]).toContain(s.eventFlags(i));
      }
      if (kind === 'alert') {
        const name = ALERT_KINDS[s.eventAux(i)]?.name;
        expect(SCENARIO_ALERTS as readonly (string | undefined)[]).toContain(name);
      }
    });
    // 300 s at 200 shots/s: all kinds occur, deaths ~8/s.
    expect(counts.get('weaponFire')).toBe(60_000);
    expect(counts.get('projectileImpact')).toBeGreaterThan(55_000);
    const deaths = counts.get('unitDeath') ?? 0;
    expect(deaths / 300).toBeGreaterThan(4);
    expect(deaths / 300).toBeLessThan(15);
    expect(counts.get('commanderDeath') ?? 0).toBeGreaterThanOrEqual(1);
    expect(counts.get('alert') ?? 0).toBeGreaterThan(10);
    expect([...surfaces].sort()).toEqual([0, 1, 2, 4]);
    expect([...sizes].sort()).toEqual([0, 1, 2]);
    expect(sc.stats.airDeaths).toBeGreaterThan(0);
    expect(sc.stats.alertsByKind.alt_base_attacked).toBeGreaterThan(0);
    expect(sc.stats.alertsByKind.alt_commander_danger).toBeGreaterThan(0);
    expect(sc.stats.alertsByKind.alt_enemy_commander_spotted).toBeGreaterThanOrEqual(14);
    expect(sc.stats.maxEventsPerTick).toBeLessThan(120);
  });

  it('uses only weapon refs of the default event map (visualName table)', () => {
    for (let w = 0; w < WEAPONS.length; w++) {
      const ref = visualName(weaponVisual(w))!;
      expect(DEFAULT_EVENT_SOUND_MAP.weapons[ref], ref).toBeDefined();
    }
    expect(visualName(0)).toBeUndefined();
    expect(visualName(WEAPONS.length + 1)).toBeUndefined();
    for (const ref of ['core:wpn_cannon_t1', 'core:wpn_mg_t1', 'core:wpn_spark_mg_t1', 'core:wpn_slag_mortar_t1', 'core:wpn_reeve_cannon', 'core:wpn_bolt_cannon_t1']) {
      expect(WEAPONS.map((w) => w.ref)).toContain(ref);
    }
  });

  it('routes through the real EventRouter without unmapped events', () => {
    const manifest: unknown = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../content/audio/dist/manifest.json'), 'utf8'));
    const catalog = SoundCatalog.fromJson(manifest);
    const played = new Map<string, number>();
    const sink: SoundSink = {
      lastDrop: null as DropReason | null,
      play(req: PlayRequest): VoiceHandle | null {
        const id = typeof req.sound === 'number' ? catalog.byIndex(req.sound).id : req.sound;
        played.set(id, (played.get(id) ?? 0) + 1);
        return null;
      },
    };
    const alerts: AlertRequest[] = [];
    const router = new EventRouter({
      map: DEFAULT_EVENT_SOUND_MAP,
      resolver: catalog,
      faction: 'varkan',
      visualName,
      alerts: { push: (r) => (alerts.push({ ...r }), true) },
    });
    const sc = new GefechtScenario({ seed: 2, shotsPerSecond: 200 });
    const out = new ArrayEventSource();
    for (let t = 0; t < 1200; t++) {
      sc.step(out, null);
      router.handle(out, sink, t * TICK_S, t * 100);
    }
    expect(router.stats.events).toBe(sc.stats.events);
    expect(router.stats.eventsUnmapped).toBe(0);
    for (const id of ['varkan:wpn_cannon_t1_fire', 'varkan:wpn_mg_t1_fire', 'varkan:wpn_slag_mortar_t1_fire', 'varkan:wpn_reeve_cannon_fire', 'common:imp_shell_ground', 'common:imp_shell_metal', 'varkan:exp_small']) {
      expect(played.get(id) ?? 0, id).toBeGreaterThan(0);
    }
    expect(alerts.length).toBe(sc.stats.alerts);
    for (const a of alerts) {
      expect(a.located).not.toBe(false);
      expect(a.x).toBeTypeOf('number');
      expect(a.z).toBeTypeOf('number');
    }
  });

  it('drives one build loop per army that pauses and resumes', () => {
    const sc = new GefechtScenario({ seed: 1 });
    const loops = new LoopRecorder();
    run(sc, 900, undefined, loops);
    for (const key of ['build:0', 'build:1']) {
      const calls = loops.calls.filter((c) => c.key === key);
      expect(calls.length).toBeGreaterThan(50);
      const stops = calls.filter((c) => c.sound === null);
      expect(stops.length).toBeGreaterThanOrEqual(1);
      for (const c of calls) if (c.sound !== null) expect(c.sound).toBe('bld_pour_loop');
      const gains = calls.filter((c) => c.gain !== undefined).map((c) => c.gain!);
      expect(Math.min(...gains)).toBeGreaterThanOrEqual(0.4);
      expect(Math.max(...gains)).toBeLessThanOrEqual(1);
      // Resumed after a pause.
      const firstStop = calls.findIndex((c) => c.sound === null);
      expect(calls.slice(firstStop + 1).some((c) => c.sound !== null)).toBe(true);
    }
    expect(sc.stats.loopCalls).toBe(loops.calls.length);
    const n = loops.calls.length;
    sc.stopLoops(loops);
    const stopped = loops.calls.slice(n);
    for (const c of stopped) expect(c.sound).toBeNull();
    expect(copyScenarioStats(sc.stats)).toEqual(sc.stats);
  });

  it('does not allocate per tick after warm-up (garbage included)', () => {
    const sc = new GefechtScenario({ seed: 9, shotsPerSecond: 400 });
    const out = new ArrayEventSource(512);
    const sink: ScenarioLoopSink = { setLoop: () => undefined };
    for (let t = 0; t < 1500; t++) sc.step(out, sink);
    // No gc() between the loop and the second reading (test/heap.ts).
    const allocated = measureAllocatedBytes(() => {
      for (let t = 0; t < 10_000; t++) sc.step(out, sink);
    });
    console.info(`gefecht scenario: ${(allocated / 1024).toFixed(1)} KB allocated over 10000 ticks`);
    // 10 000 ticks × ~80 events: even 2 bytes per event would be ~1.6 MB.
    expect(allocated).toBeLessThan(1_000_000);
  });

  it('rejects invalid rates', () => {
    expect(() => new GefechtScenario({ shotsPerSecond: -1 })).toThrow(RangeError);
    expect(() => new GefechtScenario({ shotsPerSecond: Number.NaN })).toThrow(RangeError);
  });
});
