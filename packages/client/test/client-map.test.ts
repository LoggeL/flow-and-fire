// GameClient with a map (MS2): terrain + decals to the renderer, terrain picking for the right
// click (target y = terrain), markers/lines on the terrain, hover, KeyH jump, PartStream, edge pan
// only with focus, camera in pause, fullscreen action.
import { Op, decodeBatch } from '@faf/protocol';
import { RAW_PER_WU } from '@faf/render';
import { describe, expect, it } from 'vitest';
import { GameClient } from '../src/client.ts';
import { ClientMap } from '../src/map.ts';
import type { FullscreenDocument } from '../src/fullscreen.ts';
import { FakeSimLink } from './support/fake-sim-link.ts';
import { Clock, FakeCanvas, FakeRenderer, FakeTarget, ManualRaf, key, pointer } from './support/fakes.ts';
import { hollowRidge } from './support/map.ts';

const RAF_MS = 1000 / 60;

function setup(opts: { parts?: boolean; commander?: boolean; fullscreen?: boolean } = {}) {
  const clock = new Clock(1000);
  const raf = new ManualRaf();
  const canvas = new FakeCanvas(1280, 720);
  const win = new FakeTarget();
  const renderer = new FakeRenderer();
  const map = hollowRidge();
  const link = new FakeSimLink({ units: 50, enemyUnits: 5, originWU: [100, 100], spacingWU: 1, ...(opts.parts === true ? { parts: true } : {}) });
  const doc = new FakeTarget() as FakeTarget & { fullscreenElement: unknown };
  doc.fullscreenElement = null;
  const root = {
    requestFullscreen: async () => {
      doc.fullscreenElement = root;
      doc.dispatch({ type: 'fullscreenchange', timeStamp: 0, defaultPrevented: false, target: null, preventDefault() {} });
    },
  };
  const client = new GameClient({
    canvas,
    renderer,
    link,
    visuals: [{ spec: { hull: 'box', size: [1, 1, 1] } }],
    playerArmy: 0,
    keyTarget: win,
    raf,
    now: clock.now,
    focusProbe: () => null,
    map,
    ...(opts.commander === true ? { commanderVisuals: new Uint8Array([1]) } : {}),
    ...(opts.fullscreen === true ? { fullscreen: { root, doc: doc as unknown as FullscreenDocument } } : {}),
  });
  client.start();
  const frame = (ms = RAF_MS): void => {
    clock.advance(ms);
    link.advance(ms);
    raf.fire(clock.t);
  };
  const frames = (n: number): void => {
    for (let i = 0; i < n; i++) frame();
  };
  return { clock, raf, canvas, win, renderer, link, client, frame, frames, map, doc };
}

