// MS3 client behaviour through the real input path: control groups (C7), double click, Shift queue
// with optimistic lines + watch routes, command-target discs of unwatched units, keyboard lock,
// footprint cheat, visual swap (HMR), strategic zoom out to the whole map.
import { CmdFlags, FrameReader, Op, decodeBatch, decodeCheatFootprint } from '@faf/protocol';
import { RAW_PER_WU, RtsCamera, strategicZoom } from '@faf/render';
import { describe, expect, it } from 'vitest';
import { CameraController, OVERVIEW_DRIFT_START } from '../src/camera-controller.ts';
import { GameClient, type GameClientCallbacks, type KeyboardLockLike } from '../src/client.ts';
import { ControlGroups, DOUBLE_TAP_MS, controlGroupOfCode } from '../src/control-groups.ts';
import { HandleIndex } from '../src/handle-index.ts';
import { CommandTargets } from '../src/order-feedback.ts';
import { ClientMap } from '../src/map.ts';
import { FakeSimLink } from './support/fake-sim-link.ts';
import { Clock, FakeCanvas, FakeRenderer, FakeTarget, ManualRaf, key, pointer, type FakeEvent } from './support/fakes.ts';
import { hollowRidge } from './support/map.ts';

const RAF_MS = 1000 / 60;

function setup(opts: { units?: number; callbacks?: GameClientCallbacks; visualOf?: (i: number) => number; fullscreen?: boolean; lock?: KeyboardLockLike | null } = {}) {
  const clock = new Clock(1000);
  const raf = new ManualRaf();
  const canvas = new FakeCanvas(1280, 720);
  const win = new FakeTarget();
  const renderer = new FakeRenderer();
  const link = new FakeSimLink({
    units: opts.units ?? 200,
    enemyUnits: 10,
    originWU: [240, 240],
    spacingWU: 2,
    ...(opts.visualOf !== undefined ? { visualOf: opts.visualOf } : {}),
  });
  const doc = new FakeDoc();
  const root = {
    requestFullscreen: async (): Promise<void> => {
      doc.fullscreenElement = root;
      doc.dispatch(plain('fullscreenchange'));
    },
    appendChild: (): void => undefined,
  };
  const client = new GameClient({
    canvas,
    renderer,
    link,
    visuals: [
      { spec: { hull: 'box', size: [1, 1, 1] }, iconThreshold: 0, selectionRadius: 0.6 },
      { spec: { hull: 'box', size: [1, 1, 1] }, iconThreshold: 0, selectionRadius: 0.8 },
    ],
    playerArmy: 0,
    keyTarget: win,
    raf,
    now: clock.now,
    focusProbe: () => null,
    keyboardLock: opts.lock ?? null,
    ...(opts.fullscreen === true ? { fullscreen: { root, doc, confine: false } } : {}),
    ...(opts.callbacks !== undefined ? { callbacks: opts.callbacks } : {}),
  });
  client.jumpTo(250 * RAW_PER_WU, 250 * RAW_PER_WU, 40);
  client.start();
  const frame = (ms = RAF_MS): void => {
    clock.advance(ms);
    link.advance(ms);
    raf.fire(clock.t);
  };
  const frames = (n: number): void => {
    for (let i = 0; i < n; i++) frame();
  };
  frames(3);
  return { clock, raf, canvas, win, renderer, link, client, frame, frames, doc };
}

function plain(type: string): FakeEvent {
  return { type, timeStamp: 0, defaultPrevented: false, target: null, preventDefault() {} };
}

class FakeDoc extends FakeTarget {
  fullscreenElement: unknown = null;
  exitFullscreen = async (): Promise<void> => {
    this.fullscreenElement = null;
    this.dispatch(plain('fullscreenchange'));
  };
}

/** Screen position of own record `i`. */
function screenOf(client: GameClient, i: number): { x: number; y: number } {
  const r = client.lastFrame!;
  return client.unitScreenPos(r.unitHandle(i))!;
}

