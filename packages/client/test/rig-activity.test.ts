import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseViewJson } from '@faf/blueprints/view';
import { FlowFlags, FrameFlags, FrameReader, FrameSection, FrameWriter, UnitFlags } from '@faf/protocol';
import { describe, expect, it } from 'vitest';
import { parseGlb, type ModelPartInfo } from '../src/assets/glb.ts';
import { RigPoseAdapter } from '../src/rig-pose.ts';
import { GameClient } from '../src/client.ts';
import { combatRig, visualTableFromView, type RigVisualEntry } from '../src/visuals.ts';
import { FakeSimLink } from './support/fake-sim-link.ts';
import { FakeCanvas, FakeRenderer, FakeTarget } from './support/fakes.ts';
import { REPO_ROOT } from './support/map.ts';

const handle = 0x100001, target = 0x100002;
function visual(id: string, name: string, anim: string): RigVisualEntry {
  const parts: readonly ModelPartInfo[] = [
    { name: 'hull', parent: 0, pivot: [0, 0, 0], anim: 'none' },
    { name, parent: 0, pivot: [0, 1, 0], anim },
  ];
  return { spec: { hull: 'box', size: [1, 1, 1] }, modelParts: parts, rig: combatRig(id, parts) };
}
const factory = visual('core:fac_land_t1', 'gate', 'pitch');
const mex = visual('core:str_t1_mex', 'pump', 'pitch');
const radar = visual('core:str_t1_radar', 'wing', 'yaw');
type Observation = {
  flags?: number; build?: number; paused?: boolean; viewer?: number; army?: number; handle?: number;
  flow?: boolean; flowTick?: number; flowFlags?: number; spent?: number; producing?: boolean;
  targetSpent?: number; targetFlags?: number; targetHandle?: number; flowHandle?: number;
};
function frame(tick: number, o: Observation = {}): FrameReader {
  const writer = new FrameWriter({ units: 2, parts: 0, projectiles: 0, beams: 0, events: 0, debugBytes: 0, flow: 2 });
  const bytes = new Uint8Array(writer.capacityBytes);
  writer.beginFrame(bytes, tick, tick, 0, 1000, o.viewer ?? 0, o.paused ? FrameFlags.Paused : 0, 0, 0, 0);
  writer.writeUnit(0, 0, 0, 0, 0, 0, 0, 0, 0, o.army ?? 0, 255, o.build ?? 255, 0,
    UnitFlags.Building | (o.flags ?? 0), o.handle ?? handle, 0, 0);
  if (o.flow !== false) {
    writer.setFlowTick(o.flowTick ?? tick);
    writer.writeFlow(o.flowHandle ?? o.handle ?? handle, 0, o.army ?? 0,
      o.flowFlags ?? (FlowFlags.Enabled | FlowFlags.Billed | (o.producing ? FlowFlags.Contributing : 0)), 1,
      o.producing ? o.targetHandle ?? target : 0xffffffff, 0, 20, 0, o.spent ?? (o.producing ? 0 : 20), 0, 100);
    if (o.producing) writer.writeFlow(target, 1, o.army ?? 0, o.targetFlags ?? (FlowFlags.Enabled | FlowFlags.Billed | FlowFlags.BuildSite),
      1, 0xffffffff, 30, 60, o.targetSpent ?? 30, o.targetSpent ?? 60, 65536, 0);
  }
  const reader = new FrameReader();
  expect(reader.reset(bytes.slice(0, writer.endFrame()))).toBe(true);
  return reader;
}
function update(a: RigPoseAdapter, f: FrameReader, v: RigVisualEntry) {
  a.update(f, f.section(FrameSection.Units), f.section(FrameSection.Parts), [v]);
  return a.inspect(f, f.unitHandle(0), .5)!.parts[0]!;
}

