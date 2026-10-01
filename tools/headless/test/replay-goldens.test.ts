import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readRtsReplay, rewriteRtsReplay } from '@faf/formats';
import { convertCommandLog, ReplayPlayer, SIM_BUILD } from '@faf/sim-host';
import { hex32 } from '../src/goldens.ts';
import { resolveScenarioMap } from '../src/scenario.ts';
import { scenarioByName } from '../src/scenarios.ts';
import { runReplayVerifyJob } from '../src/replay/xengine-job.ts';
import { REPLAY_PATHS } from '../src/replay/assets.ts';
import { loadMaps, loadSimBin, readGolden, REPO_DIR } from '../scripts/lib.ts';

const hint = 'pnpm --filter @faf/headless replay-goldens -- --update';
const assets = { simBin: loadSimBin(), maps: loadMaps() };
describe('golden portable replays', () => {
  for (const path of REPLAY_PATHS) {
    const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.rtsreplay$/, '');
    it(`${name}: current build, fresh bytes, complete hash trail and backward seek`, () => {
      const golden = readGolden(name);
      expect(golden, `missing golden ${name}`).not.toBeNull();
      const file = resolve(REPO_DIR, path);
      expect(existsSync(file), `${path}: ${hint}`).toBe(true);
      const bytes = new Uint8Array(readFileSync(file));
      const replay = readRtsReplay(bytes);
      expect(replay.head.simBuild, `stale build: ${hint}`).toBe(SIM_BUILD);
      expect(replay.meta?.extra['scenario']).toBe(name);
      expect(Array.from(replay.hashes.hashes, hex32)).toEqual(golden!.trail);
      expect(rewriteRtsReplay(replay)).toEqual(bytes);
      const map = resolveScenarioMap(scenarioByName(name).map, assets.maps);
      const log = new Uint8Array(readFileSync(resolve(REPO_DIR, 'test/golden-replays/logs', `${name}.faflog`)));
      const converted = convertCommandLog(log, { simBin: assets.simBin, map, meta: { extra: { scenario: name } } });
      expect(converted.verified).toBe(true);
      expect(converted.bytes, `stale fixture: ${hint}`).toEqual(bytes);
      const result = runReplayVerifyJob(bytes, assets);
      expect(result.divergences).toEqual([]);
      expect(result.trail).toEqual(golden!.trail);
      expect(result.compared).toBe(golden!.trail.length);
      expect(result.subCompared).toBe(replay.hashes.subHashes.length / replay.hashes.regionNames.length);
      expect(result.finalRuleHash).toBe(golden!.finalRuleHash);
      expect(result.finalFullHash).toBe(golden!.finalFullHash);
      expect(result.seekFullHash).toBe(result.finalFullHash);
      const player = ReplayPlayer.open(replay, { simBin: assets.simBin, map });
      const seekTick = Math.min(1000, player.endTick);
      player.runUntil(seekTick);
      const expected = player.fullHash();
      player.playToEnd();
      player.seek(seekTick);
      expect(player.fullHash()).toBe(expected);
    }, 120_000);
  }
});
