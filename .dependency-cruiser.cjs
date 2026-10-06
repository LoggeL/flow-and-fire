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

/**
 * Forbid `from` package src importing any workspace package outside `allowed` (+ itself).
 * `extraPathNot` admits single modules of otherwise forbidden packages.
 */
function onlyWorkspaceDeps(name, from, allowed, extraPathNot = []) {
  const allow = [from, ...allowed];
  const extra = extraPathNot.length > 0 ? ` plus ${extraPathNot.join(', ')}` : '';
  return {
    name,
    severity: 'error',
    comment: `packages/${from}/src may only import workspace packages: ${allowed.join(', ') || '(none)'}${extra}`,
    from: { path: `^packages/${from}/src/` },
    to: { path: WS, pathNot: [pkgTarget(allow), ...extraPathNot] },
  };
}

/**
 * The sim may use the blueprints package only through its sim.bin contract module
 * (PLAN §3.2 "blueprints-Typen"): never the compiler, TypeBox schemas or the view data.
 */
/** npm packages the marker editor may use (plus their pnpm store paths and type packages). */
const MARKER_EDITOR_NPM = 'node_modules/(@types/three|three|preact|@preact/signals|@preact/signals-core)/';

const SIM_BLUEPRINTS = ['^packages/blueprints/src/simbin\\.ts$', '^@faf/blueprints/simbin$'];

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
    onlyWorkspaceDeps('sim-deps', 'sim', ['fixed', 'heap', 'protocol', 'rules', 'nav', 'formats'], SIM_BLUEPRINTS),
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
    onlyWorkspaceDeps('ai-deps', 'ai', ['fixed', 'protocol', 'rules']),
    onlyWorkspaceDeps('render-deps', 'render', ['protocol', 'fixed']),
    onlyWorkspaceDeps('render-fx-deps', 'render-fx', ['render', 'fixed', 'protocol']),
    // Kitbash DSL: pure TypeScript, independent of render/sim (only @gltf-transform/core from npm).
    onlyWorkspaceDeps('modelkit-is-leaf', 'modelkit', []),
    // Web Audio engine (TRACK-AUDIOENG): presentation leaf package, integrated by client in MS5.
    onlyWorkspaceDeps('audio-is-leaf', 'audio', []),
    // HUD/menus (TRACK-HUD): data only via HudModel signals + HudCommands callbacks, no workspace imports.
    onlyWorkspaceDeps('hud-deps', 'hud', []),
    {
      name: 'hud-npm-deps',
      severity: 'error',
      comment: 'hud only depends on preact, @preact/signals and @fontsource/* from npm (TRACK-HUD contract).',
      from: { path: '^packages/hud/src/' },
      to: {
        dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-no-pkg', 'npm-unknown'],
        pathNot: ['/preact/', '/@preact/signals', '/@preact/signals-core/', '/@fontsource/', '^(packages|apps|tools)/'],
      },
    },
    {
      name: 'hud-gallery-deps',
      severity: 'error',
      comment: 'The HUD gallery only imports @faf/hud from the workspace.',
      from: { path: '^apps/hud-gallery/src/' },
      to: { path: WS, pathNot: ['^apps/hud-gallery/', pkgTarget(['hud'])] },
    },
    onlyWorkspaceDeps('client-deps', 'client', ['render', 'protocol', 'rules', 'formats', 'blueprints', 'fixed', 'audio']),
    {
      name: 'audio-npm-deps',
      severity: 'error',
      comment: 'audio only depends on opus-decoder from npm (WASM fallback of the decode chain, dynamically imported).',
      from: { path: '^packages/audio/src/' },
      to: { dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-no-pkg', 'npm-unknown'], pathNot: ['/opus-decoder/', '^(packages|apps|tools)/'] },
    },
    {
      name: 'marker-editor-deps',
      severity: 'error',
      comment:
        'apps/marker-editor/src (M12, tool) may only import the workspace packages formats, fixed, rules, protocol – never sim, sim-host, client, render or nav.',
      from: { path: '^apps/marker-editor/src/' },
      to: { path: WS, pathNot: ['^apps/marker-editor/', pkgTarget(['formats', 'fixed', 'rules', 'protocol'])] },
    },
    {
      name: 'marker-editor-npm-deps',
      severity: 'error',
      comment: 'apps/marker-editor/src uses from npm only three, preact and @preact/signals (three.js is allowed in tools, PLAN §2).',
      from: { path: '^apps/marker-editor/src/' },
      to: {
        dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-no-pkg', 'npm-unknown'],
        pathNot: [MARKER_EDITOR_NPM, '^(packages|apps|tools)/'],
      },
    },
    {
      name: 'render-npm-deps',
      severity: 'error',
      comment: 'render only depends on gl-matrix from npm (own WebGL2 pipeline, PLAN §2).',
      from: { path: '^packages/render/src/' },
      to: { dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-no-pkg', 'npm-unknown'], pathNot: ['/gl-matrix/', '^(packages|apps|tools)/'] },
    },
    {
      name: 'render-fx-npm-deps',
      severity: 'error',
      comment: 'render-fx only depends on gl-matrix from npm (same WebGL2 pipeline as render).',
      from: { path: '^packages/render-fx/src/' },
      to: { dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-no-pkg', 'npm-unknown'], pathNot: ['/gl-matrix/', '^(packages|apps|tools)/'] },
    },
    {
      name: 'render-never-imports-render-fx',
      severity: 'error',
      comment: 'render stays below render-fx: the FX layer builds on the RHI, never the other way round.',
      from: { path: '^packages/render/' },
      to: { path: pkgTarget(['render-fx']) },
    },
    {
      name: 'fx-lab-deps',
      severity: 'error',
      comment: 'apps/fx-lab/src may only import render, render-fx, fixed and protocol from the workspace.',
      from: { path: '^apps/fx-lab/src/' },
      to: { path: WS, pathNot: [pkgTarget(['render', 'render-fx', 'fixed', 'protocol']), '^apps/fx-lab/'] },
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
      comment: 'Presentation packages never import sim or sim-host (they only see frames/perception).',
      from: { path: '^packages/(render|render-fx|client|ai|audio|hud)/' },
      to: { path: pkgTarget(['sim', 'sim-host']) },
    },
    {
      name: 'render-bench-never-imports-sim',
      severity: 'error',
      comment: 'The render benchmark (SPK4) is presentation code: it never imports sim or sim-host.',
      from: { path: '^tools/render-bench/' },
      to: { path: pkgTarget(['sim', 'sim-host']) },
    },
    {
      name: 'sim-never-imports-presentation',
      severity: 'error',
      comment: 'Simulation packages never import presentation packages, ai or sim-host.',
      from: { path: '^packages/(fixed|heap|protocol|rules|formats|blueprints|nav|sim)/src/' },
      to: { path: pkgTarget(['render', 'render-fx', 'hud', 'client', 'ai', 'audio', 'sim-host']) },
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
      // Workspace declaration files only: npm packages whose `exports` list `types` first resolve to
      // their .d.ts, and excluding those would hide the import from the npm rules.
      path: ['(^|/)dist/', '(^|/)dist-harness/', '^apps/game/dist-ai-qualification/', '^test-results/', '^playwright-report/', '^(packages|apps|tools|content|test)/.*\\.d\\.ts$'],
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
