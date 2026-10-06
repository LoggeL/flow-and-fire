import { describe, expect, it } from 'vitest';
import { Op } from '@faf/protocol';
import { decodeAiPayload, type AiBrain, type EncodedCommand, type ThinkResult } from '../../../src/index.ts';
import {
  energyBalance,
  energyFree,
  mexLifetimeS,
  powerToOrder,
  STORE_CREDIT_S,
  upgradeAmortisationS,
  worthUpgrading,
} from '../../../src/managers/economy/index.ts';
import { peekBuildShared } from '../../../src/managers/engineer/index.ts';
import { FakeWorld, flatStatic, runThinks } from '../../../src/testing/index.ts';
import { loadStatic } from '../../support/fixtures.ts';
import { COMMANDER_ID, MANAGERS, T, bpOf, brainFor, builds, idOf, ofOp } from '../engineer/build-support.ts';

function upgrades(cmds: readonly EncodedCommand[]): { unit: number; bp: number }[] {
  return ofOp(cmds, Op.Upgrade).map((c) => {
    const p = decodeAiPayload(c.op, c.payload);
    return { unit: c.units[0]!, bp: p.op === 'upgrade' ? p.value : -1 };
  });
}

function allUpgrades(rs: readonly ThinkResult[]): { unit: number; bp: number; tick: number }[] {
  return rs.flatMap((r) => upgrades(r.commands).map((u) => ({ ...u, tick: r.tick })));
}

function powerTasks(brain: AiBrain) {
  return brain.blackboard.taskBoard.filter((t) => t.role === 'pgen' || t.role === 'hydro');
}

describe('economy formulas (ai.md §5.1)', () => {
  const eco = {
    massIncome: 10,
    energyIncome: 60,
    energyUpkeep: 0,
    massStored: 0,
    energyStored: 1000,
    massCapacity: 650,
    energyCapacity: 3900,
    massRatio: 1,
    energyRatio: 1,
    massDemand: 0,
    energyDemand: 160,
  };
  it('balance, E_free, power count, amortisation', () => {
    const b = energyBalance(eco, 0, 600, 30);
    expect(b.dEff).toBe(160);
    expect(b.flowDef).toBeCloseTo(1.1 * 160 - 60 - 400 / STORE_CREDIT_S, 9);
    expect(b.storeDef).toBeCloseTo((600 - (1000 + (60 - 160) * 30)) / 30, 9);
    expect(b.deficit).toBe(Math.max(b.flowDef, b.storeDef));
    expect(b.emptyInS).toBe(10);
    expect(energyFree({ ...eco, energyDemand: 200, energyIncome: 300, energyStored: 600 }, 0, 600)).toBe(100);
    expect(powerToOrder(109, 20, 0, 2, 60)).toBe(2);
    expect(powerToOrder(109, 20, 1, 3, 250)).toBe(4);
    expect(powerToOrder(-1, 20, 0, 2, 60)).toBe(0);
    const t1 = T.list[bpOf('mex')]!;
    const t2 = T.list[bpOf('mex', 2)]!;
    const pgen = T.list[bpOf('pgen')]!;
    const amort = upgradeAmortisationS(t1, t2, pgen.mass / pgen.energyPerSec);
    expect(amort).toBeCloseTo((900 + 7 * 3.75) / 4, 9); // ≈ 232 s (ai.md §5.1)
    expect(worthUpgrading(mexLifetimeS('own', false), amort)).toBe(true);
    expect(worthUpgrading(mexLifetimeS('own', true), amort)).toBe(true);
    expect(worthUpgrading(mexLifetimeS('contested', false), amort)).toBe(false);
  });
});

