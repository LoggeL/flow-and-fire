import { FrameReader, UnitFlags } from '@faf/protocol';
import { RAW_PER_WU, RtsCamera, iconScreenRect, strategicZoom, unitIconFade, type VisualTable } from '@faf/render';
import { describe, expect, it } from 'vitest';
import { maxDistanceForMap } from '../src/camera-controller.ts';
import { CommandBuilder } from '../src/commands.ts';
import { ICON_HIT_FADE, Selection, interpolatedPos, isOwnUnit } from '../src/selection.ts';
import { VisualGeometry } from '../src/visuals.ts';
import { FakeSimLink, type FakeSimOptions } from './support/fake-sim-link.ts';

/** Cube visual: selection radius 0.6 WU (1.2 × half extent), default threshold 14 px. */
const CUBE: VisualTable = [{ spec: { hull: 'box', size: [1, 1, 1] } }];
/** Mesh-only visual (threshold 0: never an icon outside Z2). */
const MESH_ONLY: VisualTable = [{ spec: { hull: 'box', size: [1, 1, 1] }, iconThreshold: 0, selectionRadius: 0.6 }];

function camera(distance: number, target: readonly [number, number], pitchDeg = 55): RtsCamera {
  const cam = new RtsCamera({ distance });
  cam.maxDistance = Math.max(cam.maxDistance, distance);
  cam.distance = distance;
  cam.pitch = (pitchDeg * Math.PI) / 180;
  cam.setViewport(1280, 720);
  cam.setTargetWU(target[0], 0, target[1]);
  cam.update();
  return cam;
}

function setup(units = 100, enemy = 10, visuals: VisualTable = MESH_ONLY, extra: FakeSimOptions = {}) {
  const link = new FakeSimLink({ units, enemyUnits: enemy, originWU: [240, 240], spacingWU: 2, ...extra });
  const reader = new FrameReader();
  expect(reader.reset(link.frames.poll()!)).toBe(true);
  const cam = camera(40, [250, 250]);
  const sel = new Selection(0);
  sel.geometry = new VisualGeometry(visuals);
  sel.mapSizeWU = 512;
  sel.onFrame(reader);
  return { link, reader, cam, sel };
}

/** Independent expectation of the mesh-mode box rule: projected disc of the selection radius meets the rect. */
function expectedMeshBox(r: FrameReader, cam: RtsCamera, radiusWU: number, x0: number, y0: number, x1: number, y1: number): number[] {
  const out: number[] = [];
  const s = new Float64Array(4);
  const k = 720 / (2 * Math.tan(cam.fovY / 2));
  for (let i = 0; i < r.unitCount; i++) {
    if (r.unitArmy(i) !== 0) continue;
    const x = r.unitCur(i, 0);
    const z = r.unitCur(i, 2);
    if (!cam.project(x, 0, z, s)) continue;
    const eye = cam.camPosInt;
    const d = Math.hypot((x - eye[0]!) / RAW_PER_WU - cam.camFrac[0]!, (0 - eye[1]!) / RAW_PER_WU - cam.camFrac[1]!, (z - eye[2]!) / RAW_PER_WU - cam.camFrac[2]!);
    const rp = (radiusWU * k) / d;
    const cx = Math.min(Math.max(s[0]!, x0), x1);
    const cy = Math.min(Math.max(s[1]!, y0), y1);
    if ((s[0]! - cx) ** 2 + (s[1]! - cy) ** 2 <= rp * rp) out.push(r.unitHandle(i));
  }
  return out;
}

