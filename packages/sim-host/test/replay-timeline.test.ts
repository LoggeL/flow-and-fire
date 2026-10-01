import { describe, expect, it } from 'vitest';
import { readRtsReplay, writeRtsReplay } from '@faf/formats';
import { convertCommandLog, HeadlessSim, ReplayPlayer, RtsReplaySource } from '../src/index.ts';
import { gameSimBin, spawnCmd } from './support/fixtures.ts';
const simBin = gameSimBin();
describe('replay timeline and verification coverage', () => {
  it('retains timeline evidence without META or with shortened metadata', () => {
    const sim = new HeadlessSim({ simBin, armyCount: 2, seed: 1, keyframes: false });
    sim.submit([spawnCmd(0, 5, 100, 100, 4, 0)]); sim.runUntil(700);
    const { input } = convertCommandLog(sim.exportLog(), { simBin });
    const onlySub = { ...input, meta: null, marks: [], head: { ...input.head, flags: 0 },
      hashes: { ...input.hashes, firstTick: 0, hashes: new Uint32Array(0) } };
    expect(new RtsReplaySource(readRtsReplay(writeRtsReplay(onlySub))).lastTick).toBe(700);
    const onlyCommand = { ...onlySub, hashes: { ...onlySub.hashes, subFirstTick: 0, subHashes: new Uint32Array(0) } };
    const replay = readRtsReplay(writeRtsReplay(onlyCommand));
    // The writer emits an empty final minute block when a MARK covers a later tick.
    const withTail = readRtsReplay(writeRtsReplay({ ...onlyCommand, marks: [{ tick: 700, kind: 3, value: 1000 }] }));
    expect(new RtsReplaySource({ ...withTail, marks: [] }).lastTick).toBe(input.commands.at(-1)!.tick);
    expect(new RtsReplaySource({ ...replay, hashes: input.hashes, meta: { ...input.meta!, endTick: 1 } }).lastTick).toBe(700);
  });
  it('checks tick-zero and all stored hashes even outside the live ten-tick grid', () => {
    const sim = new HeadlessSim({ simBin, armyCount: 2, seed: 1, keyframes: false });
    const hashes: number[] = [sim.ruleHash()];
    for (let tick = 7; tick <= 119; tick += 7) { sim.runUntil(tick); hashes.push(sim.ruleHash()); }
    sim.runUntil(120);
    const { input } = convertCommandLog(sim.exportLog(), { simBin, subHashes: false });
    const spaced = { ...input, head: { ...input.head, hashInterval: 7 },
      hashes: { ...input.hashes, interval: 7, firstTick: 0, hashes: Uint32Array.from(hashes) } };
    const player = ReplayPlayer.open(writeRtsReplay(spaced), { simBin, keyframes: false });
    expect(player.result().compared).toBe(1);
    expect(player.playToEnd().compared).toBe(hashes.length); expect(player.divergences).toEqual([]);
    const altered = Uint32Array.from(hashes); altered[0]! ^= 1; altered[2]! ^= 1;
    const changed = ReplayPlayer.open(writeRtsReplay({ ...spaced, hashes: { ...spaced.hashes, hashes: altered } }), { simBin, keyframes: false });
    expect(changed.playToEnd().divergences.map((d) => d.tick)).toEqual([0, 14]);
  });
});
