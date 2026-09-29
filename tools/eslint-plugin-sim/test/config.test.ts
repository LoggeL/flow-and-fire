import { readdirSync, readFileSync } from 'node:fs';
import { matchesGlob, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// Checks that the repo's eslint.config.js really applies sim/determinism to every sim source
// (PLAN §3.12) — a glob typo would otherwise silently disable the contract for a package.

const ROOT = resolve(import.meta.dirname, '../../..');

/** One violation per construct family the rule knows. */
const PROBE = [
  'export const a = Math.random();',
  'export const b = Date.now();',
  'export const c = new Float32Array(1);',
  'export const d = crypto.getRandomValues(new Uint8Array(1));',
  'export function e(x: number, y: number): number { return x / y; }',
  '',
].join('\n');
const PROBE_RULE_HITS = 5;

const eslint = new ESLint({ cwd: ROOT });

async function simHits(file: string): Promise<number> {
  const [r] = await eslint.lintText(PROBE, { filePath: resolve(ROOT, file) });
  return r!.messages.filter((m) => m.ruleId === 'sim/determinism').length;
}

/** Workspace packages the sim package depends on at runtime (package.json dependencies). */
function simRuntimeDeps(): string[] {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'packages/sim/package.json'), 'utf8')) as { dependencies?: Record<string, string> };
  return Object.keys(pkg.dependencies ?? {})
    .filter((n) => n.startsWith('@faf/'))
    .map((n) => n.slice('@faf/'.length));
}

describe('eslint.config.js applies sim/determinism', () => {
  const covered = ['fixed', 'heap', 'rules', 'sim', 'protocol', 'formats'];

  for (const p of covered) {
    it(`to packages/${p}/src`, async () => {
      expect(await simHits(`packages/${p}/src/__probe.ts`)).toBe(PROBE_RULE_HITS);
      expect(await simHits(`packages/${p}/src/nested/__probe.ts`)).toBe(PROBE_RULE_HITS);
    });
  }

  it('to the sim.bin decoder that runs in the sim worker (blueprints/src/simbin.ts)', async () => {
    expect(await simHits('packages/blueprints/src/simbin.ts')).toBe(PROBE_RULE_HITS);
  });

  it('to the map format reader/writer that runs in the sim worker (formats/src, MS2)', async () => {
    expect(await simHits('packages/formats/src/rtsmap.ts')).toBe(PROBE_RULE_HITS);
    expect(await simHits('packages/formats/src/container.ts')).toBe(PROBE_RULE_HITS);
  });

  it('to packages/nav/src once it exists (glob reserved for MS4)', async () => {
    expect(await simHits('packages/nav/src/__probe.ts')).toBe(PROBE_RULE_HITS);
  });

  it('to every workspace package the sim depends on at runtime', async () => {
    const deps = simRuntimeDeps();
    expect(deps.length).toBeGreaterThan(0);
    for (const d of deps) {
      // blueprints: only the sim.bin decoder is a sim runtime dependency (dependency-cruiser
      // restricts sim to @faf/blueprints/simbin).
      const file = d === 'blueprints' ? 'packages/blueprints/src/simbin.ts' : `packages/${d}/src/__probe.ts`;
      expect(await simHits(file), file).toBe(PROBE_RULE_HITS);
    }
  });

  it('but not to presentation, host, tools, tests or the transport layer', async () => {
    for (const f of [
      'packages/client/src/__probe.ts',
      'packages/render/src/__probe.ts',
      'packages/sim-host/src/__probe.ts',
      'packages/blueprints/src/compiler.ts',
      'packages/protocol/src/transport/__probe.ts',
      'packages/sim/test/__probe.test.ts',
      'packages/formats/scripts/__probe.ts',
      'packages/formats/test/__probe.test.ts',
      'tools/render-bench/src/__probe.ts',
      'tools/assets-pipeline/src/__probe.ts',
      'apps/game/src/__probe.ts',
    ]) {
      expect(await simHits(f), f).toBe(0);
    }
  });

  it('covers every existing package source directory that is bound by the contract', () => {
    const existing = readdirSync(resolve(ROOT, 'packages'));
    for (const p of covered) expect(existing, p).toContain(p);
  });
});

/** Repo files (relative, '/'-separated) outside node_modules, build output and VCS data. */
function repoFiles(): string[] {
  const out: string[] = [];
  const skip = new Set(['node_modules', 'dist', '.git', 'test-results', 'playwright-report', 'dist-harness', 'results', 'bench-results']);
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const abs = resolve(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else out.push(relative(ROOT, abs).split('\\').join('/'));
    }
  };
  walk(ROOT);
  return out;
}

describe('eslint.config.js globals blocks', () => {
  it('every glob of a block that sets globals (browser/worker/node) matches at least one file', async () => {
    type Block = { files?: unknown[]; languageOptions?: { globals?: object } };
    const repoConfig = ((await import(pathToFileURL(resolve(ROOT, 'eslint.config.js')).href)) as { default: Block[] }).default;
    const files = repoFiles();
    // path.matchesGlob skips dot segments; ESLint does not (e.g. .dependency-cruiser.cjs).
    const undotted = files.map((f) => f.replace(/(^|\/)\./g, '$1'));
    const blocks = repoConfig.filter(
      (b) => b.languageOptions?.globals !== undefined && Array.isArray(b.files),
    );
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    const dead: string[] = [];
    for (const b of blocks) {
      for (const g of b.files as string[]) {
        const hit = files.some((f, i) => matchesGlob(f, g) || matchesGlob(undotted[i]!, g));
        if (!hit) dead.push(g);
      }
    }
    expect(dead, 'globs without any matching file (dead config)').toEqual([]);
  });

  it('the headless harness gets browser globals (page) and worker globals (worker entry)', async () => {
    const eslint = new ESLint({ cwd: ROOT });
    const page = (await eslint.calculateConfigForFile(resolve(ROOT, 'tools/headless/src/harness/page/main.ts'))) as { languageOptions: { globals: Record<string, unknown> } };
    const worker = (await eslint.calculateConfigForFile(resolve(ROOT, 'tools/headless/src/harness/worker-entry.ts'))) as { languageOptions: { globals: Record<string, unknown> } };
    expect(page.languageOptions.globals['document']).toBeDefined();
    expect(worker.languageOptions.globals['importScripts']).toBeDefined();
  });
});
