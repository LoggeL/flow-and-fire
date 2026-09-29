import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createRtsMap,
  FormatError,
  mapSimBytes,
  mapSimData,
  mapSimHash,
  metaToCanonicalJson,
  readContainer,
  readRtsMap,
  RTSMAP_CHUNK_ORDER,
  writeContainer,
  writeRtsMap,
  type RtsMap,
} from '../src/index.ts';

const ONE = 4096;
const HOLLOW_RIDGE_PATH = resolve(import.meta.dirname, '../../../content/maps/hollow-ridge.rtsmap');
/** Golden: mapSimHash of the checked-in hollow-ridge.rtsmap (MS2). Changing it breaks every replay/golden on the map. */
const HOLLOW_RIDGE_MAP_SIM_HASH = 0x90ec94f0;

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof FormatError) return e.code;
    throw e;
  }
  return 'no-error';
}

/** Small map that uses every chunk kind (plus an unknown chunk). */
function smallMap(): RtsMap {
  return createRtsMap({
    sizeWu: 64,
    name: 'Kleine Karte ä',
    waterLevelRaw: 3 * ONE,
    heights: (x, z) => (x * 37 + z * 101) & 0x3ff,
    starts: [
      { army: 1, x: 48 * ONE, z: 48 * ONE },
      { army: 0, x: 16 * ONE, z: 16 * ONE },
    ],
    spots: [
      { kind: 'mass', x: 20 * ONE, z: 18 * ONE },
      { kind: 'hydro', x: 32 * ONE + 17, z: 32 * ONE },
    ],
    props: [
      { id: 'core:rock_01', x: 5 * ONE, z: 60 * ONE, yaw: 12345, scalePermille: 1500 },
      { id: 'test:x', x: 0, z: 64 * ONE, yaw: 0, scalePermille: 1 },
    ],
    strata: [{ name: 'sand', color: [200, 180, 120] }],
    splat: { codec: 0, layers: 4, resolution: 2, planes: [new Uint8Array(16).map((_, i) => i * 7)] },
    preview: { width: 2, height: 1, rgba: new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]) },
    unknownChunks: [{ id: 'XTRA', data: new Uint8Array([1, 2, 3]), after: 'PROP' }],
  });
}

