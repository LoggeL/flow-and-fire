/**
 * ReplayPlayer / verifyReplay / RtsReplaySource (TRACK-REPLAY p4): playback equals the
 * recording, divergences name tick and table, incompatible replays are refused before the first
 * tick, GAME alliances are applied.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { decodeSimBin, type SimBpTable } from '@faf/blueprints/simbin';
import { fx } from '@faf/fixed';
import {
  decodeCmdsBlock,
  FormatError,
  readAllCommands,
  readContainer,
  readRtsMap,
  readRtsReplay,
  ReplayFlags,
  replayMetaToCanonicalJson,
  RTSREPLAY_FORMAT_VERSION,
  RTSREPLAY_MAGIC,
  rtsReplayToInput,
  writeContainer,
  writeRtsReplay,
  type RtsReplayInput,
} from '@faf/formats';
import { COMMAND_BATCH_VERSION, decodeBatch, encodeBatch, encodeMove, Op, type CommandEnvelope } from '@faf/protocol';
import { isAllied, setAlliance, unitHandles, type World } from '@faf/sim';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  addHashListener,
  allianceMatrixOf,
  checkReplayCompat,
  convertCommandLog,
  hashListenerCount,
  HeadlessSim,
  parseCommandLog,
  replayBuildIncompatibility,
  ReplayCompatError,
  replayPlaybackEnd,
  ReplayPlayer,
  RtsReplaySource,
  SIM_BUILD,
  verifyReplay,
} from '../src/index.ts';
import { gameSimBin, hollowRidgeBytes, moveCmd, spawnCmd } from './support/fixtures.ts';

const TICKS = 2000;
const SEED = 0x2b1a7e11;
const BUILD = 'c0ffee42';

let table: SimBpTable;
let ridge: Uint8Array;

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
}

function record(setup?: (w: World) => void): Recording {
  const sim = new HeadlessSim({ bpTable: table, seed: SEED, armyCount: 2, map: ridge, keyframes: false, buildHash: BUILD });
  setup?.(sim.world);
  while (sim.tick < TICKS) {
    const t = sim.tick + 1;
    const cmds = ridgeCommands(sim.world, t);
    if (cmds.length > 0) sim.submit(cmds);
    sim.step(1);
  }
  return { log: sim.exportLog(), ruleHash: sim.ruleHash(), fullHash: sim.fullHash() };
}

let rec: Recording;
let replayBytes: Uint8Array;

function modified(edit: (input: RtsReplayInput) => RtsReplayInput): Uint8Array {
  return writeRtsReplay(edit(rtsReplayToInput(readRtsReplay(replayBytes))));
}

/** Rewrites the container of `bytes` with `edit` applied to copies of its chunks (byte-level manipulation). */
function patched(bytes: Uint8Array, edit: (chunks: { id: string; data: Uint8Array }[]) => void, formatVersion = RTSREPLAY_FORMAT_VERSION): Uint8Array {
  const chunks = readContainer(bytes, RTSREPLAY_MAGIC).chunks.map((c) => ({ id: c.id, data: c.data.slice() }));
  edit(chunks);
  return writeContainer(RTSREPLAY_MAGIC, formatVersion, chunks);
}

function compatErrorOf(fn: () => unknown): ReplayCompatError {
  try {
    fn();
  } catch (e) {
    if (e instanceof ReplayCompatError) return e;
    throw e;
  }
  throw new Error('expected a ReplayCompatError');
}

beforeAll(() => {
  table = decodeSimBin(gameSimBin());
  ridge = hollowRidgeBytes();
  rec = record();
  const res = convertCommandLog(rec.log, { map: ridge, bpTable: table });
  expect(res.verified).toBe(true);
  replayBytes = res.bytes;
});

