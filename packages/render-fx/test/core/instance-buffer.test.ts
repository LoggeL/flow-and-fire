import { createWebGL2Device } from '@faf/render';
import { describe, expect, it } from 'vitest';
import { DynamicInstanceBuffer } from '../../src/index.ts';
import { FakeCanvas } from '../support/fake-gl.ts';
import type { FakeGlObject } from '../support/fake-gl.ts';

describe('DynamicInstanceBuffer', () => {
  it('uploads [0, count × stride) with a single writeBuffer', () => {
    const canvas = new FakeCanvas();
    const dev = createWebGL2Device(canvas);
    const ib = new DynamicInstanceBuffer(dev, { label: 'test', stride: 12, capacity: 8 });
    expect(ib.data.byteLength).toBe(96);
    for (let i = 0; i < 3; i++) {
      ib.i32[i * 3] = i * 4096;
      ib.f32[i * 3 + 1] = i + 0.5;
      ib.u16[i * 6 + 4] = 0x3c00 + i;
      ib.u8[i * 12 + 10] = 200 + i;
    }
    canvas.gl.resetCalls();
    expect(ib.upload(3)).toBe(36);
    const writes = canvas.gl.named('bufferSubData');
    expect(writes.length).toBe(1);
    const data = canvas.gl.state.bufferData.get(canvas.gl.state.lastBufferWrite!) as Uint8Array;
    expect([...data]).toEqual([...new Uint8Array(ib.data, 0, 36)]);
    canvas.gl.resetCalls();
    expect(ib.upload(0)).toBe(0);
    expect(canvas.gl.named('bufferSubData').length).toBe(0);
    expect(() => ib.upload(9)).toThrow(RangeError);
    expect(() => ib.upload(-1)).toThrow(RangeError);
    ib.destroy();
    expect(() => ib.upload(1)).toThrow();
  });

  it('restores the last uploaded range after a context loss', () => {
    const canvas = new FakeCanvas();
    const dev = createWebGL2Device(canvas);
    const ib = new DynamicInstanceBuffer(dev, { stride: 8, capacity: 4 });
    for (let i = 0; i < 8; i++) ib.f32[i] = i * 1.25;
    ib.upload(2);
    const uploads = ib.uploads;
    canvas.gl.lose();
    // The staging copy may change while lost; restore uploads the current staging range.
    ib.f32[0] = 99;
    canvas.gl.restore();
    expect(ib.uploads).toBe(uploads + 1);
    const buf = canvas.gl.state.lastBufferWrite as FakeGlObject;
    expect(buf.gen).toBe(canvas.gl.generation);
    const data = canvas.gl.state.bufferData.get(buf) as Uint8Array;
    expect([...new Float32Array(data.slice().buffer)]).toEqual([99, 1.25, 2.5, 3.75]);
    ib.destroy();
  });

  it('rejects invalid descriptors', () => {
    const dev = createWebGL2Device(new FakeCanvas());
    expect(() => new DynamicInstanceBuffer(dev, { stride: 0, capacity: 4 })).toThrow();
    expect(() => new DynamicInstanceBuffer(dev, { stride: 4, capacity: 0 })).toThrow();
    // Odd strides round the staging size up to a multiple of 4 (typed views need it).
    expect(new DynamicInstanceBuffer(dev, { stride: 6, capacity: 3 }).data.byteLength).toBe(20);
  });
});
