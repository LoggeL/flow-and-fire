/**
 * Replay benchmark (script `bench:replay`, acceptance values of PLAN §5.2 MS11 measured headless):
 *
 * 1. Recording: the sim-valid long game (long-game.ts, hollow-ridge, 2 × 120 APM, 30 min;
 *    `--quick` 10 min) → FAFL log → convertCommandLog (re-simulation, sub-hashes) → .rtsreplay.
 * 2. Size: replaySizeReport of that replay (CMDS / total) — the script puts the synthetic FA-mix
 *    model (replay-size) next to it.
 * 3. Playback: ReplayPlayer.playToEnd with rule-hash and sub-hash verification and the default
 *    keyframe store (every 600 ticks, as a viewer would run it) in ticks/s and × real time
 *    (10 ticks/s; target ≥ 20x = ≥ 200 ticks/s). "first" = first playback in this process (the JIT
 *    already ran the recording/conversion); "warm" = median of further runs with fresh players;
 *    the script adds a truly cold run in a fresh Node process.
 * 4. Seek backwards: from the end to 20 targets (fixed seed) plus the worst case (the tick before
 *    the keyframe that ends the widest keyframe gap: restore + a full interval of re-simulation),
 *    median / p95 / max in ms (target ≤ 2,000 ms). Every target's full hash is checked against a
 *    direct run.
 * 5. Keyframe memory after the game (count, compressed / raw bytes, thinnings).
 *
 * Environment-neutral (Node and browser worker): no node: imports, the clock is a parameter.
 */
import { readRtsReplay, replaySizeReport, type ReplaySizeReport } from '@faf/formats';
import { convertCommandLog, ReplayPlayer } from '@faf/sim-host';
import { summarize, round4, type Clock, type Summary } from '../stats.ts';
import { HOLLOW_RIDGE_PATH } from '../scenarios.ts';
import { recordLongGame, LONG_GAME_DEFAULT_SEED } from './long-game.ts';
import { findMapBySimHash, REPLAY_TICKS_PER_SECOND, type ReplayAssets } from './verify.ts';

/** PLAN §5.2 MS11 (headless, local): playback ≥ 20× real time. */
export const PLAYBACK_GATE_X = 20;
/** PLAN §5.2 MS11: seek backwards p95 ≤ 2 s. */
export const SEEK_GATE_P95_MS = 2000;
/** Seed of the seek target sequence (fixed so runs are comparable). */
export const SEEK_TARGET_SEED = 0x5eec7a29;

export interface ReplayBenchOptions extends ReplayAssets {
  /** Game length in minutes (default 30). */
  readonly minutes?: number;
  readonly seed?: number;
  /** Number of random seek targets (default 20). */
  readonly seekTargets?: number;
  /** Warm playback runs after the first one (default 3). */
  readonly warmRuns?: number;
  readonly clock: Clock;
  readonly gc?: () => void;
  readonly log?: (line: string) => void;
  /** Receives the measured .rtsreplay (e.g. for playback in a fresh process). */
  readonly onReplay?: (bytes: Uint8Array) => void;
}

/** One playback measurement. */
export interface PlaybackRun {
  /** ReplayPlayer.open (read, checks, world creation, tick-0 keyframe), ms. */
  readonly openMs: number;
  /** playToEnd incl. verification and keyframes, ms. */
  readonly playMs: number;
  readonly ticks: number;
  readonly ticksPerSecond: number;
  readonly xRealtime: number;
  readonly compared: number;
  readonly subCompared: number;
  readonly divergences: number;
  readonly fullHash: number;
  readonly keyframes: number;
}

