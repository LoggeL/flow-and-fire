import { describe, expect, it } from 'vitest';
import { requestBurst, requestBurstProblems } from '../src/ms3/request-burst.ts';
import { loadSimBin } from '../scripts/lib.ts';

const simBin = loadSimBin();
describe('shared MS3 request burst', () => {
  for (const size of [512, 1024] as const) {
    it(`${size}: 200 independent requests ready within ten ticks and one 50-unit request`, () => {
      const result = requestBurst(size, simBin, () => 0);
      expect(requestBurstProblems(result)).toEqual([]);
      expect(result.phaseMs.n).toBe(result.ticks);
      expect(requestBurstProblems({ ...result, groupRequests50: 2 })).toHaveLength(1);
      expect(requestBurstProblems({ ...result, phaseMs: { ...result.phaseMs, p95: 6 } })).toEqual([]);
      expect(requestBurstProblems({ ...result, phaseMs: { ...result.phaseMs, p95: 6 } }, true)).toHaveLength(1);
    }, 60_000);
  }
});
