/**
 * Package boundaries of the monorepo (PLAN §3.2). Workspace packages resolve through their
 * node_modules symlinks to packages/<name>/src, so rules match on real paths.
 * Rules constrain `src/` only; tests, benches and scripts may reach further.
 * @type {import('dependency-cruiser').IConfiguration}
 */

/**
 * Matches workspace targets both as resolved paths and — when resolution fails because the
 * package is not a declared dependency — as bare module names (@faf/<pkg>).
 */
const WS = '^((packages|apps|tools)/|@faf/)';

/** Target pattern for a list of package names (resolved path or bare specifier). */
function pkgTarget(names) {
  const alt = names.join('|');
  return `^(packages/(${alt})/|@faf/(${alt})($|/))`;
}

/** Forbid `from` package src importing any workspace package outside `allowed` (+ itself). */
function onlyWorkspaceDeps(name, from, allowed) {
  const allow = [from, ...allowed];
  return {
    name,
    severity: 'error',
    comment: `packages/${from}/src may only import workspace packages: ${allowed.join(', ') || '(none)'}`,
    from: { path: `^packages/${from}/src/` },
    to: { path: WS, pathNot: pkgTarget(allow) },
  };
}

module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies break layering and initialization order.',
      from: {},
      to: { circular: true },
    },
    onlyWorkspaceDeps('fixed-is-leaf', 'fixed', []),
    onlyWorkspaceDeps('heap-deps', 'heap', ['fixed']),
    onlyWorkspaceDeps('protocol-deps', 'protocol', ['fixed']),
    onlyWorkspaceDeps('rules-deps', 'rules', ['fixed']),
    onlyWorkspaceDeps('formats-deps', 'formats', ['fixed', 'protocol']),
    onlyWorkspaceDeps('blueprints-deps', 'blueprints', ['fixed', 'rules']),
    onlyWorkspaceDeps('nav-deps', 'nav', ['fixed', 'heap', 'rules']),
    onlyWorkspaceDeps('sim-deps', 'sim', ['fixed', 'heap', 'protocol', 'rules', 'blueprints', 'nav', 'formats']),
    onlyWorkspaceDeps('sim-host-deps', 'sim-host', [
      'sim',
      'fixed',
      'heap',
      'protocol',
      'rules',
      'blueprints',
      'nav',
      'formats',
      'ai',
    ]),
    onlyWorkspaceDeps('ai-deps', 'ai', ['fixed', 'protocol', 'rules', 'nav', 'blueprints']),
    onlyWorkspaceDeps('render-deps', 'render', ['protocol', 'fixed']),
    onlyWorkspaceDeps('client-deps', 'client', ['render', 'protocol', 'rules', 'formats', 'blueprints', 'fixed']),
    {
      name: 'render-npm-deps',
      severity: 'error',
      comment: 'render only depends on gl-matrix from npm (own WebGL2 pipeline, PLAN §2).',
      from: { path: '^packages/render/src/' },
      to: { dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-no-pkg', 'npm-unknown'], pathNot: ['/gl-matrix/', '^(packages|apps|tools)/'] },
    },
    {
      name: 'nobody-imports-client',
      severity: 'error',
      comment: 'Only apps/* may import @faf/client (PLAN §3.2: "Nichts importiert client").',
      from: { path: WS, pathNot: '^(apps/|packages/client/)' },
      to: { path: pkgTarget(['client']) },
    },
    {
      name: 'presentation-never-imports-sim',
      severity: 'error',
      comment: 'render/client/ai never import sim or sim-host (they only see frames/perception).',
      from: { path: '^packages/(render|client|ai)/' },
      to: { path: pkgTarget(['sim', 'sim-host']) },
    },
    {
      name: 'sim-never-imports-presentation',
      severity: 'error',
      comment: 'Simulation packages never import render/client/ai/sim-host.',
      from: { path: '^packages/(fixed|heap|protocol|rules|formats|blueprints|nav|sim)/src/' },
      to: { path: pkgTarget(['render', 'client', 'ai', 'sim-host']) },
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      comment: 'Every import must resolve (undeclared workspace/npm dependencies included). Vite query/virtual imports are exempt.',
      from: {},
      to: { couldNotResolve: true, pathNot: ['\\?', '^virtual:', '^node:'] },
    },
    {
      name: 'no-deep-imports-into-packages',
      severity: 'error',
      comment: 'Cross-package imports go through the package name (exports map), never relative paths into another package.',
      from: { path: '^packages/([^/]+)/' },
      to: { path: '^packages/([^/]+)/', pathNot: ['^packages/$1/'], dependencyTypes: ['local'] },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: {
      path: ['(^|/)dist/', '(^|/)dist-harness/', '^test-results/', '^playwright-report/', '\\.d\\.ts$'],
    },
    tsPreCompilationDeps: true,
    combinedDependencies: false,
    preserveSymlinks: false,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'module', 'browser', 'default', 'types'],
      mainFields: ['module', 'main', 'types'],
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.d.ts'],
    },
    moduleSystems: ['es6', 'cjs'],
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
