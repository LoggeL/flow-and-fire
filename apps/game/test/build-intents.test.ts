import { describe, expect, it } from 'vitest';
import { FrameReader, FrameWriter, UnitFlags } from '@faf/protocol';
import { PlacementVerdict } from '@faf/rules';
import { FrameBuildIntents, equalQueuedGhosts, type IntentProjection } from '../src/hud/build-intents.ts';

interface Intent {
  readonly builder: number; readonly x: number; readonly z: number;
  readonly index: number; readonly army?: number; readonly target?: number; readonly yaw?: number;
}
function frame(intents: readonly Intent[], tick = 100, seq = tick, mesh = false): FrameReader {
  const writer = new FrameWriter({ units: 1, parts: 0, projectiles: 0, beams: 0, events: 0, debugBytes: 0, buildIntents: 80 });
  const bytes = new Uint8Array(writer.capacityBytes);
  writer.beginFrame(bytes, seq, tick, 0, 1000, 0, 0, 0, 0, 0);
  if (mesh) writer.writeUnit(20 * 4096, 0, 30 * 4096, 20 * 4096, 0, 30 * 4096, 0, 0, 2, 0, 200, 100, 0, UnitFlags.Building, 700, 0, 0);
  for (const intent of intents) writer.writeBuildIntent(intent.builder, 2, intent.yaw ?? 0, intent.x * 4096, intent.z * 4096, intent.index, intent.army ?? 0, intent.target ?? 0xffffffff);
  const reader = new FrameReader();
  expect(reader.reset(bytes.subarray(0, writer.endFrame()))).toBe(true);
  return reader;
}
const footprint = () => ({ typeId: 'core:str_test', width: 2, height: 4 });
const camera: IntentProjection = {
  heightAt: (x, z) => (x + z) / 4096,
  project: (x, y, z, out) => { out[0] = x / 4096; out[1] = z / 4096 - y; return true; },
};

describe('shared queued build footprint consumer', () => {
  it('draws all 32 distinct accepted sites without watching and merges the original 20 shared sites', () => {
    const intents: Intent[] = Array.from({ length: 32 }, (_, index) => ({ builder: 10, x: 20 + index * 4, z: 30, index }));
    intents.push(...intents.slice(0, 20).map(intent => ({ ...intent, builder: 11, army: 1 })));
    const ghosts = new FrameBuildIntents().project(frame(intents), footprint, camera);
    expect(ghosts).toHaveLength(32);
    expect(ghosts.slice(0, 20).every(ghost => ghost.builders.length === 2 && ghost.orders.length === 2)).toBe(true);
    expect(ghosts[19]!.armies).toEqual([0, 1]);
    expect(ghosts[31]!.orders[0]!.queueIndex).toBe(31);
    expect(ghosts.every(ghost => ghost.verdict === null)).toBe(true);
  });

  it('suppresses the actual shared target mesh, preserves a second builder takeover and rebuilds after rewind', () => {
    const consumer = new FrameBuildIntents(), shared: Intent[] = [
      { builder: 10, x: 20, z: 30, index: 0, target: 700 },
      { builder: 11, x: 20, z: 30, index: 5 },
    ];
    expect(consumer.project(frame(shared, 101, 1, true), footprint, camera)).toEqual([]);
    expect(consumer.project(frame(shared.slice(1), 102, 2, true), footprint, camera)).toEqual([]);
    const rewound = consumer.project(frame(shared.slice(1), 10, 3), footprint, camera);
    expect(rewound).toHaveLength(1);
    expect(rewound[0]!.builders).toEqual([11]);
    expect(rewound[0]!.orders[0]!.queueIndex).toBe(5);
    expect(consumer.project(frame([], 0, 4), footprint, camera)).toEqual([]);
  });

  it('projects rotated compiled dimensions at current terrain heights and updates a paused camera', () => {
    const consumer = new FrameBuildIntents(), accepted = frame([{ builder: 10, x: 20, z: 30, yaw: 16384, index: 0 }]);
    const flat: IntentProjection = { heightAt: () => 9, project: (x, y, z, out) => { out[0] = x / 4096; out[1] = z / 4096 - y; return true; } };
    const first = consumer.project(accepted, footprint, flat);
    expect(first[0]!.corners).toEqual([[18, 20], [22, 20], [22, 22], [18, 22]]);
    const shifted = consumer.project(accepted, footprint, { ...flat, project: (x, y, z, out) => { flat.project(x, y, z, out); out[0] = out[0]! + 50; return true; } });
    expect(shifted[0]!.corners[0]).toEqual([68, 20]);
    expect(equalQueuedGhosts(first, shifted)).toBe(false);
    expect(equalQueuedGhosts(first, consumer.project(accepted, footprint, flat))).toBe(true);
  });

  it('uses only present known blockers and clears rejected or missing projections', () => {
    const consumer = new FrameBuildIntents(), accepted = frame([{ builder: 10, x: 20, z: 30, index: 0 }]);
    expect(consumer.project(accepted, footprint, { ...camera, blocker: () => PlacementVerdict.Valid })[0]!.verdict).toBeNull();
    expect(consumer.project(accepted, footprint, { ...camera, blocker: () => PlacementVerdict.Occupied })[0]!.verdict).toBe(PlacementVerdict.Occupied);
    expect(consumer.project(accepted, footprint, { ...camera, project: () => false })).toEqual([]);
    expect(consumer.project(null, footprint, camera)).toEqual([]);
  });
});
