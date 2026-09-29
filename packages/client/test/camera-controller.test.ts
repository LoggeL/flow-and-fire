// C1: FA-style camera controller on the flat test plane and on hollow-ridge.
import { RAW_PER_WU, RtsCamera } from '@faf/render';
import { describe, expect, it } from 'vitest';
import {
  CameraController,
  DEFAULT_PITCH_CURVE,
  MAX_PITCH_OFFSET,
  MIN_EYE_CLEARANCE_WU,
  MIN_ZOOM_DISTANCE_WU,
  maxDistanceForMap,
} from '../src/camera-controller.ts';
import { ClientMap } from '../src/map.ts';
import { TerrainPicker } from '../src/terrain-picker.ts';
import { hollowRidge, prng } from './support/map.ts';

function flat(): { cam: RtsCamera; cc: CameraController } {
  const cam = new RtsCamera();
  cam.setViewport(1280, 720);
  const cc = new CameraController(cam);
  cc.centerOnMap();
  return { cam, cc };
}

function ridge(): { cam: RtsCamera; cc: CameraController; picker: TerrainPicker } {
  const map = hollowRidge();
  const cam = new RtsCamera();
  cam.setViewport(1280, 720);
  const cc = new CameraController(cam, { terrain: map });
  cc.jumpTo(96 * RAW_PER_WU, 96 * RAW_PER_WU, 80);
  return { cam, cc, picker: new TerrainPicker(map) };
}

describe('CameraController – flat test plane', () => {
  it('centers on the 512 WU test plane', () => {
    const { cc } = flat();
    expect(cc.state()).toMatchObject({ x: 256, y: 0, z: 256 });
  });

  it('pans with the keyboard axes relative to the view, speed ∝ distance, dt clamped', () => {
    const { cam, cc } = flat();
    // Default yaw looks towards −z: forward decreases z, right increases x.
    cc.update(100, 0, 1);
    const s1 = cc.state();
    expect(s1.x).toBeCloseTo(256, 9);
    expect(s1.z).toBeLessThan(256);
    const moved = 256 - s1.z;
    expect(moved).toBeCloseTo(1.1 * cam.distance * 0.1, 6);
    cc.update(100, 1, 0);
    expect(cc.state().x).toBeCloseTo(256 + moved, 6);
    cam.distance *= 2;
    const z0 = cc.state().z;
    cc.update(100, 0, -1);
    expect(cc.state().z - z0).toBeCloseTo(2 * moved, 6);
    const x0 = cc.state().x;
    cc.update(5000, -1, 0);
    expect(x0 - cc.state().x).toBeCloseTo(2 * moved, 6);
    const a = cc.state();
    cc.update(100, 1, 1);
    const b = cc.state();
    expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeCloseTo(2 * moved, 6);
  });

  it('edge pan moves ∝ distance with its own speed; both axes add up', () => {
    const { cam, cc } = flat();
    const x0 = cc.state().x;
    cc.update(100, 0, 0, 1, 0);
    expect(cc.state().x - x0).toBeCloseTo(1.0 * cam.distance * 0.1, 6);
    const z0 = cc.state().z;
    cc.update(100, 0, 1, 0, 1);
    expect(z0 - cc.state().z).toBeCloseTo(2.1 * cam.distance * 0.1, 6);
  });

  it('clamps the focus point to the map', () => {
    const { cc } = flat();
    for (let i = 0; i < 200; i++) cc.update(100, -1, 1);
    const s = cc.state();
    expect(s.x).toBe(0);
    expect(s.z).toBe(0);
    cc.jumpTo(9999 * RAW_PER_WU, -5 * RAW_PER_WU);
    expect(cc.state()).toMatchObject({ x: 512, z: 0 });
  });

  it('zooms towards the cursor: the ground point stays under it; limits 6 WU … whole map', () => {
    const { cam, cc } = flat();
    const p = new TerrainPicker(ClientMap.testPlane());
    for (const [px, py, steps] of [
      [200, 150, -1],
      [1000, 600, -3],
      [640, 100, 2],
      [50, 700, -1],
    ] as const) {
      expect(p.pick(cam, px, py)).toBe(true);
      const bx = p.wuX;
      const bz = p.wuZ;
      cc.zoomAt(steps, px, py);
      expect(p.pick(cam, px, py)).toBe(true);
      expect(Math.hypot(p.wuX - bx, p.wuZ - bz)).toBeLessThan(1e-3);
    }
    for (let i = 0; i < 100; i++) cc.zoomAt(-1, 640, 360);
    expect(cam.distance).toBe(MIN_ZOOM_DISTANCE_WU);
    for (let i = 0; i < 100; i++) cc.zoomAt(1, 640, 360);
    expect(cam.distance).toBeCloseTo(maxDistanceForMap(512, cam.fovY), 9);
  });

  it('FA pitch curve: flat when close, near top-down at the whole-map view, monotone', () => {
    const { cam, cc } = flat();
    let last = -1;
    for (let d = MIN_ZOOM_DISTANCE_WU; d <= cam.maxDistance; d *= 1.2) {
      const p = cc.curvePitch(d);
      expect(p).toBeGreaterThanOrEqual(last);
      last = p;
    }
    expect(cc.curvePitch(MIN_ZOOM_DISTANCE_WU)).toBeCloseTo(DEFAULT_PITCH_CURVE.near, 9);
    expect(cc.curvePitch(cam.maxDistance)).toBeCloseTo(DEFAULT_PITCH_CURVE.far, 9);
    cam.distance = 105;
    cc.update(16, 0, 0);
    expect(cam.pitch).toBeCloseTo(cc.curvePitch(105), 9);
  });

  it('rotation: yaw around the focus, limited pitch offset, reset', () => {
    const { cam, cc } = flat();
    const yaw0 = cam.yaw;
    const pitch0 = cam.pitch;
    const s0 = cc.state();
    cc.rotate(100, 0);
    expect(cam.yaw).toBeCloseTo(yaw0 + 0.6, 9);
    expect(cc.state().x).toBeCloseTo(s0.x, 9);
    cc.rotate(0, 10_000);
    expect(cc.pitchOffset).toBe(MAX_PITCH_OFFSET);
    expect(cam.pitch).toBeCloseTo(Math.min(cam.maxPitch, pitch0 + MAX_PITCH_OFFSET), 9);
    cc.resetRotation();
    expect(cam.yaw).toBe(yaw0);
    expect(cam.pitch).toBeCloseTo(pitch0, 9);
  });
});

