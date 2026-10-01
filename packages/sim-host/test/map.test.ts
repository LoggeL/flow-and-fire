/**
 * MS2 map in the sim host: init with .rtsmap bytes (and broken ones), identity (mapSimHash in
 * ready/simId/log header), L4 replay and arena restore on hollow-ridge, map checks on replay,
 * keyframes leave the static map untouched.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { FX_ONE, xxHash32 } from '@faf/fixed';
import { createRtsMap, createTestPlaneMap, mapSimHash, readRtsMap, writeRtsMap, type RtsMap } from '@faf/formats';
import { FrameReader, type HostMessage } from '@faf/protocol';
import { sampleHeightRaw } from '@faf/rules';
import { spawnRejectedCount, unitCount, unitHandles, type World } from '@faf/sim';
import { decodeSimBin, type SimBpTable } from '@faf/blueprints/simbin';
import {
  CommandLogError,
  HeadlessSim,
  parseCommandLog,
  replayLog,
  SimHost,
  simIdFor,
  SnapshotError,
  type HostReadyMsg,
} from '../src/index.ts';
import { bufferOf, gameSimBin, gameSimBinBuffer, hollowRidgeBuffer, hollowRidgeBytes, moveCmd, runScenario, spawnCmd } from './support/fixtures.ts';
import { FRAME_CAP, makeTestHost, type TestHost } from './support/host.ts';

/** Pinned identity of the checked-in map (docs/status/ms2-p0-formats.md). */
const RIDGE_MAP_SIM_HASH = 0x90ec94f0;
/** Identity of the generated 512 WU test plane map (formats createTestPlaneMap). */
const PLANE_MAP_SIM_HASH = mapSimHash(createTestPlaneMap()) >>> 0;

let open: TestHost[] = [];
afterEach(() => {
  for (const h of open) h.close();
  open = [];
});

function staticHash(w: World): number {
  const a = w.arena;
  return xxHash32(a.bytes, a.staticStart, a.staticEnd - a.staticStart, 0);
}

describe('SimHost init with a map', () => {
  it('ready carries map name, size and mapSimHash; simId includes the map; frames stand on the terrain', () => {
    const h = makeTestHost({ map: hollowRidgeBuffer() });
    open.push(h);
    const ready = h.of('ready')[0] as HostReadyMsg;
    const bp = decodeSimBin(gameSimBin()).simHash;
    expect(ready).toMatchObject({ mapName: 'Hollow Ridge', mapSizeWu: 512, mapSimHash: RIDGE_MAP_SIM_HASH });
    expect(ready.simId).toBe(simIdFor(bp, RIDGE_MAP_SIM_HASH));
    expect(ready.simId).not.toBe(simIdFor(bp, PLANE_MAP_SIM_HASH));
    expect(h.host.core.map?.meta.name).toBe('Hollow Ridge');
    // The command log header records the map.
    expect(h.host.core.recorder!.header.mapSimHash).toBe(RIDGE_MAP_SIM_HASH);
    h.host.submit(bufferOf([spawnCmd(0, 50, 110, 110, 30, 1), spawnCmd(1, 5, 256, 256, 0, 1)]));
    h.host.runTicks(3);
    const f = h.consumer.poll()!;
    const r = new FrameReader();
    expect(r.reset(f)).toBe(true);
    expect(r.unitCount).toBe(50); // the 5 in the lake were rejected
    expect(spawnRejectedCount(h.host.core.world)).toBe(5);
    const map = h.host.core.map!;
    const hf = { sizeWu: 512, dim: 513, heights: map.heights, heightScaleRaw: map.meta.heightScaleRaw };
    for (let i = 0; i < r.unitCount; i++) {
      const x = r.unitCur(i, 0);
      const y = r.unitCur(i, 1);
      const z = r.unitCur(i, 2);
      expect(y).toBe(sampleHeightRaw(hf, x, z));
      expect(y).toBeGreaterThan(20 * FX_ONE); // NW plateau (24.1 WU)
    }
  });

  it('without a map in init the host runs the generated test plane map (same map path, formats mapSimHash)', () => {
    const h = makeTestHost();
    open.push(h);
    const ready = h.of('ready')[0] as HostReadyMsg;
    expect(ready).toMatchObject({ mapName: 'testplane', mapSizeWu: 512, mapSimHash: PLANE_MAP_SIM_HASH });
    expect(ready.simId).toBe(simIdFor(decodeSimBin(gameSimBin()).simHash, PLANE_MAP_SIM_HASH));
    expect(h.host.core.map.meta.name).toBe('testplane');
    // Sending the generated map as .rtsmap bytes (what the game does) is the same session.
    const bytes = writeRtsMap(createTestPlaneMap());
    const hb = makeTestHost({ map: bytes.slice().buffer });
    open.push(hb);
    expect((hb.of('ready')[0] as HostReadyMsg).simId).toBe(ready.simId);
  });

  it('a broken map (CRC, magic, truncation) ⇒ error message with the reason; the host stays uninitialized', () => {
    const bytes = hollowRidgeBytes();
    const cases: [string, Uint8Array][] = [];
    const crc = bytes.slice();
    crc[40_000] = crc[40_000]! ^ 0x10; // inside the HGT payload
    cases.push(['bad-crc', crc]);
    const magic = bytes.slice();
    magic[0] = 0x58;
    cases.push(['bad-magic', magic]);
    cases.push(['truncated', bytes.slice(0, 100_000)]);
    for (const [reason, b] of cases) {
      const msgs: HostMessage[] = [];
      const host = new SimHost({ post: (m) => msgs.push(m), opfs: null, autoStart: false });
      const map = new ArrayBuffer(b.length);
      new Uint8Array(map).set(b);
      host.handleMessage({ t: 'init', simBin: gameSimBinBuffer(), seed: 1, armyCount: 2, playerArmy: 0, transport: 'sab', frameSab: new SharedArrayBuffer(FRAME_CAP * 3 + 4096), frameCapacity: FRAME_CAP, buildHash: 't', map });
      expect(host.initialized, reason).toBe(false);
      const err = msgs.find((m) => m.t === 'error');
      expect(err?.t === 'error' && err.message, reason).toMatch(new RegExp(`FormatError: ${reason}`));
      expect(msgs.some((m) => m.t === 'ready')).toBe(false);
      host.dispose();
    }
    // Not an ArrayBuffer: rejected by the protocol validation.
    const msgs: HostMessage[] = [];
    const host = new SimHost({ post: (m) => msgs.push(m), opfs: null, autoStart: false });
    host.handleMessage({ t: 'init', simBin: gameSimBinBuffer(), seed: 1, armyCount: 2, playerArmy: 0, transport: 'sab', frameSab: new SharedArrayBuffer(FRAME_CAP * 3 + 4096), frameCapacity: FRAME_CAP, buildHash: 't', map: 'hollow-ridge' });
    expect(msgs[0]).toMatchObject({ t: 'error' });
    expect(host.initialized).toBe(false);
  });
});

