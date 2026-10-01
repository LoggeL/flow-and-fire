// Allocation probe for ParticleSystem.update()/encode()/spawn(), run by alloc.test.ts in a plain Node
// process (`node --expose-gc --import tsx`): inside the vitest worker the harness itself allocates
// in hot loops. Uses a no-op GpuDevice (the recording fake GL allocates per call). Prints the best
// heap growth in bytes over warm rounds as JSON.
import { RtsCamera } from '@faf/render';
import type { GpuDevice, PassEncoder } from '@faf/render';
import { compileEffectLibrary } from '../../src/effects/compile.ts';
import { VARKAN_EFFECTS } from '../../src/effects/varkan.ts';
import { ParticleSystem } from '../../src/particles/system.ts';

const gc = (globalThis as { gc?: () => void }).gc;
if (gc === undefined) throw new Error('run with --expose-gc');

let handle = 1;
const noop = (): void => {};
const encoder: PassEncoder = {
  setPipeline: noop,
  setBindGroup: noop,
  setVertexStreams: noop,
  setIndexBuffer: noop,
  drawIndexedInstanced: noop,
  drawInstanced: noop,
  multiDrawIndexedInstanced: undefined,
  end: noop,
};
const dev = {
  createBuffer: () => handle++,
  writeBuffer: noop,
  destroyBuffer: noop,
  createTexture: () => handle++,
  writeTexture: noop,
  destroyTexture: noop,
  createPipeline: () => handle++,
  destroyPipeline: noop,
  createBindGroup: () => handle++,
  destroyBindGroup: noop,
  beginPass: () => encoder,
} as unknown as GpuDevice;

const lib = compileEffectLibrary(VARKAN_EFFECTS);
const ps = new ParticleSystem(dev, { frame: 1 as never, fxView: 2 as never }, lib, { cap: 16384 });
const cam = new RtsCamera({ distance: 120 });
cam.setViewport(1280, 720);
cam.setTargetWU(256, 0, 256);
cam.update();

const small = lib.indexOf('varkan:explosion_small');
const muzzle = lib.indexOf('varkan:muzzle_cannon');
const pos = [256 * 4096, 4096, 250 * 4096];
const opts = { dir: [0, 0.5, -0.8], scale: 1.2, tint: 0xffe0c0 };
for (let i = 0; i < 40; i++) {
  ps.createEmitter(lib.indexOf('varkan:smoke_damage'), [(240 + i) * 4096, 4096, 256 * 4096]);
  ps.createEmitter(lib.indexOf('varkan:build_stream'), [(240 + i) * 4096, 4096, 270 * 4096], {
    targetRaw: [(244 + i) * 4096, 0, 262 * 4096],
  });
}

// Boxed frame times (see the shake probe: the caller must not box doubles per call).
const boxed: unknown[] = ['generic'];
for (let i = 0; i < 20000; i++) boxed.push(10 + i / 60);
boxed.shift();
const times = boxed as number[];
let f = 0;
function run(frames: number): void {
  for (let i = 0; i < frames; i++) {
    const t = times[f++ % 20000]!;
    ps.spawn(small, pos, opts);
    ps.spawn(muzzle, pos, opts);
    ps.update(t, cam);
    ps.encode(encoder);
  }
}
run(3000);
let best = Infinity;
for (let round = 0; round < 3; round++) {
  gc();
  const h0 = process.memoryUsage().heapUsed;
  run(3000);
  best = Math.min(best, process.memoryUsage().heapUsed - h0);
}
process.stdout.write(JSON.stringify({ growth: best, alive: ps.stats.alive, spawned: ps.stats.requested }));