describe('EconomyManager – energy (ai.md §5.1)', () => {
  it('AI-ECO-01: +100 E/s demand ⇒ power generators ordered within ≤ 2 economy seconds', () => {
    const brain = brainFor(flatStatic({ bps: T, sizeWu: 256 }), { managers: [MANAGERS.economy] });
    const w = new FakeWorld(brain.static, {
      // Storage credit (1.600 − 600) / STORE_CREDIT_S covers the 10 % margin of the balanced state.
      eco: { energyIncome: 60, energyUpkeep: 0, energyDemand: 60, energyStored: 1600, massIncome: 5, massStored: 100 },
    });
    runThinks(brain, w, 4);
    expect(powerTasks(brain)).toHaveLength(0);
    const switchTick = w.tick;
    w.setEco({ energyDemand: 160 });
    runThinks(brain, w, 4);
    const tasks = powerTasks(brain);
    // n = min(maxInflight + ⌊max(P_E − U_E, D_eff)/100⌋, ⌈deficit/20⌉) − inflight = min(2 + 1, 6) = 3
    // (cap scale = actual demand, tai-p5 calibration).
    expect(tasks).toHaveLength(3);
    for (const t of tasks) {
      expect(t.prio).toBe(90);
      expect(t.createdTick - switchTick).toBeLessThanOrEqual(20);
      expect(['kranz', 'slot:eco']).toContain(t.site);
    }
    expect(brain.blackboard.eco.deficitE).toBeGreaterThan(0);
  });

  it('Glutkessel II (3 builders) with a T2 engineer and deficit ≥ 150; hydro first with an engineer ≤ 120 WU', () => {
    const b1 = brainFor(flatStatic({ bps: T, sizeWu: 256 }), { managers: [MANAGERS.economy] });
    const w1 = new FakeWorld(b1.static, { eco: { energyIncome: 60, energyDemand: 260, energyStored: 700 } });
    w1.addOwn(idOf('eng', 2), 70, 70);
    runThinks(b1, w1, 2);
    const t2 = powerTasks(b1);
    expect(t2.map((t) => [t.role, t.tech, t.wanted])).toEqual([['pgen', 2, 3]]);

    const b2 = brainFor(flatStatic({ bps: T, sizeWu: 256, spots: [{ kind: 'hydro', x: 90, z: 70 }] }), { managers: [MANAGERS.economy] });
    const w2 = new FakeWorld(b2.static, { eco: { energyIncome: 60, energyDemand: 160, energyStored: 700 } });
    w2.addOwn(idOf('eng'), 70, 70);
    runThinks(b2, w2, 2);
    const t = powerTasks(b2);
    expect(t[0]!.role).toBe('hydro');
    expect(t[0]!.spot).toBe(0);
  });

  it('energy emergency: the oldest unassigned power task goes to the front of the commander queue', () => {
    // Commander handed off to the EngineerManager (no opening queue): the flagged Glutkessel is built next.
    const brain = brainFor(loadStatic('setons', 0, 1), { managers: [MANAGERS.economy, MANAGERS.engineer] });
    const a = brain.analysis;
    const w = new FakeWorld(brain.static, { tick: 600 });
    w.addOwn(COMMANDER_ID, a.ownStart.x, a.ownStart.z);
    runThinks(brain, w, 1);
    brain.blackboard.reservations.handoverAcu('opening', 'engineer', 600);
    w.setEco({ energyIncome: 20, energyDemand: 200, massRatio: 1, energyStored: 300 });
    let front: ReturnType<typeof builds> = [];
    let sawEmergency = false;
    for (let i = 0; i < 20 && front.length === 0; i++) {
      const [r] = runThinks(brain, w, 1);
      sawEmergency ||= brain.blackboard.eco.emergency;
      front = builds(r!.commands).filter((b) => !b.queued && b.bp === bpOf('pgen'));
    }
    expect(sawEmergency).toBe(true);
    expect(front).toHaveLength(1);
    expect(front[0]!.bp).toBe(bpOf('pgen'));
    expect(peekBuildShared(brain.blackboard)!.acuFrontTask).toBe(0);
  });

  it('energy emergency: no insertion while the next opening step of the commander already is a Glutkessel (ecosim rule)', () => {
    const brain = brainFor(loadStatic('setons', 0, 1), { managers: [MANAGERS.opening, MANAGERS.economy] });
    const a = brain.analysis;
    const w = new FakeWorld(brain.static, { tick: 600 });
    w.addOwn(COMMANDER_ID, a.ownStart.x, a.ownStart.z);
    runThinks(brain, w, 1);
    w.setEco({ energyIncome: 20, energyDemand: 200, massRatio: 1, energyStored: 300 });
    // The commander works on fac1; its next steps are the two Glutkessel near fac1.
    let sawEmergency = false;
    const rs: ThinkResult[] = [];
    for (let i = 0; i < 20; i++) {
      rs.push(...runThinks(brain, w, 1));
      sawEmergency ||= brain.blackboard.eco.emergency;
    }
    expect(sawEmergency).toBe(true);
    expect(rs.flatMap((r) => builds(r.commands)).filter((b) => !b.queued)).toHaveLength(0);
    // The flagged task returns to the board with the balance priority.
    expect(powerTasks(brain).filter((t) => t.role === 'pgen').every((t) => t.prio === 90 || t.prio === 100)).toBe(true);
  });

  it('Glutspeicher at estore.atS (prio 70), not twice', () => {
    const brain = brainFor(flatStatic({ bps: T, sizeWu: 256 }), { managers: [MANAGERS.economy] });
    const w = new FakeWorld(brain.static, { tick: 2390 });
    runThinks(brain, w, 2);
    expect(brain.blackboard.taskBoard.byKey('estore')).toBeUndefined();
    runThinks(brain, w, 6);
    const t = brain.blackboard.taskBoard.filter((x) => x.role === 'estore');
    expect(t.map((x) => [x.prio, x.site])).toEqual([[70, 'slot:estore']]);
  });
});

