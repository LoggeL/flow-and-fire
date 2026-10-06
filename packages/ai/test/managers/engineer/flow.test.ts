/**
 * The four build managers together over several game minutes on a tiny scripted world (no arena):
 * builds finish after a fixed time, factories produce their queue and loop, upgrades finish, the
 * economy is a coarse function of the own structures. Checks integration invariants: the opening
 * hands over, expansions happen, no two own structures overlap, budgets hold, determinism.
 */
import { describe, expect, it } from 'vitest';
import { T, streamKey } from './build-support.ts';
import { play, type ToyWorld } from './flow-play.ts';

function overlappingStructures(toy: ToyWorld): number {
  const w = toy.w;
  const s = w.ownHandles().map((h) => w.own(h)).filter((u) => T.list[u.bp]!.isStructure);
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    for (let j = i + 1; j < s.length; j++) {
      const a = s[i]!;
      const b = s[j]!;
      const fa = T.list[a.bp]!.footprint;
      const fb = T.list[b.bp]!.footprint;
      if (Math.abs(a.x - b.x) * 2 < fa[0] + fb[0] - 1e-9 && Math.abs(a.z - b.z) * 2 < fa[1] + fb[1] - 1e-9) n++;
    }
  }
  return n;
}

describe('build managers together (toy world)', () => {
  for (const [map, opening] of [
    ['setons', 'eco_standard'],
    ['hollow-ridge', 'land_rush'],
    ['setons', 'tech_greed'],
  ] as const) {
    it(`${opening} on ${map}: handoff, expansion, no overlaps, budgets hold`, () => {
      const { brain, toy, results } = play(map, opening, 1200);
      const bb = brain.blackboard;
      expect(bb.opening.handedOffAcu).toBe(true);
      expect(bb.opening.active).toBe(false);
      expect(bb.opening.handedOffEngineers.length).toBeGreaterThanOrEqual(3);
      const mexCount = toy.w.ownHandles().filter((h) => T.list[toy.w.own(h).bp]!.categoryNames.includes('MASSEXTRACTION')).length;
      expect(mexCount).toBeGreaterThanOrEqual(map === 'setons' ? 12 : 6);
      expect(overlappingStructures(toy)).toBe(0);
      const p = brain.profile.budget;
      for (const r of results) {
        expect(r.opsByManager.engineer ?? 0).toBeLessThanOrEqual(p.engineer);
        expect(r.opsByManager.economy ?? 0).toBeLessThanOrEqual(p.economy);
        expect(r.opsByManager.tech ?? 0).toBeLessThanOrEqual(p.tech);
        expect(r.opsTotal).toBeLessThanOrEqual(p.total);
      }
      // T2 started within the 10 simulated minutes.
      expect(bb.telemetry.first('techStart')).toBeDefined();
      expect(bb.engineerTarget).toBeGreaterThan(0);
    });
  }

  it('deterministic: same seed and world ⇒ identical command stream', () => {
    const a = play('hollow-ridge', 'eco_standard', 400);
    const b = play('hollow-ridge', 'eco_standard', 400);
    expect(a.results.map((r) => streamKey(r.commands)).join('#')).toBe(b.results.map((r) => streamKey(r.commands)).join('#'));
  });
});
