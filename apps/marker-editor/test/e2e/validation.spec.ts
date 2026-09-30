/**
 * Validation through the real UI (TRACK-EDITOR P7): mass spots placed in the lake, on a slope and
 * at the map edge of hollow-ridge produce issue rows with the codes spot-in-water / spot-not-flat /
 * spot-edge; clicking a row selects the marker; undo removes the errors again. The checked-in maps
 * show 0 errors in the validation panel.
 */
import { expect, test, type Page } from '@playwright/test';
import { clickWorld, focusCanvas, frame, selectTool, undoDepth, waitForMap, WU } from './support/actions.ts';
import { captureErrors, expectNoErrors, MAP_NAMES, openEditor, screenshot } from './support/editor.ts';

/** hollow-ridge terrain points (WU): centre of the lake, a steep slope, next to the west edge. */
const CASES = [
  { code: 'spot-in-water', at: [256, 256] },
  { code: 'spot-not-flat', at: [254, 206] },
  { code: 'spot-edge', at: [6, 200] },
] as const;

interface IssueView {
  severity: string;
  code: string;
  refs: { type: string; index: number }[];
}

async function issuesOf(page: Page, spotIndex: number): Promise<IssueView[]> {
  return page.evaluate(
    (i) =>
      window
        .__editor!.issues()
        .map((x) => x as unknown as IssueView)
        .filter((x) => x.refs.some((r) => r.type === 'spot' && r.index === i))
        .map((x) => ({ severity: x.severity, code: x.code, refs: x.refs.map((r) => ({ type: r.type, index: r.index })) })),
    spotIndex,
  );
}

test.describe('marker editor validation', () => {
  test('bad spots show issue rows; a row selects its marker; undo clears the errors', async ({ page, browserName }) => {
    const errors = captureErrors(page);
    await openEditor(page, 'hollow-ridge');
    await expect(page.getByTestId('issue-count-error')).toHaveAttribute('data-count', '0');
    const spotsBefore = await page.evaluate(() => window.__editor!.store.doc.peek()!.spots.length);

    await selectTool(page, 'mass');
    for (const [i, c] of CASES.entries()) {
      await clickWorld(page, c.at[0], c.at[1]);
      const spotIndex = spotsBefore + i;
      const spot = await page.evaluate((k) => window.__editor!.store.doc.peek()!.spots[k] ?? null, spotIndex);
      expect(spot, `${c.code}: spot placed`).not.toBeNull();
      expect(Math.abs(spot!.x / WU - c.at[0])).toBeLessThanOrEqual(1.5);
      expect(Math.abs(spot!.z / WU - c.at[1])).toBeLessThanOrEqual(1.5);
      const own = await issuesOf(page, spotIndex);
      expect(
        own.some((x) => x.code === c.code && x.severity === 'error'),
        `${c.code}: got ${own.map((x) => `${x.severity}:${x.code}`).join(', ')}`,
      ).toBe(true);
      await expect(page.locator(`[data-testid="issue-row"][data-code="${c.code}"][data-severity="error"]`).first()).toBeVisible();
    }
    const errorCount = await page.evaluate(() => window.__editor!.issues().filter((i) => i.severity === 'error').length);
    expect(errorCount).toBeGreaterThanOrEqual(CASES.length);
    await expect(page.getByTestId('issue-count-error')).toHaveAttribute('data-count', String(errorCount));
    await frame(page);
    await screenshot(page, `validation-${browserName}`);

    // A click on a row selects the referenced marker(s) (and focuses the camera on it).
    for (const [i, c] of CASES.entries()) {
      await selectTool(page, 'select');
      await page.evaluate(() => window.__editor!.store.select([]));
      const row = page.locator(`[data-testid="issue-row"][data-code="${c.code}"][data-severity="error"]`).first();
      await row.click();
      const sel = await page.evaluate(() => window.__editor!.store.selection.peek().map((r) => ({ type: r.type, index: r.index })));
      expect(sel, `${c.code}: selection after the row click`).toContainEqual({ type: 'spot', index: spotsBefore + i });
      await expect(row).toHaveClass(/selected|active/);
    }
    await frame(page);
    await screenshot(page, `validation-focus-${browserName}`);

    // Undo (keyboard) removes the three spots and their errors.
    await focusCanvas(page);
    for (let k = CASES.length; k > 0; k--) {
      const d0 = await undoDepth(page);
      await page.keyboard.press('Control+z');
      await expect.poll(() => undoDepth(page)).toBe(d0 - 1);
    }
    expect(await undoDepth(page)).toBe(0);
    await expect(page.getByTestId('issue-count-error')).toHaveAttribute('data-count', '0');
    for (const c of CASES) await expect(page.locator(`[data-testid="issue-row"][data-code="${c.code}"][data-severity="error"]`)).toHaveCount(0);
    expectNoErrors(errors);
  });

  test('the checked-in maps show 0 errors', async ({ page }) => {
    const errors = captureErrors(page);
    await openEditor(page, 'hollow-ridge');
    for (const name of MAP_NAMES) {
      await page.evaluate((n) => window.__editor!.load(n), name);
      await waitForMap(page, name);
      await expect(page.getByTestId('issue-count-error')).toHaveAttribute('data-count', '0');
      const codes = await page.evaluate(() => window.__editor!.issues().map((i) => `${i.severity}:${i.code}`));
      expect(codes.filter((c) => c.startsWith('error:'))).toEqual([]);
      await expect(page.locator('[data-testid="issue-row"][data-severity="error"]')).toHaveCount(0);
    }
    expectNoErrors(errors);
  });
});
