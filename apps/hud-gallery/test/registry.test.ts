// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { STORIES, buildRegistry, storyManifest, storySource } from '../src/registry.ts';
import { DEFAULT_NODE_BUDGET, DEFAULT_VIEWPORTS, storyMeta } from '../src/story.ts';
import type { Story } from '../src/story.ts';

const ok = (id: string, extra: Partial<Story> = {}): Story => ({
  id,
  component: 'Button',
  state: 'Standard',
  title: id,
  layout: 'component',
  render: () => null,
  ...extra,
});

describe('story registry', () => {
  it('file stem is the source (Playwright group)', () => {
    expect(storySource('./stories/top.stories.tsx')).toBe('top');
    expect(storySource('/x/y/menus.stories.tsx')).toBe('menus');
  });

  it('collects stories in file order and remembers the source', () => {
    const r = buildRegistry({
      './stories/b.stories.tsx': { default: [ok('b-one')] },
      './stories/a.stories.tsx': { default: [ok('a-one'), ok('a-two--hover')] },
    });
    expect(r.errors).toEqual([]);
    expect(r.stories.map((s) => [s.meta.id, s.meta.source])).toEqual([
      ['a-one', 'a'],
      ['a-two--hover', 'a'],
      ['b-one', 'b'],
    ]);
  });

  it('rejects duplicates, bad ids, missing fields, unknown tags and non-array exports', () => {
    const r = buildRegistry({
      './stories/a.stories.tsx': { default: [ok('dup'), ok('Bad_Id'), ok('no-render', { render: undefined as unknown as Story['render'] })] },
      './stories/b.stories.tsx': { default: [ok('dup'), ok('tagged', { tags: ['xbrowser', 'nope'] })] },
      './stories/c.stories.tsx': { default: { id: 'x' } },
      './stories/d.stories.tsx': {},
    });
    expect(r.stories.map((s) => s.meta.id)).toEqual(['dup']);
    expect(r.errors).toEqual([
      "a.stories.tsx[1]: id 'Bad_Id' is not kebab-case",
      'a.stories.tsx[2]: render missing',
      "b.stories.tsx[0]: duplicate story id 'dup' (first in a.stories.tsx)",
      "b.stories.tsx[1]: unknown tag 'nope'",
      './stories/c.stories.tsx: default export is not a Story[]',
      './stories/d.stories.tsx: default export is not a Story[]',
    ]);
  });

  it('metadata defaults (viewport per layout, scale 1, node budget 700)', () => {
    expect(storyMeta(ok('a'), 'x')).toEqual({
      id: 'a',
      component: 'Button',
      state: 'Standard',
      title: 'a',
      layout: 'component',
      viewport: DEFAULT_VIEWPORTS.component,
      scale: 1,
      tags: [],
      nodeBudget: DEFAULT_NODE_BUDGET,
      source: 'x',
    });
    expect(storyMeta(ok('b', { layout: 'fullscreen', scale: 1.25, tags: ['xbrowser'] }), 'y')).toMatchObject({
      viewport: { width: 1920, height: 1080 },
      scale: 1.25,
      tags: ['xbrowser'],
    });
  });

  it('the real registry contains the data stories and a serializable manifest', () => {
    const ids = STORIES.map((s) => s.meta.id);
    expect(ids).toContain('strategic-icon--normal');
    const manifest = storyManifest();
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
    expect(manifest.find((m) => m.id === 'strategic-icon--normal')).toMatchObject({ source: 'data', component: 'StrategicIcon' });
  });
});
