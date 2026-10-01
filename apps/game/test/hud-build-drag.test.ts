import { describe, expect, it } from 'vitest';
import { signal } from '@preact/signals';
import { CmdFlags, FrameFlags, FrameWriter, Op, decodeBatch, decodeBuild, frameCapacityBytes } from '@faf/protocol';
import { GameClient, ClientMap } from '@faf/client';
import { GameHudController } from '../src/hud/live.ts';
import type { Game } from '../src/game.ts';
import { FakeSimLink } from '../../../packages/client/test/support/fake-sim-link.ts';
import { FakeCanvas, FakeTarget, FakeRenderer, ManualRaf, key, pointer } from '../../../packages/client/test/support/fakes.ts';

function fixture(readOnlyCommands = false, spots: readonly { readonly kind: 'mass'; readonly x: number; readonly z: number }[] = []) {
  const link = new FakeSimLink({ units: 1, enemyUnits: 0 }), canvas = new FakeCanvas(), win = new FakeTarget(), plane = ClientMap.testPlane(64);
  const map = new ClientMap({ ...plane.map, meta: { ...plane.map.meta, spots } });
  const client = new GameClient({ canvas, keyTarget: win, renderer: new FakeRenderer(), link, map, visuals: [], playerArmy: 0, raf: new ManualRaf(), readOnlyCommands });
  const bp = {
    ids: ['core:cmd_commander', 'core:str_t1_pgen', 'core:str_t1_mex'], indexOf: (id: string) => bp.ids.indexOf(id),
    buildPowerQ16PerTickCol: Int32Array.of(65536, 0, 0), massCostCol: Int32Array.of(0, 75, 36), spotKindCol: Int32Array.of(-1, -1, 0),
    upgradesTo: () => -1, maxHpCol: Int32Array.of(10000, 400, 400), firstMount: () => 0, mountCount: () => 0, footprintW: () => 2, footprintH: () => 2, maxSlope: () => 4096,
    buildableByExpr: () => 0, unitMatchesExpr: () => true, maxHp: () => 10000, speedPerTick: () => 4096, vision: () => 40960,
    categoryNames: [] as string[], categoryWord: () => 0,
  };
  const game = { client, bp, map, unitCap: 8192, replayMode: readOnlyCommands, hud: signal({ contextLost: false }), params: { preset: 'medium' }, buildHash: 'test', transport: 'transfer', ready: null } as unknown as Game;
  const controller = new GameHudController(game);
  let seq = 0;
  const publish = (blocked = false): void => {
    const caps = { units: 4, parts: 0, projectiles: 0, beams: 0, events: 0, debugBytes: 0, footprints: 4 };
    const writer = new FrameWriter(caps), bytes = new Uint8Array(frameCapacityBytes(caps));
    writer.beginFrame(bytes, ++seq, seq, 0, 1000, 0, FrameFlags.FootprintSnapshot, 0, 0, 0);
    writer.writeUnit(32 * 4096, 0, 32 * 4096, 32 * 4096, 0, 32 * 4096, 0, 0, 0, 0, 255, 255, 0, 0, 42, 0, 0);
    // visual is the ninth argument; partBase follows handle. This selected unit is a nonbuilder pgen.
    writer.writeUnit(45 * 4096, 0, 45 * 4096, 45 * 4096, 0, 45 * 4096, 0, 0, 1, 0, 255, 255, 0, 0, 43, 0, 0);
    if (blocked) writer.writeFootprint(29, 29, 2, 2, 1, 88);
    link.frames.deliver(bytes, seq, writer.endFrame()); client.frame(seq * 100); client.selectHandles([42]); controller.update(true);
  };
  publish();
  const screen = (x: number, z: number): readonly [number, number] => {
    client.camera.update(); const out = new Float64Array(4);
    expect(client.camera.project(x * 4096, 0, z * 4096, out)).toBe(true);
    return [out[0]!, out[1]!];
  };
  const arm = (code = 'KeyW'): void => { controller.handleKey(key('keydown', code) as unknown as KeyboardEvent); };
  const start = (x = 28, z = 30): void => { const [sx, sy] = screen(x, z); canvas.dispatch(pointer('pointerdown', sx, sy, 0, { shiftKey: true })); };
  const move = (x = 36, z = 30): void => { const [sx, sy] = screen(x, z); canvas.dispatch(pointer('pointermove', sx, sy, 0, { shiftKey: true })); };
  const release = (x = 36, z = 30): void => { const [sx, sy] = screen(x, z); canvas.dispatch(pointer('pointerup', sx, sy, 0, { shiftKey: true })); };
  const dispose = (): void => { controller.dispose(); client.dispose(); };
  return { controller, client, canvas, win, link, publish, arm, start, move, release, dispose };
}

