/**
 * HeadlessSim: the sim pipeline without worker, clock or transport — for Node tests, tools and
 * replay verification. Uses the same SimCore as the worker host, so a headless run and a worker
 * run with the same commands produce the same hash chain and the same command log.
 */

import { mapSimHash, type RtsMap } from '@faf/formats';
import { encodeBatch, type CommandEnvelope } from '@faf/protocol';
import type { PhaseProbe, World } from '@faf/sim';
import type { SimBpTable } from '@faf/blueprints/simbin';
import { resolveMap, SimCore, type HashMismatch, type SimCoreOptions } from './core.ts';
import { CommandLogError, parseCommandLog, type ParsedCommandLog } from './log-format.ts';
import type { CommandLogRecorder } from './recorder.ts';
import type { KeyframeStore } from './keyframes.ts';
import { ReplaySource } from './sources.ts';

export type HeadlessOptions = SimCoreOptions;

export interface HashEntry {
  readonly tick: number;
  readonly hash: number;
}

export class HeadlessSim {
  readonly core: SimCore;

  constructor(options: HeadlessOptions) {
    this.core = new SimCore(options);
  }

  get world(): World {
    return this.core.world;
  }

  get tick(): number {
    return this.core.tick;
  }

  get simId(): number {
    return this.core.simId;
  }

  get recorder(): CommandLogRecorder | null {
    return this.core.recorder;
  }

  get keyframes(): KeyframeStore | null {
    return this.core.keyframes;
  }

  /** Hash mismatches found while re-simulating recorded ticks (seek) or replaying a log. */
  get mismatches(): readonly HashMismatch[] {
    return this.core.mismatches;
  }

  /** Queues commands for the next tick (inputDelay = 0). */
  submit(commands: Uint8Array | ArrayBuffer | readonly CommandEnvelope[]): void {
    if (this.core.replaying) throw new Error('commands are not accepted while re-simulating recorded ticks');
    if (!this.core.acceptsLocal) throw new Error('this sim takes its commands from custom sources');
    let bytes: Uint8Array;
    if (commands instanceof Uint8Array) bytes = commands;
    else if (commands instanceof ArrayBuffer) bytes = new Uint8Array(commands);
    else {
      if (commands.length === 0) return;
      bytes = encodeBatch(commands);
    }
    this.core.local.push(bytes);
  }

  /**
   * Advances up to `n` ticks. Stops early (and returns the ticks run) if a source is 'pending'.
   */
  step(n = 1, probe?: PhaseProbe): number {
    let ran = 0;
    while (ran < n && this.core.runTick(probe)) ran++;
    return ran;
  }

  /** Steps until `tick` (or a pending source). */
  runUntil(tick: number, probe?: PhaseProbe): number {
    return this.step(Math.max(0, tick - this.tick), probe);
  }

  /** Rule hashes every 10 ticks since the start (or since the last restore). */
  hashTrail(): HashEntry[] {
    return this.core.hashTrail();
  }

  /** The hashes of the trail. */
  hashChain(): number[] {
    return this.core.hashChain();
  }

  ruleHash(): number {
    return this.core.ruleHash();
  }

  fullHash(): number {
    return this.core.fullHash();
  }

  /** Session snapshot: identity header + dynamic arena (into `target` if given), see SimCore.snapshot. */
  snapshot(target?: Uint8Array): Uint8Array {
    return this.core.snapshot(target);
  }

  /** Restores a snapshot; the timeline branches here (see SimCore.restoreSnapshot). */
  restore(bytes: Uint8Array): void {
    this.core.restoreSnapshot(bytes);
  }

  /** Moves to `tick` within the recorded timeline (keyframe + re-simulation). */
  seek(tick: number): void {
    this.core.seek(tick);
  }

  /** The command log so far, closed with an END entry at the current tick. */
  exportLog(): Uint8Array {
    const r = this.core.recorder;
    if (r === null) throw new Error('recording is disabled');
    return new Uint8Array(r.export(this.tick));
  }

  /** The map of this sim (the generated test plane when none was given). */
  get map(): RtsMap {
    return this.core.map;
  }

  /** Replays `log` in a fresh sim with this sim's blueprint table and map and returns the result. */
  replay(log: Uint8Array | ArrayBuffer | ParsedCommandLog, untilTick?: number): ReplayResult {
    return replayLog(log, {
      bpTable: this.core.world.bp,
      map: this.core.map,
      ...(untilTick !== undefined ? { untilTick } : {}),
    });
  }
}

