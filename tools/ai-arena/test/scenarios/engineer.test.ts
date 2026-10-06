/**
 * EngineerManager in the arena (ai.md §5.3, §9): AI-ENG-02 (re-planning of a rejected placement) and
 * AI-ENG-04 (scout denial).
 */
import { describe, expect, it } from 'vitest';
import { Op } from '@faf/protocol';
import { decodeAiPayload } from '@faf/ai';
import { getArenaBps } from '../../src/data/assumptions.ts';
import { runScenario, type ScenarioRuntime } from '../../src/scenarios/index.ts';
import { dist, ID, openingRun, sec, unitsOf } from './support.ts';

/** Tick at which the second land factory of army 0 was complete (observer). */
function fac2Watcher(): { tick: number; observe: (rt: ScenarioRuntime, t: number) => void } {
  const w = {
    tick: -1,
    observe: (rt: ScenarioRuntime, t: number) => {
      if (w.tick >= 0) return;
      if (unitsOf(rt.world, 0, ID.facLand).filter((u) => u.complete).length >= 2) w.tick = t;
    },
  };
  return w;
}

describe('AI-ENG-02: fac2 blocked by a wall after the perception showed it free', () => {
  // eco_standard: fac2 is a mass-sink task of the EconomyManager, built through the EngineerManager
  // (the path ai.md §5.3 describes: rejection ⇒ spiral search in the next think).
  const RUN_S = 330;
  const facBp = getArenaBps().byId(ID.facLand)!.index;
  it('the arena rejects, the next think re-plans by spiral search, the factory stands ≤ 5 s later', () => {
    const plain = fac2Watcher();
    openingRun('setons', 'eco_standard', RUN_S, { observe: [{ every: 1, run: plain.observe }] });
    expect(plain.tick, 'fac2 without the wall').toBeGreaterThan(0);

    const blocked = fac2Watcher();
    const state: { wall: { x: number; z: number; tick: number } | null; pending: { x: number; z: number } | null; facs: number } = {
      wall: null,
      pending: null,
      facs: 0,
    };
    const r = runScenario({
      map: 'setons',
      seed: 1,
      sides: [
        {
          army: 0,
          ai: {
            openingId: 'eco_standard',
            // The AI decided fac2 on a free perception (think N); the wall goes up before its command
            // is applied (N + lead).
            onThink: (_tick, res) => {
              if (state.wall !== null || state.pending !== null || state.facs < 1) return;
              for (const c of res.commands) {
                if (c.op !== Op.Build) continue;
                const d = decodeAiPayload(c.op, c.payload);
                if (d.op === 'build' && d.value.bp === facBp) state.pending = { x: d.value.x, z: d.value.z };
              }
            },
          },
        },
        { army: 1 },
      ],
      until: { seconds: RUN_S },
      cheats: [
        {
          every: 1,
          run: (rt, t) => {
            state.facs = unitsOf(rt.world, 0, ID.facLand).length;
            if (state.pending === null || state.wall !== null) return;
            const half = rt.world.info(facBp).halfFoot;
            const p = state.pending;
            rt.world.blockCells(p.x - half, p.z - half, p.x + half, p.z + half);
            state.wall = { x: p.x, z: p.z, tick: t };
          },
        },
      ],
      observe: [{ every: 1, run: blocked.observe }],
    });
    const wall = state.wall;
    expect(wall, 'wall placed on the planned fac2').not.toBeNull();
    if (wall === null) return;
    expect(r.army(0).commandsRejected, 'placement rejected').toBeGreaterThanOrEqual(1);
    // The factory stands elsewhere (spiral ≤ 12 WU around the walled place).
    const facs = unitsOf(r.world, 0, ID.facLand).filter((u) => u.complete);
    expect(facs.length).toBeGreaterThanOrEqual(2);
    const moved = facs.some((u) => dist(u.x, u.z, wall.x, wall.z) > 0.5 && dist(u.x, u.z, wall.x, wall.z) <= 12 + 1);
    expect(moved, 'factory re-placed near the wall').toBe(true);
    expect(blocked.tick).toBeGreaterThan(0);
    expect(blocked.tick - plain.tick, `fac2 ${blocked.tick} vs ${plain.tick}`).toBeLessThanOrEqual(sec(5));
  });
});

describe('AI-ENG-04: scout denial (three standing enemy Funken at expansion clusters)', () => {
  const run = (withScouts: boolean) => {
    const seen = new Map<number, number>();
    const hunted = new Map<number, number>();
    const r = openingRun('setons', 'eco_standard', 300, {
      spawns: withScouts
        ? [0, 1, 2].map((k) => ({
            name: `scout${k}`,
            army: 1,
            unit: ID.scout,
            tick: sec(150),
            at: (rt: ScenarioRuntime) => {
              // Three expansion clusters of the own zone (mex order ranks 12, 16, 22), 5 WU beside a spot.
              const a = rt.brain(0).analysis;
              const idx = a.mexOrder[[12, 16, 22][k]!]!;
              const sp = rt.world.baseStatic.spots[idx]!;
              return { x: sp.x + 5, z: sp.z + 5 };
            },
          }))
        : [],
      observe: withScouts
        ? [
            {
              tick: sec(150),
              every: 1,
              run: (rt, t) => {
                const bb = rt.brain(0).blackboard;
                for (const k of [0, 1, 2]) {
                  for (const h of rt.spawned(`scout${k}`)) {
                    const u = rt.world.unit(h);
                    const alive = u !== null && u.alive;
                    if (alive && !seen.has(h) && rt.world.sees(0, u)) seen.set(h, t);
                    // Hunted: a hunter is assigned, or the scout is already dead (killed on sight).
                    if (!hunted.has(h) && seen.has(h) && (!alive || bb.huntRequests.find((q) => q.target === h && q.hunter !== 0) !== undefined)) hunted.set(h, t);
                  }
                }
              },
            },
          ]
        : [],
    });
    return { r, seen, hunted };
  };

  it('engineers keep building (no flight), a hunt order goes out ≤ 5 s after sighting, mex after 5 min ≥ 90 % of the run without scouts', () => {
    const base = run(false);
    const denied = run(true);
    const mex0 = base.r.army(0).mexAt[300]!;
    const mex1 = denied.r.army(0).mexAt[300]!;
    expect(mex0).toBeGreaterThan(0);
    expect(mex1, `mex ${mex1} vs ${mex0}`).toBeGreaterThanOrEqual(Math.ceil(0.9 * mex0));
    expect(denied.seen.size, 'scouts sighted').toBeGreaterThanOrEqual(1);
    for (const [h, t] of denied.seen) {
      const hunt = denied.hunted.get(h);
      expect(hunt, `hunt order for scout ${h}`).toBeDefined();
      expect(hunt! - t, `hunt latency scout ${h}`).toBeLessThanOrEqual(sec(5));
    }
  });
});
