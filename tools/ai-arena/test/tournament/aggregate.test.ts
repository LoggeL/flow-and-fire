/**
 * Tournament aggregation and gates with synthetic records (ai.md §7.1/§7.2): Wilson thresholds at
 * n = 200 (189 of 200 pass, 188 fail), point vs. Wilson vs. report mode, side sampling by seed
 * parity, crashes as failures, pooled stall, idle in every game, APM/ops/aiTimeout gates, results
 * with Elo, breakdowns, outliers and the Markdown report.
 */
import { describe, expect, it } from 'vitest';
import {
  aggregate,
  buildReport,
  eloDiff,
  fmtClock,
  pooledStallPct,
  rateStat,
  renderMarkdown,
  suiteDef,
  successesNeeded,
  type GameRecord,
  type GateResult,
} from '../../src/index.ts';
import { game, side, t2Games } from './support.ts';

const gate = (gates: readonly GateResult[], id: string): GateResult => {
  const g = gates.find((x) => x.id === id);
  if (g === undefined) throw new Error(`gate ${id} missing`);
  return g;
};

describe('rate gates (T2 ≤ 12 min, first wave ≤ 8 min)', () => {
  it('n = 200: 189 successes pass the Wilson gate, 188 do not (ai.md §7.1: 90 % → 189)', () => {
    expect(successesNeeded(200, 0.9)).toBe(189);
    const pass = aggregate(t2Games(200, 189), 'wilson');
    const t2 = gate(pass.gates, 't2:normal-vs-normal');
    expect(t2.pass).toBe(true);
    expect(t2.blocking).toBe(true);
    expect(pass.pairings[0]!.t2.successes).toBe(189);
    expect(pass.pairings[0]!.t2.lo).toBeGreaterThanOrEqual(0.9);
    expect(pass.passed).toBe(true);

    const fail = aggregate(t2Games(200, 188), 'wilson');
    expect(gate(fail.gates, 't2:normal-vs-normal').pass).toBe(false);
    expect(fail.pairings[0]!.t2.lo).toBeLessThan(0.9);
    expect(fail.passed).toBe(false);
  });

  it('point mode judges the point estimate, report mode never blocks', () => {
    const recs = t2Games(12, 11); // 91.7 %, Wilson lower bound ≈ 64.6 %
    expect(gate(aggregate(recs, 'point').gates, 't2:normal-vs-normal').pass).toBe(true);
    expect(gate(aggregate(recs, 'wilson').gates, 't2:normal-vs-normal').pass).toBe(false);
    const rep = aggregate(recs, 'report');
    const g = gate(rep.gates, 't2:normal-vs-normal');
    expect(g.pass).toBe(false);
    expect(g.blocking).toBe(false);
    expect(rep.passed).toBe(true);
    const r10 = aggregate(t2Games(12, 10), 'point');
    expect(gate(r10.gates, 't2:normal-vs-normal').pass).toBe(false);
    expect(r10.passed).toBe(false);
  });

  it('only the sampled side counts (mirror: army with the seed parity)', () => {
    // t2Games gives the NON-sampled side 15:00 in every game: it must not matter
    const a = aggregate(t2Games(20, 20), 'point');
    expect(a.pairings[0]!.t2.successes).toBe(20);
    expect(a.pairings[0]!.t2.medianS).toBe(700);
    // the other way round: only the non-sampled side is fast ⇒ 0 successes
    const flipped = t2Games(20, 20).map((g) => ({
      ...g,
      sides: g.sides.map((s) => ({ ...s, t2Tick: s.army === g.sampledArmy ? 9000 : 7000 })),
    }));
    expect(aggregate(flipped, 'point').pairings[0]!.t2.successes).toBe(0);
    // seeds 1, 2: sampled armies 1 and 0
    expect(game(0, { seed: 1 }).sampledArmy).toBe(1);
    expect(game(0, { seed: 2 }).sampledArmy).toBe(0);
  });

  it('a missing event and a crashed game count as failures', () => {
    const recs: GameRecord[] = [game(0, { sides: [{ firstWaveTick: null }, { firstWaveTick: null }] }), game(1, { crash: 'Error: boom' }), game(2), game(3)];
    const s = aggregate(recs, 'point').pairings[0]!.wave;
    expect(s.n).toBe(4);
    expect(s.successes).toBe(2);
    expect(s.missing).toBe(2);
    expect(rateStat([null, side(0, { t2Tick: 7200 }), side(0, { t2Tick: 7201 })], (x) => x.t2Tick, 7200).successes).toBe(1);
  });
});

