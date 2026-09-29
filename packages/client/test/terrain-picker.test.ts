// G15: heightmap ray picking against a float64 reference on hollow-ridge.
import { RAW_PER_WU, RtsCamera } from '@faf/render';
import { describe, expect, it } from 'vitest';
import { createRtsMap } from '@faf/formats';
import { TerrainPicker } from '../src/terrain-picker.ts';
import { ClientMap } from '../src/map.ts';
import { hollowRidge, prng } from './support/map.ts';

/**
 * Reference: march the ray with 1/64 WU steps from where it enters the map's height band, then 40
 * bisection steps on the first bracket (float64, continuous bilinear surface, no chunk skipping).
 */
function reference(map: ClientMap, o: number[], d: number[]): number[] | null {
  const size = map.sizeWu;
  const f = (t: number) => o[1]! + d[1]! * t - map.heightWU(o[0]! + d[0]! * t, o[2]! + d[2]! * t);
  const inMap = (t: number) => {
    const x = o[0]! + d[0]! * t;
    const z = o[2]! + d[2]! * t;
    return x >= 0 && x <= size && z >= 0 && z <= size;
  };
  const top = map.maxHeightWU + 1e-6;
  let t = d[1]! < 0 ? Math.max(0, (top - o[1]!) / d[1]!) : 0;
  const tEnd = d[1]! < 0 ? (map.minHeightWU - 1e-6 - o[1]!) / d[1]! : d[1]! > 0 ? (top - o[1]!) / d[1]! : 2 * size;
  const step = 1 / 64;
  let prev = t;
  let entered = false;
  for (; t <= tEnd + step; t += step) {
    if (!inMap(t)) {
      if (entered) return null;
      prev = t;
      continue;
    }
    entered = true;
    if (f(t) <= 0) {
      let a = prev;
      let b = t;
      if (!inMap(a) || f(a) <= 0) return [o[0]! + d[0]! * b, o[1]! + d[1]! * b, o[2]! + d[2]! * b];
      for (let i = 0; i < 40; i++) {
        const m = 0.5 * (a + b);
        if (f(m) > 0) a = m;
        else b = m;
      }
      const r = 0.5 * (a + b);
      return [o[0]! + d[0]! * r, o[1]! + d[1]! * r, o[2]! + d[2]! * r];
    }
    prev = t;
  }
  return null;
}

