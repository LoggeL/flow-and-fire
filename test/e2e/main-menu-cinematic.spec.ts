import { expect, test, type Locator, type Page, type TestInfo } from './support/silent-test.ts';
import { assertSilentOutput, installSilentOutput } from '../../apps/game/test/support/silent-output.ts';
import { attachJson, captureErrors, COI_URL, expectNoErrors } from './support/game.ts';
import { startHumanAiSkirmish } from './support/skirmish.ts';

interface SilentAudit {
  installed: boolean;
  contexts: number;
  speakerConnections: number;
  blockedConnections: number;
  streamDestinations: number;
}

async function audioAudit(page: Page): Promise<SilentAudit | null> {
  return page.evaluate(() => (window as unknown as { __fafSilentAudio?: SilentAudit }).__fafSilentAudio ?? null);
}

async function openMainMenu(page: Page): Promise<Locator> {
  await installSilentOutput(page);
  await page.goto(`${COI_URL}?menu=1&map=hollow-ridge&seed=177`, { waitUntil: 'commit' });
  await page.waitForURL(/\/b\/[^/]+\/(\?.*)?$/);
  await page.waitForFunction(() => document.documentElement.dataset['loadingProgress'] === '100', null, { timeout: 60_000 });
  await expect(page.getByTestId('loading-screen')).toHaveCount(0);
  const main = page.getByTestId('MainMenu');
  await expect(main).toBeVisible();
  await main.getByRole('combobox').selectOption('de');
  await expect(page.getByTestId('live-hud')).not.toHaveAttribute('data-screen', 'game');
  expect(await audioAudit(page)).toEqual({ installed: true, contexts: 0, speakerConnections: 0, blockedConnections: 0, streamDestinations: 0 });
  return main;
}

async function expectArtwork(page: Page) {
  const backdrop = page.getByTestId('menu-backdrop');
  const image = page.getByTestId('menu-background-image');
  await expect(backdrop).toBeVisible();
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(el => {
    const img = el as HTMLImageElement;
    return img.complete && img.naturalWidth > 1000 && img.naturalHeight > 500;
  }), { message: 'Generated artwork decoded as a real image' }).toBe(true);
  const artwork = await image.evaluate(el => {
    const img = el as HTMLImageElement;
    return { url: img.currentSrc, width: img.naturalWidth, height: img.naturalHeight, pointerEvents: getComputedStyle(img).pointerEvents };
  });
  expect(new URL(artwork.url).pathname).toMatch(/\/assets\/[^/]+-[\w-]{8,}\.(?:webp|png|jpe?g)$/);
  expect(artwork.pointerEvents).toBe('none');
  expect(await backdrop.evaluate(el => getComputedStyle(el).pointerEvents)).toBe('none');
  await expect(backdrop).toHaveAttribute('aria-hidden', 'true');
  return artwork;
}

async function expectReachableNavigation(page: Page, main: Locator) {
  const buttons = main.locator('.mainnav button:not(:disabled)');
  const viewport = page.viewportSize()!;
  const navigation = [];
  for (const button of await buttons.all()) {
    await expect(button).toBeVisible();
    const bounds = await button.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height + 1);
    const appearance = await button.evaluate(el => {
      const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
      return {
        routed: document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest('button') === el,
        fontSize: Number.parseFloat(style.fontSize),
        opacity: style.opacity,
        text: el.textContent?.trim(),
      };
    });
    expect(appearance.routed, `${appearance.text} receives native pointer input`).toBe(true);
    expect(appearance.fontSize).toBeGreaterThanOrEqual(14);
    expect(appearance.opacity).toBe('1');
    navigation.push({ ...appearance, bounds });
  }
  expect(navigation.length).toBeGreaterThanOrEqual(4);
  const widths = await page.evaluate(() => ({ html: document.documentElement.scrollWidth, body: document.body.scrollWidth, viewport: innerWidth }));
  expect(widths.html).toBeLessThanOrEqual(widths.viewport + 1);
  expect(widths.body).toBeLessThanOrEqual(widths.viewport + 1);
  return { viewport, navigation, widths };
}

async function screenshot(page: Page, info: TestInfo, name: string): Promise<void> {
  await info.attach(name, { body: await page.screenshot(), contentType: 'image/png' });
}

async function transformPair(image: Locator) {
  const before = await image.evaluate(el => getComputedStyle(el).transform);
  // Observe the rendered CSS animation at two real moments without advancing its clock.
  await image.page().waitForTimeout(120);
  const after = await image.evaluate(el => getComputedStyle(el).transform);
  return { before, after };
}

