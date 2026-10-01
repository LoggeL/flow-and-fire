import { WatchOrderType } from '../../packages/protocol/src/index.ts';
import { assertSilentOutput, installSilentOutput } from '../../apps/game/test/support/silent-output.ts';
import { expect, test, type Page, type TestInfo } from './support/silent-test.ts';
import { attachJson, captureErrors, expectNoErrors, stepTicks } from './support/game.ts';
import { clickUnit, SKIRMISH_BLUEPRINTS, startHumanAiSkirmish } from './support/skirmish.ts';

async function rendered(page: Page): Promise<void> {
  const next = await page.evaluate(() => window.__faf!.renderStats().frames + 2);
  await page.waitForFunction(frame => window.__faf!.renderStats().frames >= frame, next);
}

async function snapshot(page: Page, handle: number) {
  return page.evaluate(id => {
    const h = window.__faf!, inspection = h.inspection()!;
    return { tick: h.tick, unit: h.unitInfo(id), position: h.unitPos(id),
      watch: h.watch().find(w => w.handle === id), work: inspection.watches.find(w => w.handle === id),
      bank: inspection.eco.find(e => e.army === 0)!, sentCommands: inspection.sentCommands,
      hpText: document.querySelector('[data-testid="unit-detail"] .live-hp')?.textContent,
      resourceText: document.querySelector('[data-testid="resource-bar"]')?.textContent };
  }, handle);
}

async function screenshots(page: Page, info: TestInfo, state: string) {
  const layouts = [];
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(viewport);
    await rendered(page);
    const hud = page.getByTestId('hud'), upgrades = page.getByTestId('commander-upgrades');
    await expect(upgrades).toBeVisible();
    await expect(hud.locator('.dock, .strip, .portrait')).toHaveCount(0);
    await expect(page.locator('[data-testid="minimap"], [data-testid="minimap-surface"], [data-component="Minimap"]')).toHaveCount(0);
    await expect(page.getByTestId('selection-panel').locator('img, canvas, .portrait')).toHaveCount(0);
    const commands = await page.locator('.live-command-context').boundingBox();
    const selection = await page.locator('.live-selection-context').boundingBox();
    expect(commands).not.toBeNull(); expect(selection).not.toBeNull();
    expect(commands!.width).toBeLessThanOrEqual(448);
    // Only the actually visible ACU enhancement row earns this extra height budget.
    const hasEnhancements = await upgrades.isVisible();
    expect(commands!.height).toBeLessThanOrEqual(hasEnhancements ? 380 : 300);
    expect(commands!.x).toBeGreaterThanOrEqual(0);
    expect(commands!.y).toBeGreaterThanOrEqual(0);
    expect(commands!.x + commands!.width).toBeLessThanOrEqual(viewport.width);
    expect(commands!.y + commands!.height).toBeLessThanOrEqual(viewport.height);
    expect(selection!.x).toBeGreaterThanOrEqual(commands!.x + commands!.width);
    expect(selection!.width).toBeLessThanOrEqual(280);
    expect(selection!.height).toBeLessThanOrEqual(200);
    const buildCells = await page.getByTestId('command-card').locator('.ff-cell').evaluateAll(cells => cells.map(cell => {
      const glyph = cell.querySelector('.ff-cell__icon')!, name = cell.querySelector('.ff-cell__name')!, track = cell.querySelector('.ff-cell__progress')!;
      return { button: cell.getBoundingClientRect().toJSON(), glyph: glyph.getBoundingClientRect().toJSON(),
        name: name.getBoundingClientRect().toJSON(), track: track.getBoundingClientRect().toJSON(),
        textDecoration: getComputedStyle(name).textDecorationLine };
    }));
    expect(buildCells.length).toBeGreaterThan(0);
    for (const cell of buildCells) {
      expect(cell.button.width).toBeGreaterThanOrEqual(44);
      expect(cell.button.height).toBeGreaterThanOrEqual(44);
      expect(cell.glyph.width).toBeGreaterThanOrEqual(24);
      expect(cell.glyph.height).toBeGreaterThanOrEqual(24);
      expect(cell.textDecoration).not.toContain('line-through');
      expect(cell.track.top, 'progress does not cross a build icon or its label').toBeGreaterThanOrEqual(Math.max(cell.glyph.bottom, cell.name.bottom));
      expect(cell.track.bottom).toBeLessThanOrEqual(cell.button.bottom);
    }
    const clearWorld = await page.evaluate(({ width, height }) => ({
      center: document.elementFromPoint(width / 2, height * .45)?.id === 'game-canvas',
      bottomMiddle: document.elementFromPoint(width / 2, height - 20)?.id === 'game-canvas',
      bottomRight: document.elementFromPoint(width - 20, height - 20)?.id === 'game-canvas',
    }), viewport);
    expect(clearWorld).toEqual({ center: true, bottomMiddle: true, bottomRight: true });
    const path = info.outputPath(`acu-${state}-${viewport.width}.png`);
    await page.screenshot({ path });
    await info.attach(`acu-${state}-${viewport.width}`, { path, contentType: 'image/png' });
    layouts.push({ state, viewport, commands, selection, clearWorld, hasEnhancements, buildCells });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await rendered(page);
  return layouts;
}

