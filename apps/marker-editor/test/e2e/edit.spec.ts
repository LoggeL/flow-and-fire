/**
 * Editing through the real UI (TRACK-EDITOR P7) on hollow-ridge: place start/mass/hydro with the
 * tools (real mouse clicks at worldToClient points), drag a spot, delete one, draw a 5-point polygon
 * field and a circle field, edit every field property in the PropertiesPanel, point-symmetrize,
 * live symmetry about the X axis, undo with the keyboard down to depth 0 (original hash), redo
 * everything, save. In Node the download then runs through the game's loader chain
 * (readRtsMap / ClientMap.fromBytes / sim-host resolveMap → writeRtsMap byte-identical), the
 * mapSimHash of Node and the page agree, and the expanded props and field values match the input.
 */
import { expect, test, type Page } from '@playwright/test';
import { expandPropFields, mapSimHash, readRtsMap, writeRtsMap, type MapPropField } from '@faf/formats';
import { ClientMap } from '@faf/client';
import { resolveMap } from '@faf/sim-host';
import { EditorDocument } from '../../src/model/document.ts';
import { isSymmetric } from '../../src/model/symmetry.ts';
import {
  bytesEqual,
  centerOn,
  clickWorld,
  commitInput,
  counts,
  dragWorld,
  exportBytes,
  exportHash,
  focusCanvas,
  frame,
  mapFile,
  saveDownload,
  selectTool,
  hashOf,
  undoDepth,
  WU,
  zoomAt,
} from './support/actions.ts';
import { captureErrors, expectNoErrors, openEditor, screenshot } from './support/editor.ts';
import { decodePng, pixelStats } from './support/png.ts';

const MAP = 'hollow-ridge';
const SIZE_WU = 512;

/** Terrain points (WU) on dry, flat land of hollow-ridge, away from the existing markers. */
const START_AT = [198, 214] as const;
const MASS_AT = [190, 166] as const;
const MASS_DRAG_TO = [166, 230] as const;
const HYDRO_AT = [286, 174] as const;
const POLYGON = [
  [32, 294],
  [70, 288],
  [88, 314],
  [64, 332],
  [34, 322],
] as const;
const CIRCLE_CENTRE = [220, 420] as const;
const CIRCLE_RIM = [240, 420] as const;
const LIVE_MASS_AT = [230, 190] as const;
const LIVE_DRAG_TO = [226, 198] as const;

/** Field values entered in the PropertiesPanel and expected in the saved file. */
const POLY_EXPECT: Omit<MapPropField, 'shape'> = {
  name: 'Felsband West',
  kind: 'rock',
  entries: [
    { id: 'core:rock_01', weight: 3 },
    { id: 'core:rock_02', weight: 1 },
  ],
  densityPerKWu2: 96,
  seed: 0x1234abcd,
  scaleMinPermille: 700,
  scaleMaxPermille: 1300,
  maxSlopePermille: 450,
  dryOnly: true,
  reclaimMassMilli: 12_500,
  reclaimEnergyMilli: 2_500,
};
const CIRCLE_EXPECT: Omit<MapPropField, 'shape'> = {
  name: 'Hain Süd',
  kind: 'tree',
  entries: [
    { id: 'core:tree_01', weight: 2 },
    { id: 'core:tree_02', weight: 1 },
  ],
  densityPerKWu2: 48,
  seed: 777,
  scaleMinPermille: 800,
  scaleMaxPermille: 1200,
  maxSlopePermille: 600,
  dryOnly: false,
  reclaimMassMilli: 0,
  reclaimEnergyMilli: 30_000,
};

async function doc(page: Page): Promise<{ starts: { army: number; x: number; z: number }[]; spots: { kind: string; x: number; z: number }[]; fields: number }> {
  return page.evaluate(() => {
    const d = window.__editor!.store.doc.peek()!;
    return {
      starts: d.starts.map((s) => ({ army: s.army, x: s.x, z: s.z })),
      spots: d.spots.map((s) => ({ kind: s.kind, x: s.x, z: s.z })),
      fields: d.fields.length,
    };
  });
}

function near(raw: number, wu: number, tolWu = 1.5): boolean {
  return Math.abs(raw / WU - wu) <= tolWu;
}

