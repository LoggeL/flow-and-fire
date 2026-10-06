import { expect, test, type Page } from '@playwright/test';
import { attachJson, captureErrors, expectNoErrors, openGame, SERVERS, stepTicks, waitTick, writeReport } from './support/game.ts';
import { cssShot, focusCanvas, frames, pauseSim, TANKS, uiRects, boxesIntersect, type CssShot, type Rgb } from './support/ms3.ts';

// Orders (G7 client + sim, MS3): a group of 8 tanks gets three waypoints by right click and
// Shift+right click (queue). The watch section carries three targets per unit and the waypoint
// lines are drawn (overlay pixels along each unit's queued segments). Stepping the paused sim tick
// by tick, every unit completes the waypoints in order, each near its waypoint. A right click
// without Shift replaces the queue, Stop (S) clears it. Waypoints as in the golden
// `ridge-shift-queue` (open lowland NW of the river).

const W = [
  { x: 205, z: 110 },
  { x: 230, z: 215 },
  { x: 180, z: 240 },
] as const;
const GROUP = 8;
/** A completion counts as "at its waypoint" within this distance (golden: 8 WU). */
const NEAR_WU = 8;

/** A waypoint-line pixel: brighter green than the same pixel without lines (route colors are light green). */
const LINE = (after: Rgb, before: Rgb): boolean => after[1] - before[1] >= 30 && after[1] >= after[0] && after[1] >= after[2] - 10;

async function screenOf(page: Page, p: { x: number; z: number }): Promise<{ x: number; y: number }> {
  const s = await page.evaluate((q) => {
    const h = window.__faf!;
    return h.project(q.x, h.heightAt(q.x, q.z), q.z);
  }, p);
  expect(s, `waypoint (${p.x}, ${p.z}) projects on screen`).not.toBeNull();
  return s!;
}

async function rightClick(page: Page, p: { x: number; y: number }, shift: boolean): Promise<void> {
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.click(p.x, p.y, { button: 'right' });
  if (shift) await page.keyboard.up('Shift');
}

async function watchOf(page: Page, handles: readonly number[]) {
  return page.evaluate((hs) => window.__faf!.watch().filter((w) => hs.includes(w.handle)), handles as number[]);
}

/** Pixels of the waypoint lines along each watched unit's queued segments (target k → k+1). */
async function linePixels(page: Page, before: CssShot, after: CssShot, handles: readonly number[]): Promise<{ samples: number; hits: number }> {
  const pts = await page.evaluate((hs) => {
    const h = window.__faf!;
    const out: { x: number; y: number }[] = [];
    for (const w of h.watch()) {
      if (!hs.includes(w.handle)) continue;
      for (let k = 0; k + 1 < w.targets.length; k++) {
        const a = w.targets[k]!;
        const b = w.targets[k + 1]!;
        for (const t of [0.3, 0.5, 0.7]) {
          const x = a.x + (b.x - a.x) * t;
          const z = a.z + (b.z - a.z) * t;
          const s = h.project(x, h.heightAt(x, z), z);
          if (s !== null) out.push(s);
        }
      }
    }
    return out;
  }, handles as number[]);
  let hits = 0;
  for (const p of pts) {
    let hit = false;
    for (let dy = -2; dy <= 2 && !hit; dy += 0.5) {
      for (let dx = -2; dx <= 2 && !hit; dx += 0.5) hit = LINE(after.at(p.x + dx, p.y + dy), before.at(p.x + dx, p.y + dy));
    }
    if (hit) hits++;
  }
  return { samples: pts.length, hits };
}

interface Completion {
  wp: number;
  d: number;
  tick: number;
}

