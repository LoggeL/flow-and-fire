/**
 * FAFL command log → .rtsreplay (TRACK-REPLAY p4): lossless mapping of commands, hashes and
 * marks, sub-hashes by re-simulation, verification, the golden logs, crash-truncated logs,
 * taint, FAFL v1 / foreign builds and the FAFL round trip.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { decodeSimBin, type SimBpTable } from '@faf/blueprints/simbin';
import { XxHash32 } from '@faf/fixed';
import {
  createTestPlaneMap,
  mapSimHash,
  readAllCommands,
  readRtsMap,
  readRtsReplay,
  ReplayFlags,
  ReplayMarkKind,
  rewriteRtsReplay,
  RTSREPLAY_FORMAT_VERSION,
  type RtsMap,
} from '@faf/formats';
import { COMMAND_BATCH_VERSION, computeSimId, type CommandEnvelope } from '@faf/protocol';
import { unitHandles, type World } from '@faf/sim';
import {
  CommandLogError,
  computeSubHashes,
  convertCommandLog,
  entryCheck,
  HeadlessSim,
  identifySimBuild,
  KNOWN_SIM_BUILDS,
  LOG_ENTRY_HEADER_BYTES,
  LOG_V1_FIXED_HEADER_BYTES,
  MarkKind,
  MOD_LIST,
  parseCommandLog,
  parseLogHeader,
  replayLog,
  replayAsParsedLog,
  replayToCommandLog,
  ruleRegionNames,
  SIM_BUILD,
  SUB_HASH_INTERVAL_TICKS,
  UNKNOWN_SIM_BUILD,
  verifyReplay,
  align4,
} from '../src/index.ts';
import { gameSimBin, hollowRidgeBytes, moveCmd, spawnCmd, stopCmd } from './support/fixtures.ts';

const TICKS = 2000;
const SEED = 0x51ed2a7e;
const REPO = new URL('../../../', import.meta.url);

let table: SimBpTable;
let ridgeBytes: Uint8Array;
let ridge: RtsMap;

/** hollow-ridge: 2 × 150 cubes, three move groups per army every 100 ticks (incl. tick 1100). */
function ridgeCommands(w: World, tick: number): CommandEnvelope[] {
  const seq = (tick * 4) & 0xffff;
  if (tick === 1) return [spawnCmd(0, 150, 120, 140, 30, seq), spawnCmd(1, 150, 175, 160, 30, seq + 1)];
  if (tick !== 2 && tick % 100 !== 0) return [];
  const out: CommandEnvelope[] = [];
  for (let army = 0; army < 2; army++) {
    const hs = unitHandles(w, army);
    const per = Math.ceil(hs.length / 3);
    for (let g = 0; g < 3; g++) {
      const a = Math.imul(tick * 8 + army * 3 + g + 1, 0x9e3779b1) >>> 0;
      out.push(moveCmd(army, hs.slice(g * per, (g + 1) * per), 50 + (a % 150), 50 + ((a >>> 12) % 150), (seq + 2 + army * 3 + g) & 0xffff));
    }
  }
  return out;
}

interface Recording {
  readonly log: Uint8Array;
  readonly ruleHash: number;
  readonly fullHash: number;
  /** Sub-hash rows computed live at every 100th tick. */
  readonly subRows: Uint32Array[];
  readonly regionNames: string[];
}

function recordRidge(extra?: (sim: HeadlessSim) => void): Recording {
  const sim = new HeadlessSim({ bpTable: table, seed: SEED, armyCount: 2, map: ridgeBytes, keyframes: false, buildHash: 'b1234567' });
  extra?.(sim);
  const hasher = new XxHash32();
  const regionNames = ruleRegionNames(sim.world);
  const subRows: Uint32Array[] = [];
  while (sim.tick < TICKS) {
    const t = sim.tick + 1;
    const cmds = ridgeCommands(sim.world, t);
    if (cmds.length > 0) sim.submit(cmds);
    sim.step(1);
    if (t % SUB_HASH_INTERVAL_TICKS === 0) {
      const row = new Uint32Array(regionNames.length);
      computeSubHashes(sim.world, row, hasher);
      subRows.push(row);
    }
  }
  return { log: sim.exportLog(), ruleHash: sim.ruleHash(), fullHash: sim.fullHash(), subRows, regionNames };
}

