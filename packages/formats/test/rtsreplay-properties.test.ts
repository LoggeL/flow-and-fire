import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { COMMAND_BATCH_VERSION, CommandBatchEncoder, decodeBatch, Op, validateBatch, type Op as CommandOp } from '@faf/protocol';
import { decodeCmdsBlock, readAllCommands, readRtsReplay, ReplayFlags, rewriteRtsReplay, writeRtsReplay, type ReplayTickCommands, type RtsReplayInput } from '../src/index.ts';

interface EnvelopeSpec {
  readonly army: number; readonly seq: number; readonly op: CommandOp; readonly flags: number;
  readonly units: readonly number[]; readonly payload: Uint8Array;
}
const uint = fc.integer({ min: 0, max: 0xffffffff });
const positionPayload = fc.tuple(...Array.from({ length: 3 }, () => fc.integer({ min: -0x80000000, max: 0x7fffffff })))
  .map((xyz) => {
    const bytes = new Uint8Array(12), view = new DataView(bytes.buffer);
    xyz.forEach((value, i) => view.setInt32(i * 4, value, true));
    return bytes;
  });
const envelope = fc.record({
  army: fc.integer({ min: 0, max: 15 }), seq: fc.integer({ min: 0, max: 0xffff }),
  op: fc.constantFrom(Op.Move, Op.Build, Op.Attack, Op.Stop, Op.Cheat, 255 as CommandOp),
  flags: fc.integer({ min: 0, max: 255 }),
  units: fc.array(fc.oneof(uint, fc.constantFrom(0, 0xffffffff, 0xfff00005, 0x00100005)), { maxLength: 12 }),
  payload: fc.oneof(fc.uint8Array({ maxLength: 32 }), positionPayload, uint.map((value) => {
    const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, value, true); return bytes;
  })),
});
function batch(tick: number, specs: readonly EnvelopeSpec[]): ReplayTickCommands {
  const encoder = new CommandBatchEncoder();
  for (const spec of specs) encoder.addRaw(tick, spec.army, spec.seq, spec.op, spec.flags, spec.units, spec.payload, 0, spec.payload.length);
  const bytes = encoder.view().slice(); expect(validateBatch(bytes)).toBe(specs.length);
  return { tick, batch: bytes };
}
function fixture(commands: readonly ReplayTickCommands[], seed: number, hashes: readonly number[] = [0, 0xffffffff], interval = 10): RtsReplayInput {
  const alliances = new Uint8Array(32);
  for (let i = 0; i < 16; i++) { const bit = i * 17; alliances[bit >>> 3]! |= 1 << (bit & 7); }
  if ((seed & 1) !== 0) { alliances[0]! |= 2; alliances[2]! |= 1; }
  return {
    head: { formatVersion: 1, simBuild: 'property-test', buildHash: `build-${seed}`, simId: seed,
      bpSimHash: (seed ^ 0x1234) >>> 0, mapSimHash: seed, layoutHash: 4, protocolVersion: COMMAND_BATCH_VERSION,
      hashInterval: interval, subHashInterval: 100, flags: ReplayFlags.Complete, sourceLogVersion: 2 },
    game: { seed, mapName: 'property map α', mapSizeWu: 512, playerArmy: seed % 16, alliances,
      armies: Array.from({ length: 16 }, (_, index) => ({ index, kind: index % 3, team: index % 4,
        aixPermille: 1000 + index, name: `army-${index}`, aiProfile: index % 2 ? 'balanced' : '', faction: 'core' })) },
    commands,
    hashes: { interval, firstTick: 0, hashes: Uint32Array.from(hashes), subInterval: 100, subFirstTick: 0,
      regionNames: ['world', 'units'], subHashes: Uint32Array.from(hashes.flatMap((hash) => [hash, (hash ^ seed) >>> 0])) },
    marks: [{ tick: seed % 598, kind: 1, value: seed }, { tick: 599, kind: 2, value: 0 }, { tick: 1300, kind: 8, value: seed }],
    meta: { durationTicks: 1300, endTick: 1300, players: [{ army: seed % 16, name: `player α ${seed}` }],
      result: { winner: seed % 16, reason: `reason-${seed & 3}` }, stats: { z: seed, a: commands.length }, extra: { z: 'last', a: `seed-${seed}` } },
  };
}
function checkRoundtrip(input: RtsReplayInput): void {
  const bytes = writeRtsReplay(input), replay = readRtsReplay(bytes);
  expect(writeRtsReplay(input)).toEqual(bytes);
  expect(rewriteRtsReplay(replay)).toEqual(bytes);
  expect(replay.head).toEqual(input.head); expect(replay.game).toEqual(input.game);
  expect(replay.hashes).toEqual(input.hashes); expect(replay.meta).toEqual(input.meta); expect(replay.marks).toEqual(input.marks);
  expect(readAllCommands(replay)).toEqual(input.commands);
  // Every block must also decode independently, with all predictors reset at its boundary.
  for (const block of replay.blocks) expect(decodeCmdsBlock(block)).toEqual(input.commands.filter((command) => Math.floor(command.tick / 600) === block.index));
}
describe('varied valid CMDS predictors', () => {
  it('roundtrips one thousand seeded multi-envelope streams with varied payloads and handles', () => {
    fc.assert(fc.property(uint, fc.constantFrom(7, 10), fc.array(uint, { minLength: 1, maxLength: 4 }),
      fc.array(fc.array(envelope, { minLength: 2, maxLength: 5 }), { minLength: 6, maxLength: 6 }),
      (seed, interval, hashes, specs) => {
        const ticks = [1 + seed % 597, 598, 599, 600, 601 + seed % 599, 1200];
        const commands = specs.map((entries, i) => batch(ticks[i]!, entries.map((entry, j) =>
          j < 2 ? { ...entry, army: seed % 15 + j } : entry)));
        checkRoundtrip(fixture(commands, seed, hashes, interval));
      }), { seed: 91029, numRuns: 1000 });
  }, 30000);
  it('preserves list reuse, subsets, dictionary eviction, generation extremes and sequence wrap across tick 600', () => {
    const commands: ReplayTickCommands[] = [];
    const base = [0xffffffff, 0, 0xfff00005, 0x00100005, 7, 7];
    const other = [12, 13, 14, 15];
    const specs = (units: readonly number[], seq: number): EnvelopeSpec[] => [0, 1, 15].map((army) => ({
      army, seq, op: Op.Move, flags: army & 1, units, payload: Uint8Array.of(0, 0, 0, 128, 255, 255, 255, 127, 0, 0, 0, 0),
    }));
    commands.push(batch(1, specs(base, 0)), batch(2, specs(base, 1)), batch(3, specs(other, 2)),
      batch(4, specs(base, 3)), batch(5, specs(base.slice(0, -1), 4)), batch(6, specs([5, 0xfff00005, 0x00100005], 5)));
    // More than 32 distinct nonempty lists per army evict the earlier dictionary entries.
    for (let i = 0; i < 36; i++) commands.push(batch(7 + i, specs([100 + i, 200 + i], i + 6)));
    commands.push(batch(50, specs(base, 42)), batch(51, specs(base, 43)), batch(52, specs([130, 230], 44)));
    commands.push(batch(598, [65534, 65535, 0, 1].flatMap((seq) => specs(base, seq))),
      batch(599, [65534, 65535].flatMap((seq) => specs(other, seq))),
      batch(600, [0, 1].flatMap((seq) => specs(other, seq))), batch(1200, specs(base, 2)));
    const input = fixture(commands, 12345);
    checkRoundtrip(input);
    for (const tick of [599, 600]) {
      const decoded = decodeBatch(readAllCommands(readRtsReplay(writeRtsReplay(input))).find((entry) => entry.tick === tick)!.batch);
      for (const army of [0, 1, 15]) expect(decoded.filter((entry) => entry.army === army).map((entry) => entry.seq)).toEqual(tick === 599 ? [65534, 65535] : [0, 1]);
    }
  });
});
