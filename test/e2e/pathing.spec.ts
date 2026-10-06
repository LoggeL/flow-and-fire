import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { attachJson, captureErrors, expectNoErrors, HOLLOW_RIDGE, openGame, SERVERS, stepTicks, waitTick, writeReport } from './support/game.ts';
import { centroid, focusCanvas, frames, pauseSim } from './support/ms3.ts';

// Pathing (M5/M6/M7, G7/G8, MS3) on hollow-ridge through the real game: a group of 44 mixed tanks
// (classes 1–3) forms up on the NW start plateau (single-unit moves into the grid of the golden
// ridge-group-offset) and is sent by right click to the SE plateau (over ramps and a ford); a second
// group of 12 drives on the NW lowland. The paused sim is stepped tick by tick and every
// frame is checked: no unit on a blocked cell or in deep water (client nav-rule replica +
// console footprints, `unitInfo.blockedCell`). A group order raises `requestsIssued` by exactly 1.
// A console `obstacle` far away from every route repaths nothing; one on the corridor of the big
// group repaths only that path (`repathsTriggered`), and the units drive around it. At the end
// ≥ 95 % have arrived and the arrangement is kept: every unit's final offset from the group centroid
// equals its initial offset compressed by the documented uniform rule (R(n), minimum gap) within
// the ms3-p2 tolerance (1.5 WU; single outliers up to 3.5 WU are documented there).

const TANKS_PER_ARMY = 56;
const BIG = 44;
/** SE plateau, clear of the enemy start army at (416, 416). */
const TARGET_A = { x: 436, z: 386 };
/** NW lowland south of the start plateau (open ground of the golden ridge-shift-queue). */
const TARGET_B = { x: 150, z: 210 };
/** Second, short order of B (west of it). */
const TARGET_B2 = { x: 70, z: 200 };
/** Formation of group A before the cross-map order (golden ridge-group-offset: 8 columns, 3.2 WU). */
const GRID = { cols: 8, rows: 6, spacing: 3.2 } as const;
const ARRIVE_WU = 15;
const OFFSET_TOL_WU = 1.5;
const OFFSET_OUTLIER_WU = 3.5;
const MAX_TICKS = 4200;
/** Control obstacle in the NW map corner, away from every route. */
const CONTROL = { x: 14, z: 14, w: 8, h: 8 };

async function consoleLine(page: Page, line: string): Promise<string> {
  const open = await page.evaluate(() => window.__faf!.consoleOpen);
  if (!open) {
    await page.keyboard.press('F1');
    await expect(page.locator('[data-testid="console-input"]')).toBeFocused();
  }
  const input = page.locator('[data-testid="console-input"]');
  await input.fill(line);
  await input.press('Enter');
  const text = await page.locator('[data-testid="console"]').innerText();
  await input.press('F1');
  await expect(page.locator('[data-testid="console"]')).toBeHidden();
  await focusCanvas(page);
  return text;
}

async function rightClickAt(page: Page, p: { x: number; z: number }): Promise<void> {
  await page.evaluate((q) => window.__faf!.setCamera(q.x, q.z, 70), p);
  await frames(page, 3);
  const s = await page.evaluate((q) => {
    const h = window.__faf!;
    return h.project(q.x, h.heightAt(q.x, q.z), q.z);
  }, p);
  expect(s).not.toBeNull();
  await page.mouse.click(s!.x, s!.y, { button: 'right' });
}

async function requests(page: Page): Promise<{ requestsIssued: number; repathsTriggered: number; tick: number }> {
  return page.evaluate(() => {
    const p = window.__faf!.pathStats()!;
    return { requestsIssued: p.requestsIssued, repathsTriggered: p.repathsTriggered, tick: p.tick };
  });
}

interface RunResult {
  ticks: number;
  tick: number;
  checks: number;
  violations: { tick: number; handle: number; x: number; z: number; reason: string | null }[];
  idleA: boolean;
}

/**
 * Steps the paused sim one tick per animation frame and checks every received frame: no unit on a
 * blocked cell. Stops when all of `watchIdle` are idle without orders (after `minTicks`) or at `maxTicks`.
 */