let rec: Recording;

beforeAll(() => {
  table = decodeSimBin(gameSimBin());
  ridgeBytes = hollowRidgeBytes();
  ridge = readRtsMap(ridgeBytes);
  rec = recordRidge();
});

describe('convertCommandLog: hollow-ridge, 2,000 ticks', () => {
  it('maps commands, hashes and marks 1:1 and adds verified sub-hashes', () => {
    const res = convertCommandLog(rec.log, { map: ridgeBytes, bpTable: table });
    expect(res.warnings).toEqual([]);
    expect(res.verified).toBe(true);
    expect(res.mismatches).toEqual([]);
    expect(res.compared).toBe(TICKS / 10);
    expect(res.truncatedSource).toBe(false);
    expect(res.lastTick).toBe(TICKS);

    const log = parseCommandLog(rec.log);
    const r = readRtsReplay(res.bytes, { verifyBlocks: true });
    // HEAD
    expect(r.head).toEqual({
      formatVersion: RTSREPLAY_FORMAT_VERSION,
      simBuild: SIM_BUILD,
      buildHash: 'b1234567',
      simId: log.header.simId,
      bpSimHash: log.header.bpSimHash,
      mapSimHash: log.header.mapSimHash,
      layoutHash: log.header.layoutHash,
      protocolVersion: COMMAND_BATCH_VERSION,
      hashInterval: 10,
      subHashInterval: SUB_HASH_INTERVAL_TICKS,
      flags: ReplayFlags.Tainted | ReplayFlags.Complete,
      sourceLogVersion: 2,
    });
    // GAME
    expect(r.game.seed).toBe(SEED);
    expect(r.game.mapName).toBe(ridge.meta.name);
    expect(r.game.mapSizeWu).toBe(log.header.mapSizeWu);
    expect(r.game.playerArmy).toBe(0);
    expect(r.game.armies.map((a) => [a.index, a.name, a.kind])).toEqual([
      [0, 'Army 1', 0],
      [1, 'Army 2', 0],
    ]);
    // CMDS: identical batches at identical ticks
    const cmds = readAllCommands(r);
    expect(cmds.map((c) => c.tick)).toEqual(log.commands.map((c) => c.tick));
    for (let i = 0; i < cmds.length; i++) {
      const e = log.commands[i]!;
      expect(cmds[i]!.batch).toEqual(log.bytes.subarray(e.offset, e.offset + e.length));
    }
    expect(r.blocks.length).toBe(4); // last command at tick 2000 → block 3
    // HASH: the recorded trail, sub-hashes == live computation
    expect(Array.from(r.hashes.hashes)).toEqual(log.hashes.map((h) => h.hash));
    expect(r.hashes.firstTick).toBe(10);
    expect(r.hashes.regionNames).toEqual(rec.regionNames);
    expect(r.hashes.subFirstTick).toBe(100);
    expect(r.hashes.subHashes.length).toBe((TICKS / 100) * rec.regionNames.length);
    const rc = rec.regionNames.length;
    for (let k = 0; k < rec.subRows.length; k++) expect(r.hashes.subHashes.subarray(k * rc, k * rc + rc)).toEqual(rec.subRows[k]);
    // MARK: cheat spawn at tick 1
    expect(r.marks).toEqual(log.marks.map((m) => ({ tick: m.tick, kind: m.kind, value: m.value })));
    expect(r.marks[0]).toEqual({ tick: 1, kind: ReplayMarkKind.Cheat, value: 0 });
    // META
    expect(r.meta).toEqual({
      durationTicks: TICKS,
      endTick: TICKS,
      players: [
        { army: 0, name: 'Army 1' },
        { army: 1, name: 'Army 2' },
      ],
      result: { winner: -1, reason: 'unknown' },
      stats: { commandTicks: log.commands.length, commands: cmds.reduce((n, c) => n + c.batch[1]! + c.batch[2]! * 256, 0), hashes: 200, marks: log.marks.length },
      extra: { source: 'fafl-v2' },
    });
    // canonical + byte-identical rewrite
    expect(rewriteRtsReplay(r)).toEqual(res.bytes);
    expect(convertCommandLog(rec.log, { map: ridge, bpTable: table }).bytes).toEqual(res.bytes);
  });

  it('round-trips back to the source FAFL log and replays with the existing tooling', () => {
    const res = convertCommandLog(rec.log, { map: ridgeBytes, bpTable: table });
    expect(replayToCommandLog(res.bytes)).toEqual(rec.log);
    const replayed = replayLog(replayAsParsedLog(readRtsReplay(res.bytes)), { bpTable: table, map: ridge, keyframes: false });
    expect(replayed.mismatches).toEqual([]);
    expect(replayed.fullHash).toBe(rec.fullHash);
  });

  it('takes GAME/META overrides and merges stats/extra', () => {
    const res = convertCommandLog(rec.log, {
      map: ridge,
      bpTable: table,
      subHashes: false,
      game: { armies: [{ index: 0, kind: 0, team: 1, aixPermille: 1000, name: 'Red', aiProfile: '', faction: 'varkan' }, { index: 1, kind: 1, team: 2, aixPermille: 1200, name: 'Blue', aiProfile: 'turtle', faction: 'varkan' }] },
      meta: { result: { winner: 1, reason: 'acu-killed' }, extra: { scenario: 'ridge' }, stats: { apm0: 120 } },
    });
    const r = readRtsReplay(res.bytes);
    expect(r.game.armies.map((a) => a.name)).toEqual(['Red', 'Blue']);
    expect(r.meta!.players).toEqual([
      { army: 0, name: 'Red' },
      { army: 1, name: 'Blue' },
    ]);
    expect(r.meta!.result).toEqual({ winner: 1, reason: 'acu-killed' });
    expect(r.meta!.extra).toEqual({ scenario: 'ridge', source: 'fafl-v2' });
    expect(r.meta!.stats.apm0).toBe(120);
    expect(r.meta!.stats.hashes).toBe(200);
    // subHashes: false → no re-simulation, no sub-hashes, not verified
    expect(res.verified).toBe(false);
    expect(res.compared).toBe(0);
    expect(r.head.subHashInterval).toBe(0);
    expect(r.hashes.regionNames).toEqual([]);
    expect(r.hashes.hashes.length).toBe(200);
  });

  it('refuses a wrong map and warns without one', () => {
    const setons = new Uint8Array(readFileSync(fileURLToPath(new URL('content/maps/setons.rtsmap', REPO))));
    expect(() => convertCommandLog(rec.log, { map: setons, bpTable: table })).toThrow(CommandLogError);
    const res = convertCommandLog(rec.log, { bpTable: table });
    expect(res.verified).toBe(false);
    expect(res.warnings.some((w) => w.includes('not the test plane'))).toBe(true);
    const r = readRtsReplay(res.bytes);
    expect(r.game.mapName).toBe('unknown');
    expect(r.hashes.subHashes.length).toBe(0);
    expect(r.hashes.hashes.length).toBe(200);
  });

  it('reports hash mismatches but still converts (sub-hashes only before the first mismatch)', () => {
    // Corrupt the recorded hash of tick 1100 (with a valid entry check).
    const log = rec.log.slice();
    const parsed = parseCommandLog(log);
    const dv = new DataView(log.buffer);
    let p = parseLogHeader(log).headerBytes;
    while (p < parsed.validBytes) {
      const kind = dv.getUint8(p);
      const tick = dv.getUint32(p + 4, true);
      const len = dv.getUint32(p + 8, true);
      if (kind === 3 && tick === 1100) {
        dv.setUint32(p + 16, dv.getUint32(p + 16, true) ^ 0x10, true);
        dv.setUint32(p + 12, entryCheck(kind, 0, 0, tick, log, p + 16, 4), true);
      }
      p += LOG_ENTRY_HEADER_BYTES + align4(len);
    }
    const res = convertCommandLog(log, { map: ridge, bpTable: table });
    expect(res.verified).toBe(false);
    expect(res.mismatches.map((m) => m.tick)).toEqual([1100]);
    expect(res.compared).toBe(200);
    const r = readRtsReplay(res.bytes);
    expect(r.hashes.subHashes.length).toBe(10 * rec.regionNames.length); // rows 100 … 1000
    expect(r.hashes.hashes.length).toBe(200);
  });
});

