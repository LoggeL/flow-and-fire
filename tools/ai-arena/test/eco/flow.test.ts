import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  FlowEconomy,
  advanceDone,
  buildRatePerTick,
  cumulativeCharge,
  ecoReport,
  toMilli,
  type EcoArmyStats,
} from '../../src/eco/index.ts';

/** One tick in which every consumer takes exactly what it was granted. */
function tickGranted(
  eco: FlowEconomy,
  setup: (e: FlowEconomy) => void,
  consumers: readonly { id: number; army: number; m: number; e: number; bp?: number }[],
): void {
  eco.beginTick();
  setup(eco);
  for (const c of consumers) eco.request(c.army, c.id, c.m, c.e, c.bp ?? 0);
  eco.resolve();
  for (const c of consumers) eco.chargeGranted(c.id);
  eco.endTick();
}

describe('FlowEconomy basics', () => {
  it('validates army count and ids', () => {
    expect(() => new FlowEconomy(0)).toThrow(RangeError);
    expect(() => new FlowEconomy(17)).toThrow(RangeError);
    const eco = new FlowEconomy(16);
    expect(() => eco.setCapacity(16, 1, 1)).toThrow(RangeError);
    expect(eco.armies).toBe(16);
  });

  it('enforces the tick protocol', () => {
    const eco = new FlowEconomy(2);
    expect(() => eco.request(0, 1, 1, 1)).toThrow(/phase/);
    expect(() => eco.resolve()).toThrow(/phase/);
    eco.beginTick();
    expect(() => eco.beginTick()).toThrow(/phase/);
    eco.request(0, 1, 1, 1);
    expect(() => eco.request(1, 1, 1, 1)).toThrow(/twice/);
    expect(() => eco.request(0, 2, -1, 0)).toThrow(RangeError);
    expect(() => eco.charge(0, 1, 1)).toThrow(/phase/);
    eco.resolve();
    expect(() => eco.addIncome(0, 1, 1)).toThrow(/phase/);
    expect(() => eco.charge(0, 0.5, 0)).toThrow(RangeError);
    expect(() => eco.grantedMassMilli(99)).toThrow(/no request/);
    eco.endTick();
    expect(eco.tick).toBe(0);
  });

  it('income without demand fills the store; income carry is exact over time', () => {
    const eco = new FlowEconomy(1);
    eco.setCapacity(0, 1000, 10000);
    // 0.35 M/s = 3.5 milli... per tick is 35 milli: exact; 0.0123 M/s needs the carry.
    for (let t = 0; t < 1000; t++) tickGranted(eco, (e) => e.addIncome(0, 0.35 + 0.0123, 7.77), []);
    const s = eco.statsOf(0);
    expect(s.incomeMassMilli).toBe(toMilli((0.35 + 0.0123) * 100));
    expect(s.incomeEnergyMilli).toBe(toMilli(7.77 * 100));
    expect(eco.massStoredMilli(0)).toBe(s.incomeMassMilli);
    expect(eco.energyStoredMilli(0)).toBe(s.incomeEnergyMilli);
    expect(eco.ratio(0)).toBe(1);
  });
});

