/**
 * FAFL command logs of L2 scenarios (TRACK-REPLAY p3): records a scenario run as the command log
 * the sim host would have written (sim-host CommandLogRecorder, log format v2), so the L2 goldens
 * become replayable test data (golden logs → .rtsreplay golden replays, desync tests, benches).
 *
 * The scenario runs through the regular runner (`runScenario` with the `onBatch` hook), i.e. the
 * hash chain of the log is exactly the golden's. The log is assembled after the run in the order
 * the host records a tick: CMDS (+ the Cheat MARK the recorder derives from a batch with
 * Op.Cheat), then the HASH of that tick, finally END at the last tick.
 *
 * Alliances a scenario sets at match setup (`ScenarioBuilder.ally`) are applied outside the
 * command stream and have no representation in a FAFL log (the .rtsreplay GAME chunk carries
 * them later) — such scenarios are refused with ScenarioLogError.
 *
 * Environment-neutral (Node and browser worker): no node: imports.
 */

import { mapSimHash } from '@faf/formats';
import { HASH_INTERVAL_TICKS } from '@faf/sim';
import { CommandLogRecorder, replayLog, simIdFor, SIM_BUILD, type LogHeader } from '@faf/sim-host';
import { hex32, type Golden } from '../goldens.ts';
import { resolveScenarioMap, runScenario, type RunOptions, type Scenario, type ScenarioResult } from '../scenario.ts';

/** buildHash written into golden logs (not a real build: the logs belong to the repo state). */
export const GOLDEN_LOG_BUILD_HASH = 'golden';

/** A scenario that cannot be expressed as a FAFL command log. */
export class ScenarioLogError extends Error {
  override readonly name = 'ScenarioLogError';
}

export interface ScenarioLogOptions extends RunOptions {
  /** buildHash of the log header (default GOLDEN_LOG_BUILD_HASH). */
  readonly buildHash?: string;
}

export interface ScenarioLog {
  /** The closed FAFL v2 log (END at the scenario's last tick). */
  readonly log: Uint8Array;
  readonly result: ScenarioResult;
}

/**
 * Runs `sc` and records its command log. Throws ScenarioLogError for scenarios with alliances.
 * Deterministic: equal scenario and assets → byte-identical log.
 */
export function recordScenarioLog(sc: Scenario, opts: ScenarioLogOptions): ScenarioLog {
  if (sc.alliances.length > 0) {
    throw new ScenarioLogError(
      `scenario '${sc.name}' sets alliances at match setup (${sc.alliances.map(([a, b]) => `${a}-${b}`).join(', ')}): not representable in a FAFL command log`,
    );
  }
  // Resolve the map once (hash for the header) and hand the parsed map to the runner.
  const map = resolveScenarioMap(sc.map, opts.maps);
  const mh = mapSimHash(map) >>> 0;
  const maps = sc.map.kind === 'file' ? { ...(opts.maps ?? {}), [sc.map.path]: map } : opts.maps;

  const box: { header: LogHeader | null } = { header: null };
  const ticks: number[] = [];
  const batches: Uint8Array[] = [];
  const result = runScenario(sc, {
    ...opts,
    ...(maps !== undefined ? { maps } : {}),
    onWorld: (w) => {
      box.header = {
        simId: simIdFor(w.bp.simHash, mh),
        layoutHash: w.layoutHash >>> 0,
        seed: w.seed >>> 0,
        bpSimHash: w.bp.simHash >>> 0,
        mapSizeWu: w.mapSizeWu,
        armyCount: w.armyCount,
        playerArmy: 0,
        hashInterval: HASH_INTERVAL_TICKS,
        buildHash: opts.buildHash ?? GOLDEN_LOG_BUILD_HASH,
        mapSimHash: mh,
      };
      opts.onWorld?.(w);
    },
    onBatch: (tick, batch) => {
      ticks.push(tick);
      batches.push(batch.slice());
      opts.onBatch?.(tick, batch);
    },
  });
  const header = box.header;
  if (header === null) throw new Error('recordScenarioLog: runner did not report its world');
  const interval = result.hashIntervalTicks;
  if (result.trail.length !== Math.floor(sc.ticks / interval)) {
    throw new Error(`recordScenarioLog: trail of ${result.trail.length} hashes does not cover ${sc.ticks} ticks at interval ${interval}`);
  }

  let bytes = 64;
  for (const b of batches) bytes += b.length + 32;
  const rec = new CommandLogRecorder(header, { initialCapacity: bytes + result.trail.length * 32 });
  let bi = 0;
  let hi = 0;
  for (let t = 1; t <= sc.ticks; t++) {
    if (bi < ticks.length && ticks[bi] === t) {
      rec.commands(t, batches[bi]!);
      bi++;
    }
    if (hi < result.trail.length && (hi + 1) * interval === t) {
      rec.hash(t, result.trail[hi]!);
      hi++;
    }
  }
  return { log: new Uint8Array(rec.export(sc.ticks)), result };
}

