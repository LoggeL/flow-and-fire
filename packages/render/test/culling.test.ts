import { describe, expect, it } from 'vitest';
import { RtsCamera } from '../src/camera.ts';
import { Frustum, INSIDE, INTERSECTS, OUTSIDE } from '../src/frustum.ts';
import { UnitRecordWriter } from '../src/instance-layout.ts';
import type { TerrainDesc } from '../src/terrain/heightfield.ts';
import { computeChunkBounds } from '../src/terrain/heightfield.ts';
import { PatchCuller, cullChunksBruteForce } from '../src/terrain/patches.ts';
import { InstanceCuller, KEY_CULLED, KEY_DROPPED, LOD_LEVELS } from '../src/units/culling.ts';

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** Ridged test terrain with a valley (heights up to ~120 WU at scale 32). */
function ridgeTerrain(sizeWu: number): TerrainDesc {
  const dim = sizeWu + 1;
  const heights = new Uint16Array(dim * dim);
  for (let z = 0; z < dim; z++) {
    for (let x = 0; x < dim; x++) {
      const v = 20 + 15 * Math.sin(x * 0.05) * Math.cos(z * 0.035) + (x > sizeWu * 0.7 ? (x - sizeWu * 0.7) * 0.6 : 0);
      heights[z * dim + x] = Math.max(0, Math.min(65535, Math.round(v * 128)));
    }
  }
  return { sizeWu, dim, heights, heightScaleRaw: 32, waterLevelRaw: null };
}

function randomCamera(r: () => number, mapWu: number): RtsCamera {
  const cam = new RtsCamera({ maxDistance: 2000 });
  cam.setViewport(1280, 720);
  cam.setTargetWU((r() * 1.4 - 0.2) * mapWu, r() * 60, (r() * 1.4 - 0.2) * mapWu);
  cam.yaw = r() * Math.PI * 2;
  cam.pitch = ((15 + r() * 74) * Math.PI) / 180;
  cam.distance = 8 + r() * r() * 900;
  cam.update();
  return cam;
}

describe('Frustum', () => {
  it('classifies boxes and spheres around the view direction', () => {
    const cam = new RtsCamera({ distance: 50 });
    cam.setViewport(800, 600);
    cam.setTargetWU(100, 0, 100);
    cam.update();
    const f = new Frustum().setFromViewProj(cam.viewProj);
    const rel = (xWU: number, yWU: number, zWU: number): [number, number, number] => [
      xWU - cam.camPosInt[0]! / 4096,
      yWU - cam.camPosInt[1]! / 4096,
      zWU - cam.camPosInt[2]! / 4096,
    ];
    const [tx, ty, tz] = rel(100, 0, 100);
    expect(f.sphereVisible(tx, ty, tz, 0.1)).toBe(true);
    expect(f.testAabb(tx - 0.5, ty, tz - 0.5, tx + 0.5, ty + 0.5, tz + 0.5)).toBe(INSIDE);
    // Behind the camera (default yaw looks towards −z, so +z is behind).
    const [bx, by, bz] = rel(100, 0, 400);
    expect(f.sphereVisible(bx, by, bz, 1)).toBe(false);
    expect(f.testAabb(bx - 1, by, bz - 1, bx + 1, by + 1, bz + 1)).toBe(OUTSIDE);
    // A huge box around everything intersects.
    expect(f.testAabb(tx - 5000, -5000, tz - 5000, tx + 5000, 5000, tz + 5000)).toBe(INTERSECTS);
  });
});

describe('PatchCuller (quadtree) == brute-force chunk test', () => {
  it('selects exactly the same patches for 500 random cameras', () => {
    for (const size of [512, 1024]) {
      const t = ridgeTerrain(size);
      const bounds = computeChunkBounds(t);
      const culler = new PatchCuller(bounds);
      const brute = new Uint32Array(bounds.chunks * bounds.chunks);
      const r = rng(size);
      let nonTrivial = 0;
      for (let i = 0; i < 250; i++) {
        const cam = randomCamera(r, size);
        const f = new Frustum().setFromViewProj(cam.viewProj);
        const n = culler.cull(f, cam.camPosInt);
        const m = cullChunksBruteForce(bounds, f, cam.camPosInt, brute);
        const a = Array.from(culler.visible.subarray(0, n)).sort((x, y) => x - y);
        const b = Array.from(brute.subarray(0, m)).sort((x, y) => x - y);
        expect(a).toEqual(b);
        if (m > 0 && m < bounds.chunks * bounds.chunks) nonTrivial++;
      }
      expect(nonTrivial).toBeGreaterThan(100);
    }
  });

  it('a close camera sees only a few patches, the overview sees all', () => {
    const t = ridgeTerrain(512);
    const culler = new PatchCuller(computeChunkBounds(t));
    const cam = new RtsCamera({ distance: 20, maxDistance: 5000 });
    cam.setViewport(1280, 720);
    cam.setTargetWU(256, 20, 256);
    cam.update();
    const near = culler.cull(new Frustum().setFromViewProj(cam.viewProj), cam.camPosInt);
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(40);
    cam.pitch = (89 * Math.PI) / 180;
    cam.distance = 1400;
    cam.update();
    expect(culler.cull(new Frustum().setFromViewProj(cam.viewProj), cam.camPosInt)).toBe(256);
  });
});