describe('convertCommandLog: golden logs (test/golden-replays/logs)', () => {
  const dir = new URL('test/golden-replays/logs/', REPO);
  const names = readdirSync(fileURLToPath(dir))
    .filter((n) => n.endsWith('.faflog'))
    .sort();

  function mapFor(logBytes: Uint8Array): Uint8Array | undefined {
    const h = parseLogHeader(logBytes).header;
    if (mapSimHash(createTestPlaneMap(h.mapSizeWu)) >>> 0 === h.mapSimHash) return undefined;
    for (const f of readdirSync(fileURLToPath(new URL('content/maps/', REPO)))) {
      if (!f.endsWith('.rtsmap')) continue;
      const b = new Uint8Array(readFileSync(fileURLToPath(new URL(`content/maps/${f}`, REPO))));
      if (mapSimHash(readRtsMap(b)) >>> 0 === h.mapSimHash) return b;
    }
    throw new Error('no map for golden log');
  }

  it('finds the golden logs', () => {
    expect(names.length).toBeGreaterThanOrEqual(5);
  });

  it.each(names)('%s converts verified and plays back to the golden end hashes', (name) => {
    const log = new Uint8Array(readFileSync(fileURLToPath(new URL(name, dir))));
    const golden = JSON.parse(readFileSync(fileURLToPath(new URL(`tools/headless/goldens/${name.replace('.faflog', '.json')}`, REPO)), 'utf8')) as {
      finalRuleHash: string;
      finalFullHash: string;
      trail: string[];
    };
    const map = mapFor(log);
    const res = convertCommandLog(log, { ...(map !== undefined ? { map } : {}), bpTable: table, meta: { extra: { scenario: name } } });
    expect(res.warnings).toEqual([]);
    expect(res.verified).toBe(true);
    expect(res.compared).toBe(golden.trail.length);
    const r = readRtsReplay(res.bytes, { verifyBlocks: true });
    expect(r.head.flags).toBe(ReplayFlags.Tainted | ReplayFlags.Complete);
    expect(Array.from(r.hashes.hashes, (h) => `0x${h.toString(16).padStart(8, '0')}`)).toEqual(golden.trail);
    expect(r.hashes.subHashes.length).toBe(20 * r.hashes.regionNames.length);
    expect(replayToCommandLog(r)).toEqual(log);
    const v = verifyReplay(r, { ...(map !== undefined ? { map } : {}), bpTable: table });
    expect(v.divergences).toEqual([]);
    expect(v.compared).toBe(golden.trail.length);
    expect(v.subCompared).toBe(20);
    expect(`0x${v.ruleHash.toString(16).padStart(8, '0')}`).toBe(golden.finalRuleHash);
    expect(`0x${v.fullHash.toString(16).padStart(8, '0')}`).toBe(golden.finalFullHash);
  }, 60_000);
});

