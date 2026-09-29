/**
 * Node-side content loader and generated-file writer for the blueprint compiler
 * (shared by the `compile` CLI and the tests).
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  compileBlueprints,
  isBlueprintDefinition,
  type CompileOptions,
  type CompileResult,
  type SourcedDefinition,
} from '../src/index.ts';

/** Repository root (…/flow-and-fire). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
/** Blueprint sources. */
export const CONTENT_BLUEPRINTS = join(REPO_ROOT, 'content', 'blueprints');
/** Checked-in compiler output. */
export const CONTENT_GENERATED = join(REPO_ROOT, 'content', 'generated');

/** Names of the generated files, in write order. */
export const GENERATED_FILES = ['sim.bin', 'view.json', 'bundle.json', 'hashes.json'] as const;
export type GeneratedFile = (typeof GENERATED_FILES)[number];

async function walk(dir: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) out.push(p);
  }
}

/** Repo-relative POSIX path. */
export function repoPath(abs: string): string {
  return relative(REPO_ROOT, abs).split(sep).join('/');
}

/**
 * Imports every `*.ts` below `root` (sorted by repo-relative path) and returns their default
 * exports (a definition or an array of definitions) in a deterministic order.
 */
export async function loadDefinitions(root: string = CONTENT_BLUEPRINTS): Promise<SourcedDefinition[]> {
  const files: string[] = [];
  await walk(root, files);
  const rel = files.map((f) => ({ abs: f, rel: repoPath(f) }));
  rel.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const out: SourcedDefinition[] = [];
  for (const f of rel) {
    const mod = (await import(pathToFileURL(f.abs).href)) as { default?: unknown };
    const exp = mod.default;
    const list = Array.isArray(exp) ? exp : [exp];
    if (list.length === 0) throw new Error(`${f.rel}: default export is an empty array`);
    for (const d of list) {
      if (!isBlueprintDefinition(d)) {
        throw new Error(`${f.rel}: default export must be defineUnit(...)/definePatch(...) or an array of them`);
      }
      out.push({ def: d, source: f.rel });
    }
  }
  return out;
}

/** Loads and compiles the content tree. */
export async function compileContent(options: CompileOptions = {}, root?: string): Promise<CompileResult> {
  return compileBlueprints(await loadDefinitions(root), options);
}

/** Bytes of every generated file for a compile result. */
export function generatedBytes(r: CompileResult): Record<GeneratedFile, Uint8Array> {
  const enc = new TextEncoder();
  return {
    'sim.bin': r.simBin,
    'view.json': enc.encode(r.viewJson),
    'bundle.json': enc.encode(r.bundleJson),
    'hashes.json': enc.encode(r.hashesJson),
  };
}

/** Writes the generated files into `dir`. */
export async function writeGenerated(r: CompileResult, dir: string = CONTENT_GENERATED): Promise<void> {
  await mkdir(dir, { recursive: true });
  const files = generatedBytes(r);
  for (const name of GENERATED_FILES) await writeFile(join(dir, name), files[name]);
}

/** Names of generated files in `dir` that are missing or differ from `r`. */
export async function staleGenerated(r: CompileResult, dir: string = CONTENT_GENERATED): Promise<GeneratedFile[]> {
  const files = generatedBytes(r);
  const stale: GeneratedFile[] = [];
  for (const name of GENERATED_FILES) {
    let cur: Uint8Array | null;
    try {
      cur = new Uint8Array(await readFile(join(dir, name)));
    } catch {
      cur = null;
    }
    const want = files[name];
    if (cur === null || cur.length !== want.length || !cur.every((b, i) => b === want[i])) stale.push(name);
  }
  return stale;
}