/** Fills the field properties of the selected field with `v` (every input is one commit). */
async function enterFieldProps(page: Page, v: Omit<MapPropField, 'shape'>, idsText: string, seedText: string): Promise<void> {
  const panel = page.getByTestId('panel-properties');
  await expect(panel.getByTestId('field-name')).toBeVisible();
  await commitInput(page, 'field-name', v.name);
  await page.getByTestId('field-kind').selectOption(v.kind);
  await commitInput(page, 'field-ids', idsText);
  await commitInput(page, 'field-density', String(v.densityPerKWu2));
  await commitInput(page, 'field-seed', seedText);
  // Scale max first: min <= max must hold after every single commit.
  await commitInput(page, 'field-scale-max', String(v.scaleMaxPermille / 10).replace('.', ','));
  await commitInput(page, 'field-scale-min', String(v.scaleMinPermille / 10).replace('.', ','));
  await commitInput(page, 'field-max-slope', String(v.maxSlopePermille));
  const dry = page.getByTestId('field-dry-only');
  if ((await dry.isChecked()) !== v.dryOnly) await dry.click();
  await expect(dry).toBeChecked({ checked: v.dryOnly });
  await commitInput(page, 'field-reclaim-mass', String(v.reclaimMassMilli / 1000).replace('.', ','));
  await commitInput(page, 'field-reclaim-energy', String(v.reclaimEnergyMilli / 1000).replace('.', ','));
  await frame(page);
}

function stripShape(f: MapPropField): Omit<MapPropField, 'shape'> {
  const { shape: _shape, ...rest } = f;
  return rest;
}

