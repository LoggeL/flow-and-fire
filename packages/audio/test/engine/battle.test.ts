/**
 * Scenario 'Gefecht-200' through the whole engine (router → alert queue → gated sink → voice
 * manager → fake Web Audio graph): 10 s of simulated time at 60 fps with 10 Hz sim ticks,
 * 200 weaponFire/s over six weapon refs, 150 impacts/s, 8 deaths/s, one commanderDeath, three
 * located alerts and two keyed build loops. Invariants are checked after EVERY frame.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BATTLE_LISTENER,
  BattleDriver,
  BattleScenario,
  DEFAULT_BATTLE_ALERTS,
  battleVisualName,
} from '../../bench/scenario.ts';
import { dbToGain } from '../../src/mixer/index.ts';
import { DROP_REASONS, SOUND_CATEGORIES, type DropReason, type PlayRequest, type SoundCategory, type VoiceHandle } from '../../src/types.ts';
import { ALERT_DUCK_SFX_DB } from '../../src/engine/index.ts';
import { makeEngineRig, unlockByGesture, type Rig } from './rig.ts';

const TAIL_BUDGET = 8;

type Outcome = { played: number; dropped: Record<DropReason, number> };

function emptyOutcome(): Outcome {
  const dropped = {} as Record<DropReason, number>;
  for (const r of DROP_REASONS) dropped[r] = 0;
  return { played: 0, dropped };
}

/** Records the outcome of every voice-manager play per category (test-only spy). */
function spyOutcomes(r: Rig): Record<SoundCategory, Outcome> {
  const out = {} as Record<SoundCategory, Outcome>;
  for (const c of SOUND_CATEGORIES) out[c] = emptyOutcome();
  const voices = r.engine.voices!;
  const catalog = r.engine.catalog!;
  const orig = voices.play.bind(voices);
  vi.spyOn(voices, 'play').mockImplementation((req: PlayRequest, nowMs: number): VoiceHandle | null => {
    const h = orig(req, nowMs);
    const idx = typeof req.sound === 'number' ? req.sound : catalog.resolveIndex(req.sound, req.faction ?? 'varkan');
    if (idx >= 0) {
      const o = out[catalog.byIndex(idx).category];
      if (h !== null) o.played++;
      else if (voices.lastDrop !== null) o.dropped[voices.lastDrop]++;
    }
    return h;
  });
  return out;
}

/**
 * Sources that will still produce sound: started, ending after now and after their own start
 * (a source cut at the current time, or stopped before its scheduled start, stays "live" in the
 * fake until the next clock step but is silent). The unlocker's one-sample silence is ignored.
 */
