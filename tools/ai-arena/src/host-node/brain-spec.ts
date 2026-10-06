/**
 * Brain factory specifiers: 'module#export' names a function `(options?) => AiBrain` exported by a
 * module. Tournaments, benchmarks and the AI worker entry resolve the same string, so a worker and
 * a synchronous host run exactly the same brain code.
 *
 * - bare module names are resolved from @faf/ai-arena (e.g. '@faf/ai#createDefaultBrain'),
 * - 'file:' URLs are imported as given (test fixtures),
 * - relative or absolute paths are resolved against the process cwd.
 */
import type { AiBrain } from '@faf/ai';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Default brain of tournaments and benchmarks (TRACK-AI tai-p5). */
export const DEFAULT_BRAIN_SPEC = '@faf/ai#createDefaultBrain';

export type LoadedBrainFactory = () => AiBrain;

export interface ParsedBrainSpec {
  readonly module: string;
  readonly exportName: string;
}

/** Splits 'module#export' (the export defaults to 'default'). */
export function parseBrainSpec(spec: string): ParsedBrainSpec {
  const i = spec.lastIndexOf('#');
  const module = i < 0 ? spec : spec.slice(0, i);
  const exportName = i < 0 ? 'default' : spec.slice(i + 1);
  if (module.length === 0 || exportName.length === 0) throw new Error(`brain spec '${spec}': expected 'module#export'`);
  return { module, exportName };
}

/** Import specifier of the module part. */
export function brainModuleUrl(module: string): string {
  if (module.startsWith('file:')) return module;
  if (module.startsWith('.') || isAbsolute(module)) return pathToFileURL(isAbsolute(module) ? module : resolve(process.cwd(), module)).href;
  return module;
}

/** A spec with a path module turned into a file URL (so workers with another cwd resolve it too). */
export function normalizeBrainSpec(spec: string): string {
  const p = parseBrainSpec(spec);
  return `${brainModuleUrl(p.module)}#${p.exportName}`;
}

const cache = new Map<string, Promise<LoadedBrainFactory>>();

/** Loads the factory of a spec (cached per thread). Each call of the factory creates a fresh brain. */
export function loadBrainFactory(spec: string): Promise<LoadedBrainFactory> {
  const key = normalizeBrainSpec(spec);
  let p = cache.get(key);
  if (p === undefined) {
    const parsed = parseBrainSpec(key);
    p = import(parsed.module).then((mod: Record<string, unknown>) => {
      const f = mod[parsed.exportName];
      if (typeof f !== 'function') throw new Error(`brain spec '${spec}': export '${parsed.exportName}' is not a function`);
      return () => {
        const brain = (f as () => unknown)() as AiBrain;
        if (brain === null || typeof brain !== 'object' || typeof brain.think !== 'function' || typeof brain.init !== 'function') {
          throw new Error(`brain spec '${spec}': factory did not return an AiBrain`);
        }
        return brain;
      };
    });
    cache.set(key, p);
  }
  return p;
}
