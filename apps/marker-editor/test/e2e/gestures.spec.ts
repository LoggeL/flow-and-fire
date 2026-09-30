/**
 * Every editing gesture of the select tool with real mouse input (review TRACK-EDITOR, acceptance
 * row 6), on hollow-ridge: double click on a polygon edge inserts a vertex, Delete removes the
 * selected vertex, vertex and radius handles are dragged, a whole field and a start position are
 * dragged, a field and a start are deleted. Each gesture must be exactly one undo step. Then the
 * keyboard: Cmd/Ctrl+Z with the real keyboard, and the German QWERTZ layout (the key labelled Z
 * reports code 'KeyY') must undo, not redo.
 */
import { expect, test, type Page } from '@playwright/test';
import type { PropFieldShape } from '@faf/formats';
import { centerOn, clickWorld, clientOf, counts, dragWorld, focusCanvas, frame, selectTool, undoDepth, WU, zoomAt } from './support/actions.ts';
import { captureErrors, expectNoErrors, openEditor, screenshot } from './support/editor.ts';

const MAP = 'hollow-ridge';
/** Rectangle polygon field (WU) in open land west of the NW mesa. */
const POLY = [
  [40, 292],
  [96, 292],
  [96, 336],
  [40, 336],
] as const;
const POLY_CENTRE = [68, 314] as const;
const CIRCLE_CENTRE = [220, 420] as const;
const CIRCLE_R = 16;

async function shapeOf(page: Page, index: number): Promise<PropFieldShape> {
  return page.evaluate((i) => window.__editor!.store.doc.peek()!.fields[i]!.shape, index);
}

async function startsOf(page: Page): Promise<{ army: number; x: number; z: number }[]> {
  return page.evaluate(() => window.__editor!.store.doc.peek()!.starts.map((s) => ({ army: s.army, x: s.x, z: s.z })));
}

function near(raw: number, wu: number, tolWu = 1): boolean {
  return Math.abs(raw / WU - wu) <= tolWu;
}

/** Fits the whole map, pans to (x, z) and zooms in with the wheel until 1 WU covers at least `minPx` CSS pixels. */
async function zoomTo(page: Page, x: number, z: number, minPx: number): Promise<number> {
  await page.getByTestId('btn-fit').click();
  await frame(page);
  for (let i = 0; i < 16; i++) {
    await centerOn(page, x, z);
    const a = await clientOf(page, x, z);
    const b = await clientOf(page, x + 10, z);
    const pxPerWu = Math.hypot(b.x - a.x, b.y - a.y) / 10;
    if (pxPerWu >= minPx) return pxPerWu;
    await zoomAt(page, x, z, -240);
  }
  throw new Error(`could not zoom to ${minPx} px/WU at (${x}, ${z})`);
}

/** Runs `action` and expects exactly one new undo step. */
async function oneStep(page: Page, what: string, action: () => Promise<void>): Promise<void> {
  const before = await undoDepth(page);
  await action();
  await frame(page);
  expect(await undoDepth(page), `${what}: exactly one undo step`).toBe(before + 1);
}

/** Key event fields a physical layout decides (key = printed character, code = key position). */
interface KeyInit {
  readonly key: string;
  readonly code: string;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
}

async function dispatchKey(page: Page, init: KeyInit): Promise<void> {
  await page.evaluate((i: KeyInit) => {
    const e = new KeyboardEvent('keydown', {
      key: i.key,
      code: i.code,
      ctrlKey: i.ctrlKey === true,
      metaKey: i.metaKey === true,
      shiftKey: i.shiftKey === true,
      bubbles: true,
      cancelable: true,
    });
    document.getElementById('terrain')!.dispatchEvent(e);
  }, init);
  await frame(page);
}