function audibleSources(r: Rig): number {
  let n = 0;
  const t = r.ctx.currentTime;
  for (const src of r.ctx.activeSources()) {
    if (src.buffer !== null && src.buffer.length === 1) continue;
    const end = src.endTime!;
    if (end > t && end > src.startAt!) n++;
  }
  return n;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("engine scenario 'Gefecht-200'", () => {
  it('10 s @ 60 fps: limits hold every frame, limits bite, important sounds get through', async () => {
    const jumps: { x: number; z: number }[] = [];
    const r = makeEngineRig({ engine: { visualName: battleVisualName, onJumpTo: (x, z) => jumps.push({ x, z }) } });
    await unlockByGesture(r);
    const outcomes = spyOutcomes(r);
    const catLimit = SOUND_CATEGORIES.map((c) => r.manifest.categories[c].maxVoices);
    const commanderIdx = r.engine.catalog!.resolveIndex('exp_commander', 'varkan');
    const scenario = new BattleScenario({ seconds: 10, fps: 60, shotsPerSecond: 200, impactsPerSecond: 150, deathsPerSecond: 8 });
    const voices = r.engine.voices!;

    let frames = 0;
    let maxVoices = 0;
    let maxLive = 0;
    let maxAudible = 0;
    const maxByCat = new Int32Array(SOUND_CATEGORIES.length);
    let commanderHeard = false;
    let duckedWhileAlert = 0;
    let alertFrames = 0;
    let explosionFrames = 0;
    let acks = 0;
    let lastAckMs = -1e9;
    const violations: string[] = [];

    const driver = new BattleDriver(r.engine, scenario, {
      advance: (ms) => r.ctx.advance(ms),
      now: () => r.ctx.nowMs,
      onFrame: (f) => {
        frames++;
        const s = r.engine.stats();
        maxVoices = Math.max(maxVoices, s.voices);
        maxLive = Math.max(maxLive, r.ctx.liveSources);
        if (s.voices > 32) violations.push(`frame ${f}: ${s.voices} voices`);
        if (s.tails > TAIL_BUDGET) violations.push(`frame ${f}: ${s.tails} tails`);
        // Every sound-producing source belongs to a logical voice or a fading tail.
        const audible = audibleSources(r);
        maxAudible = Math.max(maxAudible, audible);
        if (audible > s.voices + s.tails) violations.push(`frame ${f}: ${audible} audible sources > ${s.voices} voices + ${s.tails} tails`);
        for (let c = 0; c < SOUND_CATEGORIES.length; c++) {
          const n = s.voicesByCategory[SOUND_CATEGORIES[c]!];
          if (n > catLimit[c]!) violations.push(`frame ${f}: ${SOUND_CATEGORIES[c]} ${n} > ${catLimit[c]}`);
        }
        for (let c = 0; c < SOUND_CATEGORIES.length; c++) {
          const n = s.voicesByCategory[SOUND_CATEGORIES[c]!];
          if (n > maxByCat[c]!) maxByCat[c] = n;
        }
        if (s.voicesByCategory.explosion > 0) explosionFrames++;
        if (voices.soundVoices(commanderIdx) > 0) commanderHeard = true;
        if (s.voicesByCategory.alert > 0) {
          alertFrames++;
          if (r.engine.mixer.duckLevel('sfx') < 1) duckedWhileAlert++;
        }
        // Acknowledgement click once per second in the middle of the battle: starts synchronously.
        if (s.voices >= 20 && r.ctx.nowMs - lastAckMs >= 1000) {
          const before = r.ctx.startedSources;
          const h = r.engine.playUi('ack_pip_direct');
          if (h === null || r.ctx.startedSources !== before + 1) violations.push(`frame ${f}: ack not started`);
          else {
            const src = r.ctx.activeSources()[r.ctx.activeSources().length - 1]!;
            if (src.startWhen !== 0) violations.push(`frame ${f}: ack scheduled at ${src.startWhen}`);
            acks++;
          }
          lastAckMs = r.ctx.nowMs;
        }
      },
    });
    const total = driver.frames;
    for (let f = 0; f < total; f++) driver.step();

    expect(violations.slice(0, 10)).toEqual([]);
    expect(frames).toBe(600);
    expect(scenario.counts.weaponFire).toBe(2000);
    expect(scenario.counts.impacts).toBe(1500);
    expect(scenario.counts.deaths).toBe(80);
    expect(scenario.counts.commanderDeaths).toBe(1);
    expect(scenario.counts.alerts).toBe(3);

    const s = r.engine.stats();
    // Voices stay within the budget; the category limits of the flood categories are reached
    // (weapon 10, impact 8) and bite: steals plus categoryLimit/cooldown drops.
    expect(maxVoices).toBeLessThanOrEqual(32);
    expect(maxVoices).toBeGreaterThanOrEqual(20);
    expect(s.peakVoices).toBe(maxVoices);
    const ci = (c: SoundCategory): number => SOUND_CATEGORIES.indexOf(c);
    expect(maxByCat[ci('weapon')]).toBe(r.manifest.categories.weapon.maxVoices);
    expect(maxByCat[ci('impact')]).toBe(r.manifest.categories.impact.maxVoices);
    expect(maxByCat[ci('alert')]).toBe(1);
    expect(maxAudible).toBeLessThanOrEqual(32 + TAIL_BUDGET);
    expect(maxAudible).toBeGreaterThan(32); // steals produce fading tails on top of the 32 voices
    // Lingering hard-cut sources end on the next clock step: after the run nothing leaks.
    expect(maxLive).toBeLessThan(64);
    const drops = DROP_REASONS.reduce((a, k) => a + s.dropped[k], 0);
    expect(drops + s.stolen).toBeGreaterThan(0);
    expect(s.stolen).toBeGreaterThan(0);
    expect(s.dropped.categoryLimit).toBeGreaterThan(100);
    expect(s.dropped.cooldown).toBeGreaterThan(100);
    expect(s.dropped.culled).toBeGreaterThan(0); // far-away share
    expect(s.dropped.locked).toBe(0);
    expect(s.events).toBe(2000 + 1500 + 80 + 1 + 3);
    expect(s.eventsUnmapped).toBe(0);

    // Weapons are the flood: most of their requests are dropped.
    const w = outcomes.weapon;
    const wDrops = DROP_REASONS.reduce((a, k) => a + w.dropped[k], 0);
    expect(w.played).toBeGreaterThan(50);
    expect(wDrops).toBeGreaterThan(w.played);

    // Explosions stay audible: never dropped for the global budget (priority 70 > weapons 50).
    const e = outcomes.explosion;
    expect(e.played).toBeGreaterThan(40);
    expect(e.dropped.globalLimit).toBe(0);
    expect(explosionFrames).toBeGreaterThan(200);
    expect(commanderHeard).toBe(true);

    // All three alerts are voiced, duck the sfx bus and can be jumped to.
    const a = r.engine.alerts!;
    expect(a.stats.announced).toBe(3);
    expect(a.stats.voiced).toBe(3);
    expect(outcomes.alert.played).toBe(3);
    expect(alertFrames).toBeGreaterThan(0);
    expect(duckedWhileAlert).toBe(alertFrames);
    expect(r.engine.mixer.duckLevel('sfx')).toBeLessThanOrEqual(1);

    // Acks during the battle: started synchronously every time.
    expect(acks).toBeGreaterThanOrEqual(8);
    expect(outcomes.ack.played).toBe(acks);

    // Build loops: both keys still present (restarted after steals when possible).
    expect(r.engine.loops!.has('build:0')).toBe(true);
    expect(r.engine.loops!.has('build:1')).toBe(true);

    // Jump to the newest located alert, then step back.
    expect(r.engine.jumpToLastAlert()).toBe(true);
    const last = DEFAULT_BATTLE_ALERTS[DEFAULT_BATTLE_ALERTS.length - 1]!;
    expect(jumps[0]).toEqual({ x: last.x, z: last.z });
    expect(r.engine.jumpToLastAlert()).toBe(true);
    const prev = DEFAULT_BATTLE_ALERTS[DEFAULT_BATTLE_ALERTS.length - 2]!;
    expect(jumps[1]).toEqual({ x: prev.x, z: prev.z });

    // Main-thread timing ring: one sample per frame.
    expect(s.mainJs.samples).toBe(600);
    expect(s.mainJs.p50).toBeGreaterThan(0);
    await r.engine.dispose();
  });

  it("'Gefecht-400' with 20 ambient/unit/eco/projectile loops: the global budget of 32 is reached and holds", async () => {
    const r = makeEngineRig({ engine: { visualName: battleVisualName } });
    await unlockByGesture(r);
    const outcomes = spyOutcomes(r);
    const loops: [string, string][] = [];
    const mov = ['mov_tracks_loop', 'mov_tracks_heavy_loop', 'mov_air_jet_loop', 'mov_gunship_loop'];
    for (let i = 0; i < 8; i++) loops.push([`mov:${i}`, mov[i % 4]!]);
    const eco = ['eco_mex_loop', 'eco_pgen_loop', 'eco_hydro_loop', 'eco_flow_hum_loop'];
    for (let i = 0; i < 4; i++) loops.push([`eco:${i}`, eco[i]!]);
    for (let i = 0; i < 4; i++) loops.push([`prj:${i}`, i % 2 === 0 ? 'prj_missile_loop' : 'prj_shell_whistle_loop']);
    loops.push(['amb:0', 'amb_wind_loop'], ['amb:1', 'amb_magma_loop']);
    loops.forEach(([key, sound], i) => r.engine.setLoop(key, { sound, x: -25 + (i % 10) * 5, z: -10 + (i % 3) * 10 }));
    const scenario = new BattleScenario({ seconds: 6, fps: 60, shotsPerSecond: 400 });
    let maxVoices = 0;
    let fullFrames = 0;
    const violations: string[] = [];
    const driver = new BattleDriver(r.engine, scenario, {
      advance: (ms) => r.ctx.advance(ms),
      now: () => r.ctx.nowMs,
      onFrame: (f) => {
        const st = r.engine.stats();
        maxVoices = Math.max(maxVoices, st.voices);
        if (st.voices === 32) fullFrames++;
        if (st.voices > 32) violations.push(`frame ${f}: ${st.voices} voices`);
        if (st.tails > TAIL_BUDGET) violations.push(`frame ${f}: ${st.tails} tails`);
        if (audibleSources(r) > st.voices + st.tails) violations.push(`frame ${f}: audible sources exceed voices + tails`);
        for (const c of SOUND_CATEGORIES) {
          if (st.voicesByCategory[c] > r.manifest.categories[c].maxVoices) violations.push(`frame ${f}: ${c} over its limit`);
        }
      },
    });
    for (let f = 0; f < driver.frames; f++) driver.step();
    expect(violations.slice(0, 10)).toEqual([]);
    const s = r.engine.stats();
    expect(maxVoices).toBe(32);
    expect(fullFrames).toBeGreaterThan(60);
    expect(s.stolen).toBeGreaterThan(0);
    expect(s.dropped.globalLimit).toBeGreaterThan(0);
    // Priority order: explosions and alerts are never refused for the global budget.
    expect(outcomes.explosion.dropped.globalLimit).toBe(0);
    expect(outcomes.explosion.played).toBeGreaterThan(20);
    expect(scenario.counts.alerts).toBe(2); // alerts at 2 s and 4.5 s
    expect(outcomes.alert.played).toBe(2);
    // The lowest priorities (eco 5, ambience 10) are the ones that lose their voices.
    expect(outcomes.eco.dropped.globalLimit + outcomes.ambience.dropped.globalLimit).toBeGreaterThan(0);
    await r.engine.dispose();
  });

  it('an alert ducks the sfx bus by ALERT_DUCK_SFX_DB during the battle', async () => {
    const r = makeEngineRig({ engine: { visualName: battleVisualName } });
    await unlockByGesture(r);
    const scenario = new BattleScenario({ seconds: 3, fps: 60, shotsPerSecond: 200, alerts: [{ atS: 1, kind: 'alt_base_attacked', x: 5, z: 5 }] });
    let ducked = -1;
    const driver = new BattleDriver(r.engine, scenario, {
      advance: (ms) => r.ctx.advance(ms),
      now: () => r.ctx.nowMs,
      onFrame: () => {
        if (ducked < 0 && r.engine.stats().voicesByCategory.alert > 0) ducked = r.engine.mixer.duckLevel('sfx');
      },
    });
    for (let f = 0; f < driver.frames; f++) driver.step();
    expect(ducked).toBeCloseTo(dbToGain(ALERT_DUCK_SFX_DB), 6);
    // After the alert (≈ 1.25 s) plus release the sfx bus is back at unity.
    for (let i = 0; i < 120; i++) {
      r.ctx.advance(16);
      r.engine.update();
    }
    expect(r.engine.mixer.graph.duck.sfx.gain.value).toBeGreaterThan(0.95);
    await r.engine.dispose();
  });

  it('locked engine: the whole battle is dropped as locked and nothing is replayed after unlock', async () => {
    const r = makeEngineRig({ engine: { visualName: battleVisualName } });
    const scenario = new BattleScenario({ seconds: 2, fps: 60, shotsPerSecond: 200 });
    const driver = new BattleDriver(r.engine, scenario, { advance: (ms) => r.ctx.advance(ms), now: () => r.ctx.nowMs });
    for (let f = 0; f < 60; f++) driver.step();
    let s = r.engine.stats();
    expect(s.played).toBe(0);
    expect(s.dropped.locked).toBeGreaterThan(50);
    expect(r.ctx.startedSources).toBe(0);
    await unlockByGesture(r);
    // Only the unlocker's one-sample silence was started by the unlock; the keyed build loops
    // start right away (they are state, not stale events).
    s = r.engine.stats();
    expect(s.played).toBe(2);
    expect(s.voicesByCategory.build).toBe(2);
    // The rest of the battle plays normally.
    for (let f = 60; f < driver.frames; f++) driver.step();
    expect(r.engine.stats().played).toBeGreaterThan(20);
    await r.engine.dispose();
  });

  it('listener at the battle camera: sounds left of the focus pan left', async () => {
    const r = makeEngineRig();
    await unlockByGesture(r);
    r.engine.setListener(BATTLE_LISTENER);
    const h = r.engine.play({ sound: 'exp_small', x: -30, z: 0 });
    expect(h).not.toBeNull();
    const src = r.ctx.activeSources()[r.ctx.activeSources().length - 1]!;
    const path = r.ctx.graphPathToDestination(src)!;
    const panner = path.find((n) => n.kind === 'panner') as unknown as { pan: { value: number } };
    expect(panner.pan.value).toBeLessThan(-0.5);
    await r.engine.dispose();
  });
});
