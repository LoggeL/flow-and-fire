import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readRtsMap } from '@faf/formats';
import { Frustum, INSIDE, OUTSIDE, RtsCamera, sunDirection } from '@faf/render';
import { describe, expect, it } from 'vitest';
import { PROP_LODS, PROP_MESHES, UNIT_VARIANTS, propMeshes } from '../src/meshes.ts';
import { IMPOSTOR_BUCKET, PROP_BUCKETS, PROP_CHUNK_WU, PropGrid, PropSelection } from '../src/prop-grid.ts';
import { CascadeFitter, ShadowUnitCuller } from '../src/proto/shadows.ts';
import { RAW, buildScene } from '../src/scene.ts';

const MAP = readRtsMap(new Uint8Array(readFileSync(resolve(import.meta.dirname, '../../../content/maps/hollow-ridge.rtsmap'))));
const scene = buildScene(MAP);
const meshes = propMeshes();
const heights = meshes.map((l) => Math.max(...l.map((m) => m.height)));
const radii = meshes.map((l) => Math.max(...l.map((m) => m.radius)));
const grid = new PropGrid(scene.props, MAP.meta.sizeWu, heights, radii);

function camera(x: number, z: number, distance: number, yawDeg: number, pitchDeg = 50): RtsCamera {
  const cam = new RtsCamera({ maxDistance: 1500 });
  cam.setViewport(1920, 1080);
  const y = scene.heights.wu(x, z);
  cam.setTargetWU(x, y, z);
  cam.groundHeight = y;
  cam.distance = distance;
  cam.yaw = (yawDeg * Math.PI) / 180;
  cam.pitch = (pitchDeg * Math.PI) / 180;
  cam.update();
  return cam;
}

function words(sel: PropSelection, b: number): Set<string> {
  const out = new Set<string>();
  const s = sel.staging;
  for (let i = sel.bucketStart[b]!; i < sel.bucketStart[b]! + sel.bucketCount[b]!; i++) out.add(`${s[i * 4]}_${s[i * 4 + 2]}_${s[i * 4 + 3]}`);
  return out;
}

describe('PropGrid (instanced props: chunk culling + chunk LOD)', () => {
  it('selects every prop for a frustum around the whole map, sorted into (mesh, LOD) buckets', () => {
    const cam = camera(256, 256, 1400, 90, 89);
    const f = new Frustum().setFromViewProj(cam.viewProj);
    const sel = new PropSelection(grid.count);
    const total = grid.select(f, cam.camPosInt, { eye: cam.camFrac, lod0Distance: 0, impostorDistance: Infinity, fixedLod: 1 }, sel);
    expect(total).toBe(30000);
    let sum = 0;
    for (let b = 0; b < PROP_BUCKETS; b++) sum += sel.bucketCount[b]!;
    expect(sum).toBe(total);
    // Far camera + LOD0 distance 0 ⇒ only LOD 1 buckets; the bucket's meta byte carries its mesh.
    for (let m = 0; m < PROP_MESHES; m++) {
      expect(sel.bucketCount[m * PROP_LODS]).toBe(0);
      const b = m * PROP_LODS + 1;
      for (let i = sel.bucketStart[b]!; i < sel.bucketStart[b]! + sel.bucketCount[b]!; i++) expect(sel.staging[i * 4 + 3]! >>> 30).toBe(m);
    }
  });

  it('never drops a visible prop: every prop inside the frustum is selected exactly once', () => {
    for (const [x, z, d, yaw] of [
      [100, 110, 45, 40],
      [256, 256, 110, 80],
      [400, 380, 70, 215],
    ] as const) {
      const cam = camera(x, z, d, yaw);
      const f = new Frustum().setFromViewProj(cam.viewProj);
      const sel = new PropSelection(grid.count);
      grid.select(f, cam.camPosInt, { eye: cam.camFrac, lod0Distance: 60, impostorDistance: 110, fixedLod: 1 }, sel);
      const all = new Set<string>();
      let n = 0;
      for (let b = 0; b < PROP_BUCKETS; b++) for (const w of words(sel, b)) {
        all.add(w);
        n++;
      }
      expect(all.size).toBe(n); // no duplicates
      const p = scene.props;
      const c = cam.camPosInt;
      for (let i = 0; i < p.count; i++) {
        const px = (p.x[i]! - c[0]!) / RAW;
        const py = (p.y[i]! - c[1]!) / RAW;
        const pz = (p.z[i]! - c[2]!) / RAW;
        if (!f.sphereVisible(px, py + 0.5, pz, 0.1)) continue;
        const key = `${p.x[i]! >>> 0}_${p.z[i]! >>> 0}_${(p.yaw[i]! | (p.scale[i]! << 16) | (((p.mesh[i]! << 6) | p.tint[i]!) << 24)) >>> 0}`;
        expect(all.has(key)).toBe(true);
      }
      expect(sel.visibleChunks).toBeLessThan((MAP.meta.sizeWu / PROP_CHUNK_WU) ** 2);
    }
  });

  it('LOD classes follow the chunk distance (LOD 0 near, impostor far)', () => {
    const cam = camera(256, 256, 160, 45, 40);
    const f = new Frustum().setFromViewProj(cam.viewProj);
    const sel = new PropSelection(grid.count);
    grid.select(f, cam.camPosInt, { eye: cam.camFrac, lod0Distance: 140, impostorDistance: 220, fixedLod: 1 }, sel);
    expect(sel.bucketCount[0]! + sel.bucketCount[2]! + sel.bucketCount[4]!).toBeGreaterThan(0);
    expect(sel.bucketCount[IMPOSTOR_BUCKET]).toBeGreaterThan(0);
  });
});

