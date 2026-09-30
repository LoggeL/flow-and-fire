/**
 * FAFL command log → .rtsreplay (PLAN §3.11, TRACK-REPLAY p4).
 *
 * The command log the host records from tick 0 (OPFS, survives a crash) is the raw material of a
 * replay. The converter maps it 1:1 and adds what the log does not have:
 *
 * - HEAD: identity from the log header (simId, bpSimHash, mapSimHash, layoutHash, buildHash,
 *   hashInterval) + SIM_BUILD (only if the log's simId is reproduced by this build; otherwise the
 *   earlier build that reproduces it, or 'unknown'), COMMAND_BATCH_VERSION, flags (Tainted from
 *   the marks, Complete with an END entry, Truncated for a crash-cut log) and sourceLogVersion.
 * - GAME: seed, map size, player army and standard armies from the header, mapName from the map
 *   (the generated test plane is 'testplane'), FFA alliances; everything overridable.
 * - CMDS: the recorded batches unchanged (validated: well-formed, envelope ticks == entry tick).
 * - HASH: the recorded rule hashes; with `subHashes` (default) the log is re-simulated
 *   (HeadlessSim on a ReplaySource of the log, no recording) and the rule-region sub-hashes are
 *   computed every 100 ticks. Every recorded rule hash is verified on the way; mismatches make
 *   `verified` false but the conversion completes (sub-hash rows are kept only before the first
 *   mismatch, so the file never claims sub-hashes of a state the recording did not have).
 * - MARK: the log marks 1:1 (sim-host MarkKind == formats ReplayMarkKind 1–7).
 * - META: end tick, players, result {winner −1, reason 'unknown'} unless given.
 *
 * Crash logs (no END entry, torn tail, or a malformed batch) become a valid replay up to the last
 * valid tick with the Truncated flag. Logs of another sim build (FAFL v1 from MS1, or a v2 log
 * after a SIM_BUILD bump) are converted without re-simulation (warnings; no sub-hashes, not
 * verified) — playing them needs the build named in HEAD (/b/<buildHash>/).
 */

import { XxHash32 } from '@faf/fixed';
import { COMMAND_BATCH_VERSION, CommandBatchView, Op, validateBatch } from '@faf/protocol';
import {
  createTestPlaneMap,
  mapSimHash,
  ReplayFlags,
  RTSREPLAY_FORMAT_VERSION,
  TEST_PLANE_MAP_NAME,
  isTaintMarkKind,
  writeRtsReplay,
  type ReplayGame,
  type ReplayHashes,
  type ReplayHead,
  type ReplayMark,
  type ReplayMeta,
  type ReplayTickCommands,
  type RtsMap,
  type RtsReplayInput,
} from '@faf/formats';
import type { SimBpTable } from '@faf/blueprints/simbin';
import { resolveMap, type HashMismatch } from '../core.ts';
import { HeadlessSim } from '../headless.ts';
import { SIM_BUILD } from '../identity.ts';
import { CommandLogError, MarkKind, parseCommandLog, type ParsedCommandLog } from '../log-format.ts';
import { ReplaySource } from '../sources.ts';
import { computeSubHashes, ruleRegionNames } from './sub-hashes.ts';
import {
  applyGameAlliances,
  armyCountOf,
  defaultAllianceMatrix,
  defaultArmies,
  identifySimBuild,
  SUB_HASH_INTERVAL_TICKS,
  UNKNOWN_SIM_BUILD,
} from './setup.ts';

export interface ConvertOptions {
  /**
   * The map the log was recorded on (parsed or .rtsmap bytes). Omitted: the generated test plane
   * if the header names it, otherwise the map is unknown (no re-simulation, warning). A map whose
   * mapSimHash differs from the log header is refused (CommandLogError).
   */
  readonly map?: RtsMap | Uint8Array;
  /** Compiled blueprints of the re-simulation (sim.bin bytes) or a decoded table. */
  readonly simBin?: Uint8Array;
  readonly bpTable?: SimBpTable;
  /** Re-simulate for sub-hashes (every 100 ticks) and hash verification (default true). */
  readonly subHashes?: boolean;
  /** GAME fields replacing the defaults derived from the log header. */
  readonly game?: Partial<ReplayGame>;
  /** META fields replacing the defaults; `stats` and `extra` are merged into the defaults. */
  readonly meta?: Partial<ReplayMeta>;
  /** DEFLATE level of the CMDS blocks (default: formats DEFAULT_DEFLATE_LEVEL, canonical). */
  readonly level?: number;
}

