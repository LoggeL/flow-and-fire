/**
 * Replay player (PLAN §3.11 "Wiedergabe", "Seek", "Hash-Prüfung"): plays a .rtsreplay headless
 * (or in the sim worker) with seeking and verification.
 *
 * Build check FIRST (PLAN §3.1 build versioning, §3.11 redirect): for file bytes the tolerant
 * reader (formats readRtsReplayHead) reads only the frozen HEAD prefix and the chunk versions, so a
 * replay of another SIM_BUILD, format / chunk version or command protocol version becomes a
 * ReplayCompatError with the /b/<buildHash>/ redirect instead of a FormatError of the strict
 * parse. Then the full parse, then the session: the map's mapSimHash must be HEAD.mapSimHash and
 * the session's simId (build, blueprints, map) and arena layoutHash must equal HEAD. The GAME
 * alliance matrix is applied before tick 1 and the tick-0 state becomes the first keyframe of a
 * CompressedKeyframeStore.
 *
 * Composition: the player works on a SimCore. `open` creates its own HeadlessSim (tools, tests);
 * `attach` takes an existing core whose command source is an RtsReplaySource of the replay (the
 * sim worker in MS11). Verification is a ReplayVerifier (verifier.ts) hooked up through
 * addHashListener, so recorders, debug tools and the cross-engine trail can listen to the same
 * core. Whoever runs ticks outside the player (SimHost / scheduler) calls `observeTick()` after
 * each tick so sub-hash checks and keyframes keep working.
 *
 * The playback end is derived from the content (setup.ts replayPlaybackEnd): every recorded
 * command, hash, sub-hash row and mark is reached, META.endTick only describes.
 *
 * Seek(t): if t lies behind the current tick, or a keyframe exists between the current tick and
 * t, the nearest keyframe ≤ t is restored (inflate + SimCore.restoreSnapshot); then the player
 * re-simulates to t. Keyframes are collected (maybeCapture) on every tick the player observes,
 * including re-simulations, so later seeks find closer keyframes.
 */

import { COMMAND_BATCH_VERSION } from '@faf/protocol';
import {
  mapSimHash,
  readRtsReplay,
  readRtsReplayHead,
  replayFormatIncompatibility,
  ReplayFlags,
  type ReplayHeadInfo,
  type RtsMap,
  type RtsReplay,
} from '@faf/formats';
import type { SimBpTable } from '@faf/blueprints/simbin';
import type { World } from '@faf/sim';
import { resolveMap, type SimCore } from '../core.ts';
import { HeadlessSim } from '../headless.ts';
import { SIM_BUILD } from '../identity.ts';
import { CompressedKeyframeStore, type CompressedKeyframeOptions } from './keyframes-compressed.ts';
import { RtsReplaySource } from './source.ts';
import { applyGameAlliances, armyCountOf, replayPlaybackEnd } from './setup.ts';
import { ReplayVerifier, type ReplayDivergence } from './verifier.ts';

export type { ReplayDivergence } from './verifier.ts';

export interface ReplayPlayerOptions {
  /** The map of the replay (parsed or .rtsmap bytes); default: the generated test plane of GAME.mapSizeWu. */
  readonly map?: RtsMap | Uint8Array;
  /** Compiled blueprints (sim.bin bytes) or a decoded table (must reproduce HEAD.bpSimHash). */
  readonly simBin?: Uint8Array;
  readonly bpTable?: SimBpTable;
  /**
   * Compressed keyframe store options (default: every 600 ticks, 128 MiB budget). false keeps
   * only the tick-0 keyframe (every seek backwards re-simulates from the start).
   */
  readonly keyframes?: CompressedKeyframeOptions | false;
  /** Compare rule hashes with the HASH chunk (default true). */
  readonly verify?: boolean;
  /** Compare sub-hashes at the recorded sub-hash ticks (default true; needs verify). */
  readonly subHashCheck?: boolean;
}

