import { expect, test, type Page } from '@playwright/test';
import { attachJson, captureErrors, expectNoErrors, openGame, SERVERS, waitTick } from './support/game.ts';

// Move (S3, S4, SPK6 chain; MS3: explicit selection): a right click without a selection does
// nothing (no command, no marker). After Ctrl+A (all own units) a right click on the terrain is
// picked on the CPU, sent as a binary Move command through the worker pipeline, the click marker
// appears in the very next rAF, the seq is confirmed by a frame (ackSeq) and all own cubes drive
// towards the target. Cube scene (`?spawn=cubes`) so the MS1 criteria stay unchanged.

async function ownCentroid(page: Page): Promise<{ x: number; z: number; n: number }> {
  return page.evaluate(() => {
    const h = window.__faf!;
    let x = 0;
    let z = 0;
    let n = 0;
    for (const handle of h.ownHandles()) {
      const p = h.unitPos(handle);
      if (p === null) continue;
      x += p.x;
      z += p.z;
      n++;
    }
    return { x: x / n, z: z / n, n };
  });
}

for (const server of SERVERS) {
  test(`move: ohne Auswahl kein Befehl; Strg+A + Rechtsklick bewegt alle eigenen Würfel – ${server.label}`, async ({ page }, testInfo) => {
    const errors = captureErrors(page);
    await openGame(page, server.url, 'spawn=cubes', 1000);
    await waitTick(page, 5);
    await page.locator('#game-canvas').focus();
    await page.evaluate(() => window.__faf!.metrics.reset());

    // Click point on the start plateau (MS3 pathing: a target below the cliff would be reached over a
    // ramp, i.e. first away from it).
    const click = (await page.evaluate(() => {
      const h = window.__faf!;
      return h.project(130, h.heightAt(130, 100), 100);
    }))!;
    expect(click).not.toBeNull();
    const target = await page.evaluate(({ x, y }) => window.__faf!.screenToGround(x, y), click);
    expect(target).not.toBeNull();
    const before = await ownCentroid(page);
    const d0 = Math.hypot(before.x - target!.x, before.z - target!.z);
    expect(d0).toBeGreaterThan(30);
    const p0 = await page.evaluate(() => window.__faf!.ownHandles().map((x) => window.__faf!.unitPos(x)!));

    // MS3: nothing is selected at the start; a right click without a selection sends nothing.
    expect(await page.evaluate(() => window.__faf!.selection().length)).toBe(0);
    await page.mouse.click(click.x, click.y, { button: 'right' });
    await page.waitForTimeout(300);
    const idle = await page.evaluate(() => ({ last: window.__faf!.lastMoveTarget(), snap: window.__faf!.metrics.snapshot() }));
    expect(idle.last, 'no Move command without a selection').toBeNull();
    expect(idle.snap.clickToMarkerFrames.count, 'no click marker without a selection').toBe(0);

    // Ctrl+A selects every own unit (real keyboard), then the right click commands them.
    await page.keyboard.press('Control+KeyA');
    await page.waitForFunction(() => window.__faf!.selection().length === 1000);
    await page.evaluate(() => window.__faf!.metrics.reset());
    await page.mouse.click(click.x, click.y, { button: 'right' });

    // Marker in the next rAF, seq confirmed by the sim.
    await page.waitForFunction(() => {
      const s = window.__faf!.metrics.snapshot();
      return s.clickToMarkerFrames.count >= 1 && s.clickToAckMs.count >= 1;
    });
    const snap = await page.evaluate(() => window.__faf!.metrics.snapshot());
    expect(snap.clicks).toBe(1);
    expect(snap.clickToMarkerFrames.max).toBeLessThanOrEqual(1);
    expect(snap.frame['pendingCommands']).toBe(0);
    expect(snap.frame['ackSeq']).toBe(snap.frame['lastSeq']);
    const mv = await page.evaluate(() => window.__faf!.lastMoveTarget());
    expect(mv).not.toBeNull();
    expect(mv!.units).toBe(1000);

    // The cubes approach the target (positions from the frames).
    const t0 = await page.evaluate(() => window.__faf!.tick);
    await waitTick(page, t0 + 40);
    const after = await ownCentroid(page);
    const d1 = Math.hypot(after.x - target!.x, after.z - target!.z);
    const moved = await page.evaluate((ps) => {
      const h = window.__faf!;
      return h.ownHandles().filter((x, i) => {
        const p = h.unitPos(x)!;
        return Math.hypot(p.x - ps[i]!.x, p.z - ps[i]!.z) > 0.3;
      }).length;
    }, p0);
    await attachJson(testInfo, 'move', { target, before, after, d0, d1, moved, snap });
    expect(after.n).toBe(1000);
    expect(moved, 'every commanded cube drives off').toBeGreaterThanOrEqual(990);
    expect(d1).toBeLessThan(d0 - 2);
    expectNoErrors(errors);
  });
}
