import { describe, expect, it } from 'vitest';
import {
  aiBaseSeed,
  canPlaceCost,
  DECAY_LUT,
  decayFactor,
  FixedBudget,
  firstWaveFor,
  horizonFor,
  managerRng,
  OP_COST,
  PROFILES,
  profileFor,
  ThinkBudget,
  toFxRaw,
  Xorshift32,
  type Difficulty,
} from '../src/index.ts';
import { rng32 } from '@faf/fixed';
import { loadOpenings } from './support/fixtures.ts';

describe('op budget (ai.md §2.3)', () => {
  it('op costs and canPlace formula', () => {
    expect(OP_COST).toEqual({ unit: 1, cell: 1, node: 1, command: 10 });
    expect(canPlaceCost(2, 2)).toBe(5); // Kraftwerk: 24 candidates ≈ 120 ops
    expect(canPlaceCost(8, 8)).toBe(20); // Fabrik: 24 candidates ≈ 480 ops
    expect(canPlaceCost(1, 1)).toBe(5);
    expect(canPlaceCost(6, 6)).toBe(13);
  });

  it('take is all-or-nothing', () => {
    const b = new FixedBudget(10);
    expect(b.take(6)).toBe(true);
    expect(b.take(5)).toBe(false);
    expect(b.used).toBe(6);
    expect(b.left).toBe(4);
    expect(b.take(4)).toBe(true);
    expect(b.take(1)).toBe(false);
    b.charge(3);
    expect(b.left).toBe(-3);
  });

  it('allotments per manager, unused budget falls to the reserve of the same think', () => {
    const spec = PROFILES.normal.budget;
    const tb = new ThinkBudget(spec);
    expect(tb.total).toBe(24000);
    const intel = tb.open('intel');
    expect(intel.left).toBe(7000);
    expect(intel.take(2000)).toBe(true);
    tb.close();
    expect(tb.reserve.left).toBe(1500 + 5000);
    const opening = tb.open('reserve');
    expect(opening.take(500)).toBe(true);
    tb.close();
    const eco = tb.open('economy');
    expect(eco.take(2001)).toBe(false);
    expect(eco.take(2000)).toBe(true);
    tb.close();
    expect(tb.reserve.left).toBe(6000);
    tb.chargeIngest(123);
    expect(tb.opsByKey()).toEqual({ intel: 2000, economy: 2000, reserve: 500, ingest: 123 });
    expect(tb.usedTotal).toBe(4500);
    expect(() => {
      tb.open('tech');
      tb.open('factory');
    }).toThrow(/still open/);
  });

  it('no carry-over between thinks and scaling (AI-DET-02 halves every allotment)', () => {
    const a = new ThinkBudget(PROFILES.easy.budget);
    const x = a.open('platoon');
    x.take(1);
    a.close();
    const b = new ThinkBudget(PROFILES.easy.budget);
    expect(b.open('platoon').left).toBe(2500);
    b.close();
    const half = new ThinkBudget(PROFILES.hard.budget, 0.5);
    expect(half.total).toBe(20000);
    expect(half.open('intel').left).toBe(6000);
    half.close();
    expect(half.reserve.left).toBe(1250 + 6000);
  });

  it('profile budgets add up to the totals of ai.md §2.3', () => {
    for (const d of ['easy', 'normal', 'hard'] as const) {
      const b = PROFILES[d].budget;
      expect(b.intel + b.platoon + b.engineer + b.economy + b.defense + b.factory + b.tech + b.reserve).toBe(b.total);
    }
  });
});

describe('rng (ai.md §2.5)', () => {
  it('xorshift32 (13, 17, 5) reference vector for seed 1', () => {
    const r = new Xorshift32(1);
    expect([r.nextU32(), r.nextU32(), r.nextU32(), r.nextU32(), r.nextU32()]).toEqual([
      270369, 67634689, 2647435461, 307599695, 2398689233,
    ]);
    expect(new Xorshift32(0).state).not.toBe(0);
  });

  it('base seed = rng32(gameSeed, 0, army, 0x41490000); manager streams are independent', () => {
    expect(aiBaseSeed(7, 1)).toBe(rng32(7, 0, 1, 0x41490000));
    const a = managerRng(7, 0, 'economy');
    const b = managerRng(7, 0, 'factory');
    const a2 = managerRng(7, 0, 'economy');
    const sa = Array.from({ length: 8 }, () => a.nextU32());
    const sb = Array.from({ length: 8 }, () => b.nextU32());
    expect(Array.from({ length: 8 }, () => a2.nextU32())).toEqual(sa);
    expect(sa).not.toEqual(sb);
    // Consuming one stream does not shift another.
    const f1 = managerRng(7, 0, 'factory');
    const e1 = managerRng(7, 0, 'economy');
    for (let i = 0; i < 100; i++) e1.nextU32();
    expect(f1.nextU32()).toBe(sb[0]);
    expect(managerRng(7, 1, 'economy').nextU32()).not.toBe(sa[0]);
    expect(managerRng(8, 0, 'economy').nextU32()).not.toBe(sa[0]);
  });

  it('nextInt/nextFloat/chance ranges', () => {
    const r = new Xorshift32(99);
    for (let i = 0; i < 1000; i++) {
      const v = r.nextInt(3);
      expect(v >= 0 && v < 3).toBe(true);
      const f = r.nextFloat();
      expect(f >= 0 && f < 1).toBe(true);
    }
    expect(r.chance(0)).toBe(false);
    expect(r.chance(1)).toBe(true);
    expect(() => r.nextInt(0)).toThrow();
  });

  it('decay LUT by multiplication, toFxRaw range check', () => {
    expect(DECAY_LUT[0]).toBe(1);
    expect(DECAY_LUT[1]).toBe(0.95);
    let v = 1;
    for (let s = 0; s < 14; s++) v *= 0.95;
    expect(DECAY_LUT[14]).toBe(v);
    expect(decayFactor(13.9)).toBe(DECAY_LUT[13]);
    expect(decayFactor(-1)).toBe(1);
    expect(decayFactor(601)).toBe(0);
    // half-life ≈ 13.5 s (ai.md §5.6)
    expect(DECAY_LUT[13]!).toBeGreaterThan(0.5);
    expect(DECAY_LUT[14]!).toBeLessThan(0.5);
    expect(toFxRaw(1.5)).toBe(6144);
    expect(() => toFxRaw(1e7)).toThrow(RangeError);
    expect(() => toFxRaw(Number.NaN)).toThrow(RangeError);
  });
});

