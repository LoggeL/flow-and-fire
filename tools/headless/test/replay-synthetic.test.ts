import { describe, expect, it } from 'vitest';
import { BUILD_PAYLOAD_BYTES, CmdFlags, CommandBatchView, decodeBuild, Op, validateBatch } from '@faf/protocol';
import { createWorld } from '@faf/sim';
import {
  generateSynthetic1v1,
  SYNTHETIC_MAX_SELECTION,
  SYNTHETIC_RULE_REGION_NAMES,
  SyntheticMarkKind,
  type SyntheticGame,
} from '../src/replay/synthetic.ts';
import { loadSimBin } from '../scripts/lib.ts';

function concat(game: SyntheticGame): Uint8Array {
  let n = 0;
  for (const c of game.commands) n += 4 + c.batch.length;
  const out = new Uint8Array(n);
  const dv = new DataView(out.buffer);
  let p = 0;
  for (const c of game.commands) {
    dv.setUint32(p, c.tick, true);
    out.set(c.batch, p + 4);
    p += 4 + c.batch.length;
  }
  return out;
}

describe('synthetic 30-min 1v1 command stream (replay size model)', () => {
  const game = generateSynthetic1v1();

  it('is deterministic: two runs are byte-identical', () => {
    const again = generateSynthetic1v1();
    expect(again.commands.length).toBe(game.commands.length);
    expect(Buffer.from(concat(again)).equals(Buffer.from(concat(game)))).toBe(true);
    expect(Buffer.from(again.hashes.values.buffer).equals(Buffer.from(game.hashes.values.buffer))).toBe(true);
    expect(Buffer.from(again.subHashes.values.buffer).equals(Buffer.from(game.subHashes.values.buffer))).toBe(true);
    expect(again.marks).toEqual(game.marks);
    expect(again.stats).toEqual(game.stats);
    // A different seed gives a different stream.
    const other = generateSynthetic1v1({ seed: 7 });
    expect(Buffer.from(concat(other)).equals(Buffer.from(concat(game)))).toBe(false);
  });

  it('covers 18,000 ticks with ascending batches whose envelope ticks equal the batch tick', () => {
    expect(game.stats.ticks).toBe(18_000);
    expect(game.commands.length).toBeGreaterThan(3000);
    let prev = 0;
    const view = new CommandBatchView();
    let envelopes = 0;
    for (const c of game.commands) {
      expect(c.tick).toBeGreaterThan(prev);
      expect(c.tick).toBeLessThanOrEqual(18_000);
      prev = c.tick;
      const n = validateBatch(c.batch);
      expect(n).toBeGreaterThan(0);
      view.reset(c.batch);
      while (view.next()) {
        if (view.tick !== c.tick) expect(view.tick).toBe(c.tick);
        if (view.unitCount > SYNTHETIC_MAX_SELECTION) expect(view.unitCount).toBeLessThanOrEqual(SYNTHETIC_MAX_SELECTION);
        envelopes++;
      }
    }
    expect(envelopes).toBe(game.stats.envelopes);
  });

  it('encodes every modeled build with the current 12-byte protocol and quarter-turn yaw', () => {
    const view = new CommandBatchView();
    let builds = 0;
    for (const c of game.commands) {
      view.reset(c.batch);
      while (view.next()) {
        if (view.op !== Op.Build) continue;
        expect(view.payloadLength).toBe(BUILD_PAYLOAD_BYTES);
        const build = decodeBuild(c.batch.subarray(view.payloadOffset, view.payloadOffset + view.payloadLength));
        expect(build.yaw % 0x4000).toBe(0);
        expect(build.x % 0x800).toBe(0);
        expect(build.z % 0x800).toBe(0);
        builds++;
      }
    }
    expect(builds).toBeGreaterThan(0);
  });

  it('hits the target APM per army within ±10 % and numbers seq consecutively per army', () => {
    const counts = [0, 0];
    const lastSeq = [-1, -1];
    const view = new CommandBatchView();
    for (const c of game.commands) {
      view.reset(c.batch);
      while (view.next()) {
        const a = view.army;
        expect(a === 0 || a === 1).toBe(true);
        if (lastSeq[a]! >= 0 && view.seq !== ((lastSeq[a]! + 1) & 0xffff)) expect(view.seq).toBe((lastSeq[a]! + 1) & 0xffff);
        if (lastSeq[a]! < 0) expect(view.seq).toBe(0);
        lastSeq[a] = view.seq;
        counts[a]!++;
      }
    }
    for (let a = 0; a < 2; a++) {
      const apm = counts[a]! / 30;
      expect(apm).toBeGreaterThanOrEqual(108);
      expect(apm).toBeLessThanOrEqual(132);
    }
    expect(game.stats.envelopesPerArmy).toEqual(counts);
    // Asymmetric APM is honoured as well.
    const asym = generateSynthetic1v1({ minutes: 10, apm: [60, 180] });
    expect(asym.stats.apmPerArmy[0]).toBeGreaterThanOrEqual(54);
    expect(asym.stats.apmPerArmy[0]).toBeLessThanOrEqual(66);
    expect(asym.stats.apmPerArmy[1]).toBeGreaterThanOrEqual(162);
    expect(asym.stats.apmPerArmy[1]).toBeLessThanOrEqual(198);
    expect(asym.stats.ticks).toBe(6000);
  });

  it('models a plausible FA-style game (op mix, selections, queues, growing handles)', () => {
    const s = game.stats;
    const ops = s.opHistogram;
    for (const name of ['Move', 'AttackMove', 'Attack', 'Assist', 'Patrol', 'Repair', 'Reclaim', 'Build', 'FactoryQueue', 'SetRally']) {
      expect(ops[name] ?? 0, name).toBeGreaterThan(20);
    }
    expect(ops.Cheat).toBeUndefined();
    const h = s.unitsPerCommandHistogram;
    expect(h['1']).toBeGreaterThan(0);
    expect(h['21-60']).toBeGreaterThan(0);
    expect(s.queuedEnvelopes).toBeGreaterThan(s.envelopes / 20);
    expect(s.liveUnitsAtEnd[0]).toBeGreaterThanOrEqual(250);
    expect(s.liveUnitsAtEnd[0]).toBeLessThanOrEqual(450);
    expect(s.maxGeneration).toBeGreaterThan(1);
    expect(s.unitsCreated).toBeGreaterThan(s.slotHighWater);
    // Queue flag appears on follow-ups only.
    let queued = 0;
    const view = new CommandBatchView();
    for (const c of game.commands) {
      view.reset(c.batch);
      while (view.next()) if ((view.flags & CmdFlags.Queue) !== 0) queued++;
    }
    expect(queued).toBe(s.queuedEnvelopes);
  });

  it('hashes every 10 ticks and sub-hashes every 100 ticks; marks pause/resume/speed', () => {
    expect(game.hashes.interval).toBe(10);
    expect(game.hashes.firstTick).toBe(10);
    expect(game.hashes.values.length).toBe(1800);
    expect(game.subHashes.interval).toBe(100);
    expect(game.subHashes.firstTick).toBe(100);
    expect(game.subHashes.values.length).toBe(180 * game.subHashes.regionNames.length);
    const kinds = game.marks.map((m) => m.kind);
    expect(kinds).toContain(SyntheticMarkKind.Pause);
    expect(kinds).toContain(SyntheticMarkKind.Resume);
    expect(kinds).toContain(SyntheticMarkKind.Speed);
    for (let i = 1; i < game.marks.length; i++) expect(game.marks[i]!.tick).toBeGreaterThanOrEqual(game.marks[i - 1]!.tick);
  });

  it('uses the rule regions of the current World as sub-hash columns', () => {
    const w = createWorld({ simBin: loadSimBin(), seed: 1, armyCount: 2 });
    const rule = w.arena.regions.filter((r) => r.area === 'dynamic' && !r.derived).map((r) => r.name);
    expect(rule.length).toBeGreaterThan(0);
    expect([...SYNTHETIC_RULE_REGION_NAMES]).toEqual(rule);
    expect(game.subHashes.regionNames).toEqual(rule);
    // Callers can pass a live world's region list.
    const custom = generateSynthetic1v1({ minutes: 1, regionNames: ['a', 'b'] });
    expect(custom.subHashes.values.length).toBe(6 * 2);
  });

  it('rejects invalid options', () => {
    expect(() => generateSynthetic1v1({ minutes: 0 })).toThrow(RangeError);
    expect(() => generateSynthetic1v1({ minutes: 1.5 })).toThrow(RangeError);
    expect(() => generateSynthetic1v1({ apm: [0, 120] })).toThrow(RangeError);
  });
});
