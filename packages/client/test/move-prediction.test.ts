import { asFx } from '@faf/fixed';
import { CmdFlags, DEFAULT_FRAME_CAPS, FrameReader, FrameWriter, FrameSection, Op, PART_RECORD_BYTES, UNIT_RECORD_BYTES, UnitFlags, encodeMove } from '@faf/protocol';
import { MotionLayer } from '@faf/rules';
import { describe, expect, it } from 'vitest';
import { GameClient } from '../src/client.ts';
import { ClientMap } from '../src/map.ts';
import { MovePredictionAdapter, MOVE_PREVIEW_MAX_RAW, MOVE_PREVIEW_MS, MOVE_RECONCILE_MS, type MovePredictionMotion } from '../src/move-prediction.ts';
import { FakeSimLink } from './support/fake-sim-link.ts';
import { Clock, FakeCanvas, FakeRenderer, FakeTarget, ManualRaf } from './support/fakes.ts';

const map = ClientMap.testPlane();
const motion: MovePredictionMotion = { count: 2, speed: Int32Array.of(1229, 1229), turnRate: Int32Array.of(3277, 3277), layerCol: Uint8Array.of(MotionLayer.Land, MotionLayer.Air) };
const payload = encodeMove({ x: asFx(280 * 4096), y: asFx(0), z: asFx(260 * 4096) });
const handle = (slot = 0): number => (1 << 20) | slot;
function frame(tick = 0, curDx = 0, flags = UnitFlags.Idle, yaw = 0, count = 1, visual = 0, generation = 1, build = 255, viewer = 0) {
  const writer = new FrameWriter();
  const bytes = new Uint8Array(writer.capacityBytes);
  writer.beginFrame(bytes, tick + 1, tick, 512, 1000, viewer, 0, tick > 0 ? 1 : 0, tick, 0);
  for (let i = 0; i < count; i++) writer.writeUnit(250 * 4096, 0, 250 * 4096, 250 * 4096 + curDx, 0, 250 * 4096,
    0, yaw, visual, i === 1 ? 1 : 0, 255, build, 0, flags, (generation << 20) | i, 0, 0);
  const length = writer.endFrame();
  const reader = new FrameReader(); expect(reader.reset(bytes.subarray(0, length))).toBe(true);
  const units = bytes.subarray(reader.offset(FrameSection.Units), reader.offset(FrameSection.Units) + count * UNIT_RECORD_BYTES);
  return { reader, units, parts: new Uint8Array(0), bytes };
}
function issue(a: MovePredictionAdapter, f: ReturnType<typeof frame>, op: number = Op.Move, flags = 0, hs = [handle()]) {
  a.issued(op, flags, hs, op === Op.Move ? payload : new Uint8Array(0), 1, 1000, f.reader, 1, 0, motion, false);
}
function update(a: MovePredictionAdapter, f: ReturnType<typeof frame>, now: number, newFrame = false, alpha = 1, paused = false) {
  a.update(f.reader, f.units, f.parts, alpha, now, newFrame, motion, map, [], paused);
}

