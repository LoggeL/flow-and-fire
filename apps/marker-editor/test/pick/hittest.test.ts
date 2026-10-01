import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRtsMap, readRtsMap, type MapPropField } from '@faf/formats';
import { describe, expect, it } from 'vitest';
import type { MarkerRef, ViewMarkers } from '../../src/overlay/types.ts';
import { hitTestMarkers, TerrainPicker, worldToClient } from '../../src/pick/picker.ts';
import { FakeView, field, markers, prng, WU } from './support.ts';

const SIZE = 256;
const map = createRtsMap({ sizeWu: SIZE, name: 'hit', heights: () => 1280 });
const P: MapPropField = field('P', 'rock', {
  kind: 'polygon',
  points: [
    { x: 40 * WU, z: 40 * WU },
    { x: 90 * WU, z: 40 * WU },
    { x: 90 * WU, z: 80 * WU },
    { x: 40 * WU, z: 80 * WU },
  ],
});
const BIG = field('big', 'tree', { kind: 'circle', x: 180 * WU, z: 180 * WU, r: 40 * WU });
const SMALL = field('small', 'wreck', { kind: 'circle', x: 185 * WU, z: 185 * WU, r: 10 * WU });

const base: ViewMarkers = markers(SIZE, {
  starts: [
    { army: 0, x: 100 * WU, z: 100 * WU },
    { army: 1, x: 160 * WU, z: 100 * WU },
  ],
  spots: [
    { kind: 'mass', x: 100 * WU, z: 103 * WU },
    { kind: 'mass', x: 130 * WU, z: 150 * WU },
    { kind: 'hydro', x: 70 * WU, z: 150 * WU },
    { kind: 'mass', x: 40 * WU, z: 40 * WU },
  ],
  fields: [P, BIG, SMALL],
});

function nearView(): FakeView {
  const v = new FakeView(map);
  v.setPose({ targetX: 128, targetZ: 128, distance: 260, yaw: 0, pitch: (89 * Math.PI) / 180 });
  return v;
}

function farView(): FakeView {
  const v = new FakeView(map);
  v.setPose({ targetX: 128, targetZ: 128, distance: 600, yaw: 0, pitch: (89 * Math.PI) / 180 });
  return v;
}

function at(view: FakeView, xWu: number, zWu: number): { x: number; y: number } {
  const p = worldToClient(view, xWu * WU, zWu * WU);
  expect(p).not.toBeNull();
  return p!;
}

function hit(view: FakeView, m: ViewMarkers, xWu: number, zWu: number, dxPx = 0, radiusPx?: number): MarkerRef | null {
  const p = at(view, xWu, zWu);
  return radiusPx === undefined ? hitTestMarkers(view, m, p.x + dxPx, p.y) : hitTestMarkers(view, m, p.x + dxPx, p.y, radiusPx);
}

