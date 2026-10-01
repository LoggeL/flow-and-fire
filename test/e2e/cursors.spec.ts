import { PlacementVerdict } from '../../packages/rules/src/index.ts';
import { WatchOrderType } from '../../packages/protocol/src/index.ts';
import { assertSilentOutput } from '../../apps/game/test/support/silent-output.ts';
import { expect, test, type Page, type TestInfo } from './support/silent-test.ts';
import { attachJson, captureErrors, expectNoErrors, stepTicks } from './support/game.ts';
import { clickUnit, findOwnUnit, groundPixel, startHumanAiSkirmish } from './support/skirmish.ts';

interface Bounds { x: number; y: number; width: number; height: number }
async function pause(page: Page, wanted: boolean): Promise<void> {
  if (await page.evaluate(() => window.__faf!.paused) !== wanted) await page.keyboard.press('KeyP');
  await expect.poll(() => page.evaluate(() => window.__faf!.paused)).toBe(wanted);
}
async function cursor(page: Page, kind: string, hotspot = [16, 16]): Promise<string> {
  const canvas = page.locator('#game-canvas');
  await expect(canvas).toHaveAttribute('data-game-cursor', kind);
  const css = await canvas.evaluate(el => getComputedStyle(el).cursor);
  expect(css).toContain('data:image/svg+xml');
  expect(css).toContain(`${hotspot[0]} ${hotspot[1]}`);
  expect(css).toMatch(/default$/);
  return css;
}
async function rendered(page: Page): Promise<void> {
  const next = await page.evaluate(() => window.__faf!.renderStats().frames + 2);
  await page.waitForFunction(frame => window.__faf!.renderStats().frames >= frame, next);
}
async function compactScreenshots(page: Page, info: TestInfo, state: string, handles: number[]): Promise<unknown[]> {
  const layouts = [];
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(viewport);
    await rendered(page);
    await expect(page.getByTestId('hud').locator('.dock, .strip, .portrait')).toHaveCount(0);
    await expect(page.locator('[data-testid="minimap"], [data-testid="minimap-surface"], [data-component="Minimap"]')).toHaveCount(0);
    const selection = page.getByTestId('selection-panel');
    let bounds: Bounds | null = null, commands: Bounds | null = null;
    if (state === 'empty') {
      await expect(selection).toHaveCount(0);
      await expect(page.getByTestId('command-card')).toBeHidden();
      await expect(page.locator('.live-command-context')).toBeHidden();
    } else {
      await expect(selection).toBeVisible();
      await expect(selection.locator('img, canvas, .portrait')).toHaveCount(0);
      bounds = await page.locator('.live-selection-context').boundingBox();
      commands = await page.locator('.live-command-context').boundingBox();
      expect(bounds).not.toBeNull(); expect(commands).not.toBeNull();
      expect(commands!.x).toBeLessThanOrEqual(16);
      expect(commands!.width).toBeLessThanOrEqual(448);
      const cardPage = await page.getByTestId('hud').getAttribute('data-card-page');
      if (cardPage === 'orders') expect(commands!.width).toBeLessThanOrEqual(380);
      const hasEnhancements = await page.getByTestId('commander-upgrades').isVisible();
      expect(commands!.height).toBeLessThanOrEqual(hasEnhancements ? 380 : cardPage === 'orders' ? 128 : 300);
      expect(commands!.y + commands!.height).toBeGreaterThanOrEqual(viewport.height - 20);
      expect(bounds!.x).toBeGreaterThanOrEqual(commands!.x + commands!.width);
      expect(bounds!.x - (commands!.x + commands!.width)).toBeLessThanOrEqual(32);
      expect(bounds!.width).toBeLessThanOrEqual(280);
      expect(bounds!.width).toBeGreaterThanOrEqual(160);
      const maxSelectionHeight = 200;
      expect(bounds!.height).toBeLessThanOrEqual(maxSelectionHeight);
      expect(bounds!.y).toBeGreaterThanOrEqual(viewport.height - maxSelectionHeight - 20);
      expect(bounds!.y + bounds!.height).toBeGreaterThanOrEqual(viewport.height - 20);
      expect(commands!.x + commands!.width).toBeLessThanOrEqual(viewport.width);
      expect(commands!.y + commands!.height).toBeLessThanOrEqual(viewport.height);
    }
    const resource = await page.getByTestId('resource-bar').boundingBox(), status = await page.getByTestId('match-status').boundingBox();
    expect(resource).not.toBeNull(); expect(status).not.toBeNull();
    for (const box of [resource!, status!]) {
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width); expect(box.y + box.height).toBeLessThanOrEqual(90);
    }
    expect(resource!.x).toBeLessThanOrEqual(16);
    expect(resource!.width).toBeGreaterThanOrEqual(250); expect(resource!.width).toBeLessThanOrEqual(380);
    expect(status!.x).toBeGreaterThan(viewport.width * .65);
    const mass = await page.getByTestId('resource-mass').boundingBox(), energy = await page.getByTestId('resource-energy').boundingBox();
    expect(mass).not.toBeNull(); expect(energy).not.toBeNull();
    expect(Math.abs(mass!.x - energy!.x)).toBeLessThanOrEqual(2);
    expect(energy!.y).toBeGreaterThanOrEqual(mass!.y + mass!.height);
    expect(resource!.x + resource!.width <= status!.x || status!.x + status!.width <= resource!.x ||
      resource!.y + resource!.height <= status!.y || status!.y + status!.height <= resource!.y).toBe(true);
    const clearWorld = await page.evaluate(({ width, height }) => ({
      center: document.elementFromPoint(width / 2, height * .45)?.id === 'game-canvas',
      bottomMiddle: document.elementFromPoint(width / 2, height - 20)?.id === 'game-canvas',
      bottomRight: document.elementFromPoint(width - 20, height - 20)?.id === 'game-canvas',
    }), viewport);
    expect(clearWorld, 'battlefield center, bottom middle and bottom right receive native canvas interaction').toEqual({ center: true, bottomMiddle: true, bottomRight: true });
    const projectedUnits = await page.evaluate(ids => ids.map(handle => ({ handle, pixel: window.__faf!.unitScreenPos(handle) })), handles);
    for (const unit of projectedUnits) {
      expect(unit.pixel, `real unit ${unit.handle} is visible in the ${state} screenshot`).not.toBeNull();
      expect(unit.pixel!.x).toBeGreaterThan(0); expect(unit.pixel!.x).toBeLessThan(viewport.width);
      expect(unit.pixel!.y).toBeGreaterThan(90); expect(unit.pixel!.y).toBeLessThan(viewport.height);
      expect(await page.evaluate(pixel => document.elementFromPoint(pixel.x, pixel.y)?.id, unit.pixel!)).toBe('game-canvas');
    }
    const screenshot = info.outputPath(`compact-${state}-${viewport.width}.png`);
    await page.screenshot({ path: screenshot });
    await info.attach(`compact-${state}-${viewport.width}`, { path: screenshot, contentType: 'image/png' });
    layouts.push({ state, viewport, selection: bounds, commands, resource, mass, energy, status, clearWorld, projectedUnits });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await rendered(page);
  return layouts;
}

