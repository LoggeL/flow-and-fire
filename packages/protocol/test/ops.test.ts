import { describe, expect, it } from 'vitest';
import { CheatSub, CmdFlags, Op, isOp, opName } from '../src/index.ts';

describe('opcodes (append-only)', () => {
  it('pins every opcode value', () => {
    expect(Op).toEqual({
      Move: 1,
      AttackMove: 2,
      Attack: 3,
      AttackGround: 4,
      Patrol: 5,
      Guard: 6,
      Assist: 7,
      Build: 8,
      Repair: 9,
      Reclaim: 10,
      Upgrade: 11,
      FactoryQueue: 12,
      FactoryRepeat: 13,
      SetRally: 14,
      FireState: 15,
      TogglePause: 16,
      SetPriority: 17,
      ToggleAbility: 18,
      Overcharge: 19,
      SelfDestruct: 20,
      Stop: 21,
      FormationMove: 22,
      GroupMove: 23,
      Cheat: 250,
    });
    expect(CheatSub).toEqual({ Spawn: 1, Kill: 2, Footprint: 3 });
    expect(CmdFlags).toEqual({ Queue: 1 });
  });

  it('values are unique u8 and names resolve', () => {
    const vals = Object.values(Op);
    expect(new Set(vals).size).toBe(vals.length);
    for (const v of vals) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(256);
      expect(isOp(v)).toBe(true);
    }
    expect(isOp(0)).toBe(false);
    expect(isOp(24)).toBe(false);
    expect(opName(Op.Move)).toBe('Move');
    expect(opName(Op.Cheat)).toBe('Cheat');
    expect(opName(99)).toBe('op#99');
  });
});