describe('stall ratio', () => {
  it('mass-limited: r = available mass / mass demand, energy ratio stays 1', () => {
    const eco = new FlowEconomy(1);
    eco.setCapacity(0, 650, 3900);
    eco.setStored(0, 0, 3000);
    eco.beginTick();
    eco.addIncome(0, 2, 20); // 200 mM and 2000 mE per tick
    eco.request(0, 7, 1, 10, 10); // wants 1000 mM, 10000 mE
    eco.resolve();
    // One milli of reserve per active consumer (floor accounting): (200 − 1) / 1000.
    expect(eco.massRatio(0)).toBeCloseTo(0.199, 12);
    expect(eco.energyRatio(0)).toBe(1);
    expect(eco.ratio(0)).toBeCloseTo(0.199, 12);
    expect(eco.grantedMassMilli(7)).toBe(199);
    expect(eco.grantedEnergyMilli(7)).toBe(1990);
    eco.chargeGranted(7);
    eco.endTick();
    const st = eco.statsOf(0);
    expect(st.massStallTicks).toBe(1);
    expect(st.energyStallTicks).toBe(0);
    expect(st.bpSeconds).toBeCloseTo(1, 12);
    expect(st.bpSecondsMassStalled).toBeCloseTo(0.801, 12);
    expect(eco.massStoredMilli(0)).toBe(1);
    expect(eco.energyStoredMilli(0)).toBe(3_000_000 + 2000 - 1990);
    expect(ecoReport(st).massBpStallPct).toBeCloseTo(80.1, 9);
  });

  it('energy-limited: r = available energy / energy demand and the tick counts as energy stall', () => {
    const eco = new FlowEconomy(2);
    eco.setCapacity(1, 650, 3900);
    eco.setStored(1, 650, 0);
    eco.beginTick();
    eco.addIncome(1, 1, 5); // 500 mE per tick
    eco.request(1, 1, 0.5, 5, 5); // 5000 mE per tick
    eco.request(1, 2, 0.5, 5, 5);
    eco.resolve();
    expect(eco.energyRatio(1)).toBeCloseTo((500 - 2) / 10000, 12);
    expect(eco.massRatio(1)).toBe(1);
    expect(eco.ratio(1)).toBe(eco.energyRatio(1));
    expect(eco.ratio(0)).toBe(1); // untouched army
    eco.chargeGranted(1);
    eco.chargeGranted(2);
    eco.endTick();
    const st = eco.statsOf(1);
    expect(st.energyStallTicks).toBe(1);
    expect(st.energyDemandTicks).toBe(1);
    expect(st.bpSecondsMassStalled).toBe(0);
    expect(st.shortfallEnergyMilli).toBe(0);
    expect(eco.energyStoredMilli(1)).toBeGreaterThanOrEqual(0);
    expect(ecoReport(st).energyStallPct).toBe(100);
  });

  it('upkeep that exceeds the energy stock drives the ratio to 0 and is counted as unpaid', () => {
    const eco = new FlowEconomy(1);
    eco.setCapacity(0, 650, 3900);
    eco.setStored(0, 650, 10);
    eco.beginTick();
    eco.addUpkeep(0, 200); // 20 E per tick > 10 E stock
    eco.request(0, 1, 1, 1);
    eco.resolve();
    expect(eco.energyRatio(0)).toBe(0);
    expect(eco.ratio(0)).toBe(0);
    expect(eco.grantedEnergyMilli(1)).toBe(0);
    eco.chargeGranted(1);
    eco.endTick();
    expect(eco.energyStoredMilli(0)).toBe(0);
    const st = eco.statsOf(0);
    expect(st.upkeepUnpaidMilli).toBe(10_000);
    expect(st.upkeepEnergyMilli).toBe(20_000);
    expect(st.energyStallTicks).toBe(1);
  });

  it('upkeep partially eating the stock gives 0 < r < 1', () => {
    const eco = new FlowEconomy(1);
    eco.setCapacity(0, 650, 3900);
    eco.setStored(0, 650, 30);
    eco.beginTick();
    eco.addIncome(0, 0, 50); // +5 E per tick
    eco.addUpkeep(0, 150); // −15 E per tick → 20 E available
    eco.request(0, 1, 0, 40);
    eco.resolve();
    expect(eco.energyRatio(0)).toBeCloseTo((20_000 - 1) / 40_000, 12);
    expect(eco.ratio(0)).toBeGreaterThan(0);
    expect(eco.ratio(0)).toBeLessThan(1);
    eco.chargeGranted(1);
    eco.endTick();
    expect(eco.statsOf(0).upkeepUnpaidMilli).toBe(0);
  });

  it('exempt window keeps stall ticks out of the metric', () => {
    const eco = new FlowEconomy(1);
    eco.setCapacity(0, 0, 0);
    eco.exemptEnergyStallUntil(0, 4);
    for (let t = 0; t < 10; t++) tickGranted(eco, () => undefined, [{ id: 1, army: 0, m: 0, e: 1 }]);
    const st = eco.statsOf(0);
    expect(st.exemptTicks).toBe(5);
    expect(st.energyStallTicks).toBe(5);
    expect(ecoReport(st).energyStallPct).toBe(100);
  });
});

