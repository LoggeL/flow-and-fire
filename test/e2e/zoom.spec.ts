import { expect, test, type Page } from '@playwright/test';
import { attachJson, captureErrors, expectNoErrors, MEASURED_LOCALLY, openGame, PERF_GATE, SERVERS, waitTick, writeReport } from './support/game.ts';
import {
  anyNear,
  boxesIntersect,
  boxHit,
  colorDist,
  cssShot,
  dragBox,
  focusCanvas,
  frames,
  pauseSim,
  resumeSim,
  rng,
  screenUnits,
  selection,
  teamColored,
  uiRects,
  type Box,
  type CssShot,
  type ScreenUnit,
} from './support/ms3.ts';

// Strategic zoom (C2, MS3): the mouse wheel zooms continuously from the start view (45 WU) to the
// whole map. Gated always (machine-independent):
//   - the whole-map level Z2 is reached; there the IconPass is exactly 1 draw and the UnitPass 0,
//   - at the projected positions of isolated units the icons show the team color (≥ 95 %),
//   - during the transition every isolated unit position shows a mesh or an icon: pixel difference
//     against a reference frame without units (same camera, units hidden) ≥ 60 at ≥ 95 % of them,
//   - during a 3-s zoom flight the IconPass is one draw in every frame with visible icons, no unit
//     draw in Z2,
//   - box select on the icons at whole-map zoom with ≥ 200 real mouse drags: hit rate ≥ 99 %,
//     wrongly selected ≤ 1 % (expectation from the icon squares of `screenUnits`).
// Measured and reported, gated only with FAF_PERF_GATE=1: FPS of the 3-s zoom flight ≥ 60, or
// ≥ 0.95 × the engine's idle rAF rate where that is below 60 (headless engines may throttle).

const QUERY = 'spawn=tanks&units=400';
/** Single tanks on open land (alternating armies): isolated icons/meshes for the pixel checks. */
const SINGLES = [
  [200, 40], [312, 472], [260, 60], [252, 452], [40, 200], [472, 312], [60, 260], [452, 252],
  [180, 130], [382, 332], [130, 180], [332, 382], [220, 160], [292, 352], [160, 220], [352, 292],
] as const;
const BOXES = 220;
const VISIBLE_DIFF = 60;

function own(units: readonly ScreenUnit[]): ScreenUnit[] {
  return units.filter((u) => u.army === 0);
}

function onCanvas(u: ScreenUnit, ui: readonly Box[], margin: number): boolean {
  if (u.x === null || u.y === null || !u.onScreen) return false;
  if (u.x < margin || u.y < margin || u.x > 1280 - margin || u.y > 720 - margin) return false;
  return ui.every((r) => !boxesIntersect({ x0: u.x! - margin, y0: u.y! - margin, x1: u.x! + margin, y1: u.y! + margin }, r));
}

/**
 * Units without another unit centre within `px` (pixel checks need a clean neighbourhood);
 * `otherArmyOnly`: only units of the other army count as neighbours (team-color check).
 */
function isolated(units: readonly ScreenUnit[], px: number, ui: readonly Box[], otherArmyOnly = false): ScreenUnit[] {
  const on = units.filter((u) => onCanvas(u, ui, 14));
  return on.filter((u) => on.every((o) => o === u || (otherArmyOnly && o.army === u.army) || Math.hypot(o.x! - u.x!, o.y! - u.y!) >= px));
}

/** Largest color difference within ±r px of (x, y) between the frame and the no-units reference. */
function maxDiff(a: CssShot, b: CssShot, x: number, y: number, r: number): number {
  let m = 0;
  const step = 1 / a.k;
  for (let dy = -r; dy <= r + 1e-9; dy += step) for (let dx = -r; dx <= r + 1e-9; dx += step) m = Math.max(m, colorDist(a.at(x + dx, y + dy), b.at(x + dx, y + dy)));
  return m;
}

async function hiddenReference(page: Page): Promise<CssShot> {
  await page.evaluate(() => window.__faf!.setUnitsHidden(true));
  await frames(page, 2);
  const ref = await cssShot(page);
  await page.evaluate(() => window.__faf!.setUnitsHidden(false));
  await frames(page, 2);
  return ref;
}

