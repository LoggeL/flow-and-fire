/**
 * Self-test of the layout check in a real browser: injects known defects into a rendered story and
 * expects each check (a)–(d) to report them. Runs in chromium (where the layout check runs).
 */
import { expect, test } from '@playwright/test';
import type { HudGalleryGlobal } from '../src/app/global.ts';
import { loadManifest } from './support/env.ts';
import { runLayoutCheck } from './support/layout-check.ts';

const stories = loadManifest().stories;
// A simple data story (hud-p1) as host page; any story works as long as it is clean itself.
const target = stories.find((s) => s.id === 'strategic-icon--teams-house') ?? stories[0];

test('grp=harness layout check detects overlap, overflow, clipping, small text and node budget', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'layout check runs in chromium only');
  test.skip(target === undefined, 'no stories');
  const s = target!;
  await page.setViewportSize({ width: s.viewport.width, height: s.viewport.height });
  await page.goto(`/#/story/${encodeURIComponent(s.id)}?shot=1`);
  await page.waitForFunction(() => {
    const g: HudGalleryGlobal | undefined = window.__HUD_GALLERY__;
    return g?.ready === true;
  });

  const clean = await runLayoutCheck(page, { scale: 1, nodeBudget: 100_000 });
  expect(clean.issues).toEqual([]);

  await page.evaluate(() => {
    const root = document.querySelector('[data-story-root]')!;
    const fx = document.createElement('div');
    fx.innerHTML =
      '<div data-panel="left" style="position:absolute;left:10px;top:10px;width:200px;height:100px"></div>' +
      '<div data-panel="right" style="position:absolute;left:150px;top:50px;width:200px;height:100px"></div>' +
      '<div data-panel="outside" style="position:absolute;left:-40px;top:300px;width:100px;height:40px"></div>' +
      '<span data-fit style="display:block;width:40px;overflow:hidden;white-space:nowrap;font-size:14px">Glutkessel Glutkessel</span>' +
      // Unmarked truncation: own ellipsis, text past a clipping parent, and an allowed ellipsis (not reported).
      '<span style="display:block;width:40px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px">Zapfstelle Zapfstelle</span>' +
      '<div style="width:40px;overflow:hidden;font-size:14px"><b style="white-space:nowrap">Horcher Horcher</b></div>' +
      '<span data-fit-allow-ellipsis style="display:block;width:40px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px">Erlaubt Erlaubt</span>' +
      '<span data-fit data-fit-allow-ellipsis="pseudo" style="display:block;width:40px;overflow:hidden;white-space:nowrap;font-size:14px">NurPseudo NurPseudo</span>' +
      '<span style="font-size:8px">winzig</span>';
    root.appendChild(fx);
  });
  const r = await runLayoutCheck(page, { scale: 1, nodeBudget: 5 });
  const text = r.issues.join('\n');
  expect(text).toContain('panels overlap: left / right');
  expect(text).toContain('panel outside viewport: outside');
  expect(text).toMatch(/clipped labels: .*„Glutkessel Glutkessel“/);
  expect(text).toMatch(/„span Zapfstelle Zapfstelle“/);
  expect(text).toMatch(/„b Horcher Horcher \(in div\)“/);
  expect(text).not.toContain('Erlaubt');
  // "pseudo" allows the cut only in the pseudo pass.
  expect(text).toContain('NurPseudo');
  const pseudoPass = await runLayoutCheck(page, { scale: 1, nodeBudget: 5, checks: ['fit'], pseudo: true });
  expect(pseudoPass.issues.join('\n')).not.toContain('NurPseudo');
  expect(text).toMatch(/text < 11\.00 px \(scale 1\): 1 \(„winzig“ 8px\)/);
  expect(text).toMatch(/DOM nodes under \[data-story-root\]: \d+ > budget 5/);
  // Pseudo pass: only (b).
  const fitOnly = await runLayoutCheck(page, { scale: 1, nodeBudget: 5, checks: ['fit'] });
  expect(fitOnly.issues).toHaveLength(1);
});
