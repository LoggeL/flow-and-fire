import { describe, expect, it } from 'vitest';
import { RENDER_PRESETS } from '@faf/render';
import type { RtsCamera, WebGL2Device } from '@faf/render';
import { FxRng } from '@faf/render-fx';
import type { FxFrameUniforms } from '@faf/render-fx';
import { FREEZE_CATCHUP_STEPS, FixedStepClock, MAX_STEPS_PER_FRAME } from '../../src/app/clock.ts';
import { LAB_STEP_S } from '../../src/app/context.ts';
import type { LabFx, LabParams, SceneName } from '../../src/app/context.ts';
import { labGroundHeight } from '../../src/app/ground.ts';
import { createNullLabFx } from '../../src/app/null-fx.ts';
import { parseLabParams } from '../../src/app/params.ts';
import { LabSimulation } from '../../src/app/sim.ts';
import type { LabWorld } from '../../src/app/sim.ts';
import { LabUnitList } from '../../src/app/units.ts';
import { DECALS, MOVING_PER_ARMY, createLightingScene } from '../../src/scenes/lighting.ts';
import { LAB_SCENES, createLabFx } from '../../src/scenes/index.ts';

describe('FixedStepClock', () => {
  it('turns frame intervals into 60 Hz steps via the accumulator', () => {
    const c = new FixedStepClock(null);
    expect(c.step).toBe(LAB_STEP_S);
    expect(c.advance(1 / 120)).toBe(0);
    expect(c.alpha).toBeCloseTo(0.5, 9);
    expect(c.advance(1 / 120)).toBe(1);
    for (let k = 0; k < 1; k++) c.tick();
    expect(c.advance(1 / 30)).toBe(2);
    c.tick();
    c.tick();
    expect(c.simTime).toBeCloseTo(3 / 60, 12);
    expect(c.renderTime).toBeGreaterThanOrEqual(c.simTime);
    expect(c.frozen).toBe(false);
    expect(c.catchingUp).toBe(false);
  });

  it('simulates at most 4 steps per frame and drops the rest', () => {
    const c = new FixedStepClock(null);
    expect(MAX_STEPS_PER_FRAME).toBe(4);
    expect(c.advance(0.2)).toBe(4);
    expect(c.droppedFrames).toBe(1);
    expect(c.acc).toBeLessThan(c.step);
    // Hidden tab: huge / invalid intervals are clamped.
    expect(c.advance(1e6)).toBe(4);
    expect(c.advance(Number.NaN)).toBeLessThanOrEqual(1);
    expect(c.advance(-5)).toBe(0);
  });

  it('long-run step count matches wall time for irregular frame intervals', () => {
    const c = new FixedStepClock(null);
    const rng = new FxRng(3);
    let wall = 0;
    let steps = 0;
    for (let f = 0; f < 5000; f++) {
      const dt = rng.range(1 / 240, 1 / 20);
      wall += dt;
      steps += c.advance(dt);
    }
    expect(Math.abs(steps - wall / LAB_STEP_S)).toBeLessThanOrEqual(1);
  });

  it('freeze: catches up in batches of 8 independent of the frame rate, then holds', () => {
    const c = new FixedStepClock(1.0);
    expect(c.catchingUp).toBe(true);
    let total = 0;
    let frames = 0;
    while (!c.frozen) {
      const n = c.advance(frames % 2 === 0 ? 0.001 : 0.5);
      expect(n).toBeLessThanOrEqual(FREEZE_CATCHUP_STEPS);
      for (let k = 0; k < n; k++) c.tick();
      total += n;
      frames++;
    }
    expect(total).toBe(60);
    expect(frames).toBe(Math.ceil(60 / FREEZE_CATCHUP_STEPS));
    expect(c.simTime).toBeCloseTo(1, 12);
    expect(c.alpha).toBe(1);
    for (let k = 0; k < 10; k++) expect(c.advance(1 / 60)).toBe(0);
    expect(c.renderTime).toBeCloseTo(1, 12);
    // Freeze times between steps round up; freeze=0 renders t = 0.
    const h = new FixedStepClock(0.51);
    let hs = 0;
    while (!h.frozen) {
      const n = h.advance(0);
      for (let k = 0; k < n; k++) h.tick();
      hs += n;
    }
    expect(hs).toBe(31);
    const z = new FixedStepClock(0);
    expect(z.frozen).toBe(true);
    expect(z.advance(1)).toBe(0);
    c.reset();
    expect(c.steps).toBe(0);
    expect(() => new FixedStepClock(null, 0)).toThrow(RangeError);
  });
});

/** Headless world: the lighting scene only touches units, scorch, shake and rng. */
function headlessWorld(params: LabParams): LabWorld {
  return {
    dev: null as unknown as WebGL2Device,
    camera: null as unknown as RtsCamera,
    frame: null as unknown as FxFrameUniforms,
    preset: RENDER_PRESETS[params.preset],
    params,
    units: new LabUnitList(null, labGroundHeight),
  };
}

