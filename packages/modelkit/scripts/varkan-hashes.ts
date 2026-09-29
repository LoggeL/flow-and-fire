/**
 * Prints SHA-256 of every Varkan GLB and metadata JSON (baseline for the byte-equality test
 * packages/modelkit/test/fixtures/varkan.sha256.json). Usage: tsx packages/modelkit/scripts/varkan-hashes.ts [--write]
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { exportGlb, modelMeta } from '../src/index.ts';
import { buildEntry, loadFaction } from '../../../content/models/registry.ts';

const f = await loadFaction('varkan');
const out: Record<string, { glb: string; json: string }> = {};
for (const m of f.models) {
  const built = buildEntry(f, m);
  const glb = await exportGlb(built);
  const sha = createHash('sha256').update(glb).digest('hex');
  const meta = `${JSON.stringify(modelMeta(built, `varkan.${m.unit}.glb`, sha, glb.byteLength), null, 2)}\n`;
  out[m.unit] = { glb: sha, json: createHash('sha256').update(meta).digest('hex') };
}
const text = `${JSON.stringify(out, null, 2)}\n`;
if (process.argv.includes('--write')) writeFileSync(join(import.meta.dirname, '../test/fixtures/varkan.sha256.json'), text);
else process.stdout.write(text);