describe('.rtsmap read/write', () => {
  it('round-trips a map with all chunk kinds byte-exactly', () => {
    const m = smallMap();
    const bytes = writeRtsMap(m);
    const back = readRtsMap(bytes);
    expect(back).toEqual(m);
    expect(writeRtsMap(back)).toEqual(bytes);
    expect(readContainer(bytes, 'RTSM').chunks.map((c) => c.id)).toEqual(['META', 'HGT ', 'SPLT', 'PROP', 'XTRA', 'PREV']);
    expect(back.meta.starts.map((s) => s.army)).toEqual([0, 1]); // builder sorts by army
  });

  it('writes canonical META JSON (fixed key order, no whitespace)', () => {
    const m = createRtsMap({ sizeWu: 64, name: 'A "q"', waterLevelRaw: null });
    expect(metaToCanonicalJson(m.meta)).toBe(
      '{"v":1,"name":"A \\"q\\"","sizeWu":64,"heightScaleRaw":32,"waterLevelRaw":null,' +
        '"starts":[{"army":0,"x":65536,"z":65536},{"army":1,"x":196608,"z":196608}],"spots":[],' +
        '"light":{"azimuthDeg":135,"elevationDeg":50,"sun":[255,244,222],"ambient":[96,108,128]},"strata":[]}',
    );
  });

  it('detects every single-bit flip in a small file', () => {
    const bytes = writeRtsMap(smallMap());
    expect(bytes.length).toBeLessThan(10_000);
    let undetected = 0;
    const flipped = bytes.slice();
    for (let i = 0; i < bytes.length; i++) {
      for (let bit = 0; bit < 8; bit++) {
        flipped[i] = bytes[i]! ^ (1 << bit);
        if (codeOf(() => readRtsMap(flipped)) === 'no-error') undetected++;
      }
      flipped[i] = bytes[i]!;
    }
    expect(undetected).toBe(0);
  });

  it('throws FormatError for every truncated prefix', () => {
    const bytes = writeRtsMap(smallMap());
    for (let n = 0; n < bytes.length; n += n < 64 ? 1 : 7) {
      expect(codeOf(() => readRtsMap(bytes.subarray(0, n))), `length ${n}`).not.toBe('no-error');
    }
    expect(codeOf(() => readRtsMap(bytes.subarray(0, bytes.length - 1)))).toBe('truncated');
  });

  it("skips an unknown chunk 'ZZZZ' between META and HGT and writes it back in place", () => {
    const base = writeRtsMap(createRtsMap({ sizeWu: 64, heights: (x, z) => x ^ z }));
    const chunks = readContainer(base, 'RTSM').chunks.map((c) => ({ id: c.id, data: c.data }));
    chunks.splice(1, 0, { id: 'ZZZZ', data: new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x42]) });
    const withUnknown = writeContainer('RTSM', 1, chunks);
    const m = readRtsMap(withUnknown);
    expect(m.unknownChunks).toEqual([{ id: 'ZZZZ', data: new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x42]), after: 'META' }]);
    expect(m.heights[3 * 65 + 5]).toBe(3 ^ 5);
    expect(writeRtsMap(m)).toEqual(withUnknown);
    // Unknown chunks never change the simulation identity.
    expect(mapSimHash(m)).toBe(mapSimHash(readRtsMap(base)));
  });

  it('keeps unknown chunks at the start and after an anchor that disappeared', () => {
    const m = smallMap();
    const moved: RtsMap = {
      ...m,
      preview: null,
      unknownChunks: [
        { id: 'HEAD', data: new Uint8Array([1]), after: null },
        { id: 'TAIL', data: new Uint8Array([2]), after: 'PREV' },
      ],
    };
    const ids = readContainer(writeRtsMap(moved), 'RTSM').chunks.map((c) => c.id);
    expect(ids).toEqual(['HEAD', 'META', 'HGT ', 'SPLT', 'PROP', 'TAIL']);
    expect(readRtsMap(writeRtsMap(moved)).unknownChunks.map((u) => u.after)).toEqual([null, 'PROP']);
  });

  it('passes a KTX2 splat (codec 1) through untouched', () => {
    const payload = new Uint8Array([0xab, 0x4b, 0x54, 0x58, 1, 2, 3]);
    const m = createRtsMap({ sizeWu: 64, splat: { codec: 1, layers: 8, resolution: 256, payload } });
    const back = readRtsMap(writeRtsMap(m));
    expect(back.splat).toEqual({ codec: 1, layers: 8, resolution: 256, payload });
  });

  it('rejects missing, duplicate and misordered chunks and non-canonical META', () => {
    const chunks = readContainer(writeRtsMap(smallMap()), 'RTSM').chunks.map((c) => ({ id: c.id, data: c.data }));
    const without = (id: string) => chunks.filter((c) => c.id !== id);
    expect(codeOf(() => readRtsMap(writeContainer('RTSM', 1, without('META'))))).toBe('missing-chunk');
    expect(codeOf(() => readRtsMap(writeContainer('RTSM', 1, without('HGT '))))).toBe('missing-chunk');
    expect(codeOf(() => readRtsMap(writeContainer('RTSM', 1, without('PROP'))))).toBe('missing-chunk');
    expect(codeOf(() => readRtsMap(writeContainer('RTSM', 1, [...chunks, chunks[3]!])))).toBe('chunk-order');
    expect(codeOf(() => readRtsMap(writeContainer('RTSM', 1, [chunks[0]!, chunks[1]!, chunks[1]!, ...chunks.slice(2)])))).toBe('duplicate-chunk');
    expect(codeOf(() => readRtsMap(writeContainer('RTSM', 1, [chunks[1]!, chunks[0]!, ...chunks.slice(2)])))).toBe('missing-chunk');
    expect(codeOf(() => readRtsMap(writeContainer('RTSM', 2, chunks)))).toBe('bad-format-version');
    expect(codeOf(() => readRtsMap(writeContainer('RTSX', 1, chunks)))).toBe('bad-magic');
    const meta = new TextDecoder().decode(chunks[0]!.data);
    const withSpace = { id: 'META', data: new TextEncoder().encode(meta.replace('"v":1,', '"v": 1,')) };
    expect(codeOf(() => readRtsMap(writeContainer('RTSM', 1, [withSpace, ...chunks.slice(1)])))).toBe('non-canonical');
    const floatMeta = { id: 'META', data: new TextEncoder().encode(meta.replace('"sizeWu":64', '"sizeWu":64.5')) };
    expect(codeOf(() => readRtsMap(writeContainer('RTSM', 1, [floatMeta, ...chunks.slice(1)])))).toBe('bad-value');
    const notJson = { id: 'META', data: new TextEncoder().encode('{"v":1') };
    expect(codeOf(() => readRtsMap(writeContainer('RTSM', 1, [notJson, ...chunks.slice(1)])))).toBe('bad-json');
    const reordered = { id: 'META', data: new TextEncoder().encode(meta.replace('{"v":1,"name":"Kleine Karte ä",', '{"name":"Kleine Karte ä","v":1,')) };
    expect(codeOf(() => readRtsMap(writeContainer('RTSM', 1, [reordered, ...chunks.slice(1)])))).toBe('bad-value');
  });

  it('validates values (sizes, ranges, ids, starts)', () => {
    const bad = (p: Parameters<typeof createRtsMap>[0]) => codeOf(() => createRtsMap(p));
    expect(bad({ sizeWu: 100 })).toBe('bad-value');
    expect(bad({ sizeWu: 32 })).toBe('bad-value');
    expect(bad({ sizeWu: 8192 })).toBe('bad-value');
    expect(bad({ sizeWu: 64, heightScaleRaw: 33 })).toBe('bad-value');
    expect(bad({ sizeWu: 64, heightScaleRaw: 0 })).toBe('bad-value');
    expect(bad({ sizeWu: 64, waterLevelRaw: -1 })).toBe('bad-value');
    expect(bad({ sizeWu: 64, waterLevelRaw: 0.5 })).toBe('bad-value');
    expect(bad({ sizeWu: 64, heights: () => 70000 })).toBe('bad-value');
    expect(bad({ sizeWu: 64, heights: () => 1.5 })).toBe('bad-value');
    expect(bad({ sizeWu: 64, heights: new Uint16Array(10) })).toBe('bad-value');
    expect(bad({ sizeWu: 64, starts: [] })).toBe('bad-value');
    expect(bad({ sizeWu: 64, starts: [{ army: 0, x: 0, z: 0 }, { army: 0, x: 1, z: 1 }] })).toBe('bad-value');
    expect(bad({ sizeWu: 64, starts: [{ army: 16, x: 0, z: 0 }] })).toBe('bad-value');
    expect(bad({ sizeWu: 64, starts: [{ army: 0, x: 64 * ONE + 1, z: 0 }] })).toBe('bad-value');
    expect(bad({ sizeWu: 64, spots: [{ kind: 'mass', x: -1, z: 0 }] })).toBe('bad-value');
    expect(bad({ sizeWu: 64, spots: [{ kind: 'oil' as 'mass', x: 0, z: 0 }] })).toBe('bad-value');
    expect(bad({ sizeWu: 64, props: [{ id: 'rock', x: 0, z: 0, yaw: 0, scalePermille: 1000 }] })).toBe('bad-value');
    expect(bad({ sizeWu: 64, props: [{ id: 'core:rock', x: 0, z: 0, yaw: 65536, scalePermille: 1000 }] })).toBe('bad-value');
    expect(bad({ sizeWu: 64, props: [{ id: 'core:rock', x: 0, z: 0, yaw: 0, scalePermille: 0 }] })).toBe('bad-value');
    expect(bad({ sizeWu: 64, name: '' })).toBe('bad-value');
    expect(bad({ sizeWu: 64, name: 'a\nb' })).toBe('bad-value');
    expect(bad({ sizeWu: 64, light: { azimuthDeg: 360, elevationDeg: 0, sun: [0, 0, 0], ambient: [0, 0, 0] } })).toBe('bad-value');
    expect(bad({ sizeWu: 64, splat: { codec: 0, layers: 8, resolution: 2, planes: [new Uint8Array(16)] } })).toBe('bad-value');
    expect(bad({ sizeWu: 64, preview: { width: 2, height: 2, rgba: new Uint8Array(3) } })).toBe('bad-value');
    expect(bad({ sizeWu: 64, unknownChunks: [{ id: 'META', data: new Uint8Array(0), after: null }] })).toBe('bad-value');
    expect(bad({ sizeWu: 64 })).toBe('no-error');
  });

  it('round-trips the largest tested size (1024 WU)', () => {
    const m = createRtsMap({ sizeWu: 1024, heights: (x, z) => (x * z) & 0xffff, waterLevelRaw: 123_456 });
    const bytes = writeRtsMap(m);
    expect(bytes.length).toBeGreaterThan(1025 * 1025 * 2);
    const back = readRtsMap(bytes);
    expect(Buffer.from(back.heights.buffer).equals(Buffer.from(m.heights.buffer))).toBe(true);
    expect(Buffer.from(writeRtsMap(back)).equals(Buffer.from(bytes))).toBe(true);
  });
});

