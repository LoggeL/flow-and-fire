import { expect, test } from './support/silent-test.ts';
import type { FlightReport } from '../../apps/game/src/hooks.ts';
import { attachJson, captureErrors, expectNoErrors, MEASURED_LOCALLY, openGame, PERF_GATE, SERVERS, SETONS, waitTick, writeReport } from './support/game.ts';

// Default map Setons (1,024 WU, 8 starts; content/maps/src/setons.spec.md) without terrain LOD (M11
// comes in MS14): the page opens on Setons without `?map=`, the player's cubes stand at start 0 (SW
// mid), the enemy at start 1 (NO mid, across the land bridge), the camera starts over the own base.
// Gated (machine-independent): map identity, starts/spots, unit positions and heights, the whole map
// fits into the view at maximum zoom (all four corners on screen), terrain = 1 draw, draws ≤ 50.
// Measured (gated only with FAF_PERF_GATE=1, DECISIONS 16): load time (navigation → ready), FPS and
// frame times in the whole-map view, while zooming out from the base and on a flight across the map
// → test-results/setons-<browser>-<transport>.json. Locally measured, no iGPU runner (DECISIONS 5).

const MAX_DRAWS = 50;
const FPS_OF_RAF = 0.95;
const LOAD_LIMIT_MS = 8000;