describe('simId distinguishes maps', () => {
  it('hollow-ridge, a one-sample edit of it and the test plane have different simIds; name/preview do not matter', () => {
    const table = decodeSimBin(gameSimBin());
    const ridge = readRtsMap(hollowRidgeBytes());
    const heights = ridge.heights.slice();
    heights[12345] = heights[12345]! + 1;
    const edited: RtsMap = { ...ridge, heights };
    const renamed: RtsMap = { ...ridge, meta: { ...ridge.meta, name: 'other name' }, preview: null };
    const ids = [ridge, edited, renamed].map((map) => new HeadlessSim({ bpTable: table, seed: 1, armyCount: 2, map, record: false, keyframes: false }).simId);
    const plane = new HeadlessSim({ bpTable: table, seed: 1, armyCount: 2, record: false, keyframes: false }).simId;
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids[0]).toBe(ids[2]);
    expect(new Set([ids[0], ids[1], plane]).size).toBe(3);
    // Bytes and the parsed map give the same session.
    expect(new HeadlessSim({ bpTable: table, seed: 1, armyCount: 2, map: writeRtsMap(renamed), record: false, keyframes: false }).simId).toBe(ids[0]);
  });
});

describe('L4 on hollow-ridge (replay + arena restore)', { timeout: 180_000 }, () => {
  const TICKS = 2000;
  const SEED = 0x2e11d9e;
  let table: SimBpTable;
  let ridge: RtsMap;
  let chain: number[];
  let log: Uint8Array;
  let snap1000: Uint8Array;
  const full = new Map<number, number>();
  const rule = new Map<number, number>();
  let staticBefore = 0;

  const fresh = (o: Partial<ConstructorParameters<typeof HeadlessSim>[0]> = {}): HeadlessSim =>
    new HeadlessSim({ bpTable: table, seed: SEED, armyCount: 2, map: ridge, buildHash: 'test-build', ...o });

  beforeAll(() => {
    table = decodeSimBin(gameSimBin());
    ridge = readRtsMap(hollowRidgeBytes());
    const sim = fresh();
    staticBefore = staticHash(sim.world);
    runScenario(sim, TICKS, (t) => {
      if (t % 100 === 0) {
        full.set(t, sim.fullHash());
        rule.set(t, sim.ruleHash());
      }
      if (t === 1000) snap1000 = sim.snapshot();
    });
    chain = sim.hashChain();
    log = sim.exportLog();
    // The scenario's respawn at (256, 256) lies in the lake (M2 spawn rejection is part of it);
    // MS3: the first spawns also lose the points on cliffs/steep slopes (nav passability).
    expect(spawnRejectedCount(sim.world)).toBeGreaterThanOrEqual(50);
    expect(unitCount(sim.world)).toBeGreaterThan(800);
  }, 180_000);

  it('the log header (v4) names the map; replaying it with the map gives the identical chain', () => {
    const parsed = parseCommandLog(log);
    expect(parsed.version).toBe(4);
    expect(parsed.header.mapSimHash).toBe(RIDGE_MAP_SIM_HASH);
    expect(parsed.header.mapSizeWu).toBe(512);
    const r = replayLog(log, { bpTable: table, map: ridge });
    expect(r.compared).toBe(200);
    expect(r.mismatches).toEqual([]);
    expect(r.trail.map((e) => e.hash)).toEqual(chain);
    expect(r.ruleHash).toBe(rule.get(TICKS));
    expect(r.fullHash).toBe(full.get(TICKS));
    // Map as bytes works too, and HeadlessSim.replay passes its own map.
    const r2 = fresh({ record: false, keyframes: false }).replay(log, 500);
    expect(r2.trail.map((e) => e.hash)).toEqual(chain.slice(0, 50));
    expect(replayLog(log, { bpTable: table, map: hollowRidgeBytes(), untilTick: 300 }).mismatches).toEqual([]);
  });

  it('refuses a missing or a different map', () => {
    expect(() => replayLog(log, { bpTable: table })).toThrow(CommandLogError);
    expect(() => replayLog(log, { bpTable: table })).toThrow(/not on the test plane/);
    const other = createRtsMap({ sizeWu: 512, name: 'hollow-ridge', heights: ridge.heights.slice(), waterLevelRaw: ridge.meta.waterLevelRaw, starts: ridge.meta.starts, spots: ridge.meta.spots.slice(1) });
    expect(mapSimHash(other)).not.toBe(RIDGE_MAP_SIM_HASH);
    expect(() => replayLog(log, { bpTable: table, map: other })).toThrow(/map mismatch/);
    // A test-plane log refuses a map as well.
    const plane = new HeadlessSim({ bpTable: table, seed: 1, armyCount: 2 });
    plane.submit([spawnCmd(0, 3, 10, 10, 1, 1)]);
    plane.step(20);
    expect(() => replayLog(plane.exportLog(), { bpTable: table, map: ridge })).toThrow(/map mismatch/);
    expect(replayLog(plane.exportLog(), { bpTable: table }).mismatches).toEqual([]);
  });

  it('restore of the tick-1000 snapshot ⇒ same rule and full hash at 2000; the static map is untouched', () => {
    const replay = replayLog(log, { bpTable: table, map: ridge, untilTick: 1 });
    const sim = replay.sim;
    expect(fresh({ record: false, keyframes: false }).world.layoutHash).toBe(sim.world.layoutHash);
    sim.restore(snap1000);
    expect(sim.tick).toBe(1000);
    expect(sim.fullHash()).toBe(full.get(1000));
    expect(staticHash(sim.world)).toBe(staticBefore);
  });

  it('refuses a snapshot of another map with the same layout (static map is not in the snapshot)', () => {
    // Same size, same spot count ⇒ identical arena layout, but different heights ⇒ other mapSimHash.
    const heights = ridge.heights.slice();
    heights[4242] = heights[4242]! + 3;
    const other = fresh({ record: false, keyframes: false, map: { ...ridge, heights } });
    expect(other.world.layoutHash).toBe(fresh({ record: false, keyframes: false }).world.layoutHash);
    const before = other.fullHash();
    expect(() => other.restore(snap1000)).toThrow(SnapshotError);
    expect(() => other.restore(snap1000)).toThrow(/simId/);
    expect(other.fullHash()).toBe(before); // nothing was touched
    expect(other.tick).toBe(0);
    // The test plane (other layout) and raw arena bytes without the identity header are refused too.
    const plane = new HeadlessSim({ bpTable: table, seed: SEED, armyCount: 2, record: false, keyframes: false });
    expect(() => plane.restore(snap1000)).toThrow(SnapshotError);
    expect(() => fresh({ record: false }).restore(snap1000.subarray(16))).toThrow(/magic/);
  });

  it('restore into a fresh sim driven by the log reaches the direct hashes at 2000', () => {
    const r = replayLog(log, { bpTable: table, map: ridge, untilTick: 1 });
    const sim = r.sim;
    sim.restore(snap1000);
    sim.runUntil(TICKS);
    expect(sim.ruleHash()).toBe(rule.get(TICKS));
    expect(sim.fullHash()).toBe(full.get(TICKS));
    expect(sim.hashChain()).toEqual(chain.slice(100));
  });

  it('keyframe seek re-simulates equal to the direct run and never touches the static map', () => {
    const sim = fresh();
    runScenario(sim, TICKS);
    for (const t of [1000, 300, 1900, 600]) {
      sim.seek(t);
      expect(sim.fullHash()).toBe(full.get(t));
      expect(staticHash(sim.world)).toBe(staticBefore);
    }
    expect(sim.mismatches).toEqual([]);
  });
});