describe('TerrainPicker (G15)', () => {
  it('matches the float64 reference within 1/16 WU on 10,000 random rays over hollow-ridge', () => {
    const map = hollowRidge();
    const picker = new TerrainPicker(map);
    const rnd = prng(0x5eed);
    const times: number[] = [];
    let hits = 0;
    let misses = 0;
    let maxDxz = 0;
    let maxDy = 0;
    for (let i = 0; i < 10_000; i++) {
      // Eye above the map (some outside the edge), target on the terrain, plus jitter.
      const ex = -40 + rnd() * 592;
      const ez = -40 + rnd() * 592;
      const ey = map.heightWU(ex, ez) + 3 + rnd() * rnd() * 400;
      const tx = rnd() * 512;
      const tz = rnd() * 512;
      const ty = map.heightWU(tx, tz) + (rnd() - 0.5) * 6;
      let dx = tx - ex;
      let dy = ty - ey;
      let dz = tz - ez;
      const l = Math.hypot(dx, dy, dz);
      dx /= l;
      dy /= l;
      dz /= l;
      const t0 = performance.now();
      const ok = picker.pickRay(ex, ey, ez, dx, dy, dz);
      times.push(performance.now() - t0);
      const ref = reference(map, [ex, ey, ez], [dx, dy, dz]);
      if (ref === null) {
        misses++;
        expect(picker.hit, `ray ${i}: reference misses, picker hit`).toBe(false);
        expect(ok).toBe(dy < 0);
        continue;
      }
      hits++;
      expect(picker.hit, `ray ${i}: picker missed`).toBe(true);
      const dxz = Math.hypot(picker.wuX - ref[0]!, picker.wuZ - ref[2]!);
      // y: the picked (sim) height vs the terrain height at the reference hit, and the ray points.
      // (They differ only where a ray from outside enters the map below the edge height.)
      const dyy = Math.max(Math.abs(picker.y / RAW_PER_WU - map.heightWU(ref[0]!, ref[2]!)), Math.abs(picker.wuY - ref[1]!));
      maxDxz = Math.max(maxDxz, dxz);
      maxDy = Math.max(maxDy, dyy);
      expect(dxz, `ray ${i}`).toBeLessThanOrEqual(1 / 16);
      expect(dyy, `ray ${i}`).toBeLessThanOrEqual(1 / 16);
      // Raw result: rounded xz on the map, y is the sim height there.
      expect(picker.y).toBe(map.heightAtRaw(picker.x, picker.z));
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)]!;
    const p50 = times[Math.floor(times.length * 0.5)]!;
    console.log(
      `[G15] 10,000 rays: ${hits} hits, ${misses} misses; max |Δxz| ${maxDxz.toExponential(2)} WU, max |Δy| ${maxDy.toExponential(2)} WU; ` +
        `pick p50 ${(p50 * 1000).toFixed(1)} µs, p95 ${(p95 * 1000).toFixed(1)} µs`,
    );
    expect(hits).toBeGreaterThan(8000);
  });

  it('camera pick: projects back onto the cursor and lands on the terrain', () => {
    const map = hollowRidge();
    const picker = new TerrainPicker(map);
    const cam = new RtsCamera({ distance: 90 });
    cam.setViewport(1280, 720);
    cam.setTargetWU(300, map.heightWU(300, 212), 212);
    cam.update();
    const out = new Float64Array(4);
    for (const [px, py] of [
      [640, 360],
      [10, 700],
      [1270, 30],
      [400, 500],
    ] as const) {
      expect(picker.pick(cam, px, py)).toBe(true);
      expect(picker.hit).toBe(true);
      cam.project(picker.wuX * RAW_PER_WU, picker.wuY * RAW_PER_WU, picker.wuZ * RAW_PER_WU, out);
      expect(Math.abs(out[0]! - px)).toBeLessThan(0.05);
      expect(Math.abs(out[1]! - py)).toBeLessThan(0.05);
      expect(Math.abs(picker.wuY - map.heightWU(picker.wuX, picker.wuZ))).toBeLessThan(1 / 256);
    }
  });

  it('fallback: beyond the map edge → edge-height plane, clamped; above the horizon → no pick', () => {
    const map = hollowRidge();
    const picker = new TerrainPicker(map);
    // Looking from inside the map out over the east edge, slightly downwards.
    const d = [1, -0.02, 0];
    const l = Math.hypot(d[0]!, d[1]!, d[2]!);
    expect(picker.pickRay(500, 40, 256, d[0]! / l, d[1]! / l, d[2]! / l)).toBe(true);
    expect(picker.hit).toBe(false);
    expect(picker.clamped).toBe(true);
    expect(picker.x).toBe(512 * RAW_PER_WU);
    expect(picker.y).toBe(map.heightAtRaw(picker.x, picker.z));
    expect(picker.pickRay(256, 60, 256, 0, 1, 0)).toBe(false);
    expect(picker.pickRay(256, 60, 256, 1, 0, 0)).toBe(false);
    // Straight down onto a spot: exact height.
    expect(picker.pickRay(96.5, 80, 96.25, 0, -1, 0)).toBe(true);
    expect(picker.hit).toBe(true);
    expect(Math.abs(picker.wuY - map.heightWU(96.5, 96.25))).toBeLessThan(1e-3);
  });
});

