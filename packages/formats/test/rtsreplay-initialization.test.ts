import { describe, expect, it } from 'vitest';
import { decodeGame, encodeGame } from '../src/rtsreplay/chunks.ts';
import type { ReplayGame } from '../src/rtsreplay/types.ts';

const empty: ReplayGame = { seed: 7, mapSizeWu: 512, mapName: 'test', playerArmy: 0,
  armies: [{ index: 0, kind: 0, team: 0, aixPermille: 1000, name: 'p', aiProfile: '', faction: '' }], alliances: new Uint8Array(32) };
describe('Replay GAME initialization contract', () => {
  it('preserves v1 empty setup and emits v2 only for explicit deterministic initialization', () => {
    const old = encodeGame(empty); expect(new DataView(old.buffer).getUint16(0, true)).toBe(1);
    expect(decodeGame(old, 0)).toEqual(empty);
    const game = { ...empty, initialization: { kind: 'skirmish' as const, faction: 3 } }, bytes = encodeGame(game);
    expect(new DataView(bytes.buffer).getUint16(0, true)).toBe(2); expect(decodeGame(bytes, 0)).toEqual(game);
    expect(bytes.slice(-4)).toEqual(Uint8Array.of(1, 3, 0, 0)); expect(bytes.slice(2, -4)).toEqual(old.slice(2));
  });
  it('rejects unknown versions/kinds, reserved bits, truncation and invalid faction values', () => {
    const valid = encodeGame({ ...empty, initialization: { kind: 'skirmish', faction: 0 } });
    const future = valid.slice(); new DataView(future.buffer).setUint16(0, 4, true); expect(() => decodeGame(future, 0)).toThrow(/version 4/);
    const kind = valid.slice(); kind[kind.length - 4] = 2; expect(() => decodeGame(kind, 0)).toThrow(/kind 2/);
    const reserved = valid.slice(); reserved[reserved.length - 1] = 1; expect(() => decodeGame(reserved, 0)).toThrow(/reserved/);
    expect(() => decodeGame(valid.slice(0, -1), 0)).toThrow();
    expect(() => encodeGame({ ...empty, initialization: { kind: 'skirmish', faction: 256 } })).toThrow(/faction/);
  });
  it('GAME v3 preserves selected starts, teams, caps, fog, victory and AI configuration', () => {
    const game: ReplayGame = { ...empty, initialization: { kind: 'skirmish', faction: 0,
      slots: [{ start: 4, team: 2, faction: 0, controller: 'ai', difficulty: 'hard', aixFactorQ16: 98304 }],
      rules: { unitCap: 600, fog: 'revealed', victory: 'annihilation' } } };
    const bytes=encodeGame(game);
    expect(new DataView(bytes.buffer).getUint16(0,true)).toBe(3);
    expect(decodeGame(bytes,0)).toEqual(game);
    const reserved=bytes.slice(); reserved[reserved.length-5]=1;
    expect(()=>decodeGame(reserved,0)).toThrow();
    expect(()=>encodeGame({...game,initialization:{...game.initialization!,slots:[]}})).toThrow(/count/);
    expect(()=>decodeGame(bytes.slice(0,-4),0)).toThrow();
  });
});
