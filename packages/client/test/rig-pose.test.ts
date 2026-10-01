import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseViewJson } from '@faf/blueprints/view';
import { FrameReader, FrameSection, FrameWriter, UnitFlags } from '@faf/protocol';
import { describe, expect, it } from 'vitest';
import { parseGlb, type ModelPartInfo } from '../src/assets/glb.ts';
import { GameClient } from '../src/client.ts';
import { FakeSimLink } from './support/fake-sim-link.ts';
import { FakeCanvas, FakeRenderer, FakeTarget } from './support/fakes.ts';
import { RigPoseAdapter } from '../src/rig-pose.ts';
import { combatRig, visualTableFromView, type RigVisualEntry } from '../src/visuals.ts';
import { REPO_ROOT } from './support/map.ts';

const writer = new FrameWriter({ units: 8, parts: 32, projectiles: 0, beams: 0, events: 0, debugBytes: 0 });
const buffer = new Uint8Array(writer.capacityBytes);
const handle = 0x100001;
const tankParts: readonly ModelPartInfo[] = [
  { name: 'hull', parent: 0, pivot: [0, 0, 0], anim: 'none' },
  { name: 'turret', parent: 0, pivot: [0, 1, 0], anim: 'yaw' },
  { name: 'barrel', parent: 1, pivot: [0.2, 1.2, 0], anim: 'pitch' },
];
const tank: RigVisualEntry = { spec: { hull: 'box', size: [1, 1, 1] }, modelParts: tankParts, rig: combatRig('core:lnd_t1_tank', tankParts) };
function frame(tick: number, yaw = 16384, pitch = 1000, opts: { viewer?: number; flags?: number; mask?: number; prevBody?: number; body?: number; secondYaw?: number; handle?: number; legacy?: boolean; prevX?: number; prevZ?: number; x?: number; z?: number } = {}): FrameReader {
  writer.beginFrame(buffer, tick, tick, 0, 1000, opts.viewer ?? 0, 0, 0, 0, 0);
  writer.writePart(yaw, yaw, pitch, pitch);
  if (opts.secondYaw !== undefined) writer.writePart(opts.secondYaw, opts.secondYaw, -pitch, -pitch);
  writer.writeUnit(opts.prevX ?? 10, 20, opts.prevZ ?? 30, opts.x ?? 40, 50, opts.z ?? 60, opts.prevBody ?? 0, opts.body ?? 0, 0, 0, 255, 255, 0,
    (opts.legacy ? 0 : UnitFlags.MountAimParts) | (opts.flags ?? 0), opts.handle ?? handle, 0, opts.secondYaw === undefined ? 1 : 2, opts.mask ?? 3);
  const r = new FrameReader(); expect(r.reset(buffer.slice(0, writer.endFrame()))).toBe(true); return r;
}
function update(a: RigPoseAdapter, f: FrameReader, visual = tank): void {
  a.update(f, f.section(FrameSection.Units), f.section(FrameSection.Parts), [visual]);
}
function angles(a: RigPoseAdapter, f: FrameReader) { return a.inspect(f, f.unitHandle(0), 0.5)!.parts; }

