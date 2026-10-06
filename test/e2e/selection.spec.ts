import { expect, test, type Page } from '@playwright/test';
import { attachJson, captureErrors, expectNoErrors, openGame, SERVERS, waitTick, writeReport } from './support/game.ts';
import {
  boxesIntersect,
  boxHit,
  cssShot,
  dragBox,
  expectSameSet,
  focusCanvas,
  frames,
  pauseSim,
  screenUnits,
  selection,
  TANKS,
  uiRects,
  type Box,
  type CssShot,
  type Rgb,
  type ScreenUnit,
} from './support/ms3.ts';

// Selection (C3, G19 rings, HP bars; MS3): real mouse gestures on the tank scene (150 own tanks at
// the NW start, 45 WU start view, sim paused so the geometry is static). Expectations come from the
// screen geometry the renderer uses (`screenUnits`: projected centre, icon square, projected
// selection radius) with the documented hit rule, not from the client's own selection code:
//   - box (left drag) = own units whose icon square / projected selection disc intersects the box,
//   - click = the own unit under the cursor (nearest centre), Shift+click toggles, click on empty
//     ground clears, Shift+box adds, double click = own units of the same type on screen, Esc clears,
//   - selection rings (dynamic terrain decals in the army color) appear around the selected units
//     and HP bars above them (pixel check against the unselected frame + render stats).

const BLUE_RING = (c: Rgb): boolean => c[2] > c[1] + 20 && c[2] > c[0] + 20;
const HP_GREEN = (c: Rgb): boolean => c[1] > 170 && c[0] < 130 && c[2] < 140 && c[1] > c[0] + 70;

function own(units: readonly ScreenUnit[]): ScreenUnit[] {
  return units.filter((u) => u.army === 0);
}

/** Box-select expectation: definite hits, and the ambiguous (sub-pixel boundary) handles. */
function expectBox(units: readonly ScreenUnit[], b: Box): { hits: number[]; ambiguous: number[] } {
  const hits: number[] = [];
  const ambiguous: number[] = [];
  for (const u of own(units)) {
    const h = boxHit(u, b);
    if (h === 1) hits.push(u.handle);
    else if (h === -1) ambiguous.push(u.handle);
  }
  return { hits, ambiguous };
}

function compareBox(sel: readonly number[], exp: { hits: number[]; ambiguous: number[] }, msg: string): void {
  const amb = new Set(exp.ambiguous);
  const a = sel.filter((h) => !amb.has(h));
  expectSameSet(a, exp.hits, msg);
}

/** Checks a box against the HUD (boxes must start/end on the canvas). */
function freeOfUi(b: Box, ui: readonly Box[]): boolean {
  return ui.every((r) => !boxesIntersect(b, r, 6));
}

interface RingHp {
  checked: number;
  ringUnits: number;
  hpUnits: number;
  perUnit: { handle: number; ringPoints: number; hpPixels: number }[];
}

/** Ring and HP-bar pixels that appear with the selection (before = same frame without selection). */
async function ringAndHpPixels(page: Page, before: CssShot, after: CssShot, units: readonly ScreenUnit[], ui: readonly Box[]): Promise<RingHp> {
  const cands = units.filter((u) => u.selected && !u.icon && u.onScreen && u.x !== null && u.y !== null && u.x > 20 && u.x < 1260 && u.y > 60 && u.y < 700);
  const free = cands.filter((u) => freeOfUi({ x0: u.x! - 20, y0: u.y! - 60, x1: u.x! + 20, y1: u.y! + 20 }, ui));
  const ringPts = await page.evaluate((us) => {
    const h = window.__faf!;
    return us.map((u) => {
      const p = h.unitPos(u.handle)!;
      const c = h.project(p.x, p.y, p.z)!;
      const ax = h.project(p.x + 0.5, p.y, p.z)!;
      const bx = h.project(p.x - 0.5, p.y, p.z)!;
      const az = h.project(p.x, p.y, p.z + 0.5)!;
      const bz = h.project(p.x, p.y, p.z - 0.5)!;
      const pxPerWu = Math.max(Math.hypot(ax.x - bx.x, ax.y - bx.y), Math.hypot(az.x - bz.x, az.y - bz.y));
      const r = u.radiusPx / Math.max(1e-6, pxPerWu);
      const pts: ({ x: number; y: number } | null)[] = [];
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const x = p.x + Math.cos(a) * r;
        const z = p.z + Math.sin(a) * r;
        pts.push(h.project(x, h.heightAt(x, z), z));
      }
      return { handle: u.handle, c, pts };
    });
  }, free);
  const out: RingHp = { checked: ringPts.length, ringUnits: 0, hpUnits: 0, perUnit: [] };
  for (const u of ringPts) {
    let ringPoints = 0;
    for (const p of u.pts) {
      if (p === null) continue;
      let hit = false;
      for (let dy = -1.5; dy <= 1.5 && !hit; dy += 0.5) {
        for (let dx = -1.5; dx <= 1.5 && !hit; dx += 0.5) {
          hit = BLUE_RING(after.at(p.x + dx, p.y + dy)) && !BLUE_RING(before.at(p.x + dx, p.y + dy));
        }
      }
      if (hit) ringPoints++;
    }
    let hpPixels = 0;
    for (let dy = -55; dy <= 5; dy++) {
      for (let dx = -16; dx <= 16; dx++) {
        if (HP_GREEN(after.at(u.c.x + dx, u.c.y + dy)) && !HP_GREEN(before.at(u.c.x + dx, u.c.y + dy))) hpPixels++;
      }
    }
    if (ringPoints >= 3) out.ringUnits++;
    if (hpPixels >= 4) out.hpUnits++;
    out.perUnit.push({ handle: u.handle, ringPoints, hpPixels });
  }
  return out;
}

