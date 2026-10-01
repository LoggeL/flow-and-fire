import { describe, expect, it } from 'vitest';
import { createBrain, economyManager, engineerManager, type ManagerFactory } from '@faf/ai';
import { Op } from '@faf/protocol';
import { createScenario } from '../../src/scenarios/index.ts';
import { runMatch } from '../../src/match/index.ts';

function fixture(map: string, tick: number, opening = 'eco_standard', managers: readonly ManagerFactory[] = [economyManager, engineerManager]) {
  const brain = createBrain({ managers });
  const c = createScenario({ map, seed: 7, until: tick + 1200,
    sides: [{ army: 0, profile: 'normal', opening, brain }] });
  const w = c.world;
  const start = brain.analysis.ownStart;
  const bp = (category: string, tech = 1) => w.setup.bps.list.find((b) =>
    b.tech === tech && b.categoryNames.includes(category) &&
    (category !== 'FACTORY' || b.categoryNames.includes('LAND')))!;
  // Keep unrelated expansion and hydro construction out of the controlled energy experiment.
  // These reservations are setup state, not information hidden from the AI.
  for (const spot of brain.analysis.spots) brain.blackboard.reservations.reserveSpot(spot.index, 'fixture', tick);
  brain.blackboard.reservations.handoverAcu('opening', 'engineer', tick);
  w.tick = tick;
  return { ...c, brain, w, start, bp };
}

