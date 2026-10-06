import { describe, expect, it } from 'vitest';
import {
  TRAIL_OFF_CUR,
  TRAIL_OFF_DIMS,
  TRAIL_OFF_HEAD,
  TRAIL_OFF_PREV,
  TRAIL_OFF_TAIL,
  TRAIL_STRIDE,
  TrailPass,
  VARKAN_TRAIL_STYLES,
  fromHalf,
  toHalf,
  trailEndpointsWu,
} from '../../src/index.ts';
import type { TrailStyle } from '../../src/index.ts';
import { packHalf } from '../../src/trails/pack.ts';
import { encodeOnce, fakeFx } from './support.ts';

const STYLE: TrailStyle = { lengthWu: 6, widthWu: 0.5, head: [5, 4, 3, 1], tail: [1.5, 0.5, 0.1, 0], blend: 0 };

describe('TrailPass', () => {
  it('packs prev/cur raw positions and f16 style', () => {
    const { dev, bindings } = fakeFx();
    const pass = new TrailPass(dev, bindings, { capacity: 4 });
    pass.begin();
    pass.add([100, 200, 300], [4196, 200, -300], STYLE, 0.5);
    const ib = pass.instances;
    expect(ib.stride).toBe(TRAIL_STRIDE);
    expect([...ib.i32.subarray(TRAIL_OFF_PREV >> 2, (TRAIL_OFF_PREV >> 2) + 3)]).toEqual([100, 200, 300]);
    expect([...ib.i32.subarray(TRAIL_OFF_CUR >> 2, (TRAIL_OFF_CUR >> 2) + 3)]).toEqual([4196, 200, -300]);
    const h = (b: number): number => fromHalf(ib.u16[b >> 1]!);
    expect([h(TRAIL_OFF_HEAD), h(TRAIL_OFF_HEAD + 2), h(TRAIL_OFF_HEAD + 4), h(TRAIL_OFF_HEAD + 6)]).toEqual([5, 4, 3, 1]);
    expect(h(TRAIL_OFF_TAIL)).toBe(1.5);
    expect(h(TRAIL_OFF_TAIL + 6)).toBe(0);
    expect(h(TRAIL_OFF_DIMS)).toBe(3); // length × lengthScale
    expect(h(TRAIL_OFF_DIMS + 2)).toBe(0.5);
    expect(h(TRAIL_OFF_DIMS + 4)).toBe(0);
    pass.destroy();
  });

  it('one draw per frame, immediate-mode reset, overflow counted as dropped', () => {
    const { canvas, dev, bindings } = fakeFx();
    const pass = new TrailPass(dev, bindings, { capacity: 100 });
    pass.begin();
    let accepted = 0;
    for (let i = 0; i < 130; i++) if (pass.add([i, 0, 0], [i + 4096, 0, 0], VARKAN_TRAIL_STYLES.tracer)) accepted++;
    expect(accepted).toBe(100);
    expect(pass.stats.dropped).toBe(30);
    const r = encodeOnce(canvas, dev, (enc) => pass.encode(enc));
    expect(r.draws).toBe(1);
    expect(r.glDraws.length).toBe(1);
    expect(r.glDraws[0]!.args[3]).toBe(100);
    expect(r.writes.length).toBe(1);
    expect(pass.stats.uploadBytes).toBe(100 * TRAIL_STRIDE);
    pass.begin();
    expect(pass.stats.dropped).toBe(0);
    expect(pass.stats.droppedTotal).toBe(30);
    pass.add([0, 0, 0], [1, 1, 1], STYLE);
    const r2 = encodeOnce(canvas, dev, (enc) => pass.encode(enc));
    expect(r2.glDraws[0]!.args[3]).toBe(1);
    pass.begin();
    expect(encodeOnce(canvas, dev, (enc) => pass.encode(enc)).draws).toBe(0);
    pass.destroy();
  });

  it('restores its instances after a context loss', () => {
    const { canvas, dev, bindings } = fakeFx();
    const pass = new TrailPass(dev, bindings, { capacity: 4 });
    pass.begin();
    pass.add([0, 0, 0], [4096, 0, 0], STYLE);
    encodeOnce(canvas, dev, (enc) => pass.encode(enc));
    const n = pass.instances.uploads;
    canvas.gl.lose();
    canvas.gl.restore();
    expect(pass.instances.uploads).toBe(n + 1);
    expect(encodeOnce(canvas, dev, (enc) => pass.encode(enc)).draws).toBe(1);
    pass.destroy();
  });
});

describe('trailEndpointsWu (JS mirror of the trail vertex shader)', () => {
  it('interpolates the head with alpha and places the tail along −dir', () => {
    const out = new Float64Array(6);
    const len = trailEndpointsWu([0, 0, 0], [8192, 0, 0], 0.25, 6, out);
    expect(len).toBe(6);
    expect([...out]).toEqual([0.5, 0, 0, -5.5, 0, 0]);
    trailEndpointsWu([4096, 4096, 4096], [4096, 4096 + 3 * 4096, 4096 + 4 * 4096], 1, 10, out);
    expect(out[0]).toBeCloseTo(1, 12);
    expect(out[1]).toBeCloseTo(4, 12);
    expect(out[2]).toBeCloseTo(5, 12);
    expect(out[3]).toBeCloseTo(1, 12);
    expect(out[4]).toBeCloseTo(4 - 6, 12);
    expect(out[5]).toBeCloseTo(5 - 8, 12);
  });

  it('a standing head (prev == cur) collapses without NaN', () => {
    const out = new Float64Array(6);
    for (const a of [0, 0.5, 1]) {
      const len = trailEndpointsWu([12345, -777, 99999], [12345, -777, 99999], a, 6, out);
      expect(len).toBe(0);
      for (const v of out) expect(Number.isFinite(v)).toBe(true);
      expect([out[3], out[4], out[5]]).toEqual([out[0], out[1], out[2]]);
    }
    // A sub-threshold move (1 raw unit ≈ 0.00024 WU → |d|² ≈ 6e-8 > 1e-10) still has a direction.
    const len = trailEndpointsWu([0, 0, 0], [1, 0, 0], 1, 6, out);
    expect(len).toBe(6);
    expect(out[3]).toBeCloseTo(1 / 4096 - 6, 9);
  });
});

describe('packHalf', () => {
  it('matches toHalf(Math.fround(v)) on edge cases and a deterministic sweep', () => {
    const cases = [0, -0, 1, -1, 0.5, 65504, 65520, 70000, -70000, 1e-8, 6e-8, 5.96e-8, 6.1e-5, 6.103515625e-5, 1 / 3, Infinity, -Infinity, 3.14159, 1e-5, 2049, 2051];
    for (const v of cases) expect(packHalf(v), `v = ${v}`).toBe(toHalf(Math.fround(v)));
    expect(packHalf(Number.NaN)).toBe(0x7e00);
    let x = 0x12345678;
    for (let i = 0; i < 20000; i++) {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      const v = ((x / 4294967296) * 2 - 1) * 2 ** ((x % 40) - 24);
      expect(packHalf(v)).toBe(toHalf(Math.fround(v)));
    }
  });
});
