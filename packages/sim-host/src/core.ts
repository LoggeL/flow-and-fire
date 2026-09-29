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

import { setBatchTick } from '@faf/protocol';
import { createWorld, fullHash, lastHash, lastHashTick, restore, ruleHash, step, HASH_INTERVAL_TICKS, type PhaseProbe, type World } from '@faf/sim';
import type { SimBpTable } from '@faf/blueprints/simbin';
import { KeyframeStore, type KeyframeOptions } from './keyframes.ts';
import { MarkKind, parseCommandLog, type LogHeader } from './log-format.ts';
import { CommandLogRecorder, type RecorderOptions } from './recorder.ts';
import { simIdOf } from './identity.ts';
import { BatchBuilder, LocalSource, ReplaySource, type TickSource } from './sources.ts';

export interface SimCoreOptions {
  /** Compiled blueprints (sim.bin bytes) or a decoded table. */
  readonly simBin?: Uint8Array;
  readonly bpTable?: SimBpTable;
  readonly seed: number;
  readonly armyCount: number;
  /** Army of the local player (log header; −1 = observer). */
  readonly playerArmy?: number;
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

/** Called for every rule hash (tick, u32 hash). */
export type HashListener = (tick: number, hash: number) => void;

/** A recorded rule hash that did not match during re-simulation. */
export interface HashMismatch {
  readonly tick: number;
  readonly expected: number;
  readonly actual: number;
}

export class SimCore {
  readonly world: World;
  readonly simId: number;
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
    const w = createWorld({
      ...(options.simBin !== undefined ? { simBin: options.simBin } : {}),
      ...(options.bpTable !== undefined ? { bpTable: options.bpTable } : {}),
      seed: options.seed >>> 0,
      armyCount: options.armyCount,
      ...(options.mapSizeWu !== undefined ? { mapSizeWu: options.mapSizeWu } : {}),
    });
    this.world = w;
    this.simId = simIdOf(w.bp.simHash, w.mapSizeWu);
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

  /**
   * Restores a snapshot (same layout). The timeline branches here: hash trail, recorder entries
   * and keyframes after the restored tick are dropped, and a Restore MARK is recorded.
   */
  restoreSnapshot(bytes: Uint8Array): void {
    restore(this.world, bytes);
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
