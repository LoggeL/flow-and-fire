import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRtsMap, expandPropFields, readRtsMap, MAP_MAX_PROPS, type ExpandedProp, type MapPropField } from '@faf/formats';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { polygonAreaWu, trianglesAreaWu } from '../../src/overlay/geometry.ts';
import { issuePosition, MarkerOverlay } from '../../src/overlay/overlay.ts';
import { SIZES, wuPerPixel } from '../../src/overlay/style.ts';
import type { ViewMarkers } from '../../src/overlay/types.ts';
import { projectWu } from '../../src/pick/picker.ts';
import { FakeView, field, markers, WU } from '../pick/support.ts';

const SIZE = 256;
const FIELDS: MapPropField[] = [
  field('grove', 'tree', { kind: 'circle', x: 60 * WU, z: 60 * WU, r: 30 * WU }),
  field('rocks', 'rock', {
    kind: 'polygon',
    points: [
      { x: 120 * WU, z: 40 * WU },
      { x: 200 * WU, z: 50 * WU },
      { x: 190 * WU, z: 120 * WU },
      { x: 150 * WU, z: 90 * WU },
      { x: 110 * WU, z: 110 * WU },
    ],
  }),
  field('wrecks', 'wreck', { kind: 'circle', x: 190 * WU, z: 190 * WU, r: 20 * WU }, { densityPerKWu2: 16 }),
];
const map = createRtsMap({
  sizeWu: SIZE,
  name: 'overlay',
  heights: (x, z) => 1280 + ((x * 13 + z * 7) % 64) * 8,
  propFields: FIELDS,
  props: [
    { id: 'core:rock_01', x: 10 * WU, z: 10 * WU, yaw: 0, scalePermille: 1000 },
    { id: 'core:rock_01', x: 12 * WU, z: 10 * WU, yaw: 0, scalePermille: 1000 },
  ],
});
const EXPANDED = expandPropFields(map);

function fullMarkers(over: Partial<ViewMarkers> = {}): ViewMarkers {
  return markers(SIZE, {
    starts: [
      { army: 0, x: 64 * WU, z: 192 * WU },
      { army: 1, x: 192 * WU, z: 64 * WU },
    ],
    spots: [
      { kind: 'mass', x: 70 * WU, z: 200 * WU },
      { kind: 'mass', x: 60 * WU, z: 200 * WU },
      { kind: 'hydro', x: 100 * WU, z: 180 * WU },
    ],
    fields: FIELDS,
    props: map.props,
    expanded: EXPANDED,
    issues: [
      { severity: 'error', code: 'spot-slope', message: 'Spot on a slope', x: 70 * WU, z: 200 * WU, refs: [{ type: 'spot', index: 0 }] },
      { severity: 'warning', code: 'start-distance', message: 'Starts too close', x: null, z: null, refs: [{ type: 'start', index: 1 }] },
      { severity: 'info', code: 'no-pos', message: 'Map-wide note', x: null, z: null, refs: [] },
    ],
    ...over,
  });
}

function setup(): { view: FakeView; overlay: MarkerOverlay } {
  const view = new FakeView(map);
  view.setPose({ targetX: 128, targetZ: 128, distance: 400, yaw: 0, pitch: (62 * Math.PI) / 180 });
  return { view, overlay: new MarkerOverlay(view) };
}