/** Setons with own mex structures on the given spots and one land factory. */
function setonsWithMex(openingId: string, tick: number, spots: readonly number[], eco: Parameters<FakeWorld['setEco']>[0]) {
  const brain = brainFor(loadStatic('setons', 0, 1), { managers: [MANAGERS.economy], openingId });
  const a = brain.analysis;
  const w = new FakeWorld(brain.static, { tick, eco });
  w.addOwn(idOf('fac_land'), a.slots.fac1!.x, a.slots.fac1!.z);
  const mex = spots.map((i) => w.addOwn(idOf('mex'), brain.static.spots[i]!.x, brain.static.spots[i]!.z));
  return { brain, a, w, mex };
}

describe('EconomyManager – mass sinks and mex upgrades (ai.md §5.1)', () => {
  it('AI-ECO-02: storage full for 20 s ⇒ sinks in table order (mex upgrade, factories, then engineers), R_E booked', () => {
    const a0 = loadStatic('setons', 0, 1);
    void a0;
    const probe = brainFor(loadStatic('setons', 0, 1), { managers: [] });
    const own = probe.analysis.spots.filter((s) => s.kind === 'mass' && s.zone === 'own').sort((x, y) => x.dOwn - y.dOwn);
    const { brain, w, mex } = setonsWithMex('eco_standard', 4800, [own[5]!.index], {
      massIncome: 15,
      massDemand: 0,
      massStored: 400,
      massCapacity: 650,
      energyIncome: 2000,
      energyDemand: 0,
      energyStored: 3900,
    });
    const bb = brain.blackboard;
    const rs = runThinks(brain, w, 2 * 21);
    const ups = allUpgrades(rs);
    expect(ups.map((u) => u.unit)).toEqual([mex[0]]);
    const facTasks = bb.taskBoard.filter((t) => t.role === 'fac_land');
    expect(facTasks.map((t) => t.site)).toEqual(['slot:fac2', 'slot:fac3']);
    expect(facTasks.every((t) => t.prio === 60)).toBe(true);
    expect(ups[0]!.tick).toBeLessThanOrEqual(facTasks[0]!.createdTick);
    expect(bb.eco.sinks).toHaveLength(2);
    expect(bb.eco.reservedE).toBeGreaterThan(0);
    expect(bb.telemetry.count('mexUpgradeStart')).toBe(1);
    expect(peekBuildShared(bb)!.engineerBonus).toBe(0);
    // Next window: no mex left, factories decided (R-03 subtracts their 2 × 3.7 M/s) ⇒ engineers.
    runThinks(brain, w, 2 * 21);
    expect(bb.taskBoard.filter((t) => t.role === 'fac_land')).toHaveLength(2);
    expect(peekBuildShared(bb)!.engineerBonus).toBe(3);
  });

  it('AI-ECO-03: only the hinterland mex is upgraded, never the contested one', () => {
    const probe = brainFor(loadStatic('setons', 0, 1), { managers: [] });
    const hinter = probe.analysis.spots.filter((s) => s.kind === 'mass' && s.zone === 'own').sort((x, y) => x.q - y.q)[0]!;
    const contested = probe.analysis.spots.find((s) => s.kind === 'mass' && s.zone === 'contested')!;
    // tech_greed: maxParallel 2, so the second slot stays free for the contested mex.
    const { brain, w, mex } = setonsWithMex('tech_greed', 4500, [hinter.index, contested.index], {
      massIncome: 20,
      energyIncome: 2000,
      energyStored: 3900,
    });
    const rs = runThinks(brain, w, 30);
    expect(allUpgrades(rs).map((u) => u.unit)).toEqual([mex[0]]);
  });

  it('AI-ECO-04: E_free = 100 E/s ⇒ at most one upgrade, power ordered before the next', () => {
    const probe = brainFor(loadStatic('setons', 0, 1), { managers: [] });
    const own = probe.analysis.spots.filter((s) => s.kind === 'mass' && s.zone === 'own').sort((x, y) => x.dOwn - y.dOwn);
    const { brain, w } = setonsWithMex('tech_greed', 6000, own.slice(4, 9).map((s) => s.index), {
      massIncome: 20,
      energyIncome: 300,
      energyUpkeep: 0,
      energyDemand: 200,
      massRatio: 1,
      energyStored: 600,
    });
    const bb = brain.blackboard;
    const r1 = runThinks(brain, w, 2);
    expect(allUpgrades(r1)).toHaveLength(1);
    // The started upgrade now draws its 60 E/s.
    w.setEco({ energyDemand: 260 });
    const r2 = runThinks(brain, w, 20);
    const firstPower = Math.min(...powerTasks(brain).map((t) => t.createdTick));
    expect(powerTasks(brain).length).toBeGreaterThan(0);
    const later = allUpgrades(r2);
    for (const u of later) expect(u.tick).toBeGreaterThan(firstPower);
    expect(later).toHaveLength(0);
    expect(bb.eco.reservedE).toBeGreaterThan(0);
  });

  it('AI-ECO-05: Hollow Ridge saturated at 4:00 during the tech upgrade ⇒ ring mex upgrade ≤ 2 s, at most one', () => {
    const st = loadStatic('hollow-ridge', 0, 1);
    const brain = brainFor(st, { managers: [MANAGERS.economy] });
    const a = brain.analysis;
    const ownSpots = a.spots.filter((s) => s.kind === 'mass' && s.zone === 'own');
    expect(ownSpots).toHaveLength(6);
    const w = new FakeWorld(brain.static, { tick: 2400, eco: { massIncome: 13, energyIncome: 300, energyDemand: 100, energyStored: 3000 } });
    const fac = w.addOwn(idOf('fac_land'), a.slots.fac1!.x, a.slots.fac1!.z, { upgradingTo: bpOf('fac_land', 2) });
    const mex = new Map<number, number>();
    for (const s of ownSpots) mex.set(s.index, w.addOwn(idOf('mex'), s.x, s.z));
    const bb = brain.blackboard;
    bb.tech.upgrading = true;
    bb.tech.upgradeHandle = fac;
    const rs = runThinks(brain, w, 24);
    const ups = allUpgrades(rs);
    expect(ups).toHaveLength(1);
    expect(ups[0]!.unit).toBe(mex.get(a.ringSpots[0]!));
    expect(ups[0]!.tick - 2400).toBeLessThanOrEqual(20);
    // Assist task (engineers only, prio 40) for the upgrade.
    const assist = bb.taskBoard.filter((t) => t.kind === 'assist');
    expect(assist.map((t) => [t.prio, t.target])).toEqual([[40, ups[0]!.unit]]);
  });

  it('expansion: mex tasks = min(free spots, free engineers + 1), one hydro task', () => {
    const brain = brainFor(loadStatic('setons', 0, 1), { managers: [MANAGERS.economy] });
    const w = new FakeWorld(brain.static, { tick: 200 });
    for (let i = 0; i < 3; i++) w.addOwn(idOf('eng'), brain.analysis.ownStart.x + i, brain.analysis.ownStart.z);
    runThinks(brain, w, 2);
    const bb = brain.blackboard;
    expect(bb.taskBoard.filter((t) => t.site === 'mex:next')).toHaveLength(4);
    expect(bb.taskBoard.filter((t) => t.site === 'hydro:next').map((t) => t.prio)).toEqual([45]);
  });
});
