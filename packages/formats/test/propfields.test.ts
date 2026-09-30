import fc from 'fast-check';
import { xxHash32 } from '@faf/fixed';
import { landCellSlopeRaw } from '@faf/rules';
import { describe, expect, it } from 'vitest';
import {
  createRtsMap,
  decodePropFieldsChunk,
  encodePropFieldsChunk,
  encodeUtf8,
  expandPropField,
  expandPropFields,
  FormatError,
  mapSimBytes,
  mapSimHash,
  MAP_MAX_FIELD_CELLS,
  MAP_MAX_FIELD_DENSITY,
  MAP_MAX_FIELD_ENTRIES,
  MAP_MAX_FIELD_NAME_BYTES,
  MAP_MAX_FIELD_POINTS,
  MAP_MAX_PROP_FIELDS,
  PROPFIELD_ALGO_VERSION,
  PROPFIELD_ALGO_VERSIONS,
  propFieldAlgoOf,
  propFieldBounds,
  propFieldCellSlopeRaw,
  propFieldCellRaw,
  propFieldContains,
  propFieldsSimBytes,
  readContainer,
  readRtsMap,
  validatePropFields,
  writeContainer,
  writeRtsMap,
  type ExpandedProp,
  type MapPropField,
  type RtsMap,
} from '../src/index.ts';

const ONE = 4096;

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof FormatError) return e.code;
    throw e;
  }
  return 'no-error';
}

/** 1..64 UTF-8 bytes, no control characters, no lone surrogates. */
function validName(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f || (c >= 0xd800 && c <= 0xdfff)) return false;
  }
  return s.length > 0 && encodeUtf8(s).length <= MAP_MAX_FIELD_NAME_BYTES;
}

function hex(b: Uint8Array): string {
  return Buffer.from(b).toString('hex');
}

const forest: MapPropField = {
  name: 'Wald Nord',
  kind: 'tree',
  shape: { kind: 'circle', x: 128 * ONE, z: 96 * ONE, r: 40 * ONE },
  entries: [
    { id: 'core:tree_01', weight: 3 },
    { id: 'core:tree_02', weight: 1 },
  ],
  densityPerKWu2: 64,
  seed: 0xdeadbeef,
  scaleMinPermille: 800,
  scaleMaxPermille: 1250,
  maxSlopePermille: 0,
  dryOnly: false,
  reclaimMassMilli: 2500,
  reclaimEnergyMilli: 10_000,
};

const rocks: MapPropField = {
  name: 'Felsband ä',
  kind: 'rock',
  shape: {
    kind: 'polygon',
    points: [
      { x: 20 * ONE, z: 150 * ONE },
      { x: 110 * ONE, z: 160 * ONE },
      { x: 120 * ONE, z: 230 * ONE },
      { x: 60 * ONE, z: 200 * ONE + 17 },
    ],
  },
  entries: [{ id: 'core:rock_01', weight: 1 }],
  densityPerKWu2: 16,
  seed: 7,
  scaleMinPermille: 1000,
  scaleMaxPermille: 1000,
  maxSlopePermille: 400,
  dryOnly: true,
  reclaimMassMilli: 12_000,
  reclaimEnergyMilli: 0,
};

/** 256 WU map: gentle slope along x, a lake (below water) for z < 40 WU, a steep ridge at x 200..216 WU. */
function heightAt(x: number, z: number): number {
  if (z < 40) return 100;
  const base = 2000 + x * 4;
  if (x >= 200 && x <= 216) return base + (x - 200) * 400;
  return base;
}

function testMap(fields?: readonly MapPropField[]): RtsMap {
  return createRtsMap({
    sizeWu: 256,
    name: 'Feldtest',
    waterLevelRaw: 1000 * 32,
    heights: heightAt,
    props: [{ id: 'core:rock_01', x: 10 * ONE, z: 10 * ONE, yaw: 0, scalePermille: 1000 }],
    ...(fields === undefined ? {} : { propFields: fields }),
  });
}

function withField(patch: Partial<MapPropField>, base: MapPropField = forest): RtsMap {
  const m = testMap();
  return { ...m, propFields: [{ ...base, ...patch }] };
}

function expansionBytes(props: readonly ExpandedProp[]): Uint8Array {
  const parts: number[] = [];
  for (const p of props) {
    parts.push(...encodeUtf8(p.id), 0);
    const w = new DataView(new ArrayBuffer(28));
    w.setInt32(0, p.x, true);
    w.setInt32(4, p.z, true);
    w.setUint16(8, p.yaw, true);
    w.setUint16(10, p.scalePermille, true);
    w.setUint32(12, p.field, true);
    w.setUint32(16, p.reclaimMassMilli, true);
    w.setUint32(20, p.reclaimEnergyMilli, true);
    parts.push(...new Uint8Array(w.buffer));
  }
  return Uint8Array.from(parts);
}

