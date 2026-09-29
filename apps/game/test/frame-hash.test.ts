import { DEFAULT_FRAME_CAPS, FrameWriter, frameCapacityBytes } from '@faf/protocol';
import { describe, expect, it } from 'vitest';
import { FrameHasher } from '../src/frame-hash.ts';

function frame(tickTimeUs: number, debug: Uint8Array | null, unitX = 4096): Uint8Array {
  const w = new FrameWriter(DEFAULT_FRAME_CAPS);
  const buf = new Uint8Array(frameCapacityBytes(DEFAULT_FRAME_CAPS));
  w.beginFrame(buf, 3, 17, tickTimeUs, 1000, 0, 0, 5, 10, 0xdeadbeef);
  for (let i = 0; i < 4; i++) w.writeUnit(unitX + i, 0, 0, unitX + i + 1, 0, 0, 0, 100, 0, 0, 255, 255, 0, 0, i + 1, 0, 0);
  if (debug !== null) w.setDebugSection(debug);
  const len = w.endFrame();
  return buf.slice(0, len);
}

describe('frame fingerprint (transport byte equality)', () => {
  it('ignores the wall-clock fields: tickTimeUs and the debug section', () => {
    const h = new FrameHasher();
    const a = h.hash(frame(120, null));
    const b = h.hash(frame(999_999, null));
    const c = h.hash(frame(5, new Uint8Array([1, 0, 20, 0, 9, 9, 9, 9])));
    expect(a.tick).toBe(17);
    expect(b.hash).toBe(a.hash);
    expect(c.hash).toBe(a.hash);
    expect(c.byteLength).toBe(a.byteLength);
  });

  it('sees every other byte (unit positions)', () => {
    const h = new FrameHasher();
    expect(h.hash(frame(0, null, 4097)).hash).not.toBe(h.hash(frame(0, null)).hash);
  });

  it('does not modify the frame', () => {
    const f = frame(77, new Uint8Array([1, 2, 3, 4]));
    const copy = f.slice();
    new FrameHasher().hash(f);
    expect(f).toEqual(copy);
  });

  it('short buffers hash as raw bytes with tick −1', () => {
    expect(new FrameHasher().hash(new Uint8Array([1, 2, 3])).tick).toBe(-1);
  });
});
