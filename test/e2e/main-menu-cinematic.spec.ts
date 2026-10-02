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

const MENU_IMAGE_LAYERS = [
  { name: 'background', testId: 'menu-background-image' },
  { name: 'commander', testId: 'menu-commander-image' },
  { name: 'foreground', testId: 'menu-foreground-image' },
] as const;

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
  await expect(main.getByRole('combobox')).toHaveCount(0);
  await expect(main.getByTestId('menu-motion-toggle')).toHaveCount(0);
  await expect(main.getByTestId('menu-animation-setting')).toHaveCount(0);
  await expect(main.getByRole('button', { name: /Gefecht/ })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Flow & Fire', exact: true })).toHaveCount(1);
  await expect(page.getByTestId('live-hud')).not.toHaveAttribute('data-screen', 'game');
  expect(await audioAudit(page)).toEqual({ installed: true, contexts: 0, speakerConnections: 0, blockedConnections: 0, streamDestinations: 0 });
  return main;
}

async function expectLogo(scope: Locator) {
  const logo = scope.getByTestId('game-brand-logo');
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAttribute('alt', 'Flow & Fire');
  await expect.poll(() => logo.evaluate(el => {
    const img = el as HTMLImageElement;
    return img.complete && img.naturalWidth > 0 && img.naturalHeight > 0;
  })).toBe(true);
  const asset = await logo.evaluate(el => {
    const img = el as HTMLImageElement;
    return { url: img.currentSrc, width: img.naturalWidth, height: img.naturalHeight };
  });
  expect(new URL(asset.url).pathname).toMatch(/\/assets\/[^/]+-[\w-]{8,}\.(?:webp|png|jpe?g)$/);
  return asset;
}

async function openPreferences(page: Page) {
  await page.getByTestId('MainMenu').getByRole('button', { name: /Einstellungen/ }).click();
  const settings = page.getByTestId('Settings');
  await expect(settings).toBeVisible();
  await settings.getByRole('tab', { name: /^(Spiel & Sprache|Game & language)$/ }).click();
  await expect(settings.getByRole('combobox', { name: /^(Sprache|Language)$/ })).toHaveValue('de');
  const preference = settings.getByTestId('menu-animation-setting');
  await expect(preference).toHaveAttribute('role', 'switch');
  await expect(preference).toHaveAccessibleName('Menühintergrund animieren');
  return { settings, preference };
}

