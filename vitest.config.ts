import { defineConfig } from 'vitest/config';

// Single root config for the whole monorepo. Memory budget (no swap): at most 4 forked workers.
export default defineConfig({
  // JSX in *.test.tsx (packages/hud) uses the Preact automatic runtime, like tsconfig.base.json.
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  test: {
    include: ['{packages,apps,tools}/*/test/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', 'tools/headless/dist-harness/**'],
    environment: 'node',
    pool: 'forks',
    maxWorkers: 4,
    // Allocation tests call globalThis.gc(); forks get the flag via execArgv.
    execArgv: ['--expose-gc'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    watch: false,
    passWithNoTests: false,
    reporters: ['default'],
  },
});