describe('control groups (C7)', () => {
  it('code → group: Digit0–9 and Numpad0–9 only', () => {
    expect(controlGroupOfCode('Digit0')).toBe(0);
    expect(controlGroupOfCode('Digit9')).toBe(9);
    expect(controlGroupOfCode('Numpad4')).toBe(4);
    expect(controlGroupOfCode('KeyA')).toBe(-1);
    expect(controlGroupOfCode('Digit')).toBe(-1);
    expect(controlGroupOfCode('NumpadAdd')).toBe(-1);
  });

  it('store / add / dedupe / double tap / prune', () => {
    const cg = new ControlGroups();
    cg.store(1, [5, 6, 7]);
    cg.add(1, [7, 8]);
    expect([...cg.get(1)]).toEqual([5, 6, 7, 8]);
    cg.store(1, [9]);
    expect([...cg.get(1)]).toEqual([9]);
    expect(cg.tap(1, 1000)).toBe(false);
    expect(cg.tap(1, 1000 + DOUBLE_TAP_MS - 1)).toBe(true);
    expect(cg.tap(1, 1400)).toBe(false); // a double tap resets
    expect(cg.tap(2, 1450)).toBe(false); // another group
    expect(cg.tap(1, 1500)).toBe(false);
    expect(cg.tap(1, 1500 + DOUBLE_TAP_MS)).toBe(false); // too slow
    expect(() => cg.store(10, [])).toThrow(RangeError);
    // Prune against a frame: handle 9 is not in it.
    const link = new FakeSimLink({ units: 3, enemyUnits: 0 });
    const r = new FrameReader();
    r.reset(link.frames.poll()!);
    const idx = new HandleIndex();
    idx.build(r);
    const hs = link.handles();
    cg.store(2, [hs[0]!, 0xdeadbeef, hs[2]!]);
    expect(cg.prune(idx)).toBe(2); // group 1 (9) and 0xdeadbeef
    expect([...cg.get(2)]).toEqual([hs[0]!, hs[2]!]);
    expect(cg.size(1)).toBe(0);
    expect(cg.snapshot()[2]).toEqual([hs[0]!, hs[2]!]);
  });

  it('hotkeys: Ctrl+digit and Alt+digit store (preventDefault, never ⌘), digit recalls, Shift+digit adds, Shift+Ctrl/Alt adds to the group, double tap centres the camera', () => {
    const seen: string[] = [];
    const { client, win, canvas, frames, clock } = setup({ callbacks: { onControlGroup: (op, g, n, c) => seen.push(`${op}${g}:${n}${c ? '*' : ''}`) } });
    // Box-select a part of the units, store in group 1 with Ctrl+1.
    canvas.dispatch(pointer('pointerdown', 400, 200));
    canvas.dispatch(pointer('pointermove', 640, 400));
    canvas.dispatch(pointer('pointerup', 640, 400));
    const a = Array.from(client.selection.selected());
    expect(a.length).toBeGreaterThan(3);
    const ev = win.dispatch(key('keydown', 'Digit1', { ctrlKey: true }));
    expect(ev.defaultPrevented).toBe(true);
    expect([...client.controlGroups.get(1)].sort()).toEqual([...a].sort());
    // ⌘+2 is not bound (browser/OS shortcut).
    win.dispatch(key('keydown', 'Digit2', { metaKey: true }));
    expect(client.controlGroups.size(2)).toBe(0);
    // Alt+2 stores the other half (after selecting everything else).
    client.selectAll();
    const all = Array.from(client.selection.selected());
    const rest = all.filter((h) => !a.includes(h));
    client.select(rest);
    win.dispatch(key('keydown', 'Digit2', { altKey: true }));
    expect(client.controlGroups.size(2)).toBe(rest.length);
    // Recall 1 replaces the selection.
    win.dispatch(key('keydown', 'Digit1', { timeStamp: 5000 }));
    expect([...client.selection.selected()].sort()).toEqual([...a].sort());
    // Shift+2 adds group 2 to the selection.
    win.dispatch(key('keydown', 'Digit2', { shiftKey: true, timeStamp: 6000 }));
    expect(client.selection.count).toBe(all.length);
    // Shift+Alt+1 adds the (whole) selection to group 1.
    win.dispatch(key('keydown', 'Digit1', { shiftKey: true, altKey: true }));
    expect(client.controlGroups.size(1)).toBe(all.length);
    // Store group 3 from a small selection far from the camera focus, then double tap 3.
    client.select(all.slice(0, 2));
    win.dispatch(key('keydown', 'Digit3', { ctrlKey: true }));
    client.jumpTo(100 * RAW_PER_WU, 100 * RAW_PER_WU);
    frames(1);
    win.dispatch(key('keydown', 'Digit3', { timeStamp: clock.t }));
    expect(client.cameraState().x).toBeCloseTo(100, 0);
    win.dispatch(key('keydown', 'Digit3', { timeStamp: clock.t + 200 }));
    const st = client.cameraState();
    expect(st.x).toBeGreaterThan(235);
    expect(st.z).toBeGreaterThan(235);
    expect(seen).toContain('recall3:2*');
    // Numpad works like the digit row.
    win.dispatch(key('keydown', 'Numpad2', { timeStamp: clock.t + 2000 }));
    expect(client.selection.count).toBe(rest.length);
  });

  it('dead handles drop out of the groups on the next frame', () => {
    const { client, link, frames } = setup({ units: 20 });
    const hs = link.handles();
    client.select(hs.slice(0, 5));
    client.controlGroup('store', 4);
    expect(client.controlGroups.size(4)).toBe(5);
    client.kill([hs[0]!, hs[1]!]);
    frames(12);
    expect(client.controlGroups.size(4)).toBe(3);
    expect(client.selection.count).toBe(3);
    // Recalling an empty group keeps the selection.
    client.select([hs[10]!]);
    client.controlGroup('recall', 7);
    expect(client.selection.count).toBe(1);
  });
});

