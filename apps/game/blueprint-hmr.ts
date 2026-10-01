import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import type { BlueprintModule, ModuleCompileResult } from '@faf/blueprints';

/** Compile whole transactions so a partial write or syntax error never replaces running content. */
export function blueprintHmr(repoRoot: string): Plugin {
  const root = resolve(process.env['FAF_BLUEPRINT_DIR'] ?? join(repoRoot, 'content/blueprints'));
  const locales = resolve(process.env['FAF_LOCALES_DIR'] ?? join(repoRoot, 'content/locales'));
  let timer: ReturnType<typeof setTimeout> | undefined;
  let server: ViteDevServer;
  let generation = 0;
  const contains = (path: string): boolean => path.startsWith(root + sep) || path.startsWith(locales + sep);
  async function walk(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const e of entries) {
      const path = join(dir, e.name);
      if (e.isDirectory()) files.push(...await walk(path));
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) files.push(path);
    }
    return files.sort();
  }
  async function compile(changedAt: number, ownGeneration: number): Promise<void> {
    try {
      // Invalidate importers too: inherited definitions must use the updated base module.
      for (const module of server.moduleGraph.idToModuleMap.values()) if (module.file !== null && contains(module.file)) server.moduleGraph.invalidateModule(module);
      const compiler = await server.ssrLoadModule(join(repoRoot, 'packages/blueprints/src/index.ts')) as { compileBlueprintModules(modules: BlueprintModule[], locales: unknown, options: { includeTest: boolean }): ModuleCompileResult };
      const modules: BlueprintModule[] = [];
      for (const path of await walk(root)) modules.push({ source: relative(root, path), exports: await server.ssrLoadModule(path) });
      const de: unknown = JSON.parse(await readFile(join(locales, 'de.json'), 'utf8'));
      const en: unknown = JSON.parse(await readFile(join(locales, 'en.json'), 'utf8'));
      const result = compiler.compileBlueprintModules(modules, { de, en }, { includeTest: false });
      if (generation !== ownGeneration) return;
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      server.ws.send({ type: 'custom', event: 'faf:blueprints', data: { simBin: Array.from(result.result.simBin), viewJson: result.result.viewJson, changedAt } });
    } catch (error) {
      if (generation !== ownGeneration) return;
      server.ws.send({ type: 'custom', event: 'faf:blueprint-error', data: { message: error instanceof Error ? error.message : String(error), changedAt } });
    }
  }
  const schedule = (file: string): void => {
    if (!contains(file)) return;
    const changedAt = Date.now(); const next = ++generation;
    clearTimeout(timer);
    timer = setTimeout(() => { void compile(changedAt, next); }, 60);
  };
  return {
    name: 'faf-blueprint-hmr',
    apply: 'serve',
    configureServer(s) {
      server = s;
      s.watcher.add([root, locales]);
      s.watcher.on('add', schedule); s.watcher.on('unlink', schedule);
      s.httpServer?.once('close', () => { clearTimeout(timer); s.watcher.off('add', schedule); s.watcher.off('unlink', schedule); });
    },
    handleHotUpdate(context) {
      if (!contains(context.file)) return;
      schedule(context.file);
      return [];
    },
  };
}
