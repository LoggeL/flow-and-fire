/**
 * L2 goldens: `pnpm --filter @faf/headless goldens` checks both scenarios against
 * tools/headless/goldens/*.json; `goldens -- --update` rewrites them and prints the first tick
 * at which the new chain diverges from the old one.
 */
import { compareChains, goldenJson, toGolden, toHashChain } from '../src/goldens.ts';
import { failedAsserts, runScenario } from '../src/scenario.ts';
import { SCENARIO_NAMES, scenarioByName } from '../src/scenarios.ts';
import { goldenPath, loadSimBin, readGolden, writeText } from './lib.ts';

const update = process.argv.includes('--update');
const simBin = loadSimBin();
let failures = 0;

for (const name of SCENARIO_NAMES) {
  const t0 = performance.now();
  const result = runScenario(scenarioByName(name), { simBin });
  const ms = performance.now() - t0;
  const failed = failedAsserts(result);
  for (const a of failed) console.error(`  ✗ ${name} @${a.tick} ${a.name}: ${a.detail ?? ''}`);
  if (failed.length > 0) failures++;

  const golden = readGolden(name);
  const diff = golden === null ? null : compareChains(golden, toHashChain(result));
  const line = `${name}: ${result.trail.length} hashes, final rule ${toGolden(result).finalRuleHash}, full ${toGolden(result).finalFullHash}, ${result.asserts.length - failed.length}/${result.asserts.length} asserts, ${ms.toFixed(0)} ms`;
  if (update) {
    writeText(goldenPath(name), goldenJson(toGolden(result)));
    if (golden === null) console.log(`${line}\n  new golden written`);
    else if (diff!.equal) console.log(`${line}\n  unchanged`);
    else console.log(`${line}\n  UPDATED — first divergent tick ${diff!.firstDivergentTick} (${diff!.detail})`);
  } else if (golden === null) {
    console.error(`${line}\n  ✗ no golden (run with --update)`);
    failures++;
  } else if (!diff!.equal) {
    console.error(`${line}\n  ✗ differs from golden — first divergent tick ${diff!.firstDivergentTick} (${diff!.detail})`);
    failures++;
  } else {
    console.log(`${line}\n  ✓ matches golden`);
  }
}
process.exit(failures === 0 ? 0 : 1);
