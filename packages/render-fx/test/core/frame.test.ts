import { FRAME_LAYOUT, RtsCamera, createRenderer, createWebGL2Device } from '@faf/render';
import { describe, expect, it } from 'vitest';
import { FX_TIME_WRAP_S, FX_VIEW_LAYOUT, FxFrameUniforms, wrapFxTime } from '../../src/index.ts';
import { FakeCanvas } from '../support/fake-gl.ts';
import type { FakeGlObject } from '../support/fake-gl.ts';

function makeCamera(): RtsCamera {
  const cam = new RtsCamera({ distance: 140, pitch: 0.9, yaw: -1.1 });
  cam.setTargetWU(256.3, 2.75, 255.9);
  cam.setViewport(800, 600);
  cam.update();
  return cam;
}

/** Last bufferSubData payload of exactly `size` bytes (the frame block). */
function lastWriteOfSize(canvas: FakeCanvas, size: number): Uint8Array {
  const calls = canvas.gl.named('bufferSubData').filter((c) => (c.args[2] as ArrayBufferView).byteLength === size);
  expect(calls.length).toBeGreaterThan(0);
  const src = calls[calls.length - 1]!.args[2] as ArrayBufferView;
  return new Uint8Array(src.buffer, src.byteOffset, src.byteLength).slice();
}

describe('FxFrameUniforms', () => {
  it('writes the Frame block byte-identical to the render renderer', () => {
    const rc = new FakeCanvas();
    const renderer = createRenderer(rc, { pixelRatio: 1 });
    const camR = makeCamera();
    const timeMs = 123_456.789;
    renderer.render({ camera: camR, units: { bytes: new Uint8Array(0), count: 0 }, alpha: 0.4, timeMs });
    expect(rc.width).toBe(800);
    const rendererBytes = lastWriteOfSize(rc, FRAME_LAYOUT.size);
    renderer.dispose();

    const fc = new FakeCanvas();
    const dev = createWebGL2Device(fc);
    const fx = new FxFrameUniforms(dev);
    const camF = makeCamera();
    fx.update(camF, { timeS: timeMs / 1000, dtS: 1 / 60, alpha: 0.4, viewport: [rc.width, rc.height] });
    expect([...fx.frameData.bytes]).toEqual([...rendererBytes]);
    // …and uploaded exactly those bytes into its own frame buffer.
    expect([...lastWriteOfSize(fc, FRAME_LAYOUT.size)]).toEqual([...rendererBytes]);
    fx.destroy();
    dev.destroy();
  });

  it('writes orthonormal camera axes, wrapped time and the pixel scale', () => {
    const dev = createWebGL2Device(new FakeCanvas());
    const fx = new FxFrameUniforms(dev);
    const cam = makeCamera();
    fx.update(cam, { timeS: 3 * FX_TIME_WRAP_S + 12.25, dtS: 0.02, viewport: [800, 600] });
    const f = fx.viewData.f32;
    const at = (name: string): number[] => {
      const o = FX_VIEW_LAYOUT.offsetOf(name) >> 2;
      return [f[o]!, f[o + 1]!, f[o + 2]!, f[o + 3]!];
    };
    const r = at('fxRight');
    const u = at('fxUp');
    const w = at('fxFwd');
    const dot = (a: number[], b: number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
    for (const v of [r, u, w]) expect(dot(v, v)).toBeCloseTo(1, 5);
    expect(dot(r, u)).toBeCloseTo(0, 5);
    expect(dot(r, w)).toBeCloseTo(0, 5);
    expect(dot(u, w)).toBeCloseTo(0, 5);
    // Forward equals the camera's view direction; right is horizontal; right × up = −forward.
    for (let i = 0; i < 3; i++) expect(w[i]!).toBeCloseTo(cam.forward[i]!, 5);
    expect(r[1]!).toBeCloseTo(0, 6);
    expect(u[1]!).toBeGreaterThan(0);
    const cross = [r[1]! * u[2]! - r[2]! * u[1]!, r[2]! * u[0]! - r[0]! * u[2]!, r[0]! * u[1]! - r[1]! * u[0]!];
    for (let i = 0; i < 3; i++) expect(cross[i]!).toBeCloseTo(-w[i]!, 5);

    const t = at('fxTime');
    expect(t[0]).toBeCloseTo(12.25, 6);
    expect(t[1]).toBeCloseTo(0.02, 7);
    expect(t[3]).toBeCloseTo(cam.distance, 4);
    // Pixel scale: a 1-WU offset along `right` at view depth d spans z / d pixels.
    const ppw = t[2]!;
    expect(ppw).toBeCloseTo(300 / Math.tan(cam.fovY / 2), 3);
    const d = cam.distance;
    const center = new Float64Array(4);
    const side = new Float64Array(4);
    const tx = cam.targetX;
    const ty = cam.targetY;
    const tz = cam.targetZ;
    cam.project(tx, ty, tz, center);
    cam.project(tx + r[0]! * 4096, ty + r[1]! * 4096, tz + r[2]! * 4096, side);
    expect(Math.hypot(side[0]! - center[0]!, side[1]! - center[1]!)).toBeCloseTo(ppw / d, 2);
    fx.destroy();
  });

  it('wraps FX time into [0, 4096)', () => {
    expect(wrapFxTime(0)).toBe(0);
    expect(wrapFxTime(4096)).toBe(0);
    expect(wrapFxTime(4097.5)).toBe(1.5);
    expect(wrapFxTime(-1)).toBe(4095);
    expect(wrapFxTime(10 * 3600 + 0.25)).toBeCloseTo((36000.25) % 4096, 9);
  });

  it('with an external frame buffer only writes the FxView block', () => {
    const canvas = new FakeCanvas();
    const dev = createWebGL2Device(canvas);
    const external = dev.createBuffer({ usage: 'uniform', size: FRAME_LAYOUT.size, dynamic: true });
    const fx = new FxFrameUniforms(dev, { frameUbo: external });
    expect(fx.bindings.frame).toBe(external);
    canvas.gl.resetCalls();
    fx.update(makeCamera(), { timeS: 1, dtS: 0.016, viewport: [800, 600] });
    const sizes = canvas.gl.named('bufferSubData').map((c) => (c.args[2] as ArrayBufferView).byteLength);
    expect(sizes).toEqual([FX_VIEW_LAYOUT.size]);
    fx.destroy();
    // The external buffer is not destroyed by FxFrameUniforms.
    expect(canvas.gl.named('deleteBuffer').length).toBe(1);
  });

  it('re-uploads both blocks after a context loss', () => {
    const canvas = new FakeCanvas();
    const dev = createWebGL2Device(canvas);
    const fx = new FxFrameUniforms(dev);
    fx.update(makeCamera(), { timeS: 7, dtS: 0.016, viewport: [800, 600] });
    canvas.gl.lose();
    canvas.gl.restore();
    const writes = canvas.gl.named('bufferSubData');
    const gen = canvas.gl.generation;
    const restored = writes.filter((c) => {
      const bound = canvas.gl.calls.slice(0, canvas.gl.calls.indexOf(c)).reverse().find((k) => k.name === 'bindBuffer');
      return (bound?.args[1] as FakeGlObject | null)?.gen === gen;
    });
    expect(restored.map((c) => (c.args[2] as ArrayBufferView).byteLength).sort((a, b) => a - b)).toEqual(
      [FX_VIEW_LAYOUT.size, FRAME_LAYOUT.size].sort((a, b) => a - b),
    );
    fx.destroy();
  });
});
