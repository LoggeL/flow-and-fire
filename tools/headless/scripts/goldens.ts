/**
 * L2 goldens: `pnpm --filter @faf/headless goldens` checks both scenarios against
 * tools/headless/goldens/*.json; `goldens -- --update` rewrites them and prints the first tick
 * at which the new chain diverges from the old one. A changed chain is only rewritten if
 * SIM_BUILD (@faf/sim) differs from the golden's `simBuild` — otherwise the update is refused.
 */
import { SIM_BUILD } from '@faf/sim';
import { compareChains, goldenJson, goldenUpdateVerdict, toGolden, toHashChain, type Golden } from '../src/goldens.ts';
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

  let golden: Golden | null;
  try {
    golden = readGolden(name);
  } catch (e) {
    if (!update) throw e;
    // Outdated golden format (e.g. v1 without simBuild): replaced as a new golden.
    console.log(`${name}: unreadable golden (${e instanceof Error ? e.message : String(e)}) — replaced`);
    golden = null;
  }
  const next = toGolden(result);
  const diff = golden === null ? null : compareChains(golden, toHashChain(result));
  const line = `${name}: ${result.trail.length} hashes, final rule ${next.finalRuleHash}, full ${next.finalFullHash}, ${result.asserts.length - failed.length}/${result.asserts.length} asserts, ${ms.toFixed(0)} ms`;
  if (update) {
    const v = goldenUpdateVerdict(golden, next);
    if (v.kind === 'needsBump') {
      console.error(
        `${line}\n  ✗ chain changed (first divergent tick ${v.diff.firstDivergentTick}: ${v.diff.detail}) but SIM_BUILD is still ${SIM_BUILD} — bump SIM_BUILD in packages/sim/src/constants.ts, then update again`,
      );
      failures++;
      continue;
    }
    writeText(goldenPath(name), goldenJson(next));
    if (v.kind === 'new') console.log(`${line}\n  new golden written`);
    else if (v.kind === 'unchanged') console.log(`${line}\n  unchanged${golden!.simBuild !== next.simBuild ? ` (simBuild ${golden!.simBuild} → ${next.simBuild})` : ''}`);
    else console.log(`${line}\n  UPDATED for ${SIM_BUILD} — first divergent tick ${v.diff.firstDivergentTick} (${v.diff.detail})`);
  } else if (golden === null) {
    console.error(`${line}\n  ✗ no golden (run with --update)`);
    failures++;
  } else if (golden.simBuild !== SIM_BUILD) {
    console.error(`${line}\n  ✗ golden recorded with simBuild ${golden.simBuild}, code is ${SIM_BUILD} (run with --update)`);
    failures++;
  } else if (!diff!.equal) {
    console.error(`${line}\n  ✗ differs from golden — first divergent tick ${diff!.firstDivergentTick} (${diff!.detail})`);
    failures++;
  } else {
    console.log(`${line}\n  ✓ matches golden`);
  }
}
process.exit(failures === 0 ? 0 : 1);