/** Options of ReplayPlayer.attach (the session already exists). */
export type ReplayAttachOptions = Pick<ReplayPlayerOptions, 'keyframes' | 'verify' | 'subHashCheck'>;

/**
 * Why a replay cannot be played by this build: 'sim-build' (HEAD.simBuild), 'format' (container /
 * format / chunk version this reader cannot parse), 'protocol' (other command protocol version),
 * 'map', 'sim-id' (blueprints / sim.bin), 'layout' (arena), 'alliances' (GAME matrix).
 */
export type ReplayCompatReason = 'sim-build' | 'format' | 'protocol' | 'map' | 'sim-id' | 'layout' | 'alliances';

/**
 * The replay belongs to another build, map or blueprint set (PLAN §3.11: the matching build is
 * served under /b/<buildHash>/). Thrown by ReplayPlayer.open / attach / checkReplayCompat before
 * the first tick.
 */
export class ReplayCompatError extends Error {
  override readonly name = 'ReplayCompatError';
  readonly reason: ReplayCompatReason;
  /** HEAD.buildHash of the replay. */
  readonly buildHash: string;
  /** HEAD.simBuild of the replay. */
  readonly simBuild: string;
  /** Path of the build that recorded the replay: `/b/<buildHash>/`. */
  readonly redirect: string;

  constructor(reason: ReplayCompatReason, detail: string, simBuild: string, buildHash: string) {
    const redirect = `/b/${encodeURIComponent(buildHash)}/`;
    super(`replay not playable by ${SIM_BUILD} (${reason}): ${detail} – recorded by ${simBuild}, build ${buildHash}: open it via ${redirect}`);
    this.reason = reason;
    this.buildHash = buildHash;
    this.simBuild = simBuild;
    this.redirect = redirect;
  }
}

/** A build incompatibility found from the HEAD alone. */
export interface ReplayBuildIncompatibility {
  readonly reason: 'sim-build' | 'format' | 'protocol';
  readonly detail: string;
}

/**
 * Build-level compatibility of a replay from its tolerant head info (no throw; for listings such
 * as the MS11 replay browser): null = this build can parse it and its SIM_BUILD matches.
 * Checked in this order: SIM_BUILD, format / chunk versions, command protocol version.
 */
export function replayBuildIncompatibility(info: ReplayHeadInfo): ReplayBuildIncompatibility | null {
  if (info.simBuild !== SIM_BUILD) return { reason: 'sim-build', detail: `HEAD.simBuild '${info.simBuild}' ≠ '${SIM_BUILD}'` };
  const f = replayFormatIncompatibility(info);
  if (f !== null) return f;
  // replayFormatIncompatibility covers the protocol; kept explicit for readers of this function.
  if (info.protocolVersion !== COMMAND_BATCH_VERSION) return { reason: 'protocol', detail: `command protocol version ${info.protocolVersion} ≠ ${COMMAND_BATCH_VERSION}` };
  return null;
}

/**
 * Reads the frozen head of replay bytes and throws ReplayCompatError (with the redirect) if this
 * build cannot parse or play them; FormatError only if not even the HEAD prefix is readable.
 */
export function checkReplayCompat(bytes: Uint8Array): ReplayHeadInfo {
  const info = readRtsReplayHead(bytes);
  const inc = replayBuildIncompatibility(info);
  if (inc !== null) throw new ReplayCompatError(inc.reason, inc.detail, info.simBuild, info.buildHash);
  return info;
}

/** checkReplayCompat, then the strict parse (FormatError for a broken file of this build). */
export function readPlayableReplay(bytes: Uint8Array): RtsReplay {
  checkReplayCompat(bytes);
  return readRtsReplay(bytes);
}

