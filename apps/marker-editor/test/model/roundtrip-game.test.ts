/**
 * Roundtrip against the game loaders: editor export → .rtsmap bytes → ClientMap.fromBytes
 * (@faf/client, what the game's main thread uses) and resolveMap / SimCore (@faf/sim-host, what the
 * sim worker uses) → writeRtsMap(...) is byte-identical with the editor export, and the formats
 * mapSimHash equals the sim host's view. Same for the four unchanged checked-in maps.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mapSimData, mapSimHash, readRtsMap, writeRtsMap, type RtsMap } from '@faf/formats';
import { ClientMap } from '@faf/client';
import { resolveMap, SimCore } from '@faf/sim-host';
import { describe, expect, it } from 'vitest';
import { EditorStore } from '../../src/app/store.ts';
import { bytesEqual, MAP_NAMES, MAP_SIM_HASH, mapBytes, REPO_ROOT, WU, type MapName } from './support.ts';

const simBin = new Uint8Array(readFileSync(resolve(REPO_ROOT, 'content/generated/sim.bin')));

interface LoaderView {
  readonly clientBytes: Uint8Array;
  readonly simBytes: Uint8Array;
  readonly coreHash: number;
  readonly coreMap: RtsMap;
  readonly client: ClientMap;
}

/** Loads `bytes` like the game does and writes both loader results back. */
function loadLikeTheGame(bytes: Uint8Array): LoaderView {
  const client = ClientMap.fromBytes(bytes.slice());
  const resolved = resolveMap(bytes.slice());
  const armyCount = Math.max(...resolved.meta.starts.map((s) => s.army)) + 1;
  const core = new SimCore({ simBin, seed: 7, armyCount, map: bytes.slice(), record: false, keyframes: false, trail: false });
  return {
    clientBytes: writeRtsMap(client.map),
    simBytes: writeRtsMap(resolved),
    coreHash: core.mapSimHash,
    coreMap: core.map,
    client,
  };
}

function expectSameAsGame(exported: Uint8Array): RtsMap {
  const g = loadLikeTheGame(exported);
  expect(bytesEqual(g.clientBytes, exported)).toBe(true);
  expect(bytesEqual(g.simBytes, exported)).toBe(true);
  expect(bytesEqual(writeRtsMap(g.coreMap), exported)).toBe(true);
  const map = readRtsMap(exported);
  expect(g.coreHash).toBe(mapSimHash(map) >>> 0);
  expect(g.client.starts).toEqual(map.meta.starts);
  expect(g.client.spots).toEqual(map.meta.spots);
  // The sim sees exactly the editor's markers.
  const sim = mapSimData(g.coreMap);
  expect(sim.starts).toEqual(map.meta.starts);
  expect(sim.spots).toEqual(map.meta.spots);
  return map;
}

describe('roundtrip editor -> file -> game loaders', () => {
  for (const name of MAP_NAMES) {
    it(`${name} unchanged: export == file == client/sim loader output, mapSimHash golden`, () => {
      const s = new EditorStore();
      s.open(mapBytes(name), `${name}.rtsmap`);
      const out = s.exportBytes();
      expect(bytesEqual(out, mapBytes(name))).toBe(true);
      const map = expectSameAsGame(out);
      expect(mapSimHash(map) >>> 0).toBe(MAP_SIM_HASH[name as MapName]);
    });
  }

  it('hollow-ridge edited (start, spots, 2 fields): game loaders give the same bytes and hash', () => {
    const s = new EditorStore();
    s.open(mapBytes('hollow-ridge'), 'hollow-ridge.rtsmap');
    s.addStart(250 * WU, 180 * WU);
    s.addSpot('mass', 160 * WU, 200 * WU);
    s.addSpot('hydro', 320 * WU, 256 * WU);
    s.select([{ type: 'spot', index: 0 }]);
    s.moveSelectionBy(3 * WU, -2 * WU);
    s.addField({ kind: 'circle', x: 200 * WU, z: 260 * WU, r: 20 * WU });
    s.addField(
      { kind: 'polygon', points: [{ x: 300 * WU, z: 100 * WU }, { x: 340 * WU, z: 100 * WU }, { x: 330 * WU, z: 140 * WU }, { x: 305 * WU, z: 131 * WU }] },
      { kind: 'rock', name: 'Felsen', entries: [{ id: 'core:rock_01', weight: 3 }, { id: 'core:rock_02', weight: 1 }] },
    );
    expect(s.undoDepth.value).toBe(6);
    const out = s.exportBytes();
    const map = expectSameAsGame(out);
    expect(map.meta.starts).toHaveLength(3);
    expect(map.propFields).toHaveLength(2);
    expect(mapSimHash(map) >>> 0).not.toBe(MAP_SIM_HASH['hollow-ridge']);
    // The editor re-opens its own export byte-identically.
    const again = new EditorStore();
    again.open(out, 'edited.rtsmap');
    expect(bytesEqual(again.exportBytes(), out)).toBe(true);
    // And undoing everything gives the checked-in file again.
    while (s.canUndo.value) s.undo();
    expect(bytesEqual(s.exportBytes(), mapBytes('hollow-ridge'))).toBe(true);
  });

  it('setons edited under live point symmetry: loaders agree, map stays symmetric', () => {
    const s = new EditorStore();
    s.open(mapBytes('setons'), 'setons.rtsmap');
    s.symmetry.value = 'point';
    s.liveSymmetry.value = true;
    const n = s.doc.value!.spots.length;
    s.addSpot('mass', 300 * WU, 520 * WU);
    s.addField({ kind: 'circle', x: 400 * WU, z: 600 * WU, r: 24 * WU });
    expect(s.doc.value!.spots).toHaveLength(n + 2);
    expect(s.doc.value!.fields).toHaveLength(2);
    expectSameAsGame(s.exportBytes());
  });
});