/** Idle rAF rate of the engine (Hz) over `ms`. */
async function idleRafHz(page: Page, ms: number): Promise<number> {
  return page.evaluate(
    (dur) =>
      new Promise<number>((resolve) => {
        let n = 0;
        let t0 = 0;
        const f = (t: number): void => {
          if (t0 === 0) t0 = t;
          else n++;
          if (t - t0 >= dur) resolve((n * 1000) / (t - t0));
          else requestAnimationFrame(f);
        };
        requestAnimationFrame(f);
      }),
    ms,
  );
}

interface StepRecord {
  step: number;
  distance: number;
  level: number;
  iconForce: number;
  draws: { units: number; icons: number };
  faded: number;
  iconOnly: number;
  checked: number;
  visible: number;
  minDiff: number | null;
}

for (const server of SERVERS) {
  test(`zoom: Mausrad bis Gesamtkarte (Z2), IconPass 1 Draw, Teamfarben-Icons, lückenloser Übergang, Zoomflug, Box-Select auf Icons – ${server.label}`, async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const errors = captureErrors(page);
    await openGame(page, server.url, QUERY, 600);
    await waitTick(page, 10);
    const n0 = await page.evaluate(() => window.__faf!.unitCount);
    const spawnOut = await page.evaluate((pts) => {
      const h = window.__faf!;
      const out: boolean[] = [];
      pts.forEach(([x, z], i) => {
        h.setCamera(x, z);
        out.push(h.console(`spawn 1 ${i % 2} lnd_t1_tank`).ok);
      });
      return out;
    }, SINGLES as unknown as [number, number][]);
    expect(spawnOut.every(Boolean)).toBe(true);
    await page.waitForFunction((n) => window.__faf!.unitCount >= n, n0 + SINGLES.length - 2);
    await page.evaluate((s) => window.__faf!.setCamera(s.x, s.z, 45), { x: 96, z: 96 });
    await waitTick(page, 40);
    await pauseSim(page);
    const idleHz = await idleRafHz(page, 2000);
    await focusCanvas(page);
    const ui = await uiRects(page);
    const zoom0 = await page.evaluate(() => window.__faf!.zoom());
    expect(zoom0.level).toBe(0);

    // 1. Wheel zoom (real wheel events at the viewport centre) up to the whole map; at every step a
    //    reference frame without units: each isolated unit position shows a mesh or an icon.
    await page.mouse.move(700, 380);
    const steps: StepRecord[] = [];
    let transitionChecked = 0;
    let transitionVisible = 0;
    for (let i = 0; i < 40; i++) {
      await page.mouse.wheel(0, 100);
      await frames(page, 3);
      const z = await page.evaluate(() => window.__faf!.zoom());
      const rs = await page.evaluate(() => window.__faf!.renderStats());
      const units = await screenUnits(page);
      const iso = isolated(units, 20, ui).slice(0, 80);
      const shot = await cssShot(page);
      const ref = await hiddenReference(page);
      let visible = 0;
      let minDiff: number | null = null;
      for (const u of iso) {
        const r = u.icon || u.fade > 0 ? 4 : Math.max(2, Math.min(6, u.radiusPx * 0.6));
        const d = maxDiff(shot, ref, u.x!, u.y!, r);
        if (d >= VISIBLE_DIFF) visible++;
        minDiff = minDiff === null ? d : Math.min(minDiff, d);
      }
      transitionChecked += iso.length;
      transitionVisible += visible;
      steps.push({
        step: i + 1,
        distance: z.distance,
        level: z.level,
        iconForce: z.iconForce,
        draws: { units: rs.drawsByPass.units, icons: rs.drawsByPass.icons },
        faded: rs.fadedUnits,
        iconOnly: rs.iconOnlyUnits,
        checked: iso.length,
        visible,
        minDiff,
      });
      // IconPass is always one draw once any icon is visible.
      if (rs.iconCount > 0) expect(rs.drawsByPass.icons, `step ${i + 1}: IconPass draws`).toBe(1);
      if (z.distance >= z.maxDistance - 1e-6) break;
    }
    const zMax = await page.evaluate(() => window.__faf!.zoom());
    expect(zMax.distance).toBeCloseTo(zMax.maxDistance, 6);
    expect(zMax.level).toBe(2);
    // Continuous: many small steps, the level never jumps back.
    expect(steps.length).toBeGreaterThanOrEqual(10);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]!.distance).toBeGreaterThan(steps[i - 1]!.distance);
      expect(steps[i]!.level).toBeGreaterThanOrEqual(steps[i - 1]!.level);
    }
    expect(steps.some((s) => s.faded > 0 && s.draws.units > 0 && s.draws.icons === 1), 'crossfade band crossed with meshes and icons').toBe(true);
    expect(transitionChecked).toBeGreaterThanOrEqual(100);

    // 2. Whole map (Z2): IconPass 1 draw, no unit draw, team-colored icons at isolated units.
    const rsZ2 = await page.evaluate(() => window.__faf!.renderStats());
    const unitsZ2 = await screenUnits(page);
    const shotZ2 = await cssShot(page);
    const isoZ2 = isolated(unitsZ2, 24, ui, true);
    let teamHits = 0;
    const teamArmies = [0, 0];
    for (const u of isoZ2) {
      if (anyNear(shotZ2, u.x!, u.y!, 3, (c) => teamColored(c, u.army))) {
        teamHits++;
        teamArmies[u.army]! += 1;
      }
    }
    const corners = await page.evaluate(() => {
      const h = window.__faf!;
      const s = h.mapInfo()!.sizeWu;
      return [
        [0, 0],
        [s, 0],
        [0, s],
        [s, s],
      ].map(([x, z]) => h.project(x!, h.heightAt(x!, z!), z!));
    });

    // 3. Box select on the icons (real mouse drags, sim paused: static geometry).
    const r = rng(0x5eed2 + (server.coi ? 1 : 0));
    const vp = { w: 1280, h: 720 };
    let boxes = 0;
    let nonEmpty = 0;
    let expected = 0;
    let hit = 0;
    let selectedTotal = 0;
    let wrong = 0;
    let ambiguous = 0;
    const misses: { box: Box; missing: number[]; extra: number[] }[] = [];
    const ownZ2 = own(unitsZ2);
    for (let tries = 0; boxes < BOXES && tries < BOXES * 20; tries++) {
      const w = 12 + r() * 150;
      const hgt = 12 + r() * 110;
      const x0 = 8 + r() * (vp.w - 16 - w);
      const y0 = 8 + r() * (vp.h - 16 - hgt);
      const flip = r() < 0.5;
      const b: Box = flip ? { x0: x0 + w, y0: y0 + hgt, x1: x0, y1: y0 } : { x0, y0, x1: x0 + w, y1: y0 + hgt };
      if (!ui.every((q) => !boxesIntersect(b, q, 4))) continue;
      // Every second box is aimed at a unit so that most boxes select something.
      if (boxes % 2 === 0 && !ownZ2.some((u) => u.iconRect !== null && boxHit(u, b) === 1)) continue;
      boxes++;
      const exp: number[] = [];
      const amb = new Set<number>();
      for (const u of ownZ2) {
        const hh = boxHit(u, b);
        if (hh === 1) exp.push(u.handle);
        else if (hh === -1) amb.add(u.handle);
      }
      await dragBox(page, b, false, 3);
      await frames(page, 1);
      const sel = (await selection(page)).filter((x) => !amb.has(x));
      const expSet = new Set(exp);
      const selSet = new Set(sel);
      const missing = exp.filter((x) => !selSet.has(x));
      const extra = sel.filter((x) => !expSet.has(x));
      if (exp.length > 0) nonEmpty++;
      expected += exp.length;
      hit += exp.length - missing.length;
      selectedTotal += sel.length;
      wrong += extra.length;
      ambiguous += amb.size;
      if ((missing.length > 0 || extra.length > 0) && misses.length < 20) misses.push({ box: b, missing, extra });
    }
    const hitRate = expected === 0 ? 0 : hit / expected;
    const wrongRate = selectedTotal === 0 ? 0 : wrong / selectedTotal;

    // 4. Zoom flight (3 s, sim running): start view → whole map, per-frame render stats.
    await page.evaluate(() => window.__faf!.clearSelection());
    await resumeSim(page);
    const start = await page.evaluate(() => window.__faf!.mapInfo()!.starts.find((s) => s.army === 0)!);
    const flight = await page.evaluate(
      ({ s, d }) =>
        window.__faf!.flight(
          [
            { x: s.x, z: s.z, distance: 45 },
            { x: 256, z: 256, distance: d },
          ],
          3000,
        ),
      { s: start, d: zMax.maxDistance },
    );
    const fpsGate = Math.min(60, 0.95 * idleHz);

    const report = {
      browser: testInfo.project.name,
      server: server.name,
      measured: MEASURED_LOCALLY,
      wheel: { steps: steps.length, maxDistance: zMax.maxDistance, z1: zMax.z1, z2: zMax.z2, records: steps },
      transition: { checked: transitionChecked, visible: transitionVisible, rate: transitionVisible / Math.max(1, transitionChecked) },
      z2: {
        level: rsZ2.zoomLevel,
        draws: rsZ2.drawsByPass,
        iconOnly: rsZ2.iconOnlyUnits,
        visible: rsZ2.unitInstances,
        isolated: isoZ2.length,
        teamColored: teamHits,
        teamColoredByArmy: teamArmies,
        cornersOnScreen: corners.every((p) => p !== null && p.x >= -2 && p.y >= -2 && p.x <= 1282 && p.y <= 722),
      },
      boxSelect: { boxes, nonEmpty, expected, hit, hitRate, selected: selectedTotal, wrong, wrongRate, ambiguousExcluded: ambiguous, misses },
      flight: {
        ms: flight.ms,
        frames: flight.frames,
        fps: flight.fps,
        idleRafHz: idleHz,
        fpsGate,
        fpsGateApplied: PERF_GATE,
        framesByZoomLevel: flight.framesByZoomLevel,
        drawsByPassMax: flight.drawsByPassMax,
        iconPassNot1Frames: flight.iconPassNot1Frames,
        unitDrawsInZ2Max: flight.unitDrawsInZ2Max,
        draws: flight.draws,
        renderCpuMs: flight.renderCpuMs,
        mainJsMs: flight.mainJsMs,
        gpuMs: flight.gpuMs,
      },
    };
    writeReport(`zoom-${testInfo.project.name}-${server.transport}`, report);
    await attachJson(testInfo, 'zoom', { ...report, wheel: { ...report.wheel, records: undefined } });

    // Gates (machine-independent).
    expect(transitionVisible / transitionChecked, `mesh or icon visible at ${transitionVisible}/${transitionChecked} unit positions during the transition`).toBeGreaterThanOrEqual(0.95);
    expect(rsZ2.zoomLevel).toBe(2);
    expect(rsZ2.drawsByPass.icons, 'IconPass = 1 draw in Z2').toBe(1);
    expect(rsZ2.drawsByPass.units, 'no unit draw in Z2').toBe(0);
    expect(rsZ2.iconOnlyUnits).toBe(rsZ2.unitInstances);
    expect(report.z2.cornersOnScreen, 'whole map in view').toBe(true);
    expect(isoZ2.length).toBeGreaterThanOrEqual(20);
    expect(teamHits / isoZ2.length, `team-colored icons at ${teamHits}/${isoZ2.length} isolated units`).toBeGreaterThanOrEqual(0.95);
    expect(teamArmies[0]).toBeGreaterThan(0);
    expect(teamArmies[1]).toBeGreaterThan(0);
    expect(boxes).toBeGreaterThanOrEqual(200);
    expect(nonEmpty).toBeGreaterThanOrEqual(100);
    expect(hitRate, `box select on icons: ${hit}/${expected}`).toBeGreaterThanOrEqual(0.99);
    expect(wrongRate, `wrongly selected ${wrong}/${selectedTotal}`).toBeLessThanOrEqual(0.01);
    expect(flight.framesByZoomLevel[2], 'the flight reaches Z2').toBeGreaterThan(0);
    expect(flight.drawsByPassMax.icons).toBe(1);
    expect(flight.iconPassNot1Frames, 'IconPass one draw in every frame').toBe(0);
    expect(flight.unitDrawsInZ2Max).toBe(0);
    if (PERF_GATE) expect(flight.fps, `zoom flight ${flight.fps.toFixed(1)} FPS (idle rAF ${idleHz.toFixed(1)} Hz)`).toBeGreaterThanOrEqual(fpsGate);
    expectNoErrors(errors);
  });
}