async function run(page: Page, watchIdle: readonly number[], maxTicks: number, minTicks = 0): Promise<RunResult> {
  return page.evaluate(
    ({ hs, maxTicks, minTicks }) =>
      new Promise<RunResult>((resolve) => {
        const h = window.__faf!;
        const t0 = h.tick;
        const violations: RunResult['violations'] = [];
        let checks = 0;
        let target = t0 + 1;
        h.ctl({ t: 'step', ticks: 1 });
        const loop = (): void => {
          if (h.tick >= target) {
            let idle = true;
            for (const u of h.screenUnits()) {
              const info = h.unitInfo(u.handle);
              if (info === null) continue;
              checks++;
              if (info.blockedCell && violations.length < 50) violations.push({ tick: h.tick, handle: u.handle, x: info.x, z: info.z, reason: info.blockedReason });
            }
            for (const x of hs) {
              const info = h.unitInfo(x);
              if (info !== null && !info.idle) idle = false;
            }
            const ticks = h.tick - t0;
            if ((idle && ticks >= minTicks) || ticks >= maxTicks) {
              resolve({ ticks, tick: h.tick, checks, violations, idleA: idle });
              return;
            }
            target = h.tick + 1;
            h.ctl({ t: 'step', ticks: 1 });
          }
          requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
      }),
    { hs: watchIdle as number[], maxTicks, minTicks },
  );
}

/** Collision radii (WU) of the tank blueprints (content/blueprints/core/units, `motion.radius`). */
function blueprintRadii(): Map<string, number> {
  const dir = resolve(import.meta.dirname, '../../content/blueprints/core/units');
  const out = new Map<string, number>();
  for (const f of readdirSync(dir)) {
    if (!f.startsWith('lnd_') || !f.endsWith('.ts')) continue;
    const src = readFileSync(resolve(dir, f), 'utf8');
    const id = /id:\s*'([^']+)'/.exec(src)?.[1];
    const r = /radius:\s*([0-9.]+)/.exec(src)?.[1];
    if (id !== undefined && r !== undefined) out.set(id.replace(/^core:/, ''), Number(r));
  }
  return out;
}

/**
 * Offset preservation (PLAN §3.8, sim `groupOffsets`, replicated in float from the documented
 * rule): offsets = position − centroid at the order, compressed uniformly to
 * R(n) = 2 + 1.1·√n WU but never tighter than ri + rj + 0.15 WU for pairs that are not neighbours
 * anyway (d ≥ 2·(ri + rj + 0.15)). The final arrangement is compared with centroid + compressed
 * offset (the golden `ridge-group-offset` metric).
 */
function offsetCheck(initial: readonly { x: number; z: number }[], radii: readonly number[], final: readonly { x: number; z: number }[]) {
  const n = initial.length;
  const ci = { x: initial.reduce((a, p) => a + p.x, 0) / n, z: initial.reduce((a, p) => a + p.z, 0) / n };
  const cf = { x: final.reduce((a, p) => a + p.x, 0) / n, z: final.reduce((a, p) => a + p.z, 0) / n };
  const off = initial.map((p) => ({ x: p.x - ci.x, z: p.z - ci.z }));
  const maxOff = Math.max(...off.map((o) => Math.hypot(o.x, o.z)));
  const R = 2 + 1.1 * Math.sqrt(n);
  let scale = 1;
  if (maxOff > R) {
    let sMin = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const d = Math.hypot(off[i]!.x - off[j]!.x, off[i]!.z - off[j]!.z);
        const need = radii[i]! + radii[j]! + 0.15;
        if (d === 0 || d < 2 * need) continue;
        sMin = Math.max(sMin, need / d);
      }
    }
    scale = Math.min(1, Math.max(R / maxOff, sMin));
  }
  const res = off.map((o, i) => Math.hypot(final[i]!.x - cf.x - scale * o.x, final[i]!.z - cf.z - scale * o.z));
  // A slot is physically reachable only if no other slot overlaps it (the rule lets touching
  // neighbours compress into each other; the collision then pushes them apart).
  const feasible = off.map((o, i) =>
    off.every((q, j) => j === i || Math.hypot(scale * (o.x - q.x), scale * (o.z - q.z)) >= radii[i]! + radii[j]!),
  );
  // Least-squares uniform scale of the final arrangement (reported: how uniform the compression looks).
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (final[i]!.x - cf.x) * off[i]!.x + (final[i]!.z - cf.z) * off[i]!.z;
    den += off[i]!.x ** 2 + off[i]!.z ** 2;
  }
  const sortedRes = [...res].sort((a, b) => a - b);
  return {
    scale,
    fittedScale: den > 0 ? num / den : 1,
    R,
    maxOff,
    residuals: res,
    p50: sortedRes[Math.floor(0.5 * (n - 1))]!,
    p95: sortedRes[Math.ceil(0.95 * n) - 1]!,
    max: sortedRes[n - 1]!,
    withinTol: res.filter((r) => r <= OFFSET_TOL_WU).length,
    feasible: feasible.filter(Boolean).length,
    feasibleWithinTol: res.filter((r, i) => feasible[i] && r <= OFFSET_TOL_WU).length,
    feasibleMax: Math.max(0, ...res.filter((_, i) => feasible[i])),
    infeasibleMax: Math.max(0, ...res.filter((_, i) => !feasible[i])),
  };
}

