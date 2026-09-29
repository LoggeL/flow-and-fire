/**
 * SimCore: the engine-neutral tick pipeline shared by the worker host and the headless runner.
 *
 *   commands of tick t (sources, merged, stamped with t) → recorder → sim.step → hash entry →
 *   keyframe → hash trail
 *
 * inputDelay = 0: everything a source delivers before tick t runs is applied in tick t, and the
 * application tick is written into the envelopes before they are recorded.
 *
 * Seek/replay: after `seek()` the core re-simulates the recorded timeline from the command log
 * (no re-recording, recorded hashes are verified) until it reaches the end of the recorded
 * timeline; from then on it is live again.
 */

import { createTestPlaneMap, mapSimData, mapSimHash, readRtsMap, validateRtsMap, type RtsMap } from '@faf/formats';
import { setBatchTick } from '@faf/protocol';
import { createWorld, fullHash, lastHash, lastHashTick, restore, ruleHash, snapshot, step, HASH_INTERVAL_TICKS, type PhaseProbe, type World } from '@faf/sim';
import type { SimBpTable } from '@faf/blueprints/simbin';
import { KeyframeStore, type KeyframeOptions } from './keyframes.ts';
import { MarkKind, parseCommandLog, type LogHeader } from './log-format.ts';
import { CommandLogRecorder, type RecorderOptions } from './recorder.ts';
import { simIdFor } from './identity.ts';
import { BatchBuilder, LocalSource, ReplaySource, type TickSource } from './sources.ts';

export interface SimCoreOptions {
  /** Compiled blueprints (sim.bin bytes) or a decoded table. */
  readonly simBin?: Uint8Array;
  readonly bpTable?: SimBpTable;
  readonly seed: number;
  readonly armyCount: number;
  /** Army of the local player (log header; −1 = observer). */
  readonly playerArmy?: number;
  /**
   * The map: parsed (`RtsMap`, validated again) or raw `.rtsmap` bytes (parsed with readRtsMap;
   * a broken file throws FormatError). Missing = the generated flat test plane map
   * (formats `createTestPlaneMap(mapSizeWu)`), which then takes the same path as any map.
   */
  readonly map?: RtsMap | Uint8Array;
  /** Size of the generated test plane (default 512); with a map it may be omitted and must match otherwise. */
  readonly mapSizeWu?: number;
  readonly buildHash?: string;
  /** Record a command log (default true). */
  readonly record?: boolean;
  readonly recorder?: RecorderOptions;
  /** Keyframe store options, or false to disable keyframes (default enabled). */
  readonly keyframes?: KeyframeOptions | false;
  /** Command sources; default: one LocalSource (`core.local`). */
  readonly sources?: readonly TickSource[];
  /** Keep the rule-hash trail (tick/hash every 10 ticks) in memory (default true). */
  readonly trail?: boolean;
}

/**
 * Session snapshot (`SimCore.snapshot`): a 16-byte identity header in front of the dynamic arena
 * bytes. The static map area is not in the snapshot, so the header binds the bytes to the session
 * they came from: simId (SIM_BUILD, blueprints, mapSimHash, mods) and the arena layout hash.
 *
 *   0 u32 magic 'FAFS' | 4 u32 simId | 8 u32 layoutHash | 12 u32 arena byte length | arena bytes
 */
export const SNAPSHOT_MAGIC = 0x53464146; // 'FAFS' little-endian
export const SNAPSHOT_HEADER_BYTES = 16;

/** A snapshot that does not belong to this session (other map/blueprints/build, layout or size). */
export class SnapshotError extends Error {
  override readonly name = 'SnapshotError';
}

/** Called for every rule hash (tick, u32 hash). */
export type HashListener = (tick: number, hash: number) => void;

/** A recorded rule hash that did not match during re-simulation. */
export interface HashMismatch {
  readonly tick: number;
  readonly expected: number;
  readonly actual: number;
}

/**
 * Parses/validates a map option; a missing map is the generated flat test plane of `sizeWu`
 * (default 512). Throws FormatError on a broken map.
 */
