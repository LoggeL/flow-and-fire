/**
 * `pnpm --filter @faf/assets-pipeline build` (root: `pnpm assets`): builds the asset files and
 * writes them to content/generated/assets (stale files are removed).
 */
import { ASSETS_DIR, buildAssets, writeAssets } from '../src/index.ts';

const t0 = performance.now();
const build = await buildAssets();
const { written, removed } = await writeAssets(build, ASSETS_DIR);
const total = build.files.reduce((n, f) => n + f.bytes.length, 0);
console.log(
  `assets: ${build.files.length} files (${total} B) in content/generated/assets – ${written} written, ${removed} removed, ` +
    `${(performance.now() - t0).toFixed(0)} ms`,
);
for (const [id, e] of Object.entries(build.manifest.assets)) {
  console.log(`  ${e.kind.padEnd(8)} ${id.padEnd(20)} ${e.url} (${e.bytes} B)${e.fallback ? ` + ${e.fallback.url} (${e.fallback.bytes} B)` : ''}`);
}