for (const server of SERVERS) {
  test(`setons: Standardkarte, Starts, Gesamtansicht und Kameraflug ohne Terrain-LOD – ${server.label}`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const errors = captureErrors(page);
    const t0 = Date.now();
    await openGame(page, server.url, '', 1024, { pinMap: false });
    const loadWallMs = Date.now() - t0;
    await waitTick(page, 5);

    const info = await page.evaluate(() => {
      const h = window.__faf!;
      const own = h.ownHandles();
      const p = own.map((x) => h.unitPos(x)).filter((u) => u !== null);
      return {
        map: h.mapName,
        mapSimHash: h.mapSimHash,
        info: h.mapInfo(),
        camera: h.cameraState(),
        own: p.length,
        ownMaxDist: Math.max(...p.map((u) => Math.hypot(u!.x - 354, u!.z - 678))),
        army1: h.armyUnitCount(1),
        heights: h.unitHeights(),
        timings: h.loadTimings(),
      };
    });
    expect(info.map).toBe(SETONS.name);
    expect(info.mapSimHash).toBe(SETONS.mapSimHash);
    expect(info.info!.sizeWu).toBe(SETONS.sizeWu);
    expect(info.info!.starts).toHaveLength(SETONS.starts);
    expect(info.info!.spots.filter((s) => s.kind === 'mass')).toHaveLength(SETONS.mass);
    expect(info.info!.spots.filter((s) => s.kind === 'hydro')).toHaveLength(SETONS.hydro);
    // Camera over the own base (start 0), own cubes around it, the enemy at start 1.
    expect(Math.hypot(info.camera.x - SETONS.own.x, info.camera.z - SETONS.own.z)).toBeLessThan(0.5);
    expect(info.own).toBe(1000);
    expect(info.ownMaxDist).toBeLessThan(45);
    expect(info.army1).toBe(24);
    expect(info.heights.mismatches).toBe(0);

    // Whole-map view: maximum zoom over the map centre, all four corners on screen.
    const overview = await page.evaluate(() => {
      const h = window.__faf!;
      const cam = h.setCamera(512, 512, 1e6);
      const css = h.renderStats().css;
      const corners = [
        [0, 0],
        [1024, 0],
        [0, 1024],
        [1024, 1024],
      ].map(([x, z]) => h.project(x!, h.heightAt(x!, z!), z!));
      return { cam, css, corners };
    });
    for (const c of overview.corners) {
      expect(c, 'corner projects').not.toBeNull();
      expect(c!.x).toBeGreaterThanOrEqual(0);
      expect(c!.x).toBeLessThanOrEqual(overview.css.width);
      expect(c!.y).toBeGreaterThanOrEqual(0);
      expect(c!.y).toBeLessThanOrEqual(overview.css.height);
    }

    // Idle rAF rate of the engine (reference for the FPS criterion).
    const rafIdleHz = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let n = 0;
          let t0r = -1;
          const tick = (t: number): void => {
            if (t0r < 0) t0r = t;
            else n++;
            if (t - t0r >= 2000) resolve((n * 1000) / (t - t0r));
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
    );
    const maxD = overview.cam.distance;
    const whole: FlightReport = await page.evaluate(
      (d) =>
        window.__faf!.flight(
          [
            { x: 500, z: 500, distance: d },
            { x: 524, z: 524, distance: d },
          ],
          3000,
        ),
      maxD,
    );
    const zoomOut: FlightReport = await page.evaluate(
      (d) =>
        window.__faf!.flight(
          [
            { x: 354, z: 678, distance: 105 },
            { x: 512, z: 512, distance: d },
          ],
          3000,
        ),
      maxD,
    );
    const tour: FlightReport = await page.evaluate(
      () =>
        window.__faf!.flight(
          [
            { x: 354, z: 678, distance: 105 },
            { x: 512, z: 512, distance: 200 },
            { x: 670, z: 346, distance: 120 },
            { x: 922, z: 102, distance: 250 },
            { x: 994, z: 722, distance: 150 },
            { x: 770, z: 770, distance: 600 },
            { x: 102, z: 922, distance: 300 },
            { x: 250, z: 250, distance: 900 },
          ],
          8000,
        ),
    );

    const fpsOk = (f: FlightReport): boolean => f.fps >= 60 || f.fps >= FPS_OF_RAF * rafIdleHz;
    const report = {
      browser: testInfo.project.name,
      server: server.name,
      measuredLocally: MEASURED_LOCALLY,
      perfGate: PERF_GATE,
      map: info.map,
      load: { wallMs: loadWallMs, timings: info.timings },
      overview: { camera: overview.cam, corners: overview.corners, css: overview.css },
      rafIdleHz,
      wholeMap: whole,
      zoomOut,
      tour,
      criteria: {
        loadLe8s: loadWallMs <= LOAD_LIMIT_MS,
        wholeMapFps: whole.fps,
        zoomOutFps: zoomOut.fps,
        tourFps: tour.fps,
        fpsGe60OrRafRate: fpsOk(whole) && fpsOk(zoomOut) && fpsOk(tour),
        wholeMapGpuP95Ms: whole.gpuMs?.p95 ?? null,
        mainJsP95Ms: Math.max(whole.mainJsMs.p95, zoomOut.mainJsMs.p95, tour.mainJsMs.p95),
      },
    };
    writeReport(`setons-${testInfo.project.name}-${server.transport}`, report);
    await attachJson(testInfo, 'setons', report);

    for (const f of [whole, zoomOut, tour]) {
      expect(f.frames).toBeGreaterThan(30);
      expect(f.draws.max).toBeLessThanOrEqual(MAX_DRAWS);
      expect(f.drawsByPassMax.terrain).toBe(1);
      expect(f.drawsByPassMax.water).toBe(1);
    }
    // The whole-map view draws every terrain patch (32 × 32 chunks of 32 WU).
    expect(whole.terrainPatches.max).toBe(1024);
    if (PERF_GATE) {
      expect(loadWallMs, 'Laden kalt').toBeLessThanOrEqual(LOAD_LIMIT_MS);
      for (const f of [whole, zoomOut, tour]) {
        expect(f.fps, `FPS vs. idle rAF rate ${rafIdleHz.toFixed(1)} Hz`).toBeGreaterThanOrEqual(Math.min(60, FPS_OF_RAF * rafIdleHz));
        expect(f.mainJsMs.p95, 'Main-JS p95').toBeLessThanOrEqual(5);
      }
    }
    expectNoErrors(errors);
  });
}