export interface ConvertResult {
  /** The .rtsreplay file. */
  readonly bytes: Uint8Array;
  /** The writer input the file was built from. */
  readonly input: RtsReplayInput;
  /** True if the log was re-simulated and every recorded rule hash matched. */
  readonly verified: boolean;
  /** Recorded rule hashes that the re-simulation did not reproduce. */
  readonly mismatches: HashMismatch[];
  /** Human-readable notes (foreign build, unknown map, cut tail, dropped entries …). */
  readonly warnings: string[];
  /** The source log was cut (crash): no END entry, torn tail or a malformed batch. */
  readonly truncatedSource: boolean;
  /** Recorded rule hashes compared during the re-simulation. */
  readonly compared: number;
  /** Last tick of the replay (META endTick). */
  readonly lastTick: number;
  /** FAFL version of the source log (1 = MS1, 2 = current). */
  readonly sourceLogVersion: number;
}

function hex(v: number): string {
  return `0x${(v >>> 0).toString(16).padStart(8, '0')}`;
}

function isParsedLog(x: Uint8Array | ArrayBuffer | ParsedCommandLog): x is ParsedCommandLog {
  return !(x instanceof Uint8Array) && !(x instanceof ArrayBuffer);
}

/**
 * Converts a FAFL command log (bytes or parsed) into a .rtsreplay file. Throws CommandLogError if
 * the input is not a command log (bad header) or a given map does not belong to it, FormatError
 * for a broken map file or invalid GAME/META overrides.
 */