describe('visual-only initial Move prediction', () => {
  it('draws actual bounded movement in private bytes, preserving accepted frame and enemy records', () => {
    const f = frame(0, 0, UnitFlags.Idle, 0, 2), before = f.bytes.slice(), a = new MovePredictionAdapter();
    update(a, f, 1000, true); issue(a, f, Op.Move, 0, [handle(), handle(1)]);
    update(a, f, 1060);
    expect(a.active).toBe(1); expect(a.units.buffer).not.toBe(f.units.buffer);
    const x = a.rendered.getInt32(12, true), z = a.rendered.getInt32(20, true);
    const travel = Math.hypot(x - f.reader.unitCur(0, 0), z - f.reader.unitCur(0, 2));
    expect(travel).toBeGreaterThan(0); expect(travel).toBeLessThanOrEqual(MOVE_PREVIEW_MAX_RAW + 1);
    expect(a.rendered.getInt32(0, true)).toBe(x);
    expect(a.rendered.getUint16(24, true)).toBe(a.rendered.getUint16(26, true));
    expect(a.units.slice(UNIT_RECORD_BYTES, UNIT_RECORD_BYTES * 2)).toEqual(f.units.slice(UNIT_RECORD_BYTES));
    expect(f.bytes).toEqual(before); expect(f.reader.ackSeq).toBe(0);
  });

  it('never previews append, enemy, non-idle, moving, paused, discontinuous or non-live records', () => {
    const a = new MovePredictionAdapter(), f = frame(); update(a, f, 1000, true);
    issue(a, f, Op.Move, CmdFlags.Queue); expect(a.active).toBe(0);
    for (const flags of [UnitFlags.Building | UnitFlags.Idle, UnitFlags.Ghost | UnitFlags.Idle, UnitFlags.Blip | UnitFlags.Idle,
      UnitFlags.Wreck | UnitFlags.Idle, UnitFlags.NoInterp | UnitFlags.Idle, UnitFlags.Paused | UnitFlags.Idle, 0]) {
      issue(a, frame(0, 0, flags)); expect(a.active).toBe(0);
    }
    issue(a, frame(0, 10)); expect(a.active).toBe(0);
    issue(a, frame(0, 0, UnitFlags.Idle, 0, 1, 1)); expect(a.active).toBe(0);
    issue(a, frame(0, 0, UnitFlags.Idle, 0, 1, 0, 1, 254)); expect(a.active).toBe(0);
    a.issued(Op.Move, 0, [handle()], payload, 1, 1000, f.reader, 1, 0, motion, true); expect(a.active).toBe(0);
    issue(a, f); expect(a.active).toBe(1);
    issue(a, f, Op.Move, CmdFlags.Queue); expect(a.active).toBe(1);
    issue(a, f, Op.Stop); expect(a.active).toBe(0);
    issue(a, f); update(a, f, 1010, false, 1, true); expect(a.active).toBe(0);
    issue(a, f); update(a, frame(5), 1020, true); expect(a.active).toBe(0);
  });

  it('reconciles after genuine accepted motion, then passes the authoritative bytes through', () => {
    const a = new MovePredictionAdapter(), f = frame(); update(a, f, 1000, true); issue(a, f);
    update(a, f, 1060); const shownX = a.rendered.getInt32(12, true), shownYaw = a.rendered.getUint16(26, true);
    const applied = frame(1, 200, 0, 1800), before = applied.bytes.slice();
    update(a, applied, 1120, true, 0);
    expect(a.rendered.getInt32(12, true)).toBe(shownX); expect(a.rendered.getUint16(26, true)).toBe(shownYaw);
    update(a, applied, 1120 + MOVE_RECONCILE_MS, false, 0.8); expect(a.active).toBe(0);
    update(a, applied, 1250, false, 0.9); expect(a.units).toBe(applied.units);
    expect(applied.bytes).toEqual(before);
  });

  it('anchors a reset/reissued preview to its accepted basis, allowing that exact frame and a contiguous successor', () => {
    const a = new MovePredictionAdapter(), f = frame();
    update(a, f, 1000, true); issue(a, f); a.reset(); issue(a, f);
    // An issue from a new-frame callback can precede preparation of that same accepted frame.
    update(a, f, 1020, true); expect(a.active).toBe(1);
    update(a, frame(1, 123, 0, 3277), 1040, true, 0); expect(a.active).toBe(1);
    a.reset(); issue(a, f);
    update(a, frame(1, 0, UnitFlags.Idle, 0, 1, 0, 1, 255, 1), 1040, true); expect(a.active).toBe(0);
  });

  it('bounds an unaccepted command and removes missing or replaced handles', () => {
    const a = new MovePredictionAdapter(), f = frame(); update(a, f, 1000, true); issue(a, f);
    update(a, f, 1000 + MOVE_PREVIEW_MS); update(a, f, 1000 + MOVE_PREVIEW_MS + MOVE_RECONCILE_MS);
    expect(a.active).toBe(0);
    issue(a, f); update(a, frame(1, 0, UnitFlags.Idle, 0, 0), 1010, true); expect(a.active).toBe(0);
    a.reset(); update(a, f, 1000, true); issue(a, f);
    update(a, frame(1, 0, UnitFlags.Idle, 0, 1, 0, 2), 1010, true); expect(a.active).toBe(0);
  });

  it('shows the initial response when the first accepted moving frame arrives before the first preview', () => {
    const a = new MovePredictionAdapter(), f = frame(); update(a, f, 1000, true); issue(a, f);
    const applied = frame(1, 123, 0, 3277), bytes = applied.bytes.slice();
    update(a, applied, 1020, true, 0);
    const early = a.rendered.getInt32(12, true);
    expect(early).toBeGreaterThan(f.reader.unitCur(0, 0));
    update(a, applied, 1090, false, 0.3);
    expect(a.rendered.getInt32(12, true)).toBeGreaterThan(early);
    update(a, applied, 1100, false, 0.4); update(a, applied, 1200, false, 1);
    expect(a.active).toBe(0); expect(applied.bytes).toEqual(bytes);
  });

  it('preserves independently observed world aim and all gait/pitch bytes during hull prediction', () => {
    const f = frame(), a = new MovePredictionAdapter(), parts = new Uint8Array(8), part = new DataView(parts.buffer);
    part.setUint16(0, 7000, true); part.setUint16(2, 9000, true); part.setInt16(4, -240, true); part.setInt16(6, 250, true);
    const units = f.units.slice(); new DataView(units.buffer).setUint8(44, 1);
    const table = [{ spec: { hull: 'box' as const, size: [1, 1, 1] as const }, rig: [undefined, { mount: 0, yaw: true, pitch: true }] }];
    update(a, f, 1000, true); issue(a, f);
    a.update(f.reader, units, parts, 1, 1060, false, motion, map, table, false);
    const shown = a.rendered.getUint16(26, true), p = new DataView(a.parts.buffer);
    expect((p.getUint16(2, true) + shown) & 65535).toBe(9000);
    expect(p.getInt16(4, true)).toBe(-240); expect(p.getInt16(6, true)).toBe(250);
    expect(part.getUint16(2, true)).toBe(9000); expect(f.reader.unitCurYaw(0)).toBe(0);
  });

  it('passes expanded rig input through without copying or throwing when either private buffer cap is exceeded', () => {
    const f = frame(), a = new MovePredictionAdapter();
    const oversizedUnits = new Uint8Array(DEFAULT_FRAME_CAPS.units * UNIT_RECORD_BYTES + 1);
    const oversizedParts = new Uint8Array(DEFAULT_FRAME_CAPS.parts * PART_RECORD_BYTES + 1);
    for (const [units, parts] of [[oversizedUnits, f.parts], [f.units, oversizedParts]]) {
      update(a, f, 1000, true); issue(a, f);
      expect(() => a.update(f.reader, units!, parts!, 1, 1060, false, motion, map, [], false)).not.toThrow();
      expect(a.active).toBe(0); expect(a.units).toBe(units); expect(a.parts).toBe(parts);
    }
  });

  it('accepts SAB-backed unit views for passthrough and private preview without modifying shared bytes', () => {
    const f = frame(), a = new MovePredictionAdapter();
    const shared = new Uint8Array(new SharedArrayBuffer(f.units.length)); shared.set(f.units);
    const before = shared.slice();
    a.update(f.reader, shared, f.parts, 1, 1000, true, motion, map, [], false);
    expect(a.units).toBe(shared); expect(a.rendered.buffer).toBe(shared.buffer);
    issue(a, f); a.update(f.reader, shared, f.parts, 1, 1060, false, motion, map, [], false);
    expect(a.rendered.buffer).not.toBe(shared.buffer); expect(shared).toEqual(before);
  });
});

