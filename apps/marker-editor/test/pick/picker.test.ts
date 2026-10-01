import type { RtsMap } from '@faf/formats';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PICK_STEP_WU, projectWu, TerrainPicker, worldToClient } from '../../src/pick/picker.ts';
import { cliffMap, FakeView, flatMap, prng, rampMap, SYNTH_SIZE, type Pose } from './support.ts';

const C = SYNTH_SIZE / 2;
/** Several camera angles: steep, medium, flat; different yaws and distances. */
const POSES: readonly Pose[] = [
  { targetX: C, targetZ: C, distance: 70, yaw: 0, pitch: (80 * Math.PI) / 180 },
  { targetX: C, targetZ: C, distance: 80, yaw: 0.9, pitch: (55 * Math.PI) / 180 },
  { targetX: C - 6, targetZ: C + 4, distance: 90, yaw: 2.5, pitch: (38 * Math.PI) / 180 },
  { targetX: C + 5, targetZ: C - 8, distance: 60, yaw: 4.1, pitch: (25 * Math.PI) / 180 },
  { targetX: C, targetZ: C, distance: 50, yaw: 5.6, pitch: (65 * Math.PI) / 180 },
];

/** MS2 criterion: picking error <= 1/16 WU. */
const MAX_ERR_WU = 1 / 16;
const SAMPLES = 1000;

/**
 * Depth (WU) beyond which a terrain crossing counts as occluding. Crests grazed by less than this
 * are sub-pixel slivers (sampleHeightRaw is a staircase at 1/256 WU resolution); the picker may
 * pass them.
 */
const OCCLUSION_EPS_WU = 0.02;
function occlusion(view: FakeView, p: THREE.Vector3): { depth: number; distWu: number } {
  const o = view.camera.getWorldPosition(new THREE.Vector3());
  const d = p.clone().sub(o);
  const len = d.length();
  d.normalize();
  const horiz = Math.hypot(d.x, d.z);
  const dt = horiz > 1e-9 ? 1 / 256 / horiz : 1 / 256;
  let depth = 0;
  let distWu = 0;
  for (let t = 0; t < len; t += dt) {
    const x = o.x + d.x * t;
    const z = o.z + d.z * t;
    if (x < 0 || z < 0 || x > SYNTH_SIZE || z > SYNTH_SIZE) continue;
    const dd = view.heightWuAt(x, z) - (o.y + d.y * t);
    if (dd > depth) {
      depth = dd;
      distWu = (len - t) * horiz;
    }
  }
  return { depth, distWu };
}

/**
 * True if the terrain hides world point p from the camera: independent dense march (1/256 WU
 * horizontally) along the camera ray up to 1/16 WU (horizontally) before p.
 */
function occluded(view: FakeView, p: THREE.Vector3): boolean {
  const o = view.camera.getWorldPosition(new THREE.Vector3());
  const d = p.clone().sub(o);
  const len = d.length();
  d.normalize();
  const horiz = Math.hypot(d.x, d.z);
  const dt = horiz > 1e-9 ? 1 / 256 / horiz : 1 / 256;
  const stop = len - (horiz > 1e-9 ? 1 / 16 / horiz : 1 / 16);
  for (let t = 0; t < stop; t += dt) {
    const x = o.x + d.x * t;
    const z = o.z + d.z * t;
    if (x < 0 || z < 0 || x > SYNTH_SIZE || z > SYNTH_SIZE) continue;
    if (o.y + d.y * t < view.heightWuAt(x, z) - OCCLUSION_EPS_WU) return true;
  }
  return false;
}

interface Accuracy {
  readonly samples: number;
  readonly occluded: number;
  readonly offscreen: number;
  readonly maxErrWu: number;
  readonly meanErrWu: number;
}

function measure(map: RtsMap, seed: number): Accuracy {
  const view = new FakeView(map);
  const picker = new TerrainPicker(view);
  const rnd = prng(seed);
  let samples = 0;
  let occ = 0;
  let off = 0;
  let maxErr = 0;
  let sumErr = 0;
  let guard = 0;
  while (samples < SAMPLES && guard++ < 50 * SAMPLES) {
    view.setPose(POSES[samples % POSES.length]!);
    const x = 0.5 + rnd() * (SYNTH_SIZE - 1);
    const z = 0.5 + rnd() * (SYNTH_SIZE - 1);
    const p = new THREE.Vector3(x, view.heightWuAt(x, z), z);
    const px = projectWu(view, p.x, p.y, p.z);
    if (px === null) {
      off++;
      continue;
    }
    if (occluded(view, p)) {
      occ++;
      continue;
    }
    const hit = picker.pick(px.x, px.y);
    expect(hit, `pick at (${x}, ${z})`).not.toBeNull();
    const err = Math.hypot(hit!.x / 4096 - x, hit!.z / 4096 - z);
    maxErr = Math.max(maxErr, err);
    sumErr += err;
    samples++;
  }
  return { samples, occluded: occ, offscreen: off, maxErrWu: maxErr, meanErrWu: sumErr / Math.max(1, samples) };
}

