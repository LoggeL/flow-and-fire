/**
 * Blueprint compiler CLI: `pnpm --filter @faf/blueprints compile [--check]`.
 * Compiles content/blueprints (game bundle: without the test: namespace) and writes
 * content/generated/{sim.bin, view.json, bundle.json, hashes.json}. With --check nothing is
 * written; the exit code is 1 if the generated files are out of date.
 */
import { BlueprintCompileError, hex32 } from '../src/index.ts';
import { compileContent, CONTENT_GENERATED, repoPath, staleGenerated, writeGenerated } from './content.ts';

async function main(): Promise<number> {
  const check = process.argv.includes('--check');
  let result;
  try {
    result = await compileContent({ includeTest: false });
  } catch (e) {
    if (e instanceof BlueprintCompileError) {
      console.error(e.message);
      return 1;
    }
    throw e;
  }
  const summary =
    `${result.units.length} unit(s), ${result.categories.length} categories, ` +
    `simHash ${hex32(result.simHash)}, viewHash ${hex32(result.viewHash)}, sim.bin ${result.simBin.length} B`;
  if (check) {
    const stale = await staleGenerated(result);
    if (stale.length > 0) {
      console.error(`content/generated is out of date: ${stale.join(', ')} (run: pnpm --filter @faf/blueprints compile)`);
      return 1;
    }
    console.log(`content/generated is up to date: ${summary}`);
    return 0;
  }
  await writeGenerated(result);
  console.log(`wrote ${repoPath(CONTENT_GENERATED)}: ${summary}`);
  for (const u of result.units) console.log(`  ${String(u.simId).padStart(3)} ${u.id}  (${u.source})`);
  return 0;
}

process.exitCode = await main();
