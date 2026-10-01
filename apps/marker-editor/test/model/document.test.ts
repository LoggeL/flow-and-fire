import { createRtsMap, FormatError, mapSimHash, readRtsMap, writeRtsMap } from '@faf/formats';
import { describe, expect, it } from 'vitest';
import { EditorDocument, sameRef } from '../../src/model/document.ts';
import { applyOp } from '../../src/model/ops.ts';
import { bytesEqual, circle, field, MAP_NAMES, MAP_SIM_HASH, mapBytes, openDoc, rect, WU } from './support.ts';

describe('EditorDocument load -> export', () => {
  for (const name of MAP_NAMES) {
    it(`${name}: fromBytes(b).toBytes() is byte-identical, hash unchanged, no PFLD`, () => {
      const b = mapBytes(name);
      const doc = EditorDocument.fromBytes(b);
      const out = doc.toBytes();
      expect(bytesEqual(out, b)).toBe(true);
      expect(mapSimHash(doc.toRtsMap()) >>> 0).toBe(MAP_SIM_HASH[name]);
      expect('propFields' in doc.toRtsMap()).toBe(false);
      expect(doc.hasFieldChunk).toBe(false);
      // A second generation is still identical.
      expect(bytesEqual(EditorDocument.fromBytes(out).toBytes(), b)).toBe(true);
    });
  }

  it('passes heights, splat, preview, props, light, strata and unknown chunks through by reference', () => {
    const src = readRtsMap(mapBytes('tessera'));
    const doc = EditorDocument.fromMap(src);
    const moved = applyOp(doc, { kind: 'moveMarkers', refs: [{ type: 'spot', index: 0 }], dx: WU, dz: 0 }).doc;
    const m = moved.toRtsMap();
    expect(m.heights).toBe(src.heights);
    expect(m.splat).toBe(src.splat);
    expect(m.preview).toBe(src.preview);
    expect(m.props).toBe(src.props);
    expect(m.meta.light).toBe(src.meta.light);
    expect(m.meta.strata).toBe(src.meta.strata);
    expect(m.unknownChunks).toBe(src.unknownChunks);
    expect(m.meta.spots[0]!.x).toBe(src.meta.spots[0]!.x + WU);
  });

  it('keeps unknown chunks at their position', () => {
    const map = createRtsMap({
      sizeWu: 64,
      unknownChunks: [
        { id: 'XTRA', data: new Uint8Array([1, 2, 3]), after: 'HGT ' },
        { id: 'ZEND', data: new Uint8Array([9]), after: 'PROP' },
      ],
    });
    const b = writeRtsMap(map);
    const doc = EditorDocument.fromBytes(b);
    const withField = applyOp(doc, { kind: 'addField', field: field(circle(32, 32, 8)) }).doc;
    const back = readRtsMap(withField.toBytes());
    expect(back.unknownChunks.map((u) => u.id)).toEqual(['XTRA', 'ZEND']);
    expect(back.propFields?.length).toBe(1);
    const undone = applyOp(withField, { kind: 'deleteMarkers', refs: [{ type: 'field', index: 0 }] }).doc;
    expect(bytesEqual(undone.toBytes(), b)).toBe(true);
  });

  it('propFields: absent until a field exists, absent again when the only (session) field is deleted', () => {
    const doc = openDoc('hollow-ridge');
    const a = applyOp(doc, { kind: 'addField', field: field(rect(200, 200, 240, 230)) }).doc;
    expect(a.hasFieldChunk).toBe(true);
    expect(a.toRtsMap().propFields).toHaveLength(1);
    const b = applyOp(a, { kind: 'deleteMarkers', refs: [{ type: 'field', index: 0 }] }).doc;
    expect(b.hasFieldChunk).toBe(false);
    expect('propFields' in b.toRtsMap()).toBe(false);
    expect(bytesEqual(b.toBytes(), mapBytes('hollow-ridge'))).toBe(true);
  });

  it('propFields: a file with PFLD keeps an empty array after deleting its last field', () => {
    const src = readRtsMap(mapBytes('hollow-ridge'));
    const withPfld = writeRtsMap({ ...src, propFields: [field(circle(250, 250, 10))] });
    const doc = EditorDocument.fromBytes(withPfld);
    expect(doc.fieldChunkInSource).toBe(true);
    const del = applyOp(doc, { kind: 'deleteMarkers', refs: [{ type: 'field', index: 0 }] }).doc;
    expect(del.toRtsMap().propFields).toEqual([]);
    const back = readRtsMap(del.toBytes());
    expect(back.propFields).toEqual([]);
    // Empty PFLD does not change the sim identity.
    expect(mapSimHash(back) >>> 0).toBe(MAP_SIM_HASH['hollow-ridge']);
    // A file with an empty PFLD chunk round-trips too.
    const emptyPfld = writeRtsMap({ ...src, propFields: [] });
    expect(bytesEqual(EditorDocument.fromBytes(emptyPfld).toBytes(), emptyPfld)).toBe(true);
  });

  it('rejects broken files with FormatError', () => {
    const b = mapBytes('hollow-ridge');
    b[20] = (b[20]! + 1) & 0xff;
    expect(() => EditorDocument.fromBytes(b)).toThrow(FormatError);
  });

  it('has / positionOf / freeArmy', () => {
    const doc = applyOp(openDoc('hollow-ridge'), { kind: 'batch', ops: [
      { kind: 'addField', field: field(circle(250, 250, 10)) },
      { kind: 'addField', field: field(rect(200, 300, 240, 330)) },
    ] }).doc;
    expect(doc.has({ type: 'start', index: 1 })).toBe(true);
    expect(doc.has({ type: 'start', index: 2 })).toBe(false);
    expect(doc.has({ type: 'fieldRadius', index: 0 })).toBe(true);
    expect(doc.has({ type: 'fieldRadius', index: 1 })).toBe(false);
    expect(doc.has({ type: 'fieldVertex', index: 1, vertex: 3 })).toBe(true);
    expect(doc.has({ type: 'fieldVertex', index: 1, vertex: 4 })).toBe(false);
    expect(doc.has({ type: 'fieldVertex', index: 0, vertex: 0 })).toBe(false);
    expect(doc.positionOf({ type: 'field', index: 0 })).toEqual({ x: 250 * WU, z: 250 * WU });
    expect(doc.positionOf({ type: 'fieldRadius', index: 0 })).toEqual({ x: 260 * WU, z: 250 * WU });
    expect(doc.positionOf({ type: 'fieldVertex', index: 1, vertex: 2 })).toEqual({ x: 240 * WU, z: 330 * WU });
    expect(doc.freeArmy()).toBe(2);
    expect(sameRef({ type: 'fieldVertex', index: 1, vertex: 2 }, { type: 'fieldVertex', index: 1, vertex: 2 })).toBe(true);
    expect(sameRef({ type: 'fieldVertex', index: 1, vertex: 2 }, { type: 'fieldVertex', index: 1, vertex: 1 })).toBe(false);
    expect(sameRef({ type: 'field', index: 1 }, { type: 'fieldRadius', index: 1 })).toBe(false);
  });
});
