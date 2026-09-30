/**
 * desync-diff (PLAN §3.12: "erster abweichender Tick, dann per Voll-Dump Tabelle, Spalte und
 * Entity"): explains why two recordings of the same game (replays or FAFL logs, same HEAD
 * identity) differ.
 *
 * 1. Recorded comparison without simulating: first differing rule hash of the two HASH trails
 *    (firstDivergentRecordedTick), first differing sub-hash row (with its regions) and the first
 *    tick whose CMDS entries differ.
 * 2. The earliest tick that may differ (command tick, recorded hash interval, perturbation) fixes
 *    the start: the last keyframe tick before it (keyframe interval of the player, 600). A plays
 *    to that tick and its keyframe is restored into B ("letzter gemeinsamer Keyframe"); then both
 *    are stepped in lockstep with a rule-hash comparison after EVERY tick (findFirstDivergence).
 * 3. At the first divergent tick full dumps of both sides are taken (captureStateDump) and
 *    compared region by region, column by column, entity by entity (diffStateDumps).
 *
 * Outcomes (CLI exit codes): 'equal' 0 · 'divergent' 1 (re-simulations diverge, explained by the
 * dump diff — always when the lockstep search found a divergence, even if the recordings already
 * differ earlier; that earlier recording difference is reported as a note, `recordingFirst`) ·
 * 'recording-only' 3 (the recordings differ, but both re-simulations in this engine agree: an
 * engine/build desync — take a dump with `--dump` in the other engine and compare the dumps).
 * Incompatible inputs (other game, other build, broken file) throw (exit code 2).
 *
 * `perturbB` writes one column value of B's world right after B's step to `tick` through the
 * table views of the world (world.<region>.col.<column>[index]) — a self-check of the whole chain.
 *
 * Environment-neutral (Node and browser worker): no node: imports, the clock is a parameter.
 */
import { readAllCommands, type ReplayTickCommands, type RtsReplay } from '@faf/formats';
import { ReplayPlayer, replayEndTick, type ReplayDivergence } from '@faf/sim-host';
import type { World } from '@faf/sim';
import type { Clock } from '../stats.ts';
import { captureStateDump, type StateDump } from './dump.ts';
import { findFirstDivergence, firstDivergentRecordedTick, type SteppedRun } from './divergence.ts';
import { diffStateDumps, formatStateDiff, type StateDiff } from './state-diff.ts';
import { hex32, loadReplayInput, type LoadedReplay, type ReplayAssets } from './verify.ts';

/** One value written into B's world after B's step to `tick` (self-check / tests). */
export interface DesyncPerturbation {
  readonly tick: number;
  /** Region (table or dense component), e.g. 'units', 'movers', 'armies'. */
  readonly region: string;
  /** Column of the region, e.g. 'hp', 'x'. */
  readonly column: string;
  /** Element index: entity slot (tables) or dense row. */
  readonly index: number;
  readonly value: number;
}

export interface DesyncDiffOptions {
  readonly perturbB?: DesyncPerturbation;
  /** Maximum diff entries (default 40). */
  readonly limit?: number;
  /** Labels of the two sides (dumps and output), default 'A' / 'B'. */
  readonly labelA?: string;
  readonly labelB?: string;
  readonly clock?: Clock;
}

/** The two inputs belong to different games or builds (CLI exit code 2). */
export class DesyncIncompatibleError extends Error {
  override readonly name = 'DesyncIncompatibleError';
}

export type DesyncStatus = 'equal' | 'divergent' | 'recording-only';

export interface RecordedComparison {
  /** First common tick whose recorded rule hashes differ (null: equal on all common ticks). */
  readonly ruleTick: number | null;
  /** Recorded rule hashes on ticks both recordings cover, before the first difference. */
  readonly commonHashes: number;
  /** First common sub-hash row that differs and its regions (null: equal or not comparable). */
  readonly sub: { readonly tick: number; readonly regions: readonly string[] } | null;
  /** Why sub-hashes were not compared (empty = compared). */
  readonly subNote: string;
  /** First tick whose CMDS entries differ (missing on one side or other bytes); null = equal. */
  readonly commandTick: number | null;
  /** Ticks with commands in A / B. */
  readonly commandTicksA: number;
  readonly commandTicksB: number;
  /** Last ticks of the two replays. */
  readonly endA: number;
  readonly endB: number;
}