describe('TerrainPicker on a 1,024 WU map (PLAN §3.1: tested up to 1,024 WU; next standard map size)', () => {
  /** 1,024 WU hills (heights up to ≈ 60 WU) with steps exactly on chunk borders. */
  function bigMap(): ClientMap {
    return new ClientMap(
      createRtsMap({
        sizeWu: 1024,
        name: 'big-hills',
        heights: (x, z) => {
          const hills = 3000 + Math.round(2500 * Math.sin(x / 57) * Math.cos(z / 43));
          const terrace = (x & 31) === 0 || (z & 31) === 0 ? 900 : 0; // ridges on every chunk border
          return Math.max(0, Math.min(0xffff, hills + terrace + ((x * 7 + z * 13) % 64) * 20));
        },
      }),
    );
  }

  it('matches the float64 reference within 1/16 WU on 2,000 rays aimed at chunk borders and map edges', () => {
    const map = bigMap();
    expect(map.chunksPerSide).toBe(32);
    const picker = new TerrainPicker(map);
    const rnd = prng(0x1024);
    let hits = 0;
    let grazes = 0;
    for (let i = 0; i < 2000; i++) {
      // Targets on chunk borders (k·32 ± 0.01) or within 3 WU of the far map edge.
      const onBorder = (): number => Math.min(1024, Math.max(0, Math.floor(rnd() * 33) * 32 + (rnd() - 0.5) * 0.02));
      const tx = i % 4 === 3 ? 1021 + rnd() * 3 : onBorder();
      const tz = i % 4 === 2 ? 1021 + rnd() * 3 : i % 2 === 0 ? onBorder() : rnd() * 1024;
      const ex = tx + (rnd() - 0.5) * 300;
      const ez = tz + (rnd() - 0.5) * 300;
      const ey = map.heightWU(ex, ez) + 5 + rnd() * 300;
      const ty = map.heightWU(tx, tz);
      let dx = tx - ex;
      let dy = ty - ey;
      let dz = tz - ez;
      const l = Math.hypot(dx, dy, dz);
      dx /= l;
      dy /= l;
      dz /= l;
      picker.pickRay(ex, ey, ez, dx, dy, dz);
      const ref = reference(map, [ex, ey, ez], [dx, dy, dz]);
      if (ref === null) {
        if (picker.hit) {
          // Grazing touch the coarse reference stepped over (see below): must be on the surface.
          expect(Math.abs(picker.wuY - map.heightWU(picker.wuX, picker.wuZ)), `ray ${i}: reference misses, picker hit off the surface`).toBeLessThanOrEqual(1 / 16);
          grazes++;
        }
        continue;
      }
      hits++;
      expect(picker.hit, `ray ${i}: picker missed a terrain hit`).toBe(true);
      const dist = Math.hypot(picker.wuX - ref[0]!, picker.wuZ - ref[2]!);
      if (dist > 1 / 16) {
        // The 1/64-step reference can step over a grazing touch of a one-sample ridge (chunk border
        // terraces) that the picker's per-cell quadratic test finds: then the pick must lie earlier
        // on the ray and on the surface (≤ 1/16 WU, the G15 tolerance).
        const tPick = (picker.wuX - ex) / dx;
        const tRef = (ref[0]! - ex) / dx;
        expect(tPick, `ray ${i}: pick after the reference hit`).toBeLessThan(tRef);
        expect(Math.abs(picker.wuY - map.heightWU(picker.wuX, picker.wuZ)), `ray ${i}: pick off the surface`).toBeLessThanOrEqual(1 / 16);
        grazes++;
      }
      expect(picker.x).toBeLessThanOrEqual(1024 * RAW_PER_WU);
      expect(picker.z).toBeLessThanOrEqual(1024 * RAW_PER_WU);
      expect(picker.y).toBe(map.heightAtRaw(picker.x, picker.z));
    }
    expect(hits).toBeGreaterThan(1800);
    // Sharp one-sample ridges on every chunk border make grazing touches common (≈ 6 %).
    expect(grazes).toBeLessThan(hits / 4);
  });
});