describe('storage limits', () => {
  it('overflow counts mass lost to a full store', () => {
    const eco = new FlowEconomy(1);
    eco.setCapacity(0, 100, 100);
    eco.setStored(0, 100, 95);
    for (let t = 0; t < 10; t++) tickGranted(eco, (e) => e.addIncome(0, 10, 10), []);
    const st = eco.statsOf(0);
    expect(st.overflowMassMilli).toBe(10_000);
    expect(eco.massStoredMilli(0)).toBe(100_000);
    // Energy: 5 E room, 10 × 1 E income → 5 E overflow.
    expect(st.overflowEnergyMilli).toBe(5_000);
    expect(eco.energyStoredMilli(0)).toBe(100_000);
    expect(ecoReport(st).overflowPct).toBe(100);
  });

  it('capacity changes apply at the end of the tick', () => {
    const eco = new FlowEconomy(1);
    eco.setCapacity(0, 100, 100);
    eco.setStored(0, 100, 0);
    eco.beginTick();
    eco.addIncome(0, 10, 0);
    eco.resolve();
    eco.addCapacity(0, 500, 0); // storage completed in the construction phase
    eco.endTick();
    expect(eco.massStoredMilli(0)).toBe(101_000);
    expect(eco.statsOf(0).overflowMassMilli).toBe(0);
    eco.addCapacity(0, -1000, 0);
    expect(eco.massCapacityMilli(0)).toBe(0);
  });
});

interface ConsumerSpec {
  readonly army: number;
  readonly m: number;
  readonly e: number;
  readonly bp: number;
}

function runOrder(
  armies: number,
  stock: readonly [number, number][],
  income: readonly [number, number][],
  consumers: readonly ConsumerSpec[],
  order: readonly number[],
): { ratios: number[]; granted: [number, number][]; stats: EcoArmyStats[]; stored: [number, number][] } {
  const eco = new FlowEconomy(armies);
  for (let a = 0; a < armies; a++) {
    eco.setCapacity(a, 5000, 50000);
    const s = stock[a] ?? [0, 0];
    eco.setStored(a, s[0], s[1]);
  }
  eco.beginTick();
  for (let a = 0; a < armies; a++) {
    const inc = income[a] ?? [0, 0];
    eco.addIncome(a, inc[0], inc[1]);
  }
  for (const i of order) {
    const c = consumers[i] as ConsumerSpec;
    eco.request(c.army, 1000 + i, c.m, c.e, c.bp);
  }
  eco.resolve();
  const granted: [number, number][] = consumers.map((_, i) => [eco.grantedMassMilli(1000 + i), eco.grantedEnergyMilli(1000 + i)]);
  for (const i of order) eco.chargeGranted(1000 + i);
  eco.endTick();
  const ratios: number[] = [];
  const stats: EcoArmyStats[] = [];
  const stored: [number, number][] = [];
  for (let a = 0; a < armies; a++) {
    ratios.push(eco.ratio(a));
    stats.push(eco.statsOf(a));
    stored.push([eco.massStoredMilli(a), eco.energyStoredMilli(a)]);
  }
  return { ratios, granted, stats, stored };
}

describe('order independence (property)', () => {
  it('ratio, grants and stocks do not depend on the order of requests', () => {
    const armies = 4;
    const amount = fc.double({ min: 0, max: 50, noNaN: true, noDefaultInfinity: true });
    const consumerArb = fc.record({
      army: fc.integer({ min: 0, max: armies - 1 }),
      m: amount,
      e: fc.double({ min: 0, max: 500, noNaN: true, noDefaultInfinity: true }),
      bp: fc.integer({ min: 0, max: 60 }),
    });
    const pair = (maxM: number, maxE: number): fc.Arbitrary<[number, number]> =>
      fc.tuple(fc.double({ min: 0, max: maxM, noNaN: true, noDefaultInfinity: true }), fc.double({ min: 0, max: maxE, noNaN: true, noDefaultInfinity: true }));
    const arb = fc
      .record({
        consumers: fc.array(consumerArb, { minLength: 1, maxLength: 24 }),
        stock: fc.array(pair(5000, 50000), { minLength: armies, maxLength: armies }),
        income: fc.array(pair(100, 1000), { minLength: armies, maxLength: armies }),
      })
      .chain((r) => {
        const idx = r.consumers.map((_, i) => i);
        return fc.record({ base: fc.constant(r), order: fc.shuffledSubarray(idx, { minLength: idx.length, maxLength: idx.length }) });
      });
    fc.assert(
      fc.property(arb, ({ base, order }) => {
        const identity = base.consumers.map((_, i) => i);
        const a = runOrder(armies, base.stock, base.income, base.consumers, identity);
        const b = runOrder(armies, base.stock, base.income, base.consumers, order);
        expect(b.ratios).toEqual(a.ratios);
        expect(b.granted).toEqual(a.granted);
        expect(b.stored).toEqual(a.stored);
        expect(b.stats).toEqual(a.stats);
        for (const s of a.stats) {
          expect(s.shortfallMassMilli).toBe(0);
          expect(s.shortfallEnergyMilli).toBe(0);
        }
        for (const r of a.ratios) {
          expect(r).toBeGreaterThanOrEqual(0);
          expect(r).toBeLessThanOrEqual(1);
        }
      }),
      { numRuns: 300, seed: 0x5eed },
    );
  });
});