describe('1,024 WU map in the host pipeline (init bytes, simId, replay, restore)', { timeout: 180_000 }, () => {
  const big = (): RtsMap =>
    createRtsMap({
      sizeWu: 1024,
      name: 'big',
      waterLevelRaw: 6 * FX_ONE,
      // Rolling land (≥ 8 WU; MS3: gentle enough for the nav slope limit) with a deep basin
      // (2 WU ground) in the middle third.
      heights: (x, z) => (x > 400 && x < 620 && z > 400 && z < 620 ? 256 : 1024 + ((x * 29 + z * 17) % 7) * 4 + ((x + z) >> 2)),
    });

  it('init with 1,024 WU .rtsmap bytes; units at the edges stand on the terrain; replay and restore are exact', () => {
    const map = big();
    const bytes = writeRtsMap(map);
    const h = makeTestHost({ map: bytes.slice().buffer });
    open.push(h);
    const ready = h.of('ready')[0] as HostReadyMsg;
    const table = decodeSimBin(gameSimBin());
    expect(ready).toMatchObject({ mapName: 'big', mapSizeWu: 1024, mapSimHash: mapSimHash(map) >>> 0 });
    expect(ready.simId).toBe(simIdFor(table.simHash, mapSimHash(map) >>> 0));

    const sim = new HeadlessSim({ bpTable: table, seed: 77, armyCount: 2, map: bytes, buildHash: 'big' });
    sim.submit([spawnCmd(0, 150, 5, 5, 3, 1), spawnCmd(0, 150, 1019, 1019, 3, 2), spawnCmd(1, 150, 1019, 5, 3, 1), spawnCmd(1, 150, 5, 1019, 3, 2)]);
    sim.step(1);
    const w = sim.world;
    const a0 = unitHandles(w, 0);
    const a1 = unitHandles(w, 1);
    expect(a0.length + a1.length).toBe(600);
    // Across the map (through the basin: land units slide around deep water) and beyond the edges.
    sim.submit([moveCmd(0, a0, 1100, 1100, 3), moveCmd(1, a1.slice(0, 75), -20, 1030, 3), moveCmd(1, a1.slice(75), 1030, -20, 4)]);
    let snap: Uint8Array | null = null;
    let fullAt = 0;
    for (let t = 0; t < 600; t++) {
      sim.step(1);
      if (sim.tick === 300) {
        snap = sim.snapshot();
        fullAt = sim.fullHash();
      }
    }
    const hf = { sizeWu: 1024, dim: 1025, heights: map.heights, heightScaleRaw: map.meta.heightScaleRaw };
    const U = w.units.col;
    for (let i = 0; i < w.units.highWater; i++) {
      if (w.units.alive[i] !== 1) continue;
      expect(U.x[i]! >= 0 && U.x[i]! <= 1024 * FX_ONE && U.z[i]! >= 0 && U.z[i]! <= 1024 * FX_ONE).toBe(true);
      expect(U.y[i]).toBe(sampleHeightRaw(hf, U.x[i]!, U.z[i]!));
    }
    const chain = sim.hashChain();
    const endFull = sim.fullHash();
    // Replay from the log (map as the parsed file) gives the identical chain.
    const r = replayLog(sim.exportLog(), { bpTable: table, map: readRtsMap(bytes) });
    expect(r.mismatches).toEqual([]);
    expect(r.trail.map((e) => e.hash)).toEqual(chain);
    expect(r.fullHash).toBe(endFull);
    // Restore of tick 300 in a fresh session of the same map, then the log's commands ⇒ same end.
    const again = replayLog(sim.exportLog(), { bpTable: table, map: bytes, untilTick: 1 }).sim;
    again.restore(snap!);
    expect(again.fullHash()).toBe(fullAt);
    again.runUntil(sim.tick);
    expect(again.fullHash()).toBe(endFull);
  });
});
