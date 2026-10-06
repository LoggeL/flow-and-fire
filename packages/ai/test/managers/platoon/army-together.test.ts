/**
 * The four army/situation managers of tai-p4 together in one brain on Setons (FakeWorld, no
 * simulation): budgets per manager hold in every think (ops ≤ allotment), the IntelManager's grid
 * replaces the local estimate, the managers cooperate through the blackboard only, and the stream is
 * deterministic.
 */
import { describe, expect, it } from 'vitest';
import { createBrain, profileFor, PROFILES, type ThinkResult } from '../../../src/index.ts';
import { defenseManager } from '../../../src/managers/defense/index.ts';
import { factoryManager } from '../../../src/managers/factory/index.ts';
import { intelManager, ThreatGrid } from '../../../src/managers/intel/index.ts';
import { platoonManager } from '../../../src/managers/platoon/index.ts';
import { FakeWorld, runThinks } from '../../../src/testing/index.ts';
import { loadStatic } from '../../support/fixtures.ts';
import { doc, ID, streamKey } from './harness.ts';

function play(difficulty: 'easy' | 'normal' | 'hard'): { rs: ThinkResult[]; brain: ReturnType<typeof createBrain> } {
  const brain = createBrain({ managers: [intelManager, defenseManager, factoryManager, platoonManager] });
  brain.init(loadStatic('setons', 0, 3), profileFor(difficulty, doc), { openings: doc, openingId: 'eco_standard' });
  const a = brain.analysis;
  const w = new FakeWorld(brain.static, { tick: 2400 });
  const s = a.ownStart;
  w.addOwn(ID.acu, s.x, s.z);
  w.addOwn(ID.fac, a.slots.fac1!.x, a.slots.fac1!.z);
  w.addOwn(ID.fac, a.slots.fac2!.x, a.slots.fac2!.z);
  for (let i = 0; i < 4; i++) w.addOwn(ID.eng, s.x + 5 + i, s.z + 5);
  for (const idx of a.mexOrder.slice(0, 8)) {
    const sp = a.spots[idx]!;
    w.addOwn(ID.mex, sp.x, sp.z);
  }
  for (let i = 0; i < 30; i++) w.addOwn(i % 4 === 0 ? ID.arty : ID.tank, a.rally.x + (i % 6) * 2, a.rally.z + Math.floor(i / 6) * 2);
  w.addOwn(ID.scout, a.rally.x, a.rally.z);
  const e = a.enemyStart;
  for (let i = 0; i < 40; i++) w.addEnemy(i % 3 === 0 ? ID.bot : ID.tank, e.x - 60 + (i % 8) * 3, e.z - 60 + Math.floor(i / 8) * 3);
  w.addEnemy(ID.fac, e.x, e.z, { kind: 'ghost' });
  for (let i = 0; i < 6; i++) w.addEnemy(null, (s.x + e.x) / 2 + i * 7, (s.z + e.z) / 2);
  const bb = brain.blackboard;
  bb.engineerTarget = 6;
  const rs = runThinks(brain, w, 120, {
    before: (wd, i) => {
      if (i === 40) {
        const mex = wd.ownHandles().find((h) => wd.own(h).bp === brain.static.bps.byId(ID.mex)!.index)!;
        wd.event({ kind: 'ownDamaged', tick: wd.tick, unit: mex, attacker: 0, attackerBp: -1, amount: 10 });
      }
    },
  });
  return { rs, brain };
}

describe('army managers together (tai-p4)', () => {
  for (const d of ['easy', 'normal', 'hard'] as const) {
    it(`${d}: ops per manager ≤ allotment in every think, grid active, deterministic`, () => {
      const { rs, brain } = play(d);
      const b = PROFILES[d].budget;
      for (const r of rs) {
        expect(r.opsByManager.intel ?? 0).toBeLessThanOrEqual(b.intel);
        expect(r.opsByManager.platoon ?? 0).toBeLessThanOrEqual(b.platoon);
        expect(r.opsByManager.factory ?? 0).toBeLessThanOrEqual(b.factory);
        expect(r.opsByManager.defense ?? 0).toBeLessThanOrEqual(b.defense);
        expect(r.opsTotal).toBeLessThanOrEqual(b.total);
      }
      expect(brain.blackboard.threat).toBeInstanceOf(ThreatGrid);
      expect(brain.blackboard.platoons.length).toBeGreaterThan(0);
      expect(rs.some((r) => r.commands.length > 0)).toBe(true);
      expect(streamKey(rs)).toBe(streamKey(play(d).rs));
    });
  }
});
