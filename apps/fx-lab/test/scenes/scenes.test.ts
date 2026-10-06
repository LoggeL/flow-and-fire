import { describe, expect, it } from 'vitest';
import { FxRng, VARKAN_EFFECTS } from '@faf/render-fx';
import type { SceneName } from '../../src/app/context.ts';
import { LabSimulation } from '../../src/app/sim.ts';
import { BATTLE_UNITS } from '../../src/scenes/battle.ts';
import { BIG_FIRST_S, BIG_PERIOD_S } from '../../src/scenes/big.ts';
import { OP } from '../../src/scenes/fx-record.ts';
import { LAB_SCENES, createLabFx } from '../../src/scenes/index.ts';
import { SHIELD_COUNT } from '../../src/scenes/shields.ts';
import { headlessWorld, recordingFx, runSeconds, startScene } from './support/harness.ts';

const FX_SCENES: readonly SceneName[] = ['battle', 'shields', 'big', 'gallery'];

describe('scene registry', () => {
  it('registers all five scenes; createLabFx runs headless without draws', () => {
    for (const n of ['lighting', ...FX_SCENES] as SceneName[]) expect(LAB_SCENES[n], n).toBeTypeOf('function');
    const sim = new LabSimulation(headlessWorld('?scene=battle'), LAB_SCENES.battle!, createLabFx);
    sim.advance(1 / 60);
    const enc = null as never;
    expect(sim.ctx.fx.encodeShields(enc) + sim.ctx.fx.encodeParticles(enc) + sim.ctx.fx.encodeBeams(enc)).toBe(0);
    expect(sim.ctx.fx.stats().particles?.cap).toBe(16384);
    sim.destroy();
  });
});

describe.each(FX_SCENES)('scene %s: 20 s fixed step', (name) => {
  it('is deterministic: same seed → same FX call log, other seed → other log', () => {
    const a = startScene(name, '&seed=7');
    const b = startScene(name, '&seed=7');
    const c = startScene(name, '&seed=8');
    runSeconds(a, 20);
    runSeconds(b, 20);
    runSeconds(c, 20);
    expect(a.parts.log.calls).toBeGreaterThan(1000);
    expect(a.parts.log.hash).toBe(b.parts.log.hash);
    expect(a.parts.log.calls).toBe(b.parts.log.calls);
    expect(a.sim.checksum()).toBe(b.sim.checksum());
    expect(c.parts.log.hash).not.toBe(a.parts.log.hash);
    // The gallery layout is fixed; only the particle seeds depend on the seed there.
    if (name !== 'gallery') expect(c.sim.checksum()).not.toBe(a.sim.checksum());
  });

  it('freeze: the state does not depend on the frame pacing', () => {
    const rec1 = recordingFx();
    const rec2 = recordingFx();
    const s1 = new LabSimulation(headlessWorld(`?scene=${name}&freeze=6&seed=3`), LAB_SCENES[name]!, rec1.factory);
    const s2 = new LabSimulation(headlessWorld(`?scene=${name}&freeze=6&seed=3`), LAB_SCENES[name]!, rec2.factory);
    const rng = new FxRng(4);
    while (!s1.clock.frozen) s1.advance(1 / 60);
    while (!s2.clock.frozen) s2.advance(rng.range(0.001, 0.3));
    expect(s1.clock.steps).toBe(360);
    expect(s2.clock.steps).toBe(360);
    expect(rec2.parts().log.hash).toBe(rec1.parts().log.hash);
    expect(s2.checksum()).toBe(s1.checksum());
  });
});

describe('battle', () => {
  it('keeps 2×200 units alive while fighting, > 50 effects/s, builds and reclaims', () => {
    const r = startScene('battle');
    let minUnits = Infinity;
    let maxUnits = 0;
    runSeconds(r, 20, () => {
      const u = r.sim.scene.stats!()['units']!;
      minUnits = Math.min(minUnits, u);
      maxUnits = Math.max(maxUnits, u);
    });
    expect(minUnits).toBeGreaterThanOrEqual(BATTLE_UNITS - 10);
    expect(maxUnits).toBeLessThanOrEqual(BATTLE_UNITS + 10);
    const effects0 = r.kit.counters.effects;
    const deaths0 = r.sim.scene.stats!()['deaths']!;
    runSeconds(r, 10);
    const st = r.sim.scene.stats!();
    const effectsPerS = (r.kit.counters.effects - effects0) / 10;
    expect(effectsPerS).toBeGreaterThan(50);
    expect(st['effectsPerS']).toBeGreaterThan(50);
    expect(st['deaths']! - deaths0).toBeGreaterThan(10);
    expect(st['wrecks']).toBeGreaterThan(20);
    expect(st['damaged']).toBeGreaterThan(5);
    expect(st['built']! + st['buildProgress']! / 100).toBeGreaterThan(1);
    expect(st['reclaimed']).toBeGreaterThan(0);
    const spawns = r.parts.particles.spawnsByEffect;
    const lib = r.kit.lib;
    for (const id of ['muzzle_small', 'muzzle_cannon', 'muzzle_artillery', 'muzzle_missile', 'impact_metal', 'impact_ground_small', 'impact_ground_large', 'explosion_small', 'explosion_large', 'smoke_puff']) {
      expect(spawns[lib.indexOf(`varkan:${id}`)], id).toBeGreaterThan(0);
    }
    // Trails, streams (beam cores) and continuous emitters are in use.
    expect(r.parts.log.count[OP.trailAdd]).toBeGreaterThan(1000);
    expect(r.parts.log.count[OP.beamAdd]).toBeGreaterThan(100);
    expect(r.parts.particles.stats.emitters).toBeGreaterThan(50);
    expect(r.sim.ctx.scorch.count).toBeGreaterThan(100);
  });
});

