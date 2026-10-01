import { describe, expect, it } from 'vitest';
import { readRtsReplay } from '@faf/formats';
import { convertCommandLog, HeadlessSim, replayAsParsedLog, replayLog, ReplayPlayer } from '../src/index.ts';
import { gameSimBin, hollowRidgeBytes } from './support/fixtures.ts';

describe('skirmish setup through durable and portable replay', () => {
  it('replays the recorded tick-zero commanders and banks, including rewind, without cheat taint', () => {
    const simBin = gameSimBin(), map = hollowRidgeBytes(), initialization = { kind: 'skirmish' as const, faction: 0 };
    const sim = new HeadlessSim({ simBin, map, seed: 71, armyCount: 2, initialization, keyframes: false });
    const initial = sim.fullHash(); sim.step(210); const end = sim.fullHash(), log = sim.exportLog();
    const converted = convertCommandLog(log, { simBin, map }); expect(converted.verified).toBe(true);
    expect(converted.input.game.initialization).toEqual(initialization);
    const replay = readRtsReplay(converted.bytes); expect(replayAsParsedLog(replay).header.initialization).toEqual(initialization);
    const player = ReplayPlayer.open(replay, { simBin, map }); expect(player.fullHash()).toBe(initial);
    expect(player.playToEnd().fullHash).toBe(end); expect(player.result().tainted).toBe(false); expect(player.divergences).toEqual([]);
    player.seek(0); expect(player.fullHash()).toBe(initial); player.runUntil(210); expect(player.fullHash()).toBe(end);
    const raw = replayLog(log, { simBin, map, keyframes: false }); expect(raw.sim.fullHash()).toBe(end); expect(raw.mismatches).toEqual([]);
    expect(() => convertCommandLog(log, { simBin, map, game: { initialization: { kind: 'skirmish', faction: 1 } } })).toThrow(/initialization/);
  });
});