test('native ACU engineering upgrade pauses, cancels without refund, completes and unlocks armor', async ({ page }, info) => {
  test.setTimeout(180_000);
  const errors = captureErrors(page);
  await installSilentOutput(page); // Before navigation; the automatic fixture also enforces this.
  await page.setViewportSize({ width: 1440, height: 900 });
  const commander = await startHumanAiSkirmish(page);
  await assertSilentOutput(page);
  if (!await page.evaluate(() => window.__faf!.paused)) await page.keyboard.press('KeyP');
  await expect.poll(() => page.evaluate(() => window.__faf!.paused)).toBe(true);
  const position = await page.evaluate(handle => window.__faf!.unitPos(handle)!, commander);
  await page.evaluate(p => window.__faf!.setCamera(p.x, p.z, 52), position);
  await rendered(page);
  await clickUnit(page, commander);
  const initial = await snapshot(page, commander);
  const base = SKIRMISH_BLUEPRINTS.indexOf('core:cmd_commander');
  const engineering = SKIRMISH_BLUEPRINTS.indexOf('core:cmd_commander_engineering');
  const armor = SKIRMISH_BLUEPRINTS.indexOf('core:cmd_commander_armored');
  expect(base).toBeGreaterThanOrEqual(0); expect(engineering).toBeGreaterThanOrEqual(0); expect(armor).toBeGreaterThanOrEqual(0);
  expect(initial.unit?.visual).toBe(base);
  await expect(page.getByTestId('unit-detail').locator('.live-hp')).toContainText('12000 / 12000');
  await expect(page.getByTestId('selection-details-toggle')).toHaveAttribute('aria-expanded', 'false');
  const upgrade = page.getByTestId('commander-upgrades'), start = page.getByTestId('commander-upgrade-start');
  await expect(start).toBeVisible(); await expect(start).toBeEnabled();
  await expect(start).toContainText('300 M'); await expect(start).toContainText('3.000 E');
  await expect(start).toContainText('Baukraft 10 → 20');
  await expect(start).toContainText('HP 12.000 → 16.000');
  const image = start.locator('img');
  await expect(image).toHaveAttribute('alt', ''); await expect(image).toHaveAttribute('aria-hidden', 'true');
  await expect.poll(() => image.evaluate(el => ({ loaded: (el as HTMLImageElement).complete, width: (el as HTMLImageElement).naturalWidth }))).toEqual({ loaded: true, width: 64 });
  const icon = await image.boundingBox(); expect(icon).not.toBeNull();
  expect(icon!.width).toBe(32); expect(icon!.height).toBe(32);
  const engineeringIconSrc = await image.getAttribute('src');
  const layouts = await screenshots(page, info, 'available');

  await start.click();
  await stepTicks(page, 10);
  await expect.poll(() => page.evaluate(id => window.__faf!.watch().find(w => w.handle === id)?.targets[0]?.type, commander)).toBe(WatchOrderType.Upgrade);
  const started = await snapshot(page, commander);
  expect(started.work?.product).toBe('core:cmd_commander_engineering');
  expect(started.work!.progress).toBeGreaterThan(0);
  await expect(page.getByTestId('commander-upgrade-progress')).toBeVisible();
  layouts.push(...await screenshots(page, info, 'running'));

  await page.getByTestId('commander-upgrade-pause').click();
  await stepTicks(page, 2);
  await expect(upgrade).toContainText('Pausiert');
  const paused = await snapshot(page, commander);
  await stepTicks(page, 10);
  const held = await snapshot(page, commander);
  expect(held.work?.progress, 'unit pause holds accepted upgrade progress while the world advances').toBe(paused.work?.progress);
  expect(held.unit?.visual).toBe(base);
  await page.getByTestId('commander-upgrade-pause').click();
  await stepTicks(page, 10);
  const resumed = await snapshot(page, commander);
  expect(resumed.work!.progress).toBeGreaterThan(held.work!.progress);
  await expect(upgrade).not.toContainText('Pausiert');

  const beforeCancel = await snapshot(page, commander);
  await page.getByTestId('commander-upgrade-cancel').click();
  await stepTicks(page, 2);
  await expect(start).toBeVisible(); await expect(start).toBeEnabled();
  const canceled = await snapshot(page, commander);
  expect(canceled.unit?.visual).toBe(base);
  expect(canceled.watch?.targets.some(target => target.type === WatchOrderType.Upgrade) ?? false).toBe(false);
  const cancelTicks = canceled.tick - beforeCancel.tick;
  // Read-only accounting bound: cancellation may add normal commander income, never paid work.
  expect(canceled.bank.massStored).toBeLessThanOrEqual(beforeCancel.bank.massStored + cancelTicks * 100);
  expect(canceled.bank.energyStored).toBeLessThanOrEqual(beforeCancel.bank.energyStored + cancelTicks * 2000);
  await expect(page.getByTestId('unit-detail').locator('.live-hp')).toContainText('12000 / 12000');

  await start.click();
  const restartTick = await page.evaluate(() => window.__faf!.tick);
  const progress = [];
  for (let batch = 0; batch < 65; batch++) {
    await stepTicks(page, 10);
    const sample = await snapshot(page, commander);
    if (batch % 5 === 0 || sample.unit?.visual === engineering) progress.push(sample);
    if (sample.unit?.visual === engineering) break;
  }
  const completed = await snapshot(page, commander);
  expect(completed.unit?.visual, 'accepted Frame replaces the original handle with the compiled engineering blueprint').toBe(engineering);
  expect(completed.tick - restartTick).toBeLessThanOrEqual(650);
  expect(completed.position).toEqual(initial.position);
  expect(await page.evaluate(id => window.__faf!.ownHandles().includes(id), commander)).toBe(true);
  // Payment commits the successor blueprint before ordinary orders retire the completed head.
  // The paused world needs one more real accepted tick before the next enhancement is available.
  await stepTicks(page, 1);
  const retired = await snapshot(page, commander);
  expect(retired.tick).toBe(completed.tick + 1);
  expect(retired.unit?.visual).toBe(engineering);
  expect(retired.position).toEqual(completed.position);
  expect(retired.watch?.targets.some(target => target.type === WatchOrderType.Upgrade) ?? false).toBe(false);
  await expect(page.getByTestId('unit-detail').locator('.live-hp')).toContainText('16000 / 16000');
  await expect(start).toBeVisible(); await expect(start).toBeEnabled();
  await expect(start).toContainText('Vogt, verstärkte Panzerung');
  await expect(start).toContainText('400 M'); await expect(start).toContainText('5.000 E');
  await expect(start).toContainText('HP 16.000 → 24.000');
  await expect(image).toHaveAttribute('alt', ''); await expect(image).toHaveAttribute('aria-hidden', 'true');
  await expect.poll(() => image.evaluate(el => ({ loaded: (el as HTMLImageElement).complete,
    width: (el as HTMLImageElement).naturalWidth, height: (el as HTMLImageElement).naturalHeight }))).toEqual({ loaded: true, width: 64, height: 64 });
  const armorIcon = await image.boundingBox(); expect(armorIcon).not.toBeNull();
  expect(armorIcon!.width).toBe(32); expect(armorIcon!.height).toBe(32);
  const armorIconSrc = await image.getAttribute('src');
  expect(armorIconSrc).not.toBe(engineeringIconSrc);
  await page.getByTestId('selection-details-toggle').click();
  await expect(page.locator('.live-unit-stats')).toContainText('BP 20,0');
  await page.getByTestId('selection-details-toggle').click();
  await expect(page.getByTestId('command-card')).toBeVisible();
  await expect(page.getByTestId('resource-mass')).toBeVisible();
  await expect(page.getByTestId('resource-energy')).toBeVisible();
  layouts.push(...await screenshots(page, info, 'engineering-complete'));
  expect(await page.evaluate(() => window.__faf!.tainted)).toBe(false);
  expect(await page.evaluate(() => window.__faf!.hostErrors)).toEqual([]);
  await assertSilentOutput(page);
  const silent = await page.evaluate(() => (window as unknown as { __fafSilentAudio: { installed: boolean; contexts: number; streamDestinations: number; speakerConnections: number; blockedConnections: number } }).__fafSilentAudio);
  await attachJson(info, 'native-commander-upgrade', { commander, compiled: { base, engineering, armor }, icon, engineeringIconSrc, armorIcon, armorIconSrc, initial, started, paused, held, resumed, beforeCancel, canceled, completed, retired, restartTick, progress, layouts, silent,
    boundary: 'Original untainted skirmish commander, native HUD commands and accepted Frame inspection. No diagnostic spawn, model mutation or authoritative World access.' });
  expectNoErrors(errors);
});