describe('convertCommandLog: crash logs', () => {
  it('a log cut at any byte becomes a valid Truncated replay verified up to the cut', () => {
    const full = parseCommandLog(rec.log);
    const headerBytes = parseLogHeader(rec.log).headerBytes;
    fc.assert(
      fc.property(fc.integer({ min: headerBytes, max: rec.log.length - 1 }), (cutAt) => {
        const cutLog = rec.log.slice(0, cutAt);
        const res = convertCommandLog(cutLog, { map: ridge, bpTable: table });
        const r = readRtsReplay(res.bytes, { verifyBlocks: true });
        expect(res.truncatedSource).toBe(true);
        expect(r.head.flags & ReplayFlags.Truncated).toBe(ReplayFlags.Truncated);
        expect(r.head.flags & ReplayFlags.Complete).toBe(0);
        expect(res.verified).toBe(true);
        const parsed = parseCommandLog(cutLog);
        expect(res.lastTick).toBe(parsed.lastTick);
        expect(r.meta!.endTick).toBe(parsed.lastTick);
        const hashesUpTo = full.hashes.filter((h) => h.tick <= parsed.lastTick).length;
        expect(res.compared).toBe(hashesUpTo);
        expect(r.hashes.hashes.length).toBe(hashesUpTo);
        expect(r.hashes.subHashes.length).toBe(Math.floor(parsed.lastTick / 100) * rec.regionNames.length);
        const cmds = readAllCommands(r);
        expect(cmds.map((c) => c.tick)).toEqual(parsed.commands.map((c) => c.tick));
        // The cheat spawn of tick 1 taints as soon as its commands survived (mark restored if torn off).
        expect((r.head.flags & ReplayFlags.Tainted) !== 0).toBe(cmds.length > 0);
        expect(r.marks.some((m) => m.tick === 1 && m.kind === ReplayMarkKind.Cheat)).toBe(cmds.length > 0);
      }),
      { numRuns: 50, seed: 0x7a11 },
    );
  }, 120_000);

  it('a malformed tick stamp cuts the replay before that tick', () => {
    const log = rec.log.slice();
    const dv = new DataView(log.buffer);
    const parsed = parseCommandLog(log);
    const e = parsed.commands.find((c) => c.tick === 1100)!;
    dv.setUint32(e.offset + 3, 1101, true); // first envelope's tick
    const p = e.offset - LOG_ENTRY_HEADER_BYTES;
    dv.setUint32(p + 12, entryCheck(1, 0, 0, 1100, log, e.offset, e.length), true);
    const res = convertCommandLog(log, { map: ridge, bpTable: table });
    expect(res.truncatedSource).toBe(true);
    expect(res.lastTick).toBe(1099);
    expect(res.verified).toBe(true);
    expect(res.warnings.some((w) => w.includes('stamped with tick 1101'))).toBe(true);
    const r = readRtsReplay(res.bytes);
    expect(r.head.flags).toBe(ReplayFlags.Tainted | ReplayFlags.Truncated);
    expect(readAllCommands(r).at(-1)!.tick).toBe(1000);
  });
});