export function resolveMap(map: RtsMap | Uint8Array | undefined | null, sizeWu?: number): RtsMap {
  if (map === undefined || map === null) return createTestPlaneMap(sizeWu);
  if (map instanceof Uint8Array) return readRtsMap(map);
  validateRtsMap(map);
  return map;
}

export class SimCore {
  readonly world: World;
  readonly simId: number;
  /** The map of this session (the generated test plane when none was given). Static data; never changes. */
  readonly map: RtsMap;
  /** formats mapSimHash of the map; part of simId. */
  readonly mapSimHash: number;
  /** META name of the map ('testplane' for the generated test plane). */
  readonly mapName: string;
  readonly recorder: CommandLogRecorder | null;
  readonly keyframes: KeyframeStore | null;
  /** Default local source (also present when custom sources are given, but then unused). */
  readonly local: LocalSource;
  readonly sources: readonly TickSource[];
  /** True if `local` is one of the sources (i.e. `local.push` has an effect). */
  readonly acceptsLocal: boolean;
  private readonly merged = new BatchBuilder();
  private readonly trailOn: boolean;
  private trailTicks: Uint32Array;
  private trailHashes: Uint32Array;
  private trailLen = 0;
  /** Replay state after seek (null = live). */
  private replay: ReplaySource | null = null;
  /** Highest tick ever simulated live on this timeline. */
  private timelineEnd = 0;
  /** Hash mismatches found while re-simulating the recorded timeline. */
  readonly mismatches: HashMismatch[] = [];
  onHash: HashListener | null = null;

  constructor(options: SimCoreOptions) {
    const map = resolveMap(options.map, options.mapSizeWu);
    const w = createWorld({
      ...(options.simBin !== undefined ? { simBin: options.simBin } : {}),
      ...(options.bpTable !== undefined ? { bpTable: options.bpTable } : {}),
      seed: options.seed >>> 0,
      armyCount: options.armyCount,
      map: mapSimData(map),
      ...(options.mapSizeWu !== undefined ? { mapSizeWu: options.mapSizeWu } : {}),
    });
    this.world = w;
    this.map = map;
    this.mapSimHash = mapSimHash(map) >>> 0;
    this.mapName = map.meta.name;
    this.simId = simIdFor(w.bp.simHash, this.mapSimHash);
    this.local = new LocalSource();
    this.sources = options.sources ?? [this.local];
    this.acceptsLocal = this.sources.includes(this.local);
    this.trailOn = options.trail ?? true;
    this.trailTicks = new Uint32Array(this.trailOn ? 1024 : 0);
    this.trailHashes = new Uint32Array(this.trailOn ? 1024 : 0);
    const header: LogHeader = {
      simId: this.simId,
      layoutHash: w.layoutHash,
      seed: w.seed,
      bpSimHash: w.bp.simHash,
      mapSizeWu: w.mapSizeWu,
      armyCount: w.armyCount,
      playerArmy: options.playerArmy ?? 0,
      hashInterval: HASH_INTERVAL_TICKS,
      buildHash: options.buildHash ?? 'dev',
      mapSimHash: this.mapSimHash,
    };
    this.recorder = options.record === false ? null : new CommandLogRecorder(header, options.recorder);
    this.keyframes = options.keyframes === false ? null : new KeyframeStore(w.snapshotByteLength, options.keyframes ?? {});
    this.keyframes?.capture(w);
  }

  get tick(): number {
    return this.world.tick as number;
  }

  /** True while re-simulating recorded ticks after a seek. */
  get replaying(): boolean {
    return this.replay !== null;
  }

  /** Highest tick simulated live on the current timeline. */
  get recordedEnd(): number {
    return this.timelineEnd;
  }

  /** True if some source is not ready for the next tick. */
  pending(): boolean {
    if (this.replay !== null) return false;
    const t = this.tick + 1;
    const src = this.sources;
    for (let i = 0; i < src.length; i++) if (src[i]!.pending(t)) return true;
    return false;
  }

