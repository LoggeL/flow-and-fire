import { describe, expect, it } from 'vitest';
import { Op } from '@faf/protocol';
import { decodeAiPayload, type AiBrain } from '../../../src/index.ts';
import { TECH_ACU_KEY, TECH_ASSIST_KEY } from '../../../src/managers/tech/index.ts';
import { FakeWorld, runThinks } from '../../../src/testing/index.ts';
import { loadStatic } from '../../support/fixtures.ts';
import { COMMANDER_ID, MANAGERS, bpOf, brainFor, idOf, ofOp, targetOf } from '../engineer/build-support.ts';

function setup(tick: number, eco: Parameters<FakeWorld['setEco']>[0], managers = [MANAGERS.tech]) {
  const brain: AiBrain = brainFor(loadStatic('setons', 0, 1), { managers });
  const a = brain.analysis;
  const w = new FakeWorld(brain.static, { tick, eco });
  const near = w.addOwn(idOf('fac_land'), a.slots.fac1!.x, a.slots.fac1!.z, { factoryBp: bpOf('tank'), factoryRepeat: true });
  const far = w.addOwn(idOf('fac_land'), a.ownStart.x - 30, a.ownStart.z + 20);
  return { brain, a, w, near, far };
}

const GOOD = { massIncome: 14, energyIncome: 200, energyUpkeep: 0, energyDemand: 100, massRatio: 1, energyStored: 1000 };

describe('TechManager (ai.md §5.2)', () => {
  it('T1 → T2 at techT2.minS with P_M ≥ 14 and energy surplus ≥ 60: nearest land factory upgrades, assist tasks', () => {
    const { brain, w, near } = setup(3890, GOOD);
    const bb = brain.blackboard;
    const early = runThinks(brain, w, 1);
    expect(ofOp(early[0]!.commands, Op.Upgrade)).toHaveLength(0);
    const rs = runThinks(brain, w, 2);
    const up = rs.flatMap((r) => ofOp(r.commands, Op.Upgrade));
    expect(up).toHaveLength(1);
    expect(up[0]!.units).toEqual([near]);
    const p = decodeAiPayload(up[0]!.op, up[0]!.payload);
    expect(p.op === 'upgrade' ? p.value : -1).toBe(bpOf('fac_land', 2));
    expect(bb.tech.upgrading).toBe(true);
    expect(bb.tech.upgradeHandle).toBe(near);
    expect(bb.telemetry.first('techStart')).toMatchObject({ unit: near, tech: 2 });
    const eng = bb.taskBoard.byKey(TECH_ASSIST_KEY)!;
    expect([eng.prio, eng.wanted, eng.role, eng.target]).toEqual([80, brain.opening!.followUp.techT2.assistEngineers, '@eng', near]);
    const acu = bb.taskBoard.byKey(TECH_ACU_KEY)!;
    expect([acu.prio, acu.wanted, acu.role]).toEqual([80, 1, '@acu']);
  });

  it('no trigger without income, without energy surplus/storage, or before minS + techDelayS', () => {
    for (const [tick, eco] of [
      [4000, { ...GOOD, massIncome: 10 }],
      [4000, { ...GOOD, energyDemand: 180, energyStored: 1500 }],
      [3800, GOOD],
    ] as const) {
      const { brain, w } = setup(tick, eco);
      const rs = runThinks(brain, w, 4);
      expect(rs.flatMap((r) => ofOp(r.commands, Op.Upgrade))).toHaveLength(0);
      expect(brain.blackboard.tech.upgrading).toBe(false);
    }
    // S_E ≥ 2,000 replaces the surplus.
    const { brain, w } = setup(4000, { ...GOOD, energyDemand: 180, energyStored: 2500 });
    runThinks(brain, w, 2);
    expect(brain.blackboard.tech.upgrading).toBe(true);
  });

  it('done: techDone telemetry, level 2, assist tasks closed, T2 engineers requested', () => {
    const { brain, w, near } = setup(4000, GOOD);
    const bb = brain.blackboard;
    runThinks(brain, w, 2);
    expect(bb.tech.upgrading).toBe(true);
    const f = w.own(near);
    f.bp = bpOf('fac_land', 2);
    f.upgradingTo = -1;
    runThinks(brain, w, 4);
    expect(bb.tech.upgrading).toBe(false);
    expect(bb.tech.level).toBe(2);
    expect(bb.telemetry.first('techDone')).toMatchObject({ unit: near, tech: 2 });
    expect(bb.taskBoard.byKey(TECH_ASSIST_KEY)).toBeUndefined();
    const req = bb.productionRequests.items.find((r) => r.source === 'tech')!;
    expect([req.role, req.tech, req.count]).toEqual(['eng', 2, brain.opening!.followUp.techT2.t2Engineers]);
  });

  it('with the EngineerManager: engineers and the commander assist the upgrade', () => {
    const { brain, a, w, near } = setup(4000, GOOD, [MANAGERS.tech, MANAGERS.engineer]);
    const bb = brain.blackboard;
    bb.reservations.handoverAcu('opening', 'engineer', 0);
    const acu = w.addOwn(COMMANDER_ID, a.ownStart.x, a.ownStart.z);
    const engs = [0, 1, 2, 3].map((i) => w.addOwn(idOf('eng'), a.ownStart.x + 4 + i, a.ownStart.z + 4));
    const rs = runThinks(brain, w, 4);
    const assists = rs.flatMap((r) => ofOp(r.commands, Op.Assist)).filter((c) => targetOf(c) === near);
    const units = assists.map((c) => c.units[0]!);
    expect(units).toContain(acu);
    expect(units.filter((u) => engs.includes(u))).toHaveLength(brain.opening!.followUp.techT2.assistEngineers);
    // The fourth engineer guards the (working) factory instead.
    const guards = rs.flatMap((r) => ofOp(r.commands, Op.Guard));
    expect(guards.length).toBeGreaterThanOrEqual(1);
  });

  it('commander assist only without an enemy combat unit in the base radius', () => {
    const { brain, a, w } = setup(4000, GOOD);
    w.addEnemy(idOf('tank'), a.ownStart.x + 10, a.ownStart.z);
    runThinks(brain, w, 3);
    expect(brain.blackboard.tech.upgrading).toBe(true);
    expect(brain.blackboard.taskBoard.byKey(TECH_ACU_KEY)).toBeUndefined();
  });
});
