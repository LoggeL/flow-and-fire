/** A moving GPU particle must land at the closed-form reference position, including after restore. */
import { ParticleSystem, compileEffectLibrary, createMirrorState, mirrorParticle, readRecord, wuToRaw } from '../../src/index.ts';
import type { SmokeCase } from '../case.ts';

const library = compileEffectLibrary([{
  id: 'smoke:position', boundsWu: 20, layers: [{
    name: 'marker', shape: 'glow', orient: 'billboard', motion: 'ballistic', count: 1,
    lifetime: [10, 10], speed: [8, 8], spread: 0, gravity: -2, drag: 0.2,
    size: 4, color: [[0, 1, 1, 1, 1], [1, 1, 1, 1, 1]], blend: 0, priority: 0,
  }],
}]);
let particles: ParticleSystem;
let time = 0;
const reference = createMirrorState();

export const smokeCase: SmokeCase = {
  name: 'particles', frames: 40,
  setup(ctx) {
    ctx.camera.setTargetWU(256, 10, 256);
    ctx.camera.distance = 65;
    ctx.camera.update();
    particles = new ParticleSystem(ctx.dev, ctx.frame.bindings, library, { cap: 8192 });
    particles.spawn(0, [wuToRaw(256), wuToRaw(12), wuToRaw(256)], { seed: 77, dir: [1, 0, 0] });
  },
  frame(ctx, t) {
    time = t;
    particles.update(t, ctx.camera);
    const pass = ctx.dev.beginPass({ clearColor: [0, 0, 0, 1], clearDepth: 1 });
    const draws = particles.encode(pass);
    pass.end();
    return draws;
  },
  check(ctx) {
    const errors: string[] = [];
    mirrorParticle(library.layers, library.lut, readRecord(particles.records, 0), time, reference);
    const [expectedX, expectedY] = ctx.project(...reference.posWu);
    const pixels = ctx.readPixels(0, 0, ctx.width, ctx.height);
    let sum = 0, xSum = 0, ySum = 0;
    for (let y = 0; y < ctx.height; y++) for (let x = 0; x < ctx.width; x++) {
      const weight = pixels[(y * ctx.width + x) * 4]!;
      sum += weight; xSum += (x + 0.5) * weight; ySum += (y + 0.5) * weight;
    }
    if (sum < 1000) errors.push(`particle is not visible: summed luma ${sum}`);
    else if (Math.abs(xSum / sum - expectedX) > 2 || Math.abs(ySum / sum - expectedY) > 2) {
      errors.push(`particle centre (${(xSum / sum).toFixed(2)}, ${(ySum / sum).toFixed(2)}) differs from reference (${expectedX.toFixed(2)}, ${expectedY.toFixed(2)}) by more than 2 pixels`);
    }
    if (particles.stats.alive !== 1 || particles.stats.draws !== 1) errors.push('expected one live particle and one draw');
    return errors;
  },
  destroy() { particles.destroy(); },
};
