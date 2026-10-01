/**
 * MS3 host features: Watch section (ctl.watch) and path statistics in frames and `stats`, nav
 * precompute timing in `ready`/`status`, `ctl.devReload` with a new sim.bin (compatibility check,
 * blueprint swap, tainted log, new simId, time from ctl to status).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { compileBlueprints, defineUnit } from '@faf/blueprints';
import { decodeSimBin } from '@faf/blueprints/simbin';
import { mapSimHash, createTestPlaneMap } from '@faf/formats';
import { FrameReader, WatchFlags, WatchOrderType } from '@faf/protocol';
import { unitHandles, unitInfo } from '@faf/sim';
import { MarkKind, parseCommandLog, simIdFor, type HostReadyMsg, type HostStatsMsg, type HostStatusMsg } from '../src/index.ts';
import { bufferOf, moveCmd, spawnCmd } from './support/fixtures.ts';
import { makeTestHost, type TestHost } from './support/host.ts';

let open: TestHost[] = [];
function host(...args: Parameters<typeof makeTestHost>): TestHost {
  const h = makeTestHost(...args);
  open.push(h);
  return h;
}
afterEach(() => {
  for (const h of open) h.close();
  open = [];
});

const base = {
  categories: ['LAND', 'MOBILE'],
  sim: {
    health: { max: 100 },
    motion: { layer: 'land' as const, speed: 3, accel: 3, turnRateDeg: 180, sizeClass: 1, footprint: [1, 1] as [number, number], maxSlope: 0.6, radius: 0.3 },
  },
  view: { placeholder: { hull: 'box' as const, size: [0.5, 0.5, 0.5] as [number, number, number] } },
};

/** sim.bin of a small blueprint set (sim ids in id order). */
function simBinOf(units: { id: string; speed?: number }[]): ArrayBuffer {
  const r = compileBlueprints(
    units.map((u, i) => ({
      source: `u${i}.ts`,
      def: defineUnit({ id: u.id, ...base, sim: { ...base.sim, motion: { ...base.sim.motion, speed: u.speed ?? 3 } } }),
    })),
    { includeTest: true },
  );
  const out = new ArrayBuffer(r.simBin.length);
  new Uint8Array(out).set(r.simBin);
  return out;
}

const reader = new FrameReader();

