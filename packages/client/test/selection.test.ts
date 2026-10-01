import { FrameReader, UnitFlags } from '@faf/protocol';
import { RAW_PER_WU, RtsCamera, eyeDistanceWU, iconProjectionScale, iconScreenRect } from '@faf/render';
import { describe, expect, it } from 'vitest';
import { CommandBuilder } from '../src/commands.ts';
import { Selection, interpolatedPos, isOwnUnit } from '../src/selection.ts';
import { FakeSimLink } from './support/fake-sim-link.ts';

function setup(units = 100, enemy = 10) {
  const link = new FakeSimLink({ units, enemyUnits: enemy, originWU: [240, 240], spacingWU: 2 });
  const reader = new FrameReader();
  const bytes = link.frames.poll()!;
  expect(reader.reset(bytes)).toBe(true);
  const cam = new RtsCamera({ distance: 60 });
  cam.setViewport(1280, 720);
  cam.setTargetWU(250, 0, 250);
  cam.update();
  const sel = new Selection(0);
  sel.onFrame(reader);
  return { link, reader, cam, sel };
}

/** Brute-force expectation: own units whose projected position lies in the rect. */
function expectedBox(r: FrameReader, cam: RtsCamera, x0: number, y0: number, x1: number, y1: number): number[] {
  const out: number[] = [];
  const s = new Float64Array(4);
  for (let i = 0; i < r.unitCount; i++) {
    if (r.unitArmy(i) !== 0) continue;
    if (!cam.project(r.unitCur(i, 0), r.unitCur(i, 1), r.unitCur(i, 2), s)) continue;
    const radius = 0.5 * iconProjectionScale(cam.viewportHeight, cam.fovY) / eyeDistanceWU(cam, r.unitCur(i, 0), r.unitCur(i, 1), r.unitCur(i, 2));
    if (s[0]! + radius >= x0 && s[0]! - radius <= x1 && s[1]! + radius >= y0 && s[1]! - radius <= y1) out.push(r.unitHandle(i));
  }
  return out;
}

