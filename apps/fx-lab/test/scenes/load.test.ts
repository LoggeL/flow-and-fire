/**
 * Particle load of the scenes with the REAL render-fx systems (ParticleSystem, BeamPass, TrailPass,
 * ShieldPass) on the fake WebGL2 context: alive counts, caps and drops are CPU-side bookkeeping of the
 * ParticleSystem, so they match the browser (same code, same camera preset, same fixed steps).
 */
import { describe, expect, it } from 'vitest';
import { RENDER_PRESETS, RtsCamera, createWebGL2Device } from '@faf/render';
import type { RenderPresetName } from '@faf/render';
import { FxFrameUniforms } from '@faf/render-fx';
import { LabCameraRig } from '../../src/app/camera-rig.ts';
import type { SceneName } from '../../src/app/context.ts';
import { labGroundHeight } from '../../src/app/ground.ts';
import { LAB_LIGHT, LAB_SUN } from '../../src/app/glsl.ts';
import { parseLabParams } from '../../src/app/params.ts';
import { LabSimulation } from '../../src/app/sim.ts';
import { LabUnitList } from '../../src/app/units.ts';
import { LabFxKit } from '../../src/scenes/fx.ts';
import { LAB_SCENES, createLabFx } from '../../src/scenes/index.ts';
// Shared with the render-fx unit tests (one fake, no copy; the deep-import rule only binds packages/).
import { FakeCanvas } from '../../../../packages/render-fx/test/support/fake-gl.ts';

interface LoadResult {
  mean: number;
  max: number;
  dropped: readonly [number, number, number];
  cap: number;
  shields: number;
  kit: LabFxKit;
}

/** Runs `seconds` of 60 Hz frames on the fake GL device; mean/max alive over [from, seconds]. */
function runLoad(name: SceneName, preset: RenderPresetName, seconds: number, from: number): LoadResult {
  const canvas = new FakeCanvas({ colorBufferFloat: true });
  const dev = createWebGL2Device(canvas as unknown as HTMLCanvasElement);
  const camera = new RtsCamera({ maxDistance: 900, minDistance: 8 });
  camera.setViewport(1280, 720);
  const frame = new FxFrameUniforms(dev);
  const params = parseLabParams(`?scene=${name}&preset=${preset}`, () => true);
  const sim = new LabSimulation({ dev, camera, frame, preset: RENDER_PRESETS[preset], params, units: new LabUnitList(dev, labGroundHeight) }, LAB_SCENES[name]!, createLabFx);
  const kit = sim.ctx.fx as LabFxKit;
  expect(kit).toBeInstanceOf(LabFxKit);
  const rig = new LabCameraRig(sim.scene.camera);
  let sum = 0;
  let n = 0;
  let max = 0;
  for (let f = 0; f < seconds * 60; f++) {
    sim.advance(1 / 60);
    const t = sim.clock.renderTime;
    rig.computeTarget(t, false, labGroundHeight);
    rig.apply(camera, t, false, null);
    frame.update(camera, { timeS: t, dtS: 1 / 60, alpha: 1, sunDir: LAB_SUN, sunColor: LAB_LIGHT.sunColor, skyColor: LAB_LIGHT.skyColor, groundColor: LAB_LIGHT.groundColor, fog: LAB_LIGHT.fog, viewport: [1280, 720] });
    const st = kit.stats().particles!;
    if (t >= from) {
      sum += st.alive;
      n++;
      max = Math.max(max, st.alive);
    }
    if (f % 600 === 0) canvas.gl.resetCalls();
  }
  const st = kit.stats();
  const res: LoadResult = { mean: sum / Math.max(1, n), max, dropped: [...st.particles!.dropped] as [number, number, number], cap: st.particles!.cap, shields: st.shields!.count, kit };
  sim.destroy();
  return res;
}

describe('particle load with the real systems (fake GL)', () => {
  it('battle, medium: ≥ 8000 live particles on average, nothing dropped', () => {
    const r = runLoad('battle', 'medium', 24, 6);
    expect(r.cap).toBe(16384);
    expect(r.mean).toBeGreaterThanOrEqual(8000);
    expect(r.max).toBeLessThanOrEqual(r.cap);
    expect(r.dropped).toEqual([0, 0, 0]);
  });

  it('battle, low: the cap takes effect (priority 2 dropped, alive ≤ 8192)', () => {
    const r = runLoad('battle', 'low', 16, 4);
    expect(r.cap).toBe(8192);
    expect(r.dropped[2]).toBeGreaterThan(0);
    expect(r.dropped[0]).toBe(0);
    expect(r.max).toBeLessThanOrEqual(8192);
  });

  it('shields: 20 shields in one ShieldPass; big: the ACU core layers (priority 0) are never dropped', () => {
    expect(runLoad('shields', 'medium', 3, 0).shields).toBe(20);
    const big = runLoad('big', 'low', 3, 0);
    expect(big.dropped[0]).toBe(0);
    expect(big.max).toBeGreaterThan(1000);
  });
});
