// Point-defense target priority (ms6.3).
import { describe, expect, it } from 'vitest';
import { fx } from '@faf/fixed';
import { compileContent } from '@faf/blueprints/content';
import { decodeSimBin } from '@faf/blueprints/simbin';
import { EventType } from '@faf/protocol';
import { createWorld, initializeSkirmish, step } from '../src/index.ts';
import { spawnUnit } from '../src/units.ts';
import { quietCorner } from './support/corner.ts';

describe('point defense priorities', () => {
  it('a Riegel I fires at the nearest mobile land enemy in range; only that one is hit', async () => {
    const bp = decodeSimBin((await compileContent({ includeTest: true })).simBin);
    const w = createWorld({ bpTable: bp, seed: 13, armyCount: 2, mapSizeWu: 256 });
    initializeSkirmish(w, { kind: 'skirmish', faction: 0, rules: { unitCap: 100, fog: 'revealed', victory: 'annihilation' } });
    const [cx, cz] = quietCorner(w, bp);
    const pd = spawnUnit(w, bp.indexOf('core:str_t1_pd'), 0, fx(cx) + 2048, fx(cz) + 2048, 0);
    const near = spawnUnit(w, bp.indexOf('core:lnd_t1_tank'), 1, fx(cx), fx(cz + 12), 0);
    const far = spawnUnit(w, bp.indexOf('core:lnd_t1_tank'), 1, fx(cx + 20), fx(cz + 10), 0);
    const turret = bp.mountWeaponCol[bp.firstMount(bp.indexOf('core:str_t1_pd'))]!, full = bp.maxHpCol[bp.indexOf('core:lnd_t1_tank')]!;
    let shots = 0;
    for (let n = 0; n < 60; n++) {
      step(w);
      const E = w.combatEvents.i32;
      for (let e = 0; e < E[0]!; e++) { const o = 1 + e * 11; if (E[o] === EventType.Shot && E[o + 1] === turret && E[o + 9] === w.units.handle(pd)) { shots++; expect(E[o + 8]).toBe(w.units.handle(near)); } }
    }
    expect(shots).toBeGreaterThan(2);
    expect(w.units.col.hp[near]!).toBeLessThan(full);
    expect(w.units.col.hp[far]!).toBe(full);
  });
});
