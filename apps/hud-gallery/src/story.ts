/**
 * Story contract of the HUD gallery (docs/plans/TRACK-HUD-contract.md). Every
 * src/stories/<group>.stories.tsx default-exports `readonly Story[]` (use defineStories for typing);
 * registry.ts collects them via import.meta.glob.
 */
import type { HudCommands, HudModel, RecordedCall } from '@faf/hud';
import type { ComponentChildren } from 'preact';

export interface StoryContext {
  readonly model: HudModel;
  readonly commands: HudCommands;
  /** Recorded command calls of this story (also shown in the gallery's command log). */
  readonly log: RecordedCall[];
}

export interface Story {
  /** Globally unique, kebab-case, e.g. "resource-meter--stall". */
  id: string;
  /** Component name from ui.md §6 (see required-states.ts). */
  component: string;
  /** State name from ui.md §6, German as written there. */
  state: string;
  title: string;
  layout: 'component' | 'fullscreen';
  /** Default: fullscreen 1920×1080, component 960×640. */
  viewport?: { width: number; height: number };
  /** UI scale (html font-size = 16 px × scale); default 1. */
  scale?: number;
  /** 'xbrowser' (screenshots in Firefox/WebKit too), 'perf', 'no-pseudo' (skip the pseudo-locale pass). */
  tags?: readonly string[];
  /** DOM budget under [data-hud-root] (default 700, ui.md §9.2). */
  nodeBudget?: number;
  /** Runs once before the first render (fill model signals, start timers); may return a cleanup. */
  setup?(ctx: StoryContext): void | (() => void);
  render(ctx: StoryContext): ComponentChildren;
}

/** Identity helper that types a story list. */
export function defineStories(stories: readonly Story[]): readonly Story[] {
  return stories;
}

export type StoryLayout = Story['layout'];

/** Tags the harness understands. */
export const STORY_TAGS = ['xbrowser', 'perf', 'no-pseudo'] as const;

export const DEFAULT_VIEWPORTS: Readonly<Record<StoryLayout, { readonly width: number; readonly height: number }>> = {
  fullscreen: { width: 1920, height: 1080 },
  component: { width: 960, height: 640 },
};

export const DEFAULT_NODE_BUDGET = 700;

/** Serializable story metadata (window.__HUD_GALLERY__.stories, dist/stories.json for Playwright). */
export interface StoryMeta {
  readonly id: string;
  readonly component: string;
  readonly state: string;
  readonly title: string;
  readonly layout: StoryLayout;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly scale: number;
  readonly tags: readonly string[];
  readonly nodeBudget: number;
  /** Stem of the stories file (`top` for top.stories.tsx); Playwright titles use `grp=<source> <id>`. */
  readonly source: string;
}

export function storyMeta(story: Story, source: string): StoryMeta {
  const vp = story.viewport ?? DEFAULT_VIEWPORTS[story.layout];
  return {
    id: story.id,
    component: story.component,
    state: story.state,
    title: story.title,
    layout: story.layout,
    viewport: { width: vp.width, height: vp.height },
    scale: story.scale ?? 1,
    tags: [...(story.tags ?? [])],
    nodeBudget: story.nodeBudget ?? DEFAULT_NODE_BUDGET,
    source,
  };
}