describe('CameraController – terrain (hollow-ridge)', () => {
  it('zoom to cursor keeps the terrain point under the cursor ≤ 1/16 WU after every wheel step (and after smoothing frames)', () => {
    const { cam, cc, picker } = ridge();
    const rnd = prng(42);
    let worst = 0;
    for (let i = 0; i < 400; i++) {
      if (i % 40 === 0) cc.jumpTo((40 + rnd() * 432) * RAW_PER_WU, (40 + rnd() * 432) * RAW_PER_WU, 10 + rnd() * 300);
      const px = 100 + rnd() * 1080;
      const py = 150 + rnd() * 520;
      if (!picker.pick(cam, px, py) || !picker.hit) continue;
      const bx = picker.wuX;
      const bz = picker.wuZ;
      const steps = rnd() < 0.5 ? -1 : 1;
      const f = cam.targetX;
      const g = cam.targetZ;
      cc.zoomAt(steps, px, py);
      const b = cc.bounds;
      const clamped = cam.targetX <= b.minX || cam.targetX >= b.maxX || cam.targetZ <= b.minZ || cam.targetZ >= b.maxZ;
      if (clamped || (f === cam.targetX && g === cam.targetZ && (cam.distance === cam.minDistance || cam.distance === cam.maxDistance))) continue;
      expect(picker.pick(cam, px, py)).toBe(true);
      const err = Math.hypot(picker.wuX - bx, picker.wuZ - bz);
      if (err > 1 / 16) console.log('DBG', i, { px, py, steps, bx, bz, x: picker.wuX, z: picker.wuZ, hit: picker.hit, d: cam.distance, pitch: cam.pitch, tx: cam.targetX / 4096, tz: cam.targetZ / 4096, ty: cam.targetY / 4096, f: f / 4096, g: g / 4096 });
      worst = Math.max(worst, err);
      expect(err, `step ${i}`).toBeLessThanOrEqual(1 / 16);
      // No drift from the focus-height smoothing in the following frames.
      for (let k = 0; k < 10; k++) cc.update(16, 0, 0);
      expect(picker.pick(cam, px, py)).toBe(true);
      expect(Math.hypot(picker.wuX - bx, picker.wuZ - bz), `drift ${i}`).toBeLessThanOrEqual(1 / 16);
    }
    console.log(`[C1] zoom-to-cursor worst error ${worst.toExponential(2)} WU`);
  });

  it('keeps the eye ≥ 2 WU above the terrain and sets groundHeight under the eye', () => {
    const map = hollowRidge();
    const { cam, cc } = ridge();
    const rnd = prng(7);
    let minClear = Infinity;
    for (let i = 0; i < 3000; i++) {
      cc.jumpTo(rnd() * 512 * RAW_PER_WU, rnd() * 512 * RAW_PER_WU, MIN_ZOOM_DISTANCE_WU + rnd() * rnd() * 200);
      cc.rotate((rnd() - 0.5) * 2000, (rnd() - 0.5) * 400);
      cc.update(16, 0, 0);
      const ex = cam.eyeRaw[0]! / RAW_PER_WU;
      const ez = cam.eyeRaw[2]! / RAW_PER_WU;
      const clear = cam.eyeRaw[1]! / RAW_PER_WU - map.heightWU(ex, ez);
      minClear = Math.min(minClear, clear);
      expect(clear).toBeGreaterThanOrEqual(MIN_EYE_CLEARANCE_WU - 1e-6);
      expect(cam.groundHeight).toBeCloseTo(map.heightWU(ex, ez), 6);
      expect(cc.state().clearance).toBeCloseTo(clear, 6);
    }
    console.log(`[C1] min eye clearance over 3,000 random views: ${minClear.toFixed(3)} WU`);
  });

  it('the focus height follows the terrain smoothly when panning over a cliff', () => {
    const map = hollowRidge();
    const { cam, cc } = ridge();
    cc.jumpTo(96 * RAW_PER_WU, 96 * RAW_PER_WU, 80);
    expect(cc.state().y).toBeCloseTo(cc.focusHeightWU(96, 96), 6);
    expect(Math.abs(cc.state().y - map.heightWU(96, 96))).toBeLessThan(0.01); // flat plateau
    // Pan east off the plateau (≈ 24 WU) down the cliff: y lags behind, then converges.
    cc.resetRotation();
    cam.yaw = 0; // forward = +x
    let lagged = false;
    for (let i = 0; i < 120; i++) {
      cc.update(16, 0, i < 60 ? 1 : 0);
      const want = cc.focusHeightWU(cam.targetX / RAW_PER_WU, cam.targetZ / RAW_PER_WU);
      if (Math.abs(cc.state().y - want) > 0.5) lagged = true;
    }
    expect(lagged).toBe(true);
    const s = cc.state();
    expect(s.y).toBeCloseTo(cc.focusHeightWU(s.x, s.z), 1);
    expect(s.x).toBeGreaterThan(150);
    expect(s.y).toBeLessThan(map.heightWU(96, 96) - 4);
  });

  it('middle-drag grabs the terrain: the grabbed point follows the cursor', () => {
    const { cam, cc, picker } = ridge();
    expect(cc.grabStart(640, 400)).toBe(true);
    expect(picker.pick(cam, 640, 400)).toBe(true);
    const gx = picker.wuX;
    const gz = picker.wuZ;
    for (const [x, y] of [
      [660, 420],
      [800, 500],
      [500, 300],
    ] as const) {
      cc.grabMove(x, y);
      expect(picker.pick(cam, x, y)).toBe(true);
      expect(Math.hypot(picker.wuX - gx, picker.wuZ - gz)).toBeLessThanOrEqual(1 / 16);
    }
    cc.grabEnd();
    expect(cc.isGrabbing).toBe(false);
  });

  it('setTerrain switches bounds, zoom limit and snaps the focus height', () => {
    const cam = new RtsCamera();
    cam.setViewport(800, 600);
    const cc = new CameraController(cam);
    cc.jumpTo(96 * RAW_PER_WU, 96 * RAW_PER_WU);
    expect(cc.state().y).toBe(0);
    const map = hollowRidge();
    cc.setTerrain(map, map.bounds);
    expect(cc.state().y).toBeCloseTo(cc.focusHeightWU(96, 96), 6);
    expect(cam.maxDistance).toBeCloseTo(maxDistanceForMap(512, cam.fovY), 9);
    cc.setTerrain(ClientMap.testPlane());
    expect(cc.state().y).toBe(0);
  });
});
