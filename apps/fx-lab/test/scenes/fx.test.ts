import { describe, expect, it } from 'vitest';
import { VARKAN_SCORCH } from '@faf/render-fx';
import type { LabContext } from '../../src/app/context.ts';
import { LAB_STEP_S } from '../../src/app/context.ts';
import { createLabContext } from '../../src/app/sim.ts';
import { LAB_ACU_FX_SCALE, LAB_FX_SCALE, LabFxKit, TARGET_GROUND, TARGET_SHIELD, TARGET_UNIT, WRECK_SMOLDER_S, deathClassOf, labEffectLibrary, labFxKit, labShakeHook, muzzleLocal } from '../../src/scenes/fx.ts';
import { OP, createRecordingFxParts } from '../../src/scenes/fx-record.ts';
import type { RecordingFxParts } from '../../src/scenes/fx-record.ts';
import { headlessWorld } from './support/harness.ts';

interface Rig {
  ctx: LabContext;
  kit: LabFxKit;
  parts: RecordingFxParts;
  t: number;
  /** One fixed step: units.snapshot → (scene code) → kit.update. */
  step(scene?: (t: number) => void): void;
}

function rig(): Rig {
  const ctx = createLabContext(headlessWorld('?scene=battle'));
  const parts = createRecordingFxParts(labEffectLibrary(), labShakeHook(ctx));
  const kit = new LabFxKit(ctx, parts);
  ctx.fx = kit;
  const r: Rig = {
    ctx,
    kit,
    parts,
    t: 0,
    step(scene) {
      ctx.units.snapshot();
      r.t += LAB_STEP_S;
      scene?.(r.t);
      ctx.scorch.update(r.t);
      kit.update(ctx, r.t, LAB_STEP_S);
    },
  };
  return r;
}

const spawnsOf = (r: Rig, id: string): number => r.parts.particles.spawnsByEffect[r.kit.lib.indexOf(`varkan:${id}`)]!;

describe('LabFxKit basics', () => {
  it('labFxKit() returns the kit; per-step update is idempotent within a step', () => {
    const r = rig();
    expect(labFxKit(r.ctx)).toBe(r.kit);
    r.kit.step(0.5);
    r.kit.step(0.5);
    expect(r.parts.log.count[OP.update]).toBe(1);
    r.kit.step(0.6);
    expect(r.parts.log.count[OP.update]).toBe(2);
  });

  it('muzzle and death class tables', () => {
    expect(muzzleLocal('tank')).toEqual([3.2, 1.28 + 0.14, 0]);
    expect(deathClassOf('tank')).toBe('small');
    expect(deathClassOf('arty')).toBe('medium');
    expect(deathClassOf('structure')).toBe('structure');
    expect(deathClassOf('acu')).toBe('acu');
  });

  it('stats() reuses one object and mirrors the parts', () => {
    const r = rig();
    const a = r.kit.stats();
    r.kit.setShield(3, 100, 10, 100, 8, [0.3, 0.6, 1.2], 1, 1);
    const b = r.kit.stats();
    expect(b).toBe(a);
    expect(b.particles).not.toBeNull();
    expect(b.particles!.cap).toBe(16384);
    expect(b.shields!.count).toBe(1);
  });
});

