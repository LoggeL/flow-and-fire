/**
 * EconomyManager in the arena (ai.md §5.1, §9): AI-ECO-01 (energy balance), AI-ECO-02 (mass sinks),
 * AI-ECO-04 (energy first), AI-ECO-05 (saturation).
 */
import { describe, expect, it } from 'vitest';
import { energyFree } from '@faf/ai';
import type { ScenarioRuntime } from '../../src/scenarios/index.ts';
import { dist, openingRun, sec } from './support.ts';

/** Energy stall ticks of army 0 between observer calls (energy ratio < 1 with demand). */
class StallCounter {
  ticks = 0;
  observe(rt: ScenarioRuntime): void {
    const e = rt.world.ecoOf(0);
    if (e.energyDemand > 0 && e.energyRatio < 1) this.ticks++;
  }
}

describe('AI-ECO-01: test consumer +100 E/s', () => {
  // 11:00 on Setons: base with T2 engineers. Earlier (4–9 min) only 1–3 builders stand in the base and a
  // sustained +100 E/s deficit on top of the growth stalls 18–57 s (documented in the fragment).
  it('power plants ordered within 2 economy runs (2 s); energy stall < 3 s', () => {
    const t0 = sec(660);
    const stall = new StallCounter();
    let firstPower = -1;
    const before = new Set<number>();
    const r = openingRun('setons', 'eco_standard', 780, {
      keepEnemyAlive: true,
      cheats: [
        {
          tick: t0,
          run: (rt) => {
            // +100 E/s beyond the current surplus (the base at 5:00 has ~160 E/s spare; a consumer it
            // covers needs no power plant).
            const e = rt.world.ecoOf(0);
            const surplus = Math.max(0, e.energyIncome - e.energyUpkeep - e.energyDemand * e.massRatio);
            for (const t of rt.brain(0).blackboard.taskBoard.filter((x) => x.role === 'pgen' || x.role === 'hydro')) before.add(t.id);
            rt.world.addDemand(0, 0, surplus + 100);
          },
        },
      ],
      observe: [
        {
          tick: t0,
          every: 1,
          run: (rt, t) => {
            stall.observe(rt);
            if (firstPower >= 0) return;
            const bb = rt.brain(0).blackboard;
            const fresh = bb.taskBoard.filter((x) => (x.role === 'pgen' || x.role === 'hydro') && x.prio >= 90 && !before.has(x.id));
            if (fresh.length > 0) firstPower = t;
          },
        },
      ],
    });
    expect(r.world.cheatLog.length).toBeGreaterThan(0);
    expect(firstPower, 'power task ordered').toBeGreaterThanOrEqual(t0);
    expect(firstPower - t0).toBeLessThanOrEqual(sec(2) + r.brain(0).profile.lead + r.brain(0).profile.thinkEvery);
    expect(stall.ticks, `stall ticks ${stall.ticks}`).toBeLessThan(sec(3));
  });
});

describe('AI-ECO-02: mass storage full for 20 s (cheat +30 M/s)', () => {
  it('sinks in table order (mex upgrade, factory, engineer); energy reservation booked', () => {
    const t0 = sec(520);
    let reservedSeen = 0;
    const before: number[] = [];
    const r = openingRun('setons', 'eco_standard', 600, {
      cheats: [
        {
          tick: t0,
          run: (rt) => {
            const e = rt.world.ecoOf(0);
            rt.world.setStorage(0, e.massCapacity, e.energyCapacity);
            rt.world.addIncome(0, 30, 0);
            before.push(...rt.brain(0).blackboard.taskBoard.filter((x) => x.role === 'fac_land').map((x) => x.id));
          },
        },
      ],
      observe: [
        {
          tick: t0,
          every: 5,
          run: (rt) => {
            reservedSeen = Math.max(reservedSeen, rt.brain(0).blackboard.eco.reservedE);
          },
        },
      ],
    });
    const bb = r.brain(0).blackboard;
    const ups = r.telemetry(0).filter((e) => e.kind === 'mexUpgradeStart' && e.tick >= t0);
    const facTicks = bb.eco.sinks.filter((k) => k.kind === 'factory' && k.tick >= t0).map((k) => k.tick);
    for (const u of r.world.unitsOf(0)) if (u.alive && u.info.isFactory && u.createdTick >= t0) facTicks.push(u.createdTick);
    expect(ups.length, 'mex upgrade as sink').toBeGreaterThanOrEqual(1);
    expect(facTicks.length + bb.telemetry.count('mexUpgradeStart'), 'sinks').toBeGreaterThanOrEqual(2);
    // Table order: once the storage has been full for forS, the first sink run starts with a mex upgrade
    // (a factory of the same run comes after it, in the same tick).
    const forS = r.brain(0).opening!.followUp.extraFactory.forS;
    const firstUp = ups[0]!.tick;
    expect(firstUp - t0).toBeLessThanOrEqual(sec(forS + 3));
    const earlierFac = facTicks.filter((t) => t >= t0 + sec(forS) && t < firstUp);
    expect(earlierFac, 'factory before the mex upgrade').toEqual([]);
    expect(reservedSeen, 'R_E booked').toBeGreaterThan(0);
  });
});