describe('convertCommandLog: marks and taint', () => {
  it('sim-host MarkKind equals formats ReplayMarkKind (1–7)', () => {
    const entries = Object.entries(MarkKind);
    expect(entries.length).toBe(7);
    for (const [k, v] of entries) expect(ReplayMarkKind[k as keyof typeof ReplayMarkKind]).toBe(v);
    expect(ReplayMarkKind.AiTimeout).toBe(8);
  });

  it('a log without cheats is not tainted; host marks are kept 1:1; a cheat taints', () => {
    const sim = new HeadlessSim({ bpTable: table, seed: 7, armyCount: 2, keyframes: false });
    for (let t = 1; t <= 300; t++) {
      if (t % 50 === 0) sim.submit([stopCmd(0, [], t & 0xffff)]);
      sim.step(1);
      if (t === 120) sim.recorder!.mark(t, MarkKind.Pause, 0);
      if (t === 120) sim.recorder!.mark(t, MarkKind.Speed, 2000);
      if (t === 121) sim.recorder!.mark(t, MarkKind.Resume, 0);
      if (t === 200) sim.recorder!.mark(t, MarkKind.Step, 5);
    }
    const clean = convertCommandLog(sim.exportLog(), { bpTable: table });
    expect(clean.verified).toBe(true);
    const r = readRtsReplay(clean.bytes);
    expect(r.head.flags).toBe(ReplayFlags.Complete);
    expect(r.game.mapName).toBe('testplane');
    expect(r.marks).toEqual([
      { tick: 120, kind: ReplayMarkKind.Pause, value: 0 },
      { tick: 120, kind: ReplayMarkKind.Speed, value: 2000 },
      { tick: 121, kind: ReplayMarkKind.Resume, value: 0 },
      { tick: 200, kind: ReplayMarkKind.Step, value: 5 },
    ]);
    sim.submit([spawnCmd(1, 3, 100, 100, 5, 999)]);
    sim.step(1);
    const dirty = readRtsReplay(convertCommandLog(sim.exportLog(), { bpTable: table }).bytes);
    expect(dirty.head.flags & ReplayFlags.Tainted).toBe(ReplayFlags.Tainted);
    expect(dirty.marks.at(-1)).toEqual({ tick: 301, kind: ReplayMarkKind.Cheat, value: 1 });
  });
});