export interface DesyncReport {
  readonly status: DesyncStatus;
  readonly exitCode: 0 | 1 | 3;
  readonly labelA: string;
  readonly labelB: string;
  readonly kindA: 'rtsreplay' | 'fafl';
  readonly kindB: 'rtsreplay' | 'fafl';
  readonly recorded: RecordedComparison;
  /** True if the replays were re-simulated (false: nothing differs, nothing to explain). */
  readonly simulated: boolean;
  /** Keyframe tick the lockstep search started at (null without simulation). */
  readonly startTick: number | null;
  /** Last tick of the lockstep search (common end of both replays). */
  readonly toTick: number;
  /**
   * First tick at which the recordings (rule or sub-hashes) differ if that lies BEFORE the first
   * divergence of the re-simulations (status 'divergent'): an additional recording-only difference
   * (e.g. a manipulated or engine-specific hash) — null otherwise.
   */
  readonly recordingFirst: number | null;
  /** First tick whose re-simulated rule hashes differ (null: equal through toTick). */
  readonly tick: number | null;
  readonly ruleA: number;
  readonly ruleB: number;
  /** Full dump diff at `tick` (null without divergence). */
  readonly diff: StateDiff | null;
  readonly dumpA: StateDump | null;
  readonly dumpB: StateDump | null;
  /**
   * First divergence of each re-simulation from its own recording within the simulated range
   * (A from tick 0, B from startTick): names the odd recording of an engine/build desync.
   */
  readonly recordingA: ReplayDivergence | null;
  readonly recordingB: ReplayDivergence | null;
  readonly perturbation: DesyncPerturbation | null;
  readonly ms: number;
}

// ---- recorded comparison -----------------------------------------------------------------------

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** First tick whose command entries differ (present on one side only, or other bytes). */
export function firstDifferentCommandTick(a: readonly ReplayTickCommands[], b: readonly ReplayTickCommands[]): number | null {
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const ea = a[i];
    const eb = b[j];
    if (ea === undefined) return eb!.tick;
    if (eb === undefined) return ea.tick;
    if (ea.tick !== eb.tick) return Math.min(ea.tick, eb.tick);
    if (!sameBytes(ea.batch, eb.batch)) return ea.tick;
    i++;
    j++;
  }
  return null;
}

function commonRuleHashes(a: RtsReplay, b: RtsReplay, upTo: number | null): number {
  const ha = a.hashes;
  const hb = b.hashes;
  let n = 0;
  for (let k = 0; k < ha.hashes.length; k++) {
    const t = ha.firstTick + k * ha.interval;
    if (upTo !== null && t >= upTo) break;
    const kb = (t - hb.firstTick) / hb.interval;
    if (Number.isInteger(kb) && kb >= 0 && kb < hb.hashes.length) n++;
  }
  return n;
}

function compareSubHashes(a: RtsReplay, b: RtsReplay): { sub: RecordedComparison['sub']; note: string } {
  const ha = a.hashes;
  const hb = b.hashes;
  const rc = ha.regionNames.length;
  if (rc === 0 || hb.regionNames.length === 0) return { sub: null, note: 'mindestens eine Aufnahme ohne Sub-Hashes' };
  if (rc !== hb.regionNames.length || ha.regionNames.some((n, i) => n !== hb.regionNames[i])) {
    return { sub: null, note: `unterschiedliche Sub-Hash-Regionen (${ha.regionNames.join(', ')} ↔ ${hb.regionNames.join(', ')})` };
  }
  const rowsA = Math.floor(ha.subHashes.length / rc);
  const rowsB = Math.floor(hb.subHashes.length / rc);
  for (let k = 0; k < rowsA; k++) {
    const t = ha.subFirstTick + k * ha.subInterval;
    const kb = (t - hb.subFirstTick) / hb.subInterval;
    if (!Number.isInteger(kb) || kb < 0) continue;
    if (kb >= rowsB) break;
    const regions: string[] = [];
    for (let r = 0; r < rc; r++) if (ha.subHashes[k * rc + r] !== hb.subHashes[kb * rc + r]) regions.push(ha.regionNames[r]!);
    if (regions.length > 0) return { sub: { tick: t, regions }, note: '' };
  }
  return { sub: null, note: '' };
}

