// @ts-check
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import simPlugin from '@faf/eslint-plugin-sim';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Packages whose src/ is bound by the determinism contract (PLAN §3.1, §3.12). */
const SIM_SOURCES = [
  'packages/fixed/src/**/*.ts',
  'packages/heap/src/**/*.ts',
  'packages/rules/src/**/*.ts',
  'packages/sim/src/**/*.ts',
  'packages/nav/src/**/*.ts',
  'packages/protocol/src/**/*.ts',
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
  // Browser code (render, client, game, harness pages).
  {
    files: ['packages/render/**/*.ts', 'packages/client/**/*.{ts,tsx}', 'apps/**/src/**/*.{ts,tsx}', 'tools/headless/harness/**/*.ts'],
    languageOptions: { globals: { ...globals.browser } },
  },
  // Worker code.
  {
    files: ['packages/sim-host/src/**/*.ts', 'tools/headless/harness/worker/**/*.ts'],
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
        },
      ],
    },
  },
);