describe('InstanceCuller (P2)', () => {
  function setup(): { cam: RtsCamera; f: Frustum } {
    const cam = new RtsCamera({ distance: 40, pitch: (60 * Math.PI) / 180 });
    cam.setViewport(1000, 1000);
    cam.setTargetWU(100, 0, 100);
    cam.update();
    return { cam, f: new Frustum().setFromViewProj(cam.viewProj) };
  }
  const W = (wu: number): number => Math.round(wu * 4096);

  it('keeps units whose prev OR cur position is visible and culls the rest', () => {
    const { cam, f } = setup();
    const w = new UnitRecordWriter(4);
    // 0: both visible; 1: prev visible, cur far behind; 2: prev behind, cur visible; 3: both behind
    const behind = [W(100), 0, W(900)] as const;
    const at = [W(100), 0, W(100)] as const;
    const mk = (i: number, p: readonly number[], c: readonly number[]): void =>
      w.write(i, { prevX: p[0]!, prevY: p[1]!, prevZ: p[2]!, x: c[0]!, y: c[1]!, z: c[2]!, prevYaw: 0, yaw: 0, visual: 0, army: 0 });
    mk(0, at, at);
    mk(1, at, behind);
    mk(2, behind, at);
    mk(3, behind, behind);
    const c = new InstanceCuller();
    const st = c.cull(w.bytes, 4, 1, f, cam.camPosInt, cam.camFrac, Float64Array.of(1), Float64Array.of(60, 180), 1);
    expect(st.visible).toBe(3);
    expect(st.culled).toBe(1);
    expect(c.keys[3]).toBe(KEY_CULLED);
    expect(c.keys[0]).toBeLessThan(LOD_LEVELS);
  });

  it('uses the visual radius (sphere touching the frustum edge stays visible)', () => {
    const { cam, f } = setup();
    // Find a point just outside the frustum along +x at the target depth.
    const w = new UnitRecordWriter(1);
    let xOut = 100;
    const rel = (x: number): number => x - cam.camPosInt[0]! / 4096;
    const rz = 100 - cam.camPosInt[2]! / 4096;
    const ry = -cam.camPosInt[1]! / 4096;
    while (f.sphereVisible(rel(xOut), ry, rz, 0)) xOut += 0.25;
    xOut += 1.5; // 1.5 WU outside
    w.write(0, { prevX: W(xOut), prevY: 0, prevZ: W(100), x: W(xOut), y: 0, z: W(100), prevYaw: 0, yaw: 0, visual: 0, army: 0 });
    const c = new InstanceCuller();
    expect(c.cull(w.bytes, 1, 1, f, cam.camPosInt, cam.camFrac, Float64Array.of(0.5), Float64Array.of(60, 180), 1).visible).toBe(0);
    expect(c.cull(w.bytes, 1, 1, f, cam.camPosInt, cam.camFrac, Float64Array.of(3), Float64Array.of(60, 180), 1).visible).toBe(1);
  });

  it('selects LODs by camera distance and bias; drops unknown visuals', () => {
    const cam = new RtsCamera({ distance: 400, pitch: (89 * Math.PI) / 180, maxDistance: 5000 });
    cam.setViewport(1000, 1000);
    cam.setTargetWU(0, 0, 0);
    cam.update();
    // Low "ground" right below the eye keeps the dynamic near plane small.
    cam.groundHeight = cam.eyeRaw[1]! / 4096 - 5;
    cam.update();
    // Units straight below the eye along the (almost vertical) view axis: all visible.
    const f = new Frustum().setFromViewProj(cam.viewProj);
    const ex = Math.round(cam.eyeRaw[0]!);
    const ez = Math.round(cam.eyeRaw[2]!);
    const eyeY = cam.eyeRaw[1]! / 4096;
    const w = new UnitRecordWriter(6);
    const depths = [5, 59, 61, 179, 181]; // distance below the eye
    depths.forEach((d, i) => {
      const y = W(eyeY - d);
      w.write(i, { prevX: ex, prevY: y, prevZ: ez, x: ex, y, z: ez, prevYaw: 0, yaw: 0, visual: 1, army: 0 });
    });
    w.write(5, { prevX: 0, prevY: 0, prevZ: 0, x: 0, y: 0, z: 0, prevYaw: 0, yaw: 0, visual: 7, army: 0 });
    const c = new InstanceCuller();
    const radii = Float64Array.of(1, 1);
    const lod = Float64Array.of(60, 180, 60, 180);
    let st = c.cull(w.bytes, 6, 2, f, cam.camPosInt, cam.camFrac, radii, lod, 1);
    expect(Array.from(c.keys.subarray(0, 5)).map((k) => k - LOD_LEVELS)).toEqual([0, 0, 1, 1, 2]);
    expect(c.keys[5]).toBe(KEY_DROPPED);
    expect(st.dropped).toBe(1);
    expect(Array.from(st.perLod)).toEqual([2, 2, 1]);
    // Bias 0.5 halves the switch distances: 5 → 0, 59/61 → 1 (≥ 30), 179/181 → 2 (≥ 90).
    st = c.cull(w.bytes, 6, 2, f, cam.camPosInt, cam.camFrac, radii, lod, 0.5);
    expect(Array.from(c.keys.subarray(0, 5)).map((k) => k - LOD_LEVELS)).toEqual([0, 1, 1, 2, 2]);
    expect(st.visible).toBe(5);
  });
});