/** Independent slope check (same definition as the module header, written out again). */
/** Slope (Fx raw per WU) of the cell containing (x, z), via the canonical @faf/rules definition. */
function cellSlopeRawAt(m: RtsMap, x: number, z: number): number {
  const size = m.meta.sizeWu;
  const hf = { sizeWu: size, dim: size + 1, heights: m.heights, heightScaleRaw: m.meta.heightScaleRaw };
  return landCellSlopeRaw(hf, Math.min(size - 1, x >> 12), Math.min(size - 1, z >> 12));
}

describe('PFLD codec', () => {
  it('round-trips circle and polygon fields', () => {
    const bytes = encodePropFieldsChunk([forest, rocks]);
    expect(bytes.length % 4).toBe(0);
    expect(decodePropFieldsChunk(bytes, 0)).toEqual({ algo: PROPFIELD_ALGO_VERSION, fields: [forest, rocks] });
    expect(decodePropFieldsChunk(encodePropFieldsChunk([]), 0)).toEqual({ algo: PROPFIELD_ALGO_VERSION, fields: [] });
  });

  it('matches the documented layout (golden hex)', () => {
    const small: MapPropField = {
      name: 'ab',
      kind: 'wreck',
      shape: { kind: 'circle', x: 0x10000, z: 0x20000, r: 0x3000 },
      entries: [{ id: 'core:w', weight: 5 }],
      densityPerKWu2: 2,
      seed: 0x01020304,
      scaleMinPermille: 900,
      scaleMaxPermille: 1100,
      maxSlopePermille: 250,
      dryOnly: true,
      reclaimMassMilli: 0x0a0b0c0d,
      reclaimEnergyMilli: 1,
    };
    const expected =
      '0100' + '0100' + // algoVersion 1, fieldCount 1
      '0200' + '6162' + // nameLen, 'ab' (already aligned)
      '02' + '00' + '0100' + // kind wreck, circle, flags dryOnly
      '04030201' + // seed
      '0200' + 'fa00' + '8403' + '4c04' + // density 2, maxSlope 250, scale 900..1100
      '0d0c0b0a' + '01000000' + // reclaim mass / energy
      '0100' + '0000' + // entryCount 1, pointCount 0
      '0600' + '636f72653a77' + // idLen 6, 'core:w' (8 bytes, aligned)
      '0500' + '0000' + // weight 5, reserved
      '00000100' + '00000200' + '00300000'; // circle x, z, r
    expect(hex(encodePropFieldsChunk([small]))).toBe(expected);
    // Sim bytes: same layout, nameLen 0 and no name.
    expect(hex(propFieldsSimBytes([small]))).toBe(expected.replace('0200' + '6162', '0000' + '0000'));
  });

  it('rejects malformed payloads with FormatError', () => {
    const good = encodePropFieldsChunk([forest]);
    const mut = (f: (b: Uint8Array, dv: DataView) => void): string => {
      const b = good.slice();
      f(b, new DataView(b.buffer));
      return codeOf(() => decodePropFieldsChunk(b, 0));
    };
    // name 'Wald Nord' = 9 bytes: fixed block at 4 + pad4(2 + 9) = 16.
    const q = 16;
    expect(mut(() => {})).toBe('no-error');
    expect(mut((b) => (b[4 + 2 + 9] = 1))).toBe('bad-padding');
    expect(mut((b) => (b[q] = 3))).toBe('bad-value'); // kind
    expect(mut((b) => (b[q + 1] = 2))).toBe('bad-value'); // shape kind
    expect(mut((_, dv) => dv.setUint16(q + 2, 2, true))).toBe('bad-reserved'); // flags
    expect(mut((_, dv) => dv.setUint16(q + 26, 1, true))).toBe('bad-value'); // circle with points
    expect(mut((_, dv) => dv.setUint16(q + 24, MAP_MAX_FIELD_ENTRIES + 1, true))).toBe('bad-value');
    expect(mut((_, dv) => dv.setUint16(2, MAP_MAX_PROP_FIELDS + 1, true))).toBe('bad-value');
    expect(mut((_, dv) => dv.setUint16(2, 2, true))).toBe('bad-length');
    // Unknown expansion algorithm versions are rejected (0 and the next, not yet defined one).
    expect(mut((_, dv) => dv.setUint16(0, 0, true))).toBe('bad-value');
    expect(mut((_, dv) => dv.setUint16(0, Math.max(...PROPFIELD_ALGO_VERSIONS) + 1, true))).toBe('bad-value');
    // entry 0: idLen at q + 28, 'core:tree_01' (12 B) → weight at q + 28 + 16, reserved + 2.
    expect(mut((_, dv) => dv.setUint16(q + 28 + 16 + 2, 1, true))).toBe('bad-reserved');
    expect(mut((b) => (b[q + 28 + 2] = 0xff))).toBe('bad-value'); // invalid UTF-8 id
    expect(codeOf(() => decodePropFieldsChunk(good.subarray(0, good.length - 4), 0))).toBe('bad-length');
    expect(codeOf(() => decodePropFieldsChunk(new Uint8Array([...good, 0, 0, 0, 0]), 0))).toBe('bad-length');
    expect(codeOf(() => decodePropFieldsChunk(new Uint8Array(2), 0))).toBe('bad-length');
    const poly = encodePropFieldsChunk([rocks]);
    expect(codeOf(() => decodePropFieldsChunk(poly.subarray(0, poly.length - 8), 0))).toBe('bad-length');
    const pc = poly.slice();
    // 'Felsband ä' = 11 bytes → fixed block at 4 + pad4(13) = 20; pointCount at +26.
    new DataView(pc.buffer).setUint16(20 + 26, MAP_MAX_FIELD_POINTS + 1, true);
    expect(codeOf(() => decodePropFieldsChunk(pc, 0))).toBe('bad-value');
  });

  it('write(read(write(m))) is byte-identical for random valid fields (property)', () => {
    const size = 64;
    const max = size * ONE;
    const idArb = fc.constantFrom('core:tree_01', 'core:rock_02', 'mod_x:wreck/big-1', 'a:b');
    const circleArb = fc.record({
      kind: fc.constant('circle' as const),
      x: fc.integer({ min: 0, max }),
      z: fc.integer({ min: 0, max }),
      r: fc.integer({ min: ONE, max }),
    });
    const polygonArb = fc
      .record({
        cx: fc.integer({ min: 16 * ONE, max: 48 * ONE }),
        cz: fc.integer({ min: 16 * ONE, max: 48 * ONE }),
        steps: fc.uniqueArray(fc.integer({ min: 0, max: 359 }), { minLength: 3, maxLength: 24 }),
        radii: fc.array(fc.integer({ min: 2 * ONE, max: 15 * ONE }), { minLength: 24, maxLength: 24 }),
      })
      .map(({ cx, cz, steps, radii }) => ({
        kind: 'polygon' as const,
        points: steps
          .slice()
          .sort((a, b) => a - b)
          .map((deg, i) => ({
            x: cx + Math.round(Math.cos((deg * Math.PI) / 180) * radii[i]!),
            z: cz + Math.round(Math.sin((deg * Math.PI) / 180) * radii[i]!),
          })),
      }));
    const fieldArb = fc
      .record({
        name: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => validName(s)),
        kind: fc.constantFrom('tree' as const, 'rock' as const, 'wreck' as const),
        shape: fc.oneof(circleArb, polygonArb),
        entries: fc.array(fc.record({ id: idArb, weight: fc.integer({ min: 1, max: 0xffff }) }), { minLength: 1, maxLength: MAP_MAX_FIELD_ENTRIES }),
        densityPerKWu2: fc.integer({ min: 1, max: 32 }),
        seed: fc.integer({ min: 0, max: 0xffffffff }),
        scale: fc.tuple(fc.integer({ min: 1, max: 0xffff }), fc.integer({ min: 1, max: 0xffff })),
        maxSlopePermille: fc.integer({ min: 0, max: 0xffff }),
        dryOnly: fc.boolean(),
        reclaimMassMilli: fc.integer({ min: 0, max: 0xffffffff }),
        reclaimEnergyMilli: fc.integer({ min: 0, max: 0xffffffff }),
      })
      .map(({ scale, ...f }): MapPropField => ({ ...f, scaleMinPermille: Math.min(...scale), scaleMaxPermille: Math.max(...scale) }));
    const base = createRtsMap({ sizeWu: size, heights: (x, z) => (x * 97 + z * 13) & 0xfff, waterLevelRaw: 40 * 32 * 10 });
    fc.assert(
      fc.property(fc.array(fieldArb, { maxLength: 6 }), (fields) => {
        const m: RtsMap = { ...base, propFields: fields };
        // Rounded star polygons can (rarely) degenerate; those are not valid inputs.
        fc.pre(codeOf(() => validatePropFields(m)) === 'no-error');
        const bytes = writeRtsMap(m);
        const back = readRtsMap(bytes);
        expect(back.propFields).toEqual(fields);
        expect(Buffer.from(writeRtsMap(back)).equals(Buffer.from(bytes))).toBe(true);
      }),
      { numRuns: 150, seed: 20260929 },
    );
  });
});

