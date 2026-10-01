/** Replay preparation and measurements. Process isolation belongs to the Node CLI. */
import { rng32 } from '@faf/fixed';
import { readRtsMap, replaySizeReport, writeRtsReplay } from '@faf/formats';
import { convertCommandLog, ReplayPlayer, type ReplayVerifyResult } from '@faf/sim-host';
import { recordLongGame } from './long-game.ts';
import { syntheticReplayInput } from './size-model.ts';
import type { ReplayAssets } from './verify.ts';
export interface ReplayBenchmarkBaseline {
  readonly minutes: number; readonly ticks: number; readonly ruleHash: number; readonly fullHash: number;
  readonly hashCount: number; readonly subHashCount: number;
}
export function prepareReplayBenchmark(assets: ReplayAssets, minutes = 30) {
  const game = recordLongGame({ minutes, simBin: assets.simBin, maps: assets.maps });
  const mapBytes = benchmarkMap(assets), map = readRtsMap(mapBytes);
  const converted = convertCommandLog(game.log, { simBin: assets.simBin, map });
  if (!converted.verified) throw new Error('Long game conversion diverged');
  return { bytes: converted.bytes, baseline: { minutes, ticks: game.stats.ticks,
    ruleHash: game.stats.finalRuleHash, fullHash: game.stats.finalFullHash,
    hashCount: converted.input.hashes.hashes.length,
    subHashCount: converted.input.hashes.subHashes.length / converted.input.hashes.regionNames.length } satisfies ReplayBenchmarkBaseline,
    bytesReport: replaySizeReport(converted.bytes), synthetic: replaySizeReport(writeRtsReplay(syntheticReplayInput())), stats: game.stats };
}
function benchmarkMap(assets: ReplayAssets): Uint8Array {
  const bytes = assets.maps['content/maps/hollow-ridge.rtsmap'] ?? assets.maps['hollow-ridge.rtsmap'];
  if (bytes === undefined) throw new Error('hollow-ridge map missing');
  return bytes;
}
function checkResult(result: ReplayVerifyResult, baseline: ReplayBenchmarkBaseline): void {
  if (result.divergences.length) throw new Error('Long game playback diverged');
  if (result.compared !== baseline.hashCount || result.subCompared !== baseline.subHashCount)
    throw new Error('Playback did not verify every recorded hash/sub-hash row');
  if (result.endTick !== baseline.ticks || result.ruleHash !== baseline.ruleHash || result.fullHash !== baseline.fullHash)
    throw new Error('Playback final tick/hashes differ from the original recording');
}
/** Call cold only in a fresh process that has not recorded, converted or played a replay. */
export function benchmarkPreparedReplay(bytes: Uint8Array, baseline: ReplayBenchmarkBaseline, assets: ReplayAssets,
  options: { readonly mode: 'cold' | 'warm'; readonly clock: () => number }) {
  const map = readRtsMap(benchmarkMap(assets)), clock = options.clock;
  if (options.mode === 'warm') {
    const warmup = ReplayPlayer.open(bytes, { simBin: assets.simBin, map });
    checkResult(warmup.playToEnd(), baseline);
  }
  const start = clock(), player = ReplayPlayer.open(bytes, { simBin: assets.simBin, map });
  const result = player.playToEnd(), ms = clock() - start;
  checkResult(result, baseline);
  if (!(ms > 0) || !Number.isFinite(ms)) throw new Error('Benchmark clock must advance');
  const ticksPerSecond = player.endTick * 1000 / ms;
  const playback = { mode: options.mode, ms, ticksPerSecond, xRealtime: ticksPerSecond / 10,
    ruleHash: result.ruleHash, fullHash: result.fullHash, compared: result.compared, subCompared: result.subCompared };
  const keyframes = { count: player.keyframes?.count ?? 0, bytes: player.keyframes?.byteLength ?? 0,
    rawBytes: player.keyframes?.rawByteLength ?? 0 };
  if (options.mode === 'cold') return { playback, keyframes, seek: null };
  const targets = Array.from({ length: 20 }, (_, i) => rng32(9029, i, 0, 17) % player.endTick);
  for (let i = 1; i < (player.keyframes?.count ?? 0); i++) targets.push(player.keyframes!.tickAt(i) - 1);
  const reference = ReplayPlayer.open(bytes, { simBin: assets.simBin, map, keyframes: false });
  const expected = new Map<number, { ruleHash: number; fullHash: number }>();
  for (const tick of [...new Set(targets)].sort((a, b) => a - b)) {
    reference.runUntil(tick); expected.set(tick, { ruleHash: reference.ruleHash(), fullHash: reference.fullHash() });
  }
  const seek = targets.map((tick) => {
    player.seek(player.endTick); const seekStart = clock(); player.seek(tick); const seekMs = clock() - seekStart;
    const ruleHash = player.ruleHash(), fullHash = player.fullHash(), direct = expected.get(tick)!;
    if (ruleHash !== direct.ruleHash || fullHash !== direct.fullHash) throw new Error(`Seek diverged at ${tick}`);
    return { tick, ms: seekMs, ruleHash, fullHash, expectedRuleHash: direct.ruleHash, expectedFullHash: direct.fullHash };
  });
  const sorted = seek.map((s) => s.ms).sort((a, b) => a - b);
  return { playback, keyframes, seek: { median: sorted[Math.floor(sorted.length / 2)]!,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1]!, max: sorted.at(-1)!, samples: seek } };
}
