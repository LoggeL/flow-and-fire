/** Convert durable command logs, including a valid prefix of a crash log. */
import { XxHash32 } from '@faf/fixed';
import { writeRtsReplay, ReplayFlags, type RtsMap, type ReplayGame, type ReplayMeta, type RtsReplayInput } from '@faf/formats';
import { COMMAND_BATCH_VERSION, encodeSkirmishInitialization } from '@faf/protocol';
import type { SimBpTable } from '@faf/blueprints/simbin';
import { setAlliance } from '@faf/sim';
import { HeadlessSim } from '../headless.ts';
import { parseCommandLog, type ParsedCommandLog } from '../log-format.ts';
import { ReplaySource } from '../sources.ts';
import { SIM_BUILD } from '../identity.ts';
import { resolveMap, type HashMismatch } from '../core.ts';
import { computeSubHashes, ruleRegionNames } from './sub-hashes.ts';

export interface ConvertOptions {
  readonly map?: RtsMap | Uint8Array; readonly simBin?: Uint8Array; readonly bpTable?: SimBpTable;
  readonly subHashes?: boolean; readonly game?: Partial<ReplayGame>; readonly meta?: Partial<ReplayMeta>; readonly level?: number;
}
export interface ConvertResult { readonly bytes: Uint8Array; readonly input: RtsReplayInput; readonly verified: boolean; readonly mismatches: HashMismatch[]; readonly warnings: string[]; readonly truncatedSource: boolean; }
export function convertCommandLog(input: Uint8Array | ArrayBuffer | ParsedCommandLog, options: ConvertOptions): ConvertResult {
  const log = input instanceof Uint8Array || input instanceof ArrayBuffer ? parseCommandLog(input) : input;
  const h = log.header, warnings: string[] = [], mismatches: HashMismatch[] = [];
  const map = resolveMap(options.map, options.map === undefined ? h.mapSizeWu : undefined);
  const alliances = new Uint8Array(32);
  for (let a = 0; a < 16; a++) for (let b = 0; b < 16; b++) {
    const slots = h.initialization?.slots;
    if (a === b || (slots?.[a] !== undefined && slots[b] !== undefined && slots[a]!.team === slots[b]!.team)) { const bit = a * 16 + b; alliances[bit >>> 3]! |= 1 << (bit & 7); }
  }
  const game: ReplayGame = { seed: h.seed, mapName: map.meta.name, mapSizeWu: h.mapSizeWu, playerArmy: h.playerArmy,
    armies: Array.from({ length: h.armyCount }, (_, index) => { const slot = h.initialization?.slots?.[index]; return { index, kind: slot?.controller === 'ai' ? 1 : 0, team: slot?.team ?? index, aixPermille: Math.round((slot?.aixFactorQ16 ?? 65536) * 1000 / 65536), name: `Army ${index + 1}`, aiProfile: slot?.difficulty ?? '', faction: '' }; }),
    alliances, ...(h.initialization === undefined ? {} : { initialization: h.initialization }), ...options.game };
  // Header identity is authoritative. Metadata overrides may describe players/alliances, not replace the recorded session.
  if (game.seed !== h.seed || game.mapSizeWu !== h.mapSizeWu || game.playerArmy !== h.playerArmy || game.armies.length !== h.armyCount)
    throw new RangeError('GAME override changes the recorded session');
  const recordedSetup = h.initialization === undefined ? new Uint8Array(0) : encodeSkirmishInitialization(h.initialization);
  const replaySetup = game.initialization === undefined ? new Uint8Array(0) : encodeSkirmishInitialization(game.initialization);
  if (recordedSetup.length !== replaySetup.length || recordedSetup.some((value, index) => value !== replaySetup[index]))
    throw new RangeError('GAME override changes the recorded initialization');
  if (h.initialization?.slots !== undefined && game.alliances.some((value, index) => value !== alliances[index]))
    throw new RangeError('GAME override changes the recorded alliances');
  const source = new ReplaySource(log);
  const sim = new HeadlessSim({ seed: h.seed, armyCount: h.armyCount, playerArmy: h.playerArmy, map,
    ...(options.simBin === undefined ? {} : { simBin: options.simBin }), ...(options.bpTable === undefined ? {} : { bpTable: options.bpTable }),
    sources: [source], record: false, keyframes: false, buildHash: h.buildHash,
    ...(h.initialization === undefined ? {} : { initialization: h.initialization }) });
  const compatible = log.version !== 1 && sim.simId === h.simId && sim.world.layoutHash === h.layoutHash;
  if (!compatible) warnings.push('The source simulation identity/layout differs; use its original build. Sub-hashes are unavailable.');
  const subEnabled = compatible && options.subHashes !== false;
  const names = subEnabled ? ruleRegionNames(sim.world) : [], subValues: number[] = [];
  const sub = new Uint32Array(names.length), hasher = new XxHash32();
  if (compatible) {
    for (let a = 0; a < 16; a++) for (let b = a + 1; b < 16; b++) { const bit = a * 16 + b; setAlliance(sim.world, a, b, (game.alliances[bit >>> 3]! & (1 << (bit & 7))) !== 0); }
    sim.core.onHash = (tick, actual): void => { const expected = source.expectedHash(tick); if (expected >= 0 && expected !== actual) mismatches.push({ tick, expected, actual }); };
    for (let tick = 1; tick <= log.lastTick; tick++) {
      sim.step();
      if (subEnabled && tick % 100 === 0) { computeSubHashes(sim.world, sub, hasher); subValues.push(...sub); }
    }
  }
  for (let i = 1; i < log.hashes.length; i++) if (log.hashes[i]!.tick !== log.hashes[0]!.tick + i * h.hashInterval)
    throw new RangeError('Command log has a discontinuous hash timeline');
  const truncatedSource = log.truncated || log.endTick < 0;
  const flags = (log.tainted ? ReplayFlags.Tainted : 0) | (log.endTick >= 0 ? ReplayFlags.Complete : 0) | (truncatedSource ? ReplayFlags.Truncated : 0);
  const meta: ReplayMeta = { durationTicks: log.lastTick, endTick: log.lastTick, players: game.armies.map((a) => ({ army: a.index, name: a.name })),
    result: { winner: -1, reason: 'unknown' }, stats: {}, extra: {}, ...options.meta };
  if (meta.endTick !== log.lastTick) throw new RangeError('META endTick must equal the source timeline');
  const result: RtsReplayInput = {
    head: { formatVersion: 1, simBuild: compatible ? SIM_BUILD : `legacy-log-v${log.version}`, buildHash: h.buildHash,
      simId: h.simId, bpSimHash: h.bpSimHash, mapSimHash: h.mapSimHash, layoutHash: h.layoutHash,
      protocolVersion: COMMAND_BATCH_VERSION, hashInterval: h.hashInterval, subHashInterval: subEnabled ? 100 : 0, flags, sourceLogVersion: log.version },
    game, commands: log.commands.map((c) => ({ tick: c.tick, batch: log.bytes.slice(c.offset, c.offset + c.length) })),
    hashes: { interval: h.hashInterval, firstTick: log.hashes[0]?.tick ?? 0, hashes: Uint32Array.from(log.hashes, (x) => x.hash),
      subInterval: subEnabled ? 100 : 0, subFirstTick: subValues.length > 0 ? 100 : 0, regionNames: names, subHashes: Uint32Array.from(subValues) },
    marks: log.marks, meta,
  };
  return { bytes: writeRtsReplay(result, options.level === undefined ? {} : { level: options.level }), input: result,
    verified: compatible && mismatches.length === 0, mismatches, warnings, truncatedSource };
}