describe('temporal arena economy contracts', () => {
  it('AI-ECO-01 commissions new power within two seconds and stalls for less than three seconds after +100 E/s', () => {
    const c = fixture('setons', 1800);
    c.w.spawn(0, c.bp('FACTORY').id, c.start.x + 30, c.start.z);
    c.w.spawn(0, c.bp('ENGINEER').id, c.start.x, c.start.z + 8);
    c.w.addIncome(0, 0, 70);
    c.w.setStorage(0, 650, 1200);
    c.w.step(); // Settle the initial 90 E/s supply before switching on the consumer.
    const switchedAt = c.w.tick;
    c.w.addDemand(0, 0, 100);
    let commissionedAt = Infinity;
    let stallTicks = 0;
    runMatch({ world: c.w, sides: c.sides, maxTicks: switchedAt + 1200, onTick: (w) => {
      for (const task of c.brain.blackboard.taskBoard.ordered()) {
        if (task.role === 'pgen' && task.createdTick >= switchedAt) commissionedAt = Math.min(commissionedAt, task.createdTick);
      }
      if (w.economy.snapshot(0).energyRatio < 1) stallTicks++;
    } });
    expect(commissionedAt - switchedAt).toBeLessThanOrEqual(20);
    expect(stallTicks).toBeLessThan(30);
    expect(c.w.completed.get(0)!.some((u) => u.tick >= switchedAt && c.w.setup.bps.list[u.bp]!.energyPerSec > 0)).toBe(true);
  });

  it('AI-ECO-02 uses mex, new factory, factory upgrade and engineer sinks in order after twenty seconds of +30 M/s', () => {
    const c = fixture('setons', 6000, 'eco_standard', [economyManager]);
    const own = c.brain.analysis.spots.filter((s) => s.kind === 'mass' && s.zone === 'own');
    for (const spot of own.slice(0, 5)) c.w.spawn(0, c.bp('MASSEXTRACTION').id, spot.x, spot.z);
    for (let i = 0; i < 6; i++) c.w.spawn(0, c.bp('FACTORY', i === 0 ? 2 : 1).id, c.start.x + 24 + i * 20, c.start.z + 30);
    c.brain.blackboard.tech.level = 2;
    c.w.addIncome(0, 30, 2000);
    c.w.step();
    const startedAt = c.w.tick;
    const cap = c.w.economy.snapshot(0);
    c.w.setStorage(0, cap.massCapacity, cap.energyCapacity);
    const decisions: { kind: string; tick: number }[] = [];
    const reserve = c.brain.blackboard.eco.reserve.bind(c.brain.blackboard.eco);
    c.brain.blackboard.eco.reserve = (rate) => {
      decisions.push({ kind: rate === 60 ? 'mex' : rate === 19 ? 'factory' : rate === 96 ? 'factory-upgrade' : rate === 25 ? 'engineer' : 'other', tick: c.brain.blackboard.tick });
      reserve(rate);
    };
    let fullTicks = 0;
    runMatch({ world: c.w, sides: c.sides, maxTicks: startedAt + 600, onTick: (w) => {
      const eco = w.economy.snapshot(0);
      if (eco.massStored >= eco.massCapacity) fullTicks++;
    } });
    const first = (kind: string) => decisions.find((d) => d.kind === kind);
    expect(fullTicks).toBeGreaterThanOrEqual(200);
    expect(first('mex')).toBeDefined();
    expect(first('factory')!.tick - startedAt).toBeGreaterThanOrEqual(200);
    expect(first('factory')!.tick).toBeLessThanOrEqual(first('factory-upgrade')!.tick);
    expect(first('mex')!.tick).toBeLessThanOrEqual(first('factory')!.tick);
    expect(first('factory-upgrade')!.tick).toBeLessThanOrEqual(first('engineer')!.tick);
    const committed = c.brain.blackboard.eco.sinks;
    expect(committed).toHaveLength(1);
    expect(committed[0]!.massPerSec).toBe(3.7);
    expect(c.brain.blackboard.engineerTarget).toBeGreaterThan(10);
    expect(c.brain.blackboard.engineerTarget).toBeLessThanOrEqual(16);
    expect(c.thinks.get(0)!.some((r) => r.commands.some((cmd) => cmd.op === Op.Upgrade && c.w.blueprint(c.w.units.get(cmd.units[0]!)!).categoryNames.includes('FACTORY')))).toBe(true);
  });

  it('AI-ECO-04 starts at most one mex at E_free=100, commissions power before the next and avoids energy stalls for 120 seconds', () => {
    const c = fixture('setons', 6000, 'tech_greed');
    const own = c.brain.analysis.spots.filter((s) => s.kind === 'mass' && s.zone === 'own');
    for (const spot of own.slice(0, 5)) c.w.spawn(0, c.bp('MASSEXTRACTION').id, spot.x, spot.z);
    for (let i = 0; i < 3; i++) c.w.spawn(0, c.bp('ENGINEER').id, c.start.x + 8, c.start.z + i * 4);
    c.brain.blackboard.tech.level = 2;
    c.w.addIncome(0, 30, 90);
    c.w.setStorage(0, 650, 800);
    c.w.step();
    c.w.setStorage(0, 650, 800);
    const startedAt = c.w.tick;
    const before = c.w.economy.snapshot(0);
    expect(before.energyIncome - before.energyUpkeep - before.energyDemand).toBe(100);
    let powerAt = Infinity;
    let stallTicks = 0;
    runMatch({ world: c.w, sides: c.sides, maxTicks: startedAt + 1200, onTick: (w) => {
      for (const task of c.brain.blackboard.taskBoard.ordered()) if (task.role === 'pgen') powerAt = Math.min(powerAt, task.createdTick);
      if (w.economy.snapshot(0).energyRatio < 1) stallTicks++;
    } });
    const upgrades = c.brain.blackboard.telemetry.events.filter((e) => e.kind === 'mexUpgradeStart');
    expect(upgrades.filter((e) => e.tick <= startedAt + 20)).toHaveLength(1);
    expect(upgrades.length).toBeGreaterThanOrEqual(2);
    expect(powerAt).toBeLessThan(upgrades[1]!.tick);
    expect(stallTicks).toBe(0);
  });

  it('AI-ECO-02 does not invent a sink from a full store when actual mass flow is balanced', () => {
    const c = fixture('setons', 6000, 'eco_standard', [economyManager]);
    c.w.spawn(0, c.bp('FACTORY').id, c.start.x + 30, c.start.z);
    c.w.addIncome(0, 30, 500);
    c.w.addDemand(0, 31, 0);
    c.w.step();
    const cap = c.w.economy.snapshot(0);
    c.w.setStorage(0, cap.massCapacity, cap.energyCapacity);
    let fullTicks = 0;
    runMatch({ world: c.w, sides: c.sides, maxTicks: c.w.tick + 400, onTick: (w) => {
      const eco = w.economy.snapshot(0);
      if (eco.massStored === eco.massCapacity) fullTicks++;
    } });
    expect(fullTicks).toBe(400);
    expect(c.brain.blackboard.eco.sinks).toHaveLength(0);
    expect(c.brain.blackboard.taskBoard.ordered().filter((t) => t.role === 'fac_land')).toHaveLength(0);
    expect(c.brain.blackboard.engineerTarget).toBe(10);
  });

  it('AI-ECO-05 starts the nearest ring mex within two seconds and keeps at most one alongside the real tech upgrade', () => {
    const c = fixture('hollow-ridge', 2400);
    const own = c.brain.analysis.spots.filter((s) => s.kind === 'mass' && s.zone === 'own');
    const mexes = own.map((s) => c.w.spawn(0, c.bp('MASSEXTRACTION').id, s.x, s.z));
    expect(mexes).toHaveLength(6);
    const factory = c.w.units.get(c.w.spawn(0, c.bp('FACTORY').id, c.start.x + 30, c.start.z))!;
    factory.upgradingTo = c.w.blueprint(factory).upgradesTo;
    c.brain.blackboard.tech.upgrading = true;
    c.w.addIncome(0, 30, 300);
    c.w.step();
    const startedAt = c.w.tick;
    let maxParallel = 0;
    let techTicks = 0;
    runMatch({ world: c.w, sides: c.sides, maxTicks: startedAt + 600, onTick: (w) => {
      if (factory.upgradingTo < 0) return;
      techTicks++;
      maxParallel = Math.max(maxParallel, mexes.filter((id) => w.units.get(id)!.upgradingTo >= 0).length);
    } });
    const first = c.brain.blackboard.telemetry.events.find((e) => e.kind === 'mexUpgradeStart');
    expect(first).toBeDefined();
    expect(first!.tick - startedAt).toBeLessThanOrEqual(20);
    const nearestRing = c.brain.analysis.ringSpots.map((index) => own.find((s) => s.index === index)!)
      .sort((a, b) => c.brain.analysis.dOwnAt(a.x, a.z) - c.brain.analysis.dOwnAt(b.x, b.z) || a.index - b.index)[0]!;
    expect(first!.kind === 'mexUpgradeStart' && first!.unit).toBe(mexes[own.indexOf(nearestRing)]);
    expect(techTicks).toBe(600);
    expect(factory.upgradeProgress).toBeGreaterThan(0);
    expect(maxParallel).toBe(1);
  });
});