export interface ReplayBenchResult {
  readonly game: {
    readonly map: string;
    readonly minutes: number;
    readonly ticks: number;
    readonly seed: number;
    readonly apm: readonly number[];
    readonly envelopes: number;
    readonly liveUnitsMean: number;
    readonly logBytes: number;
    readonly recordMs: number;
    readonly finalFullHash: number;
  };
  readonly convert: {
    readonly ms: number;
    readonly verified: boolean;
    readonly compared: number;
    readonly warnings: readonly string[];
  };
  readonly size: ReplaySizeReport;
  readonly recordedHashes: number;
  readonly recordedSubHashes: number;
  readonly playback: {
    readonly first: PlaybackRun;
    readonly warm: readonly PlaybackRun[];
    /** Median over the warm runs. */
    readonly warmPlayMs: number;
    readonly warmTicksPerSecond: number;
    readonly warmXRealtime: number;
  };
  readonly seek: {
    readonly targets: readonly number[];
    readonly ms: readonly number[];
    readonly summary: Summary;
    readonly worstCase: { readonly target: number; readonly keyframeTick: number; readonly ms: number };
    readonly restores: number;
    /** Every sought state had the full hash of the direct run. */
    readonly exact: boolean;
  };
  readonly keyframes: {
    readonly count: number;
    readonly bytes: number;
    readonly rawBytes: number;
    readonly thinnings: number;
    readonly intervalTicks: number;
  };
  /** Correctness problems (hash divergences, inexact seeks). Timings are judged by the caller. */
  readonly errors: readonly string[];
}

/** xorshift32 stream for the seek targets (benchmark only, not simulation). */
function targetsFor(seed: number, n: number, endTick: number): number[] {
  let x = seed >>> 0 || 1;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    out.push(x % endTick);
  }
  return out;
}

/**
 * Plays `bytes` once with a fresh player (default keyframes, full verification); openMs includes
 * reading the container and the map lookup.
 */
export function measurePlayback(bytes: Uint8Array, assets: ReplayAssets, clock: Clock): PlaybackRun {
  const t0 = clock();
  const replay = readRtsReplay(bytes);
  const replayMap = findMapBySimHash(assets.maps, replay.head.mapSimHash);
  const player = ReplayPlayer.open(replay, { simBin: assets.simBin, ...(replayMap !== null ? { map: replayMap.map } : {}) });
  const t1 = clock();
  const r = player.playToEnd();
  const t2 = clock();
  const playMs = t2 - t1;
  const tps = playMs > 0 ? (r.endTick * 1000) / playMs : 0;
  return {
    openMs: round4(t1 - t0),
    playMs: round4(playMs),
    ticks: r.endTick,
    ticksPerSecond: Math.round(tps),
    xRealtime: round4(tps / REPLAY_TICKS_PER_SECOND),
    compared: r.compared,
    subCompared: r.subCompared,
    divergences: r.divergences.length,
    fullHash: r.fullHash >>> 0,
    keyframes: player.keyframes.count,
  };
}