describe('projectiles', () => {
  it('artillery: muzzle, arc with prev/cur per step, trail per step, impact + scorch at the end', () => {
    const r = rig();
    const u = r.ctx.units.add({ kind: 'arty', army: 0, xWu: 100, zWu: 100, yaw: 0 });
    let slot = -1;
    r.step((t) => {
      slot = r.kit.fireWeapon(t, u, 'artillery', 160, r.ctx.groundHeight(160, 100), 100, TARGET_GROUND, -1, 0.2);
    });
    expect(slot).toBe(0);
    expect(spawnsOf(r, 'muzzle_artillery')).toBe(1);
    expect(r.kit.projectileCount).toBe(1);
    const cur = new Float64Array(3);
    const prev = new Float64Array(3);
    const muzzle = r.kit.muzzleOf(u, new Float64Array(3));
    let maxY = 0;
    let lastCur = [muzzle[0]!, muzzle[1]!, muzzle[2]!];
    let steps = 0;
    const impacts: number[] = [];
    r.kit.onImpact = (_t, kind, id, dmg, hit, x) => impacts.push(kind, id, dmg, hit ? 1 : 0, x);
    const decals0 = r.ctx.scorch.count;
    while (r.kit.projectileCount > 0 && steps < 600) {
      const trails0 = r.parts.log.count[OP.trailAdd]!;
      r.step();
      steps++;
      if (r.kit.projectileCount === 0) break;
      r.kit.projectilePos(0, cur);
      r.kit.projectilePrev(0, prev);
      expect([...prev]).toEqual(lastCur);
      expect(r.parts.log.count[OP.trailAdd]).toBe(trails0 + 1);
      lastCur = [cur[0]!, cur[1]!, cur[2]!];
      maxY = Math.max(maxY, cur[1]!);
    }
    // Flight time 1.4..5.5 s, apex ≈ 0.32·60 + 5 WU above the line.
    expect(steps / 60).toBeGreaterThan(1.3);
    expect(steps / 60).toBeLessThan(5.6);
    expect(maxY - muzzle[1]!).toBeGreaterThan(15);
    expect(spawnsOf(r, 'impact_ground_large')).toBe(1);
    expect(r.ctx.scorch.count).toBe(decals0 + 1);
    expect(impacts.slice(0, 4)).toEqual([TARGET_GROUND, -1, 0.2, 0]);
    expect(impacts[4]).toBeCloseTo(160, 6);
  });

  it('missile: smoke trail emitter follows the missile and is destroyed on impact', () => {
    const r = rig();
    const u = r.ctx.units.add({ kind: 'bot', army: 1, xWu: 200, zWu: 200, yaw: 0 });
    r.step((t) => {
      r.kit.fireWeapon(t, u, 'missile', 225, r.ctx.groundHeight(225, 200) + 1, 200);
    });
    expect(spawnsOf(r, 'muzzle_missile')).toBe(1);
    expect(r.parts.log.count[OP.createEmitter]).toBe(1);
    expect(r.parts.particles.stats.emitters).toBe(1);
    const moves0 = r.parts.log.count[OP.moveEmitter]!;
    for (let k = 0; k < 10; k++) r.step();
    expect(r.parts.log.count[OP.moveEmitter]! - moves0).toBe(10);
    for (let k = 0; k < 300 && r.kit.projectileCount > 0; k++) r.step();
    expect(r.kit.projectileCount).toBe(0);
    expect(r.parts.particles.stats.emitters).toBe(0);
    expect(spawnsOf(r, 'impact_ground_large')).toBe(1);
  });

  it('unit targets are homed at: hit → impact_metal + onImpact(hit); dead target → ground impact', () => {
    const r = rig();
    const shooter = r.ctx.units.add({ kind: 'tank', army: 0, xWu: 100, zWu: 300, yaw: 0 });
    const target = r.ctx.units.add({ kind: 'tank', army: 1, xWu: 118, zWu: 300, yaw: Math.PI });
    const hits: boolean[] = [];
    r.kit.onImpact = (_t, kind, id, _d, hit) => {
      expect(kind).toBe(TARGET_UNIT);
      expect(id).toBe(target);
      hits.push(hit);
    };
    r.step((t) => r.kit.fireWeapon(t, shooter, 'cannon', 118, 10, 300, TARGET_UNIT, target, 0.1));
    // The target drives away; the shell follows it.
    for (let k = 0; k < 120 && r.kit.projectileCount > 0; k++) r.step(() => r.ctx.units.move(target, r.ctx.units.xWu(target), r.ctx.units.zWu(target) + 0.2, Math.PI));
    expect(hits).toEqual([true]);
    expect(spawnsOf(r, 'impact_metal')).toBe(1);
    // Second shot: the target dies in flight → the shell falls on the ground.
    r.step((t) => r.kit.fireWeapon(t, shooter, 'cannon', 118, 10, 300, TARGET_UNIT, target, 0.1));
    r.step((t) => r.kit.killUnit(t, target));
    for (let k = 0; k < 120 && r.kit.projectileCount > 0; k++) r.step();
    expect(hits).toEqual([true, false]);
    expect(spawnsOf(r, 'impact_metal')).toBe(1);
    expect(spawnsOf(r, 'impact_ground_small')).toBe(1);
  });
});

