import { createRay, intersectGround, RAW_PER_WU, RtsCamera } from '@faf/render';
import { describe, expect, it } from 'vitest';
import { ClientMap } from '../src/map.ts';
import { clampRaw, mapBoundsWU, wuToRaw } from '../src/picking.ts';
import { TerrainPicker } from '../src/terrain-picker.ts';

/** The flat test plane goes through the heightmap raymarch like every map. */
const plane = (): TerrainPicker => new TerrainPicker(ClientMap.testPlane());

function camera(xWU: number, zWU: number, opts: ConstructorParameters<typeof RtsCamera>[0] = {}): RtsCamera {
  const c = new RtsCamera(opts);
  c.setViewport(1280, 720);
  c.setTargetWU(xWU, 0, zWU);
  c.update();
  return c;
}

describe('picking the generated test plane map (TerrainPicker)', () => {
  it('intersects the view ray exactly with y = 0 (hit lies on the ray and on the plane)', () => {
    const cam = camera(256, 256, { yaw: 0.7, pitch: 0.9, distance: 120 });
    const ray = createRay();
    const hit = new Float64Array(2);
    for (const [px, py] of [
      [640, 360],
      [10, 700],
      [1270, 50],
      [333.3, 444.4],
    ] as const) {
      cam.screenToRay(px, py, ray);
      expect(intersectGround(ray, 0, hit)).toBe(true);
      const t = -ray.origin[1]! / ray.dir[1]!;
      expect(hit[0]).toBeCloseTo(ray.origin[0]! + ray.dir[0]! * t, 9);
      expect(hit[1]).toBeCloseTo(ray.origin[2]! + ray.dir[2]! * t, 9);
      const p = plane();
      expect(p.pick(cam, px, py)).toBe(true);
      expect(p.wuX).toBeCloseTo(hit[0]!, 9);
      expect(p.wuZ).toBeCloseTo(hit[1]!, 9);
    }
  });

  it('picks the screen position of a world point back to that point within 1/16 WU (raw integers)', () => {
    const p = plane();
    const out = new Float64Array(4);
    for (const [cx, cz, yaw, pitch, dist] of [
      [256, 256, -Math.PI / 2, 0.96, 80],
      [40, 470, 0.3, 0.5, 300],
      [500, 12, 2.5, 1.4, 25],
    ] as const) {
      const cam = camera(cx, cz, { yaw, pitch, distance: dist });
      for (let k = 0; k < 50; k++) {
        const wx = cx + ((k * 37) % 21) - 10 + k / 64;
        const wz = cz + ((k * 53) % 17) - 8 - k / 128;
        const xr = Math.round(wx * RAW_PER_WU);
        const zr = Math.round(wz * RAW_PER_WU);
        if (xr < 0 || zr < 0 || xr > 512 * RAW_PER_WU || zr > 512 * RAW_PER_WU) continue;
        expect(cam.project(xr, 0, zr, out)).toBe(true);
        expect(p.pick(cam, out[0]!, out[1]!)).toBe(true);
        expect(Number.isInteger(p.x) && Number.isInteger(p.z)).toBe(true);
        expect(Math.abs(p.x - xr)).toBeLessThanOrEqual(RAW_PER_WU / 16);
        expect(Math.abs(p.z - zr)).toBeLessThanOrEqual(RAW_PER_WU / 16);
      }
    }
  });

  it('clamps hits outside the map to the map edge', () => {
    // Camera at the map corner looking outwards: the screen centre hits the plane outside.
    const cam = camera(2, 2, { yaw: -3 * Math.PI / 4, pitch: 0.6, distance: 60 });
    const b = mapBoundsWU();
    const p = plane();
    expect(p.pick(cam, 640, 100)).toBe(true);
    expect(p.wuX < 0 || p.wuZ < 0).toBe(true);
    expect(p.hit).toBe(false);
    expect(p.clamped).toBe(true);
    expect(p.x).toBeGreaterThanOrEqual(b.minX);
    expect(p.z).toBeGreaterThanOrEqual(b.minZ);
    expect(p.x === b.minX || p.z === b.minZ).toBe(true);
    // Inside: not clamped.
    const c2 = camera(256, 256);
    expect(p.pick(c2, 640, 360)).toBe(true);
    expect(p.hit).toBe(true);
    expect(p.clamped).toBe(false);
    expect(p.y).toBe(0);
    expect(p.x).toBe(256 * RAW_PER_WU);
    expect(p.z).toBe(256 * RAW_PER_WU);
  });

  it('reports a miss for rays above the horizon', () => {
    const cam = camera(256, 256, { pitch: 0.3, fovY: 1.2 });
    const p = plane();
    p.x = 123;
    expect(p.pick(cam, 640, 0)).toBe(false);
    expect(p.x).toBe(123);
  });

  it('helpers', () => {
    expect(wuToRaw(1.5)).toBe(6144);
    expect(wuToRaw(-0.25)).toBe(-1024);
    expect(clampRaw(5, 0, 3)).toBe(3);
    expect(clampRaw(-5, 0, 3)).toBe(0);
    expect(mapBoundsWU()).toEqual({ minX: 0, minZ: 0, maxX: 512 * 4096, maxZ: 512 * 4096 });
    expect(mapBoundsWU(-10, 5, 20, 30)).toEqual({ minX: -40960, minZ: 20480, maxX: 40960, maxZ: 35 * 4096 });
  });
});