describe('SimHost MS3', () => {
  it('ctl.watch ⇒ Watch section with queued targets and route; path counters in frames and stats', () => {
    const h = host({ autoStart: false });
    h.host.submit(bufferOf([spawnCmd(0, 10, 100, 100, 4, 1), spawnCmd(1, 2, 300, 300, 2, 1)]));
    h.host.runTicks(1);
    const a = unitHandles(h.host.core.world, 0);
    const b = unitHandles(h.host.core.world, 1);
    h.host.submit(bufferOf([moveCmd(0, a, 400, 300, 2), { ...moveCmd(0, a, 100, 400, 3), flags: 1 }]));
    h.host.ctl({ t: 'watch', handles: [a[0]!, a[3]!, b[0]!] });
    h.host.runTicks(5);
    const f = h.consumer.poll()!;
    expect(reader.reset(f)).toBe(true);
    expect(reader.version).toBe(5);
    // Viewer = army 0: own units only.
    expect(reader.watchCount).toBe(2);
    expect(reader.watchHandle(0)).toBe(a[0]);
    expect(reader.watchOrderCount(0)).toBe(2);
    expect(reader.watchTargetType(0, 1)).toBe(WatchOrderType.Move);
    const u = unitInfo(h.host.core.world, a[0]!)!;
    expect([reader.watchTargetX(0, 0), reader.watchTargetZ(0, 0)]).toEqual([u.targetX, u.targetZ]);
    expect(reader.watchFlags(0) & WatchFlags.Group).toBe(WatchFlags.Group);
    expect(reader.requestsIssued).toBe(h.host.core.world.nav.requestsIssued);
    expect(reader.requestsIssued).toBeGreaterThanOrEqual(1);
    h.host.runTicks(10);
    const st = h.of('stats').at(-1) as HostStatsMsg;
    expect(st.path.requestsIssued).toBe(h.host.core.world.nav.requestsIssued);
    expect(st.path).toMatchObject({ pending: 0, repathsTriggered: 0, stuckGiveUps: 0 });
    // The observer sees every watched unit.
    h.host.ctl({ t: 'viewer', army: -1 });
    h.host.runTicks(1);
    expect(reader.reset(h.consumer.poll()!)).toBe(true);
    expect(reader.watchCount).toBe(3);
  });

  it('ready/status report the nav precompute; devReload swaps a compatible sim.bin (tainted, new simId)', () => {
    const v1 = simBinOf([{ id: 'core:cube' }, { id: 'test:fast', speed: 5 }]);
    const h = host({ autoStart: false, simBin: v1 });
    const ready = h.of('ready')[0] as HostReadyMsg;
    // Measured with the host clock (a fake clock here: 0); the real value is in the bench/HUD.
    expect(ready.navStaticMs).toBeGreaterThanOrEqual(0);
    expect(ready.navDerivedMs).toBeGreaterThanOrEqual(0);
    expect((h.of('status').at(-1) as HostStatusMsg).navPrecomputeMs).toBe(ready.navStaticMs + ready.navDerivedMs);
    const plane = mapSimHash(createTestPlaneMap(512)) >>> 0;
    const t1 = decodeSimBin(new Uint8Array(v1));
    expect(ready.simId).toBe(simIdFor(t1.simHash, plane));
    h.host.submit(bufferOf([spawnCmd(0, 1, 100, 100, 0, 1, 0, 0)]));
    h.host.runTicks(1);
    const [cube] = unitHandles(h.host.core.world, 0);
    h.host.submit(bufferOf([moveCmd(0, [cube!], 300, 100, 2)]));
    h.host.runTicks(20);
    const x20 = unitInfo(h.host.core.world, cube!)!.x;
    h.host.runTicks(20);
    const x40 = unitInfo(h.host.core.world, cube!)!.x;

    // Compatible: same ids in the same order, one appended, a faster cube.
    const v2 = simBinOf([{ id: 'core:cube', speed: 9 }, { id: 'test:fast', speed: 5 }, { id: 'test:new' }]);
    const t2 = decodeSimBin(new Uint8Array(v2));
    const n = h.msgs.length;
    const w0 = performance.now();
    h.host.handleMessage({ t: 'devReload', simBin: v2 });
    const wallMs = performance.now() - w0;
    const st = h.msgs.slice(n).find((m) => m.t === 'status') as HostStatusMsg | undefined;
    expect(st).toBeDefined();
    expect(h.msgs.slice(n).some((m) => m.t === 'error')).toBe(false);
    console.log(`[devReload] ctl → status ${wallMs.toFixed(2)} ms (host, synchronous; lokal gemessen)`);
    expect(st).toMatchObject({ tainted: true, simHash: t2.simHash >>> 0, simId: simIdFor(t2.simHash, plane), devReloads: 1 });
    expect(st!.simId).not.toBe(ready.simId);
    expect(h.host.core.world.bp.count).toBe(3);
    expect(parseCommandLog(h.host.core.recorder!.bytes).marks.some((m) => m.kind === MarkKind.DevReload)).toBe(true);
    // The new speed applies from the next tick on: the cube now covers more ground per tick.
    h.host.runTicks(20);
    const x60 = unitInfo(h.host.core.world, cube!)!.x;
    expect(x60 - x40).toBeGreaterThan(2 * (x40 - x20));
    // New blueprints can be spawned.
    h.host.submit(bufferOf([spawnCmd(0, 1, 50, 50, 0, 3, 0, 2)])); // test:new (sim id 2)
    h.host.runTicks(1);
    expect(unitHandles(h.host.core.world, 0).length).toBe(2);
    // Snapshots carry the new identity.
    const snap = h.host.core.snapshot();
    expect(new DataView(snap.buffer, snap.byteOffset).getUint32(4, true)).toBe(st!.simId);
  });

  it('devReload rejects an incompatible table with a message and changes nothing', () => {
    const v1 = simBinOf([{ id: 'core:cube' }, { id: 'test:fast', speed: 5 }]);
    const h = host({ autoStart: false, simBin: v1 });
    const before = (h.of('status').at(-1) as HostStatusMsg).simId;
    // An id inserted before the existing ones shifts their sim ids.
    const bad = simBinOf([{ id: 'core:aaa' }, { id: 'core:cube' }, { id: 'test:fast' }]);
    const n = h.msgs.length;
    h.host.handleMessage({ t: 'devReload', simBin: bad });
    const err = h.msgs.slice(n).find((m) => m.t === 'error') as { message: string } | undefined;
    expect(err?.message).toMatch(/devReload rejected: sim id 0 is 'core:aaa'/);
    // A removed id as well.
    h.host.handleMessage({ t: 'devReload', simBin: simBinOf([{ id: 'core:cube' }]) });
    expect((h.msgs.at(-1) as { message: string }).message).toMatch(/may only be appended/);
    // Garbage is rejected by the decoder.
    h.host.handleMessage({ t: 'devReload', simBin: new ArrayBuffer(64) });
    expect(h.msgs.at(-1)!.t).toBe('error');
    expect(h.host.core.simId).toBe(before);
    expect(h.host.core.world.bp.count).toBe(2);
    expect(h.host.core.recorder!.tainted).toBe(false);
  });
});
