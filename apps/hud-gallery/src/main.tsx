/**
 * HUD gallery entry: HUD styles, strategic icon sprite, error capture and the hash router.
 * The gallery is a developer tool (German chrome); stories live in src/stories/*.stories.tsx.
 */
import '@faf/hud/styles.css';
import './app/gallery.css';
import { IconSprite, ensureLineIconSprite } from '@faf/hud';
import { render } from 'preact';
import { App } from './app/App.tsx';
import { initGalleryGlobal, reportError } from './app/global.ts';
import { REGISTRY_ERRORS, storyManifest } from './registry.ts';

initGalleryGlobal(storyManifest(), REGISTRY_ERRORS);
for (const e of REGISTRY_ERRORS) console.error(`[hud-gallery] ${e}`);

window.addEventListener('error', (e) => {
  reportError(`uncaught: ${e.error instanceof Error ? (e.error.stack ?? e.error.message) : e.message}`);
});
window.addEventListener('unhandledrejection', (e) => {
  const r: unknown = e.reason;
  reportError(`unhandled rejection: ${r instanceof Error ? (r.stack ?? r.message) : String(r)}`);
});

ensureLineIconSprite(document);

const root = document.getElementById('app');
if (root === null) throw new Error('hud-gallery: #app missing');
render(
  <>
    <IconSprite />
    <App />
  </>,
  root,
);
