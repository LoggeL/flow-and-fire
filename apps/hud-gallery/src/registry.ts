/**
 * Story registry: collects every src/stories/*.stories.tsx (default export `readonly Story[]`), validates
 * the contract (unique kebab-case ids, fields, tags) and remembers the file stem per story (`source`).
 * Invalid or duplicate stories are dropped and reported in REGISTRY_ERRORS (shown on the index page and
 * in window.__HUD_GALLERY__.errors, so the E2E run fails).
 */
import { STORY_TAGS, storyMeta } from './story.ts';
import type { Story, StoryMeta } from './story.ts';

export interface RegisteredStory {
  readonly story: Story;
  readonly meta: StoryMeta;
}

export interface StoryModule {
  readonly default?: unknown;
}

const ID_RE = /^[a-z0-9]+(?:-{1,2}[a-z0-9]+)*$/;

/** Stem of a stories file path (`./stories/top.stories.tsx` → `top`). */
export function storySource(path: string): string {
  const file = path.slice(path.lastIndexOf('/') + 1);
  return file.replace(/\.stories\.tsx?$/, '');
}

function validate(story: unknown, where: string): string[] {
  const errs: string[] = [];
  if (typeof story !== 'object' || story === null) return [`${where}: story is not an object`];
  const s = story as Partial<Story>;
  if (typeof s.id !== 'string' || !ID_RE.test(s.id)) errs.push(`${where}: id '${String(s.id)}' is not kebab-case`);
  for (const f of ['component', 'state', 'title'] as const) {
    if (typeof s[f] !== 'string' || s[f] === '') errs.push(`${where}: ${f} missing`);
  }
  if (s.layout !== 'component' && s.layout !== 'fullscreen') errs.push(`${where}: layout must be component|fullscreen`);
  if (typeof s.render !== 'function') errs.push(`${where}: render missing`);
  if (s.setup !== undefined && typeof s.setup !== 'function') errs.push(`${where}: setup is not a function`);
  if (s.viewport !== undefined && !(s.viewport.width > 0 && s.viewport.height > 0)) errs.push(`${where}: bad viewport`);
  if (s.scale !== undefined && !(s.scale >= 0.5 && s.scale <= 2)) errs.push(`${where}: scale out of range`);
  if (s.nodeBudget !== undefined && !(s.nodeBudget > 0)) errs.push(`${where}: bad nodeBudget`);
  for (const t of s.tags ?? []) {
    if (!(STORY_TAGS as readonly string[]).includes(t)) errs.push(`${where}: unknown tag '${t}'`);
  }
  return errs;
}

/** Builds the registry from glob results (sorted by file name; declaration order within a file). */
export function buildRegistry(modules: Readonly<Record<string, StoryModule>>): {
  readonly stories: readonly RegisteredStory[];
  readonly errors: readonly string[];
} {
  const errors: string[] = [];
  const stories: RegisteredStory[] = [];
  const seen: Record<string, string> = {};
  const paths = Object.keys(modules).sort();
  for (const path of paths) {
    const source = storySource(path);
    const list = modules[path]!.default;
    if (!Array.isArray(list)) {
      errors.push(`${path}: default export is not a Story[]`);
      continue;
    }
    list.forEach((story: unknown, i: number) => {
      const where = `${source}.stories.tsx[${i}]`;
      const errs = validate(story, where);
      if (errs.length > 0) {
        errors.push(...errs);
        return;
      }
      const s = story as Story;
      const prev = seen[s.id];
      if (prev !== undefined) {
        errors.push(`${where}: duplicate story id '${s.id}' (first in ${prev})`);
        return;
      }
      seen[s.id] = `${source}.stories.tsx`;
      stories.push({ story: s, meta: storyMeta(s, source) });
    });
  }
  return { stories, errors };
}

const registry = buildRegistry(import.meta.glob<StoryModule>('./stories/*.stories.tsx', { eager: true }));

export const STORIES: readonly RegisteredStory[] = registry.stories;
export const REGISTRY_ERRORS: readonly string[] = registry.errors;

export function findStory(id: string): RegisteredStory | undefined {
  return STORIES.find((s) => s.meta.id === id);
}

/** Metadata of all stories (window.__HUD_GALLERY__.stories, dist/stories.json). */
export function storyManifest(): StoryMeta[] {
  return STORIES.map((s) => s.meta);
}