describe('profiles (ai.md §2.1, §2.3, §2.4, §6)', () => {
  const doc = loadOpenings();
  const P = (d: Difficulty) => profileFor(d, doc);

  it('timing, reaction delay, APM', () => {
    expect([P('easy').thinkEvery, P('normal').thinkEvery, P('hard').thinkEvery]).toEqual([10, 5, 5]);
    expect([P('easy').microEvery, P('normal').microEvery, P('hard').microEvery]).toEqual([null, null, 2]);
    expect([P('easy').lead, P('normal').lead, P('hard').lead]).toEqual([3, 3, 3]);
    expect([P('easy').reactionDelayTicks, P('normal').reactionDelayTicks, P('hard').reactionDelayTicks]).toEqual([20, 5, 0]);
    expect([P('easy').apm, P('normal').apm, P('hard').apm]).toEqual([
      { cap: 40, burst: 10, p0Overdraft: 5 },
      { cap: 120, burst: 20, p0Overdraft: 5 },
      { cap: 300, burst: 40, p0Overdraft: 5 },
    ]);
  });

  it('budgets per manager', () => {
    expect(P('easy').budget).toEqual({
      total: 12000, intel: 4000, platoon: 2500, engineer: 2500, economy: 1000, defense: 800, factory: 500, tech: 200, reserve: 500, micro: 0,
    });
    expect(P('normal').budget).toEqual({
      total: 24000, intel: 7000, platoon: 5000, engineer: 5000, economy: 2000, defense: 2000, factory: 1000, tech: 500, reserve: 1500, micro: 0,
    });
    expect(P('hard').budget).toEqual({
      total: 40000, intel: 12000, platoon: 9000, engineer: 8000, economy: 3000, defense: 3500, factory: 1500, tech: 500, reserve: 2500, micro: 8000,
    });
  });

  it('difficulty table §6', () => {
    const e = P('easy');
    const n = P('normal');
    const h = P('hard');
    expect([e.errorRate, e.errorTopK, n.errorRate, n.errorTopK, h.errorRate]).toEqual([0.15, 3, 0.05, 2, 0]);
    expect([e.horizonS, n.horizonS, h.horizonS]).toEqual([10, null, 60]);
    expect(horizonFor(n, 30)).toBe(30);
    expect(horizonFor(h, 30)).toBe(60);
    expect([e.attackRatio, n.attackRatio, h.attackRatio]).toEqual([1.5, 1.2, 1.0]);
    for (const p of [e, n, h]) {
      expect(p.retreatRatio).toBe(0.7);
      expect(p.reentryRatio).toBe(1.0);
      expect(p.reentryHpFrac).toBe(0.6);
    }
    expect([e.raids, n.raids, h.raids]).toEqual([
      { count: 0, fromS: 0 },
      { count: 1, fromS: 360 },
      { count: 2, fromS: 240 },
    ]);
    expect([e.counterMode, n.counterMode, h.counterMode]).toEqual(['off', 'nextMix', 'immediatePredict']);
    expect(e.openingFilter).toEqual(['eco_standard']);
    expect(n.openingFilter).toBeNull();
    expect(e.firstWave).toBe(12);
    expect(firstWaveFor(e, 8)).toBe(12);
    expect(firstWaveFor(n, 8)).toBe(8);
    expect(e.oneHzEveryThink).toBe(true);
    expect(n.oneHzEveryThink).toBe(false);
  });

  it('difficultyTiming comes from ai-openings.json', () => {
    expect(P('easy').timing).toEqual(doc.difficultyTiming.easy);
    expect(P('easy').timing.waveExtra).toBe(4);
    expect(P('normal').timing.stepDelayS).toBe(0.5);
    expect(P('hard').timing.techDelayS).toBe(0);
  });
});