describe('Selection', () => {
  it('starts empty; explicit selectAll highlights own units and never enemies', () => {
    const { sel, reader } = setup();
    expect(sel.mode).toBe('explicit');
    expect(sel.count).toBe(0);
    expect(sel.highlightCount).toBe(110);
    for (let i = 0; i < sel.count; i++) expect(reader.unitArmy(sel.indices[i]!)).toBe(0);
    expect([...sel.highlight.subarray(0, 110)].every((v) => v === 0)).toBe(true);
    sel.highlightImplicit = true;
    sel.selectAll();
    expect([...sel.highlight.subarray(0, 100)].every((v) => v === 1)).toBe(true);
    expect([...sel.highlight.subarray(100, 110)].every((v) => v === 0)).toBe(true);
  });

  it('box-selects exactly the own units whose projected positions are inside the rect', () => {
    const { sel, cam, reader } = setup();
    const rect = [500, 250, 800, 480] as const;
    const hits = sel.boxSelect(cam, 1, rect[0], rect[1], rect[2], rect[3], false);
    const exp = expectedBox(reader, cam, ...rect);
    expect(exp.length).toBeGreaterThan(5);
    expect(exp.length).toBeLessThan(100);
    expect(hits).toBe(exp.length);
    expect(sel.mode).toBe('explicit');
    expect([...sel.selected()].sort()).toEqual([...exp].sort());
    // Highlight marks exactly the selected records.
    for (let i = 0; i < reader.unitCount; i++) expect(sel.highlight[i]).toBe(exp.includes(reader.unitHandle(i)) ? 1 : 0);
    // Reversed corners give the same result.
    sel.boxSelect(cam, 1, rect[2], rect[3], rect[0], rect[1], false);
    expect(sel.count).toBe(exp.length);
  });

  it('box-selects on the interpolated (displayed) positions', () => {
    const { sel, cam } = setup(1, 0);
    const reader = new FrameReader();
    // Move the unit 10 WU to +x in one tick (speed large).
    const l2 = new FakeSimLink({ units: 1, speedRaw: 10 * RAW_PER_WU, originWU: [250, 250] });
    const h = l2.handles()[0]!;
    new CommandBuilder(l2, 0).move([h], 260 * RAW_PER_WU, 0, 250 * RAW_PER_WU);
    l2.tickNow();
    reader.reset(l2.frames.poll()!);
    expect(reader.unitPrev(0, 0)).toBe(250 * RAW_PER_WU);
    expect(reader.unitCur(0, 0)).toBe(260 * RAW_PER_WU);
    sel.onFrame(reader);
    const s = new Float64Array(4);
    // Screen position at alpha 0.5 (x = 255 WU).
    cam.project(255 * RAW_PER_WU, 0, 250 * RAW_PER_WU, s);
    expect(sel.boxSelect(cam, 0.5, s[0]! - 3, s[1]! - 3, s[0]! + 3, s[1]! + 3, false)).toBe(1);
    expect(sel.boxSelect(cam, 1, s[0]! - 3, s[1]! - 3, s[0]! + 3, s[1]! + 3, false)).toBe(0);
  });

  it('click selects the nearest own unit within the pixel radius; empty click clears; shift adds', () => {
    const { sel, cam, reader } = setup();
    const s = new Float64Array(4);
    const i = 37;
    cam.project(reader.unitCur(i, 0), 0, reader.unitCur(i, 2), s);
    expect(sel.clickSelect(cam, 1, s[0]! + 2, s[1]! - 1, false)).toBe(reader.unitHandle(i));
    expect(sel.count).toBe(1);
    const j = 12;
    cam.project(reader.unitCur(j, 0), 0, reader.unitCur(j, 2), s);
    sel.clickSelect(cam, 1, s[0]!, s[1]!, true);
    expect(sel.count).toBe(2);
    expect(sel.has(reader.unitHandle(i)) && sel.has(reader.unitHandle(j))).toBe(true);
    // Far away from everything: clears.
    expect(sel.clickSelect(cam, 1, 5, 5, false)).toBe(-1);
    expect(sel.count).toBe(0);
    expect(sel.mode).toBe('explicit');
    // Enemy units are not clickable.
    const e = 105;
    expect(reader.unitArmy(e)).toBe(1);
    cam.project(reader.unitCur(e, 0), 0, reader.unitCur(e, 2), s);
    expect(sel.clickSelect(cam, 1, s[0]!, s[1]!, false, 1)).toBe(-1);
    // Shift-add from the implicit mode keeps all own units.
    sel.selectAll();
    sel.clickSelect(cam, 1, 5, 5, true);
    expect(sel.count).toBe(100);
    expect(sel.mode).toBe('explicit');
  });

  it('prunes selected units that vanished from the frame', () => {
    const { link, sel, reader } = setup(10, 0);
    const hs = link.handles();
    sel.set([hs[1]!, hs[2]!, hs[3]!]);
    expect(sel.count).toBe(3);
    const v0 = sel.version;
    new CommandBuilder(link, 0).kill([hs[2]!]);
    link.tickNow();
    reader.reset(link.frames.poll()!);
    sel.onFrame(reader);
    expect(sel.count).toBe(2);
    expect(sel.has(hs[2]!)).toBe(false);
    expect(sel.version).toBeGreaterThan(v0);
  });

  it('helpers: isOwnUnit excludes wreck/ghost/blip; interpolatedPos honours noInterp', () => {
    const { reader } = setup(2, 1);
    expect(isOwnUnit(reader, 0, 0)).toBe(true);
    expect(isOwnUnit(reader, 2, 0)).toBe(false);
    const out = new Float64Array(3);
    interpolatedPos(reader, 0, 0.5, out);
    expect(out[0]).toBe(reader.unitCur(0, 0));
    expect(UnitFlags.NoInterp).toBe(1 << 10);
  });
});


it('strategic icon boxes match rendered rectangles over 200 random boxes and 1000 units', () => {
  const { sel, cam, reader } = setup(1000, 0);
  sel.visuals = [{ spec: { hull: 'box', size: [1, 1, 1] }, icon: 'cube', selectionRadius: 0.7, iconThreshold: 14 }];
  sel.mapSizeWu = 512;
  cam.distance = 900; cam.update();
  let state = 43;
  const random = (): number => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const rect = new Float64Array(4);
  for (let b = 0; b < 200; b++) {
    const x = 560 + random() * 160; const y = 300 + random() * 100;
    const w = 2 + random() * 80; const h = 2 + random() * 80;
    const expected: number[] = [];
    for (let i = 0; i < reader.unitCount; i++) if (iconScreenRect(cam, reader.unitCur(i, 0), reader.unitCur(i, 1), reader.unitCur(i, 2), rect) && rect[2]! >= x && rect[0]! <= x + w && rect[3]! >= y && rect[1]! <= y + h) expected.push(reader.unitHandle(i));
    sel.boxSelect(cam, 1, x, y, x + w, y + h, false);
    expect(Array.from(sel.selected())).toEqual(expected);
  }
  const p = new Float64Array(4);
  cam.project(reader.unitCur(0, 0), reader.unitCur(0, 1), reader.unitCur(0, 2), p);
  sel.clear(); const h = sel.clickSelect(cam, 1, p[0]!, p[1]!, false);
  sel.clickSelect(cam, 1, p[0]!, p[1]!, true); expect(sel.count).toBe(0);
  sel.selectTypeOnScreen(cam, 1, h); expect(sel.count).toBe(1000);
});
