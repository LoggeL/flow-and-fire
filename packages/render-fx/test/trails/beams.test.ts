import { describe, expect, it } from 'vitest';
import {
  BEAM_OFF_CORE,
  BEAM_OFF_FROM,
  BEAM_OFF_GLOW,
  BEAM_OFF_MISC,
  BEAM_OFF_PARAMS,
  BEAM_OFF_TO,
  BEAM_STRIDE,
  BeamPass,
  VARKAN_BEAM_STYLES,
  beamProfile,
  fromHalf,
  timedBeamFade,
} from '../../src/index.ts';
import type { BeamStyle } from '../../src/index.ts';
import { encodeOnce, fakeFx } from './support.ts';

const STYLE: BeamStyle = { widthWu: 1.5, core: [4, 3.5, 2.5], glow: [1.2, 0.5, 0.1], alpha: 0.75, scrollSpeed: 12, noise: 0.4, taper: [0.5, 2] };

function half(ib: BeamPass['instances'], byte: number): number {
  return fromHalf(ib.u16[byte >> 1]!);
}

describe('BeamPass', () => {
  it('packs the instance record (offsets, stride, i32 positions, f16 style)', () => {
    const { dev, bindings } = fakeFx();
    const pass = new BeamPass(dev, bindings, { capacity: 8 });
    pass.begin();
    expect(pass.add([4096, 8192, -12288], [40960, 8192, 81920], STYLE)).toBe(true);
    expect(pass.add([1, 2, 3], [4, 5, 6], VARKAN_BEAM_STYLES.laser)).toBe(true);
    const ib = pass.instances;
    expect(ib.stride).toBe(BEAM_STRIDE);
    expect(BEAM_STRIDE % 4).toBe(0);
    const o = 0;
    expect([...ib.i32.subarray((o + BEAM_OFF_FROM) >> 2, ((o + BEAM_OFF_FROM) >> 2) + 3)]).toEqual([4096, 8192, -12288]);
    expect([...ib.i32.subarray((o + BEAM_OFF_TO) >> 2, ((o + BEAM_OFF_TO) >> 2) + 3)]).toEqual([40960, 8192, 81920]);
    expect(half(ib, o + BEAM_OFF_CORE)).toBe(4);
    expect(half(ib, o + BEAM_OFF_CORE + 2)).toBe(3.5);
    expect(half(ib, o + BEAM_OFF_CORE + 4)).toBe(2.5);
    expect(half(ib, o + BEAM_OFF_CORE + 6)).toBe(1.5);
    expect(half(ib, o + BEAM_OFF_GLOW)).toBeCloseTo(1.2, 3);
    expect(half(ib, o + BEAM_OFF_GLOW + 6)).toBe(0.75);
    expect(half(ib, o + BEAM_OFF_PARAMS)).toBe(12);
    expect(half(ib, o + BEAM_OFF_PARAMS + 2)).toBeCloseTo(0.4, 3);
    expect(half(ib, o + BEAM_OFF_PARAMS + 4)).toBe(0.5);
    expect(half(ib, o + BEAM_OFF_PARAMS + 6)).toBe(2);
    const phase = half(ib, o + BEAM_OFF_MISC);
    expect(phase).toBeGreaterThanOrEqual(0);
    expect(phase).toBeLessThan(1);
    // Second record starts one stride later; defaults: taper 1/1, noise 0.
    const o2 = BEAM_STRIDE;
    expect(ib.i32[(o2 + BEAM_OFF_TO) >> 2]).toBe(4);
    expect(half(ib, o2 + BEAM_OFF_PARAMS + 2)).toBe(0);
    expect(half(ib, o2 + BEAM_OFF_PARAMS + 4)).toBe(1);
    expect(half(ib, o2 + BEAM_OFF_PARAMS + 6)).toBe(1);
    pass.destroy();
  });

  it('draws everything in exactly one instanced draw and uploads once', () => {
    const { canvas, dev, bindings } = fakeFx();
    const pass = new BeamPass(dev, bindings, { capacity: 64 });
    pass.begin();
    for (let i = 0; i < 40; i++) pass.add([i * 4096, 0, 0], [i * 4096, 0, 40960], STYLE);
    const r = encodeOnce(canvas, dev, (enc) => pass.encode(enc));
    expect(r.draws).toBe(1);
    expect(r.glDraws.length).toBe(1);
    expect(r.glDraws[0]!.args[2]).toBe(4); // 4 vertices (strip)
    expect(r.glDraws[0]!.args[3]).toBe(40); // instances
    expect(r.writes.length).toBe(1);
    expect(pass.stats).toMatchObject({ beams: 40, draws: 1, uploadBytes: 40 * BEAM_STRIDE });
    pass.destroy();
  });

  it('resets the immediate list on begin() (immediate mode) and draws nothing when empty', () => {
    const { canvas, dev, bindings } = fakeFx();
    const pass = new BeamPass(dev, bindings, { capacity: 16 });
    pass.begin();
    for (let i = 0; i < 10; i++) pass.add([0, 0, 0], [4096, 0, 0], STYLE);
    encodeOnce(canvas, dev, (enc) => pass.encode(enc));
    expect(pass.stats.beams).toBe(10);
    pass.begin();
    pass.add([0, 0, 0], [4096, 0, 0], STYLE);
    let r = encodeOnce(canvas, dev, (enc) => pass.encode(enc));
    expect(pass.stats.beams).toBe(1);
    expect(r.glDraws[0]!.args[3]).toBe(1);
    pass.begin();
    r = encodeOnce(canvas, dev, (enc) => pass.encode(enc));
    expect(r.draws).toBe(0);
    expect(r.glDraws.length).toBe(0);
    expect(r.writes.length).toBe(0);
    pass.destroy();
  });

  it('counts dropped beams on overflow instead of throwing', () => {
    const { canvas, dev, bindings } = fakeFx();
    const pass = new BeamPass(dev, bindings, { capacity: 4, timedCapacity: 2 });
    pass.begin();
    const ok = [0, 1, 2, 3, 4, 5].map(() => pass.add([0, 0, 0], [4096, 0, 0], STYLE));
    expect(ok).toEqual([true, true, true, true, false, false]);
    expect(pass.stats.dropped).toBe(2);
    expect(pass.addTimed([0, 0, 0], [1, 1, 1], STYLE, 0, 1)).toBe(true);
    expect(pass.addTimed([0, 0, 0], [1, 1, 1], STYLE, 0, 1)).toBe(true);
    expect(pass.addTimed([0, 0, 0], [1, 1, 1], STYLE, 0, 1)).toBe(false); // pool full
    pass.update(0.1);
    // Capacity 4 is taken by immediate beams: both timed beams are dropped at encode.
    const r = encodeOnce(canvas, dev, (enc) => pass.encode(enc));
    expect(r.glDraws[0]!.args[3]).toBe(4);
    expect(pass.stats.dropped).toBe(5);
    expect(pass.stats.droppedTotal).toBe(5);
    pass.begin();
    expect(pass.stats.dropped).toBe(0);
    expect(pass.stats.droppedTotal).toBe(5);
    pass.destroy();
  });

  it('addTimed beams fade out by themselves and expire', () => {
    const { canvas, dev, bindings } = fakeFx();
    const pass = new BeamPass(dev, bindings, { capacity: 16 });
    pass.addTimed([0, 0, 0], [40960, 0, 0], STYLE, 10, 0.5);
    pass.addTimed([0, 0, 0], [0, 0, 40960], STYLE, 10.2, 0.5);
    const alphaOf = (slot: number): number => half(pass.instances, slot * BEAM_STRIDE + BEAM_OFF_GLOW + 6);
    const alphas: number[] = [];
    for (const t of [10.1, 10.2, 10.3, 10.4]) {
      pass.begin();
      pass.update(t);
      encodeOnce(canvas, dev, (enc) => pass.encode(enc));
      expect(pass.stats.timed).toBe(2);
      alphas.push(alphaOf(0));
    }
    // Monotonic fade of the first beam after its flash-in.
    for (let i = 1; i < alphas.length; i++) expect(alphas[i]!).toBeLessThan(alphas[i - 1]!);
    expect(alphas[0]!).toBeCloseTo(STYLE.alpha * timedBeamFade(0.2), 2);
    pass.update(10.5); // first expired (age = life)
    expect(pass.stats.timed).toBe(1);
    pass.begin();
    encodeOnce(canvas, dev, (enc) => pass.encode(enc));
    expect(pass.stats.beams).toBe(1);
    // The survivor is the second beam (to = +z).
    expect(pass.instances.i32[(BEAM_OFF_TO >> 2) + 2]).toBe(40960);
    pass.update(10.7);
    expect(pass.stats.timed).toBe(0);
    pass.begin();
    expect(encodeOnce(canvas, dev, (enc) => pass.encode(enc)).draws).toBe(0);
    // Not-yet-started beams (t0 in the future) are invisible but kept.
    pass.addTimed([0, 0, 0], [1, 0, 0], STYLE, 20, 1);
    pass.update(19);
    expect(pass.stats.timed).toBe(1);
    pass.begin();
    expect(encodeOnce(canvas, dev, (enc) => pass.encode(enc)).draws).toBe(0);
    expect(pass.addTimed([0, 0, 0], [1, 0, 0], STYLE, 0, 0)).toBe(false);
    // A full timed pool rejects further shots and counts them as dropped.
    const small = new BeamPass(dev, bindings, { capacity: 4, timedCapacity: 2 });
    expect(small.addTimed([0, 0, 0], [1, 0, 0], STYLE, 0, 1)).toBe(true);
    expect(small.addTimed([0, 0, 0], [1, 0, 0], STYLE, 0, 1)).toBe(true);
    expect(small.addTimed([0, 0, 0], [1, 0, 0], STYLE, 0, 1)).toBe(false);
    expect(small.stats.dropped).toBe(1);
    small.update(2);
    expect(small.addTimed([0, 0, 0], [1, 0, 0], STYLE, 2, 1)).toBe(true);
    small.destroy();
    pass.destroy();
  });

  it('timedBeamFade: 0 outside [0, 1), peaks after the flash-in, decreasing afterwards', () => {
    expect(timedBeamFade(-0.1)).toBe(0);
    expect(timedBeamFade(1)).toBe(0);
    expect(timedBeamFade(Number.NaN)).toBe(0);
    expect(timedBeamFade(0)).toBe(0);
    expect(timedBeamFade(0.04)).toBeGreaterThan(0);
    let prev = timedBeamFade(0.08);
    for (let a = 0.1; a < 1; a += 0.05) {
      const v = timedBeamFade(a);
      expect(v).toBeLessThan(prev);
      prev = v;
    }
  });

  it('beamProfile: peak on the axis, monotonic falloff, zero at the quad edge', () => {
    let prev = beamProfile(0, 1, 1);
    expect(prev).toBeCloseTo(1.9, 5);
    for (let r = 0.02; r <= 1.0001; r += 0.02) {
      const v = beamProfile(r, 1, 1);
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
    expect(beamProfile(1, 1, 1)).toBeLessThan(1e-3);
  });

  it('re-uploads its instances after a context loss', () => {
    const { canvas, dev, bindings } = fakeFx();
    const pass = new BeamPass(dev, bindings, { capacity: 8 });
    pass.begin();
    pass.add([7, 8, 9], [10, 11, 12], STYLE);
    encodeOnce(canvas, dev, (enc) => pass.encode(enc));
    const uploads = pass.instances.uploads;
    canvas.gl.lose();
    canvas.gl.restore();
    expect(pass.instances.uploads).toBe(uploads + 1);
    const r = encodeOnce(canvas, dev, (enc) => pass.encode(enc));
    expect(r.draws).toBe(1);
    expect(canvas.gl.created('program')).toBeGreaterThan(0);
    pass.destroy();
  });
});
