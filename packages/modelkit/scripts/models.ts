/**
 * `pnpm models`: builds every model under content/models/<faction>/*.ts into content/models/dist/
 *   <faction>.<unit>.glb   glTF 2.0 binary (LOD0–2, merged parts)
 *   <faction>.<unit>.json  metadata (bounds, footprint check, tris per LOD, part pivots, material areas)
 *   manifest.json          all factions + metadata
 * and the strategic icon SVGs (content/icons/svg, see content/icons/README.md).
 *
 * Options: --check (build + validate, write nothing), --faction <slug> (only print this faction; all are built),
 *          --out <dir>. Exit code 1 on model errors (budgets, invalid geometry, part limits).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { exportGlb, modelMeta, paletteSlots, type Manifest, type ManifestFaction, type ModelMeta } from '../src/index.ts';
import { writeIcons } from '../../../content/icons/build.ts';
import { buildEntry, DIST_DIR, loadAll, REPO_ROOT } from '../../../content/models/registry.ts';

const { values } = parseArgs({
  options: {
    check: { type: 'boolean', default: false },
    faction: { type: 'string' },
    out: { type: 'string' },
  },
});

const outDir = values.out ?? DIST_DIR;
const factions = await loadAll();
const metas: ModelMeta[] = [];
const manifestFactions: ManifestFaction[] = [];
const files = new Map<string, Uint8Array | string>();
let errorCount = 0;
let warnCount = 0;

const pad = (s: string | number, n: number): string => String(s).padEnd(n);
console.log(`${pad('Modell', 34)}${pad('Name', 16)}${pad('Tris L0/L1/L2', 16)}${pad('Budget', 14)}${pad('Footprint', 11)}Hinweise`);
for (const f of factions) {
  const ids: string[] = [];
  for (const m of f.models) {
    const built = buildEntry(f, m);
    const glb = await exportGlb(built);
    const sha = createHash('sha256').update(glb).digest('hex');
    const file = `${f.def.slug}.${m.unit}.glb`;
    const meta = modelMeta(built, file, sha, glb.byteLength);
    metas.push(meta);
    ids.push(m.def.id);
    files.set(file, glb);
    files.set(`${f.def.slug}.${m.unit}.json`, `${JSON.stringify(meta, null, 2)}\n`);
    errorCount += built.errors.length;
    warnCount += built.warnings.length;
    if (values.faction === undefined || values.faction === f.def.slug) {
      const tris = built.lods.map((l) => l.triangles).join('/');
      const notes = [...built.errors.map((e) => `FEHLER ${e}`), ...built.warnings.map((w) => `Warnung ${w}`)];
      console.log(
        `${pad(`${f.def.slug}/${m.unit}`, 34)}${pad(built.name, 16)}${pad(tris, 16)}${pad(built.budget.tris.join('/'), 14)}${pad(built.footprintCheck.ok ? 'ok' : 'prüfen', 11)}${notes[0] ?? ''}`,
      );
      for (const n of notes.slice(1)) console.log(`${' '.repeat(91)}${n}`);
    }
  }
  const palette: Record<string, string> = {};
  for (const s of paletteSlots(f.def.palette)) palette[s] = f.def.palette.slots[s]!.color;
  const teamAlt = f.def.palette.teamAlt;
  manifestFactions.push({ slug: f.def.slug, name: f.def.name, palette, ...(teamAlt === undefined ? {} : { teamAlt }), models: ids });
}

const manifest: Manifest = { schema: 'faf-models/1', factions: manifestFactions, models: metas };
files.set('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);

if (errorCount > 0) {
  console.error(`\n${errorCount} Fehler, ${warnCount} Warnungen – nichts geschrieben.`);
  process.exit(1);
}

if (!values.check) {
  mkdirSync(outDir, { recursive: true });
  // remove stale outputs of deleted/renamed models
  for (const name of readdirSync(outDir)) {
    if ((name.endsWith('.glb') || name.endsWith('.json')) && !files.has(name)) rmSync(join(outDir, name));
  }
  for (const [name, data] of files) writeFileSync(join(outDir, name), data);
  const icons = writeIcons();
  console.log(`\n${metas.length} Modelle (${factions.length} Fraktionen) → ${relative(REPO_ROOT, outDir)}/, ${icons} Icon-SVGs → content/icons/svg/`);
} else {
  console.log(`\n${metas.length} Modelle geprüft (--check, nichts geschrieben).`);
}
if (warnCount > 0) console.log(`${warnCount} Warnungen.`);
if (!existsSync(outDir) && !values.check) process.exit(1);
