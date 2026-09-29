/**
 * Model registry: discovers `content/models/<faction>/<unit>.ts` (default export `defineModel`), the faction
 * config `<faction>/_faction.ts` (optional; neutral palette otherwise) and the faction roster, and builds models.
 *
 * Files starting with `_` or `.` are not models. The file name must equal the unit part of the id
 * (`lnd_t1_tank.ts` ↔ `core:lnd_t1_tank`). Node only (fs, dynamic import).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  buildModel,
  DEFAULT_PALETTE,
  rosterDefaults,
  type BuiltModel,
  type FactionDef,
  type ModelDef,
  type RosterFile,
  type RosterUnit,
} from '@faf/modelkit';

export const MODELS_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(MODELS_DIR, '../..');
export const DIST_DIR = join(MODELS_DIR, 'dist');

export interface ModelEntry {
  readonly faction: string;
  /** File stem = unit part of the id. */
  readonly unit: string;
  /** Repo-relative source path. */
  readonly file: string;
  readonly def: ModelDef;
}

export interface FactionEntry {
  readonly def: FactionDef;
  readonly dir: string;
  /** Repo-relative roster path (null if none was found). */
  readonly rosterPath: string | null;
  readonly roster: RosterFile | null;
  readonly models: readonly ModelEntry[];
}

const SKIP_DIRS = new Set(['dist', 'node_modules']);

function isModelFile(name: string): boolean {
  return name.endsWith('.ts') && !name.endsWith('.d.ts') && !name.startsWith('_') && !name.startsWith('.');
}

/** Faction folders (sorted). */
export function factionDirs(root = MODELS_DIR): string[] {
  return readdirSync(root)
    .filter((n) => !SKIP_DIRS.has(n) && !n.startsWith('.') && !n.startsWith('_') && statSync(join(root, n)).isDirectory())
    .sort();
}

async function importDefault<T>(file: string): Promise<T> {
  const mod = (await import(pathToFileURL(file).href)) as { default?: T };
  if (mod.default === undefined) throw new Error(`${relative(REPO_ROOT, file)}: no default export`);
  return mod.default;
}

export async function loadFaction(slug: string, root = MODELS_DIR): Promise<FactionEntry> {
  const dir = join(root, slug);
  const cfgFile = join(dir, '_faction.ts');
  const def: FactionDef = existsSync(cfgFile)
    ? await importDefault<FactionDef>(cfgFile)
    : { slug, name: slug, palette: { ...DEFAULT_PALETTE, faction: slug } };
  if (def.slug !== slug) throw new Error(`${relative(REPO_ROOT, cfgFile)}: slug "${def.slug}" ≠ folder "${slug}"`);
  const rosterRel = def.roster ?? `docs/design/factions/${slug}/roster.json`;
  const rosterAbs = join(REPO_ROOT, rosterRel);
  const roster = existsSync(rosterAbs) ? (JSON.parse(readFileSync(rosterAbs, 'utf8')) as RosterFile) : null;
  const models: ModelEntry[] = [];
  for (const name of readdirSync(dir).filter(isModelFile).sort()) {
    const file = join(dir, name);
    const mdef = await importDefault<ModelDef>(file);
    const unit = name.slice(0, -3);
    models.push({ faction: slug, unit, file: relative(REPO_ROOT, file), def: mdef });
  }
  return { def, dir, rosterPath: roster === null ? null : rosterRel, roster, models };
}

export async function loadAll(root = MODELS_DIR): Promise<FactionEntry[]> {
  const out: FactionEntry[] = [];
  for (const slug of factionDirs(root)) out.push(await loadFaction(slug, root));
  return out;
}

export function rosterUnit(f: FactionEntry, id: string): RosterUnit | undefined {
  return f.roster?.units.find((u) => u.id === id);
}

/** Builds one model with the faction palette, budgets and roster defaults; adds registry-level checks. */
export function buildEntry(f: FactionEntry, m: ModelEntry): BuiltModel {
  const ru = rosterUnit(f, m.def.id);
  const built = buildModel(m.def, {
    faction: f.def.slug,
    palette: f.def.palette,
    ...(ru === undefined ? {} : { defaults: rosterDefaults(ru, f.def.language ?? 'de') }),
    ...(f.def.budgets === undefined ? {} : { budgets: f.def.budgets }),
  });
  const errors = [...built.errors];
  const warnings = [...built.warnings];
  const unitOfId = m.def.id.slice(m.def.id.indexOf(':') + 1);
  if (unitOfId !== m.unit) errors.push(`file ${m.file}: name must be ${unitOfId}.ts (id ${m.def.id})`);
  if (f.roster !== null && ru === undefined) warnings.push(`${m.def.id} not in roster ${f.rosterPath}`);
  if (ru !== undefined) {
    if (m.def.icon !== undefined && ru.icon !== undefined && m.def.icon !== ru.icon) warnings.push(`icon ${m.def.icon} ≠ roster ${ru.icon}`);
    const rfp = ru.motion?.footprint ?? ru.footprint;
    if (m.def.footprint !== undefined && rfp !== undefined && (m.def.footprint[0] !== rfp[0] || m.def.footprint[1] !== rfp[1])) {
      warnings.push(`footprint ${m.def.footprint.join('×')} ≠ roster ${rfp.join('×')}`);
    }
  }
  return { ...built, errors, warnings };
}