describe('blocking gates in every mode', () => {
  it('crashes, aiTimeout, APM-p99 and ops-p99 block even in report mode', () => {
    const base = [game(0), game(1), game(2), game(3)];
    expect(aggregate(base, 'report').passed).toBe(true);
    const crash = aggregate([...base, game(4, { crash: 'RangeError: x' })], 'report');
    expect(gate(crash.gates, 'crash').pass).toBe(false);
    expect(crash.passed).toBe(false);
    expect(crash.crashList).toEqual([{ game: 4, seed: 3, map: 'setons', error: 'RangeError: x' }]);

    const timeout = aggregate([game(0, { sides: [{ aiTimeouts: 1, timeoutTicks: [600] }, {}] }), game(1)], 'report');
    expect(gate(timeout.gates, 'aiTimeout').pass).toBe(false);
    expect(timeout.outliers.map((o) => o.reasons)).toEqual([['aiTimeout ×1 (Tick 600)']]);

    // APM p99 over all windows: 1 window of 200 among 99 of 50 is exactly the p99 rank (99th) ⇒ 50
    const w = Array.from({ length: 99 }, () => 50);
    const apmOk = aggregate([game(0, { sides: [{ apmWindows: [...w, 200] }, { apmWindows: [] }] })], 'report');
    expect(apmOk.budgets[0]!.apmP99).toBe(50);
    expect(gate(apmOk.gates, 'apm:normal').pass).toBe(true);
    const apmBad = aggregate([game(0, { sides: [{ apmWindows: [...w.slice(0, 97), 130, 130, 130] }, { apmWindows: [] }] })], 'report');
    expect(apmBad.budgets[0]!.apmP99).toBe(130);
    expect(gate(apmBad.gates, 'apm:normal').pass).toBe(false);

    const ops = aggregate([game(0, { sides: [{ opsP99: 24001 }, {}] })], 'report');
    expect(gate(ops.gates, 'ops:normal').pass).toBe(false);
    expect(ops.budgets[0]!.opsP99Max).toBe(24001);
  });

  it('idle engineers < 15 % in every game (every side), blocking unless report', () => {
    const recs = [game(0), game(1, { sides: [{}, { idleEngineerPct: 15 }] })];
    const a = aggregate(recs, 'point');
    const g = gate(a.gates, 'idle:normal-vs-normal');
    expect(g.pass).toBe(false);
    expect(a.pairings[0]!.idleViolations).toBe(1);
    expect(a.pairings[0]!.idleMaxPct).toBe(15);
    expect(a.passed).toBe(false);
    expect(aggregate(recs, 'report').passed).toBe(true);
  });

  it('energy stall is pooled over the sampled sides and never blocks', () => {
    expect(pooledStallPct([side(0, { energyStallTicks: 10, energyCountedTicks: 100 }), side(1, { energyStallTicks: 0, energyCountedTicks: 900 })])).toBe(1);
    const recs = [0, 1, 2, 3].map((i) => game(i, { sides: [{ energyStallTicks: 200, energyCountedTicks: 1000, energyStallPct: 20 }, { energyStallTicks: 200, energyCountedTicks: 1000, energyStallPct: 20 }] }));
    const a = aggregate(recs, 'wilson');
    const g = gate(a.gates, 'stall:normal-vs-normal');
    expect(a.pairings[0]!.stallPooledPct).toBe(20);
    expect(g.pass).toBe(false);
    expect(g.blocking).toBe(false);
    expect(a.outliers.length).toBe(8);
    expect(a.outliers[0]!.reasons).toEqual(['Stall 20.0 %']);
  });
});

