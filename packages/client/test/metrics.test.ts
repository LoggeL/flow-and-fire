import { FrameReader, FrameWriter } from '@faf/protocol';
import { RAW_PER_WU, RtsCamera } from '@faf/render';
import { describe, expect, it } from 'vitest';
import { CommandBuilder } from '../src/commands.ts';
import { ClientMetrics, MEASUREMENT_TIMEOUT_MS, RingStats } from '../src/metrics.ts';
import { FakeSimLink } from './support/fake-sim-link.ts';

describe('RingStats', () => {
  it('nearest-rank percentiles over the last `capacity` samples', () => {
    const r = new RingStats(100);
    expect(Number.isNaN(r.percentile(0.5))).toBe(true);
    for (let i = 1; i <= 100; i++) r.push(i);
    expect(r.percentile(0.5)).toBe(50);
    expect(r.percentile(0.95)).toBe(95);
    expect(r.percentile(0.99)).toBe(99);
    const s = r.summary();
    expect(s).toMatchObject({ count: 100, min: 1, max: 100, p50: 50, p95: 95, p99: 99 });
    expect(s.mean).toBeCloseTo(50.5, 9);
    for (let i = 0; i < 50; i++) r.push(1000);
    expect(r.count).toBe(100);
    expect(r.total).toBe(150);
    expect(r.summary().min).toBe(51);
    expect(r.last()).toBe(1000);
    r.clear();
    expect(r.count).toBe(0);
  });
});

/** Synthetic timeline: 1 unit, camera looking at it, a Move 20 WU to +x. */
function scene() {
  const link = new FakeSimLink({ units: 1, originWU: [250, 250], speedRaw: RAW_PER_WU / 2 });
  const reader = new FrameReader();
  reader.reset(link.frames.poll()!);
  const cam = new RtsCamera({ distance: 50 });
  cam.setViewport(1280, 720);
  cam.setTargetWU(250, 0, 250);
  cam.update();
  const cmds = new CommandBuilder(link, 0);
  const m = new ClientMetrics();
  cmds.onAck((seq, _op, _lat, ackMs) => m.onAck(seq, ackMs));
  return { link, reader, cam, cmds, m };
}

describe('ClientMetrics latency chain (synthetic time axis)', () => {
  it('measures click → marker frame, click → seq ack, click → first moved pixel', () => {
    const { link, reader, cam, cmds, m } = scene();
    const h = link.handles();
    // rAF at 1000 (before the click).
    m.beginRaf(1000, 1000);
    m.onRendered(1001, reader, 1, cam);
    m.endRaf(1001.5);
    // Click at 1005.
    const seq = cmds.move(h, 270 * RAW_PER_WU, 0, 250 * RAW_PER_WU, false, 1005);
    m.beginClick(1005, seq, h, reader, 1);
    expect(m.pendingMeasurements).toBe(1);
    // Next rAF (1016.7): marker drawn; no new frame yet → not moved.
    m.beginRaf(1016.7, 1016.7);
    m.onRendered(1017, reader, 1, cam);
    m.endRaf(1018);
    // Tick applies the move; frame arrives at 1060 (ack).
    link.tickNow();
    reader.reset(link.frames.poll()!);
    cmds.acknowledge(reader.ackSeq, 1060);
    // rAF at 1066.7 with alpha 0: prev = click position → not moved yet.
    m.beginRaf(1066.7, 1066.7);
    m.onRendered(1067, reader, 0, cam);
    m.endRaf(1068);
    // rAF at 1083.4 with alpha 0.3: 0.15 WU → several pixels at distance 50.
    m.beginRaf(1083.4, 1083.4);
    m.onRendered(1084, reader, 0.3, cam);
    m.endRaf(1085);
    expect(m.pendingMeasurements).toBe(0);
    const s = m.snapshot();
    expect(s.clicks).toBe(1);
    expect(s.clickToMarkerFrames.p50).toBe(1);
    expect(s.clickToMarkerMs.p50).toBeCloseTo(12, 9);
    expect(s.clickToAckMs.p50).toBeCloseTo(55, 9);
    expect(s.clickToMoveMs.p50).toBeCloseTo(79, 9);
    expect(s.rafs).toBe(4);
    expect(s.mainJsMs.count).toBe(4);
    expect(s.mainJsMs.max).toBeCloseTo(1.6, 9);
    expect(s.fps).toBeCloseTo(1000 / ((1083.4 - 1000) / 3), 6);
    // Plain, structured-clonable object.
    expect(structuredClone(s)).toEqual(s);
    expect(JSON.parse(JSON.stringify(s)).clicks).toBe(1);
  });

  it('is independent of camera motion (both points projected with the current camera)', () => {
    const { link, reader, cam, cmds, m } = scene();
    const h = link.handles();
    const seq = cmds.move(h, 270 * RAW_PER_WU, 0, 250 * RAW_PER_WU, false, 0);
    m.beginRaf(0, 0);
    m.beginClick(0, seq, h, reader, 1);
    // Big camera pan, unit has not moved: no "moved" sample.
    cam.setTargetWU(200, 0, 280);
    cam.update();
    m.onRendered(16, reader, 1, cam);
    expect(m.clickToMoveMs.count).toBe(0);
    expect(m.pendingMeasurements).toBe(1);
  });

  it('does not sample units that were already moving at click time', () => {
    const { link, reader, cam, cmds, m } = scene();
    const h = link.handles();
    cmds.move(h, 300 * RAW_PER_WU, 0, 250 * RAW_PER_WU);
    link.tickNow();
    reader.reset(link.frames.poll()!);
    expect(reader.unitPrev(0, 0)).not.toBe(reader.unitCur(0, 0));
    const seq = cmds.move(h, 200 * RAW_PER_WU, 0, 250 * RAW_PER_WU, false, 50);
    m.beginRaf(40, 40);
    m.beginClick(50, seq, h, reader, 0.5);
    m.beginRaf(60, 60);
    m.onRendered(60, reader, 1, cam);
    cmds.acknowledge(seq, 100);
    expect(m.movingAtClick).toBe(1);
    expect(m.pendingMeasurements).toBe(0);
    expect(m.clickToMoveMs.count).toBe(0);
    expect(m.clickToAckMs.count).toBe(1);
  });

  it('times out incomplete measurements', () => {
    const { link, reader, cam, m } = scene();
    m.beginClick(0, 42, link.handles(), reader, 1);
    m.beginRaf(10, 10);
    m.onRendered(10, reader, 1, cam);
    m.beginRaf(MEASUREMENT_TIMEOUT_MS + 20, MEASUREMENT_TIMEOUT_MS + 20);
    m.onRendered(MEASUREMENT_TIMEOUT_MS + 20, reader, 1, cam);
    expect(m.pendingMeasurements).toBe(0);
    expect(m.timeouts).toBe(1);
    m.reset();
    expect(m.snapshot().clicks).toBe(0);
  });
});