export function convertCommandLog(log: Uint8Array | ArrayBuffer | ParsedCommandLog, options: ConvertOptions = {}): ConvertResult {
  const parsed = isParsedLog(log) ? log : parseCommandLog(log);
  const h = parsed.header;
  const warnings: string[] = [];
  if (parsed.version === 1) warnings.push('FAFL v1 log (MS1): recorded on the MS1 test plane by an MS1 sim build');

  // ---- CMDS: validate batches and tick stamps; a malformed entry cuts the log there -----------
  let lastTick = parsed.lastTick;
  let cut = false;
  const commands: ReplayTickCommands[] = [];
  const view = new CommandBatchView();
  let envelopes = 0;
  let prevTick = 0;
  /** (tick, army) of every batch with an Op.Cheat command (the recorder marks those). */
  const cheatTicks: number[] = [];
  for (const e of parsed.commands) {
    const batch = parsed.bytes.subarray(e.offset, e.offset + e.length);
    let problem: string | null = null;
    if (e.tick <= prevTick) problem = e.tick === 0 ? 'commands at tick 0' : `a second CMDS entry for tick ${e.tick}`;
    else if (validateBatch(batch) < 0) problem = `a malformed command batch at tick ${e.tick}`;
    else {
      view.reset(batch);
      while (view.next()) {
        if (view.tick !== e.tick) {
          problem = `envelope ${view.index} of tick ${e.tick} is stamped with tick ${view.tick}`;
          break;
        }
      }
    }
    if (problem !== null) {
      cut = true;
      lastTick = Math.max(0, e.tick - 1);
      warnings.push(`log cut before tick ${e.tick}: ${problem}`);
      break;
    }
    envelopes += view.count;
    view.reset(batch);
    while (view.next()) {
      if (view.op === Op.Cheat) {
        cheatTicks.push(e.tick, view.army);
        break;
      }
    }
    commands.push({ tick: e.tick, batch });
    prevTick = e.tick;
  }

  // ---- HASH (recorded rule hashes on the header's grid) ----------------------------------------
  const hashValues: number[] = [];
  let hashFirst = 0;
  const hi = h.hashInterval;
  for (const e of parsed.hashes) {
    if (e.tick > lastTick) break;
    if (hi === 0) {
      warnings.push('log header has hashInterval 0 but contains rule hashes: hashes dropped');
      break;
    }
    if (hashValues.length === 0) hashFirst = e.tick;
    else if (e.tick !== hashFirst + hashValues.length * hi) {
      warnings.push(`rule hash at tick ${e.tick} breaks the ${hi}-tick grid: later hashes dropped`);
      break;
    }
    hashValues.push(e.hash >>> 0);
  }

  // ---- MARK ---------------------------------------------------------------------------------
  // The recorder writes a Cheat mark right after every CMDS entry with an Op.Cheat command; a log
  // torn between the two gets the missing mark back, so cheated commands always taint.
  const marks: ReplayMark[] = [];
  let tainted = false;
  let ci = 0;
  const addMissingCheatMarks = (beforeTick: number): void => {
    for (; ci < cheatTicks.length && cheatTicks[ci]! < beforeTick; ci += 2) {
      const t = cheatTicks[ci]!;
      let found = false;
      for (let k = marks.length - 1; k >= 0 && marks[k]!.tick === t; k--) if (marks[k]!.kind === MarkKind.Cheat) found = true;
      if (found) continue;
      marks.push({ tick: t, kind: MarkKind.Cheat, value: cheatTicks[ci + 1]! });
      tainted = true;
      warnings.push(`Cheat mark of tick ${t} missing in the log (torn after the commands): added`);
    }
  };
  for (const m of parsed.marks) {
    if (m.tick > lastTick) break;
    addMissingCheatMarks(m.tick);
    if (m.kind < 1 || m.kind > 0xff) {
      warnings.push(`mark of kind ${m.kind} at tick ${m.tick} dropped`);
      continue;
    }
    marks.push({ tick: m.tick, kind: m.kind, value: m.value >>> 0 });
    if (isTaintMarkKind(m.kind)) tainted = true;
  }
  // Cheat ticks equal to the last mark tick are checked against that tick's marks, later ones appended.
  addMissingCheatMarks(Number.POSITIVE_INFINITY);

  // ---- identity, map ------------------------------------------------------------------------
  const build = identifySimBuild(h.simId, h.bpSimHash, h.mapSimHash);
  const sameBuild = build === SIM_BUILD;
  if (!sameBuild) {
    warnings.push(
      `log simId ${hex(h.simId)} was recorded by ${build === null ? 'an unknown sim build' : `sim build ${build}`}, not by this build: ` +
        'not re-simulated (no sub-hashes, not verified)',
    );
  }
  let map: RtsMap | null = null;
  if (options.map !== undefined) {
    map = resolveMap(options.map);
    const mh = mapSimHash(map) >>> 0;
    if (mh !== h.mapSimHash >>> 0) {
      throw new CommandLogError(`map mismatch: log mapSimHash ${hex(h.mapSimHash)} vs map '${map.meta.name}' ${hex(mh)}`);
    }
  } else if (parsed.version >= 2) {
    const plane = createTestPlaneMap(h.mapSizeWu);
    if (mapSimHash(plane) >>> 0 === h.mapSimHash >>> 0) map = plane;
    else warnings.push(`log was recorded on map ${hex(h.mapSimHash)} (not the test plane) and no map was given: not re-simulated`);
  }
  const mapName = map !== null ? map.meta.name : parsed.version === 1 ? TEST_PLANE_MAP_NAME : 'unknown';

  // ---- GAME ---------------------------------------------------------------------------------
  let playerArmy = h.playerArmy;
  if (playerArmy < -1 || playerArmy >= h.armyCount) {
    warnings.push(`log playerArmy ${playerArmy} is not an army of the game: GAME.playerArmy = −1`);
    playerArmy = -1;
  }
  const game: ReplayGame = {
    seed: h.seed >>> 0,
    mapName,
    mapSizeWu: h.mapSizeWu,
    playerArmy,
    armies: defaultArmies(h.armyCount),
    alliances: defaultAllianceMatrix(),
    ...options.game,
  };
  if (armyCountOf(game) !== h.armyCount) warnings.push(`GAME describes ${armyCountOf(game)} armies, the log ${h.armyCount}`);

  // ---- re-simulation: verify hashes, compute sub-hashes --------------------------------------
  const wantSub = options.subHashes !== false;
  const mismatches: HashMismatch[] = [];
  let compared = 0;
  let resimulated = false;
  let regionNames: string[] = [];
  const subRows: number[] = [];
  if (wantSub && sameBuild && map !== null) {
    const source = new ReplaySource(parsed);
    const sim = new HeadlessSim({
      ...(options.simBin !== undefined ? { simBin: options.simBin } : {}),
      ...(options.bpTable !== undefined ? { bpTable: options.bpTable } : {}),
      seed: h.seed,
      armyCount: h.armyCount,
      playerArmy,
      map,
      buildHash: h.buildHash,
      record: false,
      keyframes: false,
      trail: false,
      sources: [source],
    });
    if (sim.simId !== h.simId >>> 0) {
      warnings.push(`blueprints differ: log simId ${hex(h.simId)} vs re-simulation ${hex(sim.simId)} (sim.bin of another bpSimHash?): not re-simulated`);
    } else if (sim.world.layoutHash >>> 0 !== h.layoutHash >>> 0) {
      warnings.push(`arena layout differs: log ${hex(h.layoutHash)} vs re-simulation ${hex(sim.world.layoutHash)}: not re-simulated`);
    } else {
      applyGameAlliances(sim.world, game.alliances);
      regionNames = ruleRegionNames(sim.world);
      const row = new Uint32Array(regionNames.length);
      const hasher = new XxHash32();
      sim.core.onHash = (tick, hash): void => {
        const exp = source.expectedHash(tick);
        if (exp < 0 || tick > lastTick) return;
        compared++;
        if (exp !== hash) mismatches.push({ tick, expected: exp, actual: hash });
      };
      while (sim.tick < lastTick) {
        if (sim.step(1) !== 1) throw new Error('re-simulation stalled (source pending)');
        if (sim.tick % SUB_HASH_INTERVAL_TICKS === 0) {
          computeSubHashes(sim.world, row, hasher);
          for (let r = 0; r < row.length; r++) subRows.push(row[r]!);
        }
      }
      sim.core.onHash = null;
      resimulated = true;
      if (mismatches.length > 0) {
        const first = mismatches[0]!.tick;
        const keepRows = Math.max(0, Math.ceil(first / SUB_HASH_INTERVAL_TICKS) - 1);
        subRows.length = Math.min(subRows.length, keepRows * regionNames.length);
        warnings.push(
          `${mismatches.length} recorded rule hash(es) not reproduced, first at tick ${first} ` +
            `(expected ${hex(mismatches[0]!.expected)}, got ${hex(mismatches[0]!.actual)}): sub-hashes kept before that tick`,
        );
      }
    }
  }
  const hasSub = subRows.length > 0;
  const verified = resimulated && mismatches.length === 0 && compared === hashValues.length;

  // ---- HEAD, HASH, META ---------------------------------------------------------------------
  const complete = parsed.endTick >= 0 && !cut;
  const truncatedSource = parsed.endTick < 0 || cut;
  if (parsed.truncated && parsed.endTick >= 0) warnings.push('bytes after the END entry ignored');
  if (truncatedSource && !cut) {
    warnings.push(parsed.truncated ? `torn log tail cut off after tick ${lastTick}` : `log has no END entry (game did not close it): ends at tick ${lastTick}`);
  }
  const flags = (tainted ? ReplayFlags.Tainted : 0) | (complete ? ReplayFlags.Complete : 0) | (truncatedSource ? ReplayFlags.Truncated : 0);
  const head: ReplayHead = {
    formatVersion: RTSREPLAY_FORMAT_VERSION,
    simBuild: build ?? UNKNOWN_SIM_BUILD,
    buildHash: h.buildHash,
    simId: h.simId >>> 0,
    bpSimHash: h.bpSimHash >>> 0,
    mapSimHash: h.mapSimHash >>> 0,
    layoutHash: h.layoutHash >>> 0,
    protocolVersion: COMMAND_BATCH_VERSION,
    hashInterval: hi,
    subHashInterval: hasSub ? SUB_HASH_INTERVAL_TICKS : 0,
    flags,
    sourceLogVersion: parsed.version,
  };
  const hashes: ReplayHashes = {
    interval: hi,
    firstTick: hashValues.length > 0 ? hashFirst : 0,
    hashes: Uint32Array.from(hashValues),
    subInterval: hasSub ? SUB_HASH_INTERVAL_TICKS : 0,
    subFirstTick: hasSub ? SUB_HASH_INTERVAL_TICKS : 0,
    regionNames: hasSub ? regionNames : [],
    subHashes: Uint32Array.from(subRows),
  };
  const given = options.meta ?? {};
  const meta: ReplayMeta = {
    durationTicks: lastTick,
    endTick: lastTick,
    players: game.armies.map((a) => ({ army: a.index, name: a.name })),
    result: { winner: -1, reason: 'unknown' },
    ...given,
    stats: { commandTicks: commands.length, commands: envelopes, hashes: hashValues.length, marks: marks.length, ...given.stats },
    extra: { source: `fafl-v${parsed.version}`, ...given.extra },
  };
  const input: RtsReplayInput = { head, game, commands, hashes, marks, meta };
  const bytes = writeRtsReplay(input, options.level !== undefined ? { level: options.level } : {});
  return { bytes, input, verified, mismatches, warnings, truncatedSource, compared, lastTick, sourceLogVersion: parsed.version };
}