describe('CSM cascade fitting', () => {
  const sun = sunDirection(MAP.meta.light.azimuthDeg, MAP.meta.light.elevationDeg);

  it('caster and receiver matrices agree (same texel and depth for a world point)', () => {
    const cam = camera(250, 250, 95, 70);
    const fit = new CascadeFitter(sun, 512, 6, 36, 2048);
    const fr = fit.update(cam);
    expect(fr.refreshed).toBe(3);
    expect(fr.split).toBeGreaterThan(cam.near);
    expect(fr.end).toBeGreaterThan(fr.split);
    const P = [250 * RAW, scene.heights.raw(250 * RAW, 250 * RAW), 250 * RAW];
    for (let c = 0; c < 2; c++) {
      const cas = fit.cascades[c]!;
      const m = cas.lightVP;
      const a = cas.anchor;
      const p = [(P[0]! - a[0]!) / RAW, (P[1]! - a[1]!) / RAW, (P[2]! - a[2]!) / RAW];
      const clip = [0, 1, 2].map((i) => m[i]! * p[0]! + m[4 + i]! * p[1]! + m[8 + i]! * p[2]! + m[12 + i]!);
      const R = new Float32Array(16);
      fit.receiverMatrix(c, cam.camPosInt, R);
      const q = [(P[0]! - cam.camPosInt[0]!) / RAW, (P[1]! - cam.camPosInt[1]!) / RAW, (P[2]! - cam.camPosInt[2]!) / RAW];
      const uvz = [0, 1, 2].map((i) => R[i]! * q[0]! + R[4 + i]! * q[1]! + R[8 + i]! * q[2]! + R[12 + i]!);
      for (let i = 0; i < 3; i++) expect(uvz[i]!).toBeCloseTo(clip[i]! * 0.5 + 0.5, 4);
      for (let i = 0; i < 3; i++) {
        expect(uvz[i]!).toBeGreaterThan(0);
        expect(uvz[i]!).toBeLessThan(1);
      }
    }
    // Cascade 0 is sharper than cascade 1.
    expect(fit.cascades[0]!.texelWU).toBeLessThan(fit.cascades[1]!.texelWU);
  });

  it('caches the static layer: small camera moves do not refresh, a jump does', () => {
    const fit = new CascadeFitter(sun, 512, 6, 36, 2048);
    fit.update(camera(200, 200, 80, 60));
    expect(fit.update(camera(201, 200.5, 80, 60)).refreshed).toBe(0);
    expect(fit.update(camera(203, 201, 81, 61)).refreshed).toBe(0);
    expect(fit.update(camera(400, 380, 80, 60)).refreshed).not.toBe(0);
    expect(fit.update(camera(400, 380, 300, 60)).refreshed).not.toBe(0); // zoom out: sphere grows
  });

  it('every visible terrain point of the near slice lies inside cascade 0', () => {
    const cam = camera(150, 300, 60, 120);
    const fit = new CascadeFitter(sun, 512, 6, 36, 2048);
    fit.update(cam);
    const cas = fit.cascades[0]!;
    const f = new Frustum().setFromViewProj(cam.viewProj);
    for (let x = 60; x < 260; x += 4) {
      for (let z = 200; z < 400; z += 4) {
        const y = scene.heights.wu(x, z);
        const rel = [x - cam.camPosInt[0]! / RAW, y - cam.camPosInt[1]! / RAW, z - cam.camPosInt[2]! / RAW];
        if (!f.sphereVisible(rel[0]!, rel[1]!, rel[2]!, 0)) continue;
        const depth = rel[0]! * cam.forward[0]! + rel[1]! * cam.forward[1]! + rel[2]! * cam.forward[2]!;
        if (depth > fit.frame.split) continue;
        const a = cas.anchor;
        const r = cas.frustum.testAabb(x - a[0]! / RAW, y - a[1]! / RAW, z - a[2]! / RAW, x - a[0]! / RAW, y - a[1]! / RAW, z - a[2]! / RAW);
        expect(r).not.toBe(OUTSIDE);
      }
    }
  });
});

describe('shadow unit culler (reduced LOD)', () => {
  it('buckets visible units by (visual, LOD 1/2) and culls the rest', () => {
    const sun = sunDirection(MAP.meta.light.azimuthDeg, MAP.meta.light.elevationDeg);
    const cam = camera(scene.map.meta.starts[0]!.x / RAW, scene.map.meta.starts[0]!.z / RAW, 60, 45);
    const fit = new CascadeFitter(sun, 512, 6, 36, 2048);
    fit.update(cam);
    const cas = fit.cascades[0]!;
    const radii = new Float64Array(UNIT_VARIANTS.map((v) => Math.hypot(v.hull[0], v.hull[2]) / 2 + 1));
    const lodDist = new Float64Array(UNIT_VARIANTS.flatMap((v) => [v.lod[0], v.lod[1]]));
    const culler = new ShadowUnitCuller();
    const u = scene.units;
    const visible = culler.cull(u.writer.bytes, u.count, UNIT_VARIANTS.length, cas.frustum, cas.anchor, cam.camPosInt, cam.camFrac, radii, lodDist, 0.8);
    expect(visible).toBeGreaterThan(50);
    expect(visible + culler.culled).toBe(u.count);
    expect(culler.buckets.total).toBe(visible);
    let sum = 0;
    for (let k = 0; k < UNIT_VARIANTS.length * 2; k++) sum += culler.buckets.count[k]!;
    expect(sum).toBe(visible);
    // Everything the cascade box fully contains is kept.
    expect(cas.frustum.testAabb(-1, -1, -1, 1, 1, 1)).toBe(INSIDE);
  });
});
