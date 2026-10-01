import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import type { RegisteredStory } from '../registry.ts';
import { requiredOf } from '../required-states.ts';
import { reportError, setReady, settled } from './global.ts';
import { storyHref } from './route.ts';
import type { GalleryParams } from './route.ts';

/** Width of one matrix tile; stories are scaled down into it (each story runs isolated in an iframe). */
const TILE_W = 480;

/** All stories of one component side by side, in required-state order. */
export function MatrixPage({
  component,
  stories,
  params,
}: {
  readonly component: string;
  readonly stories: readonly RegisteredStory[];
  readonly params: GalleryParams;
}): JSX.Element {
  const req = requiredOf(component);
  const order = req?.states ?? [];
  const own = stories
    .filter((s) => s.meta.component === component)
    .map((s, i) => ({ s, i, rank: order.includes(s.meta.state) ? order.indexOf(s.meta.state) : order.length }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((x) => x.s);

  useEffect(() => {
    if (own.length === 0) reportError(`matrix: no stories for component '${component}'`);
    let live = true;
    void settled().then(() => {
      if (live) setReady(true);
    });
    return () => {
      live = false;
      setReady(false);
    };
  }, [component]);

  const base = `${location.pathname}${location.search}`;
  return (
    <div class="gal-page gal-page--matrix">
      <header class="gal-bar">
        <a class="gal-bar__back" href="#/">
          ← Übersicht
        </a>
        <div class="gal-bar__title">
          <b>{component}</b>
          <span class="gal-muted">
            {own.length} Stories{req !== undefined ? ` · Soll: ${req.states.join(' · ')}` : ''}
          </span>
        </div>
      </header>
      <div class="gal-matrix">
        {own.map(({ meta }) => {
          const k = Math.min(1, TILE_W / meta.viewport.width);
          const href = storyHref(meta.id, { ...params, shot: true });
          return (
            <figure class="gal-tile" key={meta.id}>
              <div class="gal-tile__frame" style={{ width: `${meta.viewport.width * k}px`, height: `${meta.viewport.height * k}px` }}>
                <iframe
                  title={meta.id}
                  src={`${base}${href}`}
                  loading="lazy"
                  width={meta.viewport.width}
                  height={meta.viewport.height}
                  style={{ transform: `scale(${k})` }}
                />
              </div>
              <figcaption>
                <a href={storyHref(meta.id, { ...params, shot: false })}>
                  <span class="gal-chip">{meta.state}</span> {meta.title}
                </a>
              </figcaption>
            </figure>
          );
        })}
      </div>
    </div>
  );
}