describe('mapSimHash / mapSimData', () => {
  const bytes = new Uint8Array(readFileSync(HOLLOW_RIDGE_PATH));
  const ridge = readRtsMap(bytes);

  it('read -> write of hollow-ridge.rtsmap is byte-identical', () => {
    expect(Buffer.from(writeRtsMap(ridge)).equals(Buffer.from(bytes))).toBe(true);
    // Timing (logged, not gated).
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) readRtsMap(bytes);
    const t1 = performance.now();
    for (let i = 0; i < 5; i++) mapSimHash(ridge);
    const t2 = performance.now();
    for (let i = 0; i < 5; i++) writeRtsMap(ridge);
    const t3 = performance.now();
    console.log(`[rtsmap] hollow-ridge (${bytes.length} B): read ${((t1 - t0) / 5).toFixed(2)} ms, mapSimHash ${((t2 - t1) / 5).toFixed(2)} ms, write ${((t3 - t2) / 5).toFixed(2)} ms`);
  });

  it('pins the mapSimHash of hollow-ridge (golden)', () => {
    expect(mapSimHash(ridge)).toBe(HOLLOW_RIDGE_MAP_SIM_HASH);
    const simBytes = mapSimBytes(ridge);
    expect(String.fromCharCode(...simBytes.subarray(0, 8))).toBe('FAFMAPS1');
  });

  it('ignores presentation-only content', () => {
    const h = mapSimHash(ridge);
    const variants: RtsMap[] = [
      { ...ridge, meta: { ...ridge.meta, name: 'Anderer Name' } },
      { ...ridge, meta: { ...ridge.meta, light: { ...ridge.meta.light, azimuthDeg: 10, sun: [1, 2, 3] } } },
      { ...ridge, meta: { ...ridge.meta, strata: [] } },
      { ...ridge, preview: null },
      { ...ridge, preview: { width: 1, height: 1, rgba: new Uint8Array(4) } },
      { ...ridge, splat: { codec: 0, layers: 4, resolution: 1, planes: [new Uint8Array(4)] } },
      { ...ridge, unknownChunks: [{ id: 'ZZZZ', data: new Uint8Array([1]), after: 'META' }] },
    ];
    for (const v of variants) {
      expect(mapSimHash(readRtsMap(writeRtsMap(v)))).toBe(h);
    }
  });

  it('changes with any simulation-relevant field', () => {
    const h = mapSimHash(ridge);
    const heights = ridge.heights.slice();
    heights[200 * 513 + 300]! += 1;
    const spots = ridge.meta.spots.slice();
    spots[3] = { ...spots[3]!, x: spots[3]!.x + 1 };
    const kinds = ridge.meta.spots.slice();
    kinds[0] = { ...kinds[0]!, kind: 'hydro' };
    const variants: RtsMap[] = [
      { ...ridge, heights },
      { ...ridge, meta: { ...ridge.meta, spots } },
      { ...ridge, meta: { ...ridge.meta, spots: kinds } },
      { ...ridge, meta: { ...ridge.meta, waterLevelRaw: ridge.meta.waterLevelRaw! + 1 } },
      { ...ridge, meta: { ...ridge.meta, waterLevelRaw: null } },
      { ...ridge, meta: { ...ridge.meta, heightScaleRaw: 31 } },
      { ...ridge, meta: { ...ridge.meta, starts: [ridge.meta.starts[0]!, { ...ridge.meta.starts[1]!, z: 0 }] } },
      { ...ridge, props: ridge.props.slice(1) },
      { ...ridge, props: [{ ...ridge.props[0]!, yaw: ridge.props[0]!.yaw ^ 1 }, ...ridge.props.slice(1)] },
    ];
    const seen = new Set<number>([h]);
    for (const v of variants) {
      const hv = mapSimHash(v);
      expect(hv).not.toBe(h);
      seen.add(hv);
    }
    expect(seen.size).toBe(variants.length + 1);
  });

  it('mapSimData exposes the simulation view (shared arrays)', () => {
    const d = mapSimData(ridge);
    expect(d).toEqual({
      sizeWu: 512,
      dim: 513,
      heightScaleRaw: 32,
      waterLevelRaw: 10 * ONE,
      heights: ridge.heights,
      starts: ridge.meta.starts,
      spots: ridge.meta.spots,
      props: ridge.props,
    });
    expect(d.heights).toBe(ridge.heights);
  });

  it('every known chunk id is a valid 4CC', () => {
    expect(RTSMAP_CHUNK_ORDER).toEqual(['META', 'HGT ', 'SPLT', 'PROP', 'PREV']);
  });
});