describe('ReplayPlayer', () => {
  it('playToEnd equals the recording: no divergences, same end rule/full hash', () => {
    const player = ReplayPlayer.open(replayBytes, { map: ridge, bpTable: table });
    expect(player.tick).toBe(0);
    expect(player.endTick).toBe(TICKS);
    expect(player.keyframes.count).toBe(1);
    const v = player.playToEnd();
    expect(v).toEqual({
      endTick: TICKS,
      compared: TICKS / 10,
      subCompared: TICKS / 100,
      recordedUpTo: TICKS / 10,
      subRecordedUpTo: TICKS / 100,
      fullyCompared: true,
      divergences: [],
      ruleHash: rec.ruleHash,
      fullHash: rec.fullHash,
      tainted: true,
      complete: true,
      truncated: false,
    });
    expect(player.keyframes.count).toBe(4); // 0, 600, 1200, 1800
    expect(player.step(5)).toBe(0); // never past the end
    expect(player.sim!.hashTrail().length).toBe(TICKS / 10);
    expect(player.warnings).toEqual([]);
  });

  it('step/runUntil advance tick by tick and stop at the end', () => {
    const player = ReplayPlayer.open(readRtsReplay(replayBytes), { map: ridge, bpTable: table, keyframes: false });
    expect(player.step(7)).toBe(7);
    expect(player.runUntil(1234)).toBe(1227);
    expect(player.tick).toBe(1234);
    expect(player.runUntil(5000)).toBe(TICKS - 1234);
    expect(player.result().divergences).toEqual([]);
    expect(player.fullHash()).toBe(rec.fullHash);
  });

  it('a manipulated HASH entry at 1,100 gives exactly one divergence at 1,100', () => {
    const bytes = modified((inp) => {
      const hashes = inp.hashes.hashes.slice();
      const i = (1100 - inp.hashes.firstTick) / inp.hashes.interval;
      hashes[i] = (hashes[i]! ^ 0x00010000) >>> 0;
      return { ...inp, hashes: { ...inp.hashes, hashes } };
    });
    const v = verifyReplay(bytes, { map: ridge, bpTable: table });
    expect(v.divergences.length).toBe(1);
    const d = v.divergences[0]!;
    expect(d.tick).toBe(1100);
    expect(d.kind).toBe('rule');
    expect(d.expected).toBe((d.actual ^ 0x00010000) >>> 0);
    expect(d.regions).toEqual([]); // the sub-hashes of 1,100 all match: only the record is wrong
    expect(v.fullHash).toBe(rec.fullHash);
  });

  it('a manipulated move target at 1,100 diverges from 1,100 on and names the tables', () => {
    const bytes = modified((inp) => ({
      ...inp,
      commands: inp.commands.map((c) => {
        if (c.tick !== 1100) return c;
        const envs = decodeBatch(c.batch);
        const i = envs.findIndex((e) => e.op === Op.Move && e.army === 0);
        envs[i] = { ...envs[i]!, payload: encodeMove({ x: fx(30), y: fx(0), z: fx(210) }) };
        return { tick: c.tick, batch: encodeBatch(envs) };
      }),
    }));
    const v = verifyReplay(bytes, { map: ridge, bpTable: table });
    expect(v.divergences.length).toBeGreaterThan(0);
    const first = v.divergences[0]!;
    expect(first.tick).toBeGreaterThanOrEqual(1100);
    expect(first.tick).toBeLessThan(1200);
    expect(first.kind).toBe('rule');
    expect(first.regions.length).toBeGreaterThan(0);
    expect(first.regions.some((r) => r === 'units' || r === 'movers')).toBe(true);
    // Every region name is a rule region of the layout.
    for (const r of first.regions) expect(readRtsReplay(bytes).hashes.regionNames).toContain(r);
    // Nothing diverges before the manipulated tick.
    expect(v.divergences.every((d) => d.tick >= 1100)).toBe(true);
  });

  it('refuses a wrong map before the first tick', () => {
    const setons = new Uint8Array(readFileSync(fileURLToPath(new URL('../../../content/maps/setons.rtsmap', import.meta.url))));
    let err: unknown;
    try {
      ReplayPlayer.open(replayBytes, { map: setons, bpTable: table });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ReplayCompatError);
    const ce = err as ReplayCompatError;
    expect(ce.reason).toBe('map');
    expect(ce.buildHash).toBe(BUILD);
    expect(ce.message).toContain(`/b/${BUILD}/`);
    // Without a map the test plane is used, which is not hollow-ridge either.
    expect(() => ReplayPlayer.open(replayBytes, { bpTable: table })).toThrow(ReplayCompatError);
  });

  it('refuses another SIM_BUILD, simId or layout with the /b/<buildHash>/ redirect', () => {
    const cases: [string, (inp: RtsReplayInput) => RtsReplayInput][] = [
      ['sim-build', (inp) => ({ ...inp, head: { ...inp.head, simBuild: 'faf-sim/ms9.9' } })],
      ['sim-id', (inp) => ({ ...inp, head: { ...inp.head, simId: (inp.head.simId ^ 1) >>> 0 } })],
      ['layout', (inp) => ({ ...inp, head: { ...inp.head, layoutHash: (inp.head.layoutHash ^ 1) >>> 0 } })],
    ];
    for (const [reason, edit] of cases) {
      const bytes = modified(edit);
      let err: unknown;
      try {
        ReplayPlayer.open(bytes, { map: ridge, bpTable: table });
      } catch (e) {
        err = e;
      }
      expect(err, reason).toBeInstanceOf(ReplayCompatError);
      expect((err as ReplayCompatError).reason).toBe(reason);
      expect((err as ReplayCompatError).redirect).toBe(`/b/${BUILD}/`);
      expect((err as Error).message).toContain(`/b/${BUILD}/`);
    }
    const old = readRtsReplay(modified(cases[0]![1]));
    expect(() => verifyReplay(old, { map: ridge, bpTable: table })).toThrow(/faf-sim\/ms9\.9/);
    expect(SIM_BUILD).not.toBe('faf-sim/ms9.9');
  });

  it('refuses other protocol, format and chunk versions from the tolerant head with the redirect', () => {
    const variants: [string, 'protocol' | 'format', Uint8Array][] = [
      ['older protocol', 'protocol', patched(replayBytes, (cs) => new DataView(cs[0]!.data.buffer).setUint16(4, COMMAND_BATCH_VERSION - 1, true))],
      ['newer protocol', 'protocol', patched(replayBytes, (cs) => new DataView(cs[0]!.data.buffer).setUint16(4, COMMAND_BATCH_VERSION + 1, true))],
      [
        'newer HEAD version (field appended)',
        'format',
        patched(replayBytes, (cs) => {
          const d = new Uint8Array(cs[0]!.data.length + 4);
          d.set(cs[0]!.data);
          d[0] = 2;
          cs[0] = { id: 'HEAD', data: d };
        }),
      ],
      ['newer CMDS version', 'format', patched(replayBytes, (cs) => void (cs.find((c) => c.id === 'CMDS')!.data[0] = 2))],
      ['newer format version', 'format', patched(replayBytes, () => undefined, RTSREPLAY_FORMAT_VERSION + 1)],
    ];
    for (const [what, reason, bytes] of variants) {
      // The strict reader cannot parse them …
      expect(() => readRtsReplay(bytes), what).toThrow(FormatError);
      // … the player and verifyReplay name the build instead of failing with a FormatError.
      for (const fn of [() => ReplayPlayer.open(bytes, { map: ridge, bpTable: table }), () => verifyReplay(bytes, { map: ridge, bpTable: table }), () => checkReplayCompat(bytes)]) {
        const e = compatErrorOf(fn);
        expect(e.reason, what).toBe(reason);
        expect(e.redirect).toBe(`/b/${BUILD}/`);
        expect(e.simBuild).toBe(SIM_BUILD);
      }
    }
    expect(checkReplayCompat(replayBytes).buildHash).toBe(BUILD);
    const foreign = modified((inp) => ({ ...inp, head: { ...inp.head, simBuild: 'faf-sim/ms0.1' } }));
    const older = patched(foreign, (cs) => new DataView(cs[0]!.data.buffer).setUint16(4, COMMAND_BATCH_VERSION - 1, true));
    expect(compatErrorOf(() => ReplayPlayer.open(older, { map: ridge, bpTable: table })).reason).toBe('sim-build');
    expect(replayBuildIncompatibility({ ...checkReplayCompat(replayBytes), protocolVersion: COMMAND_BATCH_VERSION + 1 })?.reason).toBe('protocol');
  });

  it('plays to the end of the content: a shortened META is refused, an inflated one is clamped', () => {
    const withMetaEnd = (endTick: number): Uint8Array =>
      patched(replayBytes, (cs) => {
        const i = cs.findIndex((c) => c.id === 'META');
        const meta = readRtsReplay(replayBytes).meta!;
        const t = new TextEncoder().encode(replayMetaToCanonicalJson({ ...meta, endTick }));
        const d = new Uint8Array(2 + t.length);
        d[0] = 1;
        d.set(t, 2);
        cs[i] = { id: 'META', data: d };
      });
    // Shortened (500 of 2,000 ticks): the recorded hashes after 500 would never be compared.
    const short = withMetaEnd(500);
    expect(() => readRtsReplay(short)).toThrow(expect.objectContaining({ code: 'bad-value', chunkId: 'META' }));
    expect(() => ReplayPlayer.open(short, { map: ridge, bpTable: table })).toThrow(FormatError);
    // Inflated to 2³²−1: META is ignored, playback stops at the content, with a warning.
    const huge = withMetaEnd(0xffffffff);
    const replay = readRtsReplay(huge);
    expect(replayPlaybackEnd(replay)).toEqual({ endTick: TICKS, contentEndTick: TICKS, metaEndTick: 0xffffffff, metaClamped: true });
    const player = ReplayPlayer.open(huge, { map: ridge, bpTable: table, keyframes: false });
    expect(player.endTick).toBe(TICKS);
    expect(player.warnings.join('\n')).toMatch(/META\.endTick 4294967295/);
    const v = player.playToEnd();
    expect(v).toMatchObject({ endTick: TICKS, compared: TICKS / 10, subCompared: TICKS / 100, fullyCompared: true, divergences: [] });
    // Idle ticks after the last hash within one hash interval stay playable.
    expect(replayPlaybackEnd(readRtsReplay(withMetaEnd(TICKS + 9))).endTick).toBe(TICKS + 9);
    expect(replayPlaybackEnd(readRtsReplay(withMetaEnd(TICKS + 10))).endTick).toBe(TICKS);
  });

  it('attach: plays through a given core, ticks driven outside the player, listeners coexist', () => {
    const replay = readRtsReplay(replayBytes);
    const source = new RtsReplaySource(replay);
    const session = new HeadlessSim({ bpTable: table, seed: replay.game.seed, armyCount: 2, map: ridge, buildHash: BUILD, record: false, keyframes: false, sources: [source] });
    const core = session.core;
    // A listener assigned directly before (e.g. a debug tool) and one added through the fan-out.
    let direct = 0;
    let added = 0;
    core.onHash = (): void => void direct++;
    const remove = addHashListener(core, () => void added++);
    const player = ReplayPlayer.attach(core, source, { keyframes: { intervalTicks: 600 } });
    expect(player.sim).toBeNull();
    expect(hashListenerCount(core)).toBe(3);
    // External driver (MS11 scheduler) for the first half …
    while (core.tick < 1000) {
      expect(core.runTick()).toBe(true);
      player.observeTick();
    }
    // … then the player itself, incl. a backward seek.
    player.runUntil(1500);
    player.seek(700);
    const v = player.playToEnd();
    expect(v).toMatchObject({ endTick: TICKS, compared: TICKS / 10, subCompared: TICKS / 100, fullyCompared: true, divergences: [], fullHash: rec.fullHash });
    expect(player.restores).toBe(1);
    expect(direct).toBe(added);
    expect(added).toBeGreaterThan(TICKS / 10); // re-simulated ticks after the seek fire again
    remove();
    player.detach();
    expect(hashListenerCount(core)).toBe(1);
    // Preconditions.
    expect(() => ReplayPlayer.attach(core, source)).toThrow(/tick/);
    const recording = new HeadlessSim({ bpTable: table, seed: replay.game.seed, armyCount: 2, map: ridge, keyframes: false, sources: [new RtsReplaySource(replay)] });
    expect(() => ReplayPlayer.attach(recording.core, recording.core.sources[0] as RtsReplaySource)).toThrow(/record/);
    const other = new HeadlessSim({ bpTable: table, seed: replay.game.seed, armyCount: 2, map: ridge, record: false, keyframes: false, sources: [new RtsReplaySource(replay)] });
    expect(() => ReplayPlayer.attach(other.core, source)).toThrow(/source/);
    const plane = new RtsReplaySource(replay);
    const wrongMap = new HeadlessSim({ bpTable: table, seed: replay.game.seed, armyCount: 2, record: false, keyframes: false, sources: [plane] });
    expect(compatErrorOf(() => ReplayPlayer.attach(wrongMap.core, plane)).reason).toBe('map');
  });

  it('applies the GAME alliance matrix before tick 1', () => {
    const allied = record((w) => setAlliance(w, 0, 1, true));
    expect(allied.ruleHash).not.toBe(rec.ruleHash);
    // Without the alliance in GAME the recorded hashes are not reproduced …
    expect(convertCommandLog(allied.log, { map: ridge, bpTable: table }).verified).toBe(false);
    // … with it they are, and the player applies it.
    const probe = new HeadlessSim({ bpTable: table, seed: SEED, armyCount: 2, map: ridge, record: false, keyframes: false });
    setAlliance(probe.world, 0, 1, true);
    const res = convertCommandLog(allied.log, { map: ridge, bpTable: table, game: { alliances: allianceMatrixOf(probe.world) } });
    expect(res.verified).toBe(true);
    const player = ReplayPlayer.open(res.bytes, { map: ridge, bpTable: table });
    expect(isAllied(player.world, 0, 1)).toBe(true);
    expect(isAllied(player.world, 1, 0)).toBe(true);
    expect(isAllied(player.world, 0, 2)).toBe(false);
    const v = player.playToEnd();
    expect(v.divergences).toEqual([]);
    expect(v.fullHash).toBe(allied.fullHash);
    // An asymmetric matrix cannot be represented by the sim.
    const asym = new Uint8Array(allianceMatrixOf(probe.world));
    asym[(1 * 16 + 0) >>> 3]! &= ~(1 << ((1 * 16 + 0) & 7));
    const bad = writeRtsReplay({ ...rtsReplayToInput(readRtsReplay(res.bytes)), game: { ...readRtsReplay(res.bytes).game, alliances: asym } });
    expect(() => ReplayPlayer.open(bad, { map: ridge, bpTable: table })).toThrow(expect.objectContaining({ reason: 'alliances' }));
  });

  it('verify: false skips the hash comparison', () => {
    const bytes = modified((inp) => ({ ...inp, hashes: { ...inp.hashes, hashes: inp.hashes.hashes.map((h) => (h ^ 1) >>> 0) } }));
    const player = ReplayPlayer.open(bytes, { map: ridge, bpTable: table, verify: false, keyframes: false });
    const v = player.playToEnd();
    expect(v.compared).toBe(0);
    expect(v.divergences).toEqual([]);
    expect(v.fullHash).toBe(rec.fullHash);
    const sub = ReplayPlayer.open(replayBytes, { map: ridge, bpTable: table, subHashCheck: false, keyframes: false }).playToEnd();
    expect(sub.subCompared).toBe(0);
    expect(sub.compared).toBe(200);
  });

  it('reports sub-hash-only divergences with their regions', () => {
    const bytes = modified((inp) => {
      const subHashes = inp.hashes.subHashes.slice();
      const rc = inp.hashes.regionNames.length;
      const units = inp.hashes.regionNames.indexOf('units');
      const k = (700 - inp.hashes.subFirstTick) / inp.hashes.subInterval;
      subHashes[k * rc + units] = (subHashes[k * rc + units]! + 1) >>> 0;
      return { ...inp, hashes: { ...inp.hashes, subHashes } };
    });
    const v = verifyReplay(bytes, { map: ridge, bpTable: table });
    expect(v.divergences).toEqual([{ tick: 700, expected: v.divergences[0]!.actual, actual: v.divergences[0]!.actual, regions: ['units'], kind: 'sub' }]);
  });
});

