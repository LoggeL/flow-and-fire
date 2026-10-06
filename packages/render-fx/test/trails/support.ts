import { createWebGL2Device } from '@faf/render';
import type { BufH, GpuDevice } from '@faf/render';
import { FakeCanvas } from '../support/fake-gl.ts';
import type { FxBindings } from '../../src/index.ts';

/** Fake device + FxBindings (two uniform buffers) for pass tests. */
export function fakeFx(): { canvas: FakeCanvas; dev: GpuDevice; bindings: FxBindings } {
  const canvas = new FakeCanvas({ loseContext: true });
  const dev = createWebGL2Device(canvas);
  const frame: BufH = dev.createBuffer({ usage: 'uniform', size: 256, dynamic: true });
  const fxView: BufH = dev.createBuffer({ usage: 'uniform', size: 64, dynamic: true });
  return { canvas, dev, bindings: { frame, fxView } };
}

/** Encodes `fn` in one pass and returns its draw count and the GL draw calls issued. */
export function encodeOnce(canvas: FakeCanvas, dev: GpuDevice, fn: (enc: ReturnType<GpuDevice['beginPass']>) => number) {
  canvas.gl.resetCalls();
  const enc = dev.beginPass({ label: 'test' });
  const draws = fn(enc);
  enc.end();
  const glDraws = canvas.gl.calls.filter((c) => c.name === 'drawArraysInstanced' || c.name === 'drawElementsInstanced');
  return { draws, glDraws, writes: canvas.gl.named('bufferSubData') };
}
