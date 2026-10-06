/**
 * Blueprint HMR plugin of the dev server (MS3, "Compiler komplett mit HMR"; see src/hmr.ts for the
 * page side and the payload contract).
 *
 * - Watches the blueprint sources and the locale tables (default `content/blueprints` and
 *   `content/locales`; `FAF_BLUEPRINT_DIR` / `FAF_LOCALES_DIR` point to other directories, e.g. a
 *   temporary copy for E2E). Vite's own HMR handling is suppressed for those files (no page reload).
 * - On a change (debounced): the content modules are invalidated in the SSR module graph and loaded
 *   again through `server.ssrLoadModule`, compiled with `compileBlueprintModules` (loaded through
 *   the same module graph) and sent to the page as the custom event `faf:blueprints` with sim.bin
 *   (base64) + view.json, or with the formatted diagnostics on a compile error.
 * - Content copies outside the repo keep working: the relative `…/packages/blueprints/src/define.ts`
 *   imports of the content files are resolved to the repo's define.ts.
 * - Warm-up after the server starts (compiler + content loaded once), so the first update does not
 *   pay the module loading.
 */
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { join, relative, resolve, sep } from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import { BLUEPRINT_HMR_EVENT, type BlueprintHmrPayload } from '../src/hmr.ts';

type BlueprintsModule = typeof import('@faf/blueprints');

export interface BlueprintHmrOptions {
  /** Repository root (…/flow-and-fire). */
  readonly repoRoot: string;
  /** Blueprint sources; default `FAF_BLUEPRINT_DIR` or `<repo>/content/blueprints`. */
  readonly blueprintDir?: string;
  /** Locale tables (de.json, en.json); default `FAF_LOCALES_DIR` or `<repo>/content/locales`. */
  readonly localesDir?: string;
  /** Debounce of file events in ms (default 25). */
  readonly debounceMs?: number;
}

/** Every `*.ts` below `dir` (absolute paths, sorted). */
export function contentFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

/** `source` of a content file as the CLI names it (`content/blueprints/<relative path>`). */
export function contentSource(blueprintDir: string, file: string): string {
  return ['content', 'blueprints', ...relative(blueprintDir, file).split(sep)].join('/');
}

/** Removes ANSI escape sequences (colors, cursor codes) from a message. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

/** True if `file` lies inside `dir`. */
function inside(dir: string, file: string): boolean {
  return file === dir || file.startsWith(dir + sep);
}

/** A directory under its given and its real path (macOS: /var → /private/var symlinks). */
function aliases(dir: string): string[] {
  try {
    const real = realpathSync(dir);
    return real === dir ? [dir] : [dir, real];
  } catch {
    return [dir];
  }
}

function insideAny(dirs: readonly string[], file: string): boolean {
  for (const d of dirs) if (inside(d, file)) return true;
  return false;
}