describe('GameClient with a map', () => {
  it('setMap: terrain + spot decals to the renderer, camera bounds/terrain, back to the test plane', () => {
    const { client, renderer, map } = setup();
    expect(renderer.terrain).toMatchObject({ sizeWu: 512, heightScaleRaw: 32, waterLevelRaw: 40960 });
    expect(renderer.decals).toHaveLength(18);
    expect(client.mapBounds).toEqual(map.bounds);
    client.jumpTo(96 * RAW_PER_WU, 96 * RAW_PER_WU, 60);
    expect(client.cameraState().y).toBeCloseTo(client.cameraController.focusHeightWU(96, 96), 6);
    // Back to the flat test plane: it is a generated map on the same path (terrain, no water/spots).
    client.setMap(ClientMap.testPlane());
    expect(renderer.terrain).toMatchObject({ sizeWu: 512, waterLevelRaw: null });
    expect(renderer.decals).toEqual([]);
    expect(client.cameraState().y).toBe(0);
    expect(client.heightAtRaw(96 * RAW_PER_WU, 96 * RAW_PER_WU)).toBe(0);
  });

  it('right click targets the terrain pick; marker and line sit on the terrain height', () => {
    const { client, canvas, link, renderer, frame, frames, map } = setup();
    frames(12);
    client.jumpTo(120 * RAW_PER_WU, 120 * RAW_PER_WU, 70);
    frame();
    const p = client.pickAt(700, 400)!;
    expect(p.hit).toBe(true);
    expect(p.y).toBe(map.heightAtRaw(p.x, p.z));
    canvas.dispatch(pointer('pointerdown', 700, 400, 2, { timeStamp: clock0() }));
    const env = decodeBatch(link.sentBatches.at(-1)!)[0]!;
    expect(env.op).toBe(Op.Move);
    const dv = new DataView(env.payload.buffer, env.payload.byteOffset, env.payload.byteLength);
    expect([dv.getInt32(0, true), dv.getInt32(4, true), dv.getInt32(8, true)]).toEqual([p.x, p.y, p.z]);
    frame();
    const marker = renderer.last!.overlays!.markers[0]!;
    expect([marker.x, marker.y, marker.z]).toEqual([p.x, p.y, p.z]);
    const line = renderer.last!.overlays!.lines[0]!;
    expect([line.bx, line.by, line.bz]).toEqual([p.x, p.y, p.z]);
    expect(Math.abs(p.y - map.heightAtRaw(p.x, p.z))).toBe(0);
  });

  it('hover: the terrain point under the pointer is tracked (re-picked on move/camera change)', () => {
    const { client, win, frame, map } = setup();
    frame();
    expect(client.hover.valid).toBe(false);
    win.dispatch(pointer('pointermove', 640, 360));
    frame();
    expect(client.hover.valid).toBe(true);
    expect(client.hover.hit).toBe(true);
    const h1 = { ...client.hover };
    expect(h1.y).toBe(map.heightAtRaw(h1.x, h1.z));
    client.jumpTo(300 * RAW_PER_WU, 200 * RAW_PER_WU);
    frame();
    expect(client.hover.x).not.toBe(h1.x);
  });

  it('KeyH jumps to the own start (no ACU yet) or to an own COMMAND unit', () => {
    const a = setup();
    a.frames(5);
    a.client.jumpTo(400 * RAW_PER_WU, 400 * RAW_PER_WU);
    a.win.dispatch(key('keydown', 'KeyH'));
    expect(a.client.cameraState()).toMatchObject({ x: 96, z: 96 });
    const b = setup({ commander: true });
    b.frames(12);
    b.client.jumpTo(400 * RAW_PER_WU, 400 * RAW_PER_WU);
    b.win.dispatch(key('keydown', 'KeyH'));
    const s = b.client.cameraState();
    expect(Math.abs(s.x - 100)).toBeLessThan(10);
    expect(Math.abs(s.z - 100)).toBeLessThan(10);
  });

  it('passes the PartStream of the frame to the renderer (merged parts)', () => {
    const { renderer, frames, client } = setup({ parts: true });
    frames(12);
    const parts = renderer.last!.parts!;
    expect(parts.count).toBe(55);
    expect(parts.bytes.length).toBe(55 * 8);
    expect(parts.version).toBe(client.stream.frameCount);
    const r = client.lastFrame!;
    expect(r.unitPartCount(0)).toBe(1);
    expect(r.partCurYaw(r.unitPartBase(0))).toBe((client.tick * 1000) & 0xffff);
  });

  it('edge pan moves the camera only while focused with the pointer inside; camera works in pause', () => {
    const { client, win, frames, link } = setup();
    frames(3);
    client.jumpTo(256 * RAW_PER_WU, 256 * RAW_PER_WU, 80);
    const x0 = client.cameraState().x;
    win.dispatch(pointer('pointermove', 1279, 360));
    frames(10);
    const x1 = client.cameraState().x;
    expect(x1).toBeGreaterThan(x0 + 5);
    win.dispatch({ type: 'blur', timeStamp: 0, defaultPrevented: false, target: null, preventDefault() {} });
    frames(10);
    expect(client.cameraState().x).toBe(x1);
    win.dispatch({ type: 'focus', timeStamp: 0, defaultPrevented: false, target: null, preventDefault() {} });
    link.paused = true;
    frames(10);
    expect(client.cameraState().x).toBeGreaterThan(x1 + 5);
    win.dispatch({ type: 'pointerout', relatedTarget: null, timeStamp: 0, defaultPrevented: false, target: null, preventDefault() {} });
    const x2 = client.cameraState().x;
    frames(10);
    expect(client.cameraState().x).toBe(x2);
  });

  it('Alt+Enter toggles fullscreen on the game root; Ctrl+middle rotates, Home resets', async () => {
    const { client, win, canvas, doc } = setup({ fullscreen: true });
    const seen: boolean[] = [];
    client.fullscreen!.onChange((a) => seen.push(a));
    win.dispatch(key('keydown', 'Enter', { altKey: true }));
    await Promise.resolve();
    expect(doc.fullscreenElement).not.toBeNull();
    expect(seen).toEqual([true]);
    const yaw = client.camera.yaw;
    canvas.dispatch(pointer('pointerdown', 600, 300, 1, { ctrlKey: true }));
    canvas.dispatch(pointer('pointermove', 650, 300, 1));
    canvas.dispatch(pointer('pointerup', 650, 300, 1));
    expect(client.camera.yaw).not.toBe(yaw);
    win.dispatch(key('keydown', 'Home'));
    expect(client.camera.yaw).toBe(yaw);
    client.dispose();
  });
});

function clock0(): number {
  return 1234;
}