for (const server of SERVERS) {
  test(`pathing: 44 Panzer NW → SE (HPA*), nie auf blockierter Zelle, Offset-Erhalt, 1 Anfrage je Gruppenbefehl, obstacle ⇒ nur betroffener Pfad – ${server.label}`, async ({ page }, testInfo) => {
    test.setTimeout(420_000);
    const errors = captureErrors(page);
    await openGame(page, server.url, `spawn=tanks&tanks=${TANKS_PER_ARMY}`, 2 * TANKS_PER_ARMY);
    await waitTick(page, 30);
    await pauseSim(page);
    await focusCanvas(page);

    // Groups: A = the 44 own tanks nearest the SE edge of the army (mixed classes), B = the rest.
    const split = await page.evaluate((nA) => {
      const h = window.__faf!;
      const own = h.ownHandles().map((x) => ({ x, p: h.unitPos(x)!, v: h.screenUnits().find((u) => u.handle === x)?.visual ?? -1 }));
      own.sort((a, b) => b.p.x + b.p.z - (a.p.x + a.p.z) || a.x - b.x);
      return { A: own.slice(0, nA).map((e) => e.x), B: own.slice(nA).map((e) => e.x), visualsA: own.slice(0, nA).map((e) => e.v) };
    }, BIG);
    expect(split.A.length).toBe(BIG);
    expect(split.B.length).toBeGreaterThanOrEqual(8);
    const classesA = new Set(split.visualsA);
    const radiusById = blueprintRadii();
    const radiusByVisual = await page.evaluate((ids) => {
      const h = window.__faf!;
      const out: [number, string][] = [];
      for (const id of ids) {
        if (h.selectBlueprint(id) <= 0) continue;
        const v = h.screenUnits().find((u) => u.handle === h.selection()[0])?.visual;
        if (v !== undefined) out.push([v, id]);
      }
      h.clearSelection();
      return out;
    }, [...radiusById.keys()]);
    const visToRadius = new Map(radiusByVisual.map(([v, id]) => [v, radiusById.get(id)!]));
    const radiiA = split.visualsA.map((v) => visToRadius.get(v) ?? 0.45);
    expect(visToRadius.size).toBeGreaterThanOrEqual(3);
    expect(classesA.size, 'mixed blueprint classes in the group').toBeGreaterThanOrEqual(3);
    // B leaves the plateau first (group order ⇒ one path request).
    await page.evaluate((hs) => window.__faf!.select(hs), split.B);
    const r0 = await requests(page);
    await rightClickAt(page, TARGET_B);
    await stepTicks(page, 1);
    const r1 = await requests(page);
    expect(r1.requestsIssued - r0.requestsIssued, 'group order B ⇒ one path request').toBe(1);

    // A forms up on the plateau like the golden ridge-group-offset (8 columns, 3.2 WU; heavy tanks
    // never side by side) with one single-unit Move per tank, then waits until everyone stands.
    const cells: { x: number; z: number; big: boolean }[] = [];
    for (let row = 0; row < GRID.rows; row++) {
      for (let col = 0; col < GRID.cols; col++) {
        cells.push({
          x: HOLLOW_RIDGE.own.x + (col - (GRID.cols - 1) / 2) * GRID.spacing,
          z: HOLLOW_RIDGE.own.z + (row - (GRID.rows - 1) / 2) * GRID.spacing,
          big: col % 2 === 0 && row % 3 === 0,
        });
      }
    }
    const order = split.A.map((h, i) => ({ h, r: radiiA[i]! })).sort((a, b) => b.r - a.r || a.h - b.h);
    const bigCells = cells.filter((c) => c.big);
    const smallCells = cells.filter((c) => !c.big);
    const slots = new Map<number, { x: number; z: number }>();
    for (const u of order) slots.set(u.h, (u.r >= 1 ? bigCells.shift() : undefined) ?? smallCells.shift() ?? bigCells.shift()!);
    await page.evaluate((list) => {
      const h = window.__faf!;
      for (const [handle, c] of list) h.sendMove([handle], c.x, c.z);
    }, [...slots.entries()]);
    const form = await run(page, split.A, 900, 20);
    expect(form.violations).toEqual([]);
    const initialA = await page.evaluate((hs) => hs.map((x) => window.__faf!.unitPos(x)!), split.A);
    const formError = initialA.map((p, i) => Math.hypot(p.x - slots.get(split.A[i]!)!.x, p.z - slots.get(split.A[i]!)!.z));

    // B gets a second (short) order so that a path of another group is live during the obstacle test.
    await page.evaluate((hs) => window.__faf!.select(hs), split.B);
    const r2a = await requests(page);
    await rightClickAt(page, TARGET_B2);
    await stepTicks(page, 1);
    const r2b = await requests(page);
    expect(r2b.requestsIssued - r2a.requestsIssued, 'second group order B ⇒ one path request').toBe(1);

    // Group order A by right click on the SE plateau: exactly one path request.
    await page.evaluate((hs) => window.__faf!.select(hs), split.A);
    const ra0 = await requests(page);
    await rightClickAt(page, TARGET_A);
    await stepTicks(page, 1);
    const ra1 = await requests(page);
    expect(ra1.requestsIssued - ra0.requestsIssued, 'group order A ⇒ one path request').toBe(1);

    // Let the paths finish, then read both routes from the watch section.
    const warm = await run(page, [], 30, 30);
    expect(warm.violations).toEqual([]);
    const routeOf = async (hs: readonly number[]): Promise<{ x: number; z: number }[]> => {
      await page.evaluate((x) => window.__faf!.select(x), hs as number[]);
      await stepTicks(page, 2);
      return page.evaluate((x) => {
        const w = window.__faf!.watch().filter((e) => x.includes(e.handle) && !e.flags.pathPending);
        w.sort((a, b) => b.points.length - a.points.length);
        return w.length === 0 ? [] : w[0]!.points;
      }, hs as number[]);
    };
    const routeA = await routeOf(split.A);
    const routeB = await routeOf(split.B);
    expect(routeA.length, 'group A follows a multi-waypoint path').toBeGreaterThanOrEqual(3);

    // Control obstacle away from every route: no repath.
    const rc0 = await requests(page);
    const outC = await consoleLine(page, `obstacle ${CONTROL.x} ${CONTROL.z} ${CONTROL.w} ${CONTROL.h}`);
    expect(outC).toContain('obstacle gesetzt');
    await stepTicks(page, 1);
    const rc1 = await requests(page);
    expect(rc1.repathsTriggered - rc0.repathsTriggered, 'obstacle off all corridors ⇒ no repath').toBe(0);

    // Obstacle on A's corridor, ahead of the group and far from B's route.
    const cA = await centroid(page, split.A);
    const pick = routeA.find(
      (p) => Math.hypot(p.x - cA.x, p.z - cA.z) > 60 && routeB.every((q) => Math.hypot(p.x - q.x, p.z - q.z) > 60) && Math.hypot(p.x - TARGET_A.x, p.z - TARGET_A.z) > 40,
    );
    expect(pick, `a waypoint of route A away from B (${JSON.stringify(routeA)})`).toBeDefined();
    const obs = { x: Math.round(pick!.x) - 4, z: Math.round(pick!.z) - 4, w: 8, h: 8 };
    const ro0 = await requests(page);
    const outO = await consoleLine(page, `obstacle ${obs.x} ${obs.z} ${obs.w} ${obs.h}`);
    expect(outO).toContain('obstacle gesetzt');
    await stepTicks(page, 1);
    const ro1 = await requests(page);
    const repaths = ro1.repathsTriggered - ro0.repathsTriggered;
    expect(repaths, 'obstacle on corridor A ⇒ only A repaths (one shared group path)').toBe(1);

    // Drive: every frame checked, until group A is idle.
    const main = await run(page, split.A, MAX_TICKS, 50);
    const finalA = await page.evaluate((hs) => hs.map((x) => window.__faf!.unitInfo(x)), split.A);
    const arrived = finalA.filter((u) => u !== null && u.idle && Math.hypot(u.x - TARGET_A.x, u.z - TARGET_A.z) <= ARRIVE_WU).length;
    const insideObstacle = finalA.filter((u) => u !== null && u.x >= obs.x && u.x < obs.x + obs.w && u.z >= obs.z && u.z < obs.z + obs.h).length;
    const fit = offsetCheck(
      initialA,
      radiiA,
      finalA.map((u) => ({ x: u!.x, z: u!.z })),
    );
    const bInfo = await page.evaluate((hs) => hs.map((x) => window.__faf!.unitInfo(x)), split.B);
    const arrivedB = bInfo.filter((u) => u !== null && Math.hypot(u.x - TARGET_B2.x, u.z - TARGET_B2.z) <= ARRIVE_WU).length;
    const stats = await page.evaluate(() => window.__faf!.pathStats());

    const report = {
      browser: testInfo.project.name,
      server: server.name,
      groupA: BIG,
      groupB: split.B.length,
      blueprintsA: [...classesA],
      requests: { groupA: ra1.requestsIssued - ra0.requestsIssued, groupB: r1.requestsIssued - r0.requestsIssued, groupB2: r2b.requestsIssued - r2a.requestsIssued, total: stats },
      formation: { ticks: form.ticks, maxErrorWU: Math.max(...formError), meanErrorWU: formError.reduce((a, b) => a + b, 0) / formError.length },
      routeA: routeA.length,
      routeB: routeB.length,
      obstacle: { control: CONTROL, controlRepaths: rc1.repathsTriggered - rc0.repathsTriggered, onCorridor: obs, repaths, insideAtEnd: insideObstacle },
      ticksToIdle: main.ticks,
      idleA: main.idleA,
      checkedUnitFrames: main.checks + warm.checks + form.checks,
      violations: main.violations,
      arrived: { A: arrived, B: arrivedB },
      offset: {
        scale: fit.scale,
        fittedScale: fit.fittedScale,
        R: fit.R,
        maxOffWU: fit.maxOff,
        p50: fit.p50,
        p95: fit.p95,
        max: fit.max,
        withinTol: fit.withinTol,
        feasible: fit.feasible,
        feasibleWithinTol: fit.feasibleWithinTol,
        feasibleMax: fit.feasibleMax,
        infeasibleMax: fit.infeasibleMax,
        residuals: fit.residuals.map((r) => Math.round(r * 100) / 100),
      },
    };
    writeReport(`pathing-${testInfo.project.name}-${server.transport}`, report);
    await attachJson(testInfo, 'pathing', report);

    expect(main.violations, `units on blocked cells: ${JSON.stringify(main.violations.slice(0, 5))}`).toEqual([]);
    expect(arrived / BIG, `arrived ${arrived}/${BIG}`).toBeGreaterThanOrEqual(0.95);
    expect(insideObstacle, 'nobody stands inside the obstacle').toBe(0);
    expect(fit.feasible / BIG, `reachable (non-overlapping) slots ${fit.feasible}/${BIG}`).toBeGreaterThanOrEqual(0.9);
    expect(fit.withinTol / BIG, `offset error ≤ ${OFFSET_TOL_WU} WU for ${fit.withinTol}/${BIG} (p95 ${fit.p95.toFixed(2)}, max ${fit.max.toFixed(2)})`).toBeGreaterThanOrEqual(0.95);
    expect(fit.max, 'offset outliers bounded (ms3-p2)').toBeLessThanOrEqual(OFFSET_OUTLIER_WU);
    expectNoErrors(errors);
  });
}
