import { COMMAND_BATCH_VERSION } from '@faf/protocol';
import { ReplayFlags, type RtsReplayInput } from '@faf/formats';
import { generateSynthetic1v1, type SyntheticOptions } from './synthetic.ts';
/** Incompressible hash columns and the unchanged seeded 120 APM per army model. */
export function syntheticReplayInput(options: SyntheticOptions = {}): RtsReplayInput {
  const g = generateSynthetic1v1(options), alliances = new Uint8Array(32);
  for (let i = 0; i < 16; i++) { const bit = 17 * i; alliances[bit >>> 3]! |= 1 << (bit & 7); }
  return { head: { formatVersion: 1, simBuild: 'synthetic-size-model', buildHash: 'size-model', simId: 1, bpSimHash: 2,
    mapSimHash: 3, layoutHash: 4, protocolVersion: COMMAND_BATCH_VERSION, hashInterval: g.hashes.interval,
    subHashInterval: g.subHashes.interval, flags: ReplayFlags.Complete, sourceLogVersion: 0 },
    game: { seed: g.seed, mapName: 'synthetic-1v1', mapSizeWu: g.mapSizeWu, playerArmy: 0, alliances,
      armies: [0, 1].map((index) => ({ index, kind: 0, team: index, aixPermille: 1000, name: `Player ${index + 1}`, aiProfile: '', faction: 'core' })) },
    commands: g.commands, hashes: { interval: g.hashes.interval, firstTick: g.hashes.firstTick, hashes: g.hashes.values,
      subInterval: g.subHashes.interval, subFirstTick: g.subHashes.firstTick, regionNames: g.subHashes.regionNames, subHashes: g.subHashes.values },
    marks: g.marks, meta: { durationTicks: g.stats.ticks, endTick: g.stats.ticks, players: [0, 1].map((army) => ({ army, name: `Player ${army + 1}` })),
      result: { winner: -1, reason: 'synthetic model' }, stats: { commands: g.stats.envelopes }, extra: {} } };
}