describe('selection input, orders and feedback (C3, G7)', () => {
  it('double click selects all own units of the clicked type on screen; single click selects one', () => {
    const { client, canvas, clock } = setup({ visualOf: (i) => (i % 4 === 0 ? 1 : 0) });
    const r = client.lastFrame!;
    let target = -1;
    for (let i = 0; i < 200; i++) {
      if (r.unitVisual(i) === 1) {
        const p = screenOf(client, i);
        if (p.x > 50 && p.x < 1230 && p.y > 50 && p.y < 670) {
          target = i;
          break;
        }
      }
    }
    const p = screenOf(client, target);
    const click = (t: number): void => {
      canvas.dispatch(pointer('pointerdown', p.x, p.y, 0, { timeStamp: t }));
      canvas.dispatch(pointer('pointerup', p.x, p.y, 0, { timeStamp: t + 30 }));
    };
    click(clock.t);
    expect(client.selection.count).toBe(1);
    click(clock.t + 150);
    const n = client.selection.count;
    expect(n).toBeGreaterThan(5);
    for (let k = 0; k < n; k++) expect(r.unitVisual(client.selection.indices[k]!)).toBe(1);
    // A third click (new pair) selects the single unit again.
    click(clock.t + 300);
    expect(client.selection.count).toBe(1);
    // Two slow clicks are no double click.
    click(clock.t + 2000);
    click(clock.t + 2600);
    expect(client.selection.count).toBe(1);
  });

  it('Shift+right click queues (CmdFlags.Queue); the optimistic line starts at the previous target; watch shows the queued target', () => {
    const { client, canvas, link, frames, renderer } = setup({ units: 16 });
    client.selectAll();
    canvas.dispatch(pointer('pointerdown', 300, 300, 2));
    frames(1);
    canvas.dispatch(pointer('pointerdown', 900, 400, 2, { shiftKey: true }));
    const envs = link.sentBatches.map((b) => decodeBatch(b)[0]!);
    expect(envs.map((e) => e.op)).toEqual([Op.Move, Op.Move]);
    expect(envs[0]!.flags).toBe(0);
    expect(envs[1]!.flags).toBe(CmdFlags.Queue);
    expect(envs[1]!.units).toHaveLength(16);
    // Optimistic line of the queued command starts at the first command's target.
    const t = new Float64Array(2);
    expect(client.feedback.targets.lastTargetOf(envs[0]!.units[0]!, t)).toBe(true);
    frames(1);
    expect(client.feedback.optimisticCount).toBe(2);
    frames(12);
    expect(client.feedback.optimisticCount).toBe(0);
    // Watch: every unit has 2 orders (active + queued) ⇒ route through both targets.
    const w = client.lastFrame!;
    expect(w.watchCount).toBe(16);
    expect(w.watchTargetCount(0)).toBe(2);
    expect(client.feedback.discs).toBe(32);
    expect(renderer.log[renderer.log.length - 1]!.decals).toBe(16 + 32);
    // S stops: orders gone ⇒ no targets, remembered command targets forgotten.
    client.stopSelected();
    frames(10);
    expect(client.lastFrame!.watchTargetCount(0)).toBe(0);
    expect(client.feedback.targets.size).toBe(0);
  });

  it('selected units beyond the 64 watched ones show only their command target disc while moving', () => {
    const { client, canvas, frames } = setup({ units: 100 });
    client.selectAll();
    expect(client.watchedHandles()).toHaveLength(64);
    canvas.dispatch(pointer('pointerdown', 1100, 150, 2));
    frames(14);
    expect(client.feedback.watchedDrawn).toBe(64);
    // 64 watched target discs + 1 command disc for the 36 unwatched ones.
    expect(client.feedback.discs).toBe(65);
    expect(client.feedback.ringCount).toBe(100);
    // Deselect: no rings, no discs, no lines.
    client.clearSelection();
    frames(1);
    expect(client.feedback.ringCount).toBe(0);
    expect(client.feedback.discs).toBe(0);
    expect(client.feedback.segments).toBe(0);
    expect(client.watchedHandles()).toHaveLength(0);
  });

  it('command targets: non-queued moves replace, queued append, stop forgets', () => {
    const ct = new CommandTargets();
    ct.add(1, [1, 2, 3], 10, 10, false);
    ct.add(2, [3], 20, 20, true);
    const t = new Float64Array(2);
    expect(ct.lastTargetOf(3, t)).toBe(true);
    expect([...t]).toEqual([20, 20]);
    ct.add(3, [1, 2, 3], 30, 30, false);
    expect(ct.size).toBe(1);
    ct.forget([1, 2, 3]);
    expect(ct.size).toBe(0);
    for (let i = 0; i < 100; i++) ct.add(i, [i], i, i, true);
    expect(ct.size).toBe(64);
  });

  it('footprint cheat (console obstacle) goes out as CheatSub.Footprint', () => {
    const { client, link, frames } = setup({ units: 4 });
    const seq = client.footprint(120, 130, 6, 3, 1);
    client.footprint(120, 130, 6, 3, -1);
    const e = decodeBatch(link.sentBatches[0]!)[0]!;
    expect(e.op).toBe(Op.Cheat);
    expect(e.seq).toBe(seq);
    expect(decodeCheatFootprint(e.payload)).toEqual({ cellX: 120, cellZ: 130, w: 6, h: 3, delta: 1 });
    frames(8);
    expect(link.footprints).toEqual([
      [120, 130, 6, 3, 1],
      [120, 130, 6, 3, -1],
    ]);
    expect(() => client.footprint(0, 0, 65, 1, 1)).toThrow(RangeError);
  });

  it('keyboard lock while in fullscreen (navigator.keyboard.lock), unlock when leaving', async () => {
    const calls: string[] = [];
    const lock: KeyboardLockLike = {
      lock: async () => {
        calls.push('lock');
      },
      unlock: () => {
        calls.push('unlock');
      },
    };
    const { client } = setup({ units: 4, fullscreen: true, lock });
    expect(await client.toggleFullscreen()).toBe(true);
    expect(calls).toEqual(['lock']);
    await client.toggleFullscreen();
    expect(calls).toEqual(['lock', 'unlock']);
    client.dispose();
  });

  it('unitsHidden renders no unit records while selection and sim keep running (bare-terrain reference frames)', () => {
    const { client, renderer, frames } = setup({ units: 20 });
    expect(renderer.last!.units.count).toBe(30);
    client.selectAll();
    client.unitsHidden = true;
    frames(2);
    expect(renderer.last!.units.count).toBe(0);
    expect(client.selection.count).toBe(20);
    client.unitsHidden = false;
    frames(2);
    expect(renderer.last!.units.count).toBe(30);
    expect(renderer.last!.units.bytes.byteLength).toBeGreaterThan(0);
    client.dispose();
  });

  it('setVisuals swaps renderer visuals and hit geometry (HMR)', () => {
    const { client, renderer } = setup({ units: 4 });
    const g0 = client.geometry;
    client.setVisuals([{ spec: { hull: 'cyl', size: [2, 1, 2] }, selectionRadius: 1.7, iconThreshold: 9 }]);
    expect(renderer.visuals).toHaveLength(1);
    expect(client.geometry).not.toBe(g0);
    expect(client.geometry.radius(0)).toBe(1.7);
    expect(client.geometry.threshold(0)).toBe(9);
    expect(client.selection.geometry).toBe(client.geometry);
  });
});