export interface ReplayVerifyResult {
  /** Tick the playback ended at. */
  readonly endTick: number;
  /** Recorded rule hashes compared. */
  readonly compared: number;
  /** Recorded sub-hash rows compared. */
  readonly subCompared: number;
  /** Recorded rule hashes / sub-hash rows at ticks up to the highest tick simulated. */
  readonly recordedUpTo: number;
  readonly subRecordedUpTo: number;
  /**
   * True if every recorded rule hash and sub-hash row up to the highest simulated tick was
   * compared (false: verification off, sub-hash check off, or hashes off the sim's hash grid).
   */
  readonly fullyCompared: boolean;
  readonly divergences: readonly ReplayDivergence[];
  /** Rule / full hash of the final state. */
  readonly ruleHash: number;
  readonly fullHash: number;
  /** HEAD flags. */
  readonly tainted: boolean;
  readonly complete: boolean;
  readonly truncated: boolean;
}

/** Keyframe interval used for `keyframes: false` (only the tick-0 keyframe is ever due). */
const NO_KEYFRAMES_INTERVAL = 0x7fffffff;

function hex(v: number): string {
  return `0x${(v >>> 0).toString(16).padStart(8, '0')}`;
}

/** Checks a session (core) against the replay's HEAD and applies the GAME alliances. */
function prepareSession(replay: RtsReplay, core: SimCore): void {
  const { head, game } = replay;
  const fail = (reason: ReplayCompatReason, detail: string): never => {
    throw new ReplayCompatError(reason, detail, head.simBuild, head.buildHash);
  };
  if (head.simBuild !== SIM_BUILD) fail('sim-build', `HEAD.simBuild '${head.simBuild}' ≠ '${SIM_BUILD}'`);
  if (core.mapSimHash >>> 0 !== head.mapSimHash >>> 0) {
    fail('map', `recorded on map '${game.mapName}' ${hex(head.mapSimHash)}, session map '${core.mapName}' ${hex(core.mapSimHash)}`);
  }
  if (core.simId >>> 0 !== head.simId >>> 0) fail('sim-id', `simId ${hex(head.simId)} ≠ session ${hex(core.simId)} (other blueprints/sim.bin?)`);
  if (core.world.layoutHash >>> 0 !== head.layoutHash >>> 0) fail('layout', `arena layoutHash ${hex(head.layoutHash)} ≠ session ${hex(core.world.layoutHash)}`);
  try {
    applyGameAlliances(core.world, game.alliances);
  } catch (e) {
    fail('alliances', e instanceof Error ? e.message : String(e));
  }
}

export class ReplayPlayer {
  readonly replay: RtsReplay;
  /** The session the player drives (own HeadlessSim's core for `open`, the given core for `attach`). */
  readonly core: SimCore;
  /** The player's own headless session (`open`); null when attached to an existing core. */
  readonly sim: HeadlessSim | null;
  readonly source: RtsReplaySource;
  /** Hash verification (null with `verify: false`). */
  readonly verifier: ReplayVerifier | null;
  /** Last tick of the replay (content-derived, see replayPlaybackEnd); the player never simulates past it. */
  readonly endTick: number;
  /** Compressed keyframes collected so far (tick 0 always). */
  readonly keyframes: CompressedKeyframeStore;
  /** Notes from opening (e.g. sub-hash regions that do not match this layout, clamped META.endTick). */
  readonly warnings: string[] = [];
  private detachHash: (() => void) | null = null;
  private seekCount = 0;
  private restoreCount = 0;

  private constructor(replay: RtsReplay, core: SimCore, sim: HeadlessSim | null, source: RtsReplaySource, options: ReplayAttachOptions) {
    this.replay = replay;
    this.core = core;
    this.sim = sim;
    this.source = source;
    this.endTick = source.lastTick;
    const end = replayPlaybackEnd(replay);
    if (end.metaClamped) {
      this.warnings.push(`META.endTick ${end.metaEndTick} does not match the recorded content (last content tick ${end.contentEndTick}): playback ends at ${end.endTick}`);
    }
    if (options.verify !== false) {
      const v = new ReplayVerifier(source, core.world, options.subHashCheck === false ? { subHashCheck: false } : {});
      this.verifier = v;
      this.warnings.push(...v.warnings);
      this.detachHash = v.attach(core);
    } else {
      this.verifier = null;
    }
    const kf = options.keyframes ?? {};
    this.keyframes = new CompressedKeyframeStore(core.snapshotByteLength, kf === false ? { intervalTicks: NO_KEYFRAMES_INTERVAL } : kf);
    this.keyframes.capture(core);
  }