describe('live building Shift drag uses actual placement and Build commands', () => {
  it('previews a world line and emits one Queue Build per valid ghost only on release', () => {
    const f = fixture(); f.arm(); f.start(); f.move();
    const proposed = f.controller.dragGhosts.peek();
    expect(proposed.length).toBeGreaterThanOrEqual(4);
    expect(proposed.every(site => site.verdict === 0)).toBe(true);
    expect(f.link.sentBatches).toEqual([]); expect(Array.from(f.client.selection.selected())).toEqual([42]);
    for (let i = 1; i < proposed.length; i++) expect(proposed[i]!.x - proposed[i - 1]!.x).toBe(2 * 4096);
    f.release();
    const commands = f.link.sentBatches.flatMap(bytes => decodeBatch(bytes));
    expect(commands).toHaveLength(proposed.length);
    commands.forEach((command, i) => {
      expect(command).toMatchObject({ op: Op.Build, flags: CmdFlags.Queue, units: [42] });
      expect(decodeBuild(command.payload)).toEqual({ bp: proposed[i]!.bp, x: proposed[i]!.x, z: proposed[i]!.z, yaw: proposed[i]!.yaw });
    });
    const sent = f.link.sentBatches.length; f.release(); expect(f.link.sentBatches).toHaveLength(sent);
    expect(f.controller.dragGhosts.peek()).toEqual([]); expect(f.controller.queuedGhosts.peek()).toEqual([]);
    expect(f.controller.model.card.placingTypeId.peek()).toBe('core:str_t1_pgen'); f.dispose();
  });
  it('uses fresh Frame footprints at commit and skips blocked sites consistently with the preview', () => {
    const f = fixture(); f.arm(); f.start(); f.move();
    expect(f.controller.dragGhosts.peek().every(site => site.verdict === 0)).toBe(true);
    f.publish(true);
    const proposed = f.controller.dragGhosts.peek(), valid = proposed.filter(site => site.verdict === 0);
    expect(valid.length).toBeGreaterThan(0); expect(valid.length).toBeLessThan(proposed.length);
    f.release();
    expect(f.link.sentBatches.flatMap(bytes => decodeBatch(bytes)).map(command => decodeBuild(command.payload)))
      .toEqual(valid.map(site => ({ bp: site.bp, x: site.x, z: site.z, yaw: site.yaw })));
    f.dispose();
  });
  it('fills a footprint-spaced rectangle without overlaps', () => {
    const f = fixture(); f.arm(); f.start(); f.move(36, 34);
    const sites = f.controller.dragGhosts.peek();
    expect(new Set(sites.map(site => site.x)).size).toBeGreaterThan(1);
    expect(new Set(sites.map(site => site.z)).size).toBeGreaterThan(1);
    expect(sites.every(site => site.verdict === 0)).toBe(true);
    for (let i = 0; i < sites.length; i++) for (let j = i + 1; j < sites.length; j++) {
      expect(Math.abs(sites[i]!.x - sites[j]!.x) >= 2 * 4096 || Math.abs(sites[i]!.z - sites[j]!.z) >= 2 * 4096).toBe(true);
    }
    f.release(36, 34); expect(f.link.sentBatches).toHaveLength(sites.length); f.dispose();
  });
  it.each(['Escape', 'menu', 'pause'] as const)('cleans a preview on %s and never enqueues its physical release', action => {
    const f = fixture(); f.arm(); f.start(); f.move(); expect(f.controller.dragGhosts.peek().length).toBeGreaterThan(1);
    if (action === 'Escape') f.controller.handleKey(key('keydown', 'Escape') as unknown as KeyboardEvent);
    if (action === 'menu') f.controller.commands.openGameMenu();
    if (action === 'pause') f.controller.commands.togglePause();
    f.release(); expect(f.controller.dragGhosts.peek()).toEqual([]); expect(f.link.sentBatches).toEqual([]); f.dispose();
  });
  it('sends only eligible builders from a mixed selected group', () => {
    const f = fixture(); f.arm(); f.client.selectHandles([42, 43]); f.start(); f.move();
    expect(f.client.lastFrame!.unitVisual(1)).toBe(1);
    expect(Array.from(f.client.selection.selected())).toEqual([42, 43]);
    f.release();
    const commands = f.link.sentBatches.flatMap(bytes => decodeBatch(bytes));
    expect(commands.length).toBeGreaterThan(1);
    expect(commands.every(command => command.units.length === 1 && command.units[0] === 42)).toBe(true);
    f.dispose();
  });
  it('keeps resource magnet distance relative to the pointer and deduplicates snapped sites', () => {
    const f = fixture(false, [
      { kind: 'mass', x: 32 * 4096, z: 30 * 4096 },
      { kind: 'mass', x: 35 * 4096, z: 30 * 4096 },
    ]);
    f.arm('KeyQ'); f.start(28, 30);
    expect(f.controller.dragGhosts.peek().map(site => site.x)).toEqual([32 * 4096]);
    f.move(36, 30);
    const proposed = f.controller.dragGhosts.peek();
    expect(proposed.map(site => site.x)).toEqual([32 * 4096, 35 * 4096]);
    expect(proposed.every(site => site.verdict === 0)).toBe(true);
    f.release(36, 30);
    expect(f.link.sentBatches.flatMap(bytes => decodeBatch(bytes)).map(command => decodeBuild(command.payload).x))
      .toEqual([32 * 4096, 35 * 4096]);
    f.dispose();
  });
  it('clears an unpickable endpoint across HUD updates and never submits its release', () => {
    const f = fixture(); f.arm(); f.start(); f.move();
    expect(f.controller.dragGhosts.peek().length).toBeGreaterThan(1);
    f.client.pickAt = () => null;
    f.move(); f.controller.update(true);
    expect(f.controller.dragGhosts.peek()).toEqual([]); expect(f.controller.ghost.peek()).toBeNull();
    f.release(); expect(f.link.sentBatches).toEqual([]); f.dispose();
  });
  it('never arms or emits build gestures in read-only replay', () => {
    const f = fixture(true); f.arm(); f.start(); f.move(); f.release();
    expect(f.controller.dragGhosts.peek()).toEqual([]); expect(f.link.sentBatches).toEqual([]); f.dispose();
  });
});
