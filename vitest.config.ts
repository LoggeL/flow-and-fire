import { defineConfig } from 'vitest/config';

const allocationTests = ['packages/sim/test/alloc.test.ts', 'packages/sim-host/test/alloc.test.ts'];

// Shared monorepo config. Memory budget (no swap): at most 4 forked workers.
export default defineConfig({
  // JSX in *.test.tsx (packages/hud) uses the Preact automatic runtime, like tsconfig.base.json.
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', 'tools/headless/dist-harness/**'],
    environment: 'node',
    pool: 'forks',
    isolate: true,
    maxWorkers: 4,
    fsModuleCache: true,
    sharedViteServer: true,
    // Allocation tests call globalThis.gc(); forks get the flag via execArgv.
    execArgv: ['--expose-gc'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    watch: false,
    passWithNoTests: false,
    reporters: ['default'],
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['{packages,apps,tools}/*/test/**/*.test.{ts,tsx}'],
          exclude: allocationTests,
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: 'allocation',
          include: allocationTests,
          // Measure allocations after the other suites, without competing workers.
          maxWorkers: 1,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
