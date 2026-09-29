import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
  const covered = ['fixed', 'heap', 'rules', 'sim', 'protocol'];

  for (const p of covered) {
    it(`to packages/${p}/src`, async () => {
      expect(await simHits(`packages/${p}/src/__probe.ts`)).toBe(PROBE_RULE_HITS);
      expect(await simHits(`packages/${p}/src/nested/__probe.ts`)).toBe(PROBE_RULE_HITS);
    });
  }

  it('to the sim.bin decoder that runs in the sim worker (blueprints/src/simbin.ts)', async () => {
    expect(await simHits('packages/blueprints/src/simbin.ts')).toBe(PROBE_RULE_HITS);
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
