import { describe, expect, it } from 'vitest';
import { TaskPrio } from '../../../src/index.ts';
import { defenseManager, type DefenseManager } from '../../../src/managers/defense/index.ts';
import { bpIndex, flat512, harness, ID } from '../platoon/harness.ts';

/** Three mex spots in 30 WU (the cluster) plus one far away. */
const SPOTS = [
  { kind: 'mass' as const, x: 200, z: 120 },
  { kind: 'mass' as const, x: 212, z: 126 },
  { kind: 'mass' as const, x: 204, z: 136 },
  { kind: 'mass' as const, x: 60, z: 300 },
];

function setup(tick: number, o: { difficulty?: 'easy' | 'normal' | 'hard'; spots?: typeof SPOTS } = {}) {
  const h = harness<DefenseManager>(defenseManager, { tick, static: flat512(o.spots ?? SPOTS), ...(o.difficulty !== undefined ? { difficulty: o.difficulty } : {}) });
  const mex = (o.spots ?? SPOTS).slice(0, 3).map((s) => h.world.addOwn(ID.mex, s.x, s.z));
  h.world.addOwn(ID.mex, 60, 300);
  // mass spending so the 15-% rule has a base: 10 M/s consumption
  h.world.setEco({ massDemand: 10, massRatio: 1 });
  return { h, mex };
}

function pdTasks(h: ReturnType<typeof setup>['h']) {
  return h.brain.blackboard.taskBoard.filter((t) => t.role === 'pd');
}

