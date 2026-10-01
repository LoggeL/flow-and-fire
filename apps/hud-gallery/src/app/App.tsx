import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { REGISTRY_ERRORS, STORIES, findStory } from '../registry.ts';
import { reportError, setReady, setRoute } from './global.ts';
import { IndexPage } from './IndexPage.tsx';
import { MatrixPage } from './MatrixPage.tsx';
import { parseRoute } from './route.ts';
import { StoryPage } from './StoryPage.tsx';

function useHash(): string {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = (): void => {
      setReady(false);
      setHash(location.hash);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

/** Hash router of the gallery (index, story, matrix). */
export function App(): JSX.Element {
  const hash = useHash();
  const route = parseRoute(hash);
  setRoute(hash);
  document.body.classList.toggle('is-shot', route.params.shot);

  switch (route.kind) {
    case 'index':
      return <IndexPage stories={STORIES} errors={REGISTRY_ERRORS} params={route.params} />;
    case 'matrix':
      return <MatrixPage component={route.component} stories={STORIES} params={route.params} />;
    case 'story': {
      const entry = findStory(route.id);
      if (entry === undefined) return <NotFound what={`Story „${route.id}“`} />;
      return <StoryPage key={hash} entry={entry} params={route.params} routeKey={hash} />;
    }
    default:
      return <NotFound what={`Route „${route.path}“`} />;
  }
}

function NotFound({ what }: { readonly what: string }): JSX.Element {
  useEffect(() => {
    reportError(`${what} nicht gefunden`);
    setReady(true);
  }, [what]);
  return (
    <div class="gal-page">
      <p class="gal-alert">
        {what} nicht gefunden. <a href="#/">Zur Übersicht</a>
      </p>
    </div>
  );
}
