import { PlacementVerdict } from '../../packages/rules/src/index.ts';
import { assertSilentOutput } from '../../apps/game/test/support/silent-output.ts';
import { expect, test } from './support/silent-test.ts';
import { attachJson, captureErrors, expectNoErrors, waitTick } from './support/game.ts';
import { clickUnit, findOwnUnit, groundPixel, startHumanAiSkirmish } from './support/skirmish.ts';

test('real human/AI skirmish: factory hotbuild, occupied footprint, production and surrender/rematch', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const errors = captureErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const commander = await startHumanAiSkirmish(page);
  await expect(page.locator('[data-testid="minimap"], [data-testid="minimap-surface"], [data-component="Minimap"]')).toHaveCount(0);
  await expect(page.getByTestId('hud').locator('.dock, .strip, .portrait')).toHaveCount(0);
  const layouts = [];
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(viewport);
    await expect(page.getByTestId('resource-bar')).toBeVisible();
    await expect(page.getByTestId('match-status')).toBeVisible();
    await expect.poll(async () => {
      const resource = await page.getByTestId('resource-bar').boundingBox();
      const match = await page.getByTestId('match-status').boundingBox();
      if (resource === null || match === null) return false;
      const inside = [resource, match].every(rect => rect.width > 0 && rect.height > 0 && rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= viewport.width && rect.y + rect.height <= 90);
      const separated = resource.x + resource.width <= match.x || match.x + match.width <= resource.x || resource.y + resource.height <= match.y || match.y + match.height <= resource.y;
      return inside && separated;
    }, { message: `Visible resource and status bars stay inside ${viewport.width}x${viewport.height} without overlap` }).toBe(true);
    layouts.push({ viewport, resource: await page.getByTestId('resource-bar').boundingBox(), match: await page.getByTestId('match-status').boundingBox() });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await clickUnit(page, commander);
  await expect(page.getByTestId('unit-detail')).toBeVisible();
  await expect(page.getByTestId('selection-panel').locator('img, canvas, .portrait, .ff-si')).toHaveCount(0);
  const factoryCard = page.getByTestId('card-KeyA');
  await expect(factoryCard).toHaveAttribute('aria-disabled', 'false');
  await expect(factoryCard).toContainText('Landwerk');
  const position = await page.evaluate(handle => window.__faf!.unitPos(handle)!, commander);
  await page.keyboard.press('KeyA');
  const ghost = page.getByTestId('build-ghost');
  await expect(ghost).toHaveAttribute('data-type', 'core:str_t1_fac_land');

  // Probe actual HUD placement around the commander. No blueprint/world mutation is used.
  let site: { x: number; z: number } | null = null;
  for (const [dx, dz] of [[8, 0], [0, 8], [-8, 0], [0, -8], [10, 6], [-10, -6]]) {
    const target = { x: Math.floor(position.x + dx!) + .5, z: Math.floor(position.z + dz!) + .5 };
    const pixel = await groundPixel(page, target.x, target.z);
    await page.mouse.move(pixel.x, pixel.y);
    await expect(ghost).toBeVisible();
    await expect(ghost).toHaveAttribute('data-x', String(Math.round(target.x * 4096)));
    await expect(ghost).toHaveAttribute('data-z', String(Math.round(target.z * 4096)));
    if (await ghost.getAttribute('data-verdict') !== String(PlacementVerdict.Valid)) continue;
    site = { x: Number(await ghost.getAttribute('data-x')) / 4096, z: Number(await ghost.getAttribute('data-z')) / 4096 };
    await page.mouse.click(pixel.x, pixel.y);
    break;
  }
  expect(site, 'at least one real nearby factory footprint is valid').not.toBeNull();
  await expect.poll(() => page.evaluate(() => (window.__faf!.fxStats() as { beams: number }).beams), { timeout: 20_000 }).toBeGreaterThan(0);
  await expect.poll(() => findOwnUnit(page, 'core:fac_land_t1')).not.toBeNull();
  const factory = (await findOwnUnit(page, 'core:fac_land_t1'))!;
  // The commander's selected watch record empties only after actual construction completes.
  await expect.poll(() => page.evaluate(handle => window.__faf!.watch().find(record => record.handle === handle)?.orders, commander), { timeout: 45_000 }).toBe(0);
  expect(await page.evaluate(() => window.__faf!.tainted)).toBe(false);

  await page.keyboard.press('KeyA');
  const occupied = await groundPixel(page, site!.x, site!.z);
  await page.mouse.move(occupied.x, occupied.y);
  await expect(ghost).toHaveAttribute('data-verdict', String(PlacementVerdict.Occupied));
  await page.keyboard.press('Escape');
  await clickUnit(page, factory);
  await expect(page.getByTestId('factory-detail')).toBeVisible();
  const queue = page.getByTestId('factory-queue');
  await expect(queue).toContainText('Leerlauf');

  // The armed Rally control accepts a left-click; a right-click cancels armed orders.
  await queue.getByRole('button', { name: 'Rally', exact: true }).click();
  const rally = { x: site!.x + 12, z: site!.z };
  const rallyPixel = await groundPixel(page, rally.x, rally.z);
  await page.mouse.click(rallyPixel.x, rallyPixel.y);
  await page.getByTestId('selection-details-toggle').click();
  await expect(page.getByTestId('factory-detail')).toContainText('Rally: gesetzt');
  await page.getByTestId('selection-details-toggle').click();

  // The grid presents only the actual T1 engineer available to this compiled factory.
  await page.getByRole('gridcell').filter({ hasText: 'Lehrling' }).click({ modifiers: ['Shift'] });
  await expect(queue.locator('.fq__now')).toContainText('Lehrling');
  await queue.getByRole('button', { name: 'Wiederholen', exact: true }).click();
  await expect(queue.getByRole('button', { name: 'Wiederholen', exact: true })).toHaveClass(/is-on/);
  await queue.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(queue).toHaveClass(/is-paused/);
  const progress = queue.locator('.fq__now [data-testid="bar-build"] i');
  const pausedProgress = await progress.evaluate(el => el.style.getPropertyValue('--v'));
  const pauseTick = await page.evaluate(() => window.__faf!.tick);
  await waitTick(page, pauseTick + 20);
  expect(await progress.evaluate(el => el.style.getPropertyValue('--v'))).toBe(pausedProgress);
  await queue.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(queue).not.toHaveClass(/is-paused/);
  await expect.poll(() => findOwnUnit(page, 'core:eng_t1'), { timeout: 30_000 }).not.toBeNull();
  const engineer = (await findOwnUnit(page, 'core:eng_t1'))!;
  await expect.poll(() => page.evaluate(({ handle, target }) => {
    const p = window.__faf!.unitPos(handle);
    return p === null ? Infinity : Math.hypot(p.x - target.x, p.z - target.z);
  }, { handle: engineer, target: rally }), { timeout: 20_000 }).toBeLessThan(2);

  await page.keyboard.press('Escape');
  const menu = page.getByTestId('game-menu');
  await menu.getByRole('button', { name: 'Aufgeben', exact: true }).click();
  await menu.getByRole('button', { name: 'Bestätigen', exact: true }).click();
  await expect(page.getByTestId('ScoreScreen')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'Lot gebrochen', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__faf!.tainted)).toBe(false);
  const finished = await page.evaluate(() => ({ tick: window.__faf!.tick, own: window.__faf!.ownHandles().length, hostErrors: window.__faf!.hostErrors, fx: window.__faf!.fxStats() }));
  expect(finished.own).toBe(0);
  expect(finished.hostErrors).toEqual([]);
  await page.getByRole('button', { name: 'Revanche', exact: true }).click();
  await expect(page.getByTestId('live-hud')).toHaveAttribute('data-screen', 'game');
  await expect.poll(() => findOwnUnit(page, 'core:cmd_commander'), { timeout: 60_000 }).not.toBeNull();
  await expect.poll(() => page.evaluate(() => window.__faf!.tick)).toBeLessThan(finished.tick);
  expect(await page.evaluate(() => window.__faf!.tainted)).toBe(false);
  await page.keyboard.press('Escape');
  await page.getByTestId('game-menu').getByRole('button', { name: 'Ins Hauptmenü', exact: true }).click();
  await expect(page.getByTestId('MainMenu')).toBeVisible();
  await assertSilentOutput(page);
  await attachJson(testInfo, 'real-skirmish', { commander, factory, engineer, site, rally, layouts, finished });
  expectNoErrors(errors);
});
