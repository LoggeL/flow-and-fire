import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { expandPropFields, mapSimHash, readContainer, readRtsMap, writeRtsMap } from '../src/index.ts';

/**
 * The checked-in maps predate the PFLD chunk (TRACK-EDITOR). They must load without prop fields,
 * write back byte-identically and keep their mapSimHash goldens (replays, scenario goldens).
 */
const LEGACY_MAPS = [
  { name: 'hollow-ridge', hash: 0x90ec94f0, chunks: ['META', 'HGT ', 'PROP', 'PREV'] },
  { name: 'tessera', hash: 0x22cb60a8, chunks: ['META', 'HGT ', 'SPLT', 'PROP', 'PREV'] },
  { name: 'braidwater', hash: 0xeeaec694, chunks: ['META', 'HGT ', 'SPLT', 'PROP', 'PREV'] },
  { name: 'setons', hash: 0x52eccf92, chunks: ['META', 'HGT ', 'SPLT', 'PROP', 'PREV'] },
] as const;

describe('legacy maps (no PFLD chunk)', () => {
  for (const lm of LEGACY_MAPS) {
    it(`${lm.name}: read -> write is byte-identical, propFields absent, mapSimHash golden`, () => {
      const bytes = new Uint8Array(readFileSync(resolve(import.meta.dirname, `../../../content/maps/${lm.name}.rtsmap`)));
      expect(readContainer(bytes, 'RTSM').chunks.map((c) => c.id)).toEqual(lm.chunks);
      const map = readRtsMap(bytes);
      expect('propFields' in map).toBe(false);
      expect(expandPropFields(map)).toEqual([]);
      const out = writeRtsMap(map);
      expect(out.length).toBe(bytes.length);
      expect(Buffer.from(out).equals(Buffer.from(bytes))).toBe(true);
      expect(readContainer(out, 'RTSM').chunks.map((c) => c.id)).toEqual(lm.chunks);
      expect(mapSimHash(map)).toBe(lm.hash);
      // An empty field list adds a PFLD chunk but leaves the simulation identity unchanged.
      const withEmpty = readRtsMap(writeRtsMap({ ...map, propFields: [] }));
      expect(withEmpty.propFields).toEqual([]);
      expect(mapSimHash(withEmpty)).toBe(lm.hash);
    });
  }
});
