/** Replay playback, compatibility checks and compressed-keyframe seeking. */
import { mapSimHash, readRtsReplay, ReplayFlags, type RtsMap, type RtsReplay } from '@faf/formats';
import type { SimBpTable } from '@faf/blueprints/simbin';
import { XxHash32 } from '@faf/fixed';
import { COMMAND_BATCH_VERSION } from '@faf/protocol';
import { setAlliance, type World } from '@faf/sim';
import { HeadlessSim } from '../headless.ts';
import { resolveMap } from '../core.ts';
import { SIM_BUILD } from '../identity.ts';
import { CompressedKeyframeStore, type CompressedKeyframeOptions } from './keyframes-compressed.ts';
import { computeSubHashes, ruleRegionNames } from './sub-hashes.ts';
import { RtsReplaySource } from './source.ts';

export interface ReplayPlayerOptions {
  /** Browser build identity when routing to a matching historical client is required. */
  readonly buildHash?: string;
  readonly map?: RtsMap | Uint8Array;
  readonly simBin?: Uint8Array;
  readonly bpTable?: SimBpTable;
  readonly keyframes?: CompressedKeyframeOptions | false;
  readonly verify?: boolean;
  readonly subHashCheck?: boolean;
}
export class ReplayCompatError extends Error {
  override readonly name = 'ReplayCompatError';
  constructor(readonly reason: string, readonly buildHash: string) { super(`${reason}. Open the recording build at /b/${encodeURIComponent(buildHash)}/`); }
}
export interface ReplayDivergence { readonly tick: number; readonly expected: number; readonly actual: number; regions: string[]; }
export interface ReplayVerifyResult {
  readonly endTick: number; readonly compared: number; readonly subCompared: number;
  readonly divergences: readonly ReplayDivergence[]; readonly ruleHash: number; readonly fullHash: number;
  readonly tainted: boolean; readonly complete: boolean; readonly truncated: boolean;
}
export class ReplayPlayer {
  readonly divergences: ReplayDivergence[] = [];
  readonly keyframes: CompressedKeyframeStore | null;
  readonly endTick: number;
  private readonly initial: Uint8Array;
  private readonly checked = new Set<number>();
  private readonly subChecked = new Set<number>();
  private readonly checkedPass = new Set<number>();
  private readonly subCheckedPass = new Set<number>();
  private readonly sub: Uint32Array;
  private readonly names: readonly string[];
  private readonly hasher = new XxHash32();
  private constructor(readonly replay: RtsReplay, readonly sim: HeadlessSim, readonly options: ReplayPlayerOptions) {
    this.endTick = new RtsReplaySource(replay).lastTick;
    this.initial = sim.snapshot(); this.names = ruleRegionNames(sim.world); this.sub = new Uint32Array(this.names.length);
    this.keyframes = options.keyframes === false ? null : new CompressedKeyframeStore(this.initial.length, options.keyframes);
    this.keyframes?.capture(sim.core);
    sim.core.onHash = (tick, hash): void => {
      if (options.verify === false) return;
      this.checkRuleHash(tick, hash);
    };
    this.checkRuleHash(0); this.checkSubHashes();
  }
  private checkRuleHash(tick: number, knownHash?: number): void {
    if (this.options.verify === false || this.checkedPass.has(tick)) return;
    const expected = newHashAt(this.replay, tick);
    if (expected < 0) return;
    this.checked.add(tick); this.checkedPass.add(tick);
    const actual = knownHash ?? this.ruleHash();
    if (expected !== actual && !this.divergences.some((d) => d.tick === tick && d.expected === expected && d.actual === actual))
      this.divergences.push({ tick, expected, actual, regions: [] });
  }
  static open(input: Uint8Array | RtsReplay, options: ReplayPlayerOptions): ReplayPlayer {
    const replay = input instanceof Uint8Array ? readRtsReplay(input) : input;
    const h = replay.head, g = replay.game;
    const fail = (reason: string): never => { throw new ReplayCompatError(reason, h.buildHash); };
    if (options.buildHash !== undefined && options.buildHash !== h.buildHash) fail(`Client build ${h.buildHash} differs from ${options.buildHash}`);
    if (h.simBuild !== SIM_BUILD) fail(`Simulation build ${h.simBuild} differs from ${SIM_BUILD}`);
    if (h.protocolVersion !== COMMAND_BATCH_VERSION) fail('Command protocol differs');
    const map = resolveMap(options.map, options.map === undefined ? g.mapSizeWu : undefined);
    if (mapSimHash(map) !== h.mapSimHash) fail('Map simulation hash differs');
    if (g.armies.some((a, i) => a.index !== i)) fail('Army indices must be contiguous');
    const sim = new HeadlessSim({ seed: g.seed, armyCount: g.armies.length, playerArmy: g.playerArmy, map,
      ...(options.simBin === undefined ? {} : { simBin: options.simBin }),
      ...(options.bpTable === undefined ? {} : { bpTable: options.bpTable }),
      buildHash: h.buildHash, sources: [new RtsReplaySource(replay)], record: false, keyframes: false,
      ...(g.initialization === undefined ? {} : { initialization: g.initialization }) });
    if (sim.simId !== h.simId) fail('Simulation identity differs');
    if (sim.world.layoutHash !== h.layoutHash) fail('Arena layout differs');
    for (let a = 0; a < 16; a++) for (let b = a + 1; b < 16; b++) {
      const bit = a * 16 + b;
      setAlliance(sim.world, a, b, (g.alliances[bit >>> 3]! & (1 << (bit & 7))) !== 0);
    }
    return new ReplayPlayer(replay, sim, options);
  }
  get tick(): number { return this.sim.tick; }
  get world(): World { return this.sim.world; }
  step(n = 1): number {
    if (!Number.isInteger(n) || n < 0) throw new RangeError('step count must be a nonnegative integer');
    const target = Math.min(this.endTick, this.tick + n), before = this.tick;
    while (this.tick < target) {
      if (this.sim.step() !== 1) throw new Error('Replay source unexpectedly pending');
      this.checkRuleHash(this.tick); this.checkSubHashes(); this.keyframes?.maybeCapture(this.sim.core);
    }
    return this.tick - before;
  }
  runUntil(tick: number): number { this.checkTick(tick); return this.step(Math.max(0, tick - this.tick)); }
  seek(tick: number): void {
    this.checkTick(tick);
    const i = this.keyframes?.latestAtOrBefore(tick) ?? -1;
    const kt = i < 0 ? 0 : this.keyframes!.tickAt(i);
    if (tick < this.tick || kt > this.tick) {
      if (i < 0) this.sim.restore(this.initial); else this.keyframes!.restoreInto(this.sim.core, i);
      this.checkedPass.clear(); this.subCheckedPass.clear();
      this.checkRuleHash(this.tick); this.checkSubHashes();
    }
    this.runUntil(tick);
  }
  private checkTick(tick: number): void { if (!Number.isInteger(tick) || tick < 0 || tick > this.endTick) throw new RangeError(`replay tick must be in [0, ${this.endTick}]`); }
  private checkSubHashes(): void {
    if (this.options.verify === false || this.options.subHashCheck === false || this.subCheckedPass.has(this.tick)) return;
    const h = this.replay.hashes, n = h.regionNames.length;
    if (n === 0 || h.subInterval === 0) return;
    const row = (this.tick - h.subFirstTick) / h.subInterval;
    if (!Number.isInteger(row) || row < 0 || row * n >= h.subHashes.length) return;
    this.subChecked.add(this.tick); this.subCheckedPass.add(this.tick); computeSubHashes(this.world, this.sub, this.hasher);
    const regions = h.regionNames.filter((name, col) => {
      const i = this.names.indexOf(name); return i < 0 || this.sub[i] !== h.subHashes[row * n + col];
    });
    if (regions.length === 0) return;
    const pending = this.divergences.filter((d) => d.tick <= this.tick && d.regions.length === 0);
    if (pending.length === 0 && !this.divergences.some((d) => d.tick === this.tick && d.regions.join() === regions.join()))
      this.divergences.push({ tick: this.tick, expected: newHashAt(this.replay, this.tick), actual: this.ruleHash(), regions: [...regions] });
    else for (const d of pending) d.regions = [...regions];
  }
  result(): ReplayVerifyResult {
    const flags = this.replay.head.flags;
    return { endTick: this.tick, compared: this.checked.size, subCompared: this.subChecked.size,
      divergences: this.divergences, ruleHash: this.ruleHash(), fullHash: this.fullHash(),
      tainted: (flags & ReplayFlags.Tainted) !== 0, complete: (flags & ReplayFlags.Complete) !== 0, truncated: (flags & ReplayFlags.Truncated) !== 0 };
  }
  playToEnd(): ReplayVerifyResult { this.runUntil(this.endTick); return this.result(); }
  ruleHash(): number { return this.sim.ruleHash(); }
  fullHash(): number { return this.sim.fullHash(); }
}
function newHashAt(replay: RtsReplay, tick: number): number {
  const h = replay.hashes, i = (tick - h.firstTick) / h.interval;
  return Number.isInteger(i) && i >= 0 && i < h.hashes.length ? h.hashes[i]! : -1;
}
export function verifyReplay(input: Uint8Array | RtsReplay, options: ReplayPlayerOptions): ReplayVerifyResult { return ReplayPlayer.open(input, options).playToEnd(); }