/** Outcome of checking a golden log against its golden. */
export interface GoldenLogCheck {
  readonly ok: boolean;
  /** Human readable problems (empty if ok). */
  readonly problems: readonly string[];
  readonly compared: number;
  readonly mismatches: number;
  readonly lastTick: number;
  readonly finalRuleHash: number;
  readonly finalFullHash: number;
}

/**
 * Replays `log` with the sim host (`replayLog`, map of the scenario) and checks it against the
 * golden: SIM_BUILD, 0 hash mismatches, the replayed trail equals the golden trail and the final
 * rule/full hash equal the golden's. Needs the scenario for its map.
 */
export function checkGoldenLog(log: Uint8Array, golden: Golden, sc: Scenario, opts: RunOptions): GoldenLogCheck {
  const problems: string[] = [];
  if (golden.simBuild !== SIM_BUILD) {
    problems.push(`golden recorded with simBuild ${golden.simBuild}, code is ${SIM_BUILD} (pnpm --filter @faf/headless goldens -- --update)`);
  }
  const r = replayLog(log, {
    ...(opts.simBin !== undefined ? { simBin: opts.simBin } : {}),
    ...(opts.bpTable !== undefined ? { bpTable: opts.bpTable } : {}),
    map: resolveScenarioMap(sc.map, opts.maps),
    keyframes: false,
  });
  if (r.log.truncated) problems.push('log is truncated');
  if (r.log.endTick !== golden.ticks) problems.push(`END tick ${r.log.endTick} ≠ golden ticks ${golden.ticks}`);
  if (r.mismatches.length > 0) {
    const m = r.mismatches[0]!;
    problems.push(`${r.mismatches.length} hash mismatches, first at tick ${m.tick}: ${hex32(m.actual)} ≠ recorded ${hex32(m.expected)}`);
  }
  if (r.compared !== golden.trail.length) problems.push(`${r.compared} recorded hashes compared, golden has ${golden.trail.length}`);
  const n = Math.max(r.trail.length, golden.trail.length);
  for (let i = 0; i < n; i++) {
    const a = r.trail[i];
    const g = golden.trail[i];
    if (a === undefined || g === undefined || hex32(a.hash) !== g || a.tick !== (i + 1) * golden.hashIntervalTicks) {
      problems.push(`trail differs from golden at entry ${i} (tick ${a?.tick ?? '–'}: ${a === undefined ? '(missing)' : hex32(a.hash)} ≠ ${g ?? '(missing)'})`);
      break;
    }
  }
  if (hex32(r.ruleHash) !== golden.finalRuleHash) problems.push(`final rule hash ${hex32(r.ruleHash)} ≠ golden ${golden.finalRuleHash}`);
  if (hex32(r.fullHash) !== golden.finalFullHash) problems.push(`final full hash ${hex32(r.fullHash)} ≠ golden ${golden.finalFullHash}`);
  return {
    ok: problems.length === 0,
    problems,
    compared: r.compared,
    mismatches: r.mismatches.length,
    lastTick: r.lastTick,
    finalRuleHash: r.ruleHash,
    finalFullHash: r.fullHash,
  };
}