/** Compares the recordings of two replays without simulating (rule/sub hashes, commands). */
export function compareRecordings(a: RtsReplay, b: RtsReplay): RecordedComparison {
  const ha = a.hashes;
  const hb = b.hashes;
  const ruleTick = firstDivergentRecordedTick(
    { firstTick: ha.firstTick, interval: Math.max(1, ha.interval), values: ha.hashes },
    { firstTick: hb.firstTick, interval: Math.max(1, hb.interval), values: hb.hashes },
  );
  const { sub, note } = compareSubHashes(a, b);
  const ca = readAllCommands(a);
  const cb = readAllCommands(b);
  return {
    ruleTick,
    commonHashes: commonRuleHashes(a, b, ruleTick),
    sub,
    subNote: note,
    commandTick: firstDifferentCommandTick(ca, cb),
    commandTicksA: ca.length,
    commandTicksB: cb.length,
    endA: replayEndTick(a),
    endB: replayEndTick(b),
  };
}

// ---- identity ----------------------------------------------------------------------------------

/** Throws DesyncIncompatibleError unless both replays record the same game on the same build. */
export function assertSameGame(a: RtsReplay, b: RtsReplay): void {
  const diffs: string[] = [];
  const cmp = (what: string, x: number | string, y: number | string, fmt: (v: number | string) => string = String): void => {
    if (x !== y) diffs.push(`${what} ${fmt(x)} ≠ ${fmt(y)}`);
  };
  const h = (v: number | string): string => (typeof v === 'number' ? hex32(v) : v);
  cmp('simBuild', a.head.simBuild, b.head.simBuild);
  cmp('simId', a.head.simId >>> 0, b.head.simId >>> 0, h);
  cmp('bpSimHash', a.head.bpSimHash >>> 0, b.head.bpSimHash >>> 0, h);
  cmp('mapSimHash', a.head.mapSimHash >>> 0, b.head.mapSimHash >>> 0, h);
  cmp('layoutHash', a.head.layoutHash >>> 0, b.head.layoutHash >>> 0, h);
  cmp('seed', a.game.seed >>> 0, b.game.seed >>> 0, h);
  cmp('mapSizeWu', a.game.mapSizeWu, b.game.mapSizeWu);
  cmp('armies', a.game.armies.length, b.game.armies.length);
  if (!sameBytes(a.game.alliances, b.game.alliances)) diffs.push('alliances differ');
  if (diffs.length > 0) throw new DesyncIncompatibleError(`the two recordings are not the same game: ${diffs.join(', ')}`);
}

// ---- perturbation ------------------------------------------------------------------------------

interface ColumnOwner {
  readonly name: string;
  readonly col: Readonly<Record<string, { length: number; [i: number]: number }>>;
}

function isColumnOwner(v: unknown): v is ColumnOwner {
  if (v === null || typeof v !== 'object') return false;
  const o = v as { name?: unknown; col?: unknown };
  return typeof o.name === 'string' && o.col !== null && typeof o.col === 'object';
}

/** Column view `world.<region>.col.<column>` (tables and dense components). */
export function worldColumn(world: World, region: string, column: string): { length: number; [i: number]: number } {
  for (const v of Object.values(world)) {
    if (!isColumnOwner(v) || v.name !== region) continue;
    const c = v.col[column];
    if (c === undefined) throw new RangeError(`region '${region}' has no column '${column}' (columns: ${Object.keys(v.col).join(', ')})`);
    return c;
  }
  throw new RangeError(`world has no table/dense region '${region}'`);
}

/** Writes the perturbation into `world` (validates region, column and index). */
export function applyPerturbation(world: World, p: DesyncPerturbation): void {
  const c = worldColumn(world, p.region, p.column);
  if (!Number.isInteger(p.index) || p.index < 0 || p.index >= c.length) throw new RangeError(`perturbation index ${p.index} outside ${p.region}.${p.column} [0, ${c.length})`);
  c[p.index] = p.value;
}

// ---- lockstep search ---------------------------------------------------------------------------

function playerRun(p: ReplayPlayer, after?: (tick: number) => void): SteppedRun {
  return {
    tick: () => p.tick,
    step: () => {
      if (p.step(1) !== 1) throw new Error(`replay ended at tick ${p.tick}`);
      after?.(p.tick);
    },
    ruleHash: () => p.ruleHash() >>> 0,
  };
}