describe('strategic zoom (C2): stepless zoom out to the whole map', () => {
  it('wheel-zooming out from a corner ends centred with the whole map on screen, in Z2', () => {
    const map = hollowRidge();
    const cam = new RtsCamera();
    cam.setViewport(1280, 720);
    const cc = new CameraController(cam, { terrain: map });
    cc.jumpTo(60 * RAW_PER_WU, 70 * RAW_PER_WU, 30);
    let last = cam.distance;
    const levels = new Set<number>();
    for (let i = 0; i < 80; i++) {
      cc.zoomAt(1, 200, 150);
      expect(cam.distance).toBeGreaterThanOrEqual(last);
      last = cam.distance;
      levels.add(strategicZoom(cam.distance, map.sizeWu).level);
    }
    expect(cam.distance).toBeCloseTo(cam.maxDistance, 6);
    expect([...levels].sort()).toEqual([0, 1, 2]);
    const st = cc.state();
    expect(st.x).toBeCloseTo(map.sizeWu / 2, 3);
    expect(st.z).toBeCloseTo(map.sizeWu / 2, 3);
    const s = new Float64Array(4);
    for (const [x, z] of [[0, 0], [512, 0], [0, 512], [512, 512]] as const) {
      expect(cam.project(x * RAW_PER_WU, map.heightAtRaw(x * RAW_PER_WU, z * RAW_PER_WU), z * RAW_PER_WU, s)).toBe(true);
      expect(s[0]).toBeGreaterThanOrEqual(0);
      expect(s[0]).toBeLessThanOrEqual(1280);
      expect(s[1]).toBeGreaterThanOrEqual(0);
      expect(s[1]).toBeLessThanOrEqual(720);
    }
    // Below the drift start the anchor rule (point under the cursor stays) is untouched.
    cc.jumpTo(60 * RAW_PER_WU, 70 * RAW_PER_WU, OVERVIEW_DRIFT_START * cam.maxDistance * 0.5);
    const before = cc.state();
    cc.zoomAt(1, 640, 360);
    expect(cam.distance).toBeLessThan(OVERVIEW_DRIFT_START * cam.maxDistance);
    expect(Math.hypot(cc.state().x - 256, cc.state().z - 256)).toBeGreaterThan(Math.hypot(before.x - 256, before.z - 256) * 0.5);
  });

  it('client.zoom follows the renderer formula on the session map', () => {
    const { client } = setup({ units: 4 });
    client.setMap(ClientMap.testPlane());
    client.jumpTo(256 * RAW_PER_WU, 256 * RAW_PER_WU, 500);
    expect(client.zoom.level).toBe(2);
    client.jumpTo(256 * RAW_PER_WU, 256 * RAW_PER_WU, 30);
    expect(client.zoom.level).toBe(0);
  });
});