  /**
   * Opens a replay (file bytes or read replay) for playback in an own headless session. For bytes
   * the build compatibility is checked on the tolerant head first (checkReplayCompat). Throws
   * ReplayCompatError (before any tick runs) if this build cannot play it and FormatError for a
   * broken file.
   */
  static open(input: Uint8Array | RtsReplay, options: ReplayPlayerOptions = {}): ReplayPlayer {
    const replay = input instanceof Uint8Array ? readPlayableReplay(input) : input;
    const { head, game } = replay;
    if (head.simBuild !== SIM_BUILD) {
      throw new ReplayCompatError('sim-build', `HEAD.simBuild '${head.simBuild}' ≠ '${SIM_BUILD}'`, head.simBuild, head.buildHash);
    }
    // Map check before the (expensive) session is created.
    const map = resolveMap(options.map, options.map === undefined ? game.mapSizeWu : undefined);
    const mh = mapSimHash(map) >>> 0;
    if (mh !== head.mapSimHash >>> 0) {
      throw new ReplayCompatError('map', `recorded on map '${game.mapName}' ${hex(head.mapSimHash)}, given map '${map.meta.name}' ${hex(mh)}`, head.simBuild, head.buildHash);
    }
    const source = new RtsReplaySource(replay);
    const sim = new HeadlessSim({
      ...(options.simBin !== undefined ? { simBin: options.simBin } : {}),
      ...(options.bpTable !== undefined ? { bpTable: options.bpTable } : {}),
      seed: game.seed,
      armyCount: armyCountOf(game),
      playerArmy: game.playerArmy,
      map,
      buildHash: head.buildHash,
      record: false,
      keyframes: false,
      sources: [source],
    });
    prepareSession(replay, sim.core);
    return new ReplayPlayer(replay, sim.core, sim, source, options);
  }

  /**
   * Attaches a player to an existing session (MS11: the sim worker's core). The core must be at
   * tick 0, must not record (a keyframe restore would branch its command log) and must have
   * `source` as one of its command sources; its identity is checked against HEAD like in `open`
   * and the GAME alliances are applied. The caller drives ticks either through the player
   * (step / runUntil / seek) or itself, calling `observeTick()` after every tick.
   */
  static attach(core: SimCore, source: RtsReplaySource, options: ReplayAttachOptions = {}): ReplayPlayer {
    if (core.tick !== 0) throw new Error(`ReplayPlayer.attach: the core is at tick ${core.tick}, not 0`);
    if (core.recorder !== null) throw new Error('ReplayPlayer.attach: the core records a command log (create it with record: false)');
    if (!core.sources.includes(source)) throw new Error('ReplayPlayer.attach: the RtsReplaySource is not a command source of the core');
    prepareSession(source.replay, core);
    return new ReplayPlayer(source.replay, core, null, source, options);
  }

  /** Removes the player's hash listener from the core (the core stays usable). */
  detach(): void {
    this.detachHash?.();
    this.detachHash = null;
  }

  /** Current tick. */
  get tick(): number {
    return this.core.tick;
  }

  get world(): World {
    return this.core.world;
  }

  /** Divergences found so far, ascending by tick. */
  get divergences(): readonly ReplayDivergence[] {
    return this.verifier?.divergences ?? [];
  }

  /** Recorded rule hashes compared so far (each tick once). */
  get compared(): number {
    return this.verifier?.compared ?? 0;
  }

  /** Recorded sub-hash rows compared so far (each tick once). */
  get subCompared(): number {
    return this.verifier?.subCompared ?? 0;
  }