/** Deterministic PRNG for the random boxes. */
function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('Selection (C3)', () => {
  it('starts empty (FA): no implicit selection; Ctrl+A = all own units, never enemies; clear empties', () => {
    const { sel, reader } = setup();
    expect(sel.count).toBe(0);
    expect(sel.highlightCount).toBe(110);
    expect([...sel.highlight.subarray(0, 110)].every((v) => v === 0)).toBe(true);
    expect(sel.selectAll()).toBe(100);
    for (let i = 0; i < sel.count; i++) expect(reader.unitArmy(sel.indices[i]!)).toBe(0);
    expect([...sel.highlight.subarray(0, 100)].every((v) => v === 1)).toBe(true);
    expect([...sel.highlight.subarray(100, 110)].every((v) => v === 0)).toBe(true);
    sel.clear();
    expect(sel.count).toBe(0);
    // Enemy handles passed to set() are dropped.
    sel.set([reader.unitHandle(105), reader.unitHandle(3)]);
    expect([...sel.selected()]).toEqual([reader.unitHandle(3)]);
  });

  it('mesh mode: box selects the own units whose projected selection disc meets the rect', () => {
    const { sel, cam, reader } = setup();
    const rect = [500, 250, 800, 480] as const;
    const hits = sel.boxSelect(cam, 1, rect[0], rect[1], rect[2], rect[3], false);
    const exp = expectedMeshBox(reader, cam, 0.6, ...rect);
    expect(exp.length).toBeGreaterThan(5);
    expect(exp.length).toBeLessThan(100);
    expect(hits).toBe(exp.length);
    expect([...sel.selected()].sort()).toEqual([...exp].sort());
    for (let i = 0; i < reader.unitCount; i++) expect(sel.highlight[i]).toBe(exp.includes(reader.unitHandle(i)) ? 1 : 0);
    // Reversed corners give the same result; Shift adds instead of replacing.
    sel.boxSelect(cam, 1, rect[2], rect[3], rect[0], rect[1], false);
    expect(sel.count).toBe(exp.length);
    const more = sel.boxSelect(cam, 1, 0, 0, 200, 720, true);
    expect(sel.count).toBe(new Set([...exp, ...expectedMeshBox(reader, cam, 0.6, 0, 0, 200, 720)]).size);
    expect(more).toBeGreaterThanOrEqual(0);
  });

  it('box-selects on the interpolated (displayed) positions', () => {
    const { sel, cam } = setup(1, 0);
    const reader = new FrameReader();
    const l2 = new FakeSimLink({ units: 1, speedRaw: 10 * RAW_PER_WU, originWU: [250, 250] });
    const h = l2.handles()[0]!;
    new CommandBuilder(l2, 0).move([h], 260 * RAW_PER_WU, 0, 250 * RAW_PER_WU);
    l2.tickNow();
    reader.reset(l2.frames.poll()!);
    expect(reader.unitPrev(0, 0)).toBe(250 * RAW_PER_WU);
    expect(reader.unitCur(0, 0)).toBe(260 * RAW_PER_WU);
    sel.onFrame(reader);
    const s = new Float64Array(4);
    cam.project(255 * RAW_PER_WU, 0, 250 * RAW_PER_WU, s); // alpha 0.5 ⇒ x = 255 WU
    expect(sel.boxSelect(cam, 0.5, s[0]! - 1, s[1]! - 1, s[0]! + 1, s[1]! + 1, false)).toBe(1);
    expect(sel.boxSelect(cam, 1, s[0]! - 1, s[1]! - 1, s[0]! + 1, s[1]! + 1, false)).toBe(0);
  });

  it('strategic zoom, whole map: box select on icons with 1,000 units and 240 random boxes (≥ 99 % hit, ≤ 1 % wrong)', () => {
    // 1,000 own cubes over the whole 512 WU map (spacing 15 WU) plus 200 enemies.
    const link = new FakeSimLink({ units: 1000, enemyUnits: 0, originWU: [18, 18], spacingWU: 15 });
    const r = new FrameReader();
    r.reset(link.frames.poll()!);
    const sel = new Selection(0);
    sel.geometry = new VisualGeometry(CUBE);
    sel.mapSizeWU = 512;
    sel.onFrame(r);
    const dist = maxDistanceForMap(512, (45 * Math.PI) / 180);
    const cam = camera(dist, [256, 256], 82);
    expect(strategicZoom(cam.distance, 512).level).toBe(2);
    const rect = new Float64Array(4);
    for (let i = 0; i < r.unitCount; i++) expect(unitIconFade(cam, r.unitCur(i, 0), 0, r.unitCur(i, 2), 0.6, 14, 1)).toBeGreaterThanOrEqual(ICON_HIT_FADE);
    const rnd = lcg(7);
    const corner = new Float64Array(4);
    let mx0 = 1280;
    let my0 = 720;
    let mx1 = 0;
    let my1 = 0;
    for (const [cx, cz] of [[0, 0], [512, 0], [0, 512], [512, 512]] as const) {
      expect(cam.project(cx * RAW_PER_WU, 0, cz * RAW_PER_WU, corner)).toBe(true);
      mx0 = Math.min(mx0, corner[0]!);
      mx1 = Math.max(mx1, corner[0]!);
      my0 = Math.min(my0, corner[1]!);
      my1 = Math.max(my1, corner[1]!);
    }
    expect(mx0).toBeGreaterThanOrEqual(0);
    expect(my0).toBeGreaterThanOrEqual(0);
    expect(mx1).toBeLessThanOrEqual(1280);
    expect(my1).toBeLessThanOrEqual(720);
    let expected = 0;
    let found = 0;
    let wrong = 0;
    let selectedTotal = 0;
    let nonEmpty = 0;
    for (let b = 0; b < 240; b++) {
      const w = 4 + rnd() * (b % 3 === 0 ? 300 : 50);
      const h = 4 + rnd() * (b % 3 === 0 ? 250 : 50);
      // Boxes over the map's on-screen area (the map fills ≈ 87 % of the height at full zoom).
      const x0 = mx0 + rnd() * Math.max(1, mx1 - mx0 - w);
      const y0 = my0 + rnd() * Math.max(1, my1 - my0 - h);
      sel.boxSelect(cam, 1, x0, y0, x0 + w, y0 + h, false);
      // Expected: own units whose icon (render iconScreenRect, crossfade via render unitIconFade) meets the box.
      const exp = new Set<number>();
      for (let i = 0; i < r.unitCount; i++) {
        if (!isOwnUnit(r, i, 0)) continue;
        const x = r.unitCur(i, 0);
        const z = r.unitCur(i, 2);
        if (!iconScreenRect(cam, x, 0, z, rect)) continue;
        if (rect[2]! >= x0 && rect[0]! <= x0 + w && rect[3]! >= y0 && rect[1]! <= y0 + h) exp.add(r.unitHandle(i));
      }
      const got = sel.selected();
      expected += exp.size;
      selectedTotal += got.length;
      if (exp.size > 0) nonEmpty++;
      for (const g of got) {
        if (exp.has(g)) found++;
        else wrong++;
      }
    }
    console.log(`[C3] icon box select, whole map: ${nonEmpty}/240 boxes non-empty, hit ${found}/${expected}, wrong ${wrong}/${selectedTotal}`);
    expect(nonEmpty).toBeGreaterThanOrEqual(200);
    expect(expected).toBeGreaterThan(1000);
    expect(found / expected).toBeGreaterThanOrEqual(0.99);
    expect(wrong / Math.max(1, selectedTotal)).toBeLessThanOrEqual(0.01);
    // Every unit hit-tests through its icon at this zoom (Z2 ⇒ icon force 1).
    const pr = sel.project(cam, 1);
    for (let i = 0; i < pr.count; i++) expect(pr.icon[i]).toBe(1);
  });

  it('crossfade band: hit mode switches with the renderer rule (icon ≥ 0.5 coverage, else disc)', () => {
    const link = new FakeSimLink({ units: 400, enemyUnits: 0, originWU: [150, 150], spacingWU: 10 });
    const r = new FrameReader();
    r.reset(link.frames.poll()!);
    const sel = new Selection(0);
    sel.geometry = new VisualGeometry(CUBE);
    sel.mapSizeWU = 512;
    sel.onFrame(r);
    const cam = camera(62, [250, 250], 50);
    const pr = sel.project(cam, 1);
    let icons = 0;
    let meshes = 0;
    for (let i = 0; i < pr.count; i++) {
      const f = unitIconFade(cam, r.unitCur(i, 0), 0, r.unitCur(i, 2), 0.6, 14, strategicZoom(cam.distance, 512).iconForce);
      expect(pr.fade[i]).toBeCloseTo(f, 12);
      expect(pr.icon[i]).toBe(f >= ICON_HIT_FADE ? 1 : 0);
      if (pr.visible[i] === 1 && pr.onScreen(i)) {
        if (pr.icon[i] === 1) icons++;
        else meshes++;
      }
    }
    // Perspective: near units are meshes, far units icons.
    expect(icons).toBeGreaterThan(0);
    expect(meshes).toBeGreaterThan(0);
  });

  it('click: nearest own unit (disc or icon square); Shift toggles; empty ground clears; enemies never', () => {
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
    // Shift+click on a selected unit removes it.
    sel.clickSelect(cam, 1, s[0]!, s[1]!, true);
    expect(sel.count).toBe(1);
    expect(sel.has(reader.unitHandle(j))).toBe(false);
    // Shift+click on empty ground keeps the selection.
    expect(sel.clickSelect(cam, 1, 5, 5, true)).toBe(-1);
    expect(sel.count).toBe(1);
    // Plain click on empty ground clears.
    expect(sel.clickSelect(cam, 1, 5, 5, false)).toBe(-1);
    expect(sel.count).toBe(0);
    // Enemy units are not clickable.
    const e = 105;
    expect(reader.unitArmy(e)).toBe(1);
    cam.project(reader.unitCur(e, 0), 0, reader.unitCur(e, 2), s);
    expect(sel.clickSelect(cam, 1, s[0]!, s[1]!, false)).toBe(-1);
    // pick() can see enemies when asked.
    expect(sel.pick(cam, 1, s[0]!, s[1]!, false)).toBe(e);
  });

  it('click on an icon hits inside its square only', () => {
    const link = new FakeSimLink({ units: 4, enemyUnits: 0, originWU: [100, 100], spacingWU: 60 });
    const r = new FrameReader();
    r.reset(link.frames.poll()!);
    const sel = new Selection(0);
    sel.geometry = new VisualGeometry(CUBE);
    sel.mapSizeWU = 512;
    sel.onFrame(r);
    const cam = camera(700, [256, 256], 82);
    const rect = new Float64Array(4);
    expect(iconScreenRect(cam, r.unitCur(0, 0), 0, r.unitCur(0, 2), rect)).toBe(true);
    expect(sel.clickSelect(cam, 1, rect[0]! + 0.5, rect[1]! + 0.5, false)).toBe(r.unitHandle(0));
    expect(sel.clickSelect(cam, 1, rect[2]! + 1.5, rect[3]! + 1.5, false)).toBe(-1);
  });

  it('double click: every own unit of the same visual on screen; Shift adds', () => {
    // Visual 1 for every third unit.
    const table: VisualTable = [MESH_ONLY[0]!, MESH_ONLY[0]!];
    const { sel, cam, reader } = setup(100, 10, table, { visualOf: (i) => (i % 3 === 0 ? 1 : 0) });
    const pr = sel.project(cam, 1);
    const s = new Float64Array(4);
    let target = -1;
    for (let i = 0; i < 100; i++) {
      if (reader.unitVisual(i) === 1 && pr.onScreen(i)) {
        target = i;
        break;
      }
    }
    expect(target).toBeGreaterThanOrEqual(0);
    cam.project(reader.unitCur(target, 0), 0, reader.unitCur(target, 2), s);
    const n = sel.selectSameType(cam, 1, s[0]!, s[1]!, false);
    let exp = 0;
    for (let i = 0; i < reader.unitCount; i++) if (reader.unitVisual(i) === 1 && reader.unitArmy(i) === 0 && pr.onScreen(i)) exp++;
    expect(n).toBe(exp);
    expect(sel.count).toBe(exp);
    for (let k = 0; k < sel.count; k++) expect(reader.unitVisual(sel.indices[k]!)).toBe(1);
    // Off-screen units of the type stay unselected when the camera looks elsewhere.
    const cam2 = camera(12, [250, 250]);
    const pr2 = sel.project(cam2, 1);
    cam2.project(reader.unitCur(target, 0), 0, reader.unitCur(target, 2), s);
    let onScreen2 = 0;
    for (let i = 0; i < reader.unitCount; i++) if (reader.unitVisual(i) === 1 && reader.unitArmy(i) === 0 && pr2.onScreen(i)) onScreen2++;
    if (pr2.onScreen(target)) {
      expect(sel.selectSameType(cam2, 1, s[0]!, s[1]!, false)).toBe(onScreen2);
      expect(onScreen2).toBeLessThan(exp);
    }
    // No unit under the cursor: −1, selection unchanged.
    const before = sel.count;
    expect(sel.selectSameType(cam, 1, 3, 3, false)).toBe(-1);
    expect(sel.count).toBe(before);
    // selectVisual (console `select <bp>`): whole map.
    expect(sel.selectVisual(1)).toBe(34);
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
    // toggle() adds / removes and reports the state.
    expect(sel.toggle(hs[5]!)).toBe(true);
    expect(sel.toggle(hs[5]!)).toBe(false);
  });

  it('frame rebuild with 1,000 selected units does not allocate', () => {
    const link = new FakeSimLink({ units: 1000, enemyUnits: 20 });
    const r = new FrameReader();
    r.reset(link.frames.poll()!);
    const sel = new Selection(0);
    sel.onFrame(r);
    sel.selectAll();
    for (let i = 0; i < 2000; i++) sel.onFrame(r); // warm-up
    const gc = (globalThis as { gc?: () => void }).gc;
    gc?.();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 2000; i++) sel.onFrame(r);
    const perFrame = (process.memoryUsage().heapUsed - before) / 2000;
    expect(sel.count).toBe(1000);
    expect(perFrame).toBeLessThan(64);
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
