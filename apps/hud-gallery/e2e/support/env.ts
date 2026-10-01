/**
 * Environment of the gallery E2E run (shared by playwright.config.ts and the specs). Parallel runs of
 * several agents stay apart through:
 *   FAF_HUD_E2E_PORT  preview port (default 4483)
 *   FAF_HUD_OUT_DIR   build output relative to apps/hud-gallery (default dist)
 *   FAF_HUD_SHOT_DIR  screenshots, artifacts and JSON report relative to the repo root (default test-results/hud-gallery)
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ManifestStory {
  readonly id: string;
  readonly component: string;
  readonly state: string;
  readonly title: string;
  readonly layout: 'component' | 'fullscreen';
  readonly viewport: { readonly width: number; readonly height: number };
  readonly scale: number;
  readonly tags: readonly string[];
  readonly nodeBudget: number;
  readonly source: string;
}

export interface StoryManifest {
  readonly stories: readonly ManifestStory[];
  readonly errors: readonly string[];
}

export const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const REPO_ROOT = resolve(APP_DIR, '../..');

export const PORT = Number(process.env['FAF_HUD_E2E_PORT'] || 4483);
const outDirEnv = process.env['FAF_HUD_OUT_DIR'] || 'dist';
const shotDirEnv = process.env['FAF_HUD_SHOT_DIR'] || 'test-results/hud-gallery';
/** Build output as given to vite (relative to apps/hud-gallery unless absolute). */
export const OUT_DIR_ARG = outDirEnv;
export const OUT_DIR = isAbsolute(outDirEnv) ? outDirEnv : resolve(APP_DIR, outDirEnv);
export const SHOT_DIR = isAbsolute(shotDirEnv) ? shotDirEnv : resolve(REPO_ROOT, shotDirEnv);
export const BASE_URL = `http://127.0.0.1:${PORT}`;

/** Reads <outDir>/stories.json written by the vite build (storyManifest plugin). */
export function loadManifest(): StoryManifest {
  const file = resolve(OUT_DIR, 'stories.json');
  if (!existsSync(file)) {
    throw new Error(`hud-gallery e2e: ${file} missing – run \`vite build\` (pnpm --filter @faf/hud-gallery run build) first`);
  }
  return JSON.parse(readFileSync(file, 'utf8')) as StoryManifest;
}

/** Whether a story gets the extra pseudo-locale pass (fullscreen always, otherwise unless tagged no-pseudo). */
export function wantsPseudo(s: Pick<ManifestStory, 'layout' | 'tags'>): boolean {
  return s.layout === 'fullscreen' || !s.tags.includes('no-pseudo');
}

/** Playwright title of a story test; `-g 'grp=<file stem> '` selects one stories file. */
export function storyTitle(s: Pick<ManifestStory, 'source' | 'id'>, suffix = ''): string {
  return `grp=${s.source} ${s.id}${suffix === '' ? '' : ` ${suffix}`}`;
}