/** Runs the whole benchmark (see module doc). */
export function runReplayBench(opts: ReplayBenchOptions): ReplayBenchResult {
  const clock = opts.clock;
  const log = opts.log ?? ((): void => undefined);
  const gc = opts.gc ?? ((): void => undefined);
  const minutes = opts.minutes ?? 30;
  const errors: string[] = [];
  const assets: ReplayAssets = { simBin: opts.simBin, maps: opts.maps };

  log(`» recording the long game (hollow-ridge, ${minutes} min, 2 × 120 APM) …`);
  let t = clock();
  const game = recordLongGame({ minutes, simBin: opts.simBin, maps: opts.maps, map: 'hollow-ridge', ...(opts.seed !== undefined ? { seed: opts.seed } : {}) });
  const recordMs = clock() - t;

  log('» converting FAFL → .rtsreplay (re-simulation with sub-hashes) …');
  const ridge = opts.maps[HOLLOW_RIDGE_PATH];
  if (ridge === undefined) throw new Error(`maps must contain ${HOLLOW_RIDGE_PATH}`);
  t = clock();
  const conv = convertCommandLog(game.log, { map: ridge, simBin: opts.simBin });
  const convertMs = clock() - t;
  if (!conv.verified) errors.push(`conversion not verified (${conv.mismatches.length} mismatches)`);
  const bytes = conv.bytes;
  opts.onReplay?.(bytes);
  const size = replaySizeReport(bytes);
  const h = conv.input.hashes;
  const recordedHashes = h.hashes.length;
  const recordedSubHashes = h.regionNames.length > 0 ? Math.floor(h.subHashes.length / h.regionNames.length) : 0;

  const check = (label: string, r: PlaybackRun): void => {
    if (r.divergences > 0) errors.push(`${label}: ${r.divergences} hash divergences`);
    if (r.compared !== recordedHashes) errors.push(`${label}: compared ${r.compared} of ${recordedHashes} rule hashes`);
    if (r.subCompared !== recordedSubHashes) errors.push(`${label}: compared ${r.subCompared} of ${recordedSubHashes} sub-hash rows`);
    if (r.fullHash !== game.stats.finalFullHash >>> 0) errors.push(`${label}: final full hash differs from the recording`);
  };

  log('» playback (first run in this process) …');
  gc();
  const first = measurePlayback(bytes, assets, clock);
  check('first playback', first);
  const warm: PlaybackRun[] = [];
  const warmRuns = opts.warmRuns ?? 3;
  for (let i = 0; i < warmRuns; i++) {
    gc();
    log(`» playback warm ${i + 1}/${warmRuns} …`);
    const r = measurePlayback(bytes, assets, clock);
    check(`warm playback ${i + 1}`, r);
    warm.push(r);
  }
  const warmSorted = warm.map((r) => r.playMs).sort((a, b) => a - b);
  const warmPlayMs = warmSorted.length > 0 ? warmSorted[Math.floor((warmSorted.length - 1) / 2)]! : first.playMs;
  const warmTps = warmPlayMs > 0 ? (first.ticks * 1000) / warmPlayMs : 0;

  log('» seek backwards …');
  gc();
  const map = findMapBySimHash(opts.maps, conv.input.head.mapSimHash);
  const player = ReplayPlayer.open(bytes, { simBin: opts.simBin, ...(map !== null ? { map: map.map } : {}) });
  player.playToEnd();
  const end = player.endTick;
  const store = player.keyframes;
  const keyframes = { count: store.count, bytes: store.byteLength, rawBytes: store.rawByteLength, thinnings: store.thinnings, intervalTicks: store.intervalTicks };
  // Worst case: the tick before the keyframe that closes the widest gap (or the end); among equal
  // gaps the latest (most units to re-simulate).
  let worstTarget = 0;
  let worstKf = 0;
  let widest = -1;
  for (let i = 0; i < store.count; i++) {
    const kt = store.tickAt(i);
    const next = i + 1 < store.count ? store.tickAt(i + 1) - 1 : end;
    if (next - kt >= widest) {
      widest = next - kt;
      worstTarget = next;
      worstKf = kt;
    }
  }
  const targets = targetsFor(SEEK_TARGET_SEED, opts.seekTargets ?? 20, end);
  const ms: number[] = [];
  const hashes: number[] = [];
  const restoresBefore = player.restores;
  for (const target of targets) {
    player.seek(end);
    gc();
    const s0 = clock();
    player.seek(target);
    ms.push(round4(clock() - s0));
    hashes.push(player.fullHash() >>> 0);
  }
  player.seek(end);
  gc();
  const w0 = clock();
  player.seek(worstTarget);
  const worstMs = round4(clock() - w0);
  const worstHash = player.fullHash() >>> 0;
  const restores = player.restores - restoresBefore;

  // Direct run: full hashes at every target.
  log('» direct reference run for the seek targets …');
  const ref = ReplayPlayer.open(bytes, { simBin: opts.simBin, keyframes: false, verify: false, ...(map !== null ? { map: map.map } : {}) });
  const order = [...targets, worstTarget].map((tk, i) => ({ tk, i })).sort((a, b) => a.tk - b.tk);
  const direct: number[] = new Array<number>(order.length).fill(0);
  for (const o of order) {
    ref.runUntil(o.tk);
    direct[o.i] = ref.fullHash() >>> 0;
  }
  let exact = true;
  for (let i = 0; i < targets.length; i++) {
    if (hashes[i] !== direct[i]) {
      exact = false;
      errors.push(`seek to ${targets[i]} gave full hash 0x${hashes[i]!.toString(16)} instead of 0x${direct[i]!.toString(16)}`);
    }
  }
  if (worstHash !== direct[targets.length]) {
    exact = false;
    errors.push(`worst-case seek to ${worstTarget} is not exact`);
  }
  if (player.divergences.length > 0) errors.push(`seek player: ${player.divergences.length} hash divergences`);

  return {
    game: {
      map: 'hollow-ridge',
      minutes,
      ticks: game.stats.ticks,
      seed: opts.seed ?? LONG_GAME_DEFAULT_SEED,
      apm: game.stats.apmPerArmy,
      envelopes: game.stats.envelopes,
      liveUnitsMean: game.stats.liveUnitsMean,
      logBytes: game.stats.logBytes,
      recordMs: round4(recordMs),
      finalFullHash: game.stats.finalFullHash >>> 0,
    },
    convert: { ms: round4(convertMs), verified: conv.verified, compared: conv.compared, warnings: conv.warnings },
    size,
    recordedHashes,
    recordedSubHashes,
    playback: {
      first,
      warm,
      warmPlayMs,
      warmTicksPerSecond: Math.round(warmTps),
      warmXRealtime: round4(warmTps / REPLAY_TICKS_PER_SECOND),
    },
    seek: {
      targets,
      ms,
      summary: summarize(Float64Array.from(ms)),
      worstCase: { target: worstTarget, keyframeTick: worstKf, ms: worstMs },
      restores,
      exact,
    },
    keyframes,
    errors,
  };
}