describe('AI-ECO-04: energy first (Setons 10:00, mass for five mex upgrades, E_free ≈ 100 E/s)', () => {
  it('at most one upgrade starts, power is ordered before the next, no energy stall for 120 s', () => {
    const t0 = sec(600);
    const stall = new StallCounter();
    let powerAfter = -1;
    const eFreeAt = new Map<number, number>();
    let lastEFree = Number.NaN;
    const r = openingRun('setons', 'eco_standard', 720, {
      cheats: [
        {
          tick: t0,
          run: (rt) => {
            const e = rt.world.ecoOf(0);
            const net = e.energyIncome - e.energyUpkeep - e.energyDemand * e.massRatio;
            // E_free = net + (S_E − reserveE)/90 = 100 (reserveE 600, R_E ignored)
            const s = Math.min(e.energyCapacity, 600 + 90 * Math.max(0, 100 - net));
            rt.world.setStorage(0, e.massCapacity, s);
            rt.world.addIncome(0, 60, 0);
          },
        },
      ],
      observe: [
        {
          tick: t0,
          every: 1,
          run: (rt, t) => {
            stall.observe(rt);
            const bb = rt.brain(0).blackboard;
            // E_free the AI saw in the think of tick t (perception of t, R_E before that think).
            eFreeAt.set(t, lastEFree);
            const e = rt.world.ecoOf(0);
            lastEFree = energyFree(e, bb.eco.reservedE, 600);
            if (powerAfter >= 0) return;
            if (bb.taskBoard.filter((x) => (x.role === 'pgen' || x.role === 'hydro') && x.createdTick >= t0).length > 0) powerAfter = t;
          },
        },
      ],
    });
    const ups = r.telemetry(0).filter((e) => e.kind === 'mexUpgradeStart' && e.tick >= t0);
    // At most one upgrade in the first economy runs; every further one only with E_free ≥ 60 E/s at
    // its start (power ordered or finished in between).
    expect(ups.filter((e) => e.tick < t0 + sec(2)).length).toBeLessThanOrEqual(1);
    for (const u of ups.slice(1)) {
      const ef = eFreeAt.get(u.tick);
      expect(ef, `E_free at ${u.tick}`).toBeDefined();
      expect(ef!, `E_free at the start of upgrade ${u.tick}`).toBeGreaterThanOrEqual(60 - 1e-6);
    }
    expect(powerAfter, 'power ordered').toBeGreaterThanOrEqual(t0);
    // "kein Energie-Engpass": at most one arena tick of ratio < 1 (tick granularity of the flow model).
    expect(stall.ticks, `stall ticks ${stall.ticks}`).toBeLessThanOrEqual(1);
  });
});

describe('AI-ECO-05: saturation (Hollow Ridge, all own spots taken)', () => {
  it('ring mex upgrade ≤ 2 s after 4:00; at most one mex upgrade parallel to the tech upgrade', () => {
    let maxParallelDuringTech = 0;
    const r = openingRun('hollow-ridge', 'eco_standard', 520, {
      observe: [
        {
          every: 5,
          run: (rt) => {
            const w = rt.world;
            const teching = w.unitsOf(0).some((u) => u.alive && u.info.isFactory && u.upgradeBp >= 0);
            if (!teching) return;
            const n = w.unitsOf(0).filter((u) => u.alive && u.info.isMex && u.upgradeBp >= 0).length;
            maxParallelDuringTech = Math.max(maxParallelDuringTech, n);
          },
        },
      ],
    });
    const a = r.brain(0).analysis;
    const first = r.first(0, 'mexUpgradeStart');
    expect(first).toBeDefined();
    // saturatedS = 240 s (eco_standard); own zone full on Hollow Ridge since ~2:40.
    expect(first!.tick).toBeGreaterThanOrEqual(sec(240));
    expect(first!.tick - sec(240)).toBeLessThanOrEqual(sec(2));
    const u = r.world.unit(first!.unit);
    expect(u).not.toBeNull();
    const ringDist = Math.min(...a.ringSpots.map((i) => dist(u!.x, u!.z, r.world.baseStatic.spots[i]!.x, r.world.baseStatic.spots[i]!.z)));
    expect(ringDist, 'nearest ring mex').toBeLessThanOrEqual(1);
    expect(r.first(0, 'techStart')).toBeDefined();
    expect(maxParallelDuringTech).toBeLessThanOrEqual(1);
  });
});