test.describe('marker editor gestures (real mouse)', () => {
  test('vertex insert/delete/drag, radius drag, field and start move/delete; keyboard undo on QWERTZ', async ({ page, browserName }) => {
    const errors = captureErrors(page);
    await openEditor(page, MAP);
    const before = await counts(page);

    // --- polygon field -------------------------------------------------------------------------
    await zoomTo(page, ...POLY_CENTRE, 5);
    await selectTool(page, 'field-polygon');
    for (const [x, z] of POLY) await clickWorld(page, x, z);
    await page.keyboard.press('Enter');
    await frame(page);
    expect((await counts(page)).fields).toBe(before.fields + 1);
    const poly = before.fields;
    await selectTool(page, 'select');

    // Double click on the middle of the north edge: +1 vertex (index 1), one undo step.
    await oneStep(page, 'insert vertex', async () => {
      const p = await clientOf(page, 68, 292);
      await page.mouse.dblclick(p.x, p.y);
    });
    let sh = await shapeOf(page, poly);
    expect(sh.kind === 'polygon' && sh.points.length).toBe(5);
    if (sh.kind === 'polygon') expect(near(sh.points[1]!.x, 68) && near(sh.points[1]!.z, 292)).toBe(true);
    // The new vertex is selected: Delete removes it again.
    await expect(page.getByTestId('status-selection')).toBeVisible();
    await focusCanvas(page);
    await oneStep(page, 'delete vertex', () => page.keyboard.press('Delete'));
    sh = await shapeOf(page, poly);
    expect(sh.kind === 'polygon' && sh.points.length).toBe(4);

    // Select the field (click inside), then drag vertex 2 (96, 336) to (104, 344).
    await clickWorld(page, ...POLY_CENTRE);
    await oneStep(page, 'drag vertex', () => dragWorld(page, [96, 336], [104, 344]));
    sh = await shapeOf(page, poly);
    if (sh.kind !== 'polygon') throw new Error('polygon expected');
    expect(near(sh.points[2]!.x, 104) && near(sh.points[2]!.z, 344), `vertex 2 at ${sh.points[2]!.x / WU}, ${sh.points[2]!.z / WU}`).toBe(true);
    expect(near(sh.points[0]!.x, 40) && near(sh.points[0]!.z, 292)).toBe(true);

    // Drag the whole field by (+8, −6) WU from its interior.
    const pts0 = sh.points;
    await oneStep(page, 'move field', () => dragWorld(page, POLY_CENTRE, [POLY_CENTRE[0] + 8, POLY_CENTRE[1] - 6]));
    sh = await shapeOf(page, poly);
    if (sh.kind !== 'polygon') throw new Error('polygon expected');
    const dx = sh.points[0]!.x - pts0[0]!.x;
    const dz = sh.points[0]!.z - pts0[0]!.z;
    expect(Math.abs(dx / WU - 8) <= 1 && Math.abs(dz / WU + 6) <= 1, `field moved by ${dx / WU}, ${dz / WU}`).toBe(true);
    // Rigid move: every vertex by the same delta.
    sh.points.forEach((p, i) => expect([p.x - pts0[i]!.x, p.z - pts0[i]!.z]).toEqual([dx, dz]));
    await screenshot(page, `gestures-polygon-${browserName}`);

    // --- circle field: radius handle ---------------------------------------------------------------
    await zoomTo(page, ...CIRCLE_CENTRE, 5);
    await selectTool(page, 'field-circle');
    await dragWorld(page, CIRCLE_CENTRE, [CIRCLE_CENTRE[0] + CIRCLE_R, CIRCLE_CENTRE[1]], 10);
    const circle = poly + 1;
    let c = await shapeOf(page, circle);
    expect(c.kind).toBe('circle');
    await selectTool(page, 'select');
    await clickWorld(page, ...CIRCLE_CENTRE);
    if (c.kind !== 'circle') throw new Error('circle expected');
    const r0 = c.r / WU;
    await oneStep(page, 'drag radius handle', () => dragWorld(page, [(c as { x: number }).x / WU + r0, CIRCLE_CENTRE[1]], [CIRCLE_CENTRE[0] + 28, CIRCLE_CENTRE[1]]));
    c = await shapeOf(page, circle);
    if (c.kind !== 'circle') throw new Error('circle expected');
    expect(Math.abs(c.r / WU - 28), `radius ${c.r / WU}`).toBeLessThanOrEqual(1);
    expect(near(c.x, CIRCLE_CENTRE[0]) && near(c.z, CIRCLE_CENTRE[1]), 'centre unchanged').toBe(true);
    await screenshot(page, `gestures-circle-${browserName}`);

    // Delete the selected circle field with the Delete key.
    await focusCanvas(page);
    await oneStep(page, 'delete field', () => page.keyboard.press('Delete'));
    expect((await counts(page)).fields).toBe(before.fields + 1);

    // --- start position: drag, then delete -----------------------------------------------------
    const s0 = (await startsOf(page))[0]!;
    const from = [s0.x / WU, s0.z / WU] as const;
    await zoomTo(page, ...from, 3);
    await oneStep(page, 'move start', () => dragWorld(page, from, [from[0] + 12, from[1] + 6]));
    let starts = await startsOf(page);
    expect(starts[0]!.army).toBe(s0.army);
    expect(near(starts[0]!.x, from[0] + 12) && near(starts[0]!.z, from[1] + 6), `start at ${starts[0]!.x / WU}, ${starts[0]!.z / WU}`).toBe(true);
    await clickWorld(page, from[0] + 12, from[1] + 6);
    await focusCanvas(page);
    await oneStep(page, 'delete start', () => page.keyboard.press('Delete'));
    starts = await startsOf(page);
    expect(starts.length).toBe(before.starts - 1);
    expect(starts.some((s) => s.army === s0.army)).toBe(false);

    // --- keyboard undo/redo: real Cmd/Ctrl+Z and the QWERTZ layout ------------------------------
    await focusCanvas(page);
    const depth = await undoDepth(page);
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => undoDepth(page)).toBe(depth - 1);
    expect((await startsOf(page)).length).toBe(before.starts);
    // QWERTZ: the key labelled Z sits at code 'KeyY' — Ctrl+Z (Cmd+Z on the Mac) must undo.
    await dispatchKey(page, { key: 'z', code: 'KeyY', ctrlKey: true });
    await expect.poll(() => undoDepth(page)).toBe(depth - 2);
    await dispatchKey(page, { key: 'z', code: 'KeyY', metaKey: true });
    await expect.poll(() => undoDepth(page)).toBe(depth - 3);
    // The key labelled Y (code 'KeyZ') redoes; Shift+Z (code 'KeyY') redoes as well.
    await dispatchKey(page, { key: 'y', code: 'KeyZ', ctrlKey: true });
    await expect.poll(() => undoDepth(page)).toBe(depth - 2);
    await dispatchKey(page, { key: 'Z', code: 'KeyY', metaKey: true, shiftKey: true });
    await expect.poll(() => undoDepth(page)).toBe(depth - 1);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect.poll(() => undoDepth(page)).toBe(depth);
    expect((await startsOf(page)).length).toBe(before.starts - 1);

    expectNoErrors(errors);
  });
});
