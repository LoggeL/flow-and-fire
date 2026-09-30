/**
 * Replay verification as a composable tick observer (PLAN §3.11 "Hash-Prüfung"): compares the
 * rule hashes a SimCore produces with the HASH chunk of the replay and, at every recorded sub-hash
 * tick, the rule-region sub-hashes. Independent of who drives the ticks: ReplayPlayer (headless,
 * tools) or — in MS11 — the sim worker's SimHost/scheduler, which calls `afterTick` after each
 * `SimCore.runTick` of a replay session.
 *
 * Hook-up: `attach(core)` registers the rule-hash listener (addHashListener, coexists with other
 * listeners); the driver calls `afterTick(world, tick)` after every simulated tick (also for
 * re-simulated ticks after a seek). A divergence carries the regions whose sub-hashes differ at the
 * first sub-hash tick ≥ its tick ("warnt bei Abweichung mit Tick und Tabelle"). Each recorded tick
 * is counted once, however often it is re-simulated.
 */

import { XxHash32 } from '@faf/fixed';
import type { World } from '@faf/sim';
import type { SimCore } from '../core.ts';
import { addHashListener } from './hash-listeners.ts';
import type { RtsReplaySource } from './source.ts';
import { computeSubHashes, ruleRegionNames } from './sub-hashes.ts';

/** A recorded hash the playback did not reproduce. */
export interface ReplayDivergence {
  /** Tick of the rule hash (kind 'rule') or sub-hash row (kind 'sub'). */
  readonly tick: number;
  /** Recorded rule hash (u32; −1 if the HASH chunk has none at this tick). */
  readonly expected: number;
  /** Rule hash of the playback at this tick (u32). */
  readonly actual: number;
  /**
   * Rule regions whose sub-hashes differ at the first sub-hash tick ≥ tick (empty without
   * sub-hashes, when they all match, or when the replay ends before the next sub-hash tick).
   */
  readonly regions: readonly string[];
  /** 'rule' = rule hash differs; 'sub' = only sub-hashes differ (rule hash equal or absent). */
  readonly kind: 'rule' | 'sub';
}

interface MutableDivergence {
  readonly tick: number;
  readonly expected: number;
  readonly actual: number;
  regions: string[];
  readonly kind: 'rule' | 'sub';
}

export interface ReplayVerifierOptions {
  /** Compare sub-hashes at the recorded sub-hash ticks (default true). */
  readonly subHashCheck?: boolean;
}

export class ReplayVerifier {
  readonly source: RtsReplaySource;
  /** Notes (e.g. sub-hash regions that do not match this layout). */
  readonly warnings: string[] = [];
  /** True if sub-hashes are compared. */
  readonly subCheck: boolean;
  private readonly divs: MutableDivergence[] = [];
  private readonly pending: MutableDivergence[] = [];
  private readonly regionNames: readonly string[];
  private readonly subActual: Uint32Array;
  private readonly hasher = new XxHash32();
  /** Highest tick observed so far (all ticks ≤ it were verified once). */
  private verifiedUpTo = 0;
  private comparedCount = 0;
  private subComparedCount = 0;

  /** `world`: the session's world (sub-hash regions of its layout). */
  constructor(source: RtsReplaySource, world: World, options: ReplayVerifierOptions = {}) {
    this.source = source;
    const names = ruleRegionNames(world);
    this.regionNames = names;
    this.subActual = new Uint32Array(names.length);
    const recorded = source.replay.hashes.regionNames;
    let subOk = options.subHashCheck !== false && recorded.length > 0;
    if (subOk && (recorded.length !== names.length || recorded.some((n, i) => n !== names[i]))) {
      this.warnings.push(`sub-hash regions of the replay (${recorded.join(', ')}) differ from this layout (${names.join(', ')}): sub-hash check off`);
      subOk = false;
    }
    this.subCheck = subOk;
  }

  /** Registers the rule-hash listener on `core`; returns the remover. */
  attach(core: SimCore): () => void {
    return addHashListener(core, (tick, hash) => this.onRuleHash(tick, hash));
  }

  /** Divergences found so far, ascending by tick. */
  get divergences(): readonly ReplayDivergence[] {
    return this.divs;
  }

