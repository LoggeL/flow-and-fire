/**
 * Benchmarks in miniature (the real runs are scripts/bench.ts): think time with replay throughput,
 * Big Battle with cheat spawn (AI-BUD-01 analogue), SPK7 scheduler with worker hosts, gates and
 * rendering. Only structural expectations — no wall-clock thresholds in tests.
 */
import { describe, expect, it } from 'vitest';
import { benchBigBattle, benchConfig, benchGates, benchSpk7, benchThinkTime, mixCounts, renderBench, type BenchReport } from '../../src/index.ts';

const FIXTURE_SPEC = `${new URL('../host/fixtures/brains.ts', import.meta.url).href}#createFixtureBrain`;

describe('benchmarks (miniature)', () => {
  it('mix of the big battle: 300 ⇒ 150/100/50, remainders deterministic', () => {
    expect(mixCounts(300)).toEqual([
      ['core:lnd_t1_tank', 150],
      ['core:lnd_t1_bot', 100],
      ['core:lnd_t1_arty', 50],
    ]);
    expect(mixCounts(10).reduce((s, [, n]) => s + n, 0)).toBe(10);
  });

  it('think time, big battle and SPK7 produce consistent reports', async () => {
    const tt = await benchThinkTime('normal', { ticks: 600, brainSpec: FIXTURE_SPEC });
    expect(tt.ticks).toBe(600);
    expect(tt.thinks).toBe(240);
    expect(tt.thinkMs.n).toBe(240);
    expect(tt.ops.p99).toBeLessThanOrEqual(tt.budget);
    expect(tt.aborted).toBe(0);
    expect(tt.replayHashEqual).toBe(true);
    expect(tt.ticksPerSecArena).toBeGreaterThan(0);
    expect(tt.managers.map((m) => m.name)).toContain('platoon');

    const bb = await benchBigBattle({ perSide: 40, ticks: 120, profile: 'hard', brainSpec: FIXTURE_SPEC });
    expect(bb.ticks).toBe(120);
    expect(bb.thinks).toBe(48);
    expect(bb.stepMsWithAi.n).toBe(120);
    expect(bb.stepMsNoAi.n).toBe(120);
    expect(bb.replayHashEqual).toBe(true);
    expect(bb.unitsLost[0]! + bb.unitsLost[1]!).toBeGreaterThan(0);

    const s = await benchSpk7({ ticks: 60, speed: 3, brainSpec: FIXTURE_SPEC });
    expect(s.ticks).toBe(60);
    expect(s.tickMs).toBeCloseTo(33.333, 2);
    expect(s.thinkMs.n).toBe(24);
    expect(s.waitedPct).toBeGreaterThanOrEqual(0);
    expect(s.effectiveSpeed).toBeGreaterThan(0);

    const gates = benchGates([tt], bb, s);
    expect(gates.find((g) => g.id === 'bb-replay')!.pass).toBe(true);
    const report: BenchReport = {
      schema: 'faf-ai-arena/bench/1',
      note: 'test',
      config: benchConfig(true, FIXTURE_SPEC),
      machine: { cpu: 'x', cores: 1, platform: 'x', node: 'x' },
      thinkTime: [tt],
      bigBattle: bb,
      spk7: s,
      wallSeconds: 1,
      gates,
      passed: gates.every((g) => !g.blocking || g.pass),
    };
    const md = renderBench(report);
    expect(md).toContain('### (c) SPK7-Analogon');
    expect(md).toContain('| normal | 600 | 240 |');
  });

  it('quick configuration stays small', () => {
    const q = benchConfig(true);
    const f = benchConfig(false);
    expect(q.spk7Ticks).toBeLessThan(f.spk7Ticks);
    expect(f.spk7Ticks).toBeGreaterThanOrEqual(3000);
    expect(f.thinkTicks).toBe(9000);
    expect(f.bigBattlePerSide).toBe(300);
  });
});
