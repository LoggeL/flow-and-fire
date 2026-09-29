/**
 * `pnpm --filter @faf/assets-pipeline check`: rebuilds the assets in memory and exits with 1 if the
 * checked-in content/generated/assets differ (missing, changed or stale files).
 */
import { ASSETS_DIR, buildAssets, diffAssets } from '../src/index.ts';

const build = await buildAssets();
const problems = await diffAssets(build, ASSETS_DIR);
if (problems.length > 0) {
  console.error(`content/generated/assets is out of date (run: pnpm assets):\n  ${problems.join('\n  ')}`);
  process.exitCode = 1;
} else {
  console.log(`content/generated/assets is up to date (${build.files.length} files)`);
}
