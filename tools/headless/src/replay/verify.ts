/** Environment-neutral replay verification used by CLI and browser workers. */
import { createTestPlaneMap, mapSimHash, readRtsMap, readRtsReplay, type RtsMap } from '@faf/formats';
import { convertCommandLog, parseCommandLog, ReplayCompatError, ReplayPlayer, type ReplayVerifyResult } from '@faf/sim-host';
import { SCENARIO_NAMES, scenarioByName } from '../scenarios.ts';
import { resolveScenarioMap } from '../scenario.ts';
export interface ReplayAssets { readonly simBin: Uint8Array; readonly maps: Readonly<Record<string, Uint8Array>>; }
export interface FileVerifyOptions { readonly untilTick?: number; readonly clock?: () => number; }
export interface FileVerifyResult extends ReplayVerifyResult { readonly ms: number; readonly ticksPerSecond: number; readonly xRealtime: number; }
export function isCommandLog(bytes: Uint8Array): boolean { return bytes[0] === 70 && bytes[1] === 65 && bytes[2] === 70 && bytes[3] === 76; }
export function replayMap(hash: number, size: number, buildHash: string, assets: ReplayAssets): RtsMap {
  for (const bytes of Object.values(assets.maps)) { const map = readRtsMap(bytes); if (mapSimHash(map) === hash) return map; }
  const plane = createTestPlaneMap(size); if (mapSimHash(plane) === hash) return plane;
  for (const name of SCENARIO_NAMES) {
    const spec = scenarioByName(name).map;
    if (spec.kind === 'file') continue;
    const map = resolveScenarioMap(spec, assets.maps); if (mapSimHash(map) === hash) return map;
  }
  throw new ReplayCompatError(`Map 0x${hash.toString(16)} is not available`, buildHash);
}
export function openReplayFile(bytes: Uint8Array, assets: ReplayAssets): ReplayPlayer {
  if (isCommandLog(bytes)) {
    const log = parseCommandLog(bytes), h = log.header;
    const map = replayMap(h.mapSimHash, h.mapSizeWu, h.buildHash, assets);
    const converted = convertCommandLog(log, { simBin: assets.simBin, map });
    return ReplayPlayer.open(converted.bytes, { simBin: assets.simBin, map });
  }
  const r = readRtsReplay(bytes), map = replayMap(r.head.mapSimHash, r.game.mapSizeWu, r.head.buildHash, assets);
  return ReplayPlayer.open(r, { simBin: assets.simBin, map });
}
export function verifyReplayFile(bytes: Uint8Array, assets: ReplayAssets, options: FileVerifyOptions = {}): FileVerifyResult {
  const clock = options.clock ?? (() => 0), start = clock(), player = openReplayFile(bytes, assets);
  player.runUntil(options.untilTick ?? player.endTick);
  const ms = clock() - start, result = player.result(), ticksPerSecond = ms > 0 ? result.endTick * 1000 / ms : 0;
  return { ...result, ms, ticksPerSecond, xRealtime: ticksPerSecond / 10 };
}