describe('RtsReplaySource', () => {
  it('hands out the recorded batches with at most two decoded blocks, also backwards', () => {
    const replay = readRtsReplay(replayBytes);
    const log = parseCommandLog(rec.log);
    const src = new RtsReplaySource(replay);
    expect(src.pending(1)).toBe(false);
    expect(src.lastTick).toBe(TICKS);
    const byTick = new Map(log.commands.map((c) => [c.tick, log.bytes.subarray(c.offset, c.offset + c.length)]));
    for (let t = 0; t <= TICKS + 5; t++) {
      const b = src.batchFor(t);
      const want = byTick.get(t);
      if (want === undefined) expect(b).toBeNull();
      else expect(b).toEqual(want);
    }
    const nonEmpty = replay.blocks.filter((b) => b.entryCount > 0).length;
    expect(src.blockDecodes).toBe(nonEmpty);
    // backwards across blocks: one decode for the far block, the two recent ones stay cached
    expect(src.batchFor(1100)).toEqual(byTick.get(1100));
    expect(src.batchFor(1200)).toEqual(byTick.get(1200));
    const before = src.blockDecodes;
    expect(src.batchFor(100)).toEqual(byTick.get(100));
    expect(src.blockDecodes).toBe(before + 1);
    expect(src.batchFor(1100)).toEqual(byTick.get(1100));
    expect(src.blockDecodes).toBe(before + 2); // block 1 was evicted by block 0
    expect(src.batchFor(150)).toEqual(byTick.get(150) ?? null);
    expect(src.blockDecodes).toBe(before + 2);
    // commandsFor decodes envelopes; expected hashes are the recorded ones
    const envs = src.commandsFor(1100 as never);
    expect(envs).toEqual(decodeBatch(byTick.get(1100)!));
    for (const h of log.hashes) expect(src.expectedHash(h.tick)).toBe(h.hash);
    expect(src.expectedHash(15)).toBe(-1);
    expect(src.expectedHash(TICKS + 10)).toBe(-1);
    expect(src.expectedSubHashes(100)!.length).toBe(replay.hashes.regionNames.length);
    expect(src.expectedSubHashes(150)).toBeNull();
    expect(src.subHashRow(TICKS)).toBe(TICKS / 100 - 1);
    // All commands are reachable through the blocks.
    expect(readAllCommands(replay).length).toBe(log.commands.length);
    expect(decodeCmdsBlock(replay.blocks[0]!)[0]!.tick).toBe(1);
  });

  it('derives the end tick without META', () => {
    const inp = rtsReplayToInput(readRtsReplay(replayBytes));
    const noMeta = readRtsReplay(writeRtsReplay({ ...inp, meta: null }));
    expect(new RtsReplaySource(noMeta).lastTick).toBe(TICKS);
    expect(noMeta.head.flags & ReplayFlags.Complete).toBe(ReplayFlags.Complete);
    const v = verifyReplay(noMeta, { map: readRtsMap(ridge), bpTable: table });
    expect(v.endTick).toBe(TICKS);
    expect(v.divergences).toEqual([]);
  });
});
