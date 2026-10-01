import { describe, expect, it } from 'vitest';
import { isAllied, setAlliance } from '@faf/sim';
import { convertCommandLog, HeadlessSim, ReplayPlayer } from '../src/index.ts';
import { gameSimBin, spawnCmd } from './support/fixtures.ts';

describe('replay alliance setup', () => {
  it('applies GAME alliances before tick zero capture, verification and rewind', () => {
    const simBin = gameSimBin();
    const original = new HeadlessSim({ simBin, armyCount: 2, seed: 7, keyframes: false });
    setAlliance(original.world, 0, 1, true);
    const tickZeroHash = original.fullHash();
    original.submit([spawnCmd(0, 10, 128, 128, 5, 1), spawnCmd(1, 10, 160, 160, 5, 1)]);
    original.step(120);
    const alliances = new Uint8Array(32);
    for (let i = 0; i < original.world.alliance.u8.length; i++) {
      if (original.world.alliance.u8[i] === 1) alliances[i >>> 3]! |= 1 << (i & 7);
    }
    const converted = convertCommandLog(original.exportLog(), { simBin, game: { alliances } });
    expect(converted.verified).toBe(true);
    const player = ReplayPlayer.open(converted.bytes, { simBin });
    expect(isAllied(player.world, 0, 1)).toBe(true);
    expect(isAllied(player.world, 1, 0)).toBe(true);
    expect(player.fullHash()).toBe(tickZeroHash);
    expect(player.playToEnd().divergences).toEqual([]);
    expect(player.fullHash()).toBe(original.fullHash());
    player.seek(0);
    expect(player.fullHash()).toBe(tickZeroHash);
    expect(isAllied(player.world, 0, 1)).toBe(true);
  });
});