describe('accepted-frame structure activity', () => {
  it('binds only the intended authored parts and animation axes for both playable factory and mex tiers', () => {
    for (const id of ['core:fac_land_t1', 'core:fac_land_t2']) {
      expect(visual(id, 'gate', 'pitch').rig![1]).toMatchObject({ activity: 'factory-gate', mount: -1 });
    }
    expect(mex.rig![1]).toMatchObject({ activity: 'mex-pump' });
    expect(visual('core:str_t2_mex', 'pump', 'pitch').rig![1]).toMatchObject({ activity: 'mex-pump' });
    expect(radar.rig![1]).toMatchObject({ activity: 'radar-spin' });
    expect(visual('core:str_t1_mex', 'pump', 'yaw').rig![1]).toBeUndefined();
    expect(visual('core:unrelated', 'gate', 'pitch').rig![1]).toBeUndefined();
  });

  it('loads all six playable GLB hierarchies with working-part bindings and preserves their authored mesh pivots', () => {
    const view = parseViewJson(readFileSync(join(REPO_ROOT, 'content/generated/view.json'), 'utf8'));
    const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'content/generated/assets/manifest.json'), 'utf8')) as { assets: Record<string, { fallback: { url: string } }> };
    const ids = ['core:fac_land_t1', 'core:fac_land_t2', 'core:str_t1_mex', 'core:str_t2_mex', 'core:str_t1_radar', 'core:str_t1_pd'];
    const models = new Map();
    for (const id of ids) {
      const entry = view.visuals.find(v => v.id === id)!;
      models.set(entry.mesh!, parseGlb(new Uint8Array(readFileSync(join(REPO_ROOT, 'content/generated/assets', manifest.assets[entry.mesh!]!.fallback.url))), null));
    }
    const visuals = visualTableFromView(view, models);
    for (const id of ids) {
      const v = visuals[view.visuals.findIndex(v => v.id === id)] as RigVisualEntry;
      const p = v.modelParts!;
      expect(Array.from(v.meshes![0]!.partParents!)).toEqual(p.map(x => x.parent));
      expect(Array.from(v.meshes![0]!.partPivots!)).toEqual(p.flatMap(x => x.pivot.map(Math.fround)));
      if (id === 'core:str_t1_pd') {
        expect(v.rig![p.findIndex(x => x.name === 'turret')]).toMatchObject({ mount: 0, yaw: true });
        expect(v.rig![p.findIndex(x => x.name === 'barrel')]).toMatchObject({ mount: 0, pitch: true });
      } else {
        const name = id.startsWith('core:fac_land') ? 'gate' : id.endsWith('mex') ? 'pump' : 'wing';
        expect(v.rig![p.findIndex(x => x.name === name)]?.activity).toBe(
          name === 'gate' ? 'factory-gate' : name === 'pump' ? 'mex-pump' : 'radar-spin');
      }
    }
  });

  it('opens the gate using the contributing builder link and actual target spending, then closes at idle', () => {
    const a = new RigPoseAdapter();
    const first = frame(1, { producing: true });
    expect(first.flowEffectivePower(0)).toBe(0);
    expect(update(a, first, factory)).toMatchObject({ prevPitch: 1365, curPitch: 1365 });
    expect(update(a, frame(2, { producing: true }), factory)).toMatchObject({ prevPitch: 1365, curPitch: 2730 });
    expect(update(a, frame(3, { flags: UnitFlags.Idle, flow: false }), factory)).toMatchObject({ prevPitch: 2730, curPitch: 1365 });
    expect(update(a, frame(4, { flags: UnitFlags.Idle }), factory)).toMatchObject({ curPitch: 0 });
  });

  it.each([
    { producing: true, targetSpent: 0 },
    { producing: true, targetFlags: FlowFlags.Enabled | FlowFlags.Paused | FlowFlags.BuildSite },
    { producing: true, targetHandle: target + 0x100000 },
    { producing: true, flowFlags: FlowFlags.Enabled | FlowFlags.Billed },
    { producing: true, flags: UnitFlags.Idle },
  ])('does not invent production from queued or unfunded work: %j', observation => {
    const a = new RigPoseAdapter();
    expect(update(a, frame(1, observation), factory).curPitch).toBe(0);
    expect(update(a, frame(2, observation), factory).curPitch).toBe(0);
  });

  it.each([mex, radar])('advances passive operation despite order-idle, only when accepted upkeep was spent', v => {
    const a = new RigPoseAdapter();
    const first = update(a, frame(1, { flags: UnitFlags.Idle }), v);
    const second = update(a, frame(2, { flags: UnitFlags.Idle }), v);
    if (v === mex) {
      expect(first.curPitch).toBeGreaterThan(0);
      expect(second.prevPitch).toBe(first.curPitch);
      expect(second.curPitch).toBeGreaterThan(first.curPitch);
      expect(second.curYaw).toBe(0);
    } else {
      expect(first.curYaw).toBe(1092);
      expect(second).toMatchObject({ prevYaw: 1092, curYaw: 2184, curPitch: 0 });
    }
    const unbilled = update(a, frame(3, { flags: UnitFlags.Idle, spent: 0 }), v);
    expect(unbilled.curYaw).toBe(second.curYaw);
    expect(unbilled.curPitch).toBe(second.curPitch);
  });

  it.each([mex, visual('core:str_t2_mex', 'pump', 'pitch')])('keeps the full pump cycle within the authored five-degree stroke and holds its peak on pause/stall', v => {
    const a = new RigPoseAdapter(), pitches = [];
    for (let tick = 1; tick <= 24; tick++) pitches.push(update(a, frame(tick, { flags: UnitFlags.Idle }), v).curPitch);
    expect(Math.max(...pitches)).toBe(910); expect(Math.min(...pitches)).toBe(-910);
    for (let tick = 25; tick <= 30; tick++) update(a, frame(tick, { flags: UnitFlags.Idle }), v);
    expect(update(a, frame(31, { flags: UnitFlags.Paused }), v)).toMatchObject({ prevPitch: 910, curPitch: 910 });
    expect(update(a, frame(32, { flags: UnitFlags.Stalled }), v)).toMatchObject({ prevPitch: 910, curPitch: 910 });
  });

  it.each([factory, mex, radar])('holds during unit pause, stall and repeated paused ticks; resumes without wall-clock catch-up', v => {
    const a = new RigPoseAdapter();
    const active = { producing: v === factory };
    update(a, frame(1, active), v);
    const pose = update(a, frame(2, active), v);
    for (const [tick, observation] of [
      [2, { ...active, paused: true }],
      [3, { ...active, flags: UnitFlags.Paused }],
      [4, { ...active, flags: UnitFlags.Stalled }],
      [4, { ...active, paused: true }],
    ] as const) {
      const held = update(a, frame(tick, observation), v);
      expect(held).toMatchObject({ prevYaw: pose.curYaw, curYaw: pose.curYaw, prevPitch: pose.curPitch, curPitch: pose.curPitch });
    }
    const resumed = update(a, frame(5, active), v);
    expect(resumed.prevYaw).toBe(pose.curYaw); expect(resumed.prevPitch).toBe(pose.curPitch);
    expect(resumed.curYaw !== pose.curYaw || resumed.curPitch !== pose.curPitch).toBe(true);
  });

  it.each([factory, mex, radar])('animates explicit accepted steps while the host remains paused, and holds repeated paused ticks', v => {
    const stepped = new RigPoseAdapter(), running = new RigPoseAdapter();
    const active = { producing: v === factory };
    const firstFrame = frame(1, { ...active, paused: true });
    expect(firstFrame.paused).toBe(true);
    const first = update(stepped, firstFrame, v);
    expect(first).toEqual(update(running, frame(1, active), v));
    const next = frame(2, { ...active, paused: true });
    const second = update(stepped, next, v);
    expect(second).toEqual(update(running, frame(2, active), v));
    expect(second.curYaw !== first.curYaw || second.curPitch !== first.curPitch).toBe(true);
    expect(update(stepped, next, v)).toMatchObject({ prevYaw: second.curYaw, curYaw: second.curYaw,
      prevPitch: second.curPitch, curPitch: second.curPitch });
    expect(update(stepped, frame(3, { ...active, paused: true }), v)).toEqual(update(running, frame(3, active), v));
  });

  it.each([factory, mex, radar])('keeps incomplete, paused, stalled and unobserved structures static on first sight', v => {
    for (const observation of [
      { build: 254 }, { flags: UnitFlags.Paused }, { flags: UnitFlags.Stalled },
      { flow: false }, { flowTick: -1 }, { flowTick: 0 }, { viewer: 1 },
      { flowFlags: FlowFlags.Billed }, { flowFlags: FlowFlags.Enabled | FlowFlags.Paused | FlowFlags.Billed },
      { flowFlags: FlowFlags.Enabled | FlowFlags.BuildSite | FlowFlags.Billed },
      { flowHandle: handle + 0x100000 }, { flags: UnitFlags.Wreck }, { flags: UnitFlags.Ghost }, { flags: UnitFlags.Blip },
    ]) {
      const a = new RigPoseAdapter();
      const p = update(a, frame(1, { producing: v === factory, ...observation }), v);
      expect(p).toMatchObject({ prevYaw: 0, curYaw: 0, prevPitch: 0, curPitch: 0 });
    }
  });

  it.each([factory, mex, radar])('clears activity history across handle replacement, viewer switch, skip, rewind, NoInterp and reload', v => {
    for (const reason of ['handle', 'viewer', 'skip', 'rewind', 'NoInterp', 'reload']) {
      const a = new RigPoseAdapter(), active = { producing: v === factory };
      update(a, frame(10, active), v); update(a, frame(11, active), v);
      if (reason === 'reload') a.reset();
      const f = frame(reason === 'skip' ? 14 : reason === 'rewind' ? 1 : 12,
        { ...active, ...(reason === 'handle' ? { handle: handle + 0x100000 } : {}),
          ...(reason === 'viewer' ? { viewer: 1, army: 1 } : {}), ...(reason === 'NoInterp' ? { flags: UnitFlags.NoInterp } : {}) });
      const p = update(a, f, v);
      expect(p.prevYaw).toBe(p.curYaw); expect(p.prevPitch).toBe(p.curPitch);
      const fresh = update(new RigPoseAdapter(), f, v);
      expect(p).toEqual(fresh);
    }
  });

  it('never changes the accepted frame bytes and submits structure poses through reusable buffers without mount channels', () => {
    const a = new RigPoseAdapter(), f = frame(1, { producing: true });
    const units = f.section(FrameSection.Units).slice(), parts = f.section(FrameSection.Parts).slice();
    const whole = new Uint8Array(f.section(FrameSection.Units).buffer).slice();
    const buffers = [a.unitBuffer, a.partBuffer];
    update(a, f, factory);
    expect(f.unitPartCount(0)).toBe(0); expect(f.unitMountAimMask(0)).toBe(0);
    expect(a.partCount).toBe(1); expect(a.stats.animatedUnits).toBe(1);
    expect(f.section(FrameSection.Units)).toEqual(units); expect(f.section(FrameSection.Parts)).toEqual(parts);
    expect(new Uint8Array(f.section(FrameSection.Units).buffer)).toEqual(whole);
    update(a, frame(2, { producing: true }), factory);
    expect(a.unitBuffer).toBe(buffers[0]); expect(a.partBuffer).toBe(buffers[1]);
    const bounded = new RigPoseAdapter(0);
    bounded.update(f, f.section(FrameSection.Units), f.section(FrameSection.Parts), [factory]);
    expect(bounded.partCount).toBe(0); expect(bounded.stats.overflowUnits).toBe(1);
  });

  it('submits private-safe structure poses through the live GameClient path and holds between accepted frames', () => {
    const link = new FakeSimLink({ units: 0 }), renderer = new FakeRenderer();
    const client = new GameClient({ canvas: new FakeCanvas(), keyTarget: new FakeTarget(), renderer, link,
      visuals: [radar], playerArmy: 0, focusProbe: () => null, now: () => 1000 });
    try {
      const f = frame(1, { flags: UnitFlags.Idle });
      const bytes = new Uint8Array(f.section(FrameSection.Units).buffer);
      link.frames.deliver(bytes, 1, bytes.length);
      client.frame(1000);
      expect(client.lastFrame!.unitPartCount(0)).toBe(0);
      expect(renderer.last!.parts!.count).toBe(1);
      expect(client.rigPose(handle)!.parts[0]!.curYaw).toBe(1092);
      const version = renderer.last!.parts!.version;
      client.frame(9000);
      expect(renderer.last!.parts!.version).toBe(version);
      expect(client.rigPose(handle)!.parts[0]!.curYaw).toBe(1092);
      const next = frame(2, { flags: UnitFlags.Idle });
      const nextBytes = new Uint8Array(next.section(FrameSection.Units).buffer);
      link.frames.deliver(nextBytes, 2, nextBytes.length);
      client.frame(9016);
      expect(client.rigPose(handle)!.parts[0]).toMatchObject({ prevYaw: 1092, curYaw: 2184 });
      expect(renderer.last!.parts!.version).toBeGreaterThan(version!);
    } finally { client.dispose(); }
  });
});
