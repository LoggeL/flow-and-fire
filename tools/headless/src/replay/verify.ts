/**
 * Replay verification (PLAN §3.11 "Hash-Prüfung", §3.12 replay-verify): plays a .rtsreplay — or a
 * FAFL command log, converted first — headless with the sim-host ReplayPlayer and compares every
 * recorded rule hash (every 10 ticks) and rule-region sub-hash row (every 100 ticks).
 *
 * The map is chosen by HEAD.mapSimHash among the given .rtsmap files; without a match the player
 * falls back to the generated test plane of GAME.mapSizeWu (and refuses the replay with a
 * ReplayCompatError('map') if that does not match either). A .rtsreplay is checked on its
 * tolerant head first (sim-host readPlayableReplay): another SIM_BUILD, format / chunk version or
 * command protocol version is a ReplayCompatError with the /b/<buildHash>/ redirect, not a
 * FormatError. Errors are not caught here: FormatError (broken .rtsreplay), CommandLogError
 * (broken FAFL log) and ReplayCompatError (other SIM_BUILD, format, protocol, map, blueprints,
 * layout) reach the caller — the CLI maps them to exit code 2.
 *
 * Completeness: `fullyCompared` is false when fewer recorded rule hashes / sub-hash rows were
 * compared than the replay holds up to the end of the playback (sub-hash check off, hashes off
 * the sim's grid, …); the CLI treats that like a divergence (exit code 1).
 *
 * Environment-neutral (Node and browser worker): no node: imports, the clock is a parameter.
 */
import { mapSimHash, readRtsMap, readRtsReplay, type RtsMap, type RtsReplay } from '@faf/formats';
import { convertCommandLog, parseCommandLog, readPlayableReplay, ReplayPlayer, type ReplayDivergence } from '@faf/sim-host';
import type { Clock } from '../stats.ts';

/** Sim ticks per second of game time (PLAN §3.1: 10 Hz). */
export const REPLAY_TICKS_PER_SECOND = 10;

/** Assets a verification needs: compiled blueprints and candidate maps (by any key, e.g. path). */
export interface ReplayAssets {
  /** content/generated/sim.bin bytes. */
  readonly simBin: Uint8Array;
  /** .rtsmap bytes; the one whose mapSimHash equals HEAD.mapSimHash is used. */
  readonly maps: Readonly<Record<string, Uint8Array>>;
}

export interface VerifyReplayFileOptions {
  /** Stop after this tick (default: the end of the replay). */
  readonly untilTick?: number;
  /** Clock for the timing fields (default performance.now). */
  readonly clock?: Clock;
}

/** Kind of an input file, detected by its magic. */
export type ReplayFileKind = 'rtsreplay' | 'fafl' | 'rtsdump' | 'unknown';

export interface VerifyReplayFileResult {
  /** Input kind ('fafl' inputs were converted with sub-hashes first). */
  readonly kind: 'rtsreplay' | 'fafl';
  /** Tick the playback ended at. */
  readonly endTick: number;
  /** Last tick of the replay (endTick unless untilTick stopped earlier). */
  readonly replayEndTick: number;
  /** Recorded rule hashes / sub-hash rows compared. */
  readonly compared: number;
  readonly subCompared: number;
  /** Rule hashes / sub-hash rows the replay holds (whole file). */
  readonly recordedHashes: number;
  readonly recordedSubHashes: number;
  /** Rule hashes / sub-hash rows recorded at ticks up to endTick (what compared / subCompared must reach). */
  readonly expectedHashes: number;
  readonly expectedSubHashes: number;
  /** compared == expectedHashes and subCompared == expectedSubHashes. */
  readonly fullyCompared: boolean;
  readonly divergences: readonly ReplayDivergence[];
  /** Rule / full hash of the final state. */
  readonly ruleHash: number;
  readonly fullHash: number;
  /** HEAD flags. */
  readonly tainted: boolean;
  readonly complete: boolean;
  readonly truncated: boolean;
  /** HEAD identity (for reports). */
  readonly simBuild: string;
  readonly buildHash: string;
  /** Map the replay was played on (map meta name, or the test plane). */
  readonly mapName: string;
  /** Key of the chosen map in `assets.maps`, or null (generated test plane). */
  readonly mapKey: string | null;
  /** Notes of the conversion (FAFL input) and of the player. */
  readonly warnings: readonly string[];
  /** FAFL input: conversion time incl. its re-simulation (ms); 0 for .rtsreplay input. */
  readonly convertMs: number;
  /** Open + playback time (ms), ticks per second and speed as a multiple of real time (10 ticks/s). */
  readonly ms: number;
  readonly ticksPerSecond: number;
  readonly xRealtime: number;
}

const FOURCC_RTSR = 0x52535452; // 'RTSR' as little-endian u32 of the file's first bytes
const FOURCC_FAFL = 0x4c464146; // 'FAFL'
const FOURCC_RTSD = 0x44535452; // 'RTSD'

/** Detects the file kind by its first four bytes. */
export function detectReplayFileKind(bytes: Uint8Array): ReplayFileKind {
  if (bytes.length < 4) return 'unknown';
  const m = (bytes[0]! | (bytes[1]! << 8) | (bytes[2]! << 16) | (bytes[3]! << 24)) >>> 0;
  if (m === FOURCC_RTSR) return 'rtsreplay';
  if (m === FOURCC_FAFL) return 'fafl';
  if (m === FOURCC_RTSD) return 'rtsdump';
  return 'unknown';
}

/** Input that is neither a .rtsreplay nor a FAFL log (CLI: exit code 2). */
export class ReplayInputError extends Error {
  override readonly name = 'ReplayInputError';
}

interface ParsedMap {
  readonly map: RtsMap;
  readonly hash: number;
}