  /**
   * Gathers the commands of the next tick from all sources (merged, stamped). Returns null if
   * there are none. Only call when `pending()` is false.
   */
  private gather(t: number): Uint8Array | null {
    const src = this.sources;
    if (src.length === 1) {
      const b = src[0]!.batchFor(t);
      if (b === null) return null;
      setBatchTick(b, t);
      return b;
    }
    let single: Uint8Array | null = null;
    let parts = 0;
    const m = this.merged;
    for (let i = 0; i < src.length; i++) {
      const b = src[i]!.batchFor(t);
      if (b === null) continue;
      if (parts === 0) single = b;
      else {
        if (parts === 1) {
          m.clear();
          m.append(single!);
        }
        m.append(b);
      }
      parts++;
    }
    if (parts === 0) return null;
    const out = parts === 1 ? single! : m.view();
    setBatchTick(out, t);
    return out;
  }

  /**
   * Runs one tick. Returns false (and does nothing) if a source is 'pending'. `probe` receives
   * the sim phase brackets.
   */
  runTick(probe?: PhaseProbe): boolean {
    const t = this.tick + 1;
    let batch: Uint8Array | null;
    const rep = this.replay;
    if (rep !== null) {
      batch = rep.batchFor(t);
    } else {
      if (this.pending()) return false;
      batch = this.gather(t);
      if (batch !== null && this.recorder !== null) this.recorder.commands(t, batch);
    }
    step(this.world, batch, probe);
    if (lastHashTick(this.world) === t) {
      const h = lastHash(this.world) >>> 0;
      if (rep !== null) {
        const exp = rep.expectedHash(t);
        if (exp >= 0 && exp !== h) this.mismatches.push({ tick: t, expected: exp, actual: h });
      } else if (this.recorder !== null) {
        this.recorder.hash(t, h);
      }
      this.pushTrail(t, h);
      this.onHash?.(t, h);
    }
    this.keyframes?.maybeCapture(this.world);
    if (rep !== null) {
      if (t >= this.timelineEnd) this.replay = null;
    } else if (t > this.timelineEnd) {
      this.timelineEnd = t;
    }
    return true;
  }

  private pushTrail(t: number, h: number): void {
    if (!this.trailOn) return;
    const n = this.trailLen;
    if (n > 0 && this.trailTicks[n - 1]! >= t) {
      // Re-simulated tick (seek): the trail already holds it.
      return;
    }
    if (n === this.trailTicks.length) {
      const nt = new Uint32Array(n * 2);
      nt.set(this.trailTicks);
      this.trailTicks = nt;
      const nh = new Uint32Array(n * 2);
      nh.set(this.trailHashes);
      this.trailHashes = nh;
    }
    this.trailTicks[n] = t;
    this.trailHashes[n] = h;
    this.trailLen = n + 1;
  }

  /** Rule hashes so far (every 10 ticks) as {tick, hash}. */
  hashTrail(): { tick: number; hash: number }[] {
    const out: { tick: number; hash: number }[] = [];
    for (let i = 0; i < this.trailLen; i++) out.push({ tick: this.trailTicks[i]!, hash: this.trailHashes[i]! });
    return out;
  }

  /** Just the hashes of the trail. */
  hashChain(): number[] {
    return Array.from(this.trailHashes.subarray(0, this.trailLen));
  }

  ruleHash(): number {
    return ruleHash(this.world) >>> 0;
  }

  fullHash(): number {
    return fullHash(this.world) >>> 0;
  }

  /** Byte length of a session snapshot (header + dynamic arena). */
  get snapshotByteLength(): number {
    return SNAPSHOT_HEADER_BYTES + this.world.snapshotByteLength;
  }