describe('convertCommandLog: logs of other builds', () => {
  it('converts a FAFL v1 (MS1) log without re-simulation', () => {
    // Rebuild the header in the v1 layout (no mapSimHash, buildHash at 32).
    const v2 = rec.log;
    const { header, headerBytes } = parseLogHeader(v2);
    const bh = new TextEncoder().encode(header.buildHash);
    const v1HeaderBytes = align4(LOG_V1_FIXED_HEADER_BYTES + bh.length);
    const v1 = new Uint8Array(v1HeaderBytes + v2.length - headerBytes);
    v1.set(v2.subarray(0, LOG_V1_FIXED_HEADER_BYTES), 0);
    const dv = new DataView(v1.buffer);
    dv.setUint16(4, 1, true);
    dv.setUint16(6, v1HeaderBytes, true);
    v1.set(bh, LOG_V1_FIXED_HEADER_BYTES);
    v1.set(v2.subarray(headerBytes), v1HeaderBytes);
    const res = convertCommandLog(v1, { bpTable: table });
    expect(res.sourceLogVersion).toBe(1);
    expect(res.verified).toBe(false);
    expect(res.warnings.length).toBeGreaterThanOrEqual(2);
    const r = readRtsReplay(res.bytes);
    expect(r.head.sourceLogVersion).toBe(1);
    expect(r.head.simBuild).toBe(UNKNOWN_SIM_BUILD);
    expect(r.head.subHashInterval).toBe(0);
    expect(r.game.mapName).toBe('testplane');
    expect(readAllCommands(r).length).toBe(parseCommandLog(v2).commands.length);
  });

  it('names the earlier SIM_BUILD that reproduces a foreign simId', () => {
    const log = rec.log.slice();
    const { header } = parseLogHeader(log);
    const old = computeSimId('faf-sim/ms1.2', header.bpSimHash, header.mapSimHash, MOD_LIST) >>> 0;
    new DataView(log.buffer).setUint32(8, old, true);
    const res = convertCommandLog(log, { map: ridge, bpTable: table });
    expect(res.verified).toBe(false);
    expect(res.warnings[0]).toContain('faf-sim/ms1.2');
    const r = readRtsReplay(res.bytes);
    expect(r.head.simBuild).toBe('faf-sim/ms1.2');
    expect(r.head.simId).toBe(old);
    expect(r.hashes.subHashes.length).toBe(0);
  });

  it('rejects input that is not a command log', () => {
    expect(() => convertCommandLog(new Uint8Array(64))).toThrow(CommandLogError);
  });

  it('KNOWN_SIM_BUILDS lists the current SIM_BUILD last (extend it on every SIM_BUILD bump)', () => {
    // Fails on the first SIM_BUILD bump that forgets the list: the next bump would otherwise name
    // logs of the forgotten build 'unknown'.
    expect(KNOWN_SIM_BUILDS[KNOWN_SIM_BUILDS.length - 1]).toBe(SIM_BUILD);
    expect(new Set(KNOWN_SIM_BUILDS).size).toBe(KNOWN_SIM_BUILDS.length);
    // Append-only history: the MS1/MS2 builds stay in front, in order.
    expect(KNOWN_SIM_BUILDS.slice(0, 3)).toEqual(['faf-sim/ms1.1', 'faf-sim/ms1.2', 'faf-sim/ms2.0']);
    const { header } = parseLogHeader(rec.log);
    for (const b of KNOWN_SIM_BUILDS) expect(identifySimBuild(computeSimId(b, header.bpSimHash, header.mapSimHash, MOD_LIST), header.bpSimHash, header.mapSimHash)).toBe(b);
  });
});