describe('rendered-pose latency and client integration', () => {
  it('counts only movement actually submitted to the renderer, while ACK waits for application', () => {
    const clock = new Clock(1000), raf = new ManualRaf(), renderer = new FakeRenderer();
    const link = new FakeSimLink({ units: 1, originWU: [250, 250] });
    const client = new GameClient({ canvas: new FakeCanvas(), renderer, link, playerArmy: 0, keyTarget: new FakeTarget(),
      visuals: [{ spec: { hull: 'box', size: [0.5, 0.5, 0.5] } }], movePrediction: motion, raf, now: clock.now });
    client.frame(1000); client.jumpTo(250 * 4096, 250 * 4096, 105);
    const before = client.lastFrame!.bytes.slice(); const seq = client.moveTo(280 * 4096, 260 * 4096, link.handles());
    clock.advance(90); client.frame(clock.t);
    const submitted = new DataView(renderer.last!.units.bytes.buffer, renderer.last!.units.bytes.byteOffset);
    expect(submitted.getInt32(12, true)).toBeGreaterThan(client.lastFrame!.unitCur(0, 0));
    expect(client.metrics.clickToMoveMs.count).toBe(1);
    expect(client.metrics.clickToMoveMs.last()).toBe(90);
    const observed = client.unitScreenPos(link.handles()[0]!);
    const projected = new Float64Array(4);
    expect(client.camera.project(submitted.getInt32(12, true), submitted.getInt32(16, true), submitted.getInt32(20, true), projected)).toBe(true);
    expect(observed!.x).toBeCloseTo(projected[0]!, 6); expect(observed!.y).toBeCloseTo(projected[1]!, 6);
    expect(client.commands.isPending(seq)).toBe(true); expect(client.metrics.clickToAckMs.count).toBe(0);
    expect(client.lastFrame!.bytes).toEqual(before);
    link.tickNow(); clock.advance(20); client.frame(clock.t);
    expect(client.metrics.clickToAckMs.count).toBe(1); expect(link.applied).toBe(1);
    client.dispose();
  });

  it('keeps default/replay clients unpredicted and cancels immediately on requested pause and direct Stop', () => {
    for (const readOnly of [false, true]) {
      const clock = new Clock(1000), renderer = new FakeRenderer(), link = new FakeSimLink({ units: 1 });
      const client = new GameClient({ canvas: new FakeCanvas(), renderer, link, playerArmy: 0, keyTarget: new FakeTarget(),
        visuals: [], readOnlyCommands: readOnly, ...(readOnly ? { movePrediction: motion } : {}), raf: new ManualRaf(), now: clock.now });
      client.frame(1000); const seq = client.moveTo(280 * 4096, 260 * 4096, link.handles());
      clock.advance(60); client.frame(clock.t);
      expect(renderer.last!.units.bytes.buffer).toBe(client.lastFrame!.bytes.buffer);
      expect(seq < 0).toBe(readOnly); client.dispose();
    }
    const clock = new Clock(1000), renderer = new FakeRenderer(), link = new FakeSimLink({ units: 1 });
    const client = new GameClient({ canvas: new FakeCanvas(), renderer, link, playerArmy: 0, keyTarget: new FakeTarget(),
      visuals: [], movePrediction: motion, raf: new ManualRaf(), now: clock.now });
    client.frame(1000); client.moveTo(280 * 4096, 260 * 4096, link.handles());
    client.commands.stop(link.handles(), clock.t); clock.advance(60); client.frame(clock.t);
    expect(renderer.last!.units.bytes.buffer).toBe(client.lastFrame!.bytes.buffer);
    client.moveTo(280 * 4096, 260 * 4096, link.handles()); client.sendCtl({ t: 'pause' });
    clock.advance(60); client.frame(clock.t); expect(renderer.last!.units.bytes.buffer).toBe(client.lastFrame!.bytes.buffer);
    client.dispose();
  });

  it('does not count camera movement as preview displacement or create an ACK from rendering', () => {
    const clock = new Clock(1000), renderer = new FakeRenderer(), link = new FakeSimLink({ units: 1, originWU: [250, 250] });
    const client = new GameClient({ canvas: new FakeCanvas(), renderer, link, playerArmy: 0, keyTarget: new FakeTarget(),
      visuals: [], raf: new ManualRaf(), now: clock.now });
    client.frame(1000); client.moveTo(280 * 4096, 260 * 4096, link.handles());
    client.jumpTo(200 * 4096, 220 * 4096, 105); clock.advance(60); client.frame(clock.t);
    expect(client.metrics.clickToMoveMs.count).toBe(0); expect(client.metrics.clickToAckMs.count).toBe(0);
    client.dispose();
  });
});