  /**
   * Session snapshot: identity header (simId, layout hash) + the dynamic arena. With `target`
   * (≥ snapshotByteLength) nothing is allocated.
   */
  snapshot(target?: Uint8Array): Uint8Array {
    const n = this.snapshotByteLength;
    const out = target ?? new Uint8Array(n);
    if (out.length < n) throw new RangeError(`snapshot target too small: ${out.length} < ${n}`);
    const dv = new DataView(out.buffer, out.byteOffset, SNAPSHOT_HEADER_BYTES);
    dv.setUint32(0, SNAPSHOT_MAGIC, true);
    dv.setUint32(4, this.simId, true);
    dv.setUint32(8, this.world.layoutHash >>> 0, true);
    dv.setUint32(12, this.world.snapshotByteLength, true);
    snapshot(this.world, out.subarray(SNAPSHOT_HEADER_BYTES, n));
    return out;
  }

  /**
   * Restores a session snapshot (only the dynamic arena area — the static map stays). The header
   * must name this session: a snapshot of another map (or blueprints/build: simId), another arena
   * layout or size throws SnapshotError before anything is touched. The timeline branches here:
   * hash trail, recorder entries and keyframes after the restored tick are dropped, and a Restore
   * MARK is recorded.
   */
  restoreSnapshot(bytes: Uint8Array): void {
    if (bytes.length < SNAPSHOT_HEADER_BYTES) throw new SnapshotError('snapshot too short');
    const dv = new DataView(bytes.buffer, bytes.byteOffset, SNAPSHOT_HEADER_BYTES);
    const hex = (v: number): string => `0x${(v >>> 0).toString(16).padStart(8, '0')}`;
    if (dv.getUint32(0, true) !== SNAPSHOT_MAGIC) throw new SnapshotError('not a session snapshot (magic)');
    const simId = dv.getUint32(4, true);
    if (simId !== this.simId) {
      throw new SnapshotError(`snapshot belongs to simId ${hex(simId)}, this session is ${hex(this.simId)} (map '${this.mapName}' ${hex(this.mapSimHash)})`);
    }
    if (dv.getUint32(8, true) !== this.world.layoutHash >>> 0) throw new SnapshotError('snapshot arena layout differs');
    const arenaBytes = dv.getUint32(12, true);
    if (arenaBytes !== this.world.snapshotByteLength || bytes.length < SNAPSHOT_HEADER_BYTES + arenaBytes) throw new SnapshotError('snapshot size differs');
    restore(this.world, bytes.subarray(SNAPSHOT_HEADER_BYTES, SNAPSHOT_HEADER_BYTES + arenaBytes));
    const t = this.tick;
    this.replay = null;
    this.timelineEnd = t;
    this.local.clear();
    let n = this.trailLen;
    while (n > 0 && this.trailTicks[n - 1]! > t) n--;
    this.trailLen = n;
    if (this.recorder !== null) {
      this.recorder.truncateAfter(t);
      this.recorder.mark(t, MarkKind.Restore, t);
    }
    if (this.keyframes !== null) {
      // The restored state is the new base: older keyframes may belong to another history.
      this.keyframes.discardAfter(-1);
      this.keyframes.capture(this.world);
    }
  }

  /**
   * Moves the world to `tick` within the recorded timeline: restores the nearest keyframe at or
   * before it (or continues from the current state if that is closer) and re-simulates with the
   * recorded commands. Subsequent `runTick()` calls keep replaying the log until the end of the
   * recorded timeline, then continue live.
   */
  seek(tick: number): void {
    if (this.recorder === null) throw new Error('seek needs a recorder (command log)');
    if (!Number.isInteger(tick) || tick < 0 || tick > this.timelineEnd) {
      throw new RangeError(`seek target ${tick} outside the recorded timeline [0, ${this.timelineEnd}]`);
    }
    const cur = this.tick;
    const kfs = this.keyframes;
    const ki = kfs === null ? -1 : kfs.latestAtOrBefore(tick);
    const kfTick = ki >= 0 ? kfs!.tickAt(ki) : -1;
    if (tick < cur || kfTick > cur) {
      if (ki < 0) throw new Error(`no keyframe at or before tick ${tick}`);
      kfs!.restoreInto(this.world, ki);
    }
    if (this.tick < this.timelineEnd) {
      this.replay = new ReplaySource(parseCommandLog(this.recorder.bytes));
    }
    while (this.tick < tick) this.runTick();
  }
}
