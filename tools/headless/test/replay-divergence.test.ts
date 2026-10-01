import { describe, expect, it } from 'vitest';
import { CommandBatchView, Op } from '@faf/protocol';
import { HeadlessSim, parseCommandLog, ReplaySource, type ParsedCommandLog } from '@faf/sim-host';
import { captureStateDump } from '../src/replay/dump.ts';
import { firstDivergentRecordedTick, findFirstDivergence, headlessRun, trailFromEntries, type SteppedRun } from '../src/replay/divergence.ts';
import { recordLongGame } from '../src/replay/long-game.ts';
import { diffStateDumps } from '../src/replay/state-diff.ts';
import { HOLLOW_RIDGE_PATH } from '../src/scenarios.ts';
import { loadMaps, loadSimBin } from '../scripts/lib.ts';

const simBin = loadSimBin();
const maps = loadMaps();
const game = recordLongGame({ minutes: 1, simBin, maps });
const log = parseCommandLog(game.log);

function replaySim(l: ParsedCommandLog): HeadlessSim {
  return new HeadlessSim({
    simBin,
    seed: l.header.seed,
    armyCount: l.header.armyCount,
    map: maps[HOLLOW_RIDGE_PATH]!,
    sources: [new ReplaySource(l)],
    record: false,
    keyframes: false,
  });
}

/** SteppedRun whose world is changed by `perturb` right after the step of `atTick`. */
function perturbed(sim: HeadlessSim, atTick: number, perturb: (sim: HeadlessSim) => void): SteppedRun {
  const inner = headlessRun(sim);
  return {
    tick: inner.tick,
    ruleHash: inner.ruleHash,
    step: () => {
      inner.step();
      if (sim.tick === atTick) perturb(sim);
    },
  };
}

/** Naive reference: first tick with differing rule hash, checking every tick. */
function naiveFirst(a: HeadlessSim, b: SteppedRun, toTick: number): number | null {
  while (a.tick < toTick) {
    a.step(1);
    b.step();
    if (a.ruleHash() !== b.ruleHash()) return a.tick;
  }
  return null;
}

describe('tick-exact divergence search', () => {
  it('identical runs → null (rule hashes equal through toTick)', () => {
    const r = findFirstDivergence(headlessRun(replaySim(log)), headlessRun(replaySim(log)), { toTick: 600 });
    expect(r.tick).toBeNull();
    expect(r.ruleA).toBe(r.ruleB);
    expect(r.fromTick).toBe(0);
  });

  it('a column changed in B at tick 437 → 437 exactly (not the next 10-tick grid point)', () => {
    const a = replaySim(log);
    const b = replaySim(log);
    const slot = 17;
    const r = findFirstDivergence(headlessRun(a), perturbed(b, 437, (s) => (s.world.units.col.x[slot] = s.world.units.col.x[slot]! + 1)), { toTick: 600 });
    expect(r.tick).toBe(437);
    expect(r.ruleA).not.toBe(r.ruleB);
    // Both runs stop at the divergent tick: a full dump names the manipulated entity.
    expect(a.tick).toBe(437);
    expect(b.tick).toBe(437);
    const d = diffStateDumps(captureStateDump(a.world), captureStateDump(b.world), { includeDerived: false });
    expect(d.entries).toHaveLength(1);
    expect(d.entries[0]).toMatchObject({ region: 'units', part: 'x', index: slot });
  });

  it('a changed command in B → the tick it is applied in; agrees with the naive per-tick search', () => {
    // B: the first Move at or after tick 437 gets another target.
    const bytes = game.log.slice();
    const lb = parseCommandLog(bytes);
    const v = new CommandBatchView();
    let changed = -1;
    for (const c of lb.commands) {
      if (c.tick < 437 || changed >= 0) continue;
      v.reset(bytes.subarray(c.offset, c.offset + c.length));
      while (v.next()) {
        if (v.op === Op.Move && v.unitCount > 0) {
          const po = c.offset + v.payloadOffset;
          const dv = new DataView(bytes.buffer, bytes.byteOffset);
          dv.setInt32(po, dv.getInt32(po, true) + 4096 * 30, true);
          changed = c.tick;
          break;
        }
      }
    }
    expect(changed).toBeGreaterThanOrEqual(437);
    // The entry check values are not re-computed: build B's source from the parsed entries directly.
    const lb2: ParsedCommandLog = { ...lb, bytes };
    const r = findFirstDivergence(headlessRun(replaySim(log)), headlessRun(replaySim(lb2)), { toTick: 600 });
    expect(r.tick).toBe(changed);
    expect(naiveFirst(replaySim(log), headlessRun(replaySim(lb2)), 600)).toBe(changed);
  });

  it('starts from a common mid-game tick and reports a difference present on entry', () => {
    const a = replaySim(log);
    const b = replaySim(log);
    a.runUntil(300);
    b.runUntil(300);
    expect(findFirstDivergence(headlessRun(a), headlessRun(b), { toTick: 320 }).tick).toBeNull();
    b.world.movers.col.tx[0] = b.world.movers.col.tx[0]! + 1;
    const r = findFirstDivergence(headlessRun(a), headlessRun(b), { toTick: 400 });
    expect(r.tick).toBe(320);
    expect(r.fromTick).toBe(320);
    const c = replaySim(log);
    c.runUntil(10);
    expect(() => findFirstDivergence(headlessRun(a), headlessRun(c), { toTick: 400 })).toThrow(RangeError);
  });

  it('recorded trails: first differing tick of the 10-tick grid, common ticks of different grids', () => {
    const a = replaySim(log);
    const b = replaySim(log);
    const runB = perturbed(b, 437, (s) => (s.world.units.col.hp[3] = 1));
    while (a.tick < 600) {
      a.step(1);
      runB.step();
    }
    const ta = trailFromEntries(a.hashTrail());
    const tb = trailFromEntries(b.hashTrail());
    expect(ta).toMatchObject({ firstTick: 10, interval: 10 });
    expect(firstDivergentRecordedTick(ta, tb)).toBe(440);
    expect(firstDivergentRecordedTick(ta, ta)).toBeNull();
    // The recorded log trail equals the replayed one.
    expect(firstDivergentRecordedTick(trailFromEntries(log.hashes), ta)).toBeNull();
    // Different grids (10 vs 50): only common ticks count → 450.
    const coarse = { firstTick: 50, interval: 50, values: Uint32Array.from(tb.values.filter((_, i) => (i + 1) % 5 === 0)) };
    expect(firstDivergentRecordedTick(ta, coarse)).toBe(450);
    // A shorter (truncated) trail is not a divergence by itself.
    const short = { firstTick: 10, interval: 10, values: ta.values.slice(0, 20) };
    expect(firstDivergentRecordedTick(short, ta)).toBeNull();
    expect(firstDivergentRecordedTick(short, tb)).toBeNull();
    expect(firstDivergentRecordedTick({ firstTick: 10, interval: 10, values: [] }, tb)).toBeNull();
    expect(() => firstDivergentRecordedTick({ firstTick: 10, interval: 0, values: [1] }, tb)).toThrow(RangeError);
  });
});
