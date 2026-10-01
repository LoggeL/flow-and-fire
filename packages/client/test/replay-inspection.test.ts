import { frameCapacityBytes, FrameWriter, Op, UnitFlags } from '@faf/protocol';
import { describe, expect, it } from 'vitest';
import { GameClient } from '../src/client.ts';
import { ClientMap } from '../src/map.ts';
import { FakeSimLink } from './support/fake-sim-link.ts';
import { FakeCanvas, FakeRenderer, FakeTarget, ManualRaf, pointer } from './support/fakes.ts';

function setup(readOnlyCommands = true, playerArmy = 0) {
  const link = new FakeSimLink({ units: 0 }), canvas = new FakeCanvas(), win = new FakeTarget();
  const client = new GameClient({ canvas, keyTarget: win, renderer: new FakeRenderer(), link, map: ClientMap.testPlane(64),
    visuals: [{ spec: { hull: 'box', size: [1, 1, 1] } }, { spec: { hull: 'box', size: [1, 2, 1] } }],
    playerArmy, readOnlyCommands, commanderVisuals: Uint8Array.of(0, 1), raf: new ManualRaf() });
  let seq = 1;
  function present(viewer: number, tick = 20) {
    const caps = { units: 5, parts: 0, projectiles: 0, beams: 0, events: 0, debugBytes: 0 };
    const writer = new FrameWriter(caps), bytes = new Uint8Array(frameCapacityBytes(caps));
    writer.beginFrame(bytes, ++seq, tick, 0, 1000, viewer, 0, 0, 0, 0);
    for (const [handle, army, x, flags] of [[42, 0, 22, 0], [84, 1, 32, 0],
      [85, 1, 35, UnitFlags.Ghost], [86, 1, 38, UnitFlags.Blip], [87, 1, 41, UnitFlags.Wreck]]) {
      writer.writeUnit(x! * 4096, 0, 32 * 4096, x! * 4096, 0, 32 * 4096, 0, 0, army!, army!, 255, 255, 0, flags!, handle!, 0, 0);
    }
    link.frames.deliver(bytes, seq, writer.endFrame()); client.frame(seq * 100);
  }
  return { client, link, canvas, present };
}

describe('read-only accepted replay perspective inspection', () => {
  it('clears selection/watch and groups on perspective change, then clicks the new army without commands', () => {
    const f = setup(); f.present(0);
    f.client.selectHandles([42]); f.client.controlGroups.save(0, [42]);
    expect(f.client.viewArmy).toBe(0); expect([...f.client.selection.selected()]).toEqual([42]);
    f.present(1);
    expect(f.client.playerArmy).toBe(0); expect(f.client.commands.army).toBe(0);
    expect(f.client.viewArmy).toBe(1); expect(f.client.selection.playerArmy).toBe(1);
    expect(f.client.selection.count).toBe(0); expect(f.client.controlGroups.snapshot()[0]).toEqual([]);
    expect(f.link.sentCtl.at(-1)).toEqual({ t: 'watch', handles: [] });
    expect(f.client.ownHandles()).toEqual([84]);
    const position = f.client.unitScreenPos(84)!;
    f.canvas.dispatch(pointer('pointerdown', position.x, position.y, 0));
    f.canvas.dispatch(pointer('pointerup', position.x, position.y, 0));
    expect([...f.client.selection.selected()]).toEqual([84]);
    expect(f.link.sentCtl.at(-1)).toEqual({ t: 'watch', handles: [84] });
    expect(f.client.jumpToCommander()).toEqual({ x: 32 * 4096, z: 32 * 4096 });
    f.canvas.dispatch(pointer('pointerdown', position.x, position.y, 2));
    f.client.moveTo(20 * 4096, 20 * 4096); f.client.stopSelected();
    f.client.commands.issue(Op.FactoryQueue, [84], new Uint8Array(4));
    expect(f.link.sentBatches).toEqual([]); expect(f.client.commands.sent).toBe(0);
    f.present(1, 4); expect(f.client.selection.count).toBe(0);
    expect(f.link.sentCtl.at(-1)).toEqual({ t: 'watch', handles: [] });
    f.client.dispose();
  });

  it('observer recordings instantiate and inspect full live units of any visible army', () => {
    const f = setup(true, -1); expect(f.client.viewArmy).toBe(-1);
    f.present(-1); expect(f.client.ownHandles()).toEqual([42, 84]);
    f.client.selectHandles([42, 84, 85, 86, 87]);
    expect([...f.client.selection.selected()]).toEqual([42, 84]);
    expect(f.link.sentCtl.at(-1)).toEqual({ t: 'watch', handles: [42, 84] });
    f.present(1); expect(f.client.selection.count).toBe(0); expect(f.client.ownHandles()).toEqual([84]);
    f.client.dispose();
  });

  it('live positive-army selection and command identity ignore frame viewer changes', () => {
    const f = setup(false); f.present(0); f.client.selectHandles([42]); f.present(1);
    expect(f.client.viewArmy).toBe(0); expect(f.client.selection.playerArmy).toBe(0);
    expect([...f.client.selection.selected()]).toEqual([42]); expect(f.client.ownHandles()).toEqual([42]);
    f.client.selectHandles([84]); expect(f.client.selection.count).toBe(0);
    f.client.dispose();
  });
});
