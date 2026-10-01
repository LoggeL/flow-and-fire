import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { convertCommandLog, HeadlessSim } from '@faf/sim-host';
import { benchmarkPreparedReplay, type ReplayBenchmarkBaseline } from '../src/replay/replay-bench.ts';
import { loadMaps, loadSimBin, REPO_DIR } from '../scripts/lib.ts';
const assets = { simBin: loadSimBin(), maps: loadMaps() };
function fixture() {
  const sim = new HeadlessSim({ simBin: assets.simBin, map: assets.maps['content/maps/hollow-ridge.rtsmap']!, seed: 8721, armyCount: 2, keyframes: false });
  sim.runUntil(120); const converted = convertCommandLog(sim.exportLog(), { simBin: assets.simBin, map: sim.map });
  const baseline: ReplayBenchmarkBaseline = { minutes: 0.2, ticks: 120, ruleHash: sim.ruleHash(), fullHash: sim.fullHash(),
    hashCount: converted.input.hashes.hashes.length, subHashCount: 1 };
  return { bytes: converted.bytes, baseline };
}
describe('isolated replay benchmark', () => {
  it('runs cold and warm in separate child processes using prewritten baselines and checks every seek hash', () => {
    const { bytes, baseline } = fixture(), dir = mkdtempSync(resolve(tmpdir(), 'faf-replay-measure-test-'));
    try {
      const replay = resolve(dir, 'fixture.rtsreplay'), original = resolve(dir, 'baseline.json');
      writeFileSync(replay, bytes); writeFileSync(original, JSON.stringify(baseline));
      const results = ['cold', 'warm'].map((mode) => {
        const child = spawnSync(process.execPath, ['--import', 'tsx', resolve(REPO_DIR, 'tools/headless/scripts/replay-bench-worker.ts'), mode, replay, original],
          { cwd: REPO_DIR, encoding: 'utf8', timeout: 20000 });
        expect(child.error).toBeUndefined(); expect(child.status, child.stderr).toBe(0);
        return JSON.parse(child.stdout) as ReturnType<typeof benchmarkPreparedReplay> & { pid: number };
      });
      expect(results[0]!.pid).not.toBe(process.pid); expect(results[1]!.pid).not.toBe(results[0]!.pid);
      for (const result of results) { expect(result.playback.ruleHash).toBe(baseline.ruleHash); expect(result.playback.fullHash).toBe(baseline.fullHash); expect(result.playback.compared).toBe(12); expect(result.playback.subCompared).toBe(1); }
      expect(results[0]!.seek).toBeNull(); expect(results[1]!.seek!.samples).toHaveLength(20);
      for (const sample of results[1]!.seek!.samples) { expect(sample.ruleHash).toBe(sample.expectedRuleHash); expect(sample.fullHash).toBe(sample.expectedFullHash); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('rejects an original full-hash mismatch and incomplete hash coverage', () => {
    const { bytes, baseline } = fixture();
    const options = { mode: 'cold' as const, clock: () => performance.now() };
    expect(() => benchmarkPreparedReplay(bytes, { ...baseline, fullHash: baseline.fullHash ^ 1 }, assets, options)).toThrow('original recording');
    expect(() => benchmarkPreparedReplay(bytes, { ...baseline, hashCount: baseline.hashCount + 1 }, assets, options)).toThrow('every recorded hash');
  });
});