const lightingOnly = (n: SceneName): boolean => n === 'lighting';

/** Runs the lighting scene with the given frame intervals until `frames` frames were fed. */
function runLighting(search: string, frameDt: (f: number) => number, frames: number): { sim: LabSimulation; checksums: number[] } {
  const params = parseLabParams(search, lightingOnly);
  const sim = new LabSimulation(headlessWorld(params), createLightingScene, createNullLabFx);
  const checksums: number[] = [];
  for (let f = 0; f < frames; f++) {
    sim.advance(frameDt(f));
    checksums.push(sim.checksum());
  }
  return { sim, checksums };
}

describe('LabSimulation (lighting scene)', () => {
  it('builds the scene: 40 movers, statics, 30 decals, no FX draws', () => {
    const { sim } = runLighting('?scene=lighting', () => 1 / 60, 1);
    const st = sim.scene.stats!();
    expect(st['moving']).toBe(2 * MOVING_PER_ARMY);
    expect(st['decals']).toBe(DECALS);
    expect(st['acus']).toBe(2);
    expect(sim.ctx.units.count).toBe(st['units']);
    expect(sim.ctx.scorch.count).toBe(DECALS);
    const fx: LabFx = sim.ctx.fx;
    expect(fx.stats()).toEqual({ particles: null, shields: null, beams: 0, trails: 0 });
  });

  it('freeze is deterministic: same seed/freeze → same checksum for any frame pacing', () => {
    const a = runLighting('?scene=lighting&freeze=5&seed=11', () => 1 / 60, 60);
    const b = runLighting('?scene=lighting&freeze=5&seed=11', (f) => (f % 3 === 0 ? 0.25 : 0.003), 60);
    expect(a.sim.clock.frozen).toBe(true);
    expect(a.sim.clock.steps).toBe(300);
    expect(b.sim.clock.steps).toBe(300);
    expect(a.checksums).toEqual(b.checksums);
    // Held: further frames change nothing.
    const held = a.sim.checksum();
    for (let k = 0; k < 20; k++) a.sim.advance(1 / 60);
    expect(a.sim.checksum()).toBe(held);
    // Another seed gives another state.
    const c = runLighting('?scene=lighting&freeze=5&seed=12', () => 1 / 60, 60);
    expect(c.checksums.at(-1)).not.toBe(held);
  });

  it('free-running: the state after N steps does not depend on the frame intervals', () => {
    const params = parseLabParams('?scene=lighting&seed=5', lightingOnly);
    const s1 = new LabSimulation(headlessWorld(params), createLightingScene, createNullLabFx);
    const s2 = new LabSimulation(headlessWorld(params), createLightingScene, createNullLabFx);
    const rng = new FxRng(9);
    const byStep1 = new Map<number, number>();
    const byStep2 = new Map<number, number>();
    for (let f = 0; f < 600; f++) {
      s1.advance(1 / 60);
      byStep1.set(s1.clock.steps, s1.checksum());
      s2.advance(rng.range(0.001, 0.07));
      byStep2.set(s2.clock.steps, s2.checksum());
    }
    let compared = 0;
    for (const [step, h] of byStep2) {
      const h1 = byStep1.get(step);
      if (h1 === undefined) continue;
      expect(h).toBe(h1);
      compared++;
    }
    expect(compared).toBeGreaterThan(50);
  });

  it('decals keep rotating (fresh embers) and the pool stays at 30', () => {
    const { sim } = runLighting('?scene=lighting&freeze=12', () => 1 / 60, 200);
    const st = sim.scene.stats!();
    expect(st['decals']).toBe(DECALS);
    expect(st['glowingDecals']).toBeGreaterThan(3);
    expect(sim.ctx.scorch.count).toBe(DECALS);
  });

  it('switchScene disposes the running scene and restarts at t = 0', () => {
    const { sim } = runLighting('?scene=lighting', () => 1 / 60, 30);
    const first = runLighting('?scene=lighting', () => 1 / 60, 1).checksums[0];
    sim.switchScene(createLightingScene);
    expect(sim.clock.steps).toBe(0);
    expect(sim.ctx.units.count).toBe(sim.scene.stats!()['units']);
    sim.advance(1 / 60);
    expect(sim.checksum()).toBe(first);
    expect(sim.trigger()).toBe(false);
    sim.destroy();
    expect(sim.ctx.units.count).toBe(0);
  });

  it('scene registry: lighting registered, FX-less createLabFx', () => {
    expect(LAB_SCENES.lighting).toBeTypeOf('function');
    const params = parseLabParams('?scene=lighting', lightingOnly);
    const sim = new LabSimulation(headlessWorld(params), createLightingScene, createLabFx);
    const fx = sim.ctx.fx;
    const enc = null as never;
    expect(fx.encodeShields(enc) + fx.encodeParticles(enc) + fx.encodeBeams(enc)).toBe(0);
  });
});
