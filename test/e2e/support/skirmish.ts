import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeSimBin } from '../../../packages/blueprints/src/simbin.ts';
import { expect, type Page } from '@playwright/test';
import { installSilentOutput } from '../../../apps/game/test/support/silent-output.ts';
import { COI_URL } from './game.ts';

/** IDs come from the same generated content as the production asset pipeline. */
export const SKIRMISH_BLUEPRINTS = decodeSimBin(new Uint8Array(readFileSync(resolve(import.meta.dirname, '../../../content/generated/sim.bin'))));

/** Language now lives in Settings, reached through the actual frontend controls. */
export async function setFrontendLocale(page: Page, locale: 'de' | 'en'): Promise<void> {
  const main = page.getByTestId('MainMenu');
  await main.getByRole('button', { name: /Einstellungen|Settings/ }).click();
  const settings = page.getByTestId('Settings');
  await expect(settings).toBeVisible();
  await settings.getByRole('tab', { name: /Spiel & Sprache|Game & language/ }).click();
  await settings.getByRole('combobox', { name: /^(Sprache|Language)$/ }).selectOption(locale);
  await settings.getByRole('button', { name: /^(Zurück|Back)$/ }).click();
  await expect(main).toBeVisible();
}

/** Uses the actual menu; openGame deliberately starts the legacy cube sandbox. */
export async function startHumanAiSkirmish(page: Page): Promise<number> {
  await installSilentOutput(page);
  await page.goto(`${COI_URL}?menu=1&map=hollow-ridge&seed=177`, { waitUntil: 'commit' });
  await page.waitForURL(/\/b\/[^/]+\/(\?.*)?$/);
  // Boot populates maps/config and replaces the frontend controller before ready.
  // Navigating the first visible menu during that phase can be reset back to MainMenu.
  await page.waitForFunction(() => document.documentElement.dataset['loadingProgress'] === '100', null, { timeout: 60_000 });
  await expect(page.getByTestId('loading-screen')).toHaveCount(0, { timeout: 60_000 });
  const main = page.getByTestId('MainMenu');
  await expect(main).toBeVisible({ timeout: 60_000 });
  await setFrontendLocale(page, 'de');
  await main.getByRole('button', { name: /Gefecht/ }).click();
  const setup = page.getByTestId('SkirmishSetup');
  await expect(setup).toBeVisible();
  await setup.locator('.mapitem').filter({ hasText: 'Hollow Ridge' }).click();
  await setup.getByRole('combobox', { name: 'KI-Stufe', exact: true }).selectOption('normal');
  // Keyboard interaction uses the real native range control and its onInput handler.
  const speed = setup.getByRole('slider', { name: 'Anfangstempo', exact: true });
  await speed.focus();
  await speed.press('End');
  await expect(speed).toHaveValue('3');
  await setup.getByRole('button', { name: 'Gefecht starten', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset['ready'] === '1' && window.__faf?.ready && window.__faf.tick >= 1, null, { timeout: 60_000 });
  await expect(page.getByTestId('loading-screen')).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByTestId('live-hud')).toHaveAttribute('data-screen', 'game');
  await expect.poll(() => page.evaluate(() => (window.__faf!.hostStatus() as { speed: number } | null)?.speed)).toBe(3);
  const state = await page.evaluate(() => ({ own: window.__faf!.ownHandles(), tainted: window.__faf!.tainted, simHash: window.__faf!.simHash }));
  expect(state.tainted).toBe(false);
  expect(state.simHash).toBe(SKIRMISH_BLUEPRINTS.simHash);
  const commander = await findOwnUnit(page, 'core:cmd_commander');
  expect(commander).not.toBeNull();
  return commander!;
}

export async function findOwnUnit(page: Page, id: string): Promise<number | null> {
  const visual = SKIRMISH_BLUEPRINTS.indexOf(id);
  expect(visual, `compiled blueprint ${id}`).toBeGreaterThanOrEqual(0);
  return page.evaluate((bp) => {
    const h = window.__faf!;
    return h.ownHandles().find(handle => h.unitInfo(handle)?.visual === bp) ?? null;
  }, visual);
}

export async function clickUnit(page: Page, handle: number): Promise<void> {
  const pixel = await page.evaluate(id => window.__faf!.unitScreenPos(id), handle);
  expect(pixel, `unit ${handle} is projected into the current camera`).not.toBeNull();
  await page.mouse.click(pixel!.x, pixel!.y);
  await expect.poll(() => page.evaluate(() => window.__faf!.selected())).toEqual([handle]);
}

export async function groundPixel(page: Page, x: number, z: number): Promise<{ x: number; y: number }> {
  const pixel = await page.evaluate(({ x, z }) => {
    const h = window.__faf!;
    return h.project(x, h.heightAt(x, z), z);
  }, { x, z });
  expect(pixel, `ground ${x}, ${z} is projected`).not.toBeNull();
  expect(await page.evaluate(p => document.elementFromPoint(p.x, p.y)?.id, pixel!),
    `ground ${x}, ${z} receives native canvas input`).toBe('game-canvas');
  return pixel!;
}