describe('DefenseManager — minimal A8 (ai.md §5.7)', () => {
  it('AI-DEF-01: a bot raid on a 3-mex cluster at 5:00 ⇒ exactly one Riegel I task (prio 95), 6 WU towards the threat', () => {
    const { h, mex } = setup(2990);
    h.run(2);
    const raiders = [0, 1, 2].map((i) => h.world.addEnemy(ID.bot, 226 + i, 132));
    const bot = bpIndex(ID.bot);
    // repeated hits over 10 s
    h.run(20, {
      before: (w, i) => {
        if (i % 2 === 0) w.event({ kind: 'ownDamaged', tick: w.tick, unit: mex[i % 3]!, attacker: raiders[i % 3]!, attackerBp: bot, amount: 8 });
      },
    });
    const tasks = pdTasks(h);
    expect(tasks).toHaveLength(1);
    const t = tasks[0]!;
    expect(t.prio).toBe(TaskPrio.defense);
    expect(t.bp).toBe(bpIndex(ID.pd));
    expect(t.tech).toBe(1);
    expect(t.source).toBe('defense');
    const cx = (200 + 212 + 204) / 3;
    const cz = (120 + 126 + 136) / 3;
    const site = t.site as { x: number; z: number };
    expect(Math.hypot(site.x - cx, site.z - cz)).toBeCloseTo(6, 6);
    expect(site.x).toBeGreaterThan(cx); // towards the raiders (east)
    expect(h.brain.blackboard.defense.spend).toHaveLength(1);
    expect(h.manager().created).toHaveLength(1);
  });

  it('AI-DEF-03: a scout running through the cluster without firing ⇒ no Riegel', () => {
    const { h } = setup(3000);
    const funke = h.world.addEnemy(ID.scout, 180, 110);
    h.run(30, {
      before: (w, i) => {
        const e = w.enemy(funke);
        e.x = 180 + i * 2;
        e.z = 110 + i;
      },
    });
    expect(pdTasks(h)).toHaveLength(0);
  });

  it('not before 3:00 (except defence mode); air attackers and single mex do not count', () => {
    const early = setup(1500);
    const e = early.h.world.addEnemy(ID.bot, 226, 132);
    early.h.run(4, {
      before: (w) => w.event({ kind: 'ownDamaged', tick: w.tick, unit: early.mex[0]!, attacker: e, attackerBp: bpIndex(ID.bot), amount: 5 }),
    });
    expect(pdTasks(early.h)).toHaveLength(0);
    early.h.brain.blackboard.opening.defenseMode = true;
    early.h.run(4, {
      before: (w) => w.event({ kind: 'ownDamaged', tick: w.tick, unit: early.mex[1]!, attacker: e, attackerBp: bpIndex(ID.bot), amount: 5 }),
    });
    expect(pdTasks(early.h)).toHaveLength(1);

    const air = setup(3200);
    const b = air.h.world.addEnemy(ID.bomber, 210, 128);
    air.h.run(4, {
      before: (w) => w.event({ kind: 'ownDamaged', tick: w.tick, unit: air.mex[0]!, attacker: b, attackerBp: bpIndex(ID.bomber), amount: 50 }),
    });
    expect(pdTasks(air.h)).toHaveLength(0);

    const lone = setup(3200);
    const single = lone.h.world.ownHandles()[3]!; // the far mex (no cluster)
    lone.h.run(4, {
      before: (w) => w.event({ kind: 'ownDamaged', tick: w.tick, unit: single, attacker: 0, attackerBp: -1, amount: 5 }),
    });
    expect(pdTasks(lone.h)).toHaveLength(0);
  });

  it('an unseen attacker (attackerBp −1) counts; an existing Riegel near the cluster blocks a second one', () => {
    const { h, mex } = setup(3200);
    h.run(4, { before: (w) => w.event({ kind: 'ownDamaged', tick: w.tick, unit: mex[2]!, attacker: 0, attackerBp: -1, amount: 5 }) });
    expect(pdTasks(h)).toHaveLength(1);
    const t = pdTasks(h)[0]!;
    h.brain.blackboard.taskBoard.complete(t.id);
    const site = t.site as { x: number; z: number };
    h.world.addOwn(ID.pd, site.x, site.z);
    h.run(6, { before: (w) => w.event({ kind: 'ownDamaged', tick: w.tick, unit: mex[0]!, attacker: 0, attackerBp: -1, amount: 5 }) });
    expect(pdTasks(h)).toHaveLength(0);
    expect(h.manager().created).toHaveLength(1);
  });

  it('15 % budget over 3 min and no Riegel in contested territory without platoon cover', () => {
    // budget: spending of 1 M/s over the window ⇒ one Riegel (240 M) already exceeds 15 %
    const spots2 = [
      ...SPOTS,
      { kind: 'mass' as const, x: 140, z: 200 },
      { kind: 'mass' as const, x: 150, z: 210 },
    ];
    const { h, mex } = setup(3200, { spots: spots2 });
    const m2 = [h.world.addOwn(ID.mex, 140, 200), h.world.addOwn(ID.mex, 150, 210)];
    h.world.setEco({ massDemand: 1, massRatio: 1 });
    h.run(4, { before: (w) => w.event({ kind: 'ownDamaged', tick: w.tick, unit: mex[0]!, attacker: 0, attackerBp: -1, amount: 5 }) });
    expect(pdTasks(h)).toHaveLength(1);
    h.run(4, { before: (w) => w.event({ kind: 'ownDamaged', tick: w.tick, unit: m2[0]!, attacker: 0, attackerBp: -1, amount: 5 }) });
    expect(pdTasks(h)).toHaveLength(1); // 240 M > 15 % of the spending
    h.brain.blackboard.opening.defenseMode = true;
    h.run(4, { before: (w) => w.event({ kind: 'ownDamaged', tick: w.tick, unit: m2[1]!, attacker: 0, attackerBp: -1, amount: 5 }) });
    expect(pdTasks(h)).toHaveLength(2); // defence mode lifts the budget

    // contested cluster (map centre) without a platoon ⇒ nothing; with a covering platoon ⇒ Riegel
    const mid = [
      { kind: 'mass' as const, x: 250, z: 256 },
      { kind: 'mass' as const, x: 262, z: 262 },
      { kind: 'mass' as const, x: 254, z: 270 },
    ];
    const c = setup(3200, { spots: [...mid, SPOTS[3]!] });
    expect(c.h.brain.analysis.zoneAt(256, 262)).toBe('contested');
    const hit = (w: typeof c.h.world) => w.event({ kind: 'ownDamaged', tick: w.tick, unit: c.mex[0]!, attacker: 0, attackerBp: -1, amount: 5 });
    c.h.run(4, { before: hit });
    expect(pdTasks(c.h)).toHaveLength(0);
    c.h.brain.blackboard.platoons = [{ id: 1, state: 'staging', units: [1], x: 240, z: 240, ratio: 1.4, target: null, isFirstWave: false }];
    c.h.run(4, { before: hit });
    expect(pdTasks(c.h)).toHaveLength(1);
  });

  it('determinism: identical task boards in two runs', () => {
    const run = () => {
      const { h, mex } = setup(3000);
      const r = h.world.addEnemy(ID.bot, 226, 132);
      h.run(20, {
        before: (w, i) => {
          if (i % 3 === 0) w.event({ kind: 'ownDamaged', tick: w.tick, unit: mex[i % 3]!, attacker: r, attackerBp: bpIndex(ID.bot), amount: 3 });
        },
      });
      return JSON.stringify(h.brain.blackboard.taskBoard.ordered());
    };
    expect(run()).toBe(run());
  });
});
