// @ts-check
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import simPlugin from '@faf/eslint-plugin-sim';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Sources bound by the determinism contract (PLAN §3.1, §3.12): every module that runs inside
 * the sim step or builds sim state. `blueprints/src/simbin.ts` is the sim.bin decoder that
 * createWorld runs in the sim worker (the rest of @faf/blueprints is the offline compiler).
 * `formats/src` parses .rtsmap files inside the sim worker (mapSimHash, mapSimData); its Node-only
 * CLI tools under `formats/scripts` are not bound by the contract.
 * Exported for the config test (tools/eslint-plugin-sim/test/config.test.ts).
 */
export const SIM_SOURCES = [
  'packages/fixed/src/**/*.ts',
  'packages/heap/src/**/*.ts',
  'packages/rules/src/**/*.ts',
  'packages/sim/src/**/*.ts',
  'packages/nav/src/**/*.ts',
  'packages/protocol/src/**/*.ts',
  'packages/formats/src/**/*.ts',
  'packages/blueprints/src/simbin.ts',
];

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'content/generated/**',
      'tools/headless/dist-harness/**',
      'test-results/**',
      'playwright-report/**',
      '**/*.wasm',
      // Static HTML/JS design mockups (docs, not product code; no module/globals setup).
      'docs/design/ui-mockups/**',
    ],
  },
  js.configs.recommended,
  // Not type-aware on purpose (memory budget): syntactic rules only.
  tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  // Browser code (render, client, game, harness pages, render benchmark page).
  {
    files: [
      'packages/render/**/*.ts',
      'packages/client/**/*.{ts,tsx}',
      'apps/**/src/**/*.{ts,tsx}',
      'tools/headless/src/harness/page/**/*.ts',
      'tools/render-bench/{src,page}/**/*.ts',
    ],
    languageOptions: { globals: { ...globals.browser } },
  },
  // Worker code (sim worker, harness worker, asset worker of the client – P3).
  {
    files: ['packages/sim-host/src/**/*.ts', 'tools/headless/src/harness/worker-entry.ts', 'packages/client/src/assets/worker.ts'],
    languageOptions: { globals: { ...globals.worker } },
  },
  // Node code: configs, scripts, tools, tests, benches.
  {
    files: [
      '*.{js,mjs,cjs,ts}',
      '**/*.cjs',
      '**/*.mjs',
      '**/scripts/**/*.{ts,js}',
      '**/bench/**/*.ts',
      '**/test/**/*.ts',
      'test/**/*.ts',
      'tools/**/*.{js,ts}',
      'tools/assets-pipeline/**/*.{js,mjs,ts}',
      'apps/*/vite.config.ts',
      'packages/*/vite.config.ts',
    ],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  // Determinism contract for simulation sources.
  {
    files: SIM_SOURCES,
    ignores: ['packages/protocol/src/transport/**'],
    plugins: { sim: simPlugin },
    rules: {
      'sim/determinism': [
        'error',
        {
          sqrtAllow: ['packages/fixed/src/isqrt.ts'],
          float64Allow: ['packages/heap/src/safeint.ts'],
          // The .rtsmap META reader checks every number with Number.isInteger (num()/isInt()).
          // The .rtsreplay META chunk is canonical JSON; its reader validates every value the same way.
          jsonParseAllow: ['packages/formats/src/rtsmap.ts', 'packages/formats/src/rtsreplay/meta.ts'],
        },
      ],
    },
  },
);