describe('shields', () => {
  it('has 20 shields, > 5 hits/s, a cyclic collapse and ground hits', () => {
    const r = startScene('shields');
    runSeconds(r, 5);
    expect(r.parts.shields.stats.shields).toBe(SHIELD_COUNT);
    const hits0 = r.kit.counters.shieldHits;
    let collapsedSeen = false;
    runSeconds(r, 15, () => {
      if (r.sim.scene.stats!()['collapsed'] === 1) collapsedSeen = true;
    });
    const hitsPerS = (r.kit.counters.shieldHits - hits0) / 15;
    expect(hitsPerS).toBeGreaterThan(5);
    expect(r.parts.shields.stats.hits).toBe(r.kit.counters.shieldHits);
    const st = r.sim.scene.stats!();
    expect(st['shields']).toBe(20);
    expect(st['collapses']).toBeGreaterThanOrEqual(2);
    expect(collapsedSeen).toBe(true);
    expect(st['groundHits']).toBeGreaterThan(5);
    expect(r.parts.particles.spawnsByEffect[r.kit.lib.indexOf('varkan:impact_shield')]).toBeGreaterThan(75);
  });
});

describe('big', () => {
  it('fires the ACU explosion at t = 1 s, shakes the camera and repeats every 8 s', () => {
    const r = startScene('big');
    const acu = r.kit.lib.indexOf('varkan:acu_explosion');
    const aftermath = r.kit.lib.indexOf('varkan:acu_aftermath');
    const large = r.kit.lib.indexOf('varkan:explosion_large');
    const spawns = r.parts.particles.spawnsByEffect;
    const booms: number[] = [];
    let last = 0;
    runSeconds(r, 20, (t) => {
      if (spawns[acu]! > last) {
        booms.push(t);
        last = spawns[acu]!;
      }
    });
    expect(booms.length).toBe(3);
    expect(booms[0]).toBeCloseTo(BIG_FIRST_S, 9);
    expect(booms[1]).toBeCloseTo(BIG_FIRST_S + BIG_PERIOD_S, 9);
    expect(spawns[aftermath]).toBe(3);
    expect(spawns[large]).toBe(9);
    const st = r.sim.scene.stats!();
    expect(st['explosions']).toBe(3);
    expect(st['deaths']).toBeGreaterThan(3 * 30);
  });

  it('shake is active right after the explosion (onShake → CameraShake)', () => {
    const r = startScene('big');
    runSeconds(r, 0.9);
    expect(r.sim.ctx.shake.sample(0.9, [256, 8, 256]).active).toBe(false);
    runSeconds(r, 0.2);
    const s = r.sim.ctx.shake.sample(1.1, [256, 8, 256]);
    expect(s.active).toBe(true);
    expect(Math.hypot(s.dx, s.dy, s.dz)).toBeGreaterThan(0);
    // The crater of the commander is permanent and large.
    expect(r.sim.ctx.scorch.count).toBeGreaterThan(0);
  });

  it('trigger() explodes at once and restarts the schedule', () => {
    const r = startScene('big');
    runSeconds(r, 3);
    const acu = r.kit.lib.indexOf('varkan:acu_explosion');
    expect(r.parts.particles.spawnsByEffect[acu]).toBe(1);
    expect(r.sim.trigger()).toBe(true);
    expect(r.parts.particles.spawnsByEffect[acu]).toBe(2);
    runSeconds(r, 7.9);
    expect(r.parts.particles.spawnsByEffect[acu]).toBe(2);
    runSeconds(r, 0.2);
    expect(r.parts.particles.spawnsByEffect[acu]).toBe(3);
  });
});

describe('gallery', () => {
  it('plays every Varkan effect (bursts periodically, continuous ones as emitters)', () => {
    const r = startScene('gallery');
    runSeconds(r, 10);
    const lib = r.kit.lib;
    const spawns = r.parts.particles.spawnsByEffect;
    for (const def of VARKAN_EFFECTS) {
      if (def.continuous === true) continue;
      expect(spawns[lib.indexOf(def.id)], def.id).toBeGreaterThan(0);
    }
    // Continuous: smoke_damage, wreck_smolder, missile trail (tile + missile projectiles), build, reclaim.
    expect(r.parts.particles.stats.emitters).toBeGreaterThanOrEqual(5);
    expect(r.kit.streamCount).toBe(2);
    expect(r.parts.log.count[OP.beamTimed]).toBeGreaterThan(20);
    expect(r.sim.scene.labels!().length).toBeGreaterThanOrEqual(20);
  });
});
