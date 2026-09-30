/**
 * Golden replays and their cross-engine playback (TRACK-REPLAY p6, PLAN §3.11 / §5.2 MS11).
 *
 * Golden replays are the golden command logs (test/golden-replays/logs/<scenario>.faflog, p3)
 * converted to .rtsreplay (test/golden-replays/<scenario>.rtsreplay). This module holds the
 * environment-neutral parts shared by the `replay-goldens` script, the vitest suite and the L3
 * cross-engine harness (Node process and Chromium/Firefox/WebKit module workers):
 *
 * - `convertGoldenLog`: the one canonical conversion (map from the golden JSON, sub-hashes on,
 *   META extra `scenario`/`map`, default army names) — the checked-in bytes must equal it.
 * - `checkGoldenReplay`: conversion verified, HEAD.simBuild == SIM_BUILD, HASH trail and final
 *   rule/full hash of a playback == golden JSON.
 * - `runReplayVerifyJob`: plays a replay with keyframes and hash/sub-hash verification, records
 *   the rule-hash trail the engine computed and the full hash at the middle, then seeks backwards
 *   to the middle (the full hash there must equal the one of the direct run) and plays to the end
 *   again (the full hash after the seek must equal the one of the first pass).
 *
 * No node: imports (bundled into the harness worker); inflate runs through fflate (@faf/formats)
 * in every engine, so all engines execute the same code path.
 */

import { createTestPlaneMap, mapSimHash, readRtsMap, readRtsReplay, type RtsMap, type RtsReplay } from '@faf/formats';
import {
  addHashListener,
  convertCommandLog,
  readPlayableReplay,
  ReplayPlayer,
  SIM_BUILD,
  verifyReplay,
  type ConvertResult,
  type ReplayDivergence,
  type ReplayVerifyResult,
} from '@faf/sim-host';
import { hex32, type Golden } from '../goldens.ts';
import type { Clock } from '../stats.ts';

/** Scenarios with a checked-in golden replay (all L2 goldens; see test/golden-replays/README.md). */
export const GOLDEN_REPLAY_SCENARIOS: readonly string[] = ['cubes-1000-move', 'cubes-churn', 'ridge-1000-move', 'ridge-water-block', 'setons-bridge-move'];

/** Repo-relative path of a scenario's golden replay. */
export function goldenReplayPath(scenario: string): string {
  return `test/golden-replays/${scenario}.rtsreplay`;
}

/** Repo-relative path of a scenario's golden command log (p3). */
export function goldenLogPath(scenario: string): string {
  return `test/golden-replays/logs/${scenario}.faflog`;
}

/** Repo-relative paths of all golden replays (JobAssets.replays keys, harness asset list). */
export const GOLDEN_REPLAY_PATHS: readonly string[] = GOLDEN_REPLAY_SCENARIOS.map(goldenReplayPath);

/** Scenario name of a golden replay path (`test/golden-replays/x.rtsreplay` → `x`). */
export function scenarioOfReplayPath(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1).replace(/\.rtsreplay$/, '');
}

/** Command to regenerate the golden replays (printed with every freshness/build failure). */
export const REPLAY_GOLDENS_UPDATE_HINT = 'pnpm --filter @faf/headless replay-goldens -- --update';

/** Full regeneration chain after a SIM_BUILD bump. */
export const REPLAY_GOLDENS_REGEN_CHAIN =
  'pnpm --filter @faf/headless goldens -- --update → pnpm --filter @faf/headless golden-logs -- --update → ' + REPLAY_GOLDENS_UPDATE_HINT;

export interface GoldenReplayAssets {
  /** content/generated/sim.bin bytes. */
  readonly simBin: Uint8Array;
  /** .rtsmap bytes by repo-relative path (scripts/lib loadMaps). */
  readonly maps: Readonly<Record<string, Uint8Array>>;
}

const TEST_PLANE_LABEL = /^testplane:(\d+)$/;

/**
 * The map a golden was recorded on: `testplane:<size>` → the generated test plane, otherwise the
 * repo-relative .rtsmap path in `maps`.
 */
export function goldenMap(golden: Golden, maps: Readonly<Record<string, Uint8Array>>): RtsMap {
  const m = TEST_PLANE_LABEL.exec(golden.map);
  if (m !== null) return createTestPlaneMap(Number(m[1]));
  const bytes = maps[golden.map];
  if (bytes === undefined) throw new Error(`golden ${golden.scenario}: map '${golden.map}' not provided`);
  return readRtsMap(bytes);
}

