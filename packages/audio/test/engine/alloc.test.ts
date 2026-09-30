/**
 * Memory behaviour of the engine hot path (handleEvents → router → gated sink → voice manager,
 * update per frame). Two different questions, two measurements:
 *
 * 1. ALLOCATION of the event path (garbage included, bench/heap.ts: no gc() between the loop and
 *    the second reading): 100 000 battle events routed through the whole engine while the
 *    listener is far away, so every play ends in a voice-manager drop (cooldown / culled) — the
 *    path most events of a big battle take. Bound 1 MB, i.e. < 10 B per event: a single boxed
 *    double per event (16 B) already fails it.
 *
 * 2. RETENTION of the full battle (voices really start and get stolen): heap still live after
 *    20 000 frames compared to after the warm-up, measured with gc() before both readings. This
 *    is a leak test, not an allocation test — starting a voice necessarily allocates (three Web
 *    Audio nodes + one handle; in the fake context also the param event arrays), which is garbage
 *    once the voice ends. The allocated bytes per started voice are reported for information.
 *    Bound 1 MB after 20 000 frames (≈ 333 s at 60 fps, ≈ 67 000 shots): what may legitimately
 *    be live at the second reading but not at the first is at most 32 voices + 8 tails with
 *    their fake nodes (≈ 2 KB each, subtracted via `liveNodesDelta`) plus V8 noise (inline
 *    caches, optimised code) of a few hundred KB; a leak of 50 B per frame would add 1 MB.
 */
import { describe, expect, it } from 'vitest';
import { measureAllocation } from '../../bench/heap.ts';
import { BattleDriver, BattleScenario, battleVisualName } from '../../bench/scenario.ts';
import { DEFAULT_EVENT_TYPES, EVENT_FLAG_AIR, EVENT_FLAG_STRUCTURE } from '../../src/events/index.ts';
import { ArrayEventSource, FX_ONE } from '../../src/types.ts';
import { makeEngineRig, unlockByGesture } from './rig.ts';

const gc = (globalThis as { gc?: () => void }).gc;

describe('AudioEngine allocation', () => {
  it('routes 100 000 events through the engine (all plays dropped by the voice manager) allocating < 1 MB', async () => {
    const r = makeEngineRig({ context: { logAutomation: false }, engine: { visualName: battleVisualName } });
    await unlockByGesture(r);
    // Camera far away from the battle: every spatial play is culled (or hits its cooldown first).
    r.engine.setListener({ focusX: 90_000, focusZ: 90_000, height: 60, viewHalfWidth: 40, rightX: 1, rightZ: 0 });
    // One 10-Hz tick of a big battle: shots, impacts, deaths (air/structure), fractional positions.
    const src = new ArrayEventSource(256);
    const T = DEFAULT_EVENT_TYPES;
    for (let i = 0; i < 200; i++) {
      const m = i % 10;
      const type = m < 5 ? T.weaponFire : m < 9 ? T.projectileImpact : T.unitDeath;
      const flags = m === 9 ? (i % 20 === 9 ? EVENT_FLAG_AIR : EVENT_FLAG_STRUCTURE) : 0;
      const x = Math.round((200 + ((i * 17) % 120) + 0.37) * FX_ONE);
      const z = Math.round((200 + ((i * 29) % 120) + 0.61) * FX_ONE);
      src.push(type, 1 + (i % 6), 0, (i * 53) % 256, flags, x, 0, z, i % 4, 7);
    }
    // 60 fps, one batch every 6th frame (10 Hz sim).
    const run = (fromTick: number, toTick: number): void => {
      for (let t = fromTick; t < toTick; t++) {
        for (let i = 0; i < src.count; i++) src.events[i]!.tick = t;
        r.engine.handleEvents(src);
        for (let f = 0; f < 6; f++) {
          r.ctx.advance(1000 / 60);
          r.engine.update();
        }
      }
    };
    run(0, 500); // warm-up incl. JIT tier-up (optimised code and feedback are heap allocations too)
    const s0 = r.engine.stats();
    const m = measureAllocation(() => run(500, 1000));
    const s1 = r.engine.stats();
    expect(s1.events - s0.events).toBe(100_000);
    expect(s1.played - s0.played).toBe(0);
    expect(s1.dropped.culled - s0.dropped.culled).toBeGreaterThan(1000);
    console.info(
      `engine event path: ${(m.allocatedBytes / 1024).toFixed(1)} KB allocated over 100000 events, ` +
        `${s1.dropped.cooldown - s0.dropped.cooldown} cooldown + ${s1.dropped.culled - s0.dropped.culled} culled drops, ${m.gcs} GCs`,
    );
    expect(m.allocatedBytes).toBeLessThan(1024 * 1024);
    await r.engine.dispose();
  });

  it.skipIf(gc === undefined)('20 000 battle frames after warm-up: retained heap < 1 MB (leak test)', async () => {
    const r = makeEngineRig({ context: { logAutomation: false }, engine: { visualName: battleVisualName } });
    await unlockByGesture(r);
    const scenario = new BattleScenario({ seconds: 1e6, fps: 60, shotsPerSecond: 200, impactsPerSecond: 150, deathsPerSecond: 8 });
    const driver = new BattleDriver(r.engine, scenario, { advance: (ms) => r.ctx.advance(ms), now: () => r.ctx.nowMs });
    const run = (frames: number): void => {
      for (let f = 0; f < frames; f++) driver.step();
    };
    run(3000); // warm-up: JIT, typed-array growth of the router staging tables, first alerts
    const pool = r.engine.voices!.poolSize;
    gc!();
    gc!();
    const liveBefore = r.ctx.liveSources;
    const before = process.memoryUsage().heapUsed;
    const played0 = r.engine.stats().played;
    const alloc = measureAllocation(() => run(20_000));
    const playedIn = r.engine.stats().played - played0;
    gc!();
    gc!();
    const after = process.memoryUsage().heapUsed;
    const liveDelta = Math.max(0, r.ctx.liveSources - liveBefore);
    // Upper bound of the fake-node share: source + gain + panner with params ≈ 2 KB per live voice.
    const fakeShare = liveDelta * 2048;
    const retained = after - before - fakeShare;
    const s = r.engine.stats();
    expect(r.engine.voices!.poolSize).toBe(pool);
    expect(s.voices).toBeLessThanOrEqual(32);
    expect(s.played).toBeGreaterThan(20_000);
    expect(s.stolen).toBeGreaterThan(0);
    expect(s.events).toBeGreaterThan(80_000);
    console.info(
      `engine battle: retained ${(retained / 1024).toFixed(1)} KB (raw ${((after - before) / 1024).toFixed(1)} KB, live sources ${liveBefore} → ${r.ctx.liveSources}); ` +
        `allocated ${(alloc.allocatedBytes / 1048576).toFixed(1)} MB incl. test driver and fake nodes = ${(alloc.allocatedBytes / Math.max(1, playedIn)).toFixed(0)} B per started voice (${playedIn} started)`,
    );
    expect(retained).toBeLessThan(1024 * 1024);
    await r.engine.dispose();
  });
});
