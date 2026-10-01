import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { writeRtsReplay } from '@faf/formats';
import { convertCommandLog, HeadlessSim } from '@faf/sim-host';
import { verifyReplayFile } from '../src/replay/verify.ts';
import { loadSimBin, REPO_DIR } from '../scripts/lib.ts';
const simBin = loadSimBin();
function recording() { const sim = new HeadlessSim({ seed: 721, armyCount: 2, simBin, keyframes: false }); sim.runUntil(120); return { log: sim.exportLog(), converted: convertCommandLog(sim.exportLog(), { simBin }) }; }
describe('replay verification CLI', () => {
  it('verifies FAFL and portable files, exposing a changed expected hash', () => {
    const { log, converted } = recording(), assets = { simBin, maps: {} };
    expect(verifyReplayFile(log, assets).divergences).toEqual([]);
    expect(verifyReplayFile(converted.bytes, assets).compared).toBe(12);
    const hashes = converted.input.hashes.hashes.slice(); hashes[4]! ^= 1;
    const result = verifyReplayFile(writeRtsReplay({ ...converted.input, hashes: { ...converted.input.hashes, hashes } }), assets);
    expect(result.divergences).toHaveLength(1); expect(result.divergences[0]!.tick).toBe(50);
  });
  it('returns exit 0 for valid, 1 for divergent and 2 for malformed files', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'faf-replay-cli-'));
    try {
      const { converted } = recording(), hashes = converted.input.hashes.hashes.slice(); hashes[0]! ^= 1;
      const cases = [converted.bytes, writeRtsReplay({ ...converted.input, hashes: { ...converted.input.hashes, hashes } }), Uint8Array.of(1, 2, 3)];
      cases.forEach((bytes, status) => {
        const path = resolve(dir, `${status}.rtsreplay`); writeFileSync(path, bytes);
        const child = spawnSync(process.execPath, ['--import', 'tsx', resolve(REPO_DIR, 'tools/headless/scripts/replay-verify.ts'), path, '--json'], { cwd: REPO_DIR, encoding: 'utf8', timeout: 20000 });
        expect(child.error).toBeUndefined(); expect(child.status, child.stderr).toBe(status);
        expect(JSON.parse(child.stdout)).toHaveLength(1);
      });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