const parsedMaps = new WeakMap<Uint8Array, ParsedMap>();

function parsedMap(bytes: Uint8Array): ParsedMap {
  let p = parsedMaps.get(bytes);
  if (p === undefined) {
    const map = readRtsMap(bytes);
    p = { map, hash: mapSimHash(map) >>> 0 };
    parsedMaps.set(bytes, p);
  }
  return p;
}

/**
 * The map among `maps` whose mapSimHash is `hash`, or null (the caller then uses the generated
 * test plane). Map files that fail to parse are skipped.
 */
export function findMapBySimHash(maps: Readonly<Record<string, Uint8Array>>, hash: number): { key: string; map: RtsMap } | null {
  const keys = Object.keys(maps).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const key of keys) {
    let p: ParsedMap;
    try {
      p = parsedMap(maps[key]!);
    } catch {
      continue;
    }
    if (p.hash === hash >>> 0) return { key, map: p.map };
  }
  return null;
}

/** A replay ready for playback: read container, chosen map, conversion notes. */
export interface LoadedReplay {
  readonly kind: 'rtsreplay' | 'fafl';
  readonly replay: RtsReplay;
  /** The .rtsreplay bytes (converted for FAFL input). */
  readonly bytes: Uint8Array;
  readonly map: RtsMap | undefined;
  readonly mapKey: string | null;
  readonly warnings: readonly string[];
  readonly convertMs: number;
}

/**
 * Reads a .rtsreplay or converts a FAFL log (`subHashes` default true: re-simulation with
 * sub-hashes; false = plain container conversion without simulation) and chooses its map.
 * Throws ReplayInputError for other files, FormatError / CommandLogError for broken ones.
 */
export function loadReplayInput(bytes: Uint8Array, assets: ReplayAssets, opts: { subHashes?: boolean; clock?: Clock } = {}): LoadedReplay {
  const kind = detectReplayFileKind(bytes);
  const clock = opts.clock ?? ((): number => performance.now());
  if (kind === 'rtsreplay') {
    const replay = readPlayableReplay(bytes);
    const found = findMapBySimHash(assets.maps, replay.head.mapSimHash);
    return { kind, replay, bytes, map: found?.map, mapKey: found?.key ?? null, warnings: [], convertMs: 0 };
  }
  if (kind === 'fafl') {
    const log = parseCommandLog(bytes);
    const found = findMapBySimHash(assets.maps, log.header.mapSimHash);
    const t0 = clock();
    const conv = convertCommandLog(log, {
      simBin: assets.simBin,
      subHashes: opts.subHashes !== false,
      ...(found !== null ? { map: found.map } : {}),
    });
    const convertMs = clock() - t0;
    return { kind, replay: readRtsReplay(conv.bytes), bytes: conv.bytes, map: found?.map, mapKey: found?.key ?? null, warnings: conv.warnings, convertMs };
  }
  if (kind === 'rtsdump') throw new ReplayInputError('a state dump (.rtsdump) is not a replay – compare dumps with desync-diff');
  throw new ReplayInputError('neither a .rtsreplay (RTSR) nor a FAFL command log');
}

/**
 * Verifies a replay file: plays it to its end (or `untilTick`) and compares every recorded hash.
 * Throws FormatError / CommandLogError / ReplayInputError for unreadable input and
 * ReplayCompatError if this build cannot play it (before the first tick).
 */
export function verifyReplayFile(bytes: Uint8Array, assets: ReplayAssets, opts: VerifyReplayFileOptions = {}): VerifyReplayFileResult {
  const clock = opts.clock ?? ((): number => performance.now());
  const loaded = loadReplayInput(bytes, assets, { clock });
  const { replay } = loaded;
  const t0 = clock();
  const player = ReplayPlayer.open(replay, {
    simBin: assets.simBin,
    keyframes: false,
    ...(loaded.map !== undefined ? { map: loaded.map } : {}),
  });
  if (opts.untilTick !== undefined) {
    if (!Number.isInteger(opts.untilTick) || opts.untilTick < 0) throw new RangeError(`untilTick must be a non-negative integer, got ${opts.untilTick}`);
    player.runUntil(opts.untilTick);
  } else {
    player.playToEnd();
  }
  const r = player.result();
  const ms = clock() - t0;
  const ticks = r.endTick;
  const tps = ms > 0 ? (ticks * 1000) / ms : 0;
  const h = replay.hashes;
  const rows = h.regionNames.length > 0 ? Math.floor(h.subHashes.length / h.regionNames.length) : 0;
  return {
    kind: loaded.kind,
    endTick: r.endTick,
    replayEndTick: player.endTick,
    compared: r.compared,
    subCompared: r.subCompared,
    recordedHashes: h.hashes.length,
    recordedSubHashes: rows,
    expectedHashes: r.recordedUpTo,
    expectedSubHashes: r.subRecordedUpTo,
    fullyCompared: r.fullyCompared,
    divergences: r.divergences,
    ruleHash: r.ruleHash >>> 0,
    fullHash: r.fullHash >>> 0,
    tainted: r.tainted,
    complete: r.complete,
    truncated: r.truncated,
    simBuild: replay.head.simBuild,
    buildHash: replay.head.buildHash,
    mapName: loaded.map?.meta.name ?? replay.game.mapName,
    mapKey: loaded.mapKey,
    warnings: [...loaded.warnings, ...player.warnings],
    convertMs: loaded.convertMs,
    ms,
    ticksPerSecond: tps,
    xRealtime: tps / REPLAY_TICKS_PER_SECOND,
  };
}

/** u32 as 0x-prefixed 8-digit hex. */
export function hex32(v: number): string {
  return `0x${(v >>> 0).toString(16).padStart(8, '0')}`;
}