async function expectArtwork(page: Page) {
  const backdrop = page.getByTestId('menu-backdrop');
  await expect(backdrop).toBeVisible();
  await expect(backdrop).toHaveAttribute('data-parallax', 'layered');
  await expect(backdrop.locator('img')).toHaveCount(3);
  const artwork = [];
  for (const layer of MENU_IMAGE_LAYERS) {
    const image = page.getByTestId(layer.testId);
    await expect(image).toBeVisible();
    await expect(image).toHaveAttribute('data-menu-layer', layer.name);
    await expect.poll(() => image.evaluate(el => {
      const img = el as HTMLImageElement;
      return img.complete && img.naturalWidth > 0 && img.naturalHeight > 0;
    }), { message: `${layer.name} artwork decoded as a real image` }).toBe(true);
    const asset = await image.evaluate(el => {
      const img = el as HTMLImageElement;
      return { layer: img.dataset['menuLayer'], url: img.currentSrc, width: img.naturalWidth, height: img.naturalHeight, pointerEvents: getComputedStyle(img).pointerEvents };
    });
    expect(new URL(asset.url).pathname).toMatch(/\/assets\/[^/]+-[\w-]{8,}\.(?:webp|png|jpe?g)$/);
    expect(asset.pointerEvents).toBe('none');
    if (layer.name === 'background') {
      expect(asset.width).toBeGreaterThan(1000);
      expect(asset.height).toBeGreaterThan(500);
    }
    artwork.push(asset);
  }
  expect(new Set(artwork.map(asset => asset.url)).size).toBe(3);
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

async function transformPair(layers: Locator) {
  const before = await layers.evaluateAll(elements => elements.map(el => ({ layer: el.getAttribute('data-menu-layer'), transform: getComputedStyle(el).transform })));
  // Observe the rendered CSS animation at two real moments without advancing its clock.
  await layers.page().waitForTimeout(120);
  const after = await layers.evaluateAll(elements => elements.map(el => ({ layer: el.getAttribute('data-menu-layer'), transform: getComputedStyle(el).transform })));
  return { before, after };
}

function expectIndependentMotion(pair: Awaited<ReturnType<typeof transformPair>>): void {
  expect(pair.before).toHaveLength(3);
  expect(pair.after).toHaveLength(3);
  expect(pair.after.map(layer => layer.layer)).toEqual(pair.before.map(layer => layer.layer));
  for (const first of pair.before) {
    expect(first.transform, `${first.layer} has a rendered transform`).not.toBe('none');
    expect(pair.after.find(next => next.layer === first.layer)?.transform, `${first.layer} changes with real elapsed time`).not.toBe(first.transform);
  }
  expect(new Set(pair.before.map(layer => layer.transform)).size, 'Layers have distinct parallax transforms').toBe(3);
  expect(new Set(pair.after.map(layer => layer.transform)).size, 'Layers retain distinct parallax transforms').toBe(3);
}

async function animationPlayStates(backdrop: Locator) {
  return backdrop.evaluate(el => [el, ...el.querySelectorAll('*')].flatMap(layer => {
    const style = getComputedStyle(layer);
    return style.animationName === 'none' ? [] : [{ layer: layer.getAttribute('class'), animation: style.animationName, duration: style.animationDuration, playState: style.animationPlayState }];
  }));
}

async function expectPausedLayers(backdrop: Locator, layers: Locator) {
  await expect(backdrop).toHaveAttribute('data-motion', 'paused');
  await expect(backdrop).toHaveAttribute('data-motion-reason', 'user');
  await expect.poll(async () => {
    const states = await animationPlayStates(backdrop);
    return states.length > 0 && states.every(state => state.playState.split(',').every(value => value.trim() === 'paused'));
  }, { message: 'Every animated backdrop layer and scene effect has consumed the pause style' }).toBe(true);
  const playStates = await animationPlayStates(backdrop);
  // Give the compositor two actual frames to apply the paused style before sampling its transform.
  await backdrop.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const transforms = await transformPair(layers);
  expect(transforms.before).toHaveLength(3);
  expect(transforms.after).toEqual(transforms.before);
  return { playStates, transforms };
}

test('cinematic main menu: built artwork and native keyboard navigation', async ({ page }, info) => {
  const errors = captureErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const main = await openMainMenu(page);
  const artwork = await expectArtwork(page);
  const logo = await expectLogo(main);
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
  await settings.getByRole('tab', { name: 'Spiel & Sprache', exact: true }).click();
  await expect(settings.getByRole('combobox', { name: 'Sprache', exact: true })).toHaveValue('de');
  await expect(settings.getByTestId('menu-animation-setting')).toHaveAccessibleName('Menühintergrund animieren');
  await expect(settings.getByTestId('menu-animation-setting')).toBeChecked();
  await settings.getByRole('button', { name: 'Zurück', exact: true }).press('Enter');
  await expect(main).toBeVisible();
  await expect(main.getByRole('button', { name: /Gefecht/ })).toBeFocused();
  await page.keyboard.press('Enter');
  const setup = page.getByTestId('SkirmishSetup');
  await expect(setup).toBeVisible();
  await setup.getByRole('button', { name: 'Zurück', exact: true }).press('Enter');
  await expect(main).toBeVisible();
  expect((await audioAudit(page))?.contexts).toBe(0);
  await attachJson(info, 'menu-desktop-receipt', { browser: info.project.name, build: await page.evaluate(() => document.documentElement.dataset['build']), artwork, logo, layout, audio: await audioAudit(page), keyboard: 'ArrowUp/ArrowDown wrap and next enabled item, Enter settings/back, Enter skirmish/back' });
  expectNoErrors(errors);
});

test('cinematic main menu: narrow and short viewports keep native controls reachable', async ({ page }, info) => {
  const errors = captureErrors(page);
  const layouts = [];
  await page.setViewportSize({ width: 390, height: 844 });
  const main = await openMainMenu(page);
  const artwork = await expectArtwork(page);
  const logo = await expectLogo(main);
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
  await attachJson(info, 'menu-responsive-receipt', { browser: info.project.name, build: await page.evaluate(() => document.documentElement.dataset['build']), artwork, logo, layouts, audio: await audioAudit(page) });
  expectNoErrors(errors);
});

test('cinematic main menu: reduced motion, manual pause and real skirmish transition', async ({ page }, info) => {
  test.setTimeout(120_000);
  const errors = captureErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const main = await openMainMenu(page);
  const artwork = await expectArtwork(page);
  const logo = await expectLogo(main);
  const backdrop = page.getByTestId('menu-backdrop');
  const layers = backdrop.locator('.menu-backdrop__layer');
  await expect(layers).toHaveCount(3);
  await expect(backdrop).toHaveAttribute('data-motion', 'paused');
  await expect(backdrop).toHaveAttribute('data-motion-reason', 'reduced');
  const reducedAnimations = await backdrop.evaluate(el => [el, ...el.querySelectorAll('*')].map(layer => getComputedStyle(layer).animationName));
  expect(reducedAnimations.every(name => name === 'none')).toBe(true);
  const reduced = await transformPair(layers);
  expect(reduced.after).toEqual(reduced.before);
  await screenshot(page, info, 'main-menu-reduced-motion');
  const { settings, preference } = await openPreferences(page);
  // The stored preference remains available while the OS suppresses actual motion.
  await expect(preference).toBeEnabled();
  await expect(preference).toBeChecked();
  await settings.getByRole('button', { name: 'Zurück', exact: true }).click();
  await expect(main).toBeVisible();
  await expect(backdrop).toHaveAttribute('data-motion-reason', 'reduced');

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(backdrop).toHaveAttribute('data-motion', 'active');
  const movingPlayStates = await animationPlayStates(backdrop);
  const moving = await transformPair(layers);
  expectIndependentMotion(moving);
  await openPreferences(page);
  await preference.click();
  await expect(preference).not.toBeChecked();
  await settings.getByRole('button', { name: 'Zurück', exact: true }).click();
  await expect(main).toBeVisible();
  const paused = await expectPausedLayers(backdrop, layers);

  await page.reload({ waitUntil: 'commit' });
  await page.waitForFunction(() => document.documentElement.dataset['loadingProgress'] === '100', null, { timeout: 60_000 });
  await expect(page.getByTestId('loading-screen')).toHaveCount(0);
  await expect(main).toBeVisible();
  const persistedPause = await expectPausedLayers(backdrop, layers);
  await openPreferences(page);
  await expect(preference).not.toBeChecked();
  await preference.click();
  await expect(preference).toBeChecked();
  await settings.getByRole('button', { name: 'Zurück', exact: true }).click();
  await expect(main).toBeVisible();
  await expect(backdrop).toHaveAttribute('data-motion', 'active');
  const resumedPlayStates = await animationPlayStates(backdrop);
  const resumed = await transformPair(layers);
  expectIndependentMotion(resumed);

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
  const gameLogo = await expectLogo(page.getByTestId('game-menu'));
  expect(gameLogo.url).toBe(logo.url);
  await page.getByTestId('game-menu').getByRole('button', { name: 'Ins Hauptmenü', exact: true }).click();
  await expect(page.getByTestId('MainMenu')).toBeVisible();
  await expectArtwork(page);
  await expect(backdrop).toHaveAttribute('data-motion', 'active');
  await attachJson(info, 'menu-motion-skirmish-receipt', { browser: info.project.name, build: await page.evaluate(() => document.documentElement.dataset['build']), artwork, logo, gameLogo, reducedAnimations, reduced, movingPlayStates, moving, paused, persistedPause, resumedPlayStates, resumed, commander, game, audio: gameAudio });
  expectNoErrors(errors);
});
