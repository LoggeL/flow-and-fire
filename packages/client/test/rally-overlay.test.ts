import { FrameReader, FrameWriter, UnitFlags } from '@faf/protocol';
import { DynamicDecals, type OverlaySegment } from '@faf/render';
import { describe, expect, it } from 'vitest';
import { AcceptedRallyOverlay, RALLY_COLOR } from '../src/rally-overlay.ts';
import { ClientMap } from '../src/map.ts';
import { GameClient } from '../src/client.ts';
import type { RigVisualEntry } from '../src/visuals.ts';
import { FakeSimLink } from './support/fake-sim-link.ts';
import { FakeCanvas, FakeRenderer, FakeTarget } from './support/fakes.ts';

interface Unit { handle: number; army?: number; build?: number; flags?: number; visual?: number; watch?: boolean; x?: number; z?: number }
const visuals: RigVisualEntry[] = [{ spec: { hull: 'box', size: [2, 1, 2] }, factory: true },
  { spec: { hull: 'box', size: [1, 1, 1] }, factory: false }];
const map = ClientMap.testPlane(64);
function accepted(units: readonly Unit[], rallyX = 31 * 4096 + 1024, rallyZ = 30 * 4096 + 2048, tick = 1, viewer = 0) {
  const writer = new FrameWriter({ units: units.length, parts: 0, projectiles: 0, beams: 0, events: 0, debugBytes: 0, watch: units.length });
  const bytes = new Uint8Array(writer.capacityBytes);
  writer.beginFrame(bytes, tick, tick, 0, 1000, viewer, 0, 0, 0, 0);
  for (const unit of units) writer.writeUnit(10 * 4096, 0, 12 * 4096, unit.x ?? 14 * 4096, 0, unit.z ?? 16 * 4096,
    0, 0, unit.visual ?? 0, unit.army ?? 0, 255, unit.build ?? 255, 0, unit.flags ?? UnitFlags.Building, unit.handle, 0, 0);
  for (const unit of units) if (unit.watch !== false) {
    writer.beginWatch(unit.handle, 0, 0); writer.setWatchFactory(false, -1, 0, rallyX, rallyZ, 0xffffffff);
  }
  const length = writer.endFrame(), frame = new FrameReader();
  expect(frame.reset(bytes.subarray(0, length))).toBe(true);
  const selection = { count: units.length, handles: Uint32Array.from(units.map(u => u.handle)), indices: Int32Array.from(units.map((_, i) => i)) };
  return { bytes, length, frame, selection };
}

describe('accepted factory rally presentation', () => {
  it('renders exact accepted coordinates and terrain-height line without changing Frame bytes', () => {
    const f = accepted([{ handle: 42 }]), before = f.bytes.slice(), overlay = new AcceptedRallyOverlay(), decals = new DynamicDecals();
    const output: OverlaySegment[] = [];
    overlay.update(f.frame, f.selection, 0, visuals, 0.5, map, decals, output);
    expect(output).toHaveLength(1); expect(output[0]).toMatchObject({ ax: 12 * 4096, az: 14 * 4096,
      bx: 31 * 4096 + 1024, bz: 30 * 4096 + 2048, color: RALLY_COLOR, widthWU: 0.12 });
    expect(output[0]!.ay).toBe(map.heightAtRaw(output[0]!.ax, output[0]!.az));
    expect(output[0]!.by).toBe(map.heightAtRaw(output[0]!.bx, output[0]!.bz));
    expect(decals.count).toBe(2); expect(decals.x[0]).toBe(f.frame.watchRallyX(0)); expect(decals.z[0]).toBe(f.frame.watchRallyZ(0));
    expect(decals.minRadiusPx[0]).toBe(6); expect(decals.maxRadiusWU[0]).toBe(2);
    expect(f.bytes).toEqual(before);
    const line = output[0]; output.length = 0; decals.clear();
    const next = accepted([{ handle: 42 }], 22 * 4096, 26 * 4096, 2);
    overlay.update(next.frame, next.selection, 0, visuals, 1, map, decals, output);
    expect(output[0]).toBe(line); expect(output[0]!.bx).toBe(22 * 4096); expect(decals.x[0]).toBe(22 * 4096);
  });
  it.each([
    { army: 1 }, { build: 80 }, { flags: UnitFlags.Ghost }, { flags: UnitFlags.Blip }, { flags: UnitFlags.Wreck },
    { visual: 1 }, { watch: false },
  ])('omits ineligible accepted record %j', overrides => {
    const f = accepted([{ handle: 42, ...overrides }]), overlay = new AcceptedRallyOverlay(), decals = new DynamicDecals(), output: OverlaySegment[] = [];
    overlay.update(f.frame, f.selection, 0, visuals, 1, map, decals, output);
    expect(output).toEqual([]); expect(decals.count).toBe(0);
  });
  it('omits unselected, stale, viewer-mismatched and invalid rally records', () => {
    const overlay = new AcceptedRallyOverlay(), decals = new DynamicDecals(), output: OverlaySegment[] = [];
    for (const reason of ['selection', 'stale', 'viewer', 'coordinates'] as const) {
      const f = accepted([{ handle: 42 }], reason === 'coordinates' ? -1 : 12 * 4096, 12 * 4096, 1, reason === 'viewer' ? 1 : 0);
      if (reason === 'selection') f.selection.count = 0;
      if (reason === 'stale') f.selection.indices[0] = 99;
      overlay.update(f.frame, f.selection, 0, visuals, 1, map, decals, output);
      expect(output).toEqual([]); expect(decals.count).toBe(0);
    }
  });
  it('bounds reused line storage and tolerates a full decal buffer', () => {
    const f = accepted(Array.from({ length: 65 }, (_, i) => ({ handle: 42 + i }))), overlay = new AcceptedRallyOverlay();
    const decals = new DynamicDecals(1), output: OverlaySegment[] = [];
    overlay.update(f.frame, f.selection, 0, visuals, 1, map, decals, output);
    expect(overlay.count).toBe(64); expect(output).toHaveLength(64);
    expect(output[63]).toBe(overlay.segments[63]); expect(decals.count).toBe(1);
    expect(decals.overflow).toBe(127);
  });
  it('reaches the actual client RenderView and disappears immediately on deselection', () => {
    const f = accepted([{ handle: 42 }]), link = new FakeSimLink({ units: 0, enemyUnits: 0 }), renderer = new FakeRenderer();
    const client = new GameClient({ canvas: new FakeCanvas(), keyTarget: new FakeTarget(), renderer, link, map, visuals, playerArmy: 0 });
    try {
      link.frames.deliver(f.bytes, 1, f.length); client.frame(1000); client.selectHandles([42]); client.frame(1016);
      expect(renderer.last!.overlays!.lines).toHaveLength(1);
      expect(renderer.last!.overlays!.lines[0]).toMatchObject({ bx: f.frame.watchRallyX(0), bz: f.frame.watchRallyZ(0), color: RALLY_COLOR });
      client.showPaths = false; client.frame(1024); expect(renderer.last!.overlays!.lines).toHaveLength(0);
      client.showPaths = true;
      client.selectHandles([]); client.frame(1032); expect(renderer.last!.overlays!.lines).toHaveLength(0);
      expect(client.dynamicDecals.count).toBe(0);
    } finally { client.dispose(); }
  });
});
