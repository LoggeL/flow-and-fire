import type { JSX } from 'preact';
import type { StoryMeta } from '../story.ts';
import { matrixHref, storyHref } from './route.ts';
import type { GalleryLocale, GalleryParams, GalleryTeams } from './route.ts';

const LOCALES: readonly GalleryLocale[] = ['de', 'en', 'pseudo'];
const TEAMS: readonly GalleryTeams[] = ['house', 'relation', 'cvd'];
const SCALES: readonly number[] = [0.8, 1, 1.25, 1.5];

/** Head bar of the story page: back link, story identity, quick switches for locale/teams/scale/motion. */
export function GalleryBar({ meta, params }: { readonly meta: StoryMeta; readonly params: GalleryParams }): JSX.Element {
  const withParams = (p: Partial<GalleryParams>): string => storyHref(meta.id, { ...params, shot: false, ...p });
  const scale = params.scale ?? meta.scale;
  const { motion: _motion, ...withoutMotion } = params;
  return (
    <header class="gal-bar">
      <a class="gal-bar__back" href={`#/${params.locale ? `?locale=${params.locale}` : ''}`}>
        ← Übersicht
      </a>
      <div class="gal-bar__title">
        <b>{meta.component}</b>
        <span class="gal-chip">{meta.state}</span>
        <span class="gal-muted">{meta.title}</span>
        <code class="gal-muted">
          {meta.id} · {meta.source}.stories.tsx · {meta.viewport.width}×{meta.viewport.height}
        </code>
      </div>
      <nav class="gal-bar__opts" aria-label="Story-Optionen">
        <span class="gal-seg">
          {LOCALES.map((l) => (
            <a class={(params.locale ?? 'de') === l ? 'is-on' : ''} href={withParams({ locale: l })}>
              {l}
            </a>
          ))}
        </span>
        <span class="gal-seg">
          {TEAMS.map((t) => (
            <a class={(params.teams ?? 'house') === t ? 'is-on' : ''} href={withParams({ teams: t })}>
              {t}
            </a>
          ))}
        </span>
        <span class="gal-seg">
          {SCALES.map((s) => (
            <a class={scale === s ? 'is-on' : ''} href={withParams({ scale: s })}>
              ×{String(s).replace('.', ',')}
            </a>
          ))}
        </span>
        <span class="gal-seg">
          <a
            class={params.motion === 'reduce' ? 'is-on' : ''}
            href={params.motion === 'reduce' ? storyHref(meta.id, { ...withoutMotion, shot: false }) : withParams({ motion: 'reduce' })}
          >
            Bewegung reduziert
          </a>
        </span>
        <a class="gal-btn" href={matrixHref(meta.component, { ...params, shot: false })}>
          Matrix
        </a>
        <a class="gal-btn" href={storyHref(meta.id, { ...params, shot: true })}>
          Shot
        </a>
      </nav>
    </header>
  );
}
