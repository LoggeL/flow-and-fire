import { describe, expect, it } from 'vitest';
import { RAW_PER_WU, RtsCamera, createRay, intersectGround } from '../src/camera.ts';

function makeCamera(xWU: number, zWU: number, opts: ConstructorParameters<typeof RtsCamera>[0] = {}): RtsCamera {
  const cam = new RtsCamera(opts);
  cam.setViewport(800, 600);
  cam.setTargetWU(xWU, 0, zWU);
  cam.update();
  return cam;
}

describe('RtsCamera', () => {
  it('projects the focus point to the viewport center', () => {
    const cam = makeCamera(100, 200);
    const out = new Float64Array(4);
    expect(cam.project(100 * RAW_PER_WU, 0, 200 * RAW_PER_WU, out)).toBe(true);
    expect(out[0]).toBeCloseTo(400, 6);
    expect(out[1]).toBeCloseTo(300, 6);
    expect(out[2]!).toBeGreaterThan(-1);
    expect(out[2]!).toBeLessThan(1);
  });

  it('projects points in view direction upwards on screen and to the right to the right', () => {
    // Default yaw looks towards −z: further −z appears higher on screen, +x appears right.
    const cam = makeCamera(100, 200);
    const out = new Float64Array(4);
    cam.project(100 * RAW_PER_WU, 0, 190 * RAW_PER_WU, out);
    expect(out[1]!).toBeLessThan(300);
    cam.project(110 * RAW_PER_WU, 0, 200 * RAW_PER_WU, out);
    expect(out[0]!).toBeGreaterThan(400);
    // Behind the camera.
    expect(cam.project(100 * RAW_PER_WU, 0, 400 * RAW_PER_WU, out)).toBe(false);
  });

  it('splits the eye position exactly into integer raw part and float rest up to 2^26 raw', () => {
    const big = 2 ** 26;
    for (const base of [0, 12345.5, big - 3.25, big, big + 0.75, -big + 0.5]) {
      const cam = new RtsCamera({ distance: 50 });
      cam.setViewport(800, 600);
      cam.targetX = base;
      cam.targetY = 0;
      cam.targetZ = base * 0.5;
      cam.update();
      for (let i = 0; i < 3; i++) {
        const e = cam.eyeRaw[i]!;
        const ip = cam.camPosInt[i]!;
        expect(Number.isInteger(ip)).toBe(true);
        expect(ip).toBe(Math.floor(e));
        const frac = cam.camFrac[i]!;
        expect(frac).toBeGreaterThanOrEqual(0);
        expect(frac).toBeLessThan(1 / RAW_PER_WU);
        // The rest carries the sub-raw fraction only (float64 rounding of the rest, never of the int part).
        expect(Math.abs(ip + frac * RAW_PER_WU - e)).toBeLessThan(1e-6);
      }
    }
  });

  it('projects with the same precision far from the origin (camera-relative math)', () => {
    const near = makeCamera(10, 10);
    const far = new RtsCamera();
    far.setViewport(800, 600);
    // Same configuration shifted by exactly 2^26 raw in x and z.
    const shift = 2 ** 26;
    far.targetX = near.targetX + shift;
    far.targetY = near.targetY;
    far.targetZ = near.targetZ + shift;
    far.update();
    const a = new Float64Array(4);
    const b = new Float64Array(4);
    for (const [dx, dz] of [
      [0, 0],
      [3.3, -7.1],
      [-12.25, -20],
      [0.001, 0.002],
    ] as const) {
      const px = Math.round((10 + dx) * RAW_PER_WU);
      const pz = Math.round((10 + dz) * RAW_PER_WU);
      near.project(px, 0, pz, a);
      far.project(px + shift, 0, pz + shift, b);
      expect(Math.abs(a[0]! - b[0]!)).toBeLessThan(1e-6);
      expect(Math.abs(a[1]! - b[1]!)).toBeLessThan(1e-6);
    }
  });

  it('screenToRay through the center hits y = 0 at the focus point', () => {
    const cam = makeCamera(256, 128);
    const ray = cam.screenToRay(400, 300);
    const hit = new Float64Array(2);
    expect(intersectGround(ray, 0, hit)).toBe(true);
    expect(hit[0]).toBeCloseTo(256, 6);
    expect(hit[1]).toBeCloseTo(128, 6);
    expect(Math.hypot(ray.dir[0]!, ray.dir[1]!, ray.dir[2]!)).toBeCloseTo(1, 12);
  });

  it('screenToRay inverts project for arbitrary ground points, also at 2^26 raw', () => {
    const offsets = [0, 2 ** 26 / RAW_PER_WU];
    for (const off of offsets) {
      const cam = makeCamera(off + 200, off + 300, { yaw: 0.7, pitch: 0.9, distance: 120 });
      const scr = new Float64Array(4);
      const hit = new Float64Array(2);
      const ray = createRay();
      for (const [dx, dz] of [
        [0, 0],
        [15, -10],
        [-30, 25],
        [40.5, 5.25],
      ] as const) {
        const x = off + 200 + dx;
        const z = off + 300 + dz;
        expect(cam.project(x * RAW_PER_WU, 0, z * RAW_PER_WU, scr)).toBe(true);
        cam.screenToRay(scr[0]!, scr[1]!, ray);
        expect(intersectGround(ray, 0, hit)).toBe(true);
        expect(Math.abs(hit[0]! - x)).toBeLessThan(1e-4);
        expect(Math.abs(hit[1]! - z)).toBeLessThan(1e-4);
      }
    }
  });

  it('derives a dynamic near plane from the camera height', () => {
    const low = makeCamera(0, 0, { distance: 10 });
    const high = makeCamera(0, 0, { distance: 1000, maxDistance: 2000 });
    expect(low.near).toBeGreaterThan(0);
    expect(high.near).toBeGreaterThan(low.near);
    // The near plane never cuts objects up to 4 WU tall below the camera.
    expect(high.near).toBeLessThanOrEqual(high.height - 4);
    expect(high.far).toBeGreaterThan(high.distance);
  });

  it('skips recomputation when nothing changed and clamps zoom/pitch', () => {
    const cam = makeCamera(0, 0);
    const v = cam.version;
    cam.update();
    expect(cam.version).toBe(v);
    cam.pan(1, 0);
    cam.update();
    expect(cam.version).toBe(v + 1);
    cam.zoom(1e9);
    expect(cam.distance).toBe(cam.maxDistance);
    cam.rotate(0, 10);
    expect(cam.pitch).toBe(cam.maxPitch);
  });

  it('pans along screen axes', () => {
    const cam = makeCamera(100, 100);
    const out = new Float64Array(4);
    cam.pan(10, 0);
    cam.update();
    // The old focus point moves to the left of the center.
    cam.project(100 * RAW_PER_WU, 0, 100 * RAW_PER_WU, out);
    expect(out[0]!).toBeLessThan(400);
    expect(out[1]).toBeCloseTo(300, 6);
  });
});