describe('render-only articulated poses', () => {
  it('keeps unit/body bytes intact and applies yaw once at the turret, pitch once at the child barrel', () => {
    const f = frame(1), before = f.section(FrameSection.Units).slice(), a = new RigPoseAdapter();
    update(a, f);
    expect(f.section(FrameSection.Units)).toEqual(before);
    expect(a.units.slice(0, 34)).toEqual(before.slice(0, 34));
    expect(angles(a, f)).toEqual([
      { id: 1, prevYaw: 16384, curYaw: 16384, prevPitch: 0, curPitch: 0 },
      { id: 2, prevYaw: 0, curYaw: 0, prevPitch: 1000, curPitch: 1000 },
    ]);
    expect(tank.modelParts![2]!.parent).toBe(1);
    expect(a.stats.observedMounts).toBe(1);
  });

  it('interpolates previous observed world aim relative to the corresponding moving-body endpoints', () => {
    const a = new RigPoseAdapter(); update(a, frame(1, 16000, 1000, { body: 1000 }));
    const f = frame(2, 17000, 2000, { prevBody: 1000, body: 3000 }); update(a, f);
    expect(angles(a, f)[0]).toMatchObject({ prevYaw: 15000, curYaw: 14000 });
    expect(angles(a, f)[1]).toMatchObject({ prevPitch: 1000, curPitch: 2000 });
    expect(a.inspect(f, handle, 0.5)).toMatchObject({ bodyPrevYaw: 1000, bodyCurYaw: 3000, observationMask: 1 });
  });

  it.each(['viewer', 'rewind', 'skip', 'NoInterp', 'handle', 'lost', 'reload'] as const)('clears stale aim history after %s', reason => {
    const a = new RigPoseAdapter(); update(a, frame(10, 16000, 1000));
    if (reason === 'lost') update(a, frame(11, 16000, 1000, { mask: 0 }));
    if (reason === 'reload') a.reset();
    const f = frame(reason === 'rewind' ? 4 : reason === 'skip' ? 15 : reason === 'lost' ? 12 : 11, 20000, 3000,
      { ...(reason === 'viewer' ? { viewer: 1 } : {}), ...(reason === 'NoInterp' ? { flags: UnitFlags.NoInterp } : {}), ...(reason === 'handle' ? { handle: handle + 0x100000 } : {}) });
    update(a, f);
    expect(angles(a, f)[0]).toMatchObject({ prevYaw: 20000, curYaw: 20000 });
    expect(angles(a, f)[1]).toMatchObject({ prevPitch: 3000, curPitch: 3000 });
  });

  it('clears a lost target immediately and preserves unflagged legacy part streams', () => {
    const a = new RigPoseAdapter(); update(a, frame(1));
    let f = frame(2, 16000, 1000, { mask: 0 }); update(a, f);
    expect(angles(a, f).every(p => p.prevYaw === 0 && p.curYaw === 0 && p.prevPitch === 0 && p.curPitch === 0)).toBe(true);
    f = frame(3, 12000, -500, { legacy: true }); update(a, f);
    expect(a.units).toEqual(f.section(FrameSection.Units)); expect(a.parts).toEqual(f.section(FrameSection.Parts));
    expect(angles(a, f)).toHaveLength(1);
  });

  it('repackages mixed legacy streams after expanded rigs and preserves legacy diagnostics on capacity fallback', () => {
    writer.beginFrame(buffer, 1, 1, 0, 1000, 0, 0, 0, 0, 0);
    writer.writePart(10000, 10000, 100, 100);
    writer.writePart(123, 456, -100, 200);
    writer.writeUnit(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 0, UnitFlags.MountAimParts, handle, 0, 1, 1);
    writer.writeUnit(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 0, 0, 42, 1, 1);
    const f = new FrameReader(); expect(f.reset(buffer.slice(0, writer.endFrame()))).toBe(true);
    const a = new RigPoseAdapter(); update(a, f);
    expect(a.inspect(f, 42, 0.5)!.parts).toEqual([{ id: 1, prevYaw: 123, curYaw: 456, prevPitch: -100, curPitch: 200 }]);
    expect(a.partCount).toBe(3);
    const bounded = new RigPoseAdapter(1); update(bounded, f);
    expect(bounded.inspect(f, handle, 0.5)!.parts).toEqual([]);
    expect(bounded.inspect(f, 42, 0.5)!.parts).toEqual(a.inspect(f, 42, 0.5)!.parts);
    expect(bounded.stats.overflowUnits).toBe(1);
  });

  it('reuses buffers, advances content version, and falls back to a rigid unit when pose capacity is full', () => {
    const a = new RigPoseAdapter(1), f = frame(1), units = a.unitBuffer, parts = a.partBuffer;
    update(a, f); expect(angles(a, f)).toHaveLength(0); expect(a.stats.overflowUnits).toBe(1);
    const version = a.version; update(a, frame(2));
    expect(a.unitBuffer).toBe(units); expect(a.partBuffer).toBe(parts); expect(a.version).toBeGreaterThan(version);
  });

  it('submits expanded poses through GameClient and forces a fresh GPU content version after model reload', () => {
    const link = new FakeSimLink({ units: 0 }), renderer = new FakeRenderer();
    const client = new GameClient({ canvas: new FakeCanvas(), keyTarget: new FakeTarget(), renderer, link,
      visuals: [tank], playerArmy: 0, focusProbe: () => null, now: () => 1000 });
    const f = frame(1);
    // The helper's packed bytes remain in the writer buffer.
    const bytes = buffer.slice(0, f.debugOffset + f.debugBytes);
    expect(f.unitMountAimMask(0)).toBe(1);
    link.frames.deliver(bytes, 1, bytes.length);
    client.frame(1000);
    expect(renderer.last!.parts!.count).toBe(2);
    expect(client.rigPose(handle)!.parts[0]!.curYaw).toBe(16384);
    expect(client.lastFrame!.unitPartCount(0)).toBe(1);
    const version = renderer.last!.parts!.version;
    client.setVisuals([tank]); client.frame(1016);
    expect(renderer.last!.parts!.version).toBeGreaterThan(version!);
    expect(client.rigPoseStats.animatedUnits).toBe(1);
    client.dispose();
  });

  it('maps the actual complete GLB models, preserving all parents and transformed pivots', () => {
    const view = parseViewJson(readFileSync(join(REPO_ROOT, 'content/generated/view.json'), 'utf8'));
    const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'content/generated/assets/manifest.json'), 'utf8')) as { assets: Record<string, { fallback: { url: string } }> };
    const models = new Map();
    for (const id of ['core:lnd_t1_tank', 'core:lnd_t1_arty', 'core:cmd_commander', 'core:lnd_t3_heavy']) {
      const entry = view.visuals.find(v => v.id === id)!;
      const model = parseGlb(new Uint8Array(readFileSync(join(REPO_ROOT, 'content/generated/assets', manifest.assets[entry.mesh!]!.fallback.url))), null);
      models.set(entry.mesh!, model);
    }
    const visuals = visualTableFromView(view, models);
    const find = (id: string) => visuals[view.visuals.findIndex(v => v.id === id)] as RigVisualEntry;
    const cmd = find('core:cmd_commander'), heavy = find('core:lnd_t3_heavy'), arty = find('core:lnd_t1_arty');
    expect(find('core:fac_land_t1').factory).toBe(true);
    expect(cmd.factory).toBe(false); expect(heavy.factory).toBe(false);
    expect(cmd.rig![1]).toMatchObject({ gait: 1 }); expect(cmd.rig![2]).toMatchObject({ gait: -1 }); expect(cmd.rig![5]).toBeUndefined();
    expect(cmd.rig![3]).toEqual({ mount: 0, yaw: true, pitch: false });
    expect(cmd.rig![4]).toEqual({ mount: 0, yaw: false, pitch: true });
    expect(heavy.rig![3]!.mount).toBe(0); expect(heavy.rig![4]!.mount).toBe(1);
    expect(arty.rig![1]!.yaw).toBe(true); expect(arty.rig![2]!.pitch).toBe(true);
    for (const visual of [cmd, heavy, arty]) {
      const p = visual.modelParts!;
      expect(Array.from(visual.meshes![0]!.partParents!)).toEqual(p.map(x => x.parent));
      expect(Array.from(visual.meshes![0]!.partPivots!)).toEqual(p.flatMap(x => x.pivot.map(Math.fround)));
    }
    const a = new RigPoseAdapter(), f = frame(1, 12000, 2000, { secondYaw: 30000 }); update(a, f, heavy);
    const pose = angles(a, f);
    expect(pose[0]!.curYaw).toBe(0); expect(pose[1]!.curYaw).toBe(0);
    expect(pose[2]).toMatchObject({ curYaw: 12000, curPitch: 2000 });
    expect(pose[3]).toMatchObject({ curYaw: 30000, curPitch: -2000 });
  });
});

