import { describe, expect, it } from 'vitest';
import { FX_SEGMENTS } from '@faf/render-fx';
import { LAB_SEGMENTS, SAMPLE_RING_SIZE, SampleRing } from '../../src/app/hooks.ts';

function pushFrame(r: SampleRing, f: number): void {
  r.push(f, f / 60, 16.6, 1 + f, 0.5, 0.25, 20 + f, 100 * f);
}

describe('SampleRing', () => {
  it('keeps the last 2048 frames, oldest first', () => {
    expect(SAMPLE_RING_SIZE).toBe(2048);
    const r = new SampleRing();
    expect(r.capacity).toBe(2048);
    for (let f = 0; f < 5000; f++) pushFrame(r, f);
    const s = r.toArray();
    expect(s).toHaveLength(2048);
    expect(s[0]!.frame).toBe(5000 - 2048);
    expect(s.at(-1)!.frame).toBe(4999);
    for (let k = 1; k < s.length; k++) expect(s[k]!.frame).toBe(s[k - 1]!.frame + 1);
    const last = s.at(-1)!;
    expect(last).toEqual({
      frame: 4999,
      t: 4999 / 60,
      frameMs: 16.6,
      mainJsMs: 5000,
      fxJsMs: 0.5,
      labJsMs: 0.25,
      draws: 5019,
      fxDraws: 0,
      gpuMs: null,
      gpuSeg: { shadow: null, opaque: null, shields: null, particles: null, beams: null, post: null },
      particlesAlive: 499900,
    });
  });

  it('orders a partially filled ring and resets', () => {
    const r = new SampleRing(8);
    for (let f = 10; f < 13; f++) pushFrame(r, f);
    expect(r.toArray().map((s) => s.frame)).toEqual([10, 11, 12]);
    r.reset();
    expect(r.count).toBe(0);
    expect(r.toArray()).toEqual([]);
    pushFrame(r, 1);
    expect(r.toArray().map((s) => s.frame)).toEqual([1]);
  });

  it('writes late GPU results into the sample of their frame and sums them', () => {
    expect(LAB_SEGMENTS).toEqual(FX_SEGMENTS);
    const r = new SampleRing(4);
    for (let f = 0; f < 6; f++) pushFrame(r, f);
    expect(r.setGpu(3, 0, 0.5)).toBe(true);
    expect(r.setGpu(3, 5, 1.25)).toBe(true);
    expect(r.setGpu(5, 1, 2)).toBe(true);
    // Frame 1 has been overwritten, frame 9 does not exist yet, segment 6 is out of range.
    expect(r.setGpu(1, 0, 1)).toBe(false);
    expect(r.setGpu(9, 0, 1)).toBe(false);
    expect(r.setGpu(4, 6, 1)).toBe(false);
    const s = r.toArray();
    const f3 = s.find((x) => x.frame === 3)!;
    expect(f3.gpuSeg).toEqual({ shadow: 0.5, opaque: null, shields: null, particles: null, beams: null, post: 1.25 });
    expect(f3.gpuMs).toBe(1.75);
    expect(s.find((x) => x.frame === 5)!.gpuMs).toBe(2);
    expect(s.find((x) => x.frame === 4)!.gpuMs).toBeNull();
    // A new push into a recycled slot clears the old GPU values.
    pushFrame(r, 6);
    pushFrame(r, 7);
    expect(r.toArray().find((x) => x.frame === 7)!.gpuMs).toBeNull();
  });

  it('rejects invalid capacities', () => {
    expect(() => new SampleRing(0)).toThrow(RangeError);
    expect(() => new SampleRing(1.5)).toThrow(RangeError);
  });
});
