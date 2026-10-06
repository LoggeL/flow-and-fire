/**
 * AI-OPEN-04 (abort → defence mode) and AI-OPEN-05 (poke without abort), ai.md §4.3/§9.
 */
import { describe, expect, it } from 'vitest';
import { Op } from '@faf/protocol';
import { decodeAiPayload, OrderKind } from '@faf/ai';
import { ID, openingRun, sec, unitsOf } from './support.ts';

describe('AI-OPEN-04: six enemy Stichel in the own zone from 2:00 ⇒ defence mode', () => {
  it('within 2 s after the 5-s window: factory on Punze/Stichel, commander defends, Riegel I ordered', () => {
    const t0 = sec(120);
    let firstSeen = -1;
    let factoryOrder = -1;
    let acuDefends = -1;
    const r = openingRun('setons', 'eco_standard', 150, {
      spawns: [
        {
          name: 'raid',
          army: 1,
          unit: ID.bot,
          count: 6,
          tick: t0,
          // 35 WU in front of the own start (base radius 60, own zone), inside the commander's sight
          at: (rt) => rt.brain(0).analysis.toWorld(35, 0),
        },
      ],
      cheats: [
        {
          // The raid "stands" (ai.md: stehen ab 2:00): kept alive so the threat stays ≥ 160 for 5 s.
          tick: t0 + 1,
          every: 1,
          until: t0 + sec(20),
          run: (rt) => {
            for (const h of rt.alive('raid')) rt.world.setHp(h, 1);
          },
        },
      ],
      observe: [
        {
          tick: t0,
          every: 1,
          run: (rt, t) => {
            if (firstSeen < 0 && rt.alive('raid').some((h) => rt.world.sees(0, rt.world.unit(h)!))) firstSeen = t;
            const acu = rt.world.commander(0);
            const o = acu?.orders[0];
            const fighting = o !== undefined && (o.kind === OrderKind.Attack || o.kind === OrderKind.AttackMove);
            if (acuDefends < 0 && (fighting || rt.brain(0).blackboard.reservations.acuOwner === 'platoon')) acuDefends = t;
          },
        },
      ],
    });
    const tank = r.world.bpIndex(ID.tank);
    const bot = r.world.bpIndex(ID.bot);
    const tel = r.first(0, 'defenseMode');
    expect(firstSeen).toBeGreaterThanOrEqual(t0);
    expect(tel, 'defence mode').toBeDefined();
    // 5 s window after the contact became reactable + ≤ 2 s (reaction delay 0.5 s, 1 think, lead).
    expect(tel!.tick - firstSeen).toBeLessThanOrEqual(sec(5) + sec(2));
    const bb = r.brain(0).blackboard;
    expect(bb.opening.defenseMode).toBe(true);
    // Riegel I at the threatened ring mex (pd task, prio 95, fixed position).
    const pd = bb.taskBoard.filter((t) => t.role === 'pd' && t.prio === 95);
    const pdBuilt = unitsOf(r.world, 0, ID.pd).length;
    expect(pd.length + pdBuilt).toBeGreaterThanOrEqual(1);
    // Factory on Punze/Stichel: a queue order of tank or bot after the defence mode.
    for (const th of r.thinks(0)) {
      if (th.tick < tel!.tick) continue;
      for (const c of th.commands) {
        if (c.op !== Op.FactoryQueue) continue;
        const d = decodeAiPayload(c.op, c.payload);
        if (d.op === 'factoryQueue' && (d.value.bp === tank || d.value.bp === bot)) {
          factoryOrder = th.tick;
          break;
        }
      }
      if (factoryOrder >= 0) break;
    }
    expect(factoryOrder, 'Punze/Stichel ordered').toBeGreaterThanOrEqual(0);
    expect(factoryOrder - tel!.tick).toBeLessThanOrEqual(sec(2));
    // The commander defends (platoon manager claims it for local defence, attack order) no later than
    // the defence mode.
    expect(acuDefends, 'commander defends').toBeGreaterThanOrEqual(t0);
    expect(acuDefends).toBeLessThanOrEqual(tel!.tick + sec(2));
  });
});

describe('AI-OPEN-05: a Stichel pokes the commander at 1:30, a Funke walks through the base', () => {
  const poke = (withPoke: boolean) =>
    openingRun('setons', 'eco_standard', 240, {
      spawns: withPoke
        ? [
            { name: 'poke', army: 1, unit: ID.bot, tick: sec(90), at: (rt) => ({ x: rt.world.commander(0)!.x + 16, z: rt.world.commander(0)!.z }) },
            { name: 'scout', army: 1, unit: ID.scout, tick: sec(90), at: (rt) => rt.brain(0).analysis.toWorld(-55, 20) },
          ]
        : [],
      commands: withPoke
        ? [
            { army: 1, tick: sec(90) + 1, issue: (rt) => rt.cmd.attack(1, rt.spawned('poke'), rt.world.commander(0)!.handle) },
            {
              army: 1,
              tick: sec(90) + 1,
              issue: (rt) => {
                const p = rt.brain(0).analysis.toWorld(55, -20);
                return rt.cmd.move(1, rt.spawned('scout'), p.x, p.z);
              },
            },
          ]
        : [],
    });

  it('no defence mode, both intruders die, Mex8 ≤ 20 s later than without the poke', () => {
    const base = poke(false);
    const r = poke(true);
    expect(r.first(0, 'defenseMode')).toBeUndefined();
    expect(r.rt.alive('poke')).toEqual([]);
    expect(r.rt.alive('scout')).toEqual([]);
    const m0 = base.army(0).mex8Tick!;
    const m1 = r.army(0).mex8Tick!;
    expect(m0).not.toBeNull();
    expect(m1).not.toBeNull();
    expect(m1 - m0).toBeLessThanOrEqual(sec(20));
    // Only local defence (the opening pauses, it is not discarded).
    expect(r.brain(0).blackboard.opening.defenseMode).toBe(false);
  });
});
