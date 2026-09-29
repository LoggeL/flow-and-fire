import { expect, test, type Page } from '@playwright/test';
import { attachJson, captureErrors, expectNoErrors, openGame, SERVERS, waitTick } from './support/game.ts';

// Move (S3, S4, SPK6 chain): a right click on the plane is picked on the CPU, sent as a binary Move
// command through the worker pipeline, the click marker appears in the very next rAF, the seq is
// confirmed by a frame (ackSeq) and all own cubes drive towards the target.

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
  test(`move: Rechtsklick bewegt alle eigenen Würfel – ${server.label}`, async ({ page }, testInfo) => {
    const errors = captureErrors(page);
    await openGame(page, server.url, '', 1000);
    await waitTick(page, 5);
    await page.evaluate(() => window.__faf!.metrics.reset());

    const click = { x: 1040, y: 330 };
    const target = await page.evaluate(({ x, y }) => window.__faf!.screenToGround(x, y), click);
    expect(target).not.toBeNull();
    const before = await ownCentroid(page);
    const d0 = Math.hypot(before.x - target!.x, before.z - target!.z);
    expect(d0).toBeGreaterThan(30);

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

    // The cubes approach the target (positions from the frames).
    const t0 = await page.evaluate(() => window.__faf!.tick);
    await waitTick(page, t0 + 20);
    const after = await ownCentroid(page);
    const d1 = Math.hypot(after.x - target!.x, after.z - target!.z);
    await attachJson(testInfo, 'move', { target, before, after, d0, d1, snap });
    expect(after.n).toBe(1000);
    expect(d1).toBeLessThan(d0 - 2);
    expectNoErrors(errors);
  });
}
