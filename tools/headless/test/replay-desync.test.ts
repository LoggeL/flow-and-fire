import { describe, expect, it } from 'vitest';
import { writeRtsReplay } from '@faf/formats';
import { convertCommandLog, HeadlessSim } from '@faf/sim-host';
import { decodeBatch, encodeBatch } from '@faf/protocol';
import { unitHandles } from '@faf/sim';
import { desyncDiff } from '../src/replay/desync.ts';
import { loadSimBin } from '../scripts/lib.ts';
import { moveCmd, spawnCmd } from '../../../packages/sim-host/test/support/fixtures.ts';
import { captureStateDump, readStateDump, writeStateDump } from '../src/replay/dump.ts';
import { diffStateDumps } from '../src/replay/state-diff.ts';
const simBin = loadSimBin(), assets = { simBin, maps: {} };
function recording() { const sim = new HeadlessSim({ seed: 721, armyCount: 2, simBin, keyframes: false }); sim.submit([spawnCmd(0, 10, 100, 100, 4, 0)]); sim.runUntil(120); return { sim, converted: convertCommandLog(sim.exportLog(), { simBin }) }; }
describe('desync diagnosis', () => {
  it('finds an altered Move at tick 1100 and names the changed state', () => {
    const sim = new HeadlessSim({ seed: 721, armyCount: 2, simBin, keyframes: false });
    sim.submit([spawnCmd(0, 10, 100, 100, 4, 0)]);
    sim.runUntil(1099);
    sim.submit([moveCmd(0, unitHandles(sim.world, 0), 200, 100, 1)]);
    sim.runUntil(1120);
    const converted = convertCommandLog(sim.exportLog(), { simBin });
    const commands = converted.input.commands.map((entry) => {
      if (entry.tick !== 1100) return entry;
      const batch = decodeBatch(entry.batch);
      const move = batch[0]!;
      const payload = move.payload.slice();
      new DataView(payload.buffer).setInt32(0, 300 * 4096, true);
      return { tick: entry.tick, batch: encodeBatch([{ ...move, payload }, ...batch.slice(1)]) };
    });
    const changed = writeRtsReplay({ ...converted.input, commands });
    const result = desyncDiff(converted.bytes, changed, assets);
    expect(result.status).toBe('explained');
    expect(result.firstCommandTick).toBe(1100);
    expect(result.tick).toBe(1100);
    expect(result.diff!.entries.some((entry) => ['units', 'movers', 'formations', 'orders'].includes(entry.region))).toBe(true);
  });
  it('finds the precise tick, column and entity of a simulated divergence', () => {
    const { converted } = recording();
    const d = desyncDiff(converted.bytes, converted.bytes, assets, { perturbB: { tick: 77, region: 'units', column: 'hp', index: 5, value: 12 } });
    expect(d.status).toBe('explained'); expect(d.tick).toBe(77);
    expect(d.diff!.entries[0]).toMatchObject({ region: 'units', part: 'hp', index: 5, b: 12 });
    expect(d.diff!.entries[0]!.entity).toContain('slot 5');
  });
  it('distinguishes an engine recording mismatch from reproducible command divergence', () => {
    const { converted } = recording();
    expect(desyncDiff(converted.bytes, converted.bytes, assets).status).toBe('equal');
    const hashes = converted.input.hashes.hashes.slice(); hashes[5]! ^= 1;
    const changed = writeRtsReplay({ ...converted.input, hashes: { ...converted.input.hashes, hashes } });
    const d = desyncDiff(converted.bytes, changed, assets);
    expect(d.status).toBe('recorded-only'); expect(d.firstRecordedTick).toBe(60); expect(d.tick).toBeNull();
  });
  it('roundtrips dumps and identifies a column mutation', () => {
    const { sim } = recording();
    const a = readStateDump(writeStateDump(captureStateDump(sim.world)));
    sim.world.units.col.hp[5] = 12;
    const b = readStateDump(writeStateDump(captureStateDump(sim.world)));
    const d = diffStateDumps(a, b, { includeDerived: false });
    expect(d.entries).toHaveLength(1); expect(d.entries[0]).toMatchObject({ region: 'units', part: 'hp', index: 5 });
  });
});
