import { describe, expect, it } from 'vitest';
import { encodeBatch, decodeBatch } from '../../../../packages/protocol/src/index.ts';
import { SimCore, parseCommandLog, type TickSource } from '../../../../packages/sim-host/src/index.ts';
import { gameSimBin, spawnCmd, moveCmd } from '../../../../packages/sim-host/test/support/fixtures.ts';
import { unitHandles } from '../../../../packages/sim/src/index.ts';
import { installRecordedCommandSource } from './recorded-source.ts';
import type { RecordedBatch } from './contract.ts';

function capture() {
  const batches = new Map<number, Uint8Array>();
  const source: TickSource = { pending: () => false, batchFor: tick => batches.get(tick) ?? null,
    commandsFor: tick => { const bytes = batches.get(tick); return bytes === undefined ? [] : decodeBatch(bytes); } };
  const core = new SimCore({ simBin: gameSimBin(), seed: 7, armyCount: 2, playerArmy: -1, sources: [source] });
  batches.set(1, encodeBatch([spawnCmd(0, 8, 120, 120, 4, 1), spawnCmd(1, 8, 380, 380, 4, 1)]));
  for (let tick = 1; tick <= 30; tick++) {
    if (tick === 3) batches.set(tick, encodeBatch([moveCmd(0, unitHandles(core.world, 0), 145, 150, 2)]));
    if (tick === 8 || tick === 13 || tick === 28) batches.set(tick, encodeBatch([]));
    expect(core.runTick()).toBe(true);
  }
  const bytes = new Uint8Array(core.recorder!.export(30)), parsed = parseCommandLog(bytes);
  const commands: RecordedBatch[] = parsed.commands.map(entry => ({ tick: entry.tick,
    bytes: Array.from(parsed.bytes.subarray(entry.offset, entry.offset + entry.length)) }));
  return { core, bytes, commands };
}
function fresh(seed = 7) { return new SimCore({ simBin: gameSimBin(), seed, armyCount: 2, playerArmy: -1 }); }

describe('actual recorded no-AI source fidelity', () => {
  it('retains empty accepted batches through the real gather/recorder and exact whole-Arena replay', () => {
    const original = capture(), replay = fresh(), lossy = fresh();
    expect(original.commands.filter(entry => entry.bytes.length === 3).map(entry => entry.tick)).toEqual([8, 13, 28]);
    installRecordedCommandSource(replay, original.bytes, original.commands, 30);
    for (let tick = 1; tick <= 30; tick++) {
      for (const entry of original.commands) if (entry.tick === tick) lossy.local.push(Uint8Array.from(entry.bytes));
      expect(lossy.runTick()).toBe(true);expect(replay.runTick()).toBe(true);
      expect(Buffer.compare(replay.world.arena.bytes, lossy.world.arena.bytes)).toBe(0);
    }
    const parse = (core: SimCore) => {
      const log = parseCommandLog(core.recorder!.export(30));
      return log.commands.map(entry => ({ tick: entry.tick, bytes: Array.from(log.bytes.subarray(entry.offset, entry.offset + entry.length)) }));
    };
    expect(parse(lossy)).toHaveLength(original.commands.length - 3);
    expect(parse(replay)).toEqual(original.commands);
    expect(Buffer.compare(replay.world.arena.bytes, original.core.world.arena.bytes)).toBe(0);
    expect(replay.hashTrail()).toEqual(original.core.hashTrail());
    expect([replay.ruleHash(), replay.fullHash()]).toEqual([original.core.ruleHash(), original.core.fullHash()]);
    expect(Buffer.compare(new Uint8Array(replay.recorder!.export(30)), original.bytes)).toBe(0);
  });

  it('rejects a captured record that was altered or has the wrong accepted tick before installing', () => {
    const original = capture(), replay = fresh(), before = replay.local.batchFor;
    const changed = original.commands.map(entry => ({ tick: entry.tick, bytes: [...entry.bytes] }));
    changed[2]!.bytes[0] = 0;
    expect(() => installRecordedCommandSource(replay, original.bytes, changed, 30)).toThrow('byte 0 differs');
    expect(replay.local.batchFor).toBe(before);changed[2]!.bytes[0] = 1;changed[2]!.tick++;
    expect(() => installRecordedCommandSource(replay, original.bytes, changed, 30)).toThrow('record 2 differs');
    expect(replay.local.batchFor).toBe(before);
  });

  it('rejects a wrong identity, duration and a source installed after the first real tick', () => {
    const original = capture();
    expect(() => installRecordedCommandSource(fresh(8), original.bytes, original.commands, 30)).toThrow('identity');
    expect(() => installRecordedCommandSource(fresh(), original.bytes, original.commands, 29)).toThrow('duration');
    const advanced = fresh();expect(advanced.runTick()).toBe(true);
    expect(() => installRecordedCommandSource(advanced, original.bytes, original.commands, 30)).toThrow('fresh no-AI');
  });
});
