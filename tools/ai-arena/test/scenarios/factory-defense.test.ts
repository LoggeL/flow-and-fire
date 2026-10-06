/**
 * FactoryManager and DefenseManager in the arena (ai.md §5.4, §5.7, §9): AI-FAC-01 (counter table),
 * AI-DEF-01 (minimal A8 after a raid) and AI-DEF-03 (a passing scout triggers no Riegel).
 */
import { describe, expect, it } from 'vitest';
import { groupShares, type DefenseManager, type FactoryManager } from '@faf/ai';
import type { ScenarioRuntime } from '../../src/scenarios/index.ts';
import type { ArenaUnit } from '../../src/world/unit.ts';
import { dist, ID, managerOf, openingRun, sec, unitsOf } from './support.ts';

describe('AI-FAC-01: counter table against 12 visible enemy Stichel (Normal)', () => {
  it('next mix: Punze ≥ 60 %, Kelle ≥ 25 %', () => {
    // land_rush hands its factories to the FactoryManager early; at 2:00 the scout has not yet seen
    // the enemy commander (a seen commander, threat 1.095, would dilute the Stichel share below 35 %).
    const t0 = sec(120);
    let checked = 0;
    const r = openingRun('setons', 'land_rush', 150, {
      spawns: [{ name: 'bots', army: 1, unit: ID.bot, count: 12, tick: t0, at: (rt) => rt.brain(0).analysis.rally }],
      cheats: [
        {
          // Visible and alive long enough for two mix runs of the FactoryManager.
          tick: t0 + 1,
          every: 1,
          until: t0 + sec(15),
          run: (rt) => {
            for (const h of rt.alive('bots')) rt.world.setHp(h, 1);
          },
        },
      ],
      observe: [
        {
          tick: t0 + sec(4),
          run: (rt) => {
            const fm = managerOf<FactoryManager>(rt.brain(0), 'factory');
            expect(fm.counterApplied, 'Stichel rule applied (Normal: next mix run)').toContain('bots');
            for (const [h, mix] of fm.lastMix) {
              const f = rt.world.unit(h);
              if (f === null || f.bp.tech !== 1 || mix.length === 0) continue;
              const g = groupShares(mix);
              expect(g['tank@1']!, `Punze share of factory ${h}`).toBeGreaterThanOrEqual(0.6);
              expect(g['arty@1']!, `Kelle share of factory ${h}`).toBeGreaterThanOrEqual(0.25);
              checked++;
            }
          },
        },
      ],
    });
    expect(r.metrics.endTick).toBe(sec(150));
    expect(checked, 'factories with a mix').toBeGreaterThanOrEqual(1);
  });
});

/** A cluster of ≥ 3 own complete mex (single linkage 30 WU) outside the base radius, as spot positions. */
function mexCluster(rt: ScenarioRuntime): ArenaUnit[] | null {
  const w = rt.world;
  const start = w.startOf(0);
  const mex = unitsOf(w, 0, ID.mex).filter((u) => u.complete && dist(u.x, u.z, start.x, start.z) > 60);
  for (const seed of mex) {
    const group = [seed];
    for (let i = 0; i < group.length; i++) {
      for (const m of mex) if (!group.includes(m) && dist(m.x, m.z, group[i]!.x, group[i]!.z) <= 30) group.push(m);
    }
    if (group.length >= 3) return group;
  }
  return null;
}

describe('AI-DEF-01 / AI-DEF-03: minimal A8 (one Riegel I per attacked mex cluster)', () => {
  it('AI-DEF-01: Stichel raid on a 3-mex cluster at 5:00 ⇒ exactly one Riegel I ordered at the cluster', () => {
    const t0 = sec(300);
    let cluster: ArenaUnit[] | null = null;
    const r = openingRun('setons', 'eco_standard', 380, {
      spawns: [
        {
          name: 'raid',
          army: 1,
          unit: ID.bot,
          count: 3,
          tick: t0,
          at: (rt) => {
            cluster = mexCluster(rt);
            if (cluster === null) throw new Error('no 3-mex cluster at 5:00');
            return { x: cluster[0]!.x + 8, z: cluster[0]!.z + 8 };
          },
        },
      ],
      commands: [{ army: 1, tick: t0 + 1, issue: (rt) => rt.cmd.attack(1, rt.spawned('raid'), cluster![0]!.handle) }],
    });
    expect(cluster).not.toBeNull();
    const dm = managerOf<DefenseManager>(r.brain(0), 'defense');
    const c = cluster!;
    const cx = c.reduce((s, m) => s + m.x, 0) / c.length;
    const cz = c.reduce((s, m) => s + m.z, 0) / c.length;
    const near = dm.created.filter((k) => dist(k.x, k.z, cx, cz) <= 30);
    expect(near, `defence tasks ${JSON.stringify(dm.created)}`).toHaveLength(1);
    expect(near[0]!.tick - t0).toBeLessThanOrEqual(sec(30));
    const task = r.brain(0).blackboard.taskBoard.get(near[0]!.taskId);
    if (task !== undefined) {
      expect(task.role).toBe('pd');
      expect(task.prio).toBe(95);
    }
  });

  it('AI-DEF-03: a Funke walks through a 3-mex cluster without shooting ⇒ no Riegel', () => {
    const t0 = sec(300);
    let cluster: ArenaUnit[] | null = null;
    let damaged = 0;
    const r = openingRun('setons', 'eco_standard', 360, {
      spawns: [
        {
          name: 'scout',
          army: 1,
          unit: ID.scout,
          tick: t0,
          at: (rt) => {
            cluster = mexCluster(rt);
            if (cluster === null) throw new Error('no 3-mex cluster at 5:00');
            return { x: cluster[0]!.x - 40, z: cluster[0]!.z };
          },
        },
      ],
      cheats: [{ tick: t0 + 1, run: (rt: ScenarioRuntime) => rt.world.holdFire(rt.spawned('scout')[0]!, true) }],
      commands: [
        {
          army: 1,
          tick: t0 + 2,
          issue: (rt) => rt.cmd.move(1, rt.spawned('scout'), cluster![0]!.x + 40, cluster![0]!.z),
        },
      ],
      observe: [
        {
          tick: t0,
          every: 1,
          run: () => {
            for (const m of cluster ?? []) if (m.alive && m.hp < m.info.maxHp) damaged++;
          },
        },
      ],
    });
    expect(cluster).not.toBeNull();
    expect(damaged, 'the scout did not shoot').toBe(0);
    const dm = managerOf<DefenseManager>(r.brain(0), 'defense');
    const c = cluster!;
    const created = dm.created.filter((k) => k.tick >= t0 && c.some((m) => dist(k.x, k.z, m.x, m.z) <= 36));
    expect(created).toEqual([]);
    expect(r.brain(0).blackboard.taskBoard.filter((t) => t.role === 'pd' && t.createdTick >= t0)).toEqual([]);
  });
});
