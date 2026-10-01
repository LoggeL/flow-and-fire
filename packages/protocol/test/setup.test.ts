import { describe, expect, it } from 'vitest';
import { decodeSkirmishInitialization, encodeSkirmishInitialization, validateSkirmishInitialization, type SkirmishInitialization } from '../src/index.ts';
const setup: SkirmishInitialization = { kind: 'skirmish', faction: 0,
  slots: [{ start: 7, team: 2, faction: 0, controller: 'human' }, { start: 3, team: 4, faction: 0, controller: 'ai', difficulty: 'hard', aixFactorQ16: 98304 }],
  rules: { unitCap: 500, fog: 'revealed', victory: 'supremacy' } };
describe('recorded deterministic skirmish setup', () => {
  it('pins nondefault starts, teams, rules and AI resource factor in integer bytes', () => {
    const bytes = encodeSkirmishInitialization(setup), view = new DataView(bytes.buffer);
    expect(bytes.length).toBe(36); expect(Array.from(bytes.subarray(0, 8))).toEqual([1,0,2,1,244,1,1,1]);
    expect(view.getUint16(12, true)).toBe(7); expect(view.getUint16(24, true)).toBe(3);
    expect(view.getUint32(32, true)).toBe(98304); expect(decodeSkirmishInitialization(bytes)).toEqual(setup);
    validateSkirmishInitialization(setup, 2);
  });
  it('preserves the earlier faction-only opt-in and rejects missing bytes and extra data', () => {
    const minimal: SkirmishInitialization = { kind:'skirmish', faction:3 }, bytes=encodeSkirmishInitialization(minimal);
    expect(decodeSkirmishInitialization(bytes)).toEqual(minimal);
    for(let cut=0;cut<bytes.length;cut++)expect(()=>decodeSkirmishInitialization(bytes.subarray(0,cut))).toThrow();
    expect(()=>decodeSkirmishInitialization(new Uint8Array([...bytes,0]))).toThrow();
  });
  it('rejects duplicate starts, bad controllers, mismatched armies and human AI multipliers', () => {
    expect(()=>validateSkirmishInitialization(setup,3)).toThrow(/count/);
    expect(()=>encodeSkirmishInitialization({...setup,slots:[setup.slots![0]!, {...setup.slots![1]!,start:7}]})).toThrow(/Duplicate/);
    expect(()=>encodeSkirmishInitialization({...setup,slots:[{...setup.slots![0]!,aixFactorQ16:98304}]})).toThrow(/Human/);
    expect(()=>encodeSkirmishInitialization({...setup,slots:[{...setup.slots![0]!,controller:'server' as 'human'}]})).toThrow(/controller/);
  });
  it('rejects reserved and inconsistent encoded values before constructing a session', () => {
    const bytes=encodeSkirmishInitialization(setup);
    for(const offset of [0,3,8,18,28,29]){const bad=bytes.slice();bad[offset]=255;expect(()=>decodeSkirmishInitialization(bad),String(offset)).toThrow();}
    const bad=bytes.slice();bad[2]=16;expect(()=>decodeSkirmishInitialization(bad)).toThrow();
    const absent=encodeSkirmishInitialization({kind:'skirmish',faction:0});absent[4]=1;expect(()=>decodeSkirmishInitialization(absent)).toThrow(/rules/);
  });
});
