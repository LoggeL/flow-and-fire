import { describe, expect, it } from 'vitest';
import { CmdFlags, CommandBatchView, Op, validateBatch } from '@faf/protocol';
import { parseCommandLog, replayLog } from '@faf/sim-host';
import { HOLLOW_RIDGE_PATH } from '../src/scenarios.ts';
import { recordLongGame, type LongGame } from '../src/replay/long-game.ts';
import { loadMaps, loadSimBin } from '../scripts/lib.ts';

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

describe('sim-valid long game (2-minute variant of the 30-min measurement game)', () => {
  const simBin = loadSimBin();
  const maps = loadMaps();
  const minutes = 2;
  const a: LongGame = recordLongGame({ minutes, simBin, maps });

  it('is deterministic: two recordings are byte-identical', () => {
    const b = recordLongGame({ minutes, simBin, maps });
    expect(bytesEqual(a.log, b.log)).toBe(true);
    expect(b.stats).toEqual(a.stats);
    // Another seed is another game.
    const c = recordLongGame({ minutes, simBin, maps, seed: 7 });
    expect(bytesEqual(a.log, c.log)).toBe(false);
  });

  it('is sim-valid: replayLog reproduces every recorded hash and the final state', () => {
    const r = replayLog(a.log, { simBin, map: maps[HOLLOW_RIDGE_PATH]!, keyframes: false });
    expect(r.mismatches).toEqual([]);
    expect(r.compared).toBe(minutes * 60);
    expect(r.lastTick).toBe(minutes * 600);
    expect(r.ruleHash).toBe(a.stats.finalRuleHash);
    expect(r.fullHash).toBe(a.stats.finalFullHash);
    expect(r.log.truncated).toBe(false);
    expect(r.log.endTick).toBe(minutes * 600);
  });

  it('keeps the APM model: player orders per army exactly at the target (band ±10 %)', () => {
    const s = a.stats;
    for (const apm of s.apmPerArmy) {
      expect(apm).toBeGreaterThanOrEqual(108);
      expect(apm).toBeLessThanOrEqual(132);
    }
    // Count from the log itself: Move/Stop per army = player orders.
    const log = parseCommandLog(a.log);
    const v = new CommandBatchView();
    const orders = [0, 0];
    let queued = 0;
    let maxSel = 0;
    for (const c of log.commands) {
      const b = a.log.subarray(c.offset, c.offset + c.length);
      expect(validateBatch(b)).toBeGreaterThan(0);
      v.reset(b);
      while (v.next()) {
        expect(v.tick).toBe(c.tick);
        if (v.op === Op.Move || v.op === Op.Stop) {
          orders[v.army]!++;
          if ((v.flags & CmdFlags.Queue) !== 0) queued++;
          if (v.unitCount > maxSel) maxSel = v.unitCount;
        }
      }
    }
    expect(orders).toEqual([...s.ordersPerArmy]);
    expect(queued).toBe(s.queuedEnvelopes);
    expect(queued).toBeGreaterThan(0);
    expect(maxSel).toBeLessThanOrEqual(60);
    expect(maxSel).toBeGreaterThan(20);
    // Cheat spawns/kills are production/combat stand-ins, each tick with one carries a Cheat MARK.
    expect(s.opHistogram['Cheat:spawn']).toBeGreaterThan(0);
    expect(s.opHistogram['Cheat:kill']).toBeGreaterThan(0);
    expect(log.tainted).toBe(true);
    expect(s.hashEntries).toBe(minutes * 60);
  });

  it('reaches the typical load of ≈ 300–400 units', () => {
    const s = a.stats;
    expect(s.liveUnitsMax).toBeGreaterThanOrEqual(300);
    expect(s.liveUnitsMax).toBeLessThanOrEqual(400);
    expect(s.liveUnitsMin).toBeGreaterThanOrEqual(300);
    expect(s.liveUnitsEnd).toBeGreaterThanOrEqual(300);
  });

  it('runs on setons as well', () => {
    const g = recordLongGame({ minutes: 1, simBin, maps, map: 'setons' });
    const r = replayLog(g.log, { simBin, map: maps['content/maps/setons.rtsmap']!, keyframes: false });
    expect(r.mismatches).toEqual([]);
    expect(r.fullHash).toBe(g.stats.finalFullHash);
  });

  it('rejects a missing map and bad options', () => {
    expect(() => recordLongGame({ minutes: 1, simBin, maps: {} })).toThrow(/not provided/);
    expect(() => recordLongGame({ minutes: 0, simBin, maps })).toThrow(RangeError);
  });
});