/** Steps the paused sim tick by tick until every unit is idle without orders (or `maxTicks`). */
async function runQueue(page: Page, handles: readonly number[], maxTicks: number) {
  return page.evaluate(
    async ({ hs, W, maxTicks }) => {
      const h = window.__faf!;
      const prev = hs.map((x) => h.unitInfo(x)?.orders ?? 0);
      const done: { wp: number; d: number; tick: number }[][] = hs.map(() => []);
      let ticks = 0;
      for (; ticks < maxTicks; ticks++) {
        const target = h.tick + 1;
        h.ctl({ t: 'step', ticks: 1 });
        await h.waitTick(target, 10_000);
        let busy = false;
        for (let k = 0; k < hs.length; k++) {
          const u = h.unitInfo(hs[k]!);
          if (u === null) continue;
          const o = u.orders ?? 0;
          for (let c = prev[k]!; c > o; c--) {
            const wp = W.length - c;
            const w = W[Math.max(0, Math.min(W.length - 1, wp))]!;
            done[k]!.push({ wp, d: Math.hypot(u.x - w.x, u.z - w.z), tick: h.tick });
          }
          prev[k] = o;
          if (o > 0 || !u.idle) busy = true;
        }
        if (!busy) break;
      }
      return { done, ticks, tick: h.tick };
    },
    { hs: handles as number[], W: W as unknown as { x: number; z: number }[], maxTicks },
  );
}

