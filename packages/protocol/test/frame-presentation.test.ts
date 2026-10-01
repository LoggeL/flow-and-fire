import { describe, expect, it } from 'vitest';
import { BUILD_INTENT_RECORD_BYTES, FH_BUILD_INTENT_COUNT, FH_FLOW_COUNT, FH_FLOW_OFFSET, FH_HEADER_BYTES, FH_VERSION, FlowFlags, FogState, FrameReader, FrameWriter } from '../src/index.ts';
import { TEST_CAPS } from './support/frames.ts';

function presentationFrame() {
  const writer = new FrameWriter({ ...TEST_CAPS, flow: 2, fogBytes: 4, buildIntents: 2 });
  const bytes = new Uint8Array(writer.capacityBytes);
  writer.beginFrame(bytes, 8, 15, 120, 1000, 0, 0, 2, 10, 123);
  writer.setFlowTick(15);
  writer.writeFlow(0x100001, 4, 0, FlowFlags.Billed, 1, 0xffffffff, 4294967301, 99, 87, 65, 98304, 0);
  writer.writeFlow(0x100002, 2, 0, FlowFlags.Contributing, 1, 0x100001, 0, 0, 0, 0, 0, 65536);
  writer.setFogSnapshot(Uint8Array.of(FogState.Unexplored, FogState.Explored, FogState.Visible, FogState.Visible), 2);
  writer.writeBuildIntent(0x100002, 4, 16384, 20 * 4096, 30 * 4096, 20, 0, 0xffffffff);
  return bytes.subarray(0, writer.endFrame());
}

describe('v5 frame presentation contract', () => {
  it('keeps exact safe-integer billing distinct from source links and preserves a queue index beyond watch capacity', () => {
    const reader = new FrameReader();
    expect(reader.reset(presentationFrame())).toBe(true);
    expect(reader.flowTick).toBe(15);
    expect(reader.flowCount).toBe(2);
    expect(reader.flowMassDemand(0)).toBe(4294967301);
    expect(reader.flowEffectivePower(0)).toBe(98304);
    expect(reader.flowTarget(1)).toBe(reader.flowHandle(0));
    expect(reader.flowFlags(1)).toBe(FlowFlags.Contributing);
    expect(reader.flowMassSpent(1)).toBe(0);
    expect(reader.flowOwnPower(1)).toBe(65536);
    const fog = new Uint8Array(4);
    reader.copyFog(fog);
    expect([...fog]).toEqual([0, 1, 2, 2]);
    expect(reader.buildIntentQueueIndex(0)).toBe(20);
    expect(reader.buildIntentX(0)).toBe(20 * 4096);
    expect(reader.buildIntentTarget(0)).toBe(0xffffffff);
    expect(BUILD_INTENT_RECORD_BYTES).toBe(24);
  });

  it('exposes no new presentation fields when reading a historical v4 header', () => {
    const bytes = presentationFrame();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint16(FH_VERSION, 4, true);
    view.setUint16(FH_HEADER_BYTES, 160, true);
    const reader = new FrameReader();
    expect(reader.reset(bytes)).toBe(true);
    expect([reader.flowCount, reader.flowTick, reader.fogBytes, reader.buildIntentCount]).toEqual([0, -1, 0, 0]);
  });

  it('rejects forged counts and unsafe billed values before consumers receive the frame', () => {
    for (const offset of [FH_FLOW_COUNT, FH_BUILD_INTENT_COUNT]) {
      const bytes = presentationFrame();
      new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, 0xffffffff, true);
      expect(new FrameReader().reset(bytes)).toBe(false);
    }
    const bytes = presentationFrame(), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint32(view.getUint32(FH_FLOW_OFFSET, true) + 20, 0x200000, true);
    expect(new FrameReader().reset(bytes)).toBe(false);
  });
});
