import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readRtsReplay, rewriteRtsReplay, ReplayFlags } from '@faf/formats';
import { ReplayPlayer, SIM_BUILD, verifyReplay } from '@faf/sim-host';
import { hex32 } from '../src/goldens.ts';
import { engineInfo, jobKey, runJob, type JobAssets } from '../src/jobs.ts';
import {
  checkGoldenReplay,
  checkReplayJobResult,
  convertGoldenLog,
  GOLDEN_REPLAY_PATHS,
  GOLDEN_REPLAY_SCENARIOS,
  goldenLogPath,
  goldenMap,
  goldenReplayPath,
  recordedTrail,
  REPLAY_GOLDENS_REGEN_CHAIN,
  REPLAY_GOLDENS_UPDATE_HINT,
  runReplayVerifyJob,
  scenarioOfReplayPath,
} from '../src/replay/xengine-job.ts';
import { SCENARIO_NAMES } from '../src/scenarios.ts';
import { loadMaps, loadReplays, loadSimBin, loadXxh32Wasm, readGolden, REPLAY_PATHS, REPO_DIR } from '../scripts/lib.ts';

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const SEEK_TICK = 1000;

describe('golden replays (test/golden-replays/*.rtsreplay)', () => {
  const simBin = loadSimBin();
  const maps = loadMaps();
  const assets = { simBin, maps };
  const withGolden = SCENARIO_NAMES.filter((n) => readGolden(n) !== null);

  it('every L2 golden JSON has a golden replay; lists of script, lib and worker agree', () => {
    expect([...GOLDEN_REPLAY_SCENARIOS].sort()).toEqual([...withGolden].sort());
    expect(REPLAY_PATHS).toEqual(GOLDEN_REPLAY_PATHS);
    for (const p of GOLDEN_REPLAY_PATHS) expect(existsSync(resolve(REPO_DIR, p)), `${p} (${REPLAY_GOLDENS_UPDATE_HINT})`).toBe(true);
    // The worker's static asset list (Vite needs literal `new URL`s) mirrors GOLDEN_REPLAY_PATHS.
    const worker = readFileSync(resolve(REPO_DIR, 'tools/headless/src/harness/worker-entry.ts'), 'utf8');
    for (const p of GOLDEN_REPLAY_PATHS) {
      expect(worker).toContain(`'${p}': new URL('../../../../${p}', import.meta.url)`);
    }
    expect(scenarioOfReplayPath(goldenReplayPath('x-y'))).toBe('x-y');
  });

  for (const name of GOLDEN_REPLAY_SCENARIOS) {
    describe(name, () => {
      const golden = readGolden(name)!;
      const path = resolve(REPO_DIR, goldenReplayPath(name));
      const file = existsSync(path) ? new Uint8Array(readFileSync(path)) : new Uint8Array(0);

      it('reads; HEAD = current SIM_BUILD and golden identity; META names the scenario', () => {
        const r = readRtsReplay(file, { verifyBlocks: true });
        expect(r.head.simBuild, `HEAD.simBuild of ${name} ≠ SIM_BUILD — regenerate: ${REPLAY_GOLDENS_REGEN_CHAIN}`).toBe(SIM_BUILD);
        expect(golden.simBuild, `golden JSON of ${name} — regenerate: ${REPLAY_GOLDENS_REGEN_CHAIN}`).toBe(SIM_BUILD);
        expect(hex32(r.head.bpSimHash)).toBe(golden.simHash);
        expect(hex32(r.head.layoutHash)).toBe(golden.layoutHash);
        expect(hex32(r.head.mapSimHash)).toBe(golden.mapSimHash);
        expect(r.head.flags & ReplayFlags.Complete).toBe(ReplayFlags.Complete);
        expect(r.head.flags & ReplayFlags.Truncated).toBe(0);
        expect(r.head.subHashInterval).toBe(100);
        expect(r.meta?.extra['scenario']).toBe(name);
        expect(r.meta?.extra['map']).toBe(golden.map);
        expect(r.meta?.endTick).toBe(golden.ticks);
        expect(r.game.armies.map((a) => a.name)).toEqual(r.game.armies.map((_, i) => `Army ${i + 1}`));
        expect(r.unknown).toEqual([]);
      });

      it('HASH trail == golden trail; sub-hashes every 100 ticks', () => {
        const r = readRtsReplay(file);
        expect(r.hashes.interval).toBe(golden.hashIntervalTicks);
        expect(r.hashes.firstTick).toBe(golden.hashIntervalTicks);
        expect(recordedTrail(r)).toEqual(golden.trail);
        expect(r.hashes.subInterval).toBe(100);
        expect(r.hashes.subFirstTick).toBe(100);
        expect(r.hashes.regionNames.length).toBeGreaterThan(0);
        expect(r.hashes.subHashes.length).toBe((golden.ticks / 100) * r.hashes.regionNames.length);
      });

      it('rewriteRtsReplay is byte-identical', () => {
        expect(bytesEqual(rewriteRtsReplay(readRtsReplay(file)), file)).toBe(true);
      });

      it('verifyReplay (map + sim.bin): 0 divergences, final rule/full hash == golden', () => {
        const v = verifyReplay(file, { simBin, map: goldenMap(golden, maps) });
        expect(v.divergences).toEqual([]);
        expect(v.endTick).toBe(golden.ticks);
        expect(v.compared).toBe(golden.trail.length);
        expect(v.subCompared).toBe(golden.ticks / 100);
        expect(hex32(v.ruleHash)).toBe(golden.finalRuleHash);
        expect(hex32(v.fullHash)).toBe(golden.finalFullHash);
      });

      it('fresh: converting the golden log gives exactly the checked-in bytes', () => {
        const log = new Uint8Array(readFileSync(resolve(REPO_DIR, goldenLogPath(name))));
        const conv = convertGoldenLog(log, golden, assets);
        expect(conv.warnings).toEqual([]);
        expect(conv.verified).toBe(true);
        expect(conv.mismatches).toEqual([]);
        expect(bytesEqual(conv.bytes, file), `${goldenReplayPath(name)} is stale (${REPLAY_GOLDENS_UPDATE_HINT})`).toBe(true);
        const chk = checkGoldenReplay(file, golden, assets);
        expect(chk.problems).toEqual([]);
      });

      it(`backward seek to tick ${SEEK_TICK} after playToEnd: full hash == direct run`, () => {
        const map = goldenMap(golden, maps);
        const direct = ReplayPlayer.open(file, { simBin, map, keyframes: false });
        direct.runUntil(SEEK_TICK);
        const directRule = direct.ruleHash();
        const directFull = direct.fullHash();

        const p = ReplayPlayer.open(file, { simBin, map, keyframes: {} });
        const end = p.playToEnd();
        expect(hex32(end.fullHash)).toBe(golden.finalFullHash);
        const restores = p.restores;
        p.seek(SEEK_TICK);
        expect(p.tick).toBe(SEEK_TICK);
        expect(p.restores).toBe(restores + 1);
        expect(hex32(p.fullHash())).toBe(hex32(directFull));
        expect(hex32(p.ruleHash())).toBe(hex32(directRule));
        const again = p.playToEnd();
        expect(again.divergences).toEqual([]);
        expect(hex32(again.fullHash)).toBe(golden.finalFullHash);
      });
    });
  }

  it('cross-engine job in Node: every golden replay plays bit-identically incl. backward seek', async () => {
    const replays = loadReplays();
    const jobAssets: JobAssets = { simBin, xxh32Wasm: loadXxh32Wasm(), maps, replays };
    const clock = (): number => performance.now();
    const env = { clock, info: engineInfo('node', clock) };
    for (const p of GOLDEN_REPLAY_PATHS) {
      const scenario = scenarioOfReplayPath(p);
      const golden = readGolden(scenario)!;
      const job = { kind: 'replayVerify', replay: p } as const;
      expect(jobKey(job)).toBe(`replay-${scenario}`);
      const r = await runJob(job, 'measure', jobAssets, env);
      if (r.kind !== 'replayVerify') throw new Error(`unexpected result kind ${r.kind}`);
      expect(r.replay).toBe(p);
      const replay = readRtsReplay(replays[p]!);
      const chk = checkReplayJobResult(r, { firstTick: replay.hashes.firstTick, interval: replay.hashes.interval, trail: recordedTrail(replay) }, golden);
      expect(chk.problems, scenario).toEqual([]);
      expect(r.seekTick).toBe(golden.ticks / 2);
      expect(r.subCompared).toBe(golden.ticks / 100);
      expect(r.keyframes).toBeGreaterThanOrEqual(4);
      // JSON round trip (worker → page → spec): the result is plain data.
      expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    }
    await expect(runJob({ kind: 'replayVerify', replay: 'nope.rtsreplay' }, 'measure', jobAssets, env)).rejects.toThrow(/not provided/);
  }, 180_000);

  it('checkReplayJobResult reports a changed trail, final hash and seek mismatch', () => {
    const golden = readGolden('cubes-churn')!;
    const bytes = new Uint8Array(readFileSync(resolve(REPO_DIR, goldenReplayPath('cubes-churn'))));
    const r = runReplayVerifyJob(bytes, assets);
    const rec = { firstTick: 10, interval: 10, trail: golden.trail };
    expect(checkReplayJobResult(r, rec, golden).equal).toBe(true);
    const trail = r.trail.slice();
    trail[41] = '0x00000000';
    const bad = checkReplayJobResult({ ...r, trail, seekFullHash: '0x00000001' }, rec, golden);
    expect(bad.equal).toBe(false);
    expect(bad.firstDivergentTick).toBe(420);
    expect(bad.problems.some((m) => m.includes('after the seek'))).toBe(true);
    // A restore error in derived state that heals by the end: only the mid comparison sees it.
    expect(r.seekMidFullHash).toBe(r.directMidFullHash);
    const mid = checkReplayJobResult({ ...r, seekMidFullHash: '0x00000002' }, rec, golden);
    expect(mid.equal).toBe(false);
    expect(mid.firstDivergentTick).toBe(r.seekTick);
    expect(mid.problems.some((m) => m.includes('right after the seek') && m.includes('direct run'))).toBe(true);
  });

  it('checkGoldenReplay flags a replay whose HASH chunk was tampered with', () => {
    const golden = readGolden('ridge-water-block')!;
    const bytes = new Uint8Array(readFileSync(resolve(REPO_DIR, goldenReplayPath('ridge-water-block'))));
    const other = readGolden('cubes-1000-move')!;
    // Right file, wrong golden: identity/trail/final hashes differ.
    const chk = checkGoldenReplay(bytes, { ...golden, trail: other.trail, finalFullHash: other.finalFullHash }, assets);
    expect(chk.ok).toBe(false);
    expect(chk.problems.some((m) => m.startsWith('HASH trail differs'))).toBe(true);
    expect(chk.problems.some((m) => m.startsWith('final full hash'))).toBe(true);
    expect(checkGoldenReplay(bytes.subarray(0, 100), golden, assets).problems[0]).toMatch(/^unreadable/);
  });
});
