import { describe, expect, it } from 'vitest';
import { BattleScenario } from '../src/demo/scenario.ts';
import { DEFAULT_EVENT_TYPES } from '@faf/audio/events';
describe('battle scenario', () => {
  it.each([20, 200, 400])('emits %i shots/s within 5 percent', rate => { const s = new BattleScenario({ seconds: 10, fps: 60, shotsPerSecond: rate }); for (let i = 0; i < 100; i++) s.nextTick(); expect(s.counts.weaponFire).toBeCloseTo(rate * 10, 0); expect(s.counts.impacts).toBeGreaterThan(rate * 5); });
  it('reuses a batch and repeats the exact stream for a seed', () => { const opts = { seconds: 10, fps: 60, shotsPerSecond: 200, seed: 91 }; const a = new BattleScenario(opts), b = new BattleScenario(opts); const batch = a.batch; for (let i = 0; i < 100; i++) { expect(a.nextTick()).toBe(batch); b.nextTick(); expect(a.batch.events.slice(0, a.batch.count)).toEqual(b.batch.events.slice(0, b.batch.count)); } });
  it('delays impacts until projectiles have travelled', () => { const s = new BattleScenario({ seconds: 10, fps: 60, shotsPerSecond: 200 }); expect(s.nextTick().events.slice(0, s.batch.count).filter(e => e.type === DEFAULT_EVENT_TYPES.projectileImpact)).toHaveLength(0); for (let i = 0; i < 5; i++) s.nextTick(); expect(s.counts.impacts).toBeGreaterThan(0); });
});
