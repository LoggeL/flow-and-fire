import { describe, expect, it } from 'vitest';
import { PcmAssembler } from '../../src/decode/index.ts';

/** Planar block of `frames` frames whose values encode (channel, absolute index). */
function planar(channels: number, start: number, frames: number): Float32Array[] {
  const out: Float32Array[] = [];
  for (let c = 0; c < channels; c++) {
    const a = new Float32Array(frames);
    for (let i = 0; i < frames; i++) a[i] = (c + 1) * 100_000 + start + i;
    out.push(a);
  }
  return out;
}

function interleaved(channels: number, start: number, frames: number): Float32Array {
  const a = new Float32Array(frames * channels);
  for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) a[i * channels + c] = (c + 1) * 100_000 + start + i;
  return a;
}

function expectRange(ch: Float32Array, channel: number, from: number, count: number): void {
  expect(ch.length).toBe(count);
  for (let i = 0; i < count; i++) {
    if (ch[i] !== (channel + 1) * 100_000 + from + i) throw new Error(`sample ${i}: ${ch[i]} != ${(channel + 1) * 100_000 + from + i}`);
  }
}

describe('PcmAssembler', () => {
  it('skips pre-skip frames across several block boundaries (planar)', () => {
    const a = new PcmAssembler(2, 1000, { skip: 312 });
    a.push(planar(2, 0, 100), 100);
    a.push(planar(2, 100, 100), 100);
    expect(a.length).toBe(0);
    expect(a.pendingSkip).toBe(112);
    a.push(planar(2, 200, 960), 960); // skip ends inside this block
    a.push(planar(2, 1160, 152), 152);
    expect(a.length).toBe(1000);
    const [l, r] = a.finish();
    expectRange(l!, 0, 312, 1000);
    expectRange(r!, 1, 312, 1000);
  });

  it('trims at maxFrames (discard padding) and counts trimmed frames', () => {
    const a = new PcmAssembler(1, 2000, { skip: 312, maxFrames: 2000 });
    for (let s = 0; s < 3 * 960; s += 960) a.push(planar(1, s, 960), 960);
    expect(a.length).toBe(2000);
    expect(a.trimmedFrames).toBe(2880 - 312 - 2000);
    expectRange(a.finish()[0]!, 0, 312, 2000);
    // hint larger than what arrives → trimmed copy
    const b = new PcmAssembler(1, 3000, { skip: 312, maxFrames: 2300 });
    for (let s = 0; s < 3 * 960; s += 960) b.push(planar(1, s, 960), 960);
    expect(b.length).toBe(2300);
    expect(b.trimmedFrames).toBe(2880 - 312 - 2300);
    expectRange(b.finish()[0]!, 0, 312, 2300);
    // more pushes after the cap are dropped entirely
    const c = new PcmAssembler(1, 10, { maxFrames: 10 });
    c.push(planar(1, 0, 20), 20);
    c.push(planar(1, 20, 20), 20);
    expect(c.trimmedFrames).toBe(30);
    expectRange(c.finish()[0]!, 0, 0, 10);
  });

  it('de-interleaves stereo input and handles skip inside an interleaved block', () => {
    const a = new PcmAssembler(2, undefined, { skip: 5 });
    a.push(interleaved(2, 0, 8), 8);
    a.push(interleaved(2, 8, 8), 8);
    const [l, r] = a.finish();
    expectRange(l!, 0, 5, 11);
    expectRange(r!, 1, 5, 11);
  });

  it('upmixes mono sources and ignores extra source channels', () => {
    const up = new PcmAssembler(2);
    up.push(interleaved(1, 0, 4), 4, 1);
    up.push(planar(1, 4, 4), 4);
    const [l, r] = up.finish();
    expectRange(l!, 0, 0, 8);
    expectRange(r!, 0, 0, 8); // channel 0 values duplicated
    const down = new PcmAssembler(1);
    down.push(interleaved(2, 0, 4), 4, 2);
    down.push(planar(2, 4, 4), 4);
    expectRange(down.finish()[0]!, 0, 0, 8);
  });

  it('allocates exactly one buffer per channel for an exact hint (returns the internal buffer)', () => {
    const a = new PcmAssembler(2, 1920);
    a.push(planar(2, 0, 960), 960);
    const before = (a as unknown as { buffers: Float32Array[] }).buffers.slice();
    a.push(planar(2, 960, 960), 960);
    const out = a.finish();
    expect(out[0]).toBe(before[0]);
    expect(out[1]).toBe(before[1]);
  });

  it('grows beyond a too small hint and pads to minFrames on finish', () => {
    const a = new PcmAssembler(1, 10);
    for (let s = 0; s < 10_000; s += 1000) a.push(planar(1, s, 1000), 1000);
    expectRange(a.finish()[0]!, 0, 0, 10_000);
    const b = new PcmAssembler(1, 10);
    b.push(planar(1, 0, 5), 5);
    const out = b.finish(8)[0]!;
    expect(out.length).toBe(8);
    expect(Array.from(out.subarray(5))).toEqual([0, 0, 0]);
  });

  it('forTrack derives skip, cap and hint from a demuxed track', () => {
    const p20 = Uint8Array.of((31 << 3) | 0, 0);
    const a = PcmAssembler.forTrack({ channels: 1, packets: [p20, p20, p20], preSkip: 312, discardPaddingNs: 5_000_000 });
    for (let s = 0; s < 2880; s += 960) a.push(planar(1, s, 960), 960);
    expectRange(a.finish()[0]!, 0, 312, 2880 - 312 - 240);
  });

  it('validates arguments and misuse', () => {
    expect(() => new PcmAssembler(0)).toThrow(RangeError);
    expect(() => new PcmAssembler(1, 10, { skip: -1 })).toThrow(RangeError);
    const a = new PcmAssembler(2);
    expect(() => a.push(new Float32Array(3), 2)).toThrow(RangeError); // 2 frames × 2 ch > 3
    expect(() => a.push([new Float32Array(1)], 2)).toThrow(RangeError);
    a.push(new Float32Array(0), 0); // no-op
    a.finish();
    expect(() => a.finish()).toThrow();
    expect(() => a.push(new Float32Array(2), 1)).toThrow();
  });
});