const commanderParts: readonly ModelPartInfo[] = [tankParts[0]!,
  { name: 'legs_l', parent: 0, pivot: [.5, 1, 0], anim: 'legs' },
  { name: 'legs_r', parent: 0, pivot: [-.5, 1, 0], anim: 'legs' },
  { name: 'torso', parent: 0, pivot: [0, 1.5, 0], anim: 'yaw' },
  { name: 'barrel', parent: 3, pivot: [-.7, 2, 0], anim: 'pitch' },
];
const commander: RigVisualEntry = { spec: { hull: 'box', size: [2, 3, 2] }, modelParts: commanderParts,
  rig: combatRig('core:cmd_commander', commanderParts) };
function walkingFrame(tick: number, prevX: number, x: number, opts: Parameters<typeof frame>[3] = {}) {
  return frame(tick, 12000, 2000, { prevX, x, prevZ: 0, z: 0, ...opts });
}

describe('ACU accepted-movement gait', () => {
  it('swings the authored hip pivots in opposition while keeping independent torso and barrel aim', () => {
    const a = new RigPoseAdapter(), f = walkingFrame(1, 0, 2048);
    const original = f.section(FrameSection.Units).slice(), sourceParts = f.section(FrameSection.Parts).slice();
    update(a, f, commander);
    const p = angles(a, f);
    expect(p[0]).toMatchObject({ prevPitch: 0, curPitch: 3089 });
    expect(p[1]).toMatchObject({ prevPitch: 0, curPitch: -3089 });
    expect(p[2]).toMatchObject({ curYaw: 12000, curPitch: 0 });
    expect(p[3]).toMatchObject({ curYaw: 0, curPitch: 2000 });
    expect(a.stats.walkingUnits).toBe(1);
    expect(f.section(FrameSection.Units)).toEqual(original);
    expect(f.section(FrameSection.Parts)).toEqual(sourceParts);
    const next = walkingFrame(2, 2048, 4096); update(a, next, commander);
    expect(angles(a, next)[0]).toMatchObject({ prevPitch: 3089, curPitch: 4369 });
  });

  it('returns to rest when stationary and freezes the submitted pose between accepted frames', () => {
    const a = new RigPoseAdapter(); update(a, walkingFrame(1, 0, 2048), commander);
    const stopped = walkingFrame(2, 2048, 2048, { mask: 0 }); update(a, stopped, commander);
    expect(angles(a, stopped)[0]).toMatchObject({ prevPitch: 3089, curPitch: 0 });
    expect(a.stats.walkingUnits).toBe(0);
    const bytes = a.partBuffer.slice(), version = a.version;
    expect(a.inspect(stopped, handle, 0.5)!.parts[0]!.curPitch).toBe(0);
    expect(a.partBuffer).toEqual(bytes); expect(a.version).toBe(version);
    const still = walkingFrame(3, 2048, 2048); update(a, still, commander);
    expect(angles(a, still)[0]).toMatchObject({ prevPitch: 0, curPitch: 0 });
  });

  it.each(['viewer', 'rewind', 'skip', 'handle', 'NoInterp', 'reload'] as const)('does not retain a stale leg phase across %s', reason => {
    const a = new RigPoseAdapter(); update(a, walkingFrame(10, 0, 4096), commander);
    if (reason === 'reload') a.reset();
    const f = walkingFrame(reason === 'rewind' ? 3 : reason === 'skip' ? 14 : 11, 4096, 6144,
      { ...(reason === 'viewer' ? { viewer: 1 } : {}), ...(reason === 'handle' ? { handle: handle + 0x100000 } : {}),
        ...(reason === 'NoInterp' ? { flags: UnitFlags.NoInterp } : {}) });
    update(a, f, commander);
    expect(angles(a, f)[0]).toMatchObject({ prevPitch: 0, curPitch: reason === 'NoInterp' ? 0 : 3089 });
  });

  it('retains aim and walking bindings for upgraded commander blueprints sharing the original model', () => {
    expect(combatRig('core:cmd_commander_engineering', commanderParts)).toEqual(commander.rig);
    expect(combatRig('core:cmd_commander_armor', commanderParts)).toEqual(commander.rig);
  });
});
