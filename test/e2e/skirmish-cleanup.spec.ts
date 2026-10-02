import { expect, test, type Locator, type Page } from './support/silent-test.ts';
import { assertSilentOutput } from '../../apps/game/test/support/silent-output.ts';
import { attachJson, captureErrors, COI_URL, expectNoErrors } from './support/game.ts';
import { findOwnUnit, setFrontendLocale } from './support/skirmish.ts';

async function layout(page: Page, setup: Locator) {
  const preview = await setup.getByTestId('skirmish-map-preview').boundingBox();
  expect(preview).not.toBeNull();
  expect(Math.abs(preview!.width - preview!.height), 'Terrain preview retains its square shape').toBeLessThan(1);
  const widths = await page.evaluate(() => ({ viewport: innerWidth, html: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  expect(widths.html).toBeLessThanOrEqual(widths.viewport + 1);
  expect(widths.body).toBeLessThanOrEqual(widths.viewport + 1);
  const panels = await setup.locator('.skirmish-lobby > *').evaluateAll(elements => elements.map(el => {
    const rect = el.getBoundingClientRect();
    return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom };
  }));
  expect(panels).toHaveLength(2);
  const [map, config] = panels;
  expect(map!.bottom, 'Map panel contains its full preview').toBeGreaterThanOrEqual(preview!.y + preview!.height);
  if (widths.viewport <= 780) {
    expect(config!.y, 'Phone player options follow the map without overlap').toBeGreaterThanOrEqual(map!.bottom + 15);
  } else {
    expect(config!.x, 'Desktop player options sit beside the map without overlap').toBeGreaterThanOrEqual(map!.right + 19);
  }
  const actions = [];
  for (const button of [setup.getByRole('button', { name: 'Zurück', exact: true }), setup.getByRole('button', { name: 'Gefecht starten', exact: true })]) {
    await expect(button).toBeVisible();
    const bounds = await button.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(widths.viewport + 1);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
    expect(await button.evaluate(el => {
      const rect = el.getBoundingClientRect();
      return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest('button') === el;
    }), 'Footer action receives real native pointer input').toBe(true);
    actions.push(bounds);
  }
  return { widths, preview, panels, actions };
}

test('skirmish setup: responsive layout, native options, start swapping and real game start', async ({ page }, info) => {
  test.setTimeout(120_000);
  const errors = captureErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${COI_URL}?menu=1&map=setons&seed=177`, { waitUntil: 'commit' });
  await page.waitForFunction(() => document.documentElement.dataset['loadingProgress'] === '100', null, { timeout: 60_000 });
  await setFrontendLocale(page, 'de');
  await page.getByTestId('MainMenu').getByRole('button', { name: /Gefecht/ }).click();
  const setup = page.getByTestId('SkirmishSetup');
  await expect(setup).toBeVisible();
  const backdrop = page.getByTestId('menu-backdrop');
  await expect(page.getByTestId('live-hud')).toHaveAttribute('data-menu-scene', 'true');
  await expect(backdrop).toHaveAttribute('data-motion', 'active');
  await expect(setup.getByTestId('game-brand-logo')).toBeVisible();
  await expect(setup).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(page.getByTestId('menu-camera-orbit')).toHaveCSS('animation-name', 'ff-menu-camera-orbit');
  await expect.poll(() => page.getByTestId('menu-background-image').evaluate(el => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0)).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(backdrop).toHaveAttribute('data-motion-reason', 'reduced');
  await expect(page.getByTestId('menu-camera-orbit')).toHaveCSS('animation-name', 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(backdrop).toHaveAttribute('data-motion', 'active');
  await expect(setup.getByRole('combobox', { name: 'Sprache', exact: true })).toHaveCount(0);
  await expect(setup.getByTestId('skirmish-map-setons')).toHaveAttribute('aria-pressed', 'true');
  await expect(setup.getByRole('combobox', { name: 'KI-Stufe', exact: true })).toBeVisible();
  const advanced = setup.getByTestId('skirmish-advanced-options');
  const ai = setup.getByTestId('skirmish-ai-options-1');
  await expect(advanced).not.toHaveAttribute('open', '');
  await expect(ai).not.toHaveAttribute('open', '');
  await expect(setup.getByRole('slider', { name: 'Anfangstempo', exact: true })).toBeHidden();
  const layouts = [];
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 1024, height: 600 }]) {
    await page.setViewportSize(viewport);
    layouts.push({ viewport, ...await layout(page, setup) });
    await page.screenshot({ path: info.outputPath(`skirmish-${viewport.width}x${viewport.height}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const starts = setup.getByTestId('skirmish-map-preview').getByRole('button');
  await expect(starts).toHaveCount(8);
  for (const start of await starts.all()) {
    const bounds = await start.boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(24);
    expect(bounds!.height).toBeGreaterThanOrEqual(24);
    expect(await start.evaluate(el => {
      const rect = el.getBoundingClientRect();
      return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest('button') === el;
    }), 'Map start receives native pointer input').toBe(true);
  }
  await setup.getByRole('button', { name: 'Startposition 2', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(setup.getByTestId('skirmish-start-1')).toHaveAttribute('aria-pressed', 'true');
  await expect(setup.getByTestId('skirmish-start-0')).toHaveAttribute('aria-pressed', 'false');
  const occupied = await starts.evaluateAll(elements => elements.map(el => ({ text: el.textContent, color: getComputedStyle(el).backgroundColor })));
  expect(occupied[0]!.color).toBe('rgb(200, 55, 45)');
  expect(occupied[1]!.color).toBe('rgb(47, 111, 208)');
  expect(new Set(occupied.slice(2).map(start => start.color)).size, 'Unused starts share a neutral color').toBe(1);
  expect(occupied[2]!.color).not.toBe(occupied[0]!.color);
  expect(occupied[2]!.color).not.toBe(occupied[1]!.color);
  const colors = setup.getByRole('combobox', { name: 'Farbe', exact: true });
  await colors.nth(0).selectOption('red');
  await expect(setup.getByRole('button', { name: 'Gefecht starten', exact: true })).toBeDisabled();
  await expect(setup.getByTestId('skirmish-status')).toContainText('verschiedene Farben');
  await colors.nth(0).selectOption('green');
  await expect(setup.getByRole('button', { name: 'Gefecht starten', exact: true })).toBeEnabled();
  await expect(page.getByTestId('live-hud')).toHaveAttribute('data-menu-house-color', 'green');
  await expect(setup.getByTestId('skirmish-start-1')).toHaveCSS('background-color', 'rgb(62, 154, 74)');
  const startPaint = await setup.getByRole('button', { name: 'Gefecht starten', exact: true }).evaluate(el => getComputedStyle(el, '::before').backgroundImage);
  expect(startPaint, 'Primary action uses the house theme instead of the legacy orange fill').not.toContain('rgb(255, 154, 62)');

  await ai.locator('summary').focus();
  await page.keyboard.press('Enter');
  await setup.getByRole('switch', { name: 'Wirtschaftsbonus (AIx)', exact: true }).click();
  const bonus = setup.getByRole('slider', { name: 'Bonusfaktor', exact: true });
  await bonus.focus();
  await bonus.press('ArrowRight');
  await expect(bonus).toHaveValue('1.1');
  await advanced.locator('summary').click();
  await setup.getByRole('combobox', { name: 'Teamfarben', exact: true }).selectOption('relation');
  const cap = setup.getByRole('slider', { name: 'Einheitenlimit', exact: true });
  await cap.focus();
  await cap.press('ArrowRight');
  await expect(cap).toHaveValue('550');
  const speed = setup.getByRole('slider', { name: 'Anfangstempo', exact: true });
  await speed.focus();
  await speed.press('End');
  await expect(speed).toHaveValue('3');
  await advanced.locator('summary').click();
  await advanced.locator('summary').click();
  await expect(speed).toHaveValue('3');
  await expect(cap).toHaveValue('550');
  await ai.locator('summary').click();
  await ai.locator('summary').click();
  await expect(bonus).toHaveValue('1.1');
  await setup.getByTestId('skirmish-map-hollow-ridge').click();
  await expect(setup.getByTestId('skirmish-map-hollow-ridge')).toHaveAttribute('aria-pressed', 'true');
  await expect(starts).toHaveCount(2);
  await setup.getByRole('button', { name: 'Gefecht starten', exact: true }).click();
  await page.waitForFunction(() => window.__faf?.ready && window.__faf.tick >= 3, null, { timeout: 60_000 });
  await expect(page.getByTestId('live-hud')).toHaveAttribute('data-screen', 'game');
  await expect(backdrop).toHaveCount(0);
  await expect(page.getByTestId('hud')).toHaveAttribute('data-hud-color', 'green');
  await expect.poll(() => page.evaluate(() => (window.__faf!.hostStatus() as { speed: number } | null)?.speed)).toBe(3);
  expect(await findOwnUnit(page, 'core:cmd_commander')).not.toBeNull();
  const game = await page.evaluate(() => ({ map: window.__faf!.mapName, tick: window.__faf!.tick, own: window.__faf!.ownHandles().length, tainted: window.__faf!.tainted, errors: window.__faf!.hostErrors }));
  expect(game.tainted).toBe(false);
  expect(game.errors).toEqual([]);
  await assertSilentOutput(page);
  await attachJson(info, 'skirmish-cleanup-receipt', { browser: info.project.name, build: await page.evaluate(() => document.documentElement.dataset['build']), layouts, occupied, startPaint, game, audio: await page.evaluate(() => (window as unknown as { __fafSilentAudio: unknown }).__fafSilentAudio) });
  expectNoErrors(errors);
});
