import { expect, test, type Page } from '@playwright/test';
import { attachJson, captureErrors, expectNoErrors, openGame, SERVERS, waitTick } from './support/game.ts';

// Dev console (S8): toggled with F1/^, focus rule (typing does not trigger game keys), history,
// spawn/kill as cheat commands through the pipeline, pause/step/speed/resume, hash, budget overlay
// (phase times p50/p95 + hash tick from the host stats), export (command-log download), transport.

async function run(page: Page, line: string): Promise<void> {
  const input = page.locator('[data-testid="console-input"]');
  await input.fill(line);
  await input.press('Enter');
}

function consoleText(page: Page): Promise<string> {
  return page.locator('[data-testid="console"]').innerText();
}

for (const server of SERVERS) {
  test(`console: spawn, kill, pause, step, speed, hash, budget, export – ${server.label}`, async ({ page }, testInfo) => {
    const errors = captureErrors(page);
    await openGame(page, server.url, '', 1000);
    await waitTick(page, 3);
    await page.locator('#game-canvas').focus();

    await page.keyboard.press('F1');
    await expect(page.locator('[data-testid="console"]')).toBeVisible();
    await expect(page.locator('[data-testid="console-input"]')).toBeFocused();

    // Focus rule: typing "p" into the console must not pause the game.
    await page.keyboard.type('p');
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => window.__faf!.paused)).toBe(false);
    await page.locator('[data-testid="console-input"]').fill('');

    await run(page, 'help');
    await expect(page.locator('[data-testid="console"]')).toContainText('spawn <n> [army] [bp]');

    // spawn 50 own cubes at the camera focus (cheat command through the pipeline).
    await run(page, 'spawn 50');
    await page.waitForFunction(() => window.__faf!.ownHandles().length === 1050);
    await run(page, 'spawn 6 1 core:cube');
    await page.waitForFunction(() => window.__faf!.armyUnitCount(1) === 30);

    // kill the selection (explicit selection of 10 own cubes).
    await page.evaluate(() => window.__faf!.select(window.__faf!.ownHandles().slice(0, 10)));
    await run(page, 'kill');
    await page.waitForFunction(() => window.__faf!.ownHandles().length === 1040);
    await page.evaluate(() => window.__faf!.select(null));

    // pause / step / speed / resume.
    await run(page, 'pause');
    await page.waitForFunction(() => window.__faf!.paused);
    const t0 = await page.evaluate(() => window.__faf!.tick);
    await run(page, 'step 5');
    await page.waitForFunction((t) => window.__faf!.tick === t + 5, t0);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__faf!.tick)).toBe(t0 + 5);
    await run(page, 'speed 2');
    await expect(page.locator('[data-testid="hud-speed"]')).toHaveText('2.00x');
    await run(page, 'resume');
    await page.waitForFunction(() => !window.__faf!.paused);
    // 2x: 20 ticks per second.
    const r0 = await page.evaluate(() => ({ tick: window.__faf!.tick, t: performance.now() }));
    await page.waitForTimeout(1500);
    const r1 = await page.evaluate(() => ({ tick: window.__faf!.tick, t: performance.now() }));
    const rate = ((r1.tick - r0.tick) * 1000) / (r1.t - r0.t);
    expect(rate).toBeGreaterThan(15);
    expect(rate).toBeLessThan(25);
    await run(page, 'speed 1');
    await expect(page.locator('[data-testid="hud-speed"]')).toHaveText('1.00x');

    // hash
    await run(page, 'hash');
    await expect(page.locator('[data-testid="console"]')).toContainText('Regel-Hash @ tick');
    await expect(page.locator('[data-testid="console"]')).toContainText('Frame-Fingerprint');

    // budget overlay with phases and hash tick (stats every 10 ticks).
    await run(page, 'budget');
    await expect(page.locator('[data-testid="budget"]')).toBeVisible();
    await expect(page.locator('[data-testid="budget-tick-p95"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="budget"] tr[data-phase="Movement"]')).toBeVisible();
    const stats = (await page.evaluate(() => window.__faf!.stats())) as {
      tickP95Us: number;
      hashTickP95Us: number;
      phases: { name: string; p50Us: number; p95Us: number }[];
    };
    expect(stats.phases.map((p) => p.name)).toEqual(expect.arrayContaining(['CommandApply', 'Movement', 'SpatialRebuild']));
    expect(stats.hashTickP95Us).toBeGreaterThan(0);
    await expect(page.locator('[data-testid="hud-sim-p95"]')).not.toHaveText('–');

    // export: command log as download.
    const downloadP = page.waitForEvent('download');
    await run(page, 'export');
    const download = await downloadP;
    expect(download.suggestedFilename()).toMatch(/^faf-[0-9a-f]{8}-t\d+\.faflog$/);
    const path = await download.path();
    expect(path).toBeTruthy();

    await run(page, 'transport');
    await expect(page.locator('[data-testid="console"]')).toContainText(`Transport: ${server.transport}`);

    // History: ArrowUp recalls the last command.
    await page.locator('[data-testid="console-input"]').press('ArrowUp');
    await expect(page.locator('[data-testid="console-input"]')).toHaveValue('transport');

    await run(page, 'frobnicate');
    await expect(page.locator('[data-testid="console"]')).toContainText("unbekannter Befehl 'frobnicate'");

    const text = await consoleText(page);
    await attachJson(testInfo, 'console', { stats, rate, text: text.split('\n') });

    // Close with F1 from inside the input (the key is not typed).
    await page.locator('[data-testid="console-input"]').press('F1');
    await expect(page.locator('[data-testid="console"]')).toBeHidden();
    expectNoErrors(errors);
  });
}