export interface ReplayOptions {
  readonly simBin?: Uint8Array;
  readonly bpTable?: SimBpTable;
  /**
   * The map the log was recorded on (parsed or .rtsmap bytes). Omitted = the generated test plane
   * of the header's map size; a map whose mapSimHash differs from the log header's is refused.
   */
  readonly map?: RtsMap | Uint8Array;
  /** Stop at this tick (default: last tick of the log). */
  readonly untilTick?: number;
  /** Keyframes of the replaying sim (default enabled, for seeking). */
  readonly keyframes?: SimCoreOptions['keyframes'];
}

export interface ReplayResult {
  readonly log: ParsedCommandLog;
  readonly sim: HeadlessSim;
  /** Rule hashes of the replay (every 10 ticks). */
  readonly trail: HashEntry[];
  /** Recorded hashes that differ from the replay. */
  readonly mismatches: HashMismatch[];
  /** Recorded hashes that were compared. */
  readonly compared: number;
  readonly lastTick: number;
  readonly ruleHash: number;
  readonly fullHash: number;
}

/**
 * Replays a command log from tick 0 through a ReplaySource and compares the rule hash every 10
 * ticks with the recorded ones. Throws CommandLogError if the log belongs to another sim (map,
 * simId or arena layout differ) — a map whose mapSimHash does not match the log header is refused
 * before anything runs, as is a missing map for a log that was not recorded on the test plane.
 */
export function replayLog(input: Uint8Array | ArrayBuffer | ParsedCommandLog, options: ReplayOptions): ReplayResult {
  const log = input instanceof Uint8Array || input instanceof ArrayBuffer ? parseCommandLog(input) : input;
  const h = log.header;
  const hex = (v: number): string => `0x${(v >>> 0).toString(16).padStart(8, '0')}`;
  let map: RtsMap;
  try {
    map = resolveMap(options.map, options.map === undefined ? h.mapSizeWu : undefined);
  } catch (e) {
    if (options.map !== undefined) throw e;
    throw new CommandLogError(`the log was recorded on map ${hex(h.mapSimHash)} (size ${h.mapSizeWu}): pass that map to replay it`);
  }
  const mh = mapSimHash(map) >>> 0;
  if (mh !== h.mapSimHash) {
    throw new CommandLogError(
      options.map === undefined
        ? `the log was recorded on map ${hex(h.mapSimHash)}, not on the test plane: pass that map to replay it`
        : `map mismatch: log mapSimHash ${hex(h.mapSimHash)} vs map '${map.meta.name}' ${hex(mh)}`,
    );
  }
  const source = new ReplaySource(log);
  const sim = new HeadlessSim({
    ...(options.simBin !== undefined ? { simBin: options.simBin } : {}),
    ...(options.bpTable !== undefined ? { bpTable: options.bpTable } : {}),
    seed: h.seed,
    armyCount: h.armyCount,
    playerArmy: h.playerArmy,
    map,
    buildHash: h.buildHash,
    sources: [source],
    ...(options.keyframes !== undefined ? { keyframes: options.keyframes } : {}),
  });
  if (sim.simId !== h.simId) {
    throw new CommandLogError(`simId mismatch: log 0x${h.simId.toString(16)} vs sim 0x${sim.simId.toString(16)}`);
  }
  if (sim.world.layoutHash >>> 0 !== h.layoutHash) {
    throw new CommandLogError(`arena layout mismatch: log 0x${h.layoutHash.toString(16)} vs sim 0x${(sim.world.layoutHash >>> 0).toString(16)}`);
  }
  const mismatches: HashMismatch[] = [];
  let compared = 0;
  sim.core.onHash = (tick, hash): void => {
    const exp = source.expectedHash(tick);
    if (exp < 0) return;
    compared++;
    if (exp !== hash) mismatches.push({ tick, expected: exp, actual: hash });
  };
  const until = options.untilTick ?? log.lastTick;
  sim.runUntil(until);
  sim.core.onHash = null;
  return {
    log,
    sim,
    trail: sim.hashTrail(),
    mismatches,
    compared,
    lastTick: sim.tick,
    ruleHash: sim.ruleHash(),
    fullHash: sim.fullHash(),
  };
}
