import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CommandBatchView, Op, validateBatch } from '@faf/protocol';
import { HASH_INTERVAL_TICKS } from '@faf/sim';
import { HeadlessSim, LOG_VERSION, MarkKind, parseCommandLog, SIM_BUILD, simIdFor } from '@faf/sim-host';
import { checkGoldenLog, GOLDEN_LOG_BUILD_HASH, recordScenarioLog, ScenarioLogError } from '../src/replay/scenario-log.ts';
import { resolveScenarioMap, runScenario, ScenarioBuilder } from '../src/scenario.ts';
import { SCENARIO_NAMES, scenarioByName } from '../src/scenarios.ts';
import { loadMaps, loadSimBin, readGolden, REPO_DIR } from '../scripts/lib.ts';

const LOGS_DIR = resolve(REPO_DIR, 'test/golden-replays/logs');
const HINT = 'pnpm --filter @faf/headless golden-logs -- --update';

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

describe('golden command logs (test/golden-replays/logs)', () => {
  const simBin = loadSimBin();
  const maps = loadMaps();
  const withGolden = SCENARIO_NAMES.filter((n) => readGolden(n) !== null);

  it('every L2 golden has a golden log (and all five MS2 goldens are covered)', () => {
    expect(withGolden).toEqual(expect.arrayContaining(['cubes-1000-move', 'cubes-churn', 'ridge-1000-move', 'ridge-water-block', 'setons-bridge-move']));
    for (const n of withGolden) expect(existsSync(resolve(LOGS_DIR, `${n}.faflog`)), `${n}.faflog (${HINT})`).toBe(true);
  });

  it('no scenario sets alliances (they are not representable in a FAFL log)', () => {
    for (const n of SCENARIO_NAMES) expect(scenarioByName(n).alliances, n).toEqual([]);
    const allied = new ScenarioBuilder('allied').ticks(20).ally(0, 1).spawn({ army: 0, count: 2, x: 100, z: 100, spread: 4 }).build();
    expect(() => recordScenarioLog(allied, { simBin })).toThrow(ScenarioLogError);
  });

  for (const name of withGolden) {
    describe(name, () => {
      const golden = readGolden(name)!;
      const sc = scenarioByName(name);
      const file = new Uint8Array(readFileSync(resolve(LOGS_DIR, `${name}.faflog`)));

      it('parses completely: v2, not truncated, END at the last tick, header = scenario identity', () => {
        const log = parseCommandLog(file);
        expect(log.version).toBe(LOG_VERSION);
        expect(log.truncated).toBe(false);
        expect(log.validBytes).toBe(file.length);
        expect(log.endTick).toBe(golden.ticks);
        expect(log.lastTick).toBe(golden.ticks);
        const h = log.header;
        expect(h.buildHash).toBe(GOLDEN_LOG_BUILD_HASH);
        expect(h.hashInterval).toBe(HASH_INTERVAL_TICKS);
        expect(h.playerArmy).toBe(0);
        expect(h.armyCount).toBe(sc.armyCount);
        expect(h.seed).toBe(sc.seed);
        expect(`0x${h.layoutHash.toString(16).padStart(8, '0')}`).toBe(golden.layoutHash);
        expect(`0x${h.bpSimHash.toString(16).padStart(8, '0')}`).toBe(golden.simHash);
        expect(`0x${h.mapSimHash.toString(16).padStart(8, '0')}`).toBe(golden.mapSimHash);
        expect(h.simId).toBe(simIdFor(h.bpSimHash, h.mapSimHash));
        expect(log.hashes.length).toBe(golden.trail.length);
        // Every batch is valid and stamped with its application tick; Cheat batches carry a Cheat MARK.
        const v = new CommandBatchView();
        let cheatTicks = 0;
        for (const c of log.commands) {
          const b = file.subarray(c.offset, c.offset + c.length);
          expect(validateBatch(b)).toBeGreaterThan(0);
          v.reset(b);
          let cheat = false;
          while (v.next()) {
            expect(v.tick).toBe(c.tick);
            if (v.op === Op.Cheat) cheat = true;
          }
          if (cheat) cheatTicks++;
        }
        expect(log.marks.filter((m) => m.kind === MarkKind.Cheat).length).toBe(cheatTicks);
        expect(log.tainted).toBe(cheatTicks > 0);
      });

      it('replays with 0 mismatches; trail and final rule/full hash equal the golden JSON', () => {
        expect(golden.simBuild, `golden ${name} simBuild (pnpm --filter @faf/headless goldens -- --update, then ${HINT})`).toBe(SIM_BUILD);
        const chk = checkGoldenLog(file, golden, sc, { simBin, maps });
        expect(chk.problems).toEqual([]);
        expect(chk.mismatches).toBe(0);
        expect(chk.compared).toBe(golden.trail.length);
        expect(chk.lastTick).toBe(golden.ticks);
      });

      it('is fresh: recordScenarioLog produces the checked-in bytes, the scenario result is the golden', () => {
        const { log, result } = recordScenarioLog(sc, { simBin, maps });
        expect(bytesEqual(log, file), `${name}.faflog is stale (${HINT})`).toBe(true);
        expect(result.trail.map((h) => `0x${h.toString(16).padStart(8, '0')}`)).toEqual(golden.trail);
      });

      it('equals the log the sim host records for the same command batches', () => {
        const log = parseCommandLog(file);
        const sim = new HeadlessSim({
          simBin,
          seed: sc.seed,
          armyCount: sc.armyCount,
          map: resolveScenarioMap(sc.map, maps),
          buildHash: GOLDEN_LOG_BUILD_HASH,
          keyframes: false,
        });
        let ci = 0;
        for (let t = 1; t <= golden.ticks; t++) {
          const c = log.commands[ci];
          if (c !== undefined && c.tick === t) {
            sim.submit(file.slice(c.offset, c.offset + c.length));
            ci++;
          }
          sim.step(1);
        }
        expect(bytesEqual(sim.exportLog(), file)).toBe(true);
      });
    });
  }

  it('onBatch/onWorld hooks do not change a run and report stamped batches', () => {
    const sc = scenarioByName('cubes-churn');
    const plain = runScenario(sc, { simBin, maps });
    const seen: number[] = [];
    let worlds = 0;
    const hooked = runScenario(sc, {
      simBin,
      maps,
      onWorld: (w) => {
        worlds++;
        expect(w.tick).toBe(0);
      },
      onBatch: (tick, batch) => {
        seen.push(tick);
        const v = new CommandBatchView();
        v.reset(batch);
        while (v.next()) expect(v.tick).toBe(tick);
      },
    });
    expect(worlds).toBe(1);
    expect(hooked.trail).toEqual(plain.trail);
    expect(hooked.finalFullHash).toBe(plain.finalFullHash);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });
});