describe('TerrainPicker accuracy (MS2: <= 1/16 WU, 1000 samples, 5 camera angles)', () => {
  const cases: [string, () => RtsMap][] = [
    ['flat', flatMap],
    ['ramp', rampMap],
    ['cliff', cliffMap],
  ];
  for (const [name, make] of cases) {
    it(`${name}`, () => {
      const a = measure(make(), 0x5eed + name.length);
      console.info(
        `[picker] ${name}: ${a.samples} samples, max err ${a.maxErrWu.toFixed(6)} WU, mean ${a.meanErrWu.toFixed(6)} WU, occluded ${a.occluded}, offscreen ${a.offscreen}`,
      );
      expect(a.samples).toBe(SAMPLES);
      expect(a.maxErrWu).toBeLessThanOrEqual(MAX_ERR_WU);
      if (name !== 'cliff') expect(a.occluded).toBe(0);
      else expect(a.occluded).toBeGreaterThan(0);
    });
  }

  it('matches the analytic ray/plane intersection on the flat map', () => {
    const view = new FakeView(flatMap());
    const picker = new TerrainPicker(view);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -10);
    const rc = new THREE.Raycaster();
    const rnd = prng(99);
    let checked = 0;
    for (let i = 0; i < 400; i++) {
      view.setPose(POSES[i % POSES.length]!);
      const cx = view.rect.left + rnd() * view.rect.width;
      const cy = view.rect.top + rnd() * view.rect.height;
      rc.setFromCamera(new THREE.Vector2(((cx - view.rect.left) / view.rect.width) * 2 - 1, -(((cy - view.rect.top) / view.rect.height) * 2 - 1)), view.camera);
      const exact = rc.ray.intersectPlane(plane, new THREE.Vector3());
      const hit = picker.pick(cx, cy);
      const inside = exact !== null && exact.x >= 0 && exact.z >= 0 && exact.x <= SYNTH_SIZE && exact.z <= SYNTH_SIZE;
      if (!inside) {
        expect(hit).toBeNull();
        continue;
      }
      expect(hit).not.toBeNull();
      expect(Math.abs(hit!.x / 4096 - exact.x)).toBeLessThanOrEqual(1 / 256);
      expect(Math.abs(hit!.z / 4096 - exact.z)).toBeLessThanOrEqual(1 / 256);
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('does not tunnel through the thin ridge with grazing rays', () => {
    const view = new FakeView(cliffMap());
    const picker = new TerrainPicker(view);
    // Low camera south of the ridge (z = 48) looking north across it.
    view.setPose({ targetX: 16, targetZ: 40, distance: 30, yaw: 0, pitch: (14 * Math.PI) / 180 });
    let hits = 0;
    for (let y = 0; y < view.rect.height; y += 3) {
      for (let x = 0; x < view.rect.width; x += 97) {
        const cx = view.rect.left + x;
        const cy = view.rect.top + y;
        const hit = picker.pickWu(cx, cy);
        if (hit === null) continue;
        hits++;
        // The hit is on the surface and nothing hides it.
        // sampleHeightRaw quantizes x/z to 1/256 WU: on the 20:1 cliff face the surface is a
        // staircase with 20/256 ≈ 0.08 WU steps.
        expect(Math.abs(hit.y - view.heightWuAt(hit.x, hit.z))).toBeLessThan(0.1);
        const hp = new THREE.Vector3(hit.x, hit.y, hit.z);
        if (occluded(view, hp)) console.info(JSON.stringify({ hit, occ: occlusion(view, hp) }));
        expect(occluded(view, hp)).toBe(false);
      }
    }
    expect(hits).toBeGreaterThan(100);
  });
});

describe('TerrainPicker edge cases', () => {
  it('returns Fx raw integers', () => {
    const view = new FakeView(rampMap());
    view.setPose(POSES[1]!);
    const hit = new TerrainPicker(view).pick(view.rect.left + 640, view.rect.top + 360);
    expect(hit).not.toBeNull();
    expect(Number.isInteger(hit!.x) && Number.isInteger(hit!.z)).toBe(true);
  });

  it('returns null outside the map, without a map and for an empty canvas', () => {
    const view = new FakeView(flatMap());
    // Flat view towards the horizon: the top rows look past the map.
    view.setPose({ targetX: C, targetZ: C, distance: 40, yaw: 0, pitch: (15 * Math.PI) / 180 });
    const picker = new TerrainPicker(view);
    expect(picker.pick(view.rect.left + 640, view.rect.top + 2)).toBeNull();
    expect(picker.pick(view.rect.left + 640, view.rect.top + 600)).not.toBeNull();
    view.setMap(null);
    expect(picker.pick(view.rect.left + 640, view.rect.top + 600)).toBeNull();
    const empty = new FakeView(flatMap(), { left: 0, top: 0, width: 0, height: 0 });
    expect(new TerrainPicker(empty).pick(0, 0)).toBeNull();
  });

  it('uses the new heights after the map changed', () => {
    const view = new FakeView(flatMap());
    view.setPose(POSES[0]!);
    const picker = new TerrainPicker(view);
    const px = { x: view.rect.left + 700, y: view.rect.top + 300 };
    const a = picker.pickWu(px.x, px.y)!;
    view.setMap(rampMap());
    const b = picker.pickWu(px.x, px.y)!;
    expect(Math.abs(a.y - 10)).toBeLessThan(1e-3);
    expect(Math.abs(b.y - view.heightWuAt(b.x, b.z))).toBeLessThan(0.01);
    expect(Math.abs(b.y - a.y)).toBeGreaterThan(1);
  });

  it('march step constant satisfies the MS2 limit', () => {
    expect(PICK_STEP_WU).toBeLessThanOrEqual(0.5);
  });
});

describe('worldToClient', () => {
  it('worldToClient ∘ pick is the identity (< 0.1 px on flat/ramp; < 1/16 WU re-pick everywhere)', () => {
    for (const make of [flatMap, rampMap, cliffMap]) {
      let worst = 0;
      let worstWu = 0;
      const view = new FakeView(make());
      const picker = new TerrainPicker(view);
      const rnd = prng(1234);
      let n = 0;
      for (let i = 0; i < 300; i++) {
        view.setPose(POSES[i % POSES.length]!);
        const cx = view.rect.left + 40 + rnd() * (view.rect.width - 80);
        const cy = view.rect.top + 40 + rnd() * (view.rect.height - 80);
        const hit = picker.pick(cx, cy);
        if (hit === null) continue;
        const back = worldToClient(view, hit.x, hit.z);
        expect(back).not.toBeNull();
        // Rounding to Fx raw moves the point by <= 1/8192 WU: far below a pixel on gentle
        // terrain. On the 20:1 cliff face the 1/256 WU height quantization of sampleHeightRaw
        // can move the re-projected point by ~1 px, so there the re-pick is compared in WU.
        const d = Math.hypot(back!.x - cx, back!.y - cy);
        worst = Math.max(worst, d);
        if (make !== cliffMap) expect(d).toBeLessThan(0.1);
        const again = picker.pick(back!.x, back!.y);
        expect(again).not.toBeNull();
        const dWu = Math.hypot(again!.x - hit.x, again!.z - hit.z) / 4096;
        worstWu = Math.max(worstWu, dWu);
        expect(dWu).toBeLessThanOrEqual(1 / 16);
        n++;
      }
      console.info(`[picker] worldToClient∘pick ${make.name}: max ${worst.toFixed(4)} px, re-pick max ${worstWu.toFixed(5)} WU over ${n} picks`);
      expect(n).toBeGreaterThan(100);
    }
  });

  it('returns null behind the camera and off-canvas', () => {
    const view = new FakeView(flatMap());
    view.setPose({ targetX: C, targetZ: C, distance: 20, yaw: 0, pitch: (30 * Math.PI) / 180 });
    // yaw 0: the camera sits at +z of the target looking towards -z; z = 63 is behind it.
    expect(worldToClient(view, C * 4096, 63 * 4096)).toBeNull();
    expect(worldToClient(view, C * 4096, C * 4096)).not.toBeNull();
    const centre = worldToClient(view, C * 4096, C * 4096)!;
    expect(Math.abs(centre.x - (view.rect.left + view.rect.width / 2))).toBeLessThan(0.5);
    expect(Math.abs(centre.y - (view.rect.top + view.rect.height / 2))).toBeLessThan(0.5);
  });
});
