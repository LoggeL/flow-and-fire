/**
 * Golden replays (TRACK-REPLAY p6): `pnpm --filter @faf/headless replay-goldens` converts every
 * golden command log (test/golden-replays/logs/<scenario>.faflog, p3) with convertCommandLog
 * (map of the golden JSON, content/generated/sim.bin, sub-hashes on, META extra.scenario) and
 * checks the result against test/golden-replays/<scenario>.rtsreplay (missing or different →
 * exit 1 with the update hint). Both modes also check the replay against the golden JSON
 * (HEAD.simBuild == SIM_BUILD, HASH trail, playback with 0 divergences and the golden's final
 * rule/full hash).
 *
 * `replay-goldens -- --update` writes a file only if the conversion is verified (every recorded
 * hash re-simulated, 0 mismatches), its trail and final hashes equal the golden JSON and
 * HEAD.simBuild == SIM_BUILD. After a SIM_BUILD bump: goldens → golden-logs → replay-goldens, each
 * with `-- --update`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { replaySizeReport } from '@faf/formats';
import {
  checkGoldenReplay,
  convertGoldenLog,
  GOLDEN_REPLAY_SCENARIOS,
  goldenLogPath,
  goldenReplayPath,
  REPLAY_GOLDENS_REGEN_CHAIN,
  REPLAY_GOLDENS_UPDATE_HINT,
} from '../src/replay/xengine-job.ts';
import { SCENARIO_NAMES } from '../src/scenarios.ts';
import { GOLDEN_REPLAYS_DIR, loadMaps, loadSimBin, readGolden, REPO_DIR } from './lib.ts';

const update = process.argv.includes('--update');
const simBin = loadSimBin();
const maps = loadMaps();
const assets = { simBin, maps };
let failures = 0;
let written = 0;

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Every scenario with a golden JSON must have a golden replay (and nothing else is listed).
const withGolden = SCENARIO_NAMES.filter((n) => readGolden(n) !== null);
const missingInList = withGolden.filter((n) => !GOLDEN_REPLAY_SCENARIOS.includes(n));
const extraInList = GOLDEN_REPLAY_SCENARIOS.filter((n) => !withGolden.includes(n));
if (missingInList.length > 0 || extraInList.length > 0) {
  console.error(
    `✗ GOLDEN_REPLAY_SCENARIOS (src/replay/xengine-job.ts) does not match the goldens: missing ${missingInList.join(', ') || '–'}, without golden ${extraInList.join(', ') || '–'}` +
      ' (also update REPLAY_URLS in src/harness/worker-entry.ts)',
  );
  failures++;
}

for (const name of GOLDEN_REPLAY_SCENARIOS) {
  const golden = readGolden(name);
  if (golden === null) continue;
  const logRel = goldenLogPath(name);
  const logFile = resolve(REPO_DIR, logRel);
  const rel = goldenReplayPath(name);
  const path = resolve(REPO_DIR, rel);
  if (!existsSync(logFile)) {
    console.error(`${name}: ✗ ${logRel} missing (pnpm --filter @faf/headless golden-logs -- --update)`);
    failures++;
    continue;
  }
  const t0 = performance.now();
  const conv = convertGoldenLog(new Uint8Array(readFileSync(logFile)), golden, assets);
  const convMs = performance.now() - t0;
  const size = replaySizeReport(conv.bytes);
  const h = conv.input.hashes;
  const line =
    `${name}: ${conv.bytes.length} B (CMDS ${size.cmdsStoredBytes} B in ${size.blocks} blocks, HASH ${size.byChunk['HASH'] ?? 0} B), ` +
    `${conv.lastTick} ticks, ${conv.input.commands.length} command ticks, ${h.hashes.length} hashes, ${Math.floor(h.subHashes.length / Math.max(1, h.regionNames.length))}×${h.regionNames.length} sub-hashes, ` +
    `${conv.input.marks.length} marks (convert ${convMs.toFixed(0)} ms)`;

  const problems: string[] = [];
  for (const w of conv.warnings) problems.push(`conversion warning: ${w}`);
  if (!conv.verified) problems.push(`conversion not verified (${conv.compared} hashes compared, ${conv.mismatches.length} mismatches)`);
  const t1 = performance.now();
  const chk = checkGoldenReplay(conv.bytes, golden, assets);
  const checkMs = performance.now() - t1;
  problems.push(...chk.problems);
  const verified = `verified: ${conv.compared} hashes + ${chk.verify?.subCompared ?? 0} sub-hash rows, 0 divergences, final ${golden.finalRuleHash}/${golden.finalFullHash}, playback ${checkMs.toFixed(0)} ms`;

  if (update) {
    if (problems.length > 0) {
      console.error(`${line}\n  ✗ not written: ${problems.join('; ')}`);
      failures++;
      continue;
    }
    const old = existsSync(path) ? new Uint8Array(readFileSync(path)) : null;
    if (old !== null && bytesEqual(old, conv.bytes)) {
      console.log(`${line}\n  unchanged (${verified})`);
      continue;
    }
    mkdirSync(GOLDEN_REPLAYS_DIR, { recursive: true });
    writeFileSync(path, conv.bytes);
    written++;
    console.log(`${line}\n  ${old === null ? 'written' : 'UPDATED'} ${rel} (${verified})`);
    continue;
  }

  if (!existsSync(path)) {
    console.error(`${line}\n  ✗ ${rel} missing (${REPLAY_GOLDENS_UPDATE_HINT})`);
    failures++;
  } else if (!bytesEqual(new Uint8Array(readFileSync(path)), conv.bytes)) {
    console.error(`${line}\n  ✗ ${rel} differs from a fresh conversion of ${logRel} (${REPLAY_GOLDENS_UPDATE_HINT})`);
    failures++;
  } else if (problems.length > 0) {
    console.error(`${line}\n  ✗ ${rel} is fresh but does not match the golden: ${problems.join('; ')}\n  ${REPLAY_GOLDENS_REGEN_CHAIN}`);
    failures++;
  } else {
    console.log(`${line}\n  ✓ ${rel} up to date (${verified})`);
  }
}
if (update) console.log(`${written} replay(s) written`);
process.exit(failures === 0 ? 0 : 1);
