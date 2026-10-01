import { beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { readRtsReplay, rewriteRtsReplay, readAllCommands, writeRtsReplay, ReplayFlags, ReplayMarkKind } from '@faf/formats';
import { decodeBatch, encodeBatch } from '@faf/protocol';
import { convertCommandLog, HeadlessSim, MarkKind, parseCommandLog, ReplayCompatError, ReplayPlayer, RtsReplaySource, verifyReplay, type ConvertResult } from '../src/index.ts';
import { gameSimBin, runScenario } from './support/fixtures.ts';

const simBin = gameSimBin();
let original: HeadlessSim, converted: ConvertResult;
beforeAll(() => { original = new HeadlessSim({ seed: 43, armyCount: 2, simBin, keyframes: false }); runScenario(original, 2000); converted = convertCommandLog(original.exportLog(), { simBin }); });
describe('portable replay conversion and playback', () => {
  it('preserves commands, marks and hashes and verifies both final hashes', () => {
    expect(converted.verified).toBe(true);
    const r = readRtsReplay(converted.bytes), log = parseCommandLog(original.exportLog());
    expect(rewriteRtsReplay(r)).toEqual(converted.bytes);
    expect(r.marks).toEqual(log.marks);
    expect([...r.hashes.hashes]).toEqual(log.hashes.map((h) => h.hash));
    expect(r.hashes.subHashes.length).toBe(20 * original.world.arena.ruleRegions.length);
    expect(readAllCommands(r).map((c) => decodeBatch(c.batch))).toEqual(log.commands.map((c) => decodeBatch(log.bytes.subarray(c.offset, c.offset + c.length))));
    const v = verifyReplay(r, { simBin });
    expect(v.divergences).toEqual([]); expect(v.compared).toBe(200); expect(v.subCompared).toBe(20);
    expect(v.ruleHash).toBe(original.ruleHash()); expect(v.fullHash).toBe(original.fullHash());
    for (const [name, value] of Object.entries(MarkKind)) expect(ReplayMarkKind[name as keyof typeof ReplayMarkKind]).toBe(value);
  });
  it('reports an altered rule hash at its exact tick', () => {
    const hashes = converted.input.hashes.hashes.slice(); hashes[109]! ^= 1;
    const bytes = writeRtsReplay({ ...converted.input, hashes: { ...converted.input.hashes, hashes } });
    const v = verifyReplay(bytes, { simBin, keyframes: false });
    expect(v.divergences).toHaveLength(1); expect(v.divergences[0]!.tick).toBe(1100);
  });
  it('identifies changed state regions after an altered command', () => {
    const commands = converted.input.commands.map((c) => {
      if (c.tick !== 1100) return c;
      const envelopes = decodeBatch(c.batch); const first = envelopes[0]!;
      const payload = first.payload.slice(); new DataView(payload.buffer).setInt32(0, 50 * 4096, true);
      return { tick: c.tick, batch: encodeBatch([{ ...first, payload }, ...envelopes.slice(1)]) };
    });
    const v = verifyReplay(writeRtsReplay({ ...converted.input, commands }), { simBin, keyframes: false });
    expect(v.divergences[0]!.tick).toBeGreaterThanOrEqual(1100);
    expect(v.divergences[0]!.regions.length).toBeGreaterThan(0);
  });
  it('rejects mismatched build or map before playback', () => {
    const bytes = writeRtsReplay({ ...converted.input, head: { ...converted.input.head, simBuild: 'wrong' } });
    expect(() => ReplayPlayer.open(bytes, { simBin })).toThrow(ReplayCompatError);
    expect(() => ReplayPlayer.open(bytes, { simBin })).toThrow('/b/');
    expect(() => ReplayPlayer.open(writeRtsReplay({ ...converted.input, head: { ...converted.input.head, mapSimHash: 123 } }), { simBin })).toThrow(ReplayCompatError);
  });
  it('seeks repeatedly through minute boundaries and a tiny keyframe budget', () => {
    const p = ReplayPlayer.open(converted.bytes, { simBin, keyframes: { intervalTicks: 300, maxBytes: 50000 } });
    p.playToEnd();
    const direct = ReplayPlayer.open(converted.bytes, { simBin, keyframes: false });
    const targets = [2000, 250, 600, 1199, 1200, 0, 1900, ...fc.sample(fc.integer({ min: 0, max: 2000 }), { seed: 8721, numRuns: 30 })];
    const expected = new Map<number, number>();
    for (const t of [...new Set(targets)].sort((a, b) => a - b)) { direct.runUntil(t); expected.set(t, direct.fullHash()); }
    for (const t of targets) { p.seek(t); expect(p.fullHash(), `tick ${t}`).toBe(expected.get(t)); }
    expect(p.divergences).toEqual([]);
    expect(() => p.seek(-1)).toThrow(RangeError); expect(() => p.seek(2001)).toThrow(RangeError);
  }, 90000);
  it('reads lazy command blocks correctly across backward jumps', () => {
    const r = readRtsReplay(converted.bytes), s = new RtsReplaySource(r);
    for (const t of [1100, 1, 1777, 1001, 2, 1100, 1]) {
      const expected = converted.input.commands.find((c) => c.tick === t)?.batch ?? null;
      expect(s.batchFor(t)).toEqual(expected);
    }
  });
  it('recovers valid prefixes at fifty torn-tail offsets', () => {
    const short = new HeadlessSim({ seed: 43, armyCount: 2, simBin, keyframes: false });
    runScenario(short, 180);
    const bytes = short.exportLog(); const headerBytes = new DataView(bytes.buffer).getUint16(6, true);
    fc.assert(fc.property(fc.integer({ min: headerBytes, max: bytes.length - 1 }), (length) => {
      const result = convertCommandLog(bytes.slice(0, length), { simBin });
      expect(result.truncatedSource).toBe(true); expect(result.verified).toBe(true);
      const r = readRtsReplay(result.bytes); expect(r.head.flags & ReplayFlags.Truncated).toBeTruthy();
      expect(verifyReplay(r, { simBin, keyframes: false }).divergences).toEqual([]);
    }), { seed: 8721, numRuns: 50 });
  }, 60000);
});