test('cinematic main menu: built artwork and native keyboard navigation', async ({ page }, info) => {
  const errors = captureErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const main = await openMainMenu(page);
  const artwork = await expectArtwork(page);
  const layout = await expectReachableNavigation(page, main);
  await expect(page.getByTestId('menu-backdrop')).toHaveAttribute('data-motion', 'active');
  await screenshot(page, info, 'main-menu-1440x900');

  const enabled = main.locator('.mainnav button:not(:disabled)');
  await enabled.first().focus();
  await page.keyboard.press('ArrowUp');
  await expect(enabled.last()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(enabled.first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(enabled.nth(1)).toBeFocused();
  await main.getByRole('button', { name: /Einstellungen/ }).focus();
  await page.keyboard.press('Enter');
  const settings = page.getByTestId('Settings');
  await expect(settings).toBeVisible();
  await settings.getByRole('button', { name: 'Zurück', exact: true }).press('Enter');
  await expect(main).toBeVisible();
  await expect(main.getByRole('button', { name: /Gefecht/ })).toBeFocused();
  await page.keyboard.press('Enter');
  const setup = page.getByTestId('SkirmishSetup');
  await expect(setup).toBeVisible();
  await setup.getByRole('button', { name: 'Zurück', exact: true }).press('Enter');
  await expect(main).toBeVisible();
  expect((await audioAudit(page))?.contexts).toBe(0);
  await attachJson(info, 'menu-desktop-receipt', { browser: info.project.name, build: await page.evaluate(() => document.documentElement.dataset['build']), artwork, layout, audio: await audioAudit(page), keyboard: 'ArrowUp/ArrowDown wrap and next enabled item, Enter settings/back, Enter skirmish/back' });
  expectNoErrors(errors);
});

test('cinematic main menu: narrow and short viewports keep native controls reachable', async ({ page }, info) => {
  const errors = captureErrors(page);
  const layouts = [];
  await page.setViewportSize({ width: 390, height: 844 });
  const main = await openMainMenu(page);
  const artwork = await expectArtwork(page);
  for (const viewport of [{ width: 390, height: 844 }, { width: 1024, height: 600 }]) {
    await page.setViewportSize(viewport);
    layouts.push(await expectReachableNavigation(page, main));
    await screenshot(page, info, `main-menu-${viewport.width}x${viewport.height}`);
    await main.getByRole('button', { name: /Einstellungen/ }).click();
    await expect(page.getByTestId('Settings')).toBeVisible();
    await page.getByTestId('Settings').getByRole('button', { name: 'Zurück', exact: true }).click();
    await expect(main).toBeVisible();
    await main.getByRole('button', { name: /Gefecht/ }).click();
    await expect(page.getByTestId('SkirmishSetup')).toBeVisible();
    await page.getByTestId('SkirmishSetup').getByRole('button', { name: 'Zurück', exact: true }).click();
    await expect(main).toBeVisible();
  }
  expect((await audioAudit(page))?.contexts).toBe(0);
  await attachJson(info, 'menu-responsive-receipt', { browser: info.project.name, build: await page.evaluate(() => document.documentElement.dataset['build']), artwork, layouts, audio: await audioAudit(page) });
  expectNoErrors(errors);
});

test('cinematic main menu: reduced motion, manual pause and real skirmish transition', async ({ page }, info) => {
  test.setTimeout(120_000);
  const errors = captureErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMainMenu(page);
  await expectArtwork(page);
  const backdrop = page.getByTestId('menu-backdrop');
  const image = page.getByTestId('menu-background-image');
  const toggle = page.getByTestId('menu-motion-toggle');
  await expect(backdrop).toHaveAttribute('data-motion', 'paused');
  await expect(backdrop).toHaveAttribute('data-motion-reason', 'reduced');
  await expect(toggle).toBeDisabled();
  await expect(toggle).toHaveAccessibleName('Bewegung reduziert');
  const reducedAnimations = await backdrop.evaluate(el => [el, ...el.querySelectorAll('*')].map(layer => getComputedStyle(layer).animationName));
  expect(reducedAnimations.every(name => name === 'none')).toBe(true);
  const reduced = await transformPair(image);
  expect(reduced.after).toBe(reduced.before);
  await screenshot(page, info, 'main-menu-reduced-motion');

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(backdrop).toHaveAttribute('data-motion', 'active');
  await expect(toggle).toBeEnabled();
  await expect(toggle).toHaveAccessibleName('Hintergrundanimation pausieren');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const moving = await transformPair(image);
  expect(moving.before).not.toBe('none');
  expect(moving.after).not.toBe(moving.before);
  await toggle.click();
  await expect(backdrop).toHaveAttribute('data-motion', 'paused');
  await expect(backdrop).toHaveAttribute('data-motion-reason', 'user');
  await expect(toggle).toHaveAccessibleName('Hintergrundanimation abspielen');
  const paused = await transformPair(image);
  expect(paused.after).toBe(paused.before);
  await toggle.click();
  await expect(backdrop).toHaveAttribute('data-motion', 'active');
  const resumed = await transformPair(image);
  expect(resumed.after).not.toBe(resumed.before);

  const commander = await startHumanAiSkirmish(page);
  await expect(backdrop).toHaveCount(0);
  expect(await page.evaluate(() => window.__faf!.hostErrors)).toEqual([]);
  const game = await page.evaluate(() => ({ tick: window.__faf!.tick, units: window.__faf!.unitCount, own: window.__faf!.ownHandles().length, tainted: window.__faf!.tainted }));
  expect(game.tick).toBeGreaterThan(0);
  expect(game.own).toBeGreaterThan(0);
  expect(game.tainted).toBe(false);
  await expect.poll(async () => (await audioAudit(page))?.contexts ?? 0).toBeGreaterThan(0);
  await assertSilentOutput(page);
  const gameAudio = await audioAudit(page);
  await page.keyboard.press('Escape');
  await page.getByTestId('game-menu').getByRole('button', { name: 'Ins Hauptmenü', exact: true }).click();
  await expect(page.getByTestId('MainMenu')).toBeVisible();
  await expectArtwork(page);
  await expect(backdrop).toHaveAttribute('data-motion', 'active');
  await attachJson(info, 'menu-motion-skirmish-receipt', { browser: info.project.name, build: await page.evaluate(() => document.documentElement.dataset['build']), reducedAnimations, reduced, moving, paused, resumed, commander, game, audio: gameAudio });
  expectNoErrors(errors);
});