describe('PFLD in .rtsmap', () => {
  it('keeps propFields absent without the chunk and writes an empty chunk for []', () => {
    const absent = testMap();
    expect('propFields' in absent).toBe(false);
    const absentBytes = writeRtsMap(absent);
    expect(readContainer(absentBytes, 'RTSM').chunks.map((c) => c.id)).not.toContain('PFLD');
    expect('propFields' in readRtsMap(absentBytes)).toBe(false);

    const empty = testMap([]);
    const emptyBytes = writeRtsMap(empty);
    const chunks = readContainer(emptyBytes, 'RTSM').chunks;
    expect(chunks.map((c) => c.id)).toEqual(['META', 'HGT ', 'PROP', 'PFLD']);
    expect(hex(chunks[3]!.data)).toBe('01000000'); // algoVersion 1, 0 fields
    expect(readRtsMap(emptyBytes).propFields).toEqual([]);
    expect(readRtsMap(emptyBytes).propFieldAlgo).toBe(1);
    // No fields ⇒ identical sim bytes (the tail is only appended for a non-empty list).
    expect(hex(mapSimBytes(empty))).toBe(hex(mapSimBytes(absent)));
  });

  it('writes PFLD between PROP and PREV and round-trips byte-exactly', () => {
    const m: RtsMap = { ...testMap([forest, rocks]), preview: { width: 1, height: 1, rgba: new Uint8Array([1, 2, 3, 4]) } };
    const bytes = writeRtsMap(m);
    expect(readContainer(bytes, 'RTSM').chunks.map((c) => c.id)).toEqual(['META', 'HGT ', 'PROP', 'PFLD', 'PREV']);
    const back = readRtsMap(bytes);
    // The reader always records the stored algorithm version.
    expect(back).toEqual({ ...m, propFieldAlgo: PROPFIELD_ALGO_VERSION });
    expect(Buffer.from(writeRtsMap(back)).equals(Buffer.from(bytes))).toBe(true);
  });

  it('appends the fields to the sim bytes (tag, stored algo version, nameless layout)', () => {
    const plain = testMap();
    const m = testMap([forest]);
    const a = mapSimBytes(plain);
    const b = mapSimBytes(m);
    expect(hex(b.subarray(0, a.length))).toBe(hex(a));
    const tail = b.subarray(a.length);
    expect(String.fromCharCode(...tail.subarray(0, 4))).toBe('PFLD');
    expect(new DataView(tail.buffer, tail.byteOffset).getUint16(4, true)).toBe(PROPFIELD_ALGO_VERSION);
    expect(hex(tail.subarray(4))).toBe(hex(propFieldsSimBytes([forest])));
    // Absent version == the current one; the stored version is what enters the hash.
    expect(hex(mapSimBytes({ ...m, propFieldAlgo: PROPFIELD_ALGO_VERSION }))).toBe(hex(b));
  });

  it('stores the expansion algorithm version and rejects unknown ones', () => {
    const m = testMap([forest]);
    const next = Math.max(...PROPFIELD_ALGO_VERSIONS) + 1;
    expect(PROPFIELD_ALGO_VERSIONS).toContain(PROPFIELD_ALGO_VERSION);
    expect(propFieldAlgoOf({})).toBe(PROPFIELD_ALGO_VERSION);
    expect(propFieldAlgoOf({ propFieldAlgo: 1 })).toBe(1);
    expect(codeOf(() => propFieldAlgoOf({ propFieldAlgo: next }))).toBe('bad-value');
    expect(codeOf(() => writeRtsMap({ ...m, propFieldAlgo: next }))).toBe('bad-value');
    expect(codeOf(() => expandPropFields({ ...m, propFieldAlgo: next }))).toBe('bad-value');
    // Without fields the version is meaningless: no PFLD chunk, identical bytes and hash.
    expect(hex(writeRtsMap({ ...testMap(), propFieldAlgo: next }))).toBe(hex(writeRtsMap(testMap())));
    // A file with an unknown version is rejected by readRtsMap (not silently expanded with another algorithm).
    const bytes = writeRtsMap(m);
    const chunks = readContainer(bytes, 'RTSM').chunks.map((c) => ({ id: c.id, data: c.data.slice() }));
    const pfld = chunks.find((c) => c.id === 'PFLD')!;
    new DataView(pfld.data.buffer).setUint16(0, next, true);
    expect(codeOf(() => readRtsMap(writeContainer('RTSM', 1, chunks)))).toBe('bad-value');
  });

  it('mapSimHash ignores the field name but no other parameter', () => {
    const h = mapSimHash(testMap([forest, rocks]));
    expect(mapSimHash(testMap([{ ...forest, name: 'Ganz anders' }, rocks]))).toBe(h);
    expect(mapSimHash(testMap()) === h).toBe(false);
    const variants: MapPropField[][] = [
      [{ ...forest, kind: 'rock' }, rocks],
      [{ ...forest, shape: { kind: 'circle', x: 128 * ONE + 1, z: 96 * ONE, r: 40 * ONE } }, rocks],
      [{ ...forest, shape: { kind: 'circle', x: 128 * ONE, z: 96 * ONE, r: 40 * ONE - 1 } }, rocks],
      [{ ...forest, entries: [forest.entries[0]!] }, rocks],
      [{ ...forest, entries: [{ ...forest.entries[0]!, weight: 4 }, forest.entries[1]!] }, rocks],
      [{ ...forest, entries: [{ ...forest.entries[0]!, id: 'core:tree_03' }, forest.entries[1]!] }, rocks],
      [{ ...forest, densityPerKWu2: 65 }, rocks],
      [{ ...forest, seed: 1 }, rocks],
      [{ ...forest, scaleMinPermille: 801 }, rocks],
      [{ ...forest, scaleMaxPermille: 1251 }, rocks],
      [{ ...forest, maxSlopePermille: 1 }, rocks],
      [{ ...forest, dryOnly: true }, rocks],
      [{ ...forest, reclaimMassMilli: 2501 }, rocks],
      [{ ...forest, reclaimEnergyMilli: 10_001 }, rocks],
      [forest, { ...rocks, shape: { kind: 'polygon', points: [...(rocks.shape as { readonly points: readonly { x: number; z: number }[] }).points.slice(0, 3), { x: 60 * ONE, z: 200 * ONE }] } }],
      [rocks, forest],
      [forest],
    ];
    const seen = [h];
    for (const v of variants) {
      const hv = mapSimHash(testMap(v));
      expect(seen).not.toContain(hv);
      seen.push(hv);
    }
  });

  it('validates every field invariant with FormatError bad-value', () => {
    const bad = (patch: Partial<MapPropField>): string => codeOf(() => writeRtsMap(withField(patch)));
    const badPoly = (points: { x: number; z: number }[]): string => bad({ shape: { kind: 'polygon', points } });
    const max = 256 * ONE;
    expect(bad({})).toBe('no-error');
    expect(bad({ name: '' })).toBe('bad-value');
    expect(bad({ name: 'a\tb' })).toBe('bad-value');
    expect(bad({ name: 'x'.repeat(MAP_MAX_FIELD_NAME_BYTES + 1) })).toBe('bad-value');
    expect(bad({ name: 'ä'.repeat(33) })).toBe('bad-value'); // 66 UTF-8 bytes
    expect(bad({ name: 'x'.repeat(MAP_MAX_FIELD_NAME_BYTES) })).toBe('no-error');
    expect(bad({ kind: 'bush' as 'tree' })).toBe('bad-value');
    expect(bad({ shape: { kind: 'square' } as unknown as MapPropField['shape'] })).toBe('bad-value');
    expect(bad({ shape: { kind: 'circle', x: -1, z: 0, r: ONE } })).toBe('bad-value');
    expect(bad({ shape: { kind: 'circle', x: 0, z: max + 1, r: ONE } })).toBe('bad-value');
    expect(bad({ shape: { kind: 'circle', x: 0, z: 0, r: ONE - 1 } })).toBe('bad-value');
    expect(bad({ shape: { kind: 'circle', x: 0, z: 0, r: max + 1 } })).toBe('bad-value');
    expect(bad({ shape: { kind: 'circle', x: 5, z: 5, r: ONE + 0.5 } })).toBe('bad-value');
    expect(bad({ shape: { kind: 'circle', x: max, z: max, r: ONE } })).toBe('no-error');
    expect(badPoly([{ x: 0, z: 0 }, { x: ONE, z: 0 }])).toBe('bad-value'); // < 3 points
    expect(badPoly(Array.from({ length: MAP_MAX_FIELD_POINTS + 1 }, (_, i) => ({ x: i * ONE, z: (i * i) % 7 })))).toBe('bad-value');
    expect(badPoly([{ x: 0, z: 0 }, { x: 10 * ONE, z: 0 }, { x: 20 * ONE, z: 0 }])).toBe('bad-value'); // zero area
    expect(badPoly([{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 10 * ONE, z: 10 * ONE }])).toBe('bad-value'); // repeated point
    expect(badPoly([{ x: 0, z: 0 }, { x: 10 * ONE, z: 10 * ONE }, { x: 10 * ONE, z: 0 }, { x: 0, z: 10 * ONE }])).toBe('bad-value'); // bow tie
    expect(badPoly([{ x: 0, z: 0 }, { x: 10 * ONE, z: 0 }, { x: 5 * ONE, z: 0 }, { x: 5 * ONE, z: 5 * ONE }])).toBe('bad-value'); // fold-back
    expect(badPoly([{ x: 0, z: 0 }, { x: 10 * ONE, z: 0 }, { x: 10 * ONE, z: 10 * ONE }, { x: 5 * ONE, z: 0 }, { x: 0, z: 10 * ONE }])).toBe('bad-value'); // touches an edge
    expect(badPoly([{ x: 0, z: 0 }, { x: -1, z: 10 * ONE }, { x: 10 * ONE, z: 0 }])).toBe('bad-value');
    expect(badPoly([{ x: 0, z: 0 }, { x: 0.5, z: 10 * ONE }, { x: 10 * ONE, z: 0 }])).toBe('bad-value');
    expect(badPoly([{ x: 0, z: 0 }, { x: 10 * ONE, z: 0 }, { x: 10 * ONE, z: 10 * ONE }, { x: 0, z: 10 * ONE }])).toBe('no-error');
    expect(bad({ entries: [] })).toBe('bad-value');
    expect(bad({ entries: Array.from({ length: MAP_MAX_FIELD_ENTRIES + 1 }, () => ({ id: 'core:t', weight: 1 })) })).toBe('bad-value');
    expect(bad({ entries: [{ id: 'Tree', weight: 1 }] })).toBe('bad-value');
    expect(bad({ entries: [{ id: 'core:' + 'x'.repeat(124), weight: 1 }] })).toBe('bad-value');
    expect(bad({ entries: [{ id: 'core:t', weight: 0 }] })).toBe('bad-value');
    expect(bad({ entries: [{ id: 'core:t', weight: 65536 }] })).toBe('bad-value');
    expect(bad({ densityPerKWu2: 0 })).toBe('bad-value');
    expect(bad({ densityPerKWu2: MAP_MAX_FIELD_DENSITY + 1 })).toBe('bad-value');
    expect(bad({ densityPerKWu2: 1.5 })).toBe('bad-value');
    expect(bad({ seed: -1 })).toBe('bad-value');
    expect(bad({ seed: 2 ** 32 })).toBe('bad-value');
    expect(bad({ seed: 0xffffffff })).toBe('no-error');
    expect(bad({ scaleMinPermille: 0 })).toBe('bad-value');
    expect(bad({ scaleMinPermille: 1300 })).toBe('bad-value'); // > max
    expect(bad({ scaleMaxPermille: 65536 })).toBe('bad-value');
    expect(bad({ maxSlopePermille: -1 })).toBe('bad-value');
    expect(bad({ maxSlopePermille: 65536 })).toBe('bad-value');
    expect(bad({ dryOnly: 1 as unknown as boolean })).toBe('bad-value');
    expect(bad({ reclaimMassMilli: -1 })).toBe('bad-value');
    expect(bad({ reclaimEnergyMilli: 2 ** 32 })).toBe('bad-value');
    const many = testMap();
    expect(codeOf(() => writeRtsMap({ ...many, propFields: Array.from({ length: MAP_MAX_PROP_FIELDS + 1 }, () => forest) }))).toBe('bad-value');
    // The error names the chunk.
    try {
      writeRtsMap(withField({ seed: -1 }));
    } catch (e) {
      expect((e as FormatError).chunkId).toBe('PFLD');
    }
  });

  it('enforces the prop budget (PROP + expansion <= 65536) and the candidate cell bound', () => {
    const full = createRtsMap({ sizeWu: 1024 });
    const S = 1024 * ONE;
    const dense: MapPropField = { ...forest, shape: { kind: 'polygon', points: [{ x: 0, z: 0 }, { x: S, z: 0 }, { x: S, z: S }, { x: 0, z: S }] }, densityPerKWu2: 64 };
    // 1024² WU at 64 per 1024 WU² ≈ 65,536 candidates (one per 4 WU cell) → + PROP entries overflows.
    expect(codeOf(() => writeRtsMap({ ...full, propFields: [{ ...dense, densityPerKWu2: 70 }] }))).toBe('bad-value');
    expect(codeOf(() => writeRtsMap({ ...full, propFields: [{ ...dense, densityPerKWu2: 32 }, { ...dense, densityPerKWu2: 40 }] }))).toBe('bad-value');
    expect(codeOf(() => writeRtsMap({ ...full, propFields: [{ ...dense, densityPerKWu2: 60 }] }))).toBe('no-error');
    // Cell bound: 4096 per 1024 WU² over a large dry-only area under water produces 0 props but
    // would need millions of candidates.
    const huge = createRtsMap({ sizeWu: 1024, waterLevelRaw: 1000 });
    const cells = { ...dense, densityPerKWu2: MAP_MAX_FIELD_DENSITY, dryOnly: true };
    expect(codeOf(() => writeRtsMap({ ...huge, propFields: [cells] }))).toBe('bad-value');
    expect(codeOf(() => expandPropField({ ...huge, propFields: [cells] }, 0))).toBe('bad-value');
    expect(MAP_MAX_FIELD_CELLS).toBe(2 ** 21);
  });
});

