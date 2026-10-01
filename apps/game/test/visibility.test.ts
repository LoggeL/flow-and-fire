import { describe, expect, it } from 'vitest';
import { FrameReader, FrameWriter, frameCapacityBytes } from '@faf/protocol';
import { FrameVisibility, type VisibilityPort } from '../src/visibility.ts';
import type { VisibilityFogSnapshot } from '@faf/render';

const caps = { units: 0, parts: 0, projectiles: 0, beams: 0, events: 0, debugBytes: 0, fogBytes: 4 };
function frame(seq: number, tick: number, viewer: number, cells?: Uint8Array) {
  const bytes = new Uint8Array(frameCapacityBytes(caps)), writer = new FrameWriter(caps);
  writer.beginFrame(bytes, seq, tick, 0, 1000, viewer, 0, 0, 0, 0);
  if (cells) writer.setFogSnapshot(cells, 2);
  const reader = new FrameReader(); expect(reader.reset(bytes.subarray(0, writer.endFrame()))).toBe(true);
  return reader;
}
function fixture(preRevealTerrain = false) {
  const calls: (VisibilityFogSnapshot | null)[] = [];
  const port: VisibilityPort = { setVisibilityFog(snapshot) { calls.push(snapshot === null ? null : { ...snapshot, cells: snapshot.cells.slice() }); } };
  return { visibility: new FrameVisibility(preRevealTerrain), calls, port };
}
describe('accepted Game visibility', () => {
  it('pre-reveals public terrain as dim explored cells without changing authoritative visibility', () => {
    const f = fixture(true), reader = frame(1, 100, 0, Uint8Array.of(0, 1, 2, 0));
    f.visibility.accept(reader, f.port, 10);
    expect([...f.visibility.snapshot!.cells]).toEqual([1, 1, 2, 1]);
    const authoritative = new Uint8Array(4); reader.copyFog(authoritative);
    expect([...authoritative]).toEqual([0, 1, 2, 0]);
    f.visibility.accept(frame(2, 101, 0, Uint8Array.of(0, 2, 1, 0)), f.port, 20);
    expect([...f.visibility.snapshot!.cells]).toEqual([1, 2, 1, 1]);
    f.visibility.accept(frame(3, 101, -1, Uint8Array.of(2, 2, 2, 2)), f.port, 30);
    expect([...f.visibility.snapshot!.cells]).toEqual([2, 2, 2, 2]);
  });
  it('copies transport-owned bytes, reuses storage and ignores repeated presentation of the same frame', () => {
    const f = fixture(), reader = frame(1, 100, 0, Uint8Array.of(0, 1, 2, 0));
    f.visibility.accept(reader, f.port, 10);
    const retained = f.visibility.snapshot!.cells;
    expect([...retained]).toEqual([0, 1, 2, 0]);
    f.visibility.accept(reader, f.port, 11); expect(f.calls).toHaveLength(1);
    f.visibility.accept(frame(2, 101, 0, Uint8Array.of(1, 1, 2, 2)), f.port, 20);
    expect(f.visibility.snapshot!.cells).toBe(retained);
    expect(f.calls[0]!.cells).toEqual(Uint8Array.of(0, 1, 2, 0));
    expect(f.calls[1]!.cells).toEqual(Uint8Array.of(1, 1, 2, 2));
    expect(f.visibility.snapshot!.epoch).toBe(1);
  });
  it('clears interpolation immediately for a backwards seek, new viewer and legacy frame without Fog', () => {
    const f = fixture();
    f.visibility.accept(frame(8, 800, 0, Uint8Array.of(0, 1, 2, 0)), f.port, 10);
    f.visibility.accept(frame(9, 100, 0, Uint8Array.of(0, 0, 2, 0)), f.port, 20);
    expect(f.calls[1]).toBeNull(); expect(f.visibility.snapshot!.epoch).toBe(2);
    f.visibility.accept(frame(10, 100, -1, Uint8Array.of(2, 2, 2, 2)), f.port, 30);
    expect(f.calls[3]).toBeNull(); expect(f.visibility.snapshot!.viewer).toBe(-1);
    expect(f.visibility.snapshot!.epoch).toBe(3);
    f.visibility.accept(frame(11, 101, -1), f.port, 40);
    expect(f.calls.at(-1)).toBeNull(); expect(f.visibility.snapshot).toBeNull();
  });
});
