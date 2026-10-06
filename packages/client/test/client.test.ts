import v8 from 'node:v8';
import { Op, decodeBatch } from '@faf/protocol';
import { RAW_PER_WU, type VisualTable } from '@faf/render';
import { describe, expect, it } from 'vitest';
import { GameClient, type GameClientCallbacks } from '../src/client.ts';
import { FakeSimLink } from './support/fake-sim-link.ts';
import { Clock, FakeCanvas, FakeRenderer, FakeTarget, ManualRaf, key, pointer } from './support/fakes.ts';

const RAF_MS = 1000 / 60;

function setup(opts: { units?: number; callbacks?: GameClientCallbacks; focus?: { el: unknown }; visuals?: VisualTable } = {}) {
  const clock = new Clock(1000);
  const raf = new ManualRaf();
  const canvas = new FakeCanvas(1280, 720);
  const win = new FakeTarget();
  const renderer = new FakeRenderer();
  const link = new FakeSimLink({ units: opts.units ?? 1000, enemyUnits: 20, originWU: [200, 200], spacingWU: 2 });
  const focus = opts.focus ?? { el: null };
  const client = new GameClient({
    canvas,
    renderer,
    link,
    visuals: opts.visuals ?? [{ spec: { hull: 'box', size: [1, 1, 1] }, color: 0x808080 }],
    playerArmy: 0,
    keyTarget: win,
    raf,
    now: clock.now,
    focusProbe: () => focus.el,
    ...(opts.callbacks !== undefined ? { callbacks: opts.callbacks } : {}),
  });
  client.start();
  /** Advances wall time by one rAF: sim ticks due, then the rAF callback. */
  const frame = (ms = RAF_MS): void => {
    clock.advance(ms);
    link.advance(ms);
    raf.fire(clock.t);
  };
  const frames = (n: number): void => {
    for (let i = 0; i < n; i++) frame();
  };
  return { clock, raf, canvas, win, renderer, link, client, frame, frames, focus };
}