describe('MarkerOverlay', () => {
  it('builds every part once and reports the object counts', () => {
    const { view, overlay } = setup();
    expect(view.scene.children).toContain(overlay.root);
    overlay.update(fullMarkers());
    const s = overlay.stats();
    expect(EXPANDED.length).toBeGreaterThan(100);
    expect(s).toMatchObject({ starts: 2, spots: 3, fields: 3, expandedPoints: EXPANDED.length, explicitPoints: 2, issues: 2, handles: 0, highlights: 0 });
    expect(Object.values(overlay.buildCounts()).every((n) => n === 1)).toBe(true);
    expect(view.renders).toBeGreaterThan(0);
  });

  it('expanded props are ONE Points object (capped at MAP_MAX_PROPS), coloured by field kind', () => {
    const { overlay } = setup();
    overlay.update(fullMarkers());
    const pts: THREE.Points[] = [];
    overlay.partGroup('expanded').traverse((o) => {
      if (o instanceof THREE.Points) pts.push(o);
    });
    expect(pts).toHaveLength(1);
    const col = pts[0]!.geometry.getAttribute('pcolor');
    const kinds = new Set<string>();
    for (let i = 0; i < EXPANDED.length; i++) kinds.add(`${col.getX(i).toFixed(3)},${col.getY(i).toFixed(3)}`);
    expect(kinds.size).toBe(3);

    const many: ExpandedProp[] = [];
    const p0 = EXPANDED[0]!;
    for (let i = 0; i < MAP_MAX_PROPS + 5000; i++) many.push({ ...p0, x: (i % 250) * WU + WU, z: Math.floor(i / 300) * 2048 + WU });
    overlay.update(fullMarkers({ expanded: many }));
    expect(overlay.stats().expandedPoints).toBe(MAP_MAX_PROPS);
  });

  it('field fill area equals the field areas (±1 %)', () => {
    const { overlay } = setup();
    overlay.update(fullMarkers());
    let fill: THREE.Mesh | null = null;
    overlay.partGroup('fields').traverse((o) => {
      if (o instanceof THREE.Mesh && o.name === 'field-fill') fill = o;
    });
    expect(fill).not.toBeNull();
    const pos = (fill as unknown as THREE.Mesh).geometry.getAttribute('position');
    const xz = new Float64Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      xz[i * 2] = pos.getX(i);
      xz[i * 2 + 1] = pos.getZ(i);
    }
    const poly = FIELDS[1]!.shape;
    if (poly.kind !== 'polygon') throw new Error('expected polygon');
    const expected = Math.PI * 30 * 30 + polygonAreaWu(poly.points.flatMap((p) => [p.x / WU, p.z / WU])) + Math.PI * 20 * 20;
    expect(Math.abs(trianglesAreaWu(xz) - expected) / expected).toBeLessThan(0.01);
    expect(overlay.stats().fillTriangles).toBe(pos.count / 3);
    // Draped: every vertex lies on the terrain (+ fill lift).
    // (Float32 x/z can cross a 1/256 WU height cell of sampleHeightRaw: tolerance one step.)
    const probe = new FakeView(map);
    for (let i = 0; i < pos.count; i += 97) expect(Math.abs(pos.getY(i) - probe.heightWuAt(pos.getX(i), pos.getZ(i)) - SIZES.fillLiftWu)).toBeLessThan(0.05);
  });

  it('update() rebuilds nothing when the arrays are unchanged', () => {
    const { view, overlay } = setup();
    const m = fullMarkers();
    overlay.update(m);
    const before = overlay.buildCounts();
    const renders = view.renders;
    overlay.update(m);
    overlay.update({ ...m }); // new object, same arrays
    expect(overlay.buildCounts()).toEqual(before);
    expect(view.renders).toBe(renders);
  });

  it('update() rebuilds only the parts whose inputs changed', () => {
    const { view, overlay } = setup();
    const m = fullMarkers();
    overlay.update(m);
    const diff = (next: ViewMarkers): Record<string, number> => {
      const a = overlay.buildCounts();
      overlay.update(next);
      const b = overlay.buildCounts();
      const out: Record<string, number> = {};
      for (const k of Object.keys(b) as (keyof typeof b)[]) if (b[k] !== a[k]) out[k] = b[k] - a[k];
      return out;
    };
    const sel = { ...m, selection: [{ type: 'start', index: 0 }] as const };
    expect(diff(sel)).toEqual({ highlight: 1 });
    const hov = { ...sel, hover: { type: 'spot', index: 2 } as const };
    expect(diff(hov)).toEqual({ highlight: 1 });
    const exp = { ...hov, expanded: EXPANDED.slice(0, 10) };
    expect(diff(exp)).toEqual({ expanded: 1 });
    const props = { ...exp, props: [] };
    expect(diff(props)).toEqual({ props: 1 });
    const sym = { ...props, symmetry: 'diagonal' as const };
    expect(diff(sym)).toEqual({ symmetry: 1 });
    const draft = { ...sym, draft: { kind: 'polygon' as const, points: [{ x: 10 * WU, z: 10 * WU }, { x: 30 * WU, z: 12 * WU }] } };
    expect(diff(draft)).toEqual({ draft: 1 });
    const issues = { ...draft, issues: [] };
    expect(diff(issues)).toEqual({ issues: 1 });
    const starts = { ...issues, starts: [...issues.starts] };
    expect(diff(starts)).toEqual({ starts: 1, issues: 1, highlight: 1 });
    const spots = { ...starts, spots: [...starts.spots] };
    expect(diff(spots)).toEqual({ spots: 1, issues: 1, highlight: 1 });
    const fields = { ...spots, fields: [...spots.fields] };
    expect(diff(fields)).toEqual({ fields: 1, expanded: 1, issues: 1, highlight: 1 });
    // A different map (new heights) re-drapes everything.
    view.setMap(createRtsMap({ sizeWu: SIZE, heights: () => 2000 }));
    const all = diff(fields);
    expect(Object.keys(all)).toHaveLength(9);
    expect(Object.values(all).every((n) => n === 1)).toBe(true);
    expect(Object.keys(diff(fields))).toHaveLength(0);
  });

  it('highlights and field handles follow selection and hover', () => {
    const { overlay } = setup();
    const m = fullMarkers();
    overlay.update({ ...m, selection: [{ type: 'field', index: 1 }], hover: { type: 'start', index: 0 } });
    // Polygon with 5 vertices → 5 handles; hover ring on start 0; selection outline.
    expect(overlay.stats().handles).toBe(5);
    expect(overlay.stats().highlights).toBe(2);
    overlay.update({ ...m, selection: [{ type: 'fieldRadius', index: 0 }, { type: 'spot', index: 1 }] });
    // Circle → one radius handle; ring on spot 1 + outline of field 0.
    expect(overlay.stats().handles).toBe(1);
    expect(overlay.stats().highlights).toBe(2);
    overlay.update({ ...m, selection: [] });
    expect(overlay.stats()).toMatchObject({ handles: 0, highlights: 0 });
  });

  it('keeps a minimum marker size in pixels and 1:1 size up close', () => {
    const { view, overlay } = setup();
    overlay.update(fullMarkers());
    const spot = overlay.partGroup('spots').getObjectByName('spot-0')!;
    const start = overlay.partGroup('starts').getObjectByName('start-0')!;
    const radiusPx = (obj: THREE.Object3D, baseWu: number): number => {
      const d = view.camera.position.distanceTo(obj.position);
      return (baseWu * (obj.scale.x / baseWu)) / wuPerPixel(d, view.camera.fov, view.rect.height);
    };
    // Setons-like overview: 1024 WU map fitted → ~1.6 WU per pixel.
    view.setPose({ targetX: 128, targetZ: 128, distance: 1400, yaw: 0, pitch: (62 * Math.PI) / 180 });
    view.frame();
    expect(radiusPx(spot, SIZES.mass.radiusWu)).toBeGreaterThanOrEqual(SIZES.mass.minPx - 1e-6);
    expect(radiusPx(start, SIZES.start.radiusWu)).toBeGreaterThanOrEqual(SIZES.start.minPx - 1e-6);
    // Projected check: the ring edge is >= minPx away from the centre on screen.
    const c = projectWu(view, spot.position.x, spot.position.y, spot.position.z)!;
    const e = projectWu(view, spot.position.x + spot.scale.x, spot.position.y, spot.position.z)!;
    expect(Math.hypot(e.x - c.x, e.y - c.y)).toBeGreaterThan(SIZES.mass.minPx * 0.95);
    // Close up: true world size.
    view.setPose({ targetX: 70, targetZ: 200, distance: 20, yaw: 0, pitch: (62 * Math.PI) / 180 });
    view.frame();
    expect(spot.scale.x).toBeCloseTo(SIZES.mass.radiusWu, 6);
    expect(start.scale.x).toBeCloseTo(SIZES.start.radiusWu, 6);
  });

  it('symmetry guide and draft outline', () => {
    const { overlay } = setup();
    overlay.update(fullMarkers({ symmetry: 'mirrorX' }));
    expect(overlay.partGroup('symmetry').getObjectByName('symmetry-mirrorX')).toBeDefined();
    overlay.update(fullMarkers({ symmetry: 'point' }));
    expect(overlay.partGroup('symmetry').getObjectByName('symmetry-center')).toBeDefined();
    overlay.update(fullMarkers({ draft: { kind: 'circle', points: [{ x: 100 * WU, z: 100 * WU }] } }));
    expect(overlay.partGroup('draft').getObjectByName('draft-outline')).toBeUndefined();
    overlay.update(fullMarkers({ draft: { kind: 'circle', points: [{ x: 100 * WU, z: 100 * WU }, { x: 110 * WU, z: 100 * WU }] } }));
    expect(overlay.partGroup('draft').getObjectByName('draft-outline')).toBeDefined();
  });

  it('setVisible toggles layers; dispose detaches and unsubscribes', () => {
    const { view, overlay } = setup();
    overlay.update(fullMarkers({ selection: [{ type: 'field', index: 1 }] }));
    overlay.setVisible('fields', false);
    expect(overlay.isVisible('fields')).toBe(false);
    const handles = overlay.partGroup('highlight').children.filter((o) => o.userData['handle'] === true);
    expect(handles.length).toBe(5);
    expect(handles.every((h) => !h.visible)).toBe(true);
    overlay.setVisible('fields', true);
    expect(handles.every((h) => h.visible)).toBe(true);
    overlay.setVisible('props', false);
    expect(overlay.root.getObjectByName('overlay-props')!.visible).toBe(false);
    expect(view.listeners).toBe(1);
    overlay.dispose();
    expect(view.scene.children).not.toContain(overlay.root);
    expect(view.listeners).toBe(0);
    overlay.update(fullMarkers()); // no-op after dispose
  });
});

