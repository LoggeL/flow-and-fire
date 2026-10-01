import { describe, expect, it } from 'vitest';
import { RENDER_PRESETS } from '@faf/render';
import { CameraShake, FxRng, ScorchDecals, VARKAN_EFFECTS } from '@faf/render-fx';
import type { LabContext, LabScene } from '../src/app/context.ts';
import { LabUnitList } from '../src/app/units.ts';
import { LAB_SCENES } from '../src/scenes/index.ts';
import type { SceneFx } from '../src/scenes/fx.ts';

function run(name: keyof typeof LAB_SCENES, seed: number) {
  const units = new LabUnitList(null, () => 0);
  let hash = 2166136261, events = 0, hits = 0, bursts = 0;
  const log = (args: unknown[]) => { events++; for (const c of JSON.stringify(args)) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619); };
  const fx: SceneFx = {
    burst: (...a) => { bursts++; log(a); }, emitter: (...a) => { log(a); return events; },
    moveEmitter: (...a) => log(a), stopEmitter: (...a) => log(a),
    fireWeapon: (...a) => log(a), impact: (...a) => log(a),
    killUnit: (i, kind, t) => { log([i, kind, t, units.get(i)]); units.remove(i); },
    stream: (...a) => { log(a); return events; }, shield: (...a) => log(a), hitShield: (...a) => { hits++; log(a); },
    update: () => {}, encodeShields: () => 0, encodeParticles: () => 0, encodeBeams: () => 0,
    stats: () => ({ particles: null, shields: null, beams: 0, trails: 0 }), destroy: () => {},
  };
  const ctx = { units, rng: new FxRng(seed), scorch: new ScorchDecals({ cap: 1024, mapSizeWu: 512 }), shake: new CameraShake(), preset: RENDER_PRESETS.medium, fx, groundHeight: () => 0 } as unknown as LabContext;
  const scene: LabScene = LAB_SCENES[name]();
  scene.init(ctx);
  let firstExplosion = false;
  for (let step = 1; step <= 1200; step++) {
    units.snapshot(); scene.update(ctx, step / 60, 1 / 60);
    if (step === 60) firstExplosion = (scene.stats?.()['explosions'] ?? 0) === 1;
  }
  return { hash: hash >>> 0, checksum: units.checksum(), units: units.count, stats: scene.stats?.(), hits, bursts, firstExplosion, labels: scene.labels?.().length ?? 0 };
}

describe('fixed-step scenes', () => {
  for (const scene of ['battle', 'shields', 'big', 'gallery', 'lighting'] as const) {
    it(`${scene}: same seed repeats event log and unit checksum after 20 seconds`, () => {
      expect(run(scene, 77)).toEqual(run(scene, 77));
      const a = run(scene, 77), b = run(scene, 78);
      expect([a.hash, a.checksum]).not.toEqual([b.hash, b.checksum]);
    });
  }
  it('battle keeps 400 soldiers and emits more than 50 weapon/death events per second', () => {
    const r = run('battle', 1);
    expect(r.units).toBe(400); expect(r.stats?.['effects']).toBeGreaterThan(1000);
  });
  it('shields keeps twenty bubbles and more than five hits per second', () => {
    const r = run('shields', 1); expect(r.stats?.['shields']).toBe(20); expect(r.hits).toBeGreaterThan(100);
  });
  it('big fires in its first second and every eight seconds thereafter', () => {
    const r = run('big', 1); expect(r.firstExplosion).toBe(true); expect(r.stats?.['explosions']).toBe(3);
  });
  it('gallery labels every registered effect and periodically bursts', () => {
    const r = run('gallery', 1); expect(r.labels).toBe(VARKAN_EFFECTS.length); expect(r.bursts).toBeGreaterThan(0);
  });
});