  /** Copies of the divergences (stable against later sub-hash updates). */
  snapshotDivergences(): ReplayDivergence[] {
    return this.divs.map((d) => ({ tick: d.tick, expected: d.expected, actual: d.actual, regions: d.regions.slice(), kind: d.kind }));
  }

  /** Recorded rule hashes compared so far (each tick once). */
  get compared(): number {
    return this.comparedCount;
  }

  /** Recorded sub-hash rows compared so far (each tick once). */
  get subCompared(): number {
    return this.subComparedCount;
  }

  /** Highest tick observed (afterTick). */
  get observedUpTo(): number {
    return this.verifiedUpTo;
  }

  /** Recorded rule hashes at ticks ≤ observedUpTo (what `compared` should reach). */
  get recordedUpTo(): number {
    const h = this.source.replay.hashes;
    return gridCount(h.firstTick, h.interval, h.hashes.length, this.verifiedUpTo);
  }

  /** Recorded sub-hash rows at ticks ≤ observedUpTo. */
  get subRecordedUpTo(): number {
    const h = this.source.replay.hashes;
    const rc = h.regionNames.length;
    return gridCount(h.subFirstTick, h.subInterval, rc === 0 ? 0 : Math.floor(h.subHashes.length / rc), this.verifiedUpTo);
  }

  /** Rule-hash listener (attach registers it; call directly when wiring a core by hand). */
  onRuleHash(tick: number, hash: number): void {
    const exp = this.source.expectedHash(tick);
    if (exp < 0) return;
    const first = tick > this.verifiedUpTo;
    if (first) this.comparedCount++;
    if (exp === hash >>> 0) return;
    if (!first && this.indexOfDivergence(tick, 'rule') >= 0) return;
    const d: MutableDivergence = { tick, expected: exp, actual: hash >>> 0, regions: [], kind: 'rule' };
    this.insertDivergence(d);
    if (this.subCheck) this.pending.push(d);
  }

  /**
   * To be called after every simulated tick (the world is at `tick`): sub-hash check at recorded
   * sub-hash ticks. `ruleHash` is the world's current rule hash (only read for a 'sub' divergence).
   */
  afterTick(world: World, tick: number, ruleHash: () => number): void {
    if (this.subCheck && this.source.subHashRow(tick) >= 0) this.checkSubHashes(world, tick, ruleHash);
    if (tick > this.verifiedUpTo) this.verifiedUpTo = tick;
  }

  private checkSubHashes(world: World, tick: number, ruleHash: () => number): void {
    const expected = this.source.expectedSubHashes(tick)!;
    const actual = this.subActual;
    computeSubHashes(world, actual, this.hasher);
    if (tick > this.verifiedUpTo) this.subComparedCount++;
    const diff: string[] = [];
    for (let r = 0; r < actual.length; r++) if (actual[r] !== expected[r]) diff.push(this.regionNames[r]!);
    const pending = this.pending;
    let w = 0;
    for (let i = 0; i < pending.length; i++) {
      const p = pending[i]!;
      if (p.tick <= tick) p.regions = diff.slice();
      else pending[w++] = p;
    }
    pending.length = w;
    if (diff.length === 0 || this.indexOfDivergence(tick, 'rule') >= 0 || this.indexOfDivergence(tick, 'sub') >= 0) return;
    const exp = this.source.expectedHash(tick);
    this.insertDivergence({ tick, expected: exp, actual: ruleHash() >>> 0, regions: diff, kind: 'sub' });
  }

  private indexOfDivergence(tick: number, kind: 'rule' | 'sub'): number {
    const d = this.divs;
    for (let i = d.length - 1; i >= 0; i--) {
      if (d[i]!.tick < tick) return -1;
      if (d[i]!.tick === tick && d[i]!.kind === kind) return i;
    }
    return -1;
  }

  private insertDivergence(d: MutableDivergence): void {
    const a = this.divs;
    let i = a.length;
    while (i > 0 && a[i - 1]!.tick > d.tick) i--;
    a.splice(i, 0, d);
  }
}

/** Entries of the grid first + k·interval (k < n) at ticks ≤ upTo. */
function gridCount(first: number, interval: number, n: number, upTo: number): number {
  if (n === 0 || upTo < first) return 0;
  if (interval === 0) return n;
  return Math.min(n, Math.floor((upTo - first) / interval) + 1);
}
