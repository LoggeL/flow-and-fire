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

/**
 * Determinism rules of the AI (ai.md §2.5, TRACK-AI) for packages/ai/src and tools/ai-arena/src:
 * only IEEE-exact Math functions, no randomness, no clocks/timers, no locale-dependent string
 * operations (`localeCompare`/`Intl` sort differently per browser locale than headless), no for…in,
 * no `**`, no sort/toSorted without comparator. Complements the guard test
 * packages/ai/test/determinism-guard.test.ts (same allowlists).
 */
export const AI_SOURCES = ['packages/ai/src/**/*.ts', 'tools/ai-arena/src/**/*.ts'];
/** Clock/timer allowlist (host clock, benchmarks, calibration script). */
export const AI_CLOCK_ALLOW = ['packages/ai/src/host/clock.ts', 'tools/ai-arena/src/bench/**/*.ts', 'tools/ai-arena/src/scenarios/smoke.ts'];
const AI_MATH_ALLOWED = ['sqrt', 'floor', 'ceil', 'round', 'trunc', 'min', 'max', 'abs', 'sign', 'imul', 'clz32'];

/** no-restricted-syntax of the AI sources; `extraMath` = Math functions allowed on top (Elo: log10). */
function aiSyntax(extraMath = []) {
  const ok = [...AI_MATH_ALLOWED, ...extraMath].join('|');
  const msg = 'AI determinism (ai.md §2.5)';
  return [
    'error',
    { selector: 'ForInStatement', message: `${msg}: no for…in (use for…of over a sorted/insertion-ordered list)` },
    { selector: "BinaryExpression[operator='**'], AssignmentExpression[operator='**=']", message: `${msg}: no ** (not IEEE-exact everywhere)` },
    {
      selector: "CallExpression[arguments.length=0] > MemberExpression.callee[property.name=/^(sort|toSorted)$/]",
      message: `${msg}: sort/toSorted need a total comparator`,
    },
    {
      selector: `MemberExpression[object.name='Math'][computed=false][property.name!=/^(${ok})$/]`,
      message: `${msg}: only IEEE-exact Math functions (${ok.split('|').join(', ')})`,
    },
    { selector: "MemberExpression[object.name='Math'][computed=true]", message: `${msg}: no computed Math access` },
    { selector: "VariableDeclarator[init.name='Math'], AssignmentExpression[right.name='Math']", message: `${msg}: do not alias/destructure Math` },
  ];
}

const AI_RESTRICTED_PROPERTIES = [
  'error',
  { property: 'localeCompare', message: 'AI determinism: locale-dependent order; compare code units (a < b ? -1 : a > b ? 1 : 0)' },
  { property: 'getRandomValues', message: 'AI determinism: no randomness outside the seeded manager RNG' },
  { property: 'randomUUID', message: 'AI determinism: no randomness outside the seeded manager RNG' },
  { object: 'process', property: 'hrtime', message: 'AI determinism: clocks only in the allowlist' },
  { property: 'threadCpuUsage', message: 'AI determinism: clocks only in the allowlist' },
  { property: 'cpuUsage', message: 'AI determinism: clocks only in the allowlist' },
];

const AI_LOCALE_GLOBALS = [
  { name: 'Intl', message: 'AI determinism: locale-dependent (browser vs headless)' },
  { name: 'crypto', message: 'AI determinism: no randomness outside the seeded manager RNG' },
];
const AI_CLOCK_GLOBALS = ['Date', 'performance', 'setTimeout', 'setInterval', 'setImmediate', 'requestAnimationFrame', 'queueMicrotask'].map((name) => ({
  name,
  message: 'AI determinism: clocks/timers only in host/clock.ts, bench/** and smoke.ts',
}));

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
      // static HTML/JS design mockups (docs/design/ui.md), not product code
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
  // Determinism rules of the AI and its arena (ai.md §2.5).
  {
    files: AI_SOURCES,
    rules: {
      'no-restricted-syntax': aiSyntax(),
      'no-restricted-properties': AI_RESTRICTED_PROPERTIES,
      'no-restricted-globals': ['error', ...AI_LOCALE_GLOBALS, ...AI_CLOCK_GLOBALS],
    },
  },
  {
    files: AI_CLOCK_ALLOW,
    rules: {
      'no-restricted-properties': ['error', ...AI_RESTRICTED_PROPERTIES.slice(1, 4)],
      'no-restricted-globals': ['error', ...AI_LOCALE_GLOBALS],
    },
  },
  {
    // Elo report number (never a decision input).
    files: ['tools/ai-arena/src/stats/**/*.ts'],
    rules: { 'no-restricted-syntax': aiSyntax(['log10']) },
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
          jsonParseAllow: ['packages/formats/src/rtsmap.ts'],
        },
      ],
    },
  },
);
