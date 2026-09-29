import { expect, test } from '@playwright/test';
import type { FlightReport } from '../../apps/game/src/hooks.ts';
import { attachJson, captureErrors, expectNoErrors, MEASURED_LOCALLY, openGame, PERF_GATE, SERVERS, waitTick, writeReport } from './support/game.ts';

// Camera flight (P2 + MS2 acceptance "Kameraflug mit 2.000 Platzhaltern ≥ 60 FPS bei ≤ 50 Draws"):
// `?units=2000&preset=medium` spreads 2,000 units of both armies over the land of hollow-ridge; a
// scripted 10 s flight crosses the map (plateaus, river, lake, mesas, overview). Gated in every
// frame: draw calls ≤ 50 (one terrain draw, one water draw, one draw per (visual, LOD), overlays);
// the Medium preset renders at render scale 0.8. Measured (gated only with FAF_PERF_GATE=1): FPS,
// Main-JS p50/p95, render JS, GPU time (EXT_disjoint_timer_query_webgl2 where available) →
// test-results/flight-<browser>-<transport>.json. Locally measured on an Apple M5 Pro, no iGPU
// runner (DECISIONS 5). The FPS criterion "≥ 60 FPS bzw. rAF-Takt der headless Engine" is measured
// against the engine's own rAF rate: 2 s with a resting camera before the flight (`rafIdleHz`),
// criterion fps ≥ 0.95 × rafIdleHz. The flight starts at 20 WU over a unit cluster, so all three
// LODs (LOD 0 below 48 WU at Medium) are drawn. Runs against both servers (SAB and transfer).

const MAX_DRAWS = 50;
/** FPS during the flight relative to the engine's idle rAF rate. */
const FPS_OF_RAF = 0.95;
const FLIGHT_MS = 10_000;
const PATH = [
  { x: 96, z: 96, distance: 110 },
  { x: 200, z: 150, distance: 70 },
  { x: 300, z: 212, distance: 90 },
  { x: 416, z: 416, distance: 120 },
  { x: 392, z: 262, distance: 60 },
  { x: 256, z: 256, distance: 180 },
  { x: 120, z: 250, distance: 50 },
  { x: 156, z: 356, distance: 90 },
  { x: 256, z: 256, distance: 420 },
];

for (const server of SERVERS) {
  test(`flight: 2.000 Platzhalter, 10-s-Kameraflug, Draws ≤ 50 in jedem Frame (Medium) – ${server.label}`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const errors = captureErrors(page);
    await openGame(page, server.url, 'units=2000&preset=medium', 2000);
    await waitTick(page, 5);
    const setup = await page.evaluate(() => {
      const h = window.__faf!;
      return {
        units: h.unitCount,
        army0: h.armyUnitCount(0),
        army1: h.armyUnitCount(1),
        render: h.renderStats(),
        heights: h.unitHeights(),
        rejected: h.hostErrors,
      };
    });
    expect(setup.units).toBe(2000);
    expect(setup.army0).toBeGreaterThan(900);
    expect(setup.army1).toBeGreaterThan(900);
    expect(setup.heights.mismatches).toBe(0);
    // Preset Medium: render scale 0.8 on the backbuffer.
    expect(setup.render.preset).toBe('medium');
    const dpr = setup.render.devicePixelRatio;
    expect(setup.render.backbuffer.width).toBe(Math.round(setup.render.css.width * dpr * 0.8));
    expect(setup.render.backbuffer.height).toBe(Math.round(setup.render.css.height * dpr * 0.8));

    // Close-up start over a unit cluster (20 WU: LOD 0), then the tour of the map.
    const first = await page.evaluate(() => {
      const h = window.__faf!;
      const u = h.unitPos(h.ownHandles()[0]!);
      return u === null ? null : { x: u.x, z: u.z };
    });
    expect(first).not.toBeNull();
    const path = [{ x: first!.x, z: first!.z, distance: 20 }, { x: first!.x + 6, z: first!.z + 4, distance: 24 }, ...PATH];

    // Warm-up pass (JIT, shader caches).
    await page.evaluate((p) => window.__faf!.flight(p, 2000), path);
    // Idle rAF rate of this engine: 2 s with the camera at rest in the start view of the flight.
    await page.evaluate((p) => window.__faf!.setCamera(p.x, p.z, p.distance), path[0]!);
    const rafIdleHz = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let n = 0;
          let t0 = -1;
          const tick = (t: number): void => {
            if (t0 < 0) t0 = t;
            else n++;
            if (t - t0 >= 2000) resolve((n * 1000) / (t - t0));
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
    );
    const flight: FlightReport = await page.evaluate(({ p, ms }) => window.__faf!.flight(p, ms), { p: path, ms: FLIGHT_MS });

    const report = {
      browser: testInfo.project.name,
      server: server.name,
      measuredLocally: MEASURED_LOCALLY,
      perfGate: PERF_GATE,
      preset: setup.render.preset,
      backbuffer: setup.render.backbuffer,
      units: setup.units,
      armies: [setup.army0, setup.army1],
      path,
      rafIdleHz,
      flight,
      criteria: {
        drawsLe50EveryFrame: flight.draws.max <= MAX_DRAWS,
        fps: flight.fps,
        rafIdleHz,
        fpsRatio: flight.fps / rafIdleHz,
        fpsGe60OrRafRate: flight.fps >= 60 || flight.fps >= FPS_OF_RAF * rafIdleHz,
        allLodsUsed: flight.lodInstancesMax.every((n) => n > 0),
        mainJsP95Ms: flight.mainJsMs.p95,
        gpuP95Ms: flight.gpuMs?.p95 ?? null,
      },
    };
    writeReport(`flight-${testInfo.project.name}-${server.transport}`, report);
    await attachJson(testInfo, 'flight', report);

    expect(flight.frames).toBeGreaterThan(100);
    expect(flight.draws.over50).toBe(0);
    expect(flight.draws.max).toBeLessThanOrEqual(MAX_DRAWS);
    expect(flight.drawsByPassMax.terrain).toBe(1);
    expect(flight.drawsByPassMax.water).toBe(1);
    // Culling and LOD are active: views where most instances are culled, and all three LODs used.
    expect(flight.culledInstances.max).toBeGreaterThan(1000);
    expect(flight.lodInstancesMax.length).toBe(3);
    expect(flight.lodInstancesMax.every((n) => n > 0), `instances per LOD (max per frame): ${flight.lodInstancesMax.join('/')}`).toBe(true);
    if (PERF_GATE) {
      expect(flight.fps, `FPS vs. idle rAF rate ${rafIdleHz.toFixed(1)} Hz`).toBeGreaterThanOrEqual(Math.min(60, FPS_OF_RAF * rafIdleHz));
      expect(flight.mainJsMs.p95, 'Main-JS p95').toBeLessThanOrEqual(5);
    }
    expectNoErrors(errors);
  });
}