/** Gate violations (local measurement): seek p95, playback speed, hash errors. */
export function replayBenchGateFailures(r: ReplayBenchResult, cold?: readonly PlaybackRun[]): string[] {
  const out: string[] = [...r.errors];
  if (r.seek.summary.p95 > SEEK_GATE_P95_MS) out.push(`seek p95 ${r.seek.summary.p95} ms > ${SEEK_GATE_P95_MS} ms`);
  const xs = [r.playback.first.xRealtime, r.playback.warmXRealtime, ...(cold ?? []).map((c) => c.xRealtime)];
  const minX = Math.min(...xs);
  if (minX < PLAYBACK_GATE_X) out.push(`playback ${minX}x < ${PLAYBACK_GATE_X}x real time`);
  for (const c of cold ?? []) if (c.divergences > 0) out.push(`cold playback: ${c.divergences} hash divergences`);
  return out;
}

function de(n: number, digits = 0): string {
  return n.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function kb(n: number): string {
  return `${de(n)} B (${de(n / 1000, 1)} KB)`;
}

/** Markdown tables of a run (German); `synthetic` = size model of the same length, `cold` = fresh-process runs. */
export function formatReplayBench(r: ReplayBenchResult, extra: { synthetic?: ReplaySizeReport; cold?: readonly PlaybackRun[] } = {}): string {
  const s = r.size;
  const g = r.game;
  const lines: string[] = [];
  lines.push(`Langpartie: hollow-ridge, ${g.minutes} min (${de(g.ticks)} Ticks), 2 × ${g.apm.map((a) => de(a)).join('/')} APM, Seed 0x${g.seed.toString(16)}, ${de(g.envelopes)} Envelopes, Ø ${de(g.liveUnitsMean)} Einheiten; FAFL ${kb(g.logBytes)}; Aufnahme ${de(g.recordMs)} ms, Konvertierung ${de(r.convert.ms)} ms (${r.convert.verified ? 'verifiziert' : 'NICHT verifiziert'}, ${de(r.convert.compared)} Hashes).`);
  lines.push('');
  lines.push('| Größe | Langpartie (sim-valide) | Synthetisches Modell (FA-Mix, 2 × 120 APM) | Gate 30 min |');
  lines.push('|---|---:|---:|---:|');
  const syn = extra.synthetic;
  const col = (v: number | undefined): string => (v === undefined ? '–' : kb(v));
  lines.push(`| CMDS gespeichert | ${kb(s.cmdsStoredBytes)} | ${col(syn?.cmdsStoredBytes)} | ≤ 100.000 B |`);
  lines.push(`| CMDS roh (vor Deflate) | ${kb(s.cmdsRawBytes)} | ${col(syn?.cmdsRawBytes)} | – |`);
  lines.push(`| HASH | ${kb(s.byChunk['HASH'] ?? 0)} | ${col(syn?.byChunk['HASH'])} | – |`);
  lines.push(`| MARK | ${kb(s.byChunk['MARK'] ?? 0)} | ${col(syn?.byChunk['MARK'])} | – |`);
  lines.push(`| Datei gesamt | ${kb(s.total)} | ${col(syn?.total)} | ≤ 250.000 B |`);
  lines.push('');
  const p = r.playback;
  const coldRuns = extra.cold ?? [];
  const range = (vals: readonly number[], digits = 0): string => {
    if (vals.length === 0) return '–';
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    return lo === hi ? de(lo, digits) : `${de(lo, digits)} – ${de(hi, digits)}`;
  };
  lines.push(`| Wiedergabe headless (playToEnd, Hash- + Sub-Hash-Prüfung, Keyframes) | Open (ms) | Wiedergabe (ms) | Ticks/s | x Echtzeit | Ziel |`);
  lines.push('|---|---:|---:|---:|---:|---:|');
  if (coldRuns.length > 0) {
    lines.push(
      `| kalt (frischer Node-Prozess, ${coldRuns.length} Läufe) | ${range(coldRuns.map((c) => c.openMs), 1)} | ${range(coldRuns.map((c) => c.playMs))} | ${range(coldRuns.map((c) => c.ticksPerSecond))} | ${range(coldRuns.map((c) => c.xRealtime))}x | ≥ 20x |`,
    );
  }
  lines.push(`| erster Lauf im Prozess | ${de(p.first.openMs, 1)} | ${de(p.first.playMs)} | ${de(p.first.ticksPerSecond)} | ${de(p.first.xRealtime)}x | ≥ 20x |`);
  lines.push(`| warm (Median aus ${p.warm.length}) | ${range(p.warm.map((w) => w.openMs), 1)} | ${de(p.warmPlayMs)} | ${de(p.warmTicksPerSecond)} | ${de(p.warmXRealtime)}x | ≥ 20x |`);
  lines.push('');
  lines.push(`Geprüft je Lauf: ${de(p.first.compared)}/${de(r.recordedHashes)} Regel-Hashes, ${de(p.first.subCompared)}/${de(r.recordedSubHashes)} Sub-Hash-Zeilen, ${p.first.divergences} Abweichungen; End-Voll-Hash == Aufnahme.`);
  lines.push('');
  const sk = r.seek;
  lines.push(`| Rückwärts-Seek vom Ende (Tick ${de(g.ticks)}) | Median | p95 | max | Ziel |`);
  lines.push('|---|---:|---:|---:|---:|');
  lines.push(`| ${sk.targets.length} Ziele (Seed 0x${SEEK_TARGET_SEED.toString(16)}), ms | ${de(sk.summary.p50, 1)} | ${de(sk.summary.p95, 1)} | ${de(sk.summary.max, 1)} | p95 ≤ 2.000 |`);
  lines.push(`| Worst Case Tick ${de(sk.worstCase.target)} (Keyframe ${de(sk.worstCase.keyframeTick)} + ${de(sk.worstCase.target - sk.worstCase.keyframeTick)} Ticks), ms | ${de(sk.worstCase.ms, 1)} | | | ≤ 2.000 |`);
  lines.push('');
  lines.push(`Seeks exakt (Voll-Hash == Direktlauf): ${sk.exact ? 'ja' : 'NEIN'}; ${sk.restores} Keyframe-Restores. Keyframes nach der Partie: ${de(r.keyframes.count)} (Intervall ${de(r.keyframes.intervalTicks)} Ticks), ${kb(r.keyframes.bytes)} komprimiert, ${de(r.keyframes.rawBytes / 1e6, 1)} MB roh, ${r.keyframes.thinnings} Ausdünnungen.`);
  return lines.join('\n');
}
