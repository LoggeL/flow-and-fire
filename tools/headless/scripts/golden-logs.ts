/**
 * Golden command logs (TRACK-REPLAY p3): `pnpm --filter @faf/headless golden-logs` records every
 * L2 scenario that has a golden (tools/headless/goldens/<scenario>.json) as a FAFL command log and
 * checks it against test/golden-replays/logs/<scenario>.faflog (missing or different → exit 1).
 * `golden-logs -- --update` rewrites the logs, but only if the log replays through the sim host
 * (replayLog) with 0 hash mismatches, exactly the golden trail and the golden's final rule/full
 * hash, and the golden was recorded with the current SIM_BUILD (else: run `goldens -- --update`
 * first).
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseCommandLog, SIM_BUILD } from '@faf/sim-host';
import { checkGoldenLog, recordScenarioLog } from '../src/replay/scenario-log.ts';
import { SCENARIO_NAMES, scenarioByName } from '../src/scenarios.ts';
import { loadMaps, loadSimBin, readGolden, REPO_DIR } from './lib.ts';

const GOLDEN_LOGS_DIR = resolve(REPO_DIR, 'test/golden-replays/logs');

const update = process.argv.includes('--update');
const simBin = loadSimBin();
const maps = loadMaps();
let failures = 0;
let written = 0;

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

for (const name of SCENARIO_NAMES) {
  const golden = readGolden(name);
  if (golden === null) {
    console.log(`${name}: no golden — skipped`);
    continue;
  }
  const path = resolve(GOLDEN_LOGS_DIR, `${name}.faflog`);
  const rel = `test/golden-replays/logs/${name}.faflog`;
  const t0 = performance.now();
  const sc = scenarioByName(name);
  const { log } = recordScenarioLog(sc, { simBin, maps });
  const parsed = parseCommandLog(log);
  const line = `${name}: ${log.length} B, ${parsed.lastTick} ticks, ${parsed.commands.length} CMDS, ${parsed.hashes.length} HASH, ${parsed.marks.length} MARK (${(performance.now() - t0).toFixed(0)} ms)`;

  if (update) {
    if (golden.simBuild !== SIM_BUILD) {
      console.error(`${line}\n  ✗ golden recorded with simBuild ${golden.simBuild}, code is ${SIM_BUILD} — run \`pnpm --filter @faf/headless goldens -- --update\` first`);
      failures++;
      continue;
    }
    const chk = checkGoldenLog(log, golden, sc, { simBin, maps });
    if (!chk.ok) {
      console.error(`${line}\n  ✗ not written: ${chk.problems.join('; ')}`);
      failures++;
      continue;
    }
    const old = existsSync(path) ? new Uint8Array(readFileSync(path)) : null;
    if (old !== null && bytesEqual(old, log)) {
      console.log(`${line}\n  unchanged (verified: ${chk.compared} hashes, final ${golden.finalRuleHash}/${golden.finalFullHash})`);
      continue;
    }
    mkdirSync(GOLDEN_LOGS_DIR, { recursive: true });
    writeFileSync(path, log);
    written++;
    console.log(`${line}\n  ${old === null ? 'written' : 'UPDATED'} ${rel} (verified: ${chk.compared} hashes, 0 mismatches, final ${golden.finalRuleHash}/${golden.finalFullHash})`);
  } else if (!existsSync(path)) {
    console.error(`${line}\n  ✗ ${rel} missing (pnpm --filter @faf/headless golden-logs -- --update)`);
    failures++;
  } else if (!bytesEqual(new Uint8Array(readFileSync(path)), log)) {
    console.error(`${line}\n  ✗ ${rel} differs from a fresh recording (pnpm --filter @faf/headless golden-logs -- --update)`);
    failures++;
  } else {
    console.log(`${line}\n  ✓ ${rel} up to date`);
  }
}
if (update) console.log(`${written} log(s) written`);
process.exit(failures === 0 ? 0 : 1);