describe('prop field geometry', () => {
  it('computes bounds and containment with integers', () => {
    expect(propFieldBounds(forest.shape)).toEqual({ x0: 88 * ONE, z0: 56 * ONE, x1: 168 * ONE, z1: 136 * ONE });
    expect(propFieldBounds(rocks.shape)).toEqual({ x0: 20 * ONE, z0: 150 * ONE, x1: 120 * ONE, z1: 230 * ONE });
    const c = forest.shape;
    expect(propFieldContains(c, 128 * ONE + 40 * ONE, 96 * ONE)).toBe(true); // on the rim
    expect(propFieldContains(c, 128 * ONE + 40 * ONE + 1, 96 * ONE)).toBe(false);
    const sq = { kind: 'polygon' as const, points: [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }] };
    expect(propFieldContains(sq, 5, 5)).toBe(true);
    expect(propFieldContains(sq, 11, 5)).toBe(false);
    expect(propFieldContains(sq, -1, 5)).toBe(false);
    expect(propFieldContains(sq, 5, 10)).toBe(false); // half-open: top edge excluded
    expect(propFieldContains(sq, 5, 0)).toBe(true);
    // Concave "U": the notch is outside.
    const u = { kind: 'polygon' as const, points: [{ x: 0, z: 0 }, { x: 30, z: 0 }, { x: 30, z: 30 }, { x: 20, z: 30 }, { x: 20, z: 10 }, { x: 10, z: 10 }, { x: 10, z: 30 }, { x: 0, z: 30 }] };
    expect(propFieldContains(u, 15, 20)).toBe(false);
    expect(propFieldContains(u, 5, 20)).toBe(true);
    expect(propFieldContains(u, 25, 20)).toBe(true);
    // Extreme coordinates (full 4096 WU map) stay exact.
    const big = { kind: 'circle' as const, x: 0, z: 0, r: 4096 * ONE };
    expect(propFieldContains(big, 4096 * ONE, 0)).toBe(true);
    expect(propFieldContains(big, 4096 * ONE, 1)).toBe(false);
  });

  it('derives the cell edge from the density (32 WU at 1, 0.5 WU at 4096)', () => {
    expect(propFieldCellRaw(1)).toBe(32 * ONE);
    expect(propFieldCellRaw(4)).toBe(16 * ONE);
    expect(propFieldCellRaw(MAP_MAX_FIELD_DENSITY)).toBe(ONE / 2);
    expect(propFieldCellRaw(3)).toBe(Math.floor(Math.sqrt(Math.floor(2 ** 34 / 3))));
  });
});