describe('ClientMetrics: rotation counts as a moved pixel', () => {
  function frame(prevYaw: number, curYaw: number): FrameReader {
    const w = new FrameWriter();
    const buf = new Uint8Array(w.capacityBytes);
    w.beginFrame(buf, 1, 1, 0, 1000, 0, 0, 0, 0, 0);
    const x = 250 * RAW_PER_WU;
    w.writeUnit(x, 0, x, x, 0, x, prevYaw, curYaw, 0, 0, 255, 255, 0, 0, 7, 0, 0);
    const len = w.endFrame();
    const r = new FrameReader();
    r.reset(buf.slice(0, len));
    return r;
  }
  function camera(distance: number): RtsCamera {
    const cam = new RtsCamera({ distance });
    cam.setViewport(1280, 720);
    cam.setTargetWU(250, 0, 250);
    cam.update();
    return cam;
  }

  it('detects a turning box on the spot, not a cylinder, and only beyond 1 px', () => {
    const still = frame(0, 0);
    const turning = frame(0, 3277); // 18° in one tick
    for (const [radius, alpha, expected] of [
      [Math.hypot(0.5, 0.5) / 2, 0.5, 1], // 9° of a 0.5 WU box at 10 WU distance ≈ 4.8 px
      [0, 0.5, 0], // cylinder: rotation invisible
      [Math.hypot(0.5, 0.5) / 2, 0.01, 0], // 0.18° ≈ 0.1 px
    ] as const) {
      const m = new ClientMetrics();
      m.setVisualRadii([radius]);
      const cam = camera(10);
      m.beginRaf(0, 0);
      m.beginClick(0, 1, [7], still, 1);
      m.onAck(1, 5);
      m.onRendered(20, turning, alpha, cam);
      m.endRaf(21);
      expect(m.clickToMoveMs.count, `radius ${radius}, alpha ${alpha}`).toBe(expected);
    }
  });

  it('does not sample a unit that is already turning at click time', () => {
    const m = new ClientMetrics();
    m.setVisualRadii([0.35]);
    m.beginRaf(0, 0);
    m.beginClick(0, 1, [7], frame(0, 3277), 1);
    expect(m.movingAtClick).toBe(1);
  });
});
