// Shared fixtures of the particle tests: a small effect library, a device on the fake GL and a camera.
import { RtsCamera, createWebGL2Device } from '@faf/render';
import type { BufH } from '@faf/render';
import { compileEffectLibrary } from '../../src/effects/compile.ts';
import type { EffectLayerDef } from '../../src/effects/define.ts';
import { ParticleSystem } from '../../src/particles/index.ts';
import type { ParticleSystemOptions } from '../../src/particles/index.ts';
import { FakeCanvas } from '../support/fake-gl.ts';

const WHITE: EffectLayerDef['color'] = [
  [0, 1, 1, 1, 1],
  [1, 1, 1, 1, 0],
];

function layer(name: string, over: Partial<EffectLayerDef>): EffectLayerDef {
  return {
    name,
    shape: 'glow',
    orient: 'billboard',
    motion: 'ballistic',
    count: 10,
    lifetime: [1, 1],
    speed: [1, 2],
    spread: 45,
    gravity: 0,
    drag: 0,
    size: 1,
    color: WHITE,
    blend: 0,
    priority: 1,
    ...over,
  };
}

/** Effect indices of {@link testLibrary}. */
export const FX = { p0: 0, p1: 1, p2: 2, emit: 3, varied: 4, stream: 5, shake: 6, mixed: 7, long0: 8, long1: 9, short1: 10 } as const;

export function testLibrary() {
  return compileEffectLibrary([
    { id: 'test:p0', boundsWu: 4, layers: [layer('a', { count: 100, priority: 0 })] },
    { id: 'test:p1', boundsWu: 4, layers: [layer('a', { count: 100, priority: 1 })] },
    { id: 'test:p2', boundsWu: 4, layers: [layer('a', { count: 100, priority: 2 })] },
    {
      id: 'test:emit',
      boundsWu: 4,
      continuous: true,
      layers: [layer('a', { count: 0, rate: 100, lifetime: [2, 2], priority: 1 })],
    },
    {
      id: 'test:varied',
      boundsWu: 4,
      layers: [
        layer('short', { count: [20, 40], lifetime: [0.05, 0.6], priority: 1 }),
        layer('long', { count: [5, 15], lifetime: [0.5, 3], delay: [0, 0.8], priority: 1 }),
      ],
    },
    {
      id: 'test:stream',
      boundsWu: 8,
      continuous: true,
      layers: [layer('pour', { motion: 'stream', count: 0, rate: 60, lifetime: [0.5, 0.5], speed: [0, 0], spread: 0 })],
    },
    {
      id: 'test:shake',
      boundsWu: 20,
      shake: { amplitudeWu: 1, durationS: 1, radiusWu: 50, frequencyHz: 8 },
      layers: [layer('a', { count: 5, priority: 0 })],
    },
    {
      id: 'test:mixed',
      boundsWu: 4,
      layers: [layer('crit', { count: 10, priority: 0 }), layer('norm', { count: 10, priority: 1 }), layer('cosm', { count: 10, priority: 2 })],
    },
    { id: 'test:long0', boundsWu: 4, layers: [layer('a', { count: 1, lifetime: [30, 30], priority: 0 })] },
    { id: 'test:long1', boundsWu: 4, layers: [layer('a', { count: 100, lifetime: [30, 30], priority: 1 })] },
    { id: 'test:short1', boundsWu: 4, layers: [layer('a', { count: 50, lifetime: [0.2, 0.2], priority: 1 })] },
  ]);
}

export const COPY_WRITE_BUFFER = 0x8f37;
export const RAW = 4096;

/** A camera looking at (0, 0, 0) from 80 WU (default pitch), viewport 800×600. */
export function testCamera(): RtsCamera {
  const cam = new RtsCamera({ distance: 80 });
  cam.setViewport(800, 600);
  cam.setTargetWU(0, 0, 0);
  cam.update();
  return cam;
}

export function setup(opts: Partial<ParticleSystemOptions> & { loseContext?: boolean } = {}) {
  const canvas = new FakeCanvas({ loseContext: opts.loseContext ?? false });
  const dev = createWebGL2Device(canvas);
  const frame = dev.createBuffer({ usage: 'uniform', size: 256, dynamic: true });
  const fxView = dev.createBuffer({ usage: 'uniform', size: 64, dynamic: true });
  const lib = testLibrary();
  const ps = new ParticleSystem(dev, { frame: frame as BufH, fxView: fxView as BufH }, lib, {
    capacity: opts.capacity ?? 4096,
    cap: opts.cap ?? 4096,
    ...(opts.onShake !== undefined ? { onShake: opts.onShake } : {}),
  });
  const camera = testCamera();
  return { canvas, gl: canvas.gl, dev, ps, lib, camera };
}

/** Ring uploads recorded since the last resetCalls(): [dstOffset, byteLength]. */
export function ringWrites(gl: FakeCanvas['gl']): [number, number][] {
  return gl
    .named('bufferSubData')
    .filter((c) => c.args[0] === COPY_WRITE_BUFFER)
    .map((c) => [c.args[1] as number, c.args[4] as number]);
}

export function draws(gl: FakeCanvas['gl']): number[] {
  return gl.named('drawArraysInstanced').map((c) => c.args[3] as number);
}

/** Runs one frame (update + encode) and returns the draw count. */
export function frame(env: ReturnType<typeof setup>, t: number): number {
  env.ps.update(t, env.camera);
  const enc = env.dev.beginPass({ clearColor: [0, 0, 0, 1], clearDepth: 1 });
  const n = env.ps.encode(enc);
  enc.end();
  return n;
}
