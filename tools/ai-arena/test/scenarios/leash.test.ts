import { describe, expect, it } from 'vitest';
import { createBrain, encodePosition, intelManager, platoonManager } from '@faf/ai';
import { asArmyId, asHandle, asTick } from '@faf/fixed';
import { Op, type CommandEnvelope } from '@faf/protocol';
import { runMatch } from '../../src/match/index.ts';
import { createScenario } from '../../src/scenarios/index.ts';

describe('AI-PLT-04 dynamic commander bait', () => {
  it('survives 180 seconds and stays within 60 WU of its factory while scouts retreat into twelve tanks', () => {
    // Run real movement, damage, fog and command lead in the arena. Isolate the combat managers
    // so opening construction cannot move the factory that defines this scenario's leash.
    const brain = createBrain({ managers: [intelManager, platoonManager] });
    const scenario = createScenario({
      map: 'hollow-ridge', seed: 7, until: 1800,
      sides: [{ army: 0, profile: 'normal', opening: 'eco_standard', brain }],
    });
    const world = scenario.world;
    const commander = [...world.units.values()].find((u) => u.army === 0)!;
    const start = { x: commander.x, z: commander.z };
    const forward = brain.analysis.forward;
    const at = (distance: number, side = 0) => ({
      x: start.x + forward.x * distance - forward.z * side,
      z: start.z + forward.z * distance + forward.x * side,
    });
    const bp = (category: string) => world.setup.bps.list.find((b) =>
      b.tech === 1 && b.categoryNames.includes(category) && b.categoryNames.includes('LAND'))!;
    const factory = world.spawn(0, bp('FACTORY').id, start.x, start.z);
    Object.assign(commander, at(48));
    const scouts = [-2, 0, 2].map((side) => {
      const p = at(59, side);
      return world.spawn(1, bp('SCOUT').id, p.x, p.z);
    });
    const tanks: number[] = [];
    for (let i = 0; i < 12; i++) {
      const p = at(90 + Math.floor(i / 4) * 2, (i % 4 - 1.5) * 2);
      tanks.push(world.spawn(1, bp('TANK').id, p.x, p.z));
    }
    world.updateVisibility();
    const retreat = at(95);
    const bait: CommandEnvelope = {
      tick: asTick(1), army: asArmyId(1), seq: 1, op: Op.Move, flags: 0,
      units: scouts.map(asHandle), payload: encodePosition(retreat.x, retreat.z),
    };
    let maxDistance = 0;
    let damageSeen = false;
    let scoutRetreated = false;
    const result = runMatch({
      world, maxTicks: 1800,
      sides: [...scenario.sides, { army: 1, source: { commandsFor: (tick) => tick === 1 ? [bait] : [] } }],
      onTick: (w) => {
        const home = w.units.get(factory)!;
        maxDistance = Math.max(maxDistance, Math.hypot(commander.x - home.x, commander.z - home.z));
        damageSeen ||= commander.hp < w.blueprint(commander).hpEff;
        scoutRetreated ||= scouts.some((id) => {
          const scout = w.units.get(id);
          return scout !== undefined && Math.hypot(scout.x - start.x, scout.z - start.z) > 60;
        });
      },
    });
    expect(damageSeen, 'the bait must actually damage the commander').toBe(true);
    expect(scoutRetreated, 'at least one living scout must retreat beyond the leash').toBe(true);
    expect(result.metrics.endTick).toBe(1800);
    expect(result.world.units.has(commander.handle)).toBe(true);
    expect(maxDistance).toBeLessThanOrEqual(60);
    expect(tanks.filter((id) => result.world.units.has(id))).toHaveLength(12);
  });
});
