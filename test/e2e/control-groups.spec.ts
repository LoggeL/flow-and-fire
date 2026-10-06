import { expect, test, type Page } from '@playwright/test';
import { attachJson, captureErrors, expectNoErrors, openGame, SERVERS, stepTicks, waitTick, writeReport } from './support/game.ts';
import { centroid, expectSameSet, focusCanvas, frames, pauseSim, selection, sorted, TANKS } from './support/ms3.ts';

// Control groups (C7, MS3) through the real keyboard (KeyboardEvent.code): Ctrl+digit stores the
// selection, digit recalls, Shift+Ctrl+digit adds the selection to the group, Shift+digit adds the
// group to the selection, a double tap (< 350 ms) centres the camera on the group (≤ 2 WU from the
// centroid of the displayed positions), Alt+digit is the browser-safe alternative for storing
// (Shift+Alt adds), numpad digits work like the top row, dead handles drop out of the groups.

async function groups(page: Page): Promise<number[][]> {
  return page.evaluate(() => window.__faf!.controlGroups());
}

async function select(page: Page, hs: readonly number[]): Promise<void> {
  await page.evaluate((h) => window.__faf!.select(h), hs as number[]);
  await frames(page, 1);
}

async function key(page: Page, k: string): Promise<void> {
  await page.keyboard.press(k);
  await frames(page, 1);
}

function union(...lists: (readonly number[])[]): number[] {
  return sorted([...new Set(lists.flat())]);
}

for (const server of SERVERS) {
  test(`control-groups: Strg/Alt+Ziffer, Abrufen, Hinzufügen, Doppeltap zentriert, tote Handles – ${server.label}`, async ({ page }, testInfo) => {
    const errors = captureErrors(page);
    await openGame(page, server.url, TANKS, 300);
    await waitTick(page, 30);
    await pauseSim(page);
    await focusCanvas(page);

    const ownH = await page.evaluate(() => window.__faf!.ownHandles());
    expect(ownH.length).toBeGreaterThanOrEqual(140);
    const A = ownH.slice(0, 20);
    const B = ownH.slice(20, 35);
    const C = ownH.slice(35, 45);
    const D = ownH.slice(45, 50);

    // Ctrl+1 stores, Esc clears, 1 recalls.
    await select(page, A);
    await key(page, 'Control+Digit1');
    expectSameSet((await groups(page))[1]!, A, 'Ctrl+1 stores the selection');
    await key(page, 'Escape');
    expect(await selection(page)).toEqual([]);
    await key(page, 'Digit1');
    expectSameSet(await selection(page), A, '1 recalls group 1');

    // Shift+Ctrl+1 adds the selection to the group (selection unchanged).
    await select(page, B);
    await key(page, 'Shift+Control+Digit1');
    expectSameSet((await groups(page))[1]!, union(A, B), 'Shift+Ctrl+1 adds to group 1');
    expectSameSet(await selection(page), B);

    // Shift+1 adds group 1 to the selection.
    await select(page, C);
    await key(page, 'Shift+Digit1');
    expectSameSet(await selection(page), union(A, B, C), 'Shift+1 adds the group to the selection');

    // An empty group changes nothing.
    await key(page, 'Digit7');
    expectSameSet(await selection(page), union(A, B, C), 'empty group 7 keeps the selection');

    // Alt+2 stores (browser-safe), Shift+Alt+2 adds, 2 recalls.
    await select(page, C);
    await key(page, 'Alt+Digit2');
    expectSameSet((await groups(page))[2]!, C, 'Alt+2 stores');
    await select(page, D);
    await key(page, 'Shift+Alt+Digit2');
    expectSameSet((await groups(page))[2]!, union(C, D), 'Shift+Alt+2 adds');
    await key(page, 'Escape');
    await key(page, 'Digit2');
    expectSameSet(await selection(page), union(C, D), '2 recalls group 2');

    // Numpad digits: Ctrl+Numpad3 stores, Numpad3 recalls.
    await select(page, D);
    await key(page, 'Control+Numpad3');
    await key(page, 'Escape');
    await key(page, 'Numpad3');
    expectSameSet(await selection(page), D, 'Numpad3 recalls group 3');

    // Double tap centres the camera on group 1 (displayed positions of resting units).
    await page.evaluate(() => window.__faf!.setCamera(300, 200, 60));
    await frames(page, 2);
    const cam0 = await page.evaluate(() => window.__faf!.cameraState());
    await page.keyboard.press('Digit1');
    await page.keyboard.press('Digit1');
    await frames(page, 3);
    const cam1 = await page.evaluate(() => window.__faf!.cameraState());
    const g1 = (await groups(page))[1]!;
    const c1 = await centroid(page, g1);
    const camDist = Math.hypot(cam1.x - c1.x, cam1.z - c1.z);
    expectSameSet(await selection(page), g1);
    expect(camDist, `camera centre (${cam1.x.toFixed(2)}, ${cam1.z.toFixed(2)}) vs group centroid (${c1.x.toFixed(2)}, ${c1.z.toFixed(2)})`).toBeLessThanOrEqual(2);
    expect(Math.hypot(cam0.x - c1.x, cam0.z - c1.z)).toBeGreaterThan(50);

    // A single tap after the double-tap window does not move the camera.
    await page.evaluate(() => window.__faf!.setCamera(300, 200, 60));
    await frames(page, 2);
    await page.waitForTimeout(400);
    await key(page, 'Digit1');
    await frames(page, 2);
    const cam2 = await page.evaluate(() => window.__faf!.cameraState());
    expect(Math.hypot(cam2.x - 300, cam2.z - 200), 'single tap keeps the camera').toBeLessThan(1);

    // Dead handles drop out: kill 5 members of group 1 (cheat through the pipeline), step the sim.
    const dead = A.slice(0, 5);
    await select(page, dead);
    const kill = await page.evaluate(() => window.__faf!.console('kill'));
    expect(kill.ok, kill.lines.join('\n')).toBe(true);
    await stepTicks(page, 2);
    await page.waitForFunction((d) => d.every((h) => window.__faf!.unitPos(h) === null), dead);
    await frames(page, 2);
    const gAfter = await groups(page);
    expectSameSet(gAfter[1]!, union(A.slice(5), B), 'killed units leave group 1');
    await key(page, 'Escape');
    await key(page, 'Digit1');
    expectSameSet(await selection(page), union(A.slice(5), B), 'recall without dead handles');

    const report = {
      browser: testInfo.project.name,
      server: server.name,
      sizes: { A: A.length, B: B.length, C: C.length, D: D.length },
      groups: gAfter.map((g) => g.length),
      doubleTap: { camera: { x: cam1.x, z: cam1.z }, centroid: c1, distanceWU: camDist },
    };
    writeReport(`control-groups-${testInfo.project.name}-${server.transport}`, report);
    await attachJson(testInfo, 'control-groups', report);
    expectNoErrors(errors);
  });
}