interface Build {
  readonly id: number;
  readonly costM: number;
  readonly costE: number;
  readonly buildTime: number;
  readonly bp: number;
}

/** Runs builds to completion under flow eco; returns per-build mass/energy actually charged. */
function runBuilds(builds: readonly Build[], incomeM: number, incomeE: number, stockM: number, stockE: number, maxTicks = 200_000) {
  const eco = new FlowEconomy(1);
  eco.setCapacity(0, 650, 3900);
  eco.setStored(0, stockM, stockE);
  const done = builds.map(() => 0);
  const paidM = builds.map(() => 0);
  const paidE = builds.map(() => 0);
  const costMilliM = builds.map((b) => toMilli(b.costM));
  const costMilliE = builds.map((b) => toMilli(b.costE));
  let ticks = 0;
  while (done.some((d) => d < 1)) {
    if (ticks++ > maxTicks) throw new Error('builds did not finish');
    eco.beginTick();
    eco.addIncome(0, incomeM, incomeE);
    builds.forEach((b, i) => {
      if ((done[i] as number) >= 1) return;
      const rate = buildRatePerTick(b.buildTime, b.bp);
      eco.request(0, b.id, b.costM * rate, b.costE * rate, b.bp);
    });
    eco.resolve();
    const r = eco.ratio(0);
    builds.forEach((b, i) => {
      const old = done[i] as number;
      if (old >= 1) return;
      const nw = advanceDone(old, buildRatePerTick(b.buildTime, b.bp) * r);
      const cm = cumulativeCharge(costMilliM[i] as number, old, nw);
      const ce = cumulativeCharge(costMilliE[i] as number, old, nw);
      eco.charge(0, cm, ce);
      paidM[i] = (paidM[i] as number) + cm;
      paidE[i] = (paidE[i] as number) + ce;
      done[i] = nw;
    });
    eco.endTick();
  }
  return { eco, paidM, paidE, costMilliM, costMilliE, ticks };
}