/**
 * Canonical conversion of a golden command log: sub-hashes on, map of the golden JSON,
 * META extra {scenario, map}, default (deterministic) army names 'Army 1', 'Army 2' …
 */
export function convertGoldenLog(log: Uint8Array, golden: Golden, assets: GoldenReplayAssets): ConvertResult {
  return convertCommandLog(log, {
    map: goldenMap(golden, assets.maps),
    simBin: assets.simBin,
    subHashes: true,
    meta: { extra: { scenario: golden.scenario, map: golden.map } },
  });
}

export interface GoldenReplayCheck {
  readonly ok: boolean;
  readonly problems: readonly string[];
  /** Playback result (null if the file could not be read or played). */
  readonly verify: ReplayVerifyResult | null;
  readonly replay: RtsReplay | null;
}

/** Hex trail of the HASH chunk (rule hashes in grid order). */
export function recordedTrail(replay: RtsReplay): string[] {
  return Array.from(replay.hashes.hashes, (h) => hex32(h));
}

/** Index of the first differing entry of two hex trails (-1 if equal). */
export function firstTrailDifference(a: readonly string[], b: readonly string[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return -1;
}

/**
 * Checks a golden replay against its golden JSON: readable, HEAD.simBuild == SIM_BUILD, META
 * scenario, HASH trail (interval/first tick/values) == golden trail, playback (sim.bin + map of
 * the golden, sub-hash check on) with 0 divergences and final rule/full hash == golden.
 */
export function checkGoldenReplay(bytes: Uint8Array, golden: Golden, assets: GoldenReplayAssets): GoldenReplayCheck {
  const problems: string[] = [];
  let replay: RtsReplay;
  try {
    replay = readRtsReplay(bytes, { verifyBlocks: true });
  } catch (e) {
    return { ok: false, problems: [`unreadable: ${e instanceof Error ? e.message : String(e)}`], verify: null, replay: null };
  }
  if (golden.simBuild !== SIM_BUILD) problems.push(`golden JSON recorded with simBuild ${golden.simBuild}, code is ${SIM_BUILD} (${REPLAY_GOLDENS_REGEN_CHAIN})`);
  if (replay.head.simBuild !== SIM_BUILD) {
    problems.push(`HEAD.simBuild '${replay.head.simBuild}' ≠ SIM_BUILD '${SIM_BUILD}' (${REPLAY_GOLDENS_REGEN_CHAIN})`);
    return { ok: false, problems, verify: null, replay };
  }
  const scen = replay.meta?.extra['scenario'];
  if (scen !== golden.scenario) problems.push(`META extra.scenario '${scen ?? '(missing)'}' ≠ '${golden.scenario}'`);
  const h = replay.hashes;
  if (h.interval !== golden.hashIntervalTicks || h.firstTick !== golden.hashIntervalTicks) {
    problems.push(`HASH grid ${h.firstTick}+k·${h.interval} ≠ golden ${golden.hashIntervalTicks}+k·${golden.hashIntervalTicks}`);
  }
  const trail = recordedTrail(replay);
  const d = firstTrailDifference(trail, golden.trail);
  if (d >= 0) problems.push(`HASH trail differs from golden at entry ${d} (tick ${(d + 1) * golden.hashIntervalTicks}: ${trail[d] ?? '(missing)'} ≠ ${golden.trail[d] ?? '(missing)'})`);
  let verify: ReplayVerifyResult | null = null;
  try {
    verify = verifyReplay(replay, { simBin: assets.simBin, map: goldenMap(golden, assets.maps) });
  } catch (e) {
    problems.push(`playback failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (verify !== null) {
    if (verify.endTick !== golden.ticks) problems.push(`playback ended at tick ${verify.endTick}, golden has ${golden.ticks}`);
    if (verify.divergences.length > 0) {
      const f = verify.divergences[0]!;
      problems.push(`${verify.divergences.length} divergences, first at tick ${f.tick} (${f.kind}: ${hex32(f.actual)} ≠ ${f.expected < 0 ? '–' : hex32(f.expected)}; regions ${f.regions.join(', ') || '–'})`);
    }
    if (verify.compared !== golden.trail.length) problems.push(`${verify.compared} recorded hashes compared, golden has ${golden.trail.length}`);
    if (hex32(verify.ruleHash) !== golden.finalRuleHash) problems.push(`final rule hash ${hex32(verify.ruleHash)} ≠ golden ${golden.finalRuleHash}`);
    if (hex32(verify.fullHash) !== golden.finalFullHash) problems.push(`final full hash ${hex32(verify.fullHash)} ≠ golden ${golden.finalFullHash}`);
  }
  return { ok: problems.length === 0, problems, verify, replay };
}

// ---- cross-engine job ------------------------------------------------------------------------

export interface ReplayJobAssets {
  readonly simBin: Uint8Array;
  /** .rtsmap bytes by repo-relative path; the replay's map is found via META extra.map or mapSimHash. */
  readonly maps: Readonly<Record<string, Uint8Array>>;
}

export interface ReplayVerifyJobResult {
  /** META extra.scenario ('' if absent). */
  readonly scenario: string;
  readonly endTick: number;
  /** Rule hashes the engine computed during the first pass (hex), at trailFirstTick + k·trailInterval. */
  readonly trail: readonly string[];
  readonly trailFirstTick: number;
  readonly trailInterval: number;
  /** Rule / full hash at the end of the first pass. */
  readonly finalRuleHash: string;
  readonly finalFullHash: string;
  /** Backward seek target (middle of the replay). */
  readonly seekTick: number;
  /** Full hash at seekTick during the first (direct) pass. */
  readonly directMidFullHash: string;
  /** Full hash right after the seek (at seekTick; must equal directMidFullHash) and at the end after the second pass. */
  readonly seekMidFullHash: string;
  readonly seekFullHash: string;
  readonly seekRuleHash: string;
  /** Recorded rule hashes / sub-hash rows compared (each tick counted once). */
  readonly compared: number;
  readonly subCompared: number;
  /** Divergences from the HASH chunk (rule and sub-hashes), first pass and seek. */
  readonly divergences: readonly ReplayDivergence[];
  readonly keyframes: number;
  readonly keyframeBytes: number;
  readonly restores: number;
  /** Wall time of the whole job and of the seek + second pass. */
  readonly ms: number;
  readonly seekMs: number;
}

/** Map bytes for a replay: META extra.map (repo path) or the map whose mapSimHash matches HEAD; undefined = test plane. */
function replayMap(replay: RtsReplay, maps: Readonly<Record<string, Uint8Array>>): Uint8Array | undefined {
  const label = replay.meta?.extra['map'];
  if (label !== undefined) {
    if (TEST_PLANE_LABEL.test(label)) return undefined;
    const bytes = maps[label];
    if (bytes !== undefined) return bytes;
  }
  for (const key of Object.keys(maps).sort()) {
    const bytes = maps[key]!;
    if (mapSimHash(readRtsMap(bytes)) >>> 0 === replay.head.mapSimHash >>> 0) return bytes;
  }
  return undefined;
}

const defaultClock: Clock = () => performance.now();

/**
 * Plays `replayBytes` to its end with compressed keyframes (every 600 ticks) and hash + sub-hash
 * verification, recording the engine's rule-hash trail; then seeks back to the middle (keyframe
 * restore + re-simulation) and plays to the end again. Throws FormatError / ReplayCompatError
 * like ReplayPlayer.open.
 */
export function runReplayVerifyJob(replayBytes: Uint8Array, assets: ReplayJobAssets, clock: Clock = defaultClock): ReplayVerifyJobResult {
  const t0 = clock();
  const replay = readPlayableReplay(replayBytes);
  const map = replayMap(replay, assets.maps);
  const player = ReplayPlayer.open(replay, { simBin: assets.simBin, ...(map !== undefined ? { map } : {}), keyframes: {} });

  const trail: string[] = [];
  let trailFirstTick = 0;
  let trailInterval = 0;
  let lastTrailTick = 0;
  addHashListener(player.core, (tick, hash): void => {
    if (tick > lastTrailTick) {
      if (trail.length === 1) trailInterval = tick - trailFirstTick;
      else if (trail.length > 1 && tick !== lastTrailTick + trailInterval) {
        throw new Error(`rule hash at tick ${tick} breaks the ${trailInterval}-tick grid`);
      }
      if (trail.length === 0) trailFirstTick = tick;
      trail.push(hex32(hash));
      lastTrailTick = tick;
    }
  });

  const seekTick = Math.floor(player.endTick / 2);
  player.runUntil(seekTick);
  const directMidFullHash = player.fullHash();
  const first = player.playToEnd();
  const t1 = clock();
  player.seek(seekTick);
  const seekMidFullHash = player.fullHash();
  const second = player.playToEnd();
  const t2 = clock();
  return {
    scenario: replay.meta?.extra['scenario'] ?? '',
    endTick: first.endTick,
    trail,
    trailFirstTick,
    trailInterval: trail.length === 1 ? 0 : trailInterval,
    finalRuleHash: hex32(first.ruleHash),
    finalFullHash: hex32(first.fullHash),
    seekTick,
    directMidFullHash: hex32(directMidFullHash),
    seekMidFullHash: hex32(seekMidFullHash),
    seekFullHash: hex32(second.fullHash),
    seekRuleHash: hex32(second.ruleHash),
    compared: second.compared,
    subCompared: second.subCompared,
    divergences: second.divergences,
    keyframes: player.keyframes.count,
    keyframeBytes: player.keyframes.byteLength,
    restores: player.restores,
    ms: Math.round((t2 - t0) * 100) / 100,
    seekMs: Math.round((t2 - t1) * 100) / 100,
  };
}

/** One comparison of a job result against the HASH chunk and the golden JSON. */
export interface ReplayJobCheck {
  readonly equal: boolean;
  /** First tick whose hash differs (trail tick or endTick); null if equal. */
  readonly firstDivergentTick: number | null;
  readonly problems: readonly string[];
}

/**
 * Compares a job result with the replay's HASH chunk (`recorded`, hex) and the golden JSON:
 * trail == HASH == golden trail, final rule/full hash == golden, 0 divergences, every recorded
 * hash compared, seekMidFullHash == directMidFullHash (state right after the backward seek ==
 * direct run) and seekFullHash == finalFullHash.
 */
export function checkReplayJobResult(r: ReplayVerifyJobResult, recorded: { readonly firstTick: number; readonly interval: number; readonly trail: readonly string[] }, golden: Golden): ReplayJobCheck {
  const problems: string[] = [];
  let first: number | null = null;
  const note = (tick: number | null, msg: string): void => {
    problems.push(msg);
    if (tick !== null && (first === null || tick < first)) first = tick;
  };
  if (r.scenario !== golden.scenario) note(null, `scenario '${r.scenario}' ≠ golden '${golden.scenario}'`);
  if (r.trailFirstTick !== recorded.firstTick || r.trailInterval !== recorded.interval) {
    note(0, `trail grid ${r.trailFirstTick}+k·${r.trailInterval} ≠ HASH ${recorded.firstTick}+k·${recorded.interval}`);
  }
  const dh = firstTrailDifference(r.trail, recorded.trail);
  if (dh >= 0) note(recorded.firstTick + dh * recorded.interval, `trail ≠ HASH chunk at tick ${recorded.firstTick + dh * recorded.interval}: ${r.trail[dh] ?? '(missing)'} ≠ ${recorded.trail[dh] ?? '(missing)'}`);
  const dg = firstTrailDifference(r.trail, golden.trail);
  if (dg >= 0) note((dg + 1) * golden.hashIntervalTicks, `trail ≠ golden at tick ${(dg + 1) * golden.hashIntervalTicks}: ${r.trail[dg] ?? '(missing)'} ≠ ${golden.trail[dg] ?? '(missing)'}`);
  if (r.endTick !== golden.ticks) note(r.endTick, `end tick ${r.endTick} ≠ golden ${golden.ticks}`);
  if (r.finalRuleHash !== golden.finalRuleHash) note(golden.ticks, `final rule hash ${r.finalRuleHash} ≠ golden ${golden.finalRuleHash}`);
  if (r.finalFullHash !== golden.finalFullHash) note(golden.ticks, `final full hash ${r.finalFullHash} ≠ golden ${golden.finalFullHash}`);
  if (r.seekMidFullHash !== r.directMidFullHash) {
    note(r.seekTick, `full hash right after the seek to ${r.seekTick} ${r.seekMidFullHash} ≠ direct run ${r.directMidFullHash}`);
  }
  if (r.seekFullHash !== r.finalFullHash) note(golden.ticks, `full hash after the seek to ${r.seekTick} ${r.seekFullHash} ≠ first pass ${r.finalFullHash}`);
  if (r.seekRuleHash !== r.finalRuleHash) note(golden.ticks, `rule hash after the seek to ${r.seekTick} ${r.seekRuleHash} ≠ first pass ${r.finalRuleHash}`);
  if (r.divergences.length > 0) {
    const d = r.divergences[0]!;
    note(d.tick, `${r.divergences.length} divergences, first at tick ${d.tick} (${d.kind}, regions ${d.regions.join(', ') || '–'})`);
  }
  if (r.compared !== recorded.trail.length) note(null, `${r.compared} recorded hashes compared, HASH chunk has ${recorded.trail.length}`);
  if (r.restores < 1) note(null, 'backward seek did not restore a keyframe');
  return { equal: problems.length === 0, firstDivergentTick: first, problems };
}
