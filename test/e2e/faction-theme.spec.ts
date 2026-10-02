import { assertSilentOutput } from '../../apps/game/test/support/silent-output.ts';
import { expect, test } from './support/silent-test.ts';
import { COI_URL, captureErrors, expectNoErrors } from './support/game.ts';
import { findOwnUnit, setFrontendLocale } from './support/skirmish.ts';

for (const { color, mode, hex, channel } of [
  { color: 'blue', mode: 'house', hex: '#2f6fd0', channel: 2 },
  { color: 'red', mode: 'house', hex: '#c8372d', channel: 0 },
  { color: 'green', mode: 'relation', hex: '#3e9a4a', channel: 1 },
  { color: 'orange', mode: 'cvd', hex: '#e07a1f', channel: 0 },
] as const) {
  test(`chosen ${color} house colors the live HUD in ${mode} display mode`, async ({ page }, info) => {
    test.setTimeout(120_000);
    const errors = captureErrors(page);
    await page.goto(`${COI_URL}?menu=1&map=hollow-ridge&seed=177`, { waitUntil: 'commit' });
    await page.waitForFunction(() => document.documentElement.dataset['loadingProgress'] === '100', null, { timeout: 60_000 });
    await expect(page.getByTestId('loading-screen')).toHaveCount(0, { timeout: 60_000 });
    const main = page.getByTestId('MainMenu');
    await expect(main).toBeVisible();
    await setFrontendLocale(page, 'de');
    await main.getByRole('button', { name: /Gefecht/ }).click();
    const setup = page.getByTestId('SkirmishSetup');
    await setup.locator('.mapitem').filter({ hasText: 'Hollow Ridge' }).click();
    const colors = setup.getByRole('combobox', { name: 'Farbe', exact: true });
    if (color === 'red') await colors.nth(1).selectOption('blue');
    await colors.nth(0).selectOption(color);
    await setup.getByRole('combobox', { name: 'Teamfarben', exact: true }).selectOption(mode);
    await setup.getByRole('button', { name: 'Gefecht starten', exact: true }).click();
    await page.waitForFunction(() => window.__faf?.ready && window.__faf.tick >= 3, null, { timeout: 60_000 });
    await expect(page.getByTestId('loading-screen')).toHaveCount(0, { timeout: 60_000 });
    await expect(page.getByTestId('live-hud')).toHaveAttribute('data-screen', 'game');
    const hud = page.getByTestId('hud');
    await expect(hud).toHaveAttribute('data-hud-color', color);
    await expect(hud).toHaveAttribute('data-hud-army', '0');
    const commander = await findOwnUnit(page, 'core:cmd_commander');
    expect(commander).not.toBeNull();
    if (!await page.evaluate(() => window.__faf!.paused)) await page.keyboard.press('KeyP');
    await expect.poll(() => page.evaluate(() => window.__faf!.paused)).toBe(true);
    // Keep the native pointer in the world area while positioning the camera.
    await page.mouse.move(640, 240);
    const position = await page.evaluate(handle => window.__faf!.unitPos(handle)!, commander!);
    await page.evaluate(at => window.__faf!.setCamera(at.x, at.z, 52), position);
    const nextFrame = await page.evaluate(() => window.__faf!.renderStats().frames + 3);
    await page.waitForFunction(frame => window.__faf!.renderStats().frames >= frame, nextFrame);
    const pixel = await page.evaluate(handle => window.__faf!.projectedUnits().find(unit => unit.handle === handle), commander!);
    expect(pixel).toBeDefined();
    expect(await page.evaluate(at => document.elementFromPoint(at.x, at.y)?.id, pixel!)).toBe('game-canvas');
    await page.mouse.click(pixel!.x, pixel!.y);
    await expect.poll(() => page.evaluate(() => window.__faf!.selected())).toEqual([commander!]);
    await expect(page.getByTestId('command-card')).toBeVisible();
    const colorsRead = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('[data-testid="hud"]')!;
      const rgba = (value: string): number[] => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
        const ctx = canvas.getContext('2d')!; ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1);
        return [...ctx.getImageData(0, 0, 1, 1).data];
      };
      const rgb = (selector: string) => rgba(getComputedStyle(root.querySelector(selector)!).color);
      const resolve = (selector: string, token: string) => {
        const element = root.querySelector(selector)!;
        const probe = document.createElement('span'); probe.style.color = `var(${token})`;
        element.append(probe); const color = getComputedStyle(probe).color; probe.remove();
        return { css: color, rgba: rgba(color) };
      };
      const rim = resolve('[data-testid="resource-bar"]', '--sc-ice');
      return { house: root.style.getPropertyValue('--hud-house-color'),
        head: rgb('.live-build-strip .ff-ph'), key: rgb('.card__grid .ff-cell__key'),
        rim: rim.rgba, frameShadow: getComputedStyle(root.querySelector('[data-testid="resource-bar"]')!, '::after').boxShadow,
        rimCss: rim.css, move: resolve('[data-order="move"]', '--tone').rgba,
        attack: resolve('[data-order="attack"]', '--tone').rgba, stop: resolve('[data-order="stop"]', '--tone').rgba,
        mass: rgb('.res--mass .res__glyph'), energy: rgb('.res--energy .res__glyph') };
    });
    expect(colorsRead.house).toBe(hex);
    // Actual rendered headers, keys, move sockets and inner rims all retain the chosen house hue.
    for (const rgb of [colorsRead.head, colorsRead.key, colorsRead.move, colorsRead.rim]) {
      for (let index = 0; index < 3; index++) if (index !== channel) expect(rgb[channel]!).toBeGreaterThan(rgb[index]!);
    }
    expect(colorsRead.frameShadow).toContain(colorsRead.rimCss);
    expect(colorsRead.mass[1]).toBeGreaterThan(colorsRead.mass[0]!);
    expect(colorsRead.energy[0]).toBeGreaterThan(colorsRead.energy[2]!);
    expect(colorsRead.energy[1]).toBeGreaterThan(colorsRead.energy[2]!);
    for (const rgb of [colorsRead.attack, colorsRead.stop]) expect(rgb[0]).toBeGreaterThan(rgb[1]! * 2);
    for (const width of [1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const dock = await page.locator('.live-bottom-context').boundingBox();
      expect(dock).not.toBeNull(); expect(dock!.height).toBeLessThanOrEqual(220);
    }
    await expect(page.locator('[data-testid="minimap"], [data-component="Minimap"]')).toHaveCount(0);
    await expect(page.getByTestId('selection-panel').locator('img, canvas, .portrait')).toHaveCount(0);
    const images = page.getByTestId('hud').locator('img');
    await expect.poll(() => images.evaluateAll(items => items.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: info.outputPath(`faction-${color}.png`) });
    await assertSilentOutput(page);
    expectNoErrors(errors);
  });
}