describe('killUnit', () => {
  it('small unit: explosion_small, wreck in place, scorch, smoulder emitter for WRECK_SMOLDER_S', () => {
    const r = rig();
    const i = r.ctx.units.add({ kind: 'tank', army: 0, xWu: 250, zWu: 250, yaw: 0 });
    r.kit.setDamaged(0, i, true);
    expect(r.kit.isDamaged(i)).toBe(true);
    let w = -2;
    r.step((t) => {
      w = r.kit.killUnit(t, i);
    });
    expect(w).toBe(i);
    expect(r.ctx.units.kindOf(i)).toBe('wreck');
    expect(r.kit.isDamaged(i)).toBe(false);
    expect(spawnsOf(r, 'explosion_small')).toBe(1);
    expect(r.ctx.scorch.count).toBe(1);
    expect(r.kit.counters.kills).toBe(1);
    expect(r.parts.particles.stats.emitters).toBe(1);
    const steps = Math.round(WRECK_SMOLDER_S * 60);
    for (let k = 0; k < steps - 2; k++) r.step();
    expect(r.parts.particles.stats.emitters).toBe(1);
    for (let k = 0; k < 4; k++) r.step();
    expect(r.parts.particles.stats.emitters).toBe(0);
    r.kit.removeWreck(i);
    expect(r.ctx.units.has(i)).toBe(false);
  });

  it('ACU: acu_explosion + acu_aftermath, permanent crater, camera shake, unit removed', () => {
    const r = rig();
    const i = r.ctx.units.add({ kind: 'acu', army: 1, xWu: 256, zWu: 256, yaw: 0 });
    let w = 0;
    r.step((t) => {
      w = r.kit.killUnit(t, i);
    });
    expect(w).toBe(-1);
    expect(r.ctx.units.has(i)).toBe(false);
    expect(spawnsOf(r, 'acu_explosion')).toBe(1);
    expect(spawnsOf(r, 'acu_aftermath')).toBe(1);
    expect(r.ctx.shake.activeCount).toBe(1);
    expect(r.ctx.shake.sample(r.t + 0.2, [256, 8, 256]).active).toBe(true);
    expect(r.kit.lastDecal).toBeGreaterThanOrEqual(0);
    for (let k = 0; k < 600; k++) r.step();
    expect(r.ctx.scorch.count).toBe(1);
    expect(VARKAN_SCORCH.acu.lifetimeS).toBe(0);
    expect(LAB_ACU_FX_SCALE).toBeLessThan(LAB_FX_SCALE);
  });

  it('structure: explosion_large + smoke_puff + crater, removed', () => {
    const r = rig();
    const i = r.ctx.units.add({ kind: 'structure', army: 0, xWu: 300, zWu: 200, yaw: 0 });
    r.step((t) => r.kit.killUnit(t, i));
    expect(r.ctx.units.has(i)).toBe(false);
    expect(spawnsOf(r, 'explosion_large')).toBe(1);
    expect(spawnsOf(r, 'smoke_puff')).toBe(1);
    expect(r.kit.killUnit(r.t, i)).toBe(-1);
  });
});

describe('streams and shields', () => {
  it('build/reclaim streams: emitter + one BeamPass core per step, follow the engineer, stop', () => {
    const r = rig();
    const eng = r.ctx.units.add({ kind: 'engineer', army: 0, xWu: 150, zWu: 150, yaw: 0 });
    const wreck = r.ctx.units.add({ kind: 'wreck', army: 1, xWu: 160, zWu: 150, yaw: 0 });
    let hb = -1;
    let hr = -1;
    r.step((t) => {
      hb = r.kit.buildStream(t, eng, 140, 14, 150);
      hr = r.kit.reclaimStream(t, eng, wreck);
    });
    expect(hb).toBeGreaterThanOrEqual(0);
    expect(hr).toBeGreaterThanOrEqual(0);
    expect(r.kit.streamCount).toBe(2);
    expect(spawnsOf(r, 'build_stream')).toBe(0);
    expect(r.parts.particles.stats.emitters).toBe(2);
    const beams0 = r.parts.log.count[OP.beamAdd]!;
    for (let k = 0; k < 5; k++) r.step(() => r.ctx.units.move(eng, r.ctx.units.xWu(eng) + 0.1, 150, 0));
    expect(r.parts.log.count[OP.beamAdd]! - beams0).toBe(10);
    r.kit.stopStream(hb);
    r.kit.stopStream(hb);
    expect(r.kit.streamCount).toBe(1);
    // Engineer gone → its stream stops by itself.
    r.ctx.units.remove(eng);
    r.step();
    expect(r.kit.streamCount).toBe(0);
    expect(r.parts.particles.stats.emitters).toBe(0);
  });

  it('shield hits: ripple + impact_shield while powered; a collapsed shield lets shells through', () => {
    const r = rig();
    const gy = r.ctx.groundHeight(256, 256);
    r.kit.setShield(5, 256, gy + 1, 256, 12, [0.3, 0.6, 1.2], 1, 1);
    const arty = r.ctx.units.add({ kind: 'arty', army: 1, xWu: 150, zWu: 256, yaw: 0 });
    const hits: boolean[] = [];
    r.kit.onImpact = (_t, kind, id, _d, hit) => {
      expect(kind).toBe(TARGET_SHIELD);
      expect(id).toBe(5);
      hits.push(hit);
    };
    r.step((t) => r.kit.fireWeapon(t, arty, 'artillery', 256 - 12, gy + 1, 256, TARGET_SHIELD, 5, 0.05));
    for (let k = 0; k < 400 && r.kit.projectileCount > 0; k++) r.step();
    expect(hits).toEqual([true]);
    expect(r.parts.shields.stats.hits).toBe(1);
    expect(spawnsOf(r, 'impact_shield')).toBe(1);
    r.kit.setShield(5, 256, gy + 1, 256, 12, [0.3, 0.6, 1.2], 0, 0);
    expect(r.kit.shieldUp(5)).toBe(false);
    r.step((t) => r.kit.fireWeapon(t, arty, 'artillery', 256 - 12, gy + 1, 256, TARGET_SHIELD, 5, 0.05));
    for (let k = 0; k < 400 && r.kit.projectileCount > 0; k++) r.step();
    expect(hits).toEqual([true, false]);
    expect(r.parts.shields.stats.hits).toBe(1);
    expect(spawnsOf(r, 'impact_ground_large')).toBe(1);
    r.kit.removeShield(5);
    expect(r.parts.shields.stats.shields).toBe(0);
  });
});