for (const server of SERVERS) {
  test(`selection: Box, Klick, Shift+Klick, Shift+Box, Doppelklick, Esc, Ringe + HP-Balken – ${server.label}`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const errors = captureErrors(page);
    await openGame(page, server.url, TANKS, 300);
    await waitTick(page, 40);
    await pauseSim(page);
    await focusCanvas(page);
    await frames(page, 3);
    const ui = await uiRects(page);

    // MS3: no implicit selection any more.
    expect(await selection(page)).toEqual([]);
    const rs0 = await page.evaluate(() => window.__faf!.renderStats());
    const before = await cssShot(page);
    const units0 = await screenUnits(page);
    const ownOn = own(units0).filter((u) => u.onScreen);
    expect(ownOn.length).toBeGreaterThanOrEqual(100);

    // Box around the centre of the own army (never over the HUD).
    const xs = ownOn.map((u) => u.x!).sort((a, b) => a - b);
    const ys = ownOn.map((u) => u.y!).sort((a, b) => a - b);
    const mx = xs[xs.length >> 1]!;
    const my = ys[ys.length >> 1]!;
    const box: Box = { x0: mx - 150, y0: my - 90, x1: mx + 60, y1: my + 110 };
    expect(freeOfUi(box, ui), `box ${JSON.stringify(box)} overlaps the HUD`).toBe(true);
    const expBox = expectBox(units0, box);
    expect(expBox.hits.length).toBeGreaterThanOrEqual(10);
    await dragBox(page, box);
    await frames(page, 3);
    const selBox = await selection(page);
    compareBox(selBox, expBox, 'box select');

    // Rings + HP bars of the selection.
    const units1 = await screenUnits(page);
    const after = await cssShot(page);
    const rs1 = await page.evaluate(() => window.__faf!.renderStats());
    const fb1 = await page.evaluate(() => window.__faf!.feedback());
    const meshSelected = units1.filter((u) => u.selected && !u.icon).length;
    const ringHp = await ringAndHpPixels(page, before, after, units1, ui);
    expect(fb1.rings, 'one ring decal per selected unit drawn as mesh').toBe(meshSelected);
    expect(rs1.dynamicDecals).toBeGreaterThanOrEqual(meshSelected);
    expect(rs1.drawsByPass.overlay, 'HP-bar draw in the overlay pass').toBeGreaterThan(rs0.drawsByPass.overlay);
    expect(ringHp.checked).toBeGreaterThanOrEqual(8);
    expect(ringHp.ringUnits / ringHp.checked, `rings visible at ${ringHp.ringUnits}/${ringHp.checked}`).toBeGreaterThanOrEqual(0.75);
    expect(ringHp.hpUnits / ringHp.checked, `HP bars at ${ringHp.hpUnits}/${ringHp.checked}`).toBeGreaterThanOrEqual(0.75);

    // Esc clears (rings and bars disappear with it).
    await page.keyboard.press('Escape');
    await frames(page, 2);
    expect(await selection(page)).toEqual([]);
    const rsEsc = await page.evaluate(() => window.__faf!.renderStats());
    expect(rsEsc.dynamicDecals).toBe(0);

    // Click: the most isolated own unit away from the HUD; Shift+click toggles a second one.
    const byIsolation = ownOn
      .filter((u) => freeOfUi({ x0: u.x! - 20, y0: u.y! - 20, x1: u.x! + 20, y1: u.y! + 20 }, ui))
      .map((u) => ({ u, d: Math.min(...ownOn.filter((o) => o !== u).map((o) => Math.hypot(o.x! - u.x!, o.y! - u.y!))) }))
      .sort((a, b) => b.d - a.d);
    const ua = byIsolation[0]!.u;
    const ub = byIsolation[1]!.u;
    await page.mouse.click(ua.x!, ua.y!);
    await frames(page, 2);
    expect(await selection(page)).toEqual([ua.handle]);
    await page.keyboard.down('Shift');
    await page.mouse.click(ub.x!, ub.y!);
    await frames(page, 2);
    expectSameSet(await selection(page), [ua.handle, ub.handle], 'Shift+click adds');
    // Wait out the double-click window before clicking the same unit again.
    await page.waitForTimeout(450);
    await page.mouse.click(ua.x!, ua.y!);
    await page.keyboard.up('Shift');
    await frames(page, 2);
    expect(await selection(page), 'Shift+click on a selected unit removes it').toEqual([ub.handle]);

    // Click on empty ground clears.
    const empty = [
      { x: 1180, y: 80 },
      { x: 1180, y: 660 },
      { x: 700, y: 60 },
      { x: 400, y: 680 },
    ].find((p) => units0.every((u) => u.x === null || Math.hypot(u.x - p.x, u.y! - p.y) > 40) && freeOfUi({ x0: p.x - 5, y0: p.y - 5, x1: p.x + 5, y1: p.y + 5 }, ui));
    expect(empty, 'an empty ground point on screen').toBeDefined();
    await page.waitForTimeout(450);
    await page.mouse.click(empty!.x, empty!.y);
    await frames(page, 2);
    expect(await selection(page), 'click on empty ground clears').toEqual([]);

    // Box + Shift+box = union.
    const left: Box = { x0: mx - 160, y0: my - 100, x1: mx - 20, y1: my + 100 };
    const right: Box = { x0: mx + 30, y0: my - 60, x1: mx + 170, y1: my + 120 };
    expect(freeOfUi(left, ui) && freeOfUi(right, ui)).toBe(true);
    const expL = expectBox(units0, left);
    const expR = expectBox(units0, right);
    await dragBox(page, left);
    await frames(page, 2);
    compareBox(await selection(page), expL, 'left box');
    await dragBox(page, right, true);
    await frames(page, 2);
    const union = { hits: [...new Set([...expL.hits, ...expR.hits])], ambiguous: [...expL.ambiguous, ...expR.ambiguous] };
    compareBox(await selection(page), union, 'Shift+box adds');
    expect(union.hits.length).toBeGreaterThan(Math.max(expL.hits.length, expR.hits.length));

    // Double click = every own unit of the same type whose centre is on screen.
    await page.keyboard.press('Escape');
    const types = new Map<number, number>();
    for (const u of ownOn) types.set(u.visual, (types.get(u.visual) ?? 0) + 1);
    const target = byIsolation.map((e) => e.u).find((u) => (types.get(u.visual) ?? 0) >= 3 && u.visual !== ua.visual) ?? ua;
    await page.waitForTimeout(450);
    await page.mouse.dblclick(target.x!, target.y!);
    await frames(page, 2);
    const same = own(await screenUnits(page)).filter((u) => u.visual === target.visual && u.onScreen).map((u) => u.handle);
    const selDbl = await selection(page);
    expectSameSet(selDbl, same, 'double click selects the same type on screen');
    expect(selDbl.length).toBeGreaterThanOrEqual(3);
    // Only that type.
    const vis = new Map(units0.map((u) => [u.handle, u.visual]));
    expect(selDbl.every((h) => vis.get(h) === target.visual)).toBe(true);

    await page.keyboard.press('Escape');
    await frames(page, 2);
    expect(await selection(page)).toEqual([]);

    const report = {
      browser: testInfo.project.name,
      server: server.name,
      box: { box, expected: expBox.hits.length, ambiguous: expBox.ambiguous.length, selected: selBox.length },
      rings: { meshSelected, feedbackRings: fb1.rings, dynamicDecals: rs1.dynamicDecals, overflow: rs1.decalChunkOverflow },
      overlayDraws: { before: rs0.drawsByPass.overlay, selected: rs1.drawsByPass.overlay },
      pixels: { checked: ringHp.checked, ringUnits: ringHp.ringUnits, hpUnits: ringHp.hpUnits },
      click: { a: ua.handle, b: ub.handle, isolationPx: byIsolation[0]!.d },
      shiftBox: { left: expL.hits.length, right: expR.hits.length, union: union.hits.length },
      doubleClick: { visual: target.visual, selected: selDbl.length },
    };
    writeReport(`selection-${testInfo.project.name}-${server.transport}`, { ...report, perUnit: ringHp.perUnit });
    await attachJson(testInfo, 'selection', report);
    expectNoErrors(errors);
  });
}