describe('prop field expansion', () => {
  const map = testMap([forest, rocks]);

  it('pins the expansion of a fixed example (golden xxHash32)', () => {
    const props = expandPropFields(map);
    expect(props.length).toBe(expandPropField(map, 0).length + expandPropField(map, 1).length);
    const b = expansionBytes(props);
    expect({ n: props.length, hash: xxHash32(b, 0, b.length, 0) }).toEqual({ n: 380, hash: 0x1cedb935 });
    expect(props[0]).toEqual({
      id: props[0]!.id,
      x: props[0]!.x,
      z: props[0]!.z,
      yaw: props[0]!.yaw,
      scalePermille: props[0]!.scalePermille,
      field: 0,
      reclaimMassMilli: 2500,
      reclaimEnergyMilli: 10_000,
    });
  });

  it('places every prop inside its shape, on the map, with valid entries, yaw and scale', () => {
    const props = expandPropFields(map);
    for (const p of props) {
      const f = map.propFields![p.field]!;
      if (f.shape.kind === 'circle') {
        const dx = p.x - f.shape.x;
        const dz = p.z - f.shape.z;
        expect(dx * dx + dz * dz).toBeLessThanOrEqual(f.shape.r * f.shape.r);
      } else {
        // The rock polygon is convex and counter-clockwise: all edge cross products >= 0.
        const pts = f.shape.points;
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i]!;
          const b = pts[(i + 1) % pts.length]!;
          expect((b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x)).toBeGreaterThanOrEqual(0);
        }
      }
      expect(f.entries.map((e) => e.id)).toContain(p.id);
      expect(p.yaw).toBeGreaterThanOrEqual(0);
      expect(p.yaw).toBeLessThanOrEqual(0xffff);
      expect(p.scalePermille).toBeGreaterThanOrEqual(f.scaleMinPermille);
      expect(p.scalePermille).toBeLessThanOrEqual(f.scaleMaxPermille);
      expect(Number.isInteger(p.x) && Number.isInteger(p.z)).toBe(true);
      expect(p.x >= 0 && p.z >= 0 && p.x <= 256 * ONE && p.z <= 256 * ONE).toBe(true);
    }
  });

  it('produces ≈ density · area props (±15 %) and honours the entry weights', () => {
    for (const density of [1, 8, 64, 512]) {
      const f: MapPropField = { ...forest, shape: { kind: 'circle', x: 128 * ONE, z: 128 * ONE, r: 100 * ONE }, densityPerKWu2: density };
      const n = expandPropField(testMap([f]), 0).length;
      const expected = (Math.PI * 100 * 100 * density) / 1024;
      expect(Math.abs(n - expected) / expected, `density ${density}: ${n} vs ${expected.toFixed(0)}`).toBeLessThan(0.15);
    }
    const f: MapPropField = { ...forest, shape: { kind: 'circle', x: 128 * ONE, z: 128 * ONE, r: 100 * ONE }, densityPerKWu2: 64 };
    const props = expandPropField(testMap([f]), 0);
    const share = props.filter((p) => p.id === 'core:tree_01').length / props.length;
    expect(share).toBeGreaterThan(0.7);
    expect(share).toBeLessThan(0.8);
  });

  it('dryOnly drops props at or below the water level; maxSlope drops steep ones', () => {
    const lakeShore: MapPropField = { ...forest, shape: { kind: 'circle', x: 60 * ONE, z: 40 * ONE, r: 30 * ONE }, densityPerKWu2: 128 };
    const wet = expandPropField(testMap([lakeShore]), 0);
    const dry = expandPropField(testMap([{ ...lakeShore, dryOnly: true }]), 0);
    expect(dry.length).toBeGreaterThan(0);
    expect(dry.length).toBeLessThan(wet.length * 0.7);
    for (const p of dry) {
      const sx = (p.x + 2048) >> 12;
      const sz = (p.z + 2048) >> 12;
      expect(heightAt(sx, sz) * 32).toBeGreaterThan(1000 * 32);
    }
    // Without water on the map dryOnly changes nothing.
    const noWater = { ...testMap(), meta: { ...testMap().meta, waterLevelRaw: null } };
    expect(expandPropField({ ...noWater, propFields: [{ ...lakeShore, dryOnly: true }] }, 0)).toEqual(expandPropField({ ...noWater, propFields: [lakeShore] }, 0));

    const ridge: MapPropField = { ...forest, shape: { kind: 'circle', x: 208 * ONE, z: 128 * ONE, r: 30 * ONE }, densityPerKWu2: 128, maxSlopePermille: 500 };
    const m = testMap([ridge]);
    const all = expandPropField(testMap([{ ...ridge, maxSlopePermille: 0 }]), 0);
    const flat = expandPropField(m, 0);
    expect(flat.length).toBeGreaterThan(0);
    expect(flat.length).toBeLessThan(all.length * 0.8);
    for (const p of flat) expect(cellSlopeRawAt(m, p.x, p.z) * 1000).toBeLessThanOrEqual(500 * ONE);
    const dropped = all.filter((a) => !flat.some((b) => b.x === a.x && b.z === a.z));
    expect(dropped.length).toBeGreaterThan(0);
    for (const p of dropped) expect(cellSlopeRawAt(m, p.x, p.z) * 1000).toBeGreaterThan(500 * ONE);
  });

  it('uses the one land cell slope of @faf/rules (nav, marker editor and prop fields agree)', () => {
    const m = testMap();
    const hf = { sizeWu: 256, dim: 257, heights: m.heights, heightScaleRaw: m.meta.heightScaleRaw };
    for (const [x, z] of [[0, 0], [5, 39], [5, 40], [199, 100], [200, 100], [215, 100], [216, 100], [255, 255]] as const) {
      expect(propFieldCellSlopeRaw(m, x, z), `cell (${x}, ${z})`).toBe(landCellSlopeRaw(hf, x, z));
    }
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }), (x, z) => propFieldCellSlopeRaw(m, x, z) === landCellSlopeRaw(hf, x, z)),
      { numRuns: 500 },
    );
  });

  it('is stable: same output on every run, row-major cell order, independent of other fields', () => {
    const a = expandPropFields(map);
    const b = expandPropFields(readRtsMap(writeRtsMap(map)));
    expect(b).toEqual(a);
    const cell = propFieldCellRaw(forest.densityPerKWu2);
    const f0 = a.filter((p) => p.field === 0);
    for (let i = 1; i < f0.length; i++) {
      const pz = Math.floor(f0[i - 1]!.z / cell);
      const qz = Math.floor(f0[i]!.z / cell);
      expect(qz > pz || (qz === pz && Math.floor(f0[i]!.x / cell) > Math.floor(f0[i - 1]!.x / cell))).toBe(true);
    }
    // A field's props do not depend on its neighbours (only `field` is its index).
    const alone = expandPropField(testMap([rocks]), 0);
    expect(expandPropField(map, 1).map((p) => ({ ...p, field: 0 }))).toEqual(alone);
    expect(expandPropFields(testMap())).toEqual([]);
    expect(codeOf(() => expandPropField(map, 2))).toBe('bad-value');
    expect(codeOf(() => expandPropField(testMap(), 0))).toBe('bad-value');
  });

  it('decodes a hand-built container with PFLD via readRtsMap', () => {
    const chunks = readContainer(writeRtsMap(testMap()), 'RTSM').chunks.map((c) => ({ id: c.id, data: c.data }));
    const withPfld = writeContainer('RTSM', 1, [...chunks, { id: 'PFLD', data: encodePropFieldsChunk([rocks]) }]);
    expect(readRtsMap(withPfld).propFields).toEqual([rocks]);
    expect(readRtsMap(withPfld).propFieldAlgo).toBe(PROPFIELD_ALGO_VERSION);
    // PFLD before PROP violates the chunk order.
    const misordered = writeContainer('RTSM', 1, [chunks[0]!, chunks[1]!, { id: 'PFLD', data: encodePropFieldsChunk([rocks]) }, chunks[2]!]);
    expect(codeOf(() => readRtsMap(misordered))).toBe('chunk-order');
    // A structurally fine but invalid field is rejected by the validation.
    const invalid = writeContainer('RTSM', 1, [...chunks, { id: 'PFLD', data: encodePropFieldsChunk([{ ...rocks, densityPerKWu2: 0 }]) }]);
    expect(codeOf(() => readRtsMap(invalid))).toBe('bad-value');
  });
});
