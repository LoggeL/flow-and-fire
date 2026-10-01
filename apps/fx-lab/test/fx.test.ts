import { describe, expect, it } from 'vitest';
import { RENDER_PRESETS, RtsCamera, createWebGL2Device } from '@faf/render';
import { CameraShake, FxFrameUniforms, FxRng, ScorchDecals } from '@faf/render-fx';
import { FakeCanvas } from '../../../packages/render-fx/test/support/fake-gl.ts';
import type { LabContext } from '../src/app/context.ts';
import { LabUnitList } from '../src/app/units.ts';
import { createLabFx } from '../src/scenes/fx.ts';
import { createNullLabFx } from '../src/app/null-fx.ts';
import { parseLabParams } from '../src/app/params.ts';
function setup(fx = true) {
  const canvas = new FakeCanvas();
  const dev = createWebGL2Device(canvas), camera = new RtsCamera();
  camera.setTargetWU(256, 0, 256); camera.distance = 150; camera.pitch = Math.PI / 3; camera.update();
  const frame = new FxFrameUniforms(dev);
  const ctx: LabContext = { dev, camera, frame, preset: RENDER_PRESETS.medium, params: parseLabParams(`?fx=${fx ? 1 : 0}`, () => true), units: new LabUnitList(null, () => 0), groundHeight: () => 0, rng: new FxRng(77), scorch: new ScorchDecals({ cap: 1024, mapSizeWu: 512 }), shake: new CameraShake(), fx: createNullLabFx() };
  ctx.fx = createLabFx(ctx);
  return { ctx, fx: ctx.fx as ReturnType<typeof createLabFx>, canvas, cleanup: () => { ctx.fx.destroy(); frame.destroy(); dev.destroy(); } };
}
describe('real lab wiring', () => {
  it('missile emits smoke, has interpolated trails, impacts ground and retires its trail', () => {
    const e = setup();
    try {
      e.fx.fireWeapon('missile', [250, 3, 256], [270, 0, 256], 0);
      for (let i = 1; i <= 30; i++) e.fx.update(e.ctx, i / 60, 1 / 60);
      const pass = e.ctx.dev.beginPass({ label: 'fx' }); e.fx.encodeParticles(pass); e.fx.encodeBeams(pass); pass.end();
      expect(e.fx.stats().trails).toBe(1); expect(e.fx.stats().particles!.alive).toBeGreaterThan(0);
      for (let i = 31; i <= 70; i++) e.fx.update(e.ctx, i / 60, 1 / 60);
      expect(e.ctx.scorch.count).toBe(1);
      const end = e.ctx.dev.beginPass({ label: 'fx' }); e.fx.encodeBeams(end); end.end(); expect(e.fx.stats().trails).toBe(0);
    } finally { e.cleanup(); }
  });
  it('ACU death makes an expiring smoldering wreck, persistent crater and camera shake', () => {
    const e = setup();
    try {
      const u = e.ctx.units.add({ kind: 'acu', army: 0, xWu: 256, zWu: 256, yaw: 0 });
      e.fx.killUnit(u, 'acu', 0); e.fx.update(e.ctx, 1 / 60, 1 / 60);
      expect(e.ctx.units.get(u)?.kind).toBe('wreck'); expect(e.ctx.scorch.count).toBe(1);
      expect(e.ctx.shake.activeCount).toBeGreaterThan(0); expect(e.fx.stats().particles!.alive).toBeGreaterThan(0);
      e.fx.update(e.ctx, 3.1, 1 / 60); expect(e.ctx.units.count).toBe(0); expect(e.ctx.scorch.count).toBe(1);
    } finally { e.cleanup(); }
  });
  it('fx=0 creates no particles, streams, shields or transparent draws', () => {
    const e = setup(false);
    try {
      e.fx.fireWeapon('artillery', [250, 3, 256], [270, 0, 256], 0);
      e.fx.stream('build', [250, 3, 256], [270, 0, 256]); e.fx.update(e.ctx, 0.5, 1 / 60);
      const pass = e.ctx.dev.beginPass({ label: 'fx' });
      expect(e.fx.encodeShields(pass) + e.fx.encodeParticles(pass) + e.fx.encodeBeams(pass)).toBe(0); pass.end();
      expect(e.fx.stats().particles!.alive).toBe(0);
    } finally { e.cleanup(); }
  });
});