describe('cumulative accounting', () => {
  it('cumulativeCharge telescopes and rejects going backwards', () => {
    expect(cumulativeCharge(52_300, 0, 1)).toBe(52_300);
    expect(cumulativeCharge(52_300, 0.25, 0.5) + cumulativeCharge(52_300, 0, 0.25) + cumulativeCharge(52_300, 0.5, 1)).toBe(52_300);
    expect(() => cumulativeCharge(10, 0.5, 0.4)).toThrow(RangeError);
    expect(advanceDone(0.9999999999, 0)).toBe(1);
    expect(advanceDone(0.5, 0.25)).toBe(0.75);
  });

  it('a pgen built by the commander under a mass stall costs exactly its price', () => {
    // Glutkessel-like numbers: 75 M / 750 E, buildTime 125 s-BP, commander BP 10; starved income.
    const r = runBuilds([{ id: 1, costM: 75, costE: 750, buildTime: 125, bp: 10 }], 1, 20, 0, 0);
    expect(r.paidM[0]).toBe(75_000);
    expect(r.paidE[0]).toBe(750_000);
    const st = r.eco.statsOf(0);
    expect(st.consumedMassMilli).toBe(75_000);
    expect(st.consumedEnergyMilli).toBe(750_000);
    expect(st.shortfallMassMilli).toBe(0);
    expect(st.shortfallEnergyMilli).toBe(0);
    expect(st.massStallTicks).toBeGreaterThan(0);
  });

  it('property: every build costs exactly cost, stocks never go negative', () => {
    const buildArb = fc.record({
      costM: fc.double({ min: 1, max: 3000, noNaN: true, noDefaultInfinity: true }),
      costE: fc.double({ min: 0, max: 30000, noNaN: true, noDefaultInfinity: true }),
      buildTime: fc.integer({ min: 10, max: 5000 }),
      bp: fc.constantFrom(5, 10, 12.5, 20, 45, 60),
    });
    fc.assert(
      fc.property(
        fc.array(buildArb, { minLength: 1, maxLength: 5 }),
        fc.double({ min: 0.5, max: 60, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 5, max: 600, noNaN: true, noDefaultInfinity: true }),
        fc.integer({ min: 0, max: 650 }),
        (specs, incM, incE, stockM) => {
          const builds = specs.map((b, i) => ({ id: i + 1, ...b }));
          const r = runBuilds(builds, incM, incE, stockM, 3900);
          builds.forEach((_, i) => {
            expect(r.paidM[i]).toBe(r.costMilliM[i]);
            expect(r.paidE[i]).toBe(r.costMilliE[i]);
          });
          const st = r.eco.statsOf(0);
          expect(st.shortfallMassMilli).toBe(0);
          expect(st.shortfallEnergyMilli).toBe(0);
          expect(st.consumedMassMilli).toBe(r.costMilliM.reduce((a, b) => a + b, 0));
        },
      ),
      { numRuns: 60, seed: 0xc057 },
    );
  });
});

describe('determinism', () => {
  it('two identical runs yield identical stocks, ratios and statistics', () => {
    const run = (): string => {
      const eco = new FlowEconomy(3);
      for (let a = 0; a < 3; a++) {
        eco.setCapacity(a, 650, 3900);
        eco.setStored(a, 650, 3900);
      }
      const trail: number[] = [];
      let seed = 12345;
      const next = (): number => {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        return (seed >>> 0) / 4294967296;
      };
      for (let t = 0; t < 3000; t++) {
        eco.beginTick();
        const ids: number[] = [];
        for (let a = 0; a < 3; a++) {
          eco.addIncome(a, 1 + a * 2 + next() * 3, 20 + next() * 40);
          eco.addUpkeep(a, next() * 10);
          const n = 1 + Math.floor(next() * 4);
          for (let c = 0; c < n; c++) {
            eco.request(a, a * 100 + c, next() * 2, next() * 20, 10);
            ids.push(a * 100 + c);
          }
        }
        eco.resolve();
        for (let a = 0; a < 3; a++) trail.push(eco.ratio(a));
        for (const id of ids) eco.chargeGranted(id);
        eco.endTick();
        for (let a = 0; a < 3; a++) trail.push(eco.massStoredMilli(a), eco.energyStoredMilli(a));
      }
      const stats = [0, 1, 2].map((a) => eco.statsOf(a));
      return JSON.stringify({ trail, stats, snap: eco.snapshot(1) });
    };
    const a = run();
    const b = run();
    expect(b).toBe(a);
  });

  it('snapshot reports rates per second and stocks in units', () => {
    const eco = new FlowEconomy(1);
    eco.setCapacity(0, 650, 3900);
    eco.setStored(0, 100, 1000);
    eco.beginTick();
    eco.addIncome(0, 3, 40);
    eco.addUpkeep(0, 5);
    eco.request(0, 1, 0.5, 4);
    eco.resolve();
    const s = eco.snapshot(0);
    expect(s.massIncome).toBe(3);
    expect(s.energyIncome).toBe(40);
    expect(s.energyUpkeep).toBe(5);
    expect(s.massDemand).toBe(5);
    expect(s.energyDemand).toBe(40);
    expect(s.massCapacity).toBe(650);
    expect(s.ratio).toBe(1);
    eco.chargeGranted(1);
    eco.endTick();
    expect(eco.snapshot(0).massStored).toBeCloseTo(100 + 0.3 - 0.5, 12);
  });
});