  /** Seeks performed / of them with a keyframe restore. */
  get seeks(): number {
    return this.seekCount;
  }

  get restores(): number {
    return this.restoreCount;
  }

  /** Advances up to `n` ticks (never past endTick); returns the ticks run. */
  step(n = 1): number {
    let ran = 0;
    while (ran < n && this.core.tick < this.endTick) {
      this.advance();
      ran++;
    }
    return ran;
  }

  /** Runs forward to `tick` (clamped to endTick); returns the ticks run. */
  runUntil(tick: number): number {
    return this.step(Math.max(0, Math.min(tick, this.endTick) - this.core.tick));
  }

  /**
   * Moves to `tick` (integer in [0, endTick]): restores the nearest keyframe ≤ tick when going
   * backwards or when a keyframe lies between the current tick and the target, then
   * re-simulates. The state equals a direct run to `tick` (full hash).
   */
  seek(tick: number): void {
    if (!Number.isInteger(tick) || tick < 0 || tick > this.endTick) {
      throw new RangeError(`seek target ${tick} outside the replay [0, ${this.endTick}]`);
    }
    this.seekCount++;
    const cur = this.core.tick;
    const store = this.keyframes;
    const ki = store.latestAtOrBefore(tick);
    const kt = ki >= 0 ? store.tickAt(ki) : -1;
    if (tick < cur || kt > cur) {
      if (ki < 0) throw new Error(`no keyframe at or before tick ${tick}`);
      store.restoreInto(this.core, ki);
      this.restoreCount++;
      // Divergences waiting for a sub-hash row behind the restored tick stay unresolved until the
      // playback reaches that row again.
    }
    while (this.core.tick < tick) this.advance();
  }

  /** Plays to the end and returns the verification result. */
  playToEnd(): ReplayVerifyResult {
    while (this.core.tick < this.endTick) this.advance();
    return this.result();
  }

  /** Verification state at the current tick. */
  result(): ReplayVerifyResult {
    const f = this.replay.head.flags;
    const v = this.verifier;
    const compared = v?.compared ?? 0;
    const subCompared = v?.subCompared ?? 0;
    const recordedUpTo = v?.recordedUpTo ?? 0;
    const subRecordedUpTo = v?.subRecordedUpTo ?? 0;
    return {
      endTick: this.core.tick,
      compared,
      subCompared,
      recordedUpTo,
      subRecordedUpTo,
      fullyCompared: v !== null && compared === recordedUpTo && subCompared === subRecordedUpTo,
      divergences: v?.snapshotDivergences() ?? [],
      ruleHash: this.ruleHash(),
      fullHash: this.fullHash(),
      tainted: (f & ReplayFlags.Tainted) !== 0,
      complete: (f & ReplayFlags.Complete) !== 0,
      truncated: (f & ReplayFlags.Truncated) !== 0,
    };
  }

  ruleHash(): number {
    return this.core.ruleHash();
  }

  fullHash(): number {
    return this.core.fullHash();
  }

  /**
   * Bookkeeping after a tick the core ran (called by the player itself; external drivers call it
   * after every SimCore.runTick of this session): sub-hash check and keyframe capture.
   */
  observeTick(): void {
    const core = this.core;
    this.verifier?.afterTick(core.world, core.tick, () => core.ruleHash());
    this.keyframes.maybeCapture(core);
  }

  private advance(): void {
    if (!this.core.runTick()) throw new Error('replay source reported pending');
    this.observeTick();
  }
}

/**
 * Plays a replay to its end and verifies it (hashes and sub-hashes). Keyframes default to off
 * (only tick 0) — pass `keyframes` to keep them. Throws like ReplayPlayer.open.
 */
export function verifyReplay(input: Uint8Array | RtsReplay, options: ReplayPlayerOptions = {}): ReplayVerifyResult {
  const player = ReplayPlayer.open(input, { ...options, keyframes: options.keyframes ?? false });
  return player.playToEnd();
}
