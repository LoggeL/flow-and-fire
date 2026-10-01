import { afterEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@preact/signals';
import { decodeSimBin } from '@faf/blueprints/simbin';
import { readFileSync } from 'node:fs';
import { EcoField, FrameWriter, frameCapacityBytes } from '@faf/protocol';
import { GameClient, ClientMap } from '@faf/client';
import { GameHudController } from '../src/hud/live.ts';
import { FrameVisibility } from '../src/visibility.ts';
import type { Game } from '../src/game.ts';
import { FakeSimLink } from '../../../packages/client/test/support/fake-sim-link.ts';
import { FakeCanvas, FakeTarget, FakeRenderer, ManualRaf } from '../../../packages/client/test/support/fakes.ts';

afterEach(() => vi.restoreAllMocks());
function fixture() {
  let now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const link = new FakeSimLink({ units: 0, enemyUnits: 0 }), renderer = new FakeRenderer(), map = ClientMap.testPlane(64), visibility = new FrameVisibility();
  const bp = decodeSimBin(new Uint8Array(readFileSync(new URL('../../../content/generated/sim.bin', import.meta.url))));
  const client = new GameClient({ canvas: new FakeCanvas(), keyTarget: new FakeTarget(), renderer, link, map,
    visuals: [], playerArmy: 0, raf: new ManualRaf(), readOnlyCommands: true,
    callbacks: { onFrame(c) { visibility.accept(c.lastFrame!, { setVisibilityFog() {} }, now); } } });
  const game = { client, bp, map, visibility, unitCap: 8192, replayMode: true,
    hud: signal({ contextLost: false }), params: { preset: 'medium' }, buildHash: 'test', transport: 'transfer', ready: null } as unknown as Game;
  const controller = new GameHudController(game);
  const caps = { units: 2, parts: 0, projectiles: 0, beams: 0, events: 0, debugBytes: 0, eco: 1, fogBytes: 64 };
  let seq = 0;
  function publish(viewer: number, tick: number, stored: number | null, cell: number) {
    now += 1;
    const bytes = new Uint8Array(frameCapacityBytes(caps)), writer = new FrameWriter(caps);
    writer.beginFrame(bytes, ++seq, tick, 0, 1000, viewer, 0, 0, 0, 0);
    writer.writeUnit(16*4096, 0, 16*4096, 16*4096, 0, 16*4096, 0, 0,
      bp.indexOf('core:cmd_commander'), viewer < 0 ? 0 : viewer, 255, 255, 0, 0, viewer < 0 ? 1 : viewer + 1, 0, 0);
    if (stored !== null) {
      const eco = writer.beginEco(viewer, 0, 65536, 65536, 65536);
      writer.setEcoValue(eco, EcoField.massStored, stored * 1000);
      writer.setEcoValue(eco, EcoField.massCapacity, 1000000);
    }
    const fog = new Uint8Array(64); fog[cell] = 2;
    writer.setFogSnapshot(fog, 8);
    link.frames.deliver(bytes, seq, writer.endFrame()); client.frame(now); controller.update();
  }
  return { controller, client, publish };
}
describe('HUD accepted replay perspective', () => {
  it('updates private resource, unit and minimap values immediately inside both normal throttle windows', () => {
    const f = fixture();
    f.publish(0, 800, 125, 18);
    expect(f.controller.model.eco.mass.stored.peek()).toBe(125);
    expect(f.controller.model.minimap.fog.peek()!.cells[18]).toBe(2);
    f.publish(1, 800, 900, 45);
    expect(f.controller.model.eco.mass.stored.peek()).toBe(900);
    expect(f.controller.model.match.units.peek()).toBe(1);
    expect(f.controller.model.minimap.units.peek().army[0]).toBe(0);
    expect(f.controller.model.minimap.fog.peek()!.cells[18]).toBe(0);
    expect(f.controller.model.minimap.fog.peek()!.cells[45]).toBe(2);
    f.publish(1, 100, 25, 10);
    expect(f.controller.model.eco.mass.stored.peek()).toBe(25);
    expect(f.controller.model.match.timeS.peek()).toBe(10);
    expect(f.controller.model.minimap.fog.peek()!.cells[45]).toBe(0);
    expect(f.controller.model.minimap.fog.peek()!.cells[10]).toBe(2);
    f.controller.dispose(); f.client.dispose();
  });
  it('clears unavailable army and observer resources instead of keeping another perspective', () => {
    const f = fixture(); f.publish(0, 800, 125, 18);
    f.publish(1, 800, null, 45);
    expect(f.controller.model.eco.mass.stored.peek()).toBe(0);
    expect(f.controller.model.eco.consumers.peek()).toEqual([]);
    expect(f.controller.model.eco.interactive.peek()).toBe(false);
    f.publish(-1, 800, null, 1);
    expect(f.controller.model.eco.mass.stored.peek()).toBe(0);
    expect(f.controller.model.eco.energy.capacity.peek()).toBe(0);
    f.controller.dispose(); f.client.dispose();
  });
});