describe('GameClient', () => {
  it('renders the frame units straight from the frame bytes with the visual table', () => {
    const { client, renderer, frames } = setup();
    expect(renderer.visuals).toHaveLength(1);
    frames(3);
    expect(renderer.calls).toBe(3);
    const last = renderer.log[renderer.log.length - 1]!;
    expect(last.count).toBe(1020);
    expect(renderer.last!.units.bytes.length).toBe(1020 * 48);
    expect(renderer.last!.units.bytes.buffer).toBe(client.lastFrame!.bytes.buffer);
    // FA behaviour (MS3): nothing is selected at the start.
    expect(client.selection.count).toBe(0);
    expect(client.tick).toBe(0);
    frames(12);
    expect(client.tick).toBeGreaterThanOrEqual(1);
  });

  it('right click: marker in the very next rAF, optimistic line until the seq is acknowledged, then watch routes; units move', () => {
    const { client, canvas, renderer, link, frame, frames, win } = setup();
    frames(8);
    // Without a selection a right click does nothing.
    canvas.dispatch(pointer('pointerdown', 640, 360, 2, { timeStamp: 1100 }));
    expect(link.sentBatches).toHaveLength(0);
    win.dispatch(key('keydown', 'KeyA', { ctrlKey: true }));
    expect(client.selection.count).toBe(1000);
    // Selection change ⇒ ctl.watch with the first 64 selected handles.
    const watch = link.sentCtl.filter((m) => m.t === 'watch');
    expect(watch).toHaveLength(1);
    expect(watch[0]!.t === 'watch' && watch[0]!.handles).toEqual(Array.from(client.selection.selected().subarray(0, 64)));
    frames(2);
    const before = renderer.log.length;
    const [cx, cy] = [640, 360];
    canvas.dispatch(pointer('pointerdown', cx, cy, 2, { timeStamp: 1170 }));
    expect(link.sentBatches).toHaveLength(1);
    const env = decodeBatch(link.sentBatches[0]!)[0]!;
    expect(env.op).toBe(Op.Move);
    expect(env.flags).toBe(0);
    expect(env.units).toHaveLength(1000);
    expect(env.seq).toBe(1);
    frame();
    const r1 = renderer.log[before]!;
    expect(r1.markers).toBe(1);
    expect(r1.lines).toBeGreaterThanOrEqual(1);
    expect(client.feedback.optimisticCount).toBe(1);
    // A selection ring for every selected unit drawn as a mesh (icons show the selection with their
    // border) + the optimistic target disc.
    const pr = client.selection.project(client.camera, client.stream.lastAlpha);
    let meshSelected = 0;
    for (let k = 0; k < client.selection.count; k++) if (pr.icon[client.selection.indices[k]!] === 0) meshSelected++;
    expect(client.feedback.ringCount).toBe(meshSelected);
    expect(r1.decals).toBe(meshSelected + 1);
    // Until the tick applies the command, the optimistic line stays.
    let acked = -1;
    for (let i = 0; i < 12; i++) {
      frame();
      if (client.feedback.optimisticCount === 0) {
        acked = i;
        break;
      }
    }
    expect(acked).toBeGreaterThanOrEqual(0);
    expect(client.commands.pendingCount).toBe(0);
    frames(2);
    // Now the routes come from the watch section: 64 watched units. Target discs: one per watched unit
    // drawn as a mesh, one per command for the rest (unwatched or icons – at this zoom the cubes are icons).
    expect(client.feedback.watchedDrawn).toBe(64);
    expect(meshSelected).toBe(0);
    expect(client.feedback.discs).toBe(1);
    expect(renderer.log[renderer.log.length - 1]!.lines).toBeGreaterThanOrEqual(64);
    // Marker expires after its lifetime.
    frames(60);
    expect(renderer.log[renderer.log.length - 1]!.markers).toBe(0);
    // Units approach the picked target (screen centre ≈ camera focus 256, 256).
    const r = client.lastFrame!;
    let moving = 0;
    for (let i = 0; i < r.unitCount; i++) if (r.unitArmy(i) === 0 && r.unitPrev(i, 0) !== r.unitCur(i, 0)) moving++;
    expect(moving).toBeGreaterThan(900);
    const m = client.metrics.snapshot();
    expect(m.clicks).toBe(1);
    expect(m.clickToMarkerFrames.max).toBe(1);
    expect(m.clickToAckMs.count).toBe(1);
    expect(m.clickToAckMs.p50).toBeLessThanOrEqual(120);
    expect(m.clickToMoveMs.count).toBe(1);
    expect(m.clickToMoveMs.p50).toBeLessThanOrEqual(150);
    expect(m.frame.tick).toBe(client.tick);
  });

  it('pause: tick stands, camera pans, commands are accepted and applied after step / resume', () => {
    const { client, win, canvas, link, renderer, frame, frames, clock } = setup();
    frames(20);
    client.selectAll();
    link.sentCtl.length = 0;
    win.dispatch(key('keydown', 'KeyP'));
    expect(link.sentCtl).toEqual([{ t: 'pause' }]);
    frame();
    expect(client.paused).toBe(true);
    const tick = client.tick;
    const cam0 = client.cameraState();
    win.dispatch(key('keydown', 'KeyD', { timeStamp: clock.t }));
    frames(90); // 1.5 s
    win.dispatch(key('keyup', 'KeyD', { timeStamp: clock.t }));
    expect(client.tick).toBe(tick);
    expect(client.cameraState().x).toBeGreaterThan(cam0.x + 10);
    expect(renderer.log[renderer.log.length - 1]!.alpha).toBe(1);
    // Command while paused: sent and marked, not applied.
    canvas.dispatch(pointer('pointerdown', 640, 300, 2, { timeStamp: clock.t }));
    frames(30);
    expect(link.sentBatches).toHaveLength(1);
    expect(client.commands.pendingCount).toBe(1);
    expect(client.feedback.optimisticCount).toBe(1);
    expect(renderer.log[renderer.log.length - 1]!.lines).toBeGreaterThanOrEqual(1);
    // N steps one tick → command applied and acknowledged.
    win.dispatch(key('keydown', 'KeyN'));
    expect(link.sentCtl[link.sentCtl.length - 1]).toEqual({ t: 'step', ticks: 1 });
    frames(2);
    expect(client.tick).toBe(tick + 1);
    expect(client.commands.pendingCount).toBe(0);
    expect(client.feedback.optimisticCount).toBe(0);
    // Resume.
    win.dispatch(key('keydown', 'KeyP'));
    expect(link.sentCtl[link.sentCtl.length - 1]).toEqual({ t: 'resume' });
    frames(30);
    expect(client.paused).toBe(false);
    expect(client.tick).toBeGreaterThan(tick + 3);
  });

  it('N does nothing while running; toggles are based on the requested state while in flight', () => {
    const { client, win, link, frames } = setup();
    frames(5);
    win.dispatch(key('keydown', 'KeyN'));
    expect(link.sentCtl).toEqual([]);
    expect(client.step()).toBe(false);
    client.togglePause();
    client.togglePause(); // before any frame confirmed the pause
    expect(link.sentCtl).toEqual([{ t: 'pause' }, { t: 'resume' }]);
    client.setSpeed(2);
    expect(link.sentCtl[2]).toEqual({ t: 'speed', speed: 2 });
  });

  it('box select highlights the selection; Ctrl+A selects all own units; Esc clears; S stops the selection', () => {
    const { client, canvas, win, renderer, link, frames, clock } = setup();
    frames(3);
    canvas.dispatch(pointer('pointerdown', 500, 250));
    canvas.dispatch(pointer('pointermove', 700, 450));
    canvas.dispatch(pointer('pointerup', 700, 450));
    const n = client.selection.count;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(1000);
    frames(1);
    const hl = renderer.last!.highlight!;
    let lit = 0;
    for (let i = 0; i < 1020; i++) lit += hl[i]!;
    expect(lit).toBe(n);
    win.dispatch(key('keydown', 'KeyS', { timeStamp: clock.t }));
    win.dispatch(key('keyup', 'KeyS', { timeStamp: clock.t + 50 }));
    const stop = decodeBatch(link.sentBatches[link.sentBatches.length - 1]!)[0]!;
    expect(stop.op).toBe(Op.Stop);
    expect(stop.units).toHaveLength(n);
    win.dispatch(key('keydown', 'KeyA', { ctrlKey: true }));
    expect(client.selection.count).toBe(1000);
    win.dispatch(key('keydown', 'Escape'));
    expect(client.selection.count).toBe(0);
  });

  it('wheel zoom and middle-drag pan work regardless of pause', () => {
    const { client, canvas, win, frames } = setup();
    frames(2);
    win.dispatch(key('keydown', 'KeyP'));
    frames(2);
    const d0 = client.cameraState().distance;
    canvas.dispatch({ type: 'wheel', deltaY: -300, deltaMode: 0, clientX: 640, clientY: 360, timeStamp: 0, defaultPrevented: false, target: null, preventDefault() {} });
    expect(client.cameraState().distance).toBeLessThan(d0);
    const x0 = client.cameraState().x;
    canvas.dispatch(pointer('pointerdown', 600, 300, 1));
    canvas.dispatch(pointer('pointermove', 500, 300, 1));
    canvas.dispatch(pointer('pointerup', 500, 300, 1));
    expect(client.cameraState().x).toBeGreaterThan(x0);
  });

  it('dev console API: spawn / kill as commands; console toggle callback; host messages', () => {
    let toggles = 0;
    const host: string[] = [];
    const { client, win, link, frames } = setup({
      callbacks: { onToggleConsole: () => toggles++, onHostMessage: (m) => host.push(m.t) },
    });
    frames(2);
    const seq = client.spawn(0, 16, 1, 300 * RAW_PER_WU, 300 * RAW_PER_WU, 4 * RAW_PER_WU);
    frames(8);
    expect(client.commands.isPending(seq)).toBe(false);
    expect(client.lastFrame!.unitCount).toBe(1036);
    const own = client.ownHandles();
    expect(own).toHaveLength(1000);
    client.kill(own.slice(0, 10));
    frames(8);
    expect(client.ownHandles()).toHaveLength(990);
    win.dispatch(key('keydown', 'F1', { key: 'F1' }));
    expect(toggles).toBe(1);
    link.emitHost({ t: 'status', tick: 1, paused: false, speed: 1, ticksBehind: 0 });
    expect(host).toEqual(['status']);
    expect(client.lastHostMessage?.t).toBe('status');
  });

  it('E2E helpers: unitScreenPos, moveTo, cameraState', () => {
    const { client, link, frames } = setup({ units: 4 });
    frames(2);
    const h = client.ownHandles()[0]!;
    const p = client.unitScreenPos(h);
    expect(p).not.toBeNull();
    expect(Number.isFinite(p!.x) && Number.isFinite(p!.y)).toBe(true);
    expect(client.unitScreenPos(0xdeadbeef)).toBeNull();
    const seq = client.moveTo(300 * RAW_PER_WU, 1e12, [h]);
    const e = decodeBatch(link.sentBatches[0]!)[0]!;
    expect(e.seq).toBe(seq);
    expect(e.units).toEqual([h]);
    expect(new DataView(e.payload.buffer, e.payload.byteOffset).getInt32(8, true)).toBe(512 * RAW_PER_WU);
    expect(client.cameraState()).toMatchObject({ x: 256, z: 256 });
  });

  it('focus rule: typing in a text field does not trigger game actions', () => {
    const focus = { el: null as unknown };
    const { win, link, canvas, frames } = setup({ focus });
    frames(2);
    focus.el = { tagName: 'INPUT', type: 'text' };
    win.dispatch(key('keydown', 'KeyP'));
    canvas.dispatch(pointer('pointerdown', 640, 360, 2));
    expect(link.sentCtl).toHaveLength(0);
    expect(link.sentBatches).toHaveLength(0);
  });

  it('dispose stops the loop and detaches listeners', () => {
    const { client, raf, canvas, win } = setup();
    expect(raf.size).toBe(1);
    client.dispose();
    expect(raf.size).toBe(0);
    expect(canvas.listenerCount()).toBe(0);
    expect(win.listenerCount()).toBe(0);
    expect(() => client.start()).toThrow();
  });

  it('steady-state rAF loop does not allocate objects (1,000 moving cubes, frames at 10 Hz)', () => {
    // Mesh-only cubes (no icons): 1,000 selection rings + 64 watch routes and target discs per rAF.
    const { client, canvas, renderer, frames } = setup({ visuals: [{ spec: { hull: 'box', size: [1, 1, 1] }, iconThreshold: 0 }] });
    renderer.record = false;
    frames(30);
    // All 1,000 selected: selection rings + watch routes of 64 units are rebuilt every rAF.
    client.selectAll();
    // Far target (≈ 400 WU at 0.5 WU/tick): the units drive during the whole measurement.
    client.moveTo(505 * RAW_PER_WU, 505 * RAW_PER_WU);
    void canvas;
    // Warm up until the JIT has optimised the hot path (the interpreter boxes every double).
    frames(3000);
    const gc = (globalThis as { gc?: () => void }).gc;
    gc?.();
    const profiler = new v8.GCProfiler();
    const before = process.memoryUsage().heapUsed;
    profiler.start();
    frames(600); // 10 s at 60 Hz, 100 sim frames with 1,020 records each
    const stats = profiler.stop();
    const allocated = process.memoryUsage().heapUsed - before;
    // Without a GC in between, the heap delta is the allocation volume (client + fake sim + harness).
    // Only engine-internal number boxes remain (~0.1 KB per rAF); a single per-frame array of
    // 1,000 entries would already cost ≥ 8 KB per frame.
    expect(stats.statistics.length).toBe(0);
    expect(allocated / 600).toBeLessThan(256);
    gc?.();
    const retained = process.memoryUsage().heapUsed - before;
    if (gc !== undefined) expect(retained).toBeLessThan(64 * 1024);
    expect(client.tick).toBeGreaterThan(300);
    expect(client.feedback.ringCount).toBe(1000);
    expect(client.feedback.watchedDrawn).toBe(64);
    expect(client.feedback.segments).toBeGreaterThan(64);
    expect(client.feedback.discs).toBeGreaterThanOrEqual(64);
  });
});