describe('results, breakdowns and outliers', () => {
  it('win rate of A with Wilson interval and Elo per pairing and map (non-mirror, A = army of contestant A)', () => {
    const recs: GameRecord[] = [];
    // hard-vs-normal: A wins 3 of 4 (seed 1 twice on setons, seed 2 twice on tessera), one draw
    recs.push(game(0, { mirror: false, pairing: 'hard-vs-normal', seed: 1, swapped: false, winner: 0 }));
    recs.push(game(1, { mirror: false, pairing: 'hard-vs-normal', seed: 1, swapped: true, winner: 1 }));
    recs.push(game(2, { mirror: false, pairing: 'hard-vs-normal', seed: 2, map: 'tessera', swapped: false, winner: 0 }));
    recs.push(game(3, { mirror: false, pairing: 'hard-vs-normal', seed: 2, map: 'tessera', swapped: true, winner: -1 }));
    const a = aggregate(recs, 'report');
    const p = a.pairings[0]!;
    expect(p.results).toMatchObject({ games: 4, n: 4, winsA: 3, draws: 1, winsB: 0, crashes: 0 });
    expect(p.results.winRateA.p).toBe(0.875);
    expect(p.results.eloA).toBeCloseTo(400 * Math.log10(0.875 / 0.125), 9);
    expect(p.resultsByMap.map((m) => [m.map, m.winsA, m.draws])).toEqual([
      ['setons', 2, 0],
      ['tessera', 1, 1],
    ]);
    // non-mirror samples contestant A's army
    expect(recs.map((r) => r.sampledArmy)).toEqual([0, 1, 0, 1]);
  });

  it('breakdown per map and per opening of the sampled side, sorted by key', () => {
    const recs = [
      game(0, { seed: 1, map: 'tessera', sides: [{ opening: 'land_rush' }, { opening: 'tech_greed', t2Tick: 5000 }] }),
      game(1, { seed: 2, map: 'setons', sides: [{ opening: 'eco_standard' }, { opening: 'land_rush' }] }),
      game(2, { seed: 3, map: 'setons', crash: 'Error: x' }),
    ];
    const p = aggregate(recs, 'report').pairings[0]!;
    expect(p.byMap.map((r) => [r.key, r.n])).toEqual([
      ['setons', 2],
      ['tessera', 1],
    ]);
    // seed 1 samples army 1 (tech_greed), seed 2 army 0 (eco_standard)
    expect(p.byOpening.map((r) => [r.key, r.n])).toEqual([
      ['(crash)', 1],
      ['eco_standard', 1],
      ['tech_greed', 1],
    ]);
    expect(p.byOpening.find((r) => r.key === 'tech_greed')!.t2.medianS).toBe(500);
    // Elo per row (map and opening) from the row's win rate; a row without finished games has 0.
    for (const r of [...p.byMap, ...p.byOpening]) {
      if (r.key === '(crash)') expect(r.elo).toBe(0);
      else expect(r.elo).toBe(eloDiff(r.winRate.p));
    }
  });

  it('outliers: crash, T2 > 12 min (or none by 12 min), stall > 10 %, idle ≥ 15 %, with seed and map', () => {
    const recs = [
      game(0, { seed: 5, map: 'hollow-ridge', sides: [{ t2Tick: 7300 }, { t2Tick: null }] }),
      game(1, { seed: 5, map: 'hollow-ridge', sides: [{ energyStallPct: 10.5 }, { idleEngineerPct: 16 }] }),
      game(2, { seed: 6, crash: 'Error: worker died' }),
    ];
    const o = aggregate(recs, 'report').outliers;
    expect(o.map((x) => [x.game, x.army, x.seed, x.map, x.reasons])).toEqual([
      [0, 0, 5, 'hollow-ridge', ['T2 12:10']],
      [0, 1, 5, 'hollow-ridge', ['kein T2']],
      [1, 0, 5, 'hollow-ridge', ['Stall 10.5 %']],
      [1, 1, 5, 'hollow-ridge', ['Idle 16.0 %']],
      [2, -1, 6, 'setons', ['crash: Error: worker died']],
    ]);
    expect(fmtClock(7300)).toBe('12:10');
    expect(fmtClock(4805)).toBe('8:00');
  });

  it('report and Markdown: schema, passed flag and tables', () => {
    const def = suiteDef('quick');
    const r = buildReport(def, t2Games(12, 12), { generatedAt: '2026-09-30T00:00:00Z', wallSeconds: 12, workers: 4 });
    expect(r.schema).toBe('faf-ai-arena/tournament/1');
    expect(r.passed).toBe(true);
    expect(r.records.length).toBe(12);
    expect(JSON.parse(JSON.stringify(r)).gates.length).toBe(r.gates.length);
    const md = renderMarkdown(r);
    expect(md).toContain('## Turnier `quick` – BESTANDEN');
    expect(md).toContain('| T2 normal-vs-normal ≤ 12:00 | 12/12 = 100.0 %');
    expect(md).toContain('### Ausreißer (12)');
    const bad = buildReport(def, t2Games(12, 9));
    expect(bad.passed).toBe(false);
    expect(renderMarkdown(bad)).toContain('NICHT BESTANDEN');
  });
});
