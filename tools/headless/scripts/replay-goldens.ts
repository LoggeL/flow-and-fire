/** Build portable replay fixtures only from verified logs of the current simulation. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { convertCommandLog, ReplayPlayer, SIM_BUILD } from '@faf/sim-host';
import { readRtsReplay, replaySizeReport } from '@faf/formats';
import { SCENARIO_NAMES, scenarioByName } from '../src/scenarios.ts';
import { resolveScenarioMap } from '../src/scenario.ts';
import { loadMaps, loadSimBin, readGolden, REPO_DIR } from './lib.ts';
const update = process.argv.includes('--update'), simBin = loadSimBin(), maps = loadMaps();
const directory = resolve(REPO_DIR, 'test/golden-replays');
let failures = 0;
for (const name of SCENARIO_NAMES) {
  try {
    const golden = readGolden(name); if (golden === null || golden.simBuild !== SIM_BUILD) throw new Error('Run goldens -- --update first');
    const map = resolveScenarioMap(scenarioByName(name).map, maps);
    const log = new Uint8Array(readFileSync(resolve(directory, 'logs', `${name}.faflog`)));
    const c = convertCommandLog(log, { simBin, map, meta: { extra: { scenario: name } } });
    if (!c.verified) throw new Error(`Conversion did not verify: ${c.warnings.join('; ')} ${c.mismatches.length} mismatches`);
    const r = readRtsReplay(c.bytes), player = ReplayPlayer.open(r, { simBin, map, keyframes: false }), result = player.playToEnd();
    const hex = (n: number): string => `0x${(n >>> 0).toString(16).padStart(8, '0')}`;
    if (result.divergences.length || hex(result.ruleHash) !== golden.finalRuleHash || hex(result.fullHash) !== golden.finalFullHash ||
      r.hashes.hashes.length !== golden.trail.length || r.hashes.hashes.some((h, i) => hex(h) !== golden.trail[i])) throw new Error('Replay disagrees with golden hashes');
    const path = resolve(directory, `${name}.rtsreplay`);
    const equal = existsSync(path) && Buffer.from(readFileSync(path)).equals(c.bytes);
    if (!equal && update) { mkdirSync(directory, { recursive: true }); writeFileSync(path, c.bytes); }
    else if (!equal) throw new Error('Missing or stale replay. Run replay-goldens -- --update');
    const size = replaySizeReport(c.bytes);
    console.log(`${name}: ${size.total} B, CMDS ${size.byChunk['CMDS']} B, ${result.compared} hashes verified, ${equal ? 'unchanged' : 'written'}`);
  } catch (error) { console.error(`${name}: ${error instanceof Error ? error.message : String(error)}`); failures++; }
}
process.exitCode = failures === 0 ? 0 : 1;
