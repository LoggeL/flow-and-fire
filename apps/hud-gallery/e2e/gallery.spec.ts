/**
 * Renders every story of the gallery (list from <outDir>/stories.json, written by the vite build):
 *   chromium – screenshot to <shotDir>/chromium/<id>.png and the full layout check (a)–(e);
 *              plus a locale=pseudo pass (clipping check (b) only) for full-screen stories and every
 *              story without the tag no-pseudo;
 *   firefox/webkit – every story renders without errors; screenshots only for the tag xbrowser.
 * Titles are `grp=<stories file stem> <id>` so `-g 'grp=top '` selects one stories file. The spec needs no
 * change when stories are added.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { HudGalleryGlobal } from '../src/app/global.ts';
import { SHOT_DIR, loadManifest, storyTitle, wantsPseudo } from './support/env.ts';
import type { ManifestStory } from './support/env.ts';
import { attachErrorCollector, runLayoutCheck } from './support/layout-check.ts';

const manifest = loadManifest();

async function openStory(page: Page, s: ManifestStory, locale: 'de' | 'pseudo'): Promise<string[]> {
  await page.setViewportSize({ width: s.viewport.width, height: s.viewport.height });
  await page.goto(`/#/story/${encodeURIComponent(s.id)}?shot=1&locale=${locale}`);
  await page.waitForFunction(
    (id) => {
      const g: HudGalleryGlobal | undefined = window.__HUD_GALLERY__;
      return g !== undefined && g.ready && document.querySelector(`[data-story-id="${id}"]`) !== null;
    },
    s.id,
    { timeout: 20_000 },
  );
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  return page.evaluate(() => [...(window.__HUD_GALLERY__?.errors ?? [])]);
}

test('grp=registry stories.json is valid', () => {
  expect(manifest.errors).toEqual([]);
  expect(manifest.stories.length).toBeGreaterThan(0);
  const ids = manifest.stories.map((s) => s.id);
  expect(new Set(ids).size).toBe(ids.length);
});

for (const s of manifest.stories) {
  test(storyTitle(s), async ({ page, browserName }) => {
    const pageErrors = attachErrorCollector(page);
    const galleryErrors = await openStory(page, s, 'de');
    if (browserName === 'chromium' || s.tags.includes('xbrowser')) {
      const dir = join(SHOT_DIR, browserName);
      mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: join(dir, `${s.id}.png`) });
    }
    const issues: string[] = [];
    if (browserName === 'chromium') {
      const report = await runLayoutCheck(page, { scale: s.scale, nodeBudget: s.nodeBudget });
      issues.push(...report.issues);
      test.info().annotations.push({ type: 'nodes', description: `${report.measures.nodes} (${report.measures.nodeScope})` });
    }
    expect([...pageErrors, ...galleryErrors, ...issues], `${s.id} (${browserName})`).toEqual([]);
  });

  if (wantsPseudo(s)) {
    test(storyTitle(s, 'pseudo'), async ({ page, browserName }) => {
      test.skip(browserName !== 'chromium', 'pseudo-locale layout pass runs in chromium only');
      const pageErrors = attachErrorCollector(page);
      const galleryErrors = await openStory(page, s, 'pseudo');
      const report = await runLayoutCheck(page, { scale: s.scale, nodeBudget: s.nodeBudget, checks: ['fit'] });
      expect([...pageErrors, ...galleryErrors, ...report.issues], `${s.id} pseudo`).toEqual([]);
    });
  }
}
