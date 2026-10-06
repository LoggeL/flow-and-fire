import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import type { RegisteredStory } from '../registry.ts';
import { computeCoverage, coverageProblems } from '../required-states.ts';
import { setReady, settled } from './global.ts';
import { matrixHref, storyHref } from './route.ts';
import type { GalleryLocale, GalleryParams } from './route.ts';

const LOCALES: readonly GalleryLocale[] = ['de', 'en', 'pseudo'];

/** Overview: every component (ui.md §6 order) with all its states as links; missing states greyed out. */
export function IndexPage({
  stories,
  errors,
  params,
}: {
  readonly stories: readonly RegisteredStory[];
  readonly errors: readonly string[];
  readonly params: GalleryParams;
}): JSX.Element {
  useEffect(() => {
    let live = true;
    void settled().then(() => {
      if (live) setReady(true);
    });
    return () => {
      live = false;
      setReady(false);
    };
  }, []);

  const metas = stories.map((s) => s.meta);
  const coverage = computeCoverage(metas);
  const problems = coverageProblems(metas, false);
  const pending = coverage.filter((c) => c.storyCount === 0).length;
  const linkParams: Partial<GalleryParams> = params.locale !== undefined ? { locale: params.locale } : {};

  return (
    <div class="gal-page gal-page--index">
      <header class="gal-index__head">
        <h1>HUD-Galerie</h1>
        <p class="gal-muted">
          {metas.length} Stories · {coverage.length - pending} von {coverage.length} Komponenten mit Stories · Soll-Zustände aus
          ui.md §6 (<code>src/required-states.ts</code>)
        </p>
        <span class="gal-seg">
          {LOCALES.map((l) => (
            <a class={(params.locale ?? 'de') === l ? 'is-on' : ''} href={`#/?locale=${l}`}>
              {l}
            </a>
          ))}
        </span>
      </header>
      {errors.length > 0 && (
        <section class="gal-alert" data-testid="gallery-registry-errors">
          <b>Registry-Fehler</b>
          <ul>
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </section>
      )}
      {problems.length > 0 && (
        <section class="gal-alert gal-alert--warn">
          <b>Unvollständige Abdeckung</b>
          <ul>
            {problems.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </section>
      )}
      <div class="gal-index__grid">
        {coverage.map((c) => {
          const own = stories.filter((s) => s.meta.component === c.component);
          const states = [...c.required, ...c.extra];
          return (
            <section class={`gal-comp ${c.storyCount === 0 ? 'is-pending' : ''}`} key={c.component} data-component-card={c.component}>
              <h2>
                {c.storyCount > 0 ? <a href={matrixHref(c.component, linkParams)}>{c.component}</a> : c.component}
                <small>
                  {c.group ?? '–'} · {c.covered.length}/{c.required.length}
                </small>
              </h2>
              <ul>
                {states.map((st) => {
                  const hits = own.filter((s) => s.meta.state === st);
                  const required = c.required.includes(st);
                  return (
                    <li key={st} class={hits.length === 0 ? 'is-missing' : required ? '' : 'is-extra'}>
                      <span class="gal-state">{st}</span>
                      {hits.map((s) => (
                        <a key={s.meta.id} href={storyHref(s.meta.id, linkParams)} title={s.meta.title}>
                          {s.meta.id}
                        </a>
                      ))}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
