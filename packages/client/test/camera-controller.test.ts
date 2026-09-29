import { RAW_PER_WU, RtsCamera } from '@faf/render';
import { describe, expect, it } from 'vitest';
import { CameraController } from '../src/camera-controller.ts';
import { GroundPicker, mapBoundsWU } from '../src/picking.ts';

function setup(): { cam: RtsCamera; cc: CameraController } {
  const cam = new RtsCamera();
  cam.setViewport(1280, 720);
  const cc = new CameraController(cam);
  cc.centerOnMap();
  return { cam, cc };
}

describe('CameraController', () => {
  it('centers on the 512 WU test plane', () => {
    const { cc } = setup();
    expect(cc.state()).toMatchObject({ x: 256, z: 256 });
  });

  it('pans with the keyboard axes relative to the view, speed ∝ distance, dt clamped', () => {
    const { cam, cc } = setup();
    // Default yaw looks towards −z: forward decreases z, right increases x.
    cc.update(100, 0, 1);
    const s1 = cc.state();
    expect(s1.x).toBeCloseTo(256, 9);
    expect(s1.z).toBeLessThan(256);
    const moved = 256 - s1.z;
    expect(moved).toBeCloseTo(1.1 * cam.distance * 0.1, 6);
    cc.update(100, 1, 0);
    expect(cc.state().x).toBeCloseTo(256 + moved, 6);
    // Double distance → double speed.
    cam.distance *= 2;
    const z0 = cc.state().z;
    cc.update(100, 0, -1);
    expect(cc.state().z - z0).toBeCloseTo(2 * moved, 6);
    // A 5 s hitch is clamped to maxDtMs (100 ms).
    const x0 = cc.state().x;
    cc.update(5000, -1, 0);
    expect(x0 - cc.state().x).toBeCloseTo(2 * moved, 6);
    // Diagonal is normalised.
    const a = cc.state();
    cc.update(100, 1, 1);
    const b = cc.state();
    expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeCloseTo(2 * moved, 6);
  });

  it('clamps the focus point to the map', () => {
    const { cam, cc } = setup();
    for (let i = 0; i < 200; i++) cc.update(100, -1, 1);
    const s = cc.state();
    expect(s.x).toBe(0);
    expect(s.z).toBe(0);
    for (let i = 0; i < 200; i++) cc.panPixels(-500, -500);
    expect(cam.targetX).toBe(512 * RAW_PER_WU);
    expect(cam.targetZ).toBe(512 * RAW_PER_WU);
    cc.focusRaw(-1e9, 1e9);
    expect(cam.targetX).toBe(0);
    expect(cam.targetZ).toBe(512 * RAW_PER_WU);
  });

  it('drag-pans so the ground follows the mouse', () => {
    const { cam, cc } = setup();
    const p = new GroundPicker(mapBoundsWU());
    p.pick(cam, 640, 360);
    const gx = p.wuX;
    const gz = p.wuZ;
    // Drag 100 px right and 50 px down: the ground point under (640,360) is now near (740,410).
    cc.panPixels(100, 50);
    p.pick(cam, 740, 410);
    // Screen-space approximation (exact at the focus depth, a bit off for perspective).
    expect(Math.abs(p.wuX - gx)).toBeLessThan(1.5);
    expect(Math.abs(p.wuZ - gz)).toBeLessThan(3);
    expect(cc.version).toBeGreaterThan(0);
  });

  it('zooms towards the cursor: the ground point under the cursor stays put', () => {
    const { cam, cc } = setup();
    const p = new GroundPicker(mapBoundsWU());
    const cursor: [number, number] = [900, 250];
    p.pick(cam, cursor[0], cursor[1]);
    const before = [p.wuX, p.wuZ];
    const d0 = cam.distance;
    cc.zoomAt(-3, cursor[0], cursor[1]);
    expect(cam.distance).toBeCloseTo(d0 / Math.pow(1.15, 3), 9);
    p.pick(cam, cursor[0], cursor[1]);
    expect(p.wuX).toBeCloseTo(before[0]!, 6);
    expect(p.wuZ).toBeCloseTo(before[1]!, 6);
    cc.zoomAt(2, cursor[0], cursor[1]);
    p.pick(cam, cursor[0], cursor[1]);
    expect(p.wuX).toBeCloseTo(before[0]!, 6);
    expect(p.wuZ).toBeCloseTo(before[1]!, 6);
  });

  it('respects the zoom limits', () => {
    const { cam, cc } = setup();
    for (let i = 0; i < 100; i++) cc.zoomAt(5, 640, 360);
    expect(cam.distance).toBe(cam.maxDistance);
    for (let i = 0; i < 100; i++) cc.zoomAt(-5, 640, 360);
    expect(cam.distance).toBe(cam.minDistance);
  });
});