export function blueprintHmrPlugin(opts: BlueprintHmrOptions): Plugin {
  const repo = resolve(opts.repoRoot);
  const bpDir = resolve(opts.blueprintDir ?? process.env['FAF_BLUEPRINT_DIR'] ?? join(repo, 'content', 'blueprints'));
  const locDir = resolve(opts.localesDir ?? process.env['FAF_LOCALES_DIR'] ?? join(repo, 'content', 'locales'));
  const compilerEntry = join(repo, 'packages', 'blueprints', 'src', 'index.ts');
  const defineFile = join(repo, 'packages', 'blueprints', 'src', 'define.ts');
  const debounceMs = opts.debounceMs ?? 25;
  const bpDirs = aliases(bpDir);
  const locDirs = aliases(locDir);
  let server: ViteDevServer | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const changed = new Set<string>();
  let changedAt = 0;
  let firstEventAt = 0;
  let running = false;
  let rerun = false;
  let updateId = 0;

  const isContent = (file: string): boolean => {
    const f = resolve(file);
    return (insideAny(bpDirs, f) && f.endsWith('.ts')) || (insideAny(locDirs, f) && f.endsWith('.json'));
  };

  /** Repo-style name of a content file (`content/blueprints/…`, `content/locales/…`), also for copies. */
  const logicalName = (f: string): string => {
    for (const d of bpDirs) if (inside(d, f)) return contentSource(d, f);
    for (const d of locDirs) if (inside(d, f)) return ['content', 'locales', ...relative(d, f).split(sep)].join('/');
    return relative(repo, f).split(sep).join('/');
  };
  const shortDir = (d: string): string => {
    const r = relative(repo, d);
    return r.startsWith('..') ? d : r;
  };

  const log = (msg: string): void => server?.config.logger.info(`[faf-hmr] ${msg}`, { timestamp: true });

  /** Loads the compiler and all content modules (fresh after invalidation) and compiles them. */
  const compile = async (s: ViteDevServer): Promise<{ result: ReturnType<BlueprintsModule['compileBlueprintModules']>; format: BlueprintsModule['formatDiagnostics'] }> => {
    const graph = s.environments['ssr']?.moduleGraph;
    if (graph !== undefined) {
      for (const m of graph.idToModuleMap.values()) {
        if (m.file !== null && (insideAny(bpDirs, m.file) || insideAny(locDirs, m.file))) graph.invalidateModule(m);
      }
    }
    const bp = (await s.ssrLoadModule(compilerEntry)) as BlueprintsModule;
    const modules: { source: string; exports: unknown }[] = [];
    for (const f of contentFiles(bpDir)) modules.push({ source: contentSource(bpDir, f), exports: await s.ssrLoadModule(f) });
    const locales = {
      de: JSON.parse(readFileSync(join(locDir, 'de.json'), 'utf8')) as unknown,
      en: JSON.parse(readFileSync(join(locDir, 'en.json'), 'utf8')) as unknown,
    };
    return { result: bp.compileBlueprintModules(modules, locales), format: bp.formatDiagnostics };
  };

  const run = async (): Promise<void> => {
    const s = server;
    if (s === null) return;
    if (running) {
      rerun = true;
      return;
    }
    running = true;
    const files = [...changed].map(logicalName).sort();
    changed.clear();
    const at = changedAt;
    const t0 = performance.now();
    const id = ++updateId;
    let payload: BlueprintHmrPayload;
    try {
      const { result, format } = await compile(s);
      const compileMs = performance.now() - t0;
      if (result.ok) {
        payload = {
          ok: true,
          id,
          files,
          changedAt: at,
          compiledAt: Date.now(),
          compileMs,
          simBin: Buffer.from(result.simBin.buffer, result.simBin.byteOffset, result.simBin.byteLength).toString('base64'),
          viewJson: result.viewJson,
          simHash: result.hashes.simHash >>> 0,
          viewHash: result.hashes.viewHash >>> 0,
        };
        log(`#${id} ${files.join(', ')} → simHash 0x${(result.hashes.simHash >>> 0).toString(16).padStart(8, '0')} (${compileMs.toFixed(0)} ms)`);
      } else {
        const text = format(result.diagnostics);
        payload = { ok: false, id, files, changedAt: at, compiledAt: Date.now(), compileMs, diagnostics: text, count: result.diagnostics.length };
        s.config.logger.error(`[faf-hmr] #${id} blueprint compile failed:\n${text}`);
      }
    } catch (e) {
      // Module load errors (syntax errors, broken imports, invalid locale JSON).
      // Transform/load errors come with ANSI colors (terminal output): plain text for HUD and console.
      const text = stripAnsi(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
      payload = { ok: false, id, files, changedAt: at, compiledAt: Date.now(), compileMs: performance.now() - t0, diagnostics: text, count: 1 };
      s.config.logger.error(`[faf-hmr] #${id} blueprint load failed: ${text}`);
    }
    s.ws.send({ type: 'custom', event: BLUEPRINT_HMR_EVENT, data: payload });
    running = false;
    if (rerun) {
      rerun = false;
      void run();
    }
  };

  const onFile = (file: string, deleted: boolean): void => {
    if (!isContent(file)) return;
    let f = resolve(file);
    if (!deleted) {
      try {
        f = realpathSync(f); // one name per file (watchers may report symlinked and real paths)
      } catch {
        // vanished: keep the reported name
      }
    }
    let mtime = Date.now();
    if (!deleted) {
      try {
        mtime = statSync(f).mtimeMs;
      } catch {
        // vanished in between: keep now
      }
    }
    if (changed.size === 0) {
      firstEventAt = Date.now();
      changedAt = mtime;
    } else {
      changedAt = Math.min(changedAt, mtime);
    }
    changed.add(f);
    if (timer !== null) clearTimeout(timer);
    // Never wait longer than 4 debounce windows after the first event of a burst.
    const wait = Math.max(0, Math.min(debounceMs, firstEventAt + 4 * debounceMs - Date.now()));
    timer = setTimeout(() => {
      timer = null;
      void run();
    }, wait);
  };

  return {
    name: 'faf-blueprint-hmr',
    apply: 'serve',
    enforce: 'pre',
    resolveId(id, importer) {
      // Content copies outside the repo (FAF_BLUEPRINT_DIR): the define helper stays the repo's.
      if (importer !== undefined && insideAny(bpDirs, resolve(importer)) && id.endsWith('packages/blueprints/src/define.ts')) return defineFile;
      return null;
    },
    configureServer(s) {
      server = s;
      s.watcher.add([bpDir, locDir]);
      s.watcher.on('change', (f: string) => onFile(f, false));
      s.watcher.on('add', (f: string) => onFile(f, false));
      s.watcher.on('unlink', (f: string) => onFile(f, true));
      s.httpServer?.once('listening', () => {
        // Warm-up: compiler + content in the SSR module graph (errors show up with the first update).
        compile(s)
          .then(({ result }) => log(`watching ${shortDir(bpDir)} + ${shortDir(locDir)} (${result.ok ? 'content ok' : 'content has errors'})`))
          .catch((e: unknown) => s.config.logger.warn(`[faf-hmr] warm-up failed: ${e instanceof Error ? e.message : String(e)}`));
      });
    },
    hotUpdate(ctx) {
      // Blueprint/locale files are handled by this plugin only: no default HMR, no page reload.
      if (isContent(ctx.file)) return [];
      return undefined;
    },
  };
}
