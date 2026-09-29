import { resolve } from 'node:path';
import simPlugin from '@faf/eslint-plugin-sim';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { createSpk1, runSpk1Chain } from '../src/spk1/run.ts';
import { spk1Counts, spk1Step, visionFromScratch } from '../src/spk1/systems.ts';
import { FINE_CELLS, TEAMS } from '../src/spk1/world.ts';
import { HEADLESS_DIR, REPO_DIR } from '../scripts/lib.ts';

describe('SPK1 prototype', () => {
  it('is deterministic: two runs ⇒ identical hash chain; another seed ⇒ another chain', () => {
    const a = runSpk1Chain(150);
    const b = runSpk1Chain(150);
    expect(a.trail.length).toBe(15);
    expect(b.trail).toEqual(a.trail);
    expect(b.counts).toEqual(a.counts);
    expect(new Set(a.trail).size).toBe(15);
    const c = runSpk1Chain(30, 0x1234);
    expect(c.trail).not.toEqual(a.trail.slice(0, 3));
  });

  it('carries the Big-Battle load: 1,000 ground, 300 air, ≈ 4,000 projectiles, hits and kills', () => {
    const w = createSpk1();
    for (let t = 0; t < 80; t++) spk1Step(w);
    const c = spk1Counts(w);
    expect(c.ground).toBe(1000);
    expect(c.air).toBe(300);
    expect(c.projectiles).toBeGreaterThan(3600);
    expect(c.projectiles).toBeLessThanOrEqual(4000);
    expect(c.hits).toBeGreaterThan(1000);
    expect(c.kills).toBeGreaterThan(0);
  });

  it('row-span delta stamps equal a full re-stamp (refcount grid, 2 teams)', () => {
    const w = createSpk1();
    const scratch = new Uint16Array(TEAMS * FINE_CELLS);
    for (let t = 0; t < 60; t++) {
      spk1Step(w);
      if (t % 20 === 19) {
        visionFromScratch(w, scratch);
        expect(Buffer.from(w.vision.buffer, w.vision.byteOffset, w.vision.byteLength).equals(Buffer.from(scratch.buffer))).toBe(true);
      }
    }
  });

  it('snapshot/restore mid-run reproduces the chain (all state lives in the arena)', () => {
    const w = createSpk1();
    for (let t = 0; t < 40; t++) spk1Step(w);
    const snap = w.arena.snapshot();
    for (let t = 0; t < 20; t++) spk1Step(w);
    const direct = w.arena.snapshot();
    w.arena.restore(snap);
    for (let t = 0; t < 20; t++) spk1Step(w);
    expect(Buffer.from(w.arena.snapshot()).equals(Buffer.from(direct))).toBe(true);
  });

  it('simulation code (world, systems) follows the sim/determinism lint contract', async () => {
    const eslint = new ESLint({
      cwd: REPO_DIR,
      overrideConfigFile: true,
      overrideConfig: [
        {
          files: ['**/*.ts'],
          languageOptions: { parser: tseslint.parser as never },
          plugins: { sim: simPlugin as never },
          rules: { 'sim/determinism': 'error' },
        },
      ],
    });
    // run.ts is measurement code (clock, summaries) and deliberately outside the contract.
    const results = await eslint.lintFiles([resolve(HEADLESS_DIR, 'src/spk1/world.ts'), resolve(HEADLESS_DIR, 'src/spk1/systems.ts')]);
    const messages = results.flatMap((r) => r.messages.map((m) => `${r.filePath}:${m.line} ${m.message}`));
    expect(results.length).toBe(2);
    expect(messages).toEqual([]);
  });
});