function firstRecordingDivergence(p: ReplayPlayer): ReplayDivergence | null {
  const d = p.divergences;
  return d.length > 0 ? d[0]! : null;
}

function openPlayer(l: LoadedReplay, assets: ReplayAssets, keyframes: boolean): ReplayPlayer {
  return ReplayPlayer.open(l.replay, {
    simBin: assets.simBin,
    ...(l.map !== undefined ? { map: l.map } : {}),
    ...(keyframes ? {} : { keyframes: false as const }),
  });
}

/**
 * Explains the difference between two recordings of one game (see module doc). `a`/`b` are
 * .rtsreplay or FAFL bytes. Throws DesyncIncompatibleError (other game), ReplayCompatError (this
 * build cannot play them), FormatError / CommandLogError / ReplayInputError (unreadable input).
 */
export function desyncDiff(a: Uint8Array, b: Uint8Array, assets: ReplayAssets, opts: DesyncDiffOptions = {}): DesyncReport {
  const clock = opts.clock ?? ((): number => performance.now());
  const t0 = clock();
  const labelA = opts.labelA ?? 'A';
  const labelB = opts.labelB ?? 'B';
  const la = loadReplayInput(a, assets, { subHashes: false, clock });
  const lb = loadReplayInput(b, assets, { subHashes: false, clock });
  assertSameGame(la.replay, lb.replay);
  const recorded = compareRecordings(la.replay, lb.replay);
  const toTick = Math.min(recorded.endA, recorded.endB);
  const perturb = opts.perturbB ?? null;
  if (perturb !== null && (!Number.isInteger(perturb.tick) || perturb.tick < 0 || perturb.tick > toTick)) {
    throw new RangeError(`perturbation tick ${perturb.tick} outside [0, ${toTick}]`);
  }

  // Earliest tick whose state may differ.
  let earliest = Number.POSITIVE_INFINITY;
  if (recorded.commandTick !== null) earliest = Math.min(earliest, recorded.commandTick);
  const hi = Math.max(la.replay.hashes.interval, lb.replay.hashes.interval, 1);
  if (recorded.ruleTick !== null) earliest = Math.min(earliest, Math.max(0, recorded.ruleTick - hi + 1));
  const si = Math.max(la.replay.hashes.subInterval, lb.replay.hashes.subInterval, 1);
  if (recorded.sub !== null) earliest = Math.min(earliest, Math.max(0, recorded.sub.tick - si + 1));
  if (perturb !== null) earliest = Math.min(earliest, perturb.tick);

  const base = { labelA, labelB, kindA: la.kind, kindB: lb.kind, recorded, toTick, perturbation: perturb, recordingFirst: null };
  if (!(earliest <= toTick)) {
    return {
      ...base,
      status: 'equal',
      exitCode: 0,
      simulated: false,
      startTick: null,
      tick: null,
      ruleA: 0,
      ruleB: 0,
      diff: null,
      dumpA: null,
      dumpB: null,
      recordingA: null,
      recordingB: null,
      ms: clock() - t0,
    };
  }

  const pa = openPlayer(la, assets, true);
  const pb = openPlayer(lb, assets, false);
  const kfi = pa.keyframes.intervalTicks;
  const start = Math.max(0, Math.floor((earliest - 1) / kfi) * kfi);
  pa.runUntil(start);
  if (start > 0) {
    const ki = pa.keyframes.latestAtOrBefore(start);
    if (ki < 0) throw new Error(`no keyframe at or before tick ${start}`);
    pa.keyframes.restoreInto(pb.core, ki);
    pb.runUntil(start);
  }
  if (perturb !== null && perturb.tick === start) applyPerturbation(pb.world, perturb);
  const runA = playerRun(pa);
  const runB = playerRun(pb, perturb !== null ? (t): void => (t === perturb.tick ? applyPerturbation(pb.world, perturb) : undefined) : undefined);
  const div = findFirstDivergence(runA, runB, { toTick });

  let diff: StateDiff | null = null;
  let dumpA: StateDump | null = null;
  let dumpB: StateDump | null = null;
  if (div.tick !== null) {
    dumpA = captureStateDump(pa.world, { label: labelA, simId: la.replay.head.simId });
    dumpB = captureStateDump(pb.world, { label: labelB, simId: lb.replay.head.simId });
    diff = diffStateDumps(dumpA, dumpB, { limit: opts.limit ?? 40 });
  }
  const recTick = minTick(recorded.ruleTick, recorded.sub?.tick ?? null);
  // A divergence of the re-simulations is real and explained by the dump diff, whatever the
  // recordings say; an earlier recording difference is only a note.
  let status: DesyncStatus;
  if (div.tick !== null) status = 'divergent';
  else if (recTick !== null) status = 'recording-only';
  else status = 'equal';
  return {
    ...base,
    recordingFirst: div.tick !== null && recTick !== null && recTick < div.tick ? recTick : null,
    status,
    exitCode: status === 'equal' ? 0 : status === 'divergent' ? 1 : 3,
    simulated: true,
    startTick: start,
    tick: div.tick,
    ruleA: div.ruleA,
    ruleB: div.ruleB,
    diff,
    dumpA,
    dumpB,
    recordingA: firstRecordingDivergence(pa),
    recordingB: firstRecordingDivergence(pb),
    ms: clock() - t0,
  };
}

