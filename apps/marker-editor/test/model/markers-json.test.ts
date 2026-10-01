/**
 * markers.json export against the real CLI import (packages/formats/scripts/mapc.ts, allowed in
 * tests): exported markers + the original map sources compile back to the same map.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeRtsMap, type MapSpot, type RtsMap } from '@faf/formats';
import { describe, expect, it } from 'vitest';
import { compileMap, mapSourceFiles } from '../../../../packages/formats/scripts/mapc.ts';
import { readHeightmap } from '../../../../packages/formats/scripts/heightmap-io.ts';
import { applyOp } from '../../src/model/ops.ts';
import { markersObject, toMarkersJson } from '../../src/model/markers-json.ts';
import type { EditorDocument } from '../../src/model/document.ts';
import { bytesEqual, circle, field, MAP_NAMES, mapBytes, openDoc, REPO_ROOT, WU, type MapName } from './support.ts';

function compileWith(name: MapName, json: string, preview: boolean): RtsMap {
  const src = mapSourceFiles(resolve(REPO_ROOT, 'content/maps/src', name));
  return compileMap({
    heightmap: readHeightmap(src.heightmap),
    markers: JSON.parse(json) as unknown,
    splatPngs: src.splat.map((f) => new Uint8Array(readFileSync(f))),
    preview,
    source: `${name}/markers.json (editor export)`,
  });
}

/** mapc lists all mass spots before all hydro spots (markers.json has no interleaved order). */
function massFirst(spots: readonly MapSpot[]): MapSpot[] {
  return [...spots.filter((s) => s.kind === 'mass'), ...spots.filter((s) => s.kind === 'hydro')];
}

describe('markers.json export', () => {
  for (const name of MAP_NAMES) {
    it(`${name}: export of the unchanged map + map sources compiles to the byte-identical .rtsmap`, () => {
      const doc = openDoc(name);
      const out = writeRtsMap(compileWith(name, toMarkersJson(doc), true));
      expect(bytesEqual(out, mapBytes(name))).toBe(true);
    });
  }

  it('format: 2-space JSON with newline, WU decimals, key order of the checked-in sources', () => {
    const doc = openDoc('hollow-ridge');
    const text = toMarkersJson(doc);
    expect(text.endsWith('}\n')).toBe(true);
    const o = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(o)).toEqual(['version', 'name', 'sizeWu', 'heightScaleRaw', 'waterLevel', 'starts', 'mass', 'hydro', 'props', 'light', 'strata']);
    expect(o['starts']).toEqual([
      { army: 0, x: 96, z: 96 },
      { army: 1, x: 416, z: 416 },
    ]);
    const src = JSON.parse(readFileSync(resolve(REPO_ROOT, 'content/maps/src/hollow-ridge/markers.json'), 'utf8')) as Record<string, unknown>;
    for (const k of ['name', 'sizeWu', 'heightScaleRaw', 'waterLevel', 'starts', 'mass', 'hydro', 'light', 'strata']) expect(o[k]).toEqual(src[k]);
  });

  it('hollow-ridge edited (start, spots, 2 fields, odd raw values): compile gives the same starts/spots/props/propFields', () => {
    let doc: EditorDocument = openDoc('hollow-ridge');
    doc = applyOp(doc, {
      kind: 'batch',
      ops: [
        { kind: 'addStart', start: { army: 2, x: 250 * WU + 1, z: 180 * WU + 4095 } },
        { kind: 'addSpot', spot: { kind: 'mass', x: 160 * WU + 3, z: 200 * WU + 2048 } },
        { kind: 'addSpot', spot: { kind: 'hydro', x: 320 * WU, z: 256 * WU + 17 } },
        { kind: 'moveMarkers', refs: [{ type: 'spot', index: 0 }], dx: 511, dz: -3 },
        {
          kind: 'addField',
          field: field(circle(200, 260, 20), { name: 'Wald Nord', seed: 0xfedcba98, scaleMinPermille: 777, scaleMaxPermille: 1333, maxSlopePermille: 451, reclaimEnergyMilli: 25001 }),
        },
        {
          kind: 'addField',
          field: field(
            { kind: 'polygon', points: [{ x: 300 * WU + 1, z: 100 * WU }, { x: 340 * WU, z: 100 * WU + 7 }, { x: 330 * WU, z: 140 * WU }, { x: 305 * WU - 99, z: 131 * WU }] },
            { name: 'Felsen', kind: 'rock', entries: [{ id: 'core:rock_01', weight: 3 }, { id: 'core:rock_02', weight: 65535 }], dryOnly: false, reclaimMassMilli: 4294967295, reclaimEnergyMilli: 1, maxSlopePermille: 0 },
          ),
        },
      ],
    }).doc;
    const map = doc.toRtsMap();
    const back = compileWith('hollow-ridge', toMarkersJson(doc), false);
    expect(back.meta.starts).toEqual(map.meta.starts);
    expect(back.meta.spots).toEqual(massFirst(map.meta.spots));
    expect(back.props).toEqual(map.props);
    expect(back.propFields).toEqual(map.propFields);
    expect(back.meta.light).toEqual(map.meta.light);
    expect(back.meta.strata).toEqual(map.meta.strata);
    expect(back.meta.waterLevelRaw).toBe(map.meta.waterLevelRaw);
    expect(markersObject(map)['propFields']).toHaveLength(2);
  });

  it('props with yaw / scale and an empty PFLD chunk survive', () => {
    const src = openDoc('tessera').toRtsMap();
    const props = src.props.map((p, i) => ({ ...p, yaw: (i * 7919) & 0xffff, scalePermille: 1 + ((i * 331) % 65535) }));
    const map: RtsMap = { ...src, props, propFields: [] };
    const o = markersObject(map);
    expect(o['propFields']).toEqual([]);
    const back = compileMap({
      heightmap: readHeightmap(mapSourceFiles(resolve(REPO_ROOT, 'content/maps/src/tessera')).heightmap),
      markers: JSON.parse(JSON.stringify(o)) as unknown,
    });
    expect(back.props).toEqual(props);
    expect(back.propFields).toEqual([]);
  });
});
