/**
 * Repository location helpers (Node only). The arena reads maps from `content/maps` and the design
 * data from `docs/design`; both are located relative to the pnpm workspace root.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let cachedRoot: string | null = null;

/**
 * Absolute path of the monorepo root: the nearest directory at or above this module that contains
 * `pnpm-workspace.yaml`. Throws when none is found (the arena only runs inside the repository).
 */
export function repoRoot(): string {
  if (cachedRoot !== null) return cachedRoot;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      cachedRoot = dir;
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error('ai-arena: pnpm-workspace.yaml not found above ' + fileURLToPath(import.meta.url));
    dir = parent;
  }
}

/** Absolute path of a repository-relative path (segments joined with the platform separator). */
export function repoPath(...segments: string[]): string {
  return join(repoRoot(), ...segments);
}