for (const server of SERVERS) {
  test(`orders: Shift-Queue mit 3 Wegpunkten (Linien, Reihenfolge), Ersetzen ohne Shift, Stop – ${server.label}`, async ({ page }, testInfo) => {
    test.setTimeout(150_000);
    const errors = captureErrors(page);
    await openGame(page, server.url, TANKS, 300);
    await waitTick(page, 30);
    await pauseSim(page);
    await focusCanvas(page);

    // Eight light tanks nearest to the east edge of the army (towards the waypoints).
    const group = await page.evaluate((n) => {
      const h = window.__faf!;
      h.selectBlueprint('lnd_t1_tank');
      const t1 = h.selection();
      return t1
        .map((x) => ({ x, p: h.unitPos(x)! }))
        .sort((a, b) => b.p.x + b.p.z - (a.p.x + a.p.z) || a.x - b.x)
        .slice(0, n)
        .map((e) => e.x);
    }, GROUP);
    expect(group).toHaveLength(GROUP);
    await page.evaluate((g) => {
      const h = window.__faf!;
      h.select(g);
      h.setCamera(185, 172, 260);
    }, group);
    await frames(page, 3);
    const ui = await uiRects(page);
    const sw = await Promise.all(W.map((w) => screenOf(page, w)));
    for (const s of sw) {
      expect(s.x > 20 && s.x < 1260 && s.y > 20 && s.y < 700, `waypoint on screen: ${JSON.stringify(s)}`).toBe(true);
      expect(ui.some((r) => boxesIntersect({ x0: s.x - 4, y0: s.y - 4, x1: s.x + 4, y1: s.y + 4 }, r)), 'waypoint under the HUD').toBe(false);
    }
    const before = await cssShot(page);

    // 1. Right click + 2 × Shift+right click.
    const req0 = await page.evaluate(() => window.__faf!.pathStats()!.requestsIssued);
    await rightClick(page, sw[0]!, false);
    await rightClick(page, sw[1]!, true);
    await rightClick(page, sw[2]!, true);
    const lastMove = await page.evaluate(() => window.__faf!.lastMoveTarget());
    expect(lastMove).not.toBeNull();
    await stepTicks(page, 2);
    await frames(page, 3);
    const watch1 = await watchOf(page, group);
    expect(watch1.length).toBe(GROUP);
    for (const w of watch1) {
      expect(w.orderCount, `unit ${w.handle}: three queued orders`).toBe(3);
      expect(w.targets.length).toBe(3);
      w.targets.forEach((t, k) => {
        expect(t.type).toBe('move');
        expect(Math.hypot(t.x - W[k]!.x, t.z - W[k]!.z), `unit ${w.handle} target ${k}`).toBeLessThan(NEAR_WU);
      });
    }
    // Only the active group order has requested a path so far (queued groups request when they begin).
    const req1 = await page.evaluate(() => window.__faf!.pathStats()!.requestsIssued);
    expect(req1 - req0).toBe(1);
    const fb1 = await page.evaluate(() => window.__faf!.feedback());
    expect(fb1.watchedDrawn).toBe(GROUP);
    expect(fb1.segments).toBeGreaterThanOrEqual(GROUP * 2);
    const after = await cssShot(page);
    const lines = await linePixels(page, before, after, group);
    expect(lines.samples).toBe(GROUP * 2 * 3);
    expect(lines.hits / lines.samples, `waypoint line pixels ${lines.hits}/${lines.samples}`).toBeGreaterThanOrEqual(0.8);

    // 2. Every unit completes the waypoints in order, each near its waypoint.
    const run = await runQueue(page, group, 1400);
    for (let k = 0; k < GROUP; k++) {
      const d = run.done[k]!;
      expect(d.map((c: Completion) => c.wp), `unit ${group[k]} completion order`).toEqual([0, 1, 2]);
      for (const c of d) expect(c.d, `unit ${group[k]} completed waypoint ${c.wp} ${c.d.toFixed(2)} WU away`).toBeLessThanOrEqual(NEAR_WU);
    }
    const fbIdle = await page.evaluate(() => window.__faf!.feedback());
    expect(fbIdle.segments, 'no lines once the queue is done').toBe(0);

    // 3. Queue again, then a right click without Shift replaces the queue.
    const back = [
      { x: 200, z: 170 },
      { x: 170, z: 150 },
      { x: 150, z: 200 },
    ];
    const sb = await Promise.all(back.map((w) => screenOf(page, w)));
    await rightClick(page, sb[0]!, false);
    await rightClick(page, sb[1]!, true);
    await stepTicks(page, 2);
    expect((await watchOf(page, group)).every((w) => w.orderCount === 2)).toBe(true);
    await rightClick(page, sb[2]!, false);
    await stepTicks(page, 2);
    const watch3 = await watchOf(page, group);
    for (const w of watch3) {
      expect(w.orderCount, `unit ${w.handle}: queue replaced`).toBe(1);
      expect(Math.hypot(w.targets[0]!.x - back[2]!.x, w.targets[0]!.z - back[2]!.z)).toBeLessThan(NEAR_WU);
    }

    // 4. Shift adds two more, Stop (S) clears the queue.
    await rightClick(page, sb[0]!, true);
    await rightClick(page, sb[1]!, true);
    await stepTicks(page, 2);
    expect((await watchOf(page, group)).every((w) => w.orderCount === 3)).toBe(true);
    await page.keyboard.press('KeyS');
    await stepTicks(page, 2);
    const watch4 = await watchOf(page, group);
    for (const w of watch4) {
      expect(w.orderCount, `unit ${w.handle}: Stop clears the queue`).toBeLessThanOrEqual(1);
      expect(w.targets.every((t) => t.type === 'stop')).toBe(true);
    }
    const stop = await runQueue(page, group, 100);
    const watch5 = await watchOf(page, group);
    expect(watch5.every((w) => w.orderCount === 0)).toBe(true);
    await frames(page, 2);
    const fb5 = await page.evaluate(() => window.__faf!.feedback());
    expect(fb5.segments).toBe(0);
    expect(fb5.discs).toBe(0);

    const report = {
      browser: testInfo.project.name,
      server: server.name,
      group,
      waypoints: W,
      pathRequestsForQueuedGroupOrder: req1 - req0,
      lines: { ...lines, segments: fb1.segments, watchedDrawn: fb1.watchedDrawn },
      completion: run.done.map((d: Completion[], k: number) => ({ handle: group[k], wps: d })),
      ticksToIdle: run.ticks,
      stopTicksToIdle: stop.ticks,
    };
    writeReport(`orders-${testInfo.project.name}-${server.transport}`, report);
    await attachJson(testInfo, 'orders', report);
    expectNoErrors(errors);
  });
}