describe('issuePosition', () => {
  const m = fullMarkers();
  it('uses the own position, else the first positioned ref', () => {
    expect(issuePosition(m.issues[0]!, m)).toEqual({ x: 70 * WU, z: 200 * WU });
    expect(issuePosition(m.issues[1]!, m)).toEqual({ x: 192 * WU, z: 64 * WU });
    expect(issuePosition(m.issues[2]!, m)).toBeNull();
    const ref = (r: ViewMarkers['issues'][number]['refs'][number]) => issuePosition({ ...m.issues[2]!, refs: [r] }, m);
    expect(ref({ type: 'field', index: 0 })).toEqual({ x: 60 * WU, z: 60 * WU });
    expect(ref({ type: 'fieldRadius', index: 0 })).toEqual({ x: 90 * WU, z: 60 * WU });
    expect(ref({ type: 'fieldVertex', index: 1, vertex: 2 })).toEqual({ x: 190 * WU, z: 120 * WU });
    expect(ref({ type: 'field', index: 1 })).toEqual({ x: 155 * WU, z: 80 * WU });
    expect(ref({ type: 'spot', index: 99 })).toBeNull();
  });
});

describe('MarkerOverlay on setons (timing, lokal gemessen)', () => {
  it('full build and selection-only update', () => {
    const mapsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../content/maps');
    const setons = readRtsMap(new Uint8Array(readFileSync(resolve(mapsDir, 'setons.rtsmap'))));
    const S = setons.meta.sizeWu;
    const fields = [
      field('big', 'tree', { kind: 'circle', x: (S / 2) * WU, z: (S / 2) * WU, r: (S / 4) * WU }, { densityPerKWu2: 256 }),
      field('rocks', 'rock', { kind: 'circle', x: (S / 4) * WU, z: (S / 4) * WU, r: (S / 8) * WU }),
    ];
    const expanded = expandPropFields({ ...setons, propFields: fields });
    const view = new FakeView(setons);
    view.setPose({ targetX: S / 2, targetZ: S / 2, distance: 1384, yaw: 0, pitch: (62 * Math.PI) / 180 });
    const overlay = new MarkerOverlay(view);
    const m = markers(S, { starts: setons.meta.starts, spots: setons.meta.spots, props: setons.props, fields, expanded });
    const t0 = performance.now();
    overlay.update(m);
    const tFull = performance.now() - t0;
    const t1 = performance.now();
    overlay.update({ ...m, selection: [{ type: 'field', index: 0 }] });
    const tSel = performance.now() - t1;
    const t2 = performance.now();
    view.frame();
    const tFrame = performance.now() - t2;
    const s = overlay.stats();
    console.info(
      `[overlay] setons: full update ${tFull.toFixed(1)} ms (${s.expandedPoints} props, ${s.fillTriangles} fill tris, ${s.spots} spots), selection ${tSel.toFixed(2)} ms, per-frame scaling ${tFrame.toFixed(2)} ms (Node, lokal gemessen)`,
    );
    expect(s.expandedPoints).toBe(expanded.length);
    expect(s.spots).toBe(setons.meta.spots.length);
    overlay.dispose();
  });
});