test.describe('marker editor editing', () => {
  test('tools, fields, properties, symmetry, undo/redo and save; the game loaders read the file back', async ({ page, browserName }) => {
    const errors = captureErrors(page);
    await openEditor(page, MAP);
    const originalHash = hashOf(mapFile(MAP));
    expect(await exportHash(page)).toBe(originalHash);
    const before = await counts(page);

    // --- markers with the placement tools ----------------------------------------------------
    await selectTool(page, 'start');
    await clickWorld(page, ...START_AT);
    await selectTool(page, 'mass');
    await clickWorld(page, ...MASS_AT);
    await selectTool(page, 'hydro');
    await clickWorld(page, ...HYDRO_AT);
    let c = await counts(page);
    expect(c.starts).toBe(before.starts + 1);
    expect(c.mass).toBe(before.mass + 1);
    expect(c.hydro).toBe(before.hydro + 1);
    let d = await doc(page);
    const start = d.starts.find((s) => near(s.x, START_AT[0]) && near(s.z, START_AT[1]));
    expect(start, 'start placed at the clicked terrain point').toBeDefined();
    const massIdx = d.spots.findIndex((s) => s.kind === 'mass' && near(s.x, MASS_AT[0]) && near(s.z, MASS_AT[1]));
    expect(massIdx).toBeGreaterThanOrEqual(0);
    expect(d.spots.some((s) => s.kind === 'hydro' && near(s.x, HYDRO_AT[0]) && near(s.z, HYDRO_AT[1]))).toBe(true);

    // --- drag the new mass spot (one undo step) -------------------------------------------------
    await selectTool(page, 'select');
    const depthBeforeDrag = await undoDepth(page);
    const massNow = d.spots[massIdx]!;
    await dragWorld(page, [massNow.x / WU, massNow.z / WU], MASS_DRAG_TO);
    expect(await undoDepth(page)).toBe(depthBeforeDrag + 1);
    d = await doc(page);
    expect(near(d.spots[massIdx]!.x, MASS_DRAG_TO[0]) && near(d.spots[massIdx]!.z, MASS_DRAG_TO[1]), 'spot follows the drag').toBe(true);

    // --- delete the hydro spot with the delete tool --------------------------------------------
    await selectTool(page, 'delete');
    const hydro = d.spots.find((s) => s.kind === 'hydro' && near(s.x, HYDRO_AT[0]) && near(s.z, HYDRO_AT[1]))!;
    await clickWorld(page, hydro.x / WU, hydro.z / WU);
    c = await counts(page);
    expect(c.hydro).toBe(before.hydro);

    // --- polygon field (5 clicks + Enter) --------------------------------------------------------
    await selectTool(page, 'field-polygon');
    for (const [x, z] of POLYGON) await clickWorld(page, x, z);
    await page.keyboard.press('Enter');
    await frame(page);
    c = await counts(page);
    expect(c.fields).toBe(1);
    const poly = await page.evaluate(() => window.__editor!.store.doc.peek()!.fields[0]!.shape);
    expect(poly.kind).toBe('polygon');
    if (poly.kind === 'polygon') {
      expect(poly.points.length).toBe(5);
      poly.points.forEach((p, i) => expect(near(p.x, POLYGON[i]![0]) && near(p.z, POLYGON[i]![1]), `vertex ${i}`).toBe(true));
    }
    // The new field is selected: edit its properties.
    await enterFieldProps(page, POLY_EXPECT, 'core:rock_01:3, core:rock_02', '0x1234abcd');

    // --- circle field (press centre, drag to the rim) ------------------------------------------
    await selectTool(page, 'field-circle');
    await dragWorld(page, CIRCLE_CENTRE, CIRCLE_RIM, 10);
    c = await counts(page);
    expect(c.fields).toBe(2);
    const circle = await page.evaluate(() => window.__editor!.store.doc.peek()!.fields[1]!.shape);
    expect(circle.kind).toBe('circle');
    if (circle.kind === 'circle') {
      expect(near(circle.x, CIRCLE_CENTRE[0]) && near(circle.z, CIRCLE_CENTRE[1])).toBe(true);
      expect(Math.abs(circle.r / WU - (CIRCLE_RIM[0] - CIRCLE_CENTRE[0]))).toBeLessThanOrEqual(2);
    }
    await enterFieldProps(page, CIRCLE_EXPECT, 'core:tree_01:2, core:tree_02:1', '777');

    const fieldValues = await page.evaluate(() => window.__editor!.store.doc.peek()!.fields.map((f) => ({ ...f })));
    expect(stripShape(fieldValues[0]!)).toEqual(POLY_EXPECT);
    expect(stripShape(fieldValues[1]!)).toEqual(CIRCLE_EXPECT);
    c = await counts(page);
    expect(c.expandedProps).toBeGreaterThan(0);
    await expect(page.getByTestId('field-count')).not.toHaveText('0');

    // --- point symmetrize (keep half a) = one undo step, result is point-symmetric ----------------
    await page.getByTestId('select-symmetry').selectOption('point');
    await page.getByTestId('select-keep-half').selectOption('a');
    const depthBeforeSym = await undoDepth(page);
    await page.getByTestId('btn-symmetrize').click();
    await frame(page);
    expect(await undoDepth(page)).toBe(depthBeforeSym + 1);
    const symDoc = EditorDocument.fromBytes(await exportBytes(page));
    expect(isSymmetric(symDoc, 'point')).toBe(true);
    c = await counts(page);
    expect(c.fields).toBe(4);
    expect(c.starts).toBe(before.starts + 2);

    // --- live symmetry about the X axis: place + drag keep the mirror twin -----------------------
    await page.getByTestId('select-symmetry').selectOption('mirrorX');
    await page.getByTestId('chk-live-symmetry').check();
    await selectTool(page, 'mass');
    const massBefore = (await counts(page)).mass;
    await clickWorld(page, ...LIVE_MASS_AT);
    expect((await counts(page)).mass).toBe(massBefore + 2);
    d = await doc(page);
    // The clicked spot and its mirror twin (S − x, z), in whichever order the batch appended them.
    const pair = d.spots.slice(-2);
    const live = near(pair[0]!.x, LIVE_MASS_AT[0]) ? pair : [pair[1]!, pair[0]!];
    const liveIdx = near(pair[0]!.x, LIVE_MASS_AT[0]) ? [d.spots.length - 2, d.spots.length - 1] : [d.spots.length - 1, d.spots.length - 2];
    expect(near(live[0]!.x, LIVE_MASS_AT[0]) && near(live[0]!.z, LIVE_MASS_AT[1])).toBe(true);
    expect(live[1]!.x).toBe(SIZE_WU * WU - live[0]!.x);
    expect(live[1]!.z).toBe(live[0]!.z);
    await selectTool(page, 'select');
    const depthBeforeLiveDrag = await undoDepth(page);
    await dragWorld(page, [live[0]!.x / WU, live[0]!.z / WU], LIVE_DRAG_TO);
    expect(await undoDepth(page)).toBe(depthBeforeLiveDrag + 1);
    d = await doc(page);
    const moved = [d.spots[liveIdx[0]!]!, d.spots[liveIdx[1]!]!];
    expect(near(moved[0]!.x, LIVE_DRAG_TO[0]) && near(moved[0]!.z, LIVE_DRAG_TO[1])).toBe(true);
    expect(moved[1]!.x).toBe(SIZE_WU * WU - moved[0]!.x);
    expect(moved[1]!.z).toBe(moved[0]!.z);

    // --- screenshots of the edited state (fields, props, symmetry axis) ------------------------
    await page.getByTestId('btn-fit').click();
    await frame(page);
    // Select the polygon field so the properties panel shows its values in the screenshot.
    await clickWorld(page, 60, 312);
    await expect(page.getByTestId('field-name')).toHaveValue(POLY_EXPECT.name);
    const editShot = pixelStats(decodePng(await screenshot(page, `edit-${browserName}`)));
    expect(editShot.distinctColors).toBeGreaterThan(200);
    await centerOn(page, 60, 312);
    await zoomAt(page, 60, 312, -240, 3);
    await screenshot(page, `edit-zoom-${browserName}`);

    const editedHash = await exportHash(page);
    const editedBytes = await exportBytes(page);
    expect(editedHash).not.toBe(originalHash);

    // --- keyboard undo down to depth 0 == original, then redo everything ------------------------
    await focusCanvas(page);
    const total = await undoDepth(page);
    expect(total).toBeGreaterThanOrEqual(20);
    for (let i = total; i > 0; i--) {
      await page.keyboard.press('Control+z');
      await expect.poll(() => undoDepth(page)).toBe(i - 1);
    }
    expect(await exportHash(page)).toBe(originalHash);
    await expect(page.getByTestId('status-dirty')).toHaveAttribute('data-dirty', 'false');
    expect(await page.evaluate(() => window.__editor!.redoDepth())).toBe(total);
    for (let i = 0; i < total; i++) {
      await page.keyboard.press(i % 2 === 0 ? 'Control+Shift+z' : 'Control+y');
      await expect.poll(() => undoDepth(page)).toBe(i + 1);
    }
    expect(await page.evaluate(() => window.__editor!.redoDepth())).toBe(0);
    expect(await exportHash(page)).toBe(editedHash);

    // --- save ------------------------------------------------------------------------------------
    const saved = await saveDownload(page);
    expect(saved.fileName).toBe(`${MAP}.rtsmap`);
    expect(bytesEqual(saved.bytes, editedBytes)).toBe(true);
    await expect(page.getByTestId('status-dirty')).toHaveAttribute('data-dirty', 'false');

    // --- Node: the game's loader chain reproduces the file ----------------------------------------
    const file = saved.bytes;
    const map = readRtsMap(file.slice());
    expect(bytesEqual(writeRtsMap(map), file), 'readRtsMap -> writeRtsMap').toBe(true);
    const client = ClientMap.fromBytes(file.slice());
    expect(bytesEqual(writeRtsMap(client.map), file), 'ClientMap.fromBytes -> writeRtsMap').toBe(true);
    expect(client.starts).toEqual(map.meta.starts);
    expect(client.spots).toEqual(map.meta.spots);
    const resolved = resolveMap(file.slice());
    expect(bytesEqual(writeRtsMap(resolved), file), 'sim-host resolveMap -> writeRtsMap').toBe(true);
    const pageHash = await page.evaluate(() => window.__editor!.mapSimHash());
    expect(mapSimHash(map) >>> 0).toBe(pageHash);
    expect(mapSimHash(resolved) >>> 0).toBe(pageHash);
    const finalCounts = await counts(page);
    expect(expandPropFields(map).length).toBe(finalCounts.expandedProps);
    expect(map.propFields).toBeDefined();
    expect(map.propFields!.length).toBe(4);
    expect(stripShape(map.propFields![0]!)).toEqual(POLY_EXPECT);
    expect(stripShape(map.propFields![1]!)).toEqual(CIRCLE_EXPECT);

    expectNoErrors(errors);
  });

  test('help overlay opens with ? and closes with Escape', async ({ page, browserName }) => {
    const errors = captureErrors(page);
    await openEditor(page, MAP);
    await focusCanvas(page);
    await page.keyboard.press('Shift+Slash');
    const help = page.getByTestId('help-overlay');
    if (!(await help.isVisible())) await page.keyboard.type('?');
    await expect(help).toBeVisible();
    await screenshot(page, `help-${browserName}`);
    await page.keyboard.press('Escape');
    await expect(help).toBeHidden();
    await page.getByTestId('btn-help').click();
    await expect(help).toBeVisible();
    await page.getByTestId('btn-help-close').click();
    await expect(help).toBeHidden();
    expectNoErrors(errors);
  });
});