function minTick(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

// ---- dump mode ---------------------------------------------------------------------------------

/**
 * Full state dump of a replay (or FAFL log) at `tick` — `desync-diff --dump`: taken in each engine
 * and compared with compareStateDumps when only the recordings differ.
 */
export function dumpReplayAt(bytes: Uint8Array, assets: ReplayAssets, tick: number, opts: { label?: string } = {}): StateDump {
  const l = loadReplayInput(bytes, assets, { subHashes: false });
  const p = openPlayer(l, assets, false);
  if (!Number.isInteger(tick) || tick < 0 || tick > p.endTick) throw new RangeError(`dump tick ${tick} outside the replay [0, ${p.endTick}]`);
  p.runUntil(tick);
  return captureStateDump(p.world, { label: opts.label ?? '', simId: l.replay.head.simId });
}

/**
 * Compares two dumps (`desync-diff a.rtsdump b.rtsdump`). Dumps of different sessions (both simIds
 * known and unequal) are refused with DesyncIncompatibleError.
 */
export function compareStateDumps(a: StateDump, b: StateDump, opts: { limit?: number } = {}): { diff: StateDiff; exitCode: 0 | 1 } {
  if (a.simId !== 0 && b.simId !== 0 && a.simId >>> 0 !== b.simId >>> 0) {
    throw new DesyncIncompatibleError(`the dumps belong to different sessions: simId ${hex32(a.simId)} ≠ ${hex32(b.simId)}`);
  }
  const diff = diffStateDumps(a, b, { limit: opts.limit ?? 40 });
  return { diff, exitCode: diff.equal ? 0 : 1 };
}

// ---- report ------------------------------------------------------------------------------------

function de(n: number): string {
  return n.toLocaleString('de-DE');
}

function divergenceText(d: ReplayDivergence | null, from: number): string {
  if (d === null) return `stimmt mit der Nachsimulation überein (geprüft ab Tick ${de(from)})`;
  const regions = d.regions.length > 0 ? `, Tabelle(n) ${d.regions.join(', ')}` : '';
  return `weicht ab Tick ${de(d.tick)} von der Nachsimulation ab (aufgezeichnet ${d.expected < 0 ? '–' : hex32(d.expected)}, nachsimuliert ${hex32(d.actual)}${regions})`;
}

/** German report of a desync-diff run (the CLI prints it). */
export function formatDesyncReport(r: DesyncReport): string {
  const rec = r.recorded;
  const out: string[] = [];
  out.push(`desync-diff  A: ${r.labelA}${r.kindA === 'fafl' ? ' (FAFL-Log)' : ''}  ↔  B: ${r.labelB}${r.kindB === 'fafl' ? ' (FAFL-Log)' : ''}`);
  out.push(`Länge: A ${de(rec.endA)} Ticks, B ${de(rec.endB)} Ticks – verglichen bis Tick ${de(r.toTick)}`);
  out.push('');
  out.push('Aufnahmen (ohne Simulation):');
  out.push(
    rec.ruleTick !== null
      ? `  Regel-Hash-Trail: erste Abweichung bei Tick ${de(rec.ruleTick)} (${de(rec.commonHashes)} gemeinsame Hashes davor gleich)`
      : `  Regel-Hash-Trail: identisch (${de(rec.commonHashes)} gemeinsame Hashes)`,
  );
  if (rec.sub !== null) out.push(`  Sub-Hashes: erste Abweichung bei Tick ${de(rec.sub.tick)} in ${rec.sub.regions.join(', ')}`);
  else out.push(`  Sub-Hashes: ${rec.subNote !== '' ? `nicht verglichen – ${rec.subNote}` : 'identisch'}`);
  out.push(
    rec.commandTick !== null
      ? `  Commands: erster unterschiedlicher Command-Tick ${de(rec.commandTick)} (A ${de(rec.commandTicksA)}, B ${de(rec.commandTicksB)} Command-Ticks)`
      : `  Commands: identisch (${de(rec.commandTicksA)} Command-Ticks)`,
  );
  if (r.perturbation !== null) {
    const p = r.perturbation;
    out.push(`  Perturbation: B.${p.region}.${p.column}[${p.index}] = ${p.value} nach Tick ${de(p.tick)}`);
  }
  out.push('');
  if (!r.simulated) {
    out.push('Keine Abweichung: Commands, Hash-Trail und Sub-Hashes identisch – dieselbe Partie, keine Nachsimulation nötig.');
    return out.join('\n') + '\n';
  }
  out.push(`Nachsimulation: A bis zum Keyframe-Tick ${de(r.startTick!)}, Keyframe in B übernommen, dann Gleichschritt mit Regel-Hash nach jedem Tick bis Tick ${de(r.toTick)}.`);
  out.push(`  Aufnahme A ${divergenceText(r.recordingA, 0)}`);
  out.push(`  Aufnahme B ${divergenceText(r.recordingB, r.startTick!)}`);
  out.push('');
  if (r.tick !== null) {
    out.push(`Erste Abweichung der Nachsimulation bei Tick ${de(r.tick)}: Regel-Hash A ${hex32(r.ruleA)} ≠ B ${hex32(r.ruleB)}`);
    if (rec.commandTick !== null && rec.commandTick === r.tick) out.push(`  = erster unterschiedlicher Command-Tick (${de(rec.commandTick)}): die Commands erklären die Abweichung.`);
    else if (rec.commandTick !== null) out.push(`  Erster unterschiedlicher Command-Tick: ${de(rec.commandTick)}`);
    if (r.diff !== null) {
      out.push('');
      out.push(formatStateDiff(r.diff).trimEnd());
    }
    out.push('');
  }
  if (r.status === 'divergent') {
    out.push(`Ergebnis: Abweichung gefunden und erklärt (Tick ${de(r.tick!)}${r.diff !== null && r.diff.entries.length > 0 ? `, zuerst ${r.diff.entries[0]!.region}.${r.diff.entries[0]!.part} ${r.diff.entries[0]!.entity}` : ''}).`);
    if (r.recordingFirst !== null) {
      out.push(
        `  Hinweis: die Aufnahmen weichen schon ab Tick ${de(r.recordingFirst)} voneinander ab, die Nachsimulationen erst ab Tick ${de(r.tick!)} – ` +
          'zusätzlich eine reine Aufnahme-Differenz (siehe "Aufnahme A/B" oben; ggf. Engine-Dump mit --dump).',
      );
    }
  } else if (r.status === 'recording-only') {
    const t = minTick(rec.ruleTick, rec.sub?.tick ?? null)!;
    out.push('Engine-/Build-Desync: Aufnahme weicht ab, Nachsimulation stimmt überein – Dump in der anderen Engine erzeugen (--dump)');
    out.push(`  Aufnahmen weichen ab Tick ${de(t)} voneinander ab; beide Nachsimulationen in dieser Engine sind ${r.tick === null ? 'bis zum Ende' : `bis Tick ${de(r.tick - 1)}`} gleich.`);
    out.push(`  Nächster Schritt: in beiden Engines "desync-diff --dump <replay> --tick ${t} --out <engine>.rtsdump", dann "desync-diff a.rtsdump b.rtsdump".`);
  } else {
    out.push(`Ergebnis: keine Abweichung – die Nachsimulationen sind bis Tick ${de(r.toTick)} gleich${rec.commandTick !== null ? ' (die unterschiedlichen Commands wirken sich nicht auf den Regel-Zustand aus)' : ''}.`);
  }
  return out.join('\n') + '\n';
}