describe('hitTestMarkers', () => {
  it('finds starts, spots and fields', () => {
    const v = nearView();
    expect(hit(v, base, 160, 100)).toEqual({ type: 'start', index: 1 });
    expect(hit(v, base, 130, 150)).toEqual({ type: 'spot', index: 1 });
    expect(hit(v, base, 70, 150)).toEqual({ type: 'spot', index: 2 });
    expect(hit(v, base, 60, 60)).toEqual({ type: 'field', index: 0 });
    expect(hit(v, base, 210, 180)).toEqual({ type: 'field', index: 1 });
    expect(hit(v, base, 20, 220)).toBeNull();
  });

  it('prefers the smallest containing field', () => {
    const v = nearView();
    expect(hit(v, base, 187, 187)).toEqual({ type: 'field', index: 2 });
    expect(hit(v, base, 165, 165)).toEqual({ type: 'field', index: 1 });
  });

  it('start beats an overlapping spot', () => {
    const v = nearView();
    // Mass spot 0 sits 3 WU from start 0: the cursor on the spot still selects the start.
    expect(hit(v, base, 100, 103)).toEqual({ type: 'start', index: 0 });
  });

  it('handles only for selected fields; handles beat starts and spots', () => {
    const v = nearView();
    // Unselected polygon: its vertex (40, 40) carries mass spot 3 → spot.
    expect(hit(v, base, 40, 40)).toEqual({ type: 'spot', index: 3 });
    const sel = { ...base, selection: [{ type: 'field', index: 0 }] as const };
    expect(hit(v, sel, 40, 40)).toEqual({ type: 'fieldVertex', index: 0, vertex: 0 });
    expect(hit(v, sel, 90, 80)).toEqual({ type: 'fieldVertex', index: 0, vertex: 2 });
    // A selected vertex (not the whole field) also shows the handles.
    const vsel = { ...base, selection: [{ type: 'fieldVertex', index: 0, vertex: 1 }] as const };
    expect(hit(v, vsel, 90, 40)).toEqual({ type: 'fieldVertex', index: 0, vertex: 1 });
    // Circle: radius handle at (x + r, z).
    const csel = { ...base, selection: [{ type: 'field', index: 1 }] as const };
    expect(hit(v, csel, 220, 180)).toEqual({ type: 'fieldRadius', index: 1 });
    expect(hit(v, base, 220, 180)).toEqual({ type: 'field', index: 1 });
    // A start on a handle: the handle wins.
    const onHandle = { ...sel, starts: [...base.starts, { army: 2, x: 90 * WU, z: 40 * WU }] };
    expect(hit(v, onHandle, 90, 40)).toEqual({ type: 'fieldVertex', index: 0, vertex: 1 });
    expect(hit(v, { ...onHandle, selection: [] }, 90, 40)).toEqual({ type: 'start', index: 2 });
  });

  it('respects the pixel radius for small markers', () => {
    const v = farView();
    // Far away the mass spot is drawn with its minimum radius (7 px) < 12 px default radius.
    expect(hit(v, base, 130, 150, 11)).toEqual({ type: 'spot', index: 1 });
    expect(hit(v, base, 130, 150, 13)).toBeNull();
    expect(hit(v, base, 130, 150, 18, 20)).toEqual({ type: 'spot', index: 1 });
    expect(hit(v, base, 130, 150, 21, 20)).toBeNull();
  });

  it('uses the drawn radius when a marker is larger than the pick radius', () => {
    const v = new FakeView(map);
    v.setPose({ targetX: 160, targetZ: 100, distance: 60, yaw: 0, pitch: (89 * Math.PI) / 180 });
    // Start ring radius 4 WU ≈ 4 / (2·60·tan 22.5° / 720) ≈ 58 px here.
    expect(hit(v, base, 160, 100, 40)).toEqual({ type: 'start', index: 1 });
    expect(hit(v, base, 160, 100, 70)).toBeNull();
  });

  it('picks the nearest marker of a class', () => {
    const v = farView();
    const close = { ...base, spots: [{ kind: 'mass' as const, x: 120 * WU, z: 200 * WU }, { kind: 'mass' as const, x: 122 * WU, z: 200 * WU }] };
    const a = at(v, 120, 200);
    const b = at(v, 122, 200);
    expect(hitTestMarkers(v, close, a.x + (b.x - a.x) * 0.3, a.y)).toEqual({ type: 'spot', index: 0 });
    expect(hitTestMarkers(v, close, a.x + (b.x - a.x) * 0.7, a.y)).toEqual({ type: 'spot', index: 1 });
  });
});

describe('picking on content maps (timing, lokal gemessen)', () => {
  const mapsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../content/maps');
  it('setons overview: every central pixel hits the terrain; time per pick', () => {
    const setons = readRtsMap(new Uint8Array(readFileSync(resolve(mapsDir, 'setons.rtsmap'))));
    const v = new FakeView(setons);
    const size = setons.meta.sizeWu;
    // TerrainView.fitCamera pose.
    v.setPose({ targetX: size / 2, targetZ: size / 2, distance: (size * 0.56) / Math.tan((22.5 * Math.PI) / 180), yaw: 0, pitch: (62 * Math.PI) / 180 });
    const picker = new TerrainPicker(v);
    picker.pick(v.rect.left + 640, v.rect.top + 360); // terrain bounds of the map (once per map)
    const rnd = prng(7);
    const n = 2000;
    let hits = 0;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      const p = picker.pick(v.rect.left + 440 + rnd() * 400, v.rect.top + 200 + rnd() * 320);
      if (p !== null) hits++;
    }
    const us = ((performance.now() - t0) * 1000) / n;
    console.info(`[picker] setons overview: ${n} picks, ${us.toFixed(1)} µs/pick (Node, lokal gemessen)`);
    expect(hits).toBe(n);
  });
});