test('native world cursors, compact HUD and real construction/queue controls', async ({ page }, info) => {
  test.setTimeout(180_000);
  const errors = captureErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const commander = await startHumanAiSkirmish(page);
  await pause(page, true);
  const position = await page.evaluate(handle => window.__faf!.unitPos(handle)!, commander);
  // Only the presentation camera changes; the real paused units and fog stay authoritative.
  await page.evaluate(p => window.__faf!.setCamera(p.x, p.z, 52), position);
  await rendered(page);
  const screenshotCamera = await page.evaluate(() => window.__faf!.cameraState());
  const ground = await groundPixel(page, position.x + 16, position.z);
  await page.mouse.click(ground.x, ground.y);
  await expect.poll(() => page.evaluate(() => window.__faf!.selected())).toEqual([]);
  const css: Record<string, string> = {};
  css['arrow'] = await cursor(page, 'arrow', [4, 3]);
  const layouts = await compactScreenshots(page, info, 'empty', [commander]);
  const own = await page.evaluate(handle => window.__faf!.unitScreenPos(handle)!, commander);
  await page.mouse.move(own.x, own.y);
  css['select'] = await cursor(page, 'select', [4, 3]);
  await clickUnit(page, commander);
  await expect(page.getByTestId('unit-detail')).toBeVisible();
  const groundAfterResize = await groundPixel(page, position.x + 16, position.z);
  await page.mouse.move(groundAfterResize.x, groundAfterResize.y);
  css['move'] = await cursor(page, 'move');
  layouts.push(...await compactScreenshots(page, info, 'commander', [commander]));

  for (const [key, kind] of [['Alt+KeyA', 'attack'], ['Alt+KeyW', 'patrol'], ['Alt+KeyE', 'assist'], ['Alt+KeyT', 'repair'], ['Alt+KeyR', 'reclaim']] as const) {
    await page.keyboard.press(key);
    const pixel = await groundPixel(page, position.x + 16, position.z);
    await page.mouse.move(pixel.x, pixel.y);
    css[kind] = await cursor(page, kind);
    if (kind === 'patrol') {
      await page.mouse.click(pixel.x, pixel.y);
      await stepTicks(page, 2);
      await expect.poll(() => page.evaluate(handle => window.__faf!.watch().find(record => record.handle === handle)?.targets[0]?.type, commander)).toBe(WatchOrderType.Patrol);
      await page.keyboard.press('Alt+KeyS');
      await stepTicks(page, 2);
      await expect.poll(() => page.evaluate(handle => window.__faf!.watch().find(record => record.handle === handle)?.orders, commander)).toBe(0);
    } else await page.keyboard.press('Escape');
    await cursor(page, 'move');
  }
  await page.keyboard.press('KeyA');
  const ghost = page.getByTestId('build-ghost');
  let site: { x: number; z: number } | null = null;
  for (const [dx, dz] of [[8, 0], [0, 8], [-8, 0], [0, -8], [10, 6], [-10, -6]]) {
    const candidate = { x: Math.floor(position.x + dx!) + .5, z: Math.floor(position.z + dz!) + .5 };
    const pixel = await groundPixel(page, candidate.x, candidate.z);
    await page.mouse.move(pixel.x, pixel.y);
    await expect(ghost).toHaveAttribute('data-x', String(Math.round(candidate.x * 4096)));
    await expect(ghost).toHaveAttribute('data-z', String(Math.round(candidate.z * 4096)));
    if (await ghost.getAttribute('data-verdict') !== String(PlacementVerdict.Valid)) continue;
    site = candidate; css['build'] = await cursor(page, 'build', [7, 3]);
    await page.mouse.click(pixel.x, pixel.y); break;
  }
  expect(site).not.toBeNull();
  await pause(page, false);
  await expect.poll(() => findOwnUnit(page, 'core:fac_land_t1'), { timeout: 30_000 }).not.toBeNull();
  await expect.poll(() => page.evaluate(handle => window.__faf!.watch().find(record => record.handle === handle)?.orders, commander), { timeout: 45_000 }).toBe(0);
  const factory = (await findOwnUnit(page, 'core:fac_land_t1'))!;
  await pause(page, true);
  await page.keyboard.press('KeyA');
  const occupied = await groundPixel(page, site!.x, site!.z);
  await page.mouse.move(occupied.x, occupied.y);
  await expect(ghost).toHaveAttribute('data-verdict', String(PlacementVerdict.Occupied));
  css['blocked'] = await cursor(page, 'blocked');
  await page.keyboard.press('Escape');
  await expect(ghost).toHaveCount(0);
  await cursor(page, 'select', [4, 3]);
  await clickUnit(page, factory);
  await page.getByTestId('factory-queue').getByRole('button', { name: 'Rally', exact: true }).click();
  const rally = await groundPixel(page, site!.x + 12, site!.z);
  await page.mouse.click(rally.x, rally.y);
  await page.getByRole('gridcell').filter({ hasText: 'Lehrling' }).click({ modifiers: ['Shift'] });
  await stepTicks(page, 4);
  await expect(page.getByTestId('factory-queue').locator('.fq__now')).toContainText('Lehrling');
  const acceptedQueue = (await page.evaluate(handle => window.__faf!.inspection()!.watches.find(w => w.handle === handle), factory))!;
  expect(acceptedQueue.product).toBe('core:eng_t1');
  expect(acceptedQueue.queue).toEqual(Array(5).fill('core:eng_t1'));
  await expect(page.getByTestId('factory-queue').locator('.fqi')).toHaveCount(1);
  await expect(page.getByTestId('factory-queue').locator('.fqi b')).toHaveText('4');
  layouts.push(...await compactScreenshots(page, info, 'factory', [commander, factory]));
  const queue = page.getByTestId('factory-queue');
  await queue.getByRole('button', { name: 'Pause', exact: true }).click();
  await stepTicks(page, 2);
  await expect(queue).toHaveClass(/is-paused/);
  const progress = await page.evaluate(handle => window.__faf!.inspection()!.watches.find(w => w.handle === handle)!.progress, factory);
  await stepTicks(page, 3);
  expect(await page.evaluate(handle => window.__faf!.inspection()!.watches.find(w => w.handle === handle)!.progress, factory)).toBe(progress);
  await queue.getByRole('button', { name: 'Pause', exact: true }).click();
  await stepTicks(page, 2);
  await expect(queue).not.toHaveClass(/is-paused/);

  // The third selected type is produced by the real factory, with no diagnostic spawn.
  await pause(page, false);
  await expect.poll(() => findOwnUnit(page, 'core:eng_t1'), { timeout: 30_000 }).not.toBeNull();
  const engineer = (await findOwnUnit(page, 'core:eng_t1'))!;
  await expect.poll(() => page.evaluate(({ handle, site }) => {
    const p = window.__faf!.unitPos(handle);
    return p === null ? 0 : Math.hypot(p.x - site.x, p.z - site.z);
  }, { handle: engineer, site: site! }), { timeout: 15_000 }).toBeGreaterThan(6);
  await pause(page, true);
  await clickUnit(page, commander);
  await page.keyboard.down('Shift');
  try {
    for (const handle of [factory, engineer]) {
      const pixel = await page.evaluate(h => window.__faf!.unitScreenPos(h), handle);
      expect(pixel).not.toBeNull();
      await page.mouse.click(pixel!.x, pixel!.y);
    }
  } finally { await page.keyboard.up('Shift'); }
  await expect.poll(() => page.evaluate(() => [...window.__faf!.selected()].sort((a, b) => a - b))).toEqual([commander, factory, engineer].sort((a, b) => a - b));
  await expect(page.getByTestId('hud')).toHaveAttribute('data-selection-kind', 'multi');
  await expect(page.getByTestId('selection-groups').locator('.live-type-group')).toHaveCount(3);
  for (const typeId of ['core:cmd_commander', 'core:str_t1_fac_land', 'core:lnd_t1_engineer']) {
    const group = page.getByTestId('selection-groups').locator(`[data-type="${typeId}"]`);
    await expect(group).toHaveAttribute('data-count', '1');
    await expect(group.locator('b')).toHaveText('1');
  }
  layouts.push(...await compactScreenshots(page, info, 'multi', [commander, factory, engineer]));

  const emptyGround = await groundPixel(page, position.x + 16, position.z);
  await page.mouse.click(emptyGround.x, emptyGround.y);
  await expect.poll(() => page.evaluate(() => window.__faf!.selected())).toEqual([]);
  await page.mouse.move(720, 400);
  const pausedTick = await page.evaluate(() => window.__faf!.tick);
  const panBefore = await page.evaluate(() => window.__faf!.cameraState());
  await page.mouse.down({ button: 'middle' });
  css['pan'] = await cursor(page, 'pan');
  await page.mouse.move(810, 450, { steps: 6 });
  await page.mouse.up({ button: 'middle' });
  const panAfter = await page.evaluate(() => window.__faf!.cameraState());
  expect(Math.hypot(panAfter.x - panBefore.x, panAfter.z - panBefore.z)).toBeGreaterThan(1);
  await page.keyboard.down('Control');
  await page.mouse.down({ button: 'middle' });
  css['rotate'] = await cursor(page, 'rotate');
  await page.mouse.move(860, 430, { steps: 6 });
  await page.mouse.up({ button: 'middle' });
  await page.keyboard.up('Control');
  const rotated = await page.evaluate(() => window.__faf!.cameraState());
  expect(Math.abs(rotated.yaw - panAfter.yaw)).toBeGreaterThan(.1);
  await page.keyboard.press('Home');
  const edges = [];
  if (await page.evaluate(() => document.hasFocus())) {
    for (const [kind, x, y, ex, ey] of [
      ['north',720,2,0,1], ['northEast',1438,2,1,1], ['east',1438,450,1,0], ['southEast',1438,898,1,-1],
      ['south',720,898,0,-1], ['southWest',2,898,-1,-1], ['west',2,450,-1,0], ['northWest',2,2,-1,1],
    ] as const) {
      await page.mouse.move(720, 400);
      await page.evaluate(() => window.__faf!.setCamera(120, 96, 80));
      await rendered(page);
      const before = await page.evaluate(() => window.__faf!.cameraState());
      await page.mouse.move(x, y);
      css[kind] = await cursor(page, kind);
      await page.waitForTimeout(150);
      const after = await page.evaluate(() => window.__faf!.cameraState());
      const dx = after.x - before.x, dz = after.z - before.z;
      if (ex !== 0) expect((-Math.sin(before.yaw) * dx + Math.cos(before.yaw) * dz) * ex).toBeGreaterThan(.5);
      if (ey !== 0) expect((Math.cos(before.yaw) * dx + Math.sin(before.yaw) * dz) * ey).toBeGreaterThan(.5);
      edges.push({ kind, before, after });
    }
  } else info.annotations.push({ type: 'skip-part', description: 'Native edge-pan requires document focus; headless engine did not provide it.' });
  await page.mouse.move(720, 400);
  await page.mouse.down({ button: 'middle' });
  await cursor(page, 'pan');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('game-menu')).toBeVisible();
  await cursor(page, 'arrow', [4, 3]);
  await page.mouse.up({ button: 'middle' });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('game-menu')).toBeHidden();
  await cursor(page, 'arrow', [4, 3]);
  expect(await page.evaluate(() => window.__faf!.tick)).toBe(pausedTick);
  expect(await page.evaluate(() => window.__faf!.tainted)).toBe(false);
  expect(await page.evaluate(() => window.__faf!.hostErrors)).toEqual([]);
  await assertSilentOutput(page);
  await attachJson(info, 'native-cursors-compact-hud', { commander, factory, engineer, site, screenshotCamera, layouts, css, edges, panBefore, panAfter, rotated,
    cancellation: 'Native Escape while middle-dragging resets through the actual modal. No synthetic pointercancel and no pointer-lock availability claim.' });
  expectNoErrors(errors);
});
