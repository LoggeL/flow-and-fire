/**
 * window.__HUD_GALLERY__: the handshake between the gallery and Playwright (e2e/gallery.spec.ts).
 *   ready   – current page rendered, fonts loaded, two frames painted
 *   stories – metadata of all registered stories
 *   errors  – registry errors, render errors, uncaught errors/rejections
 */
import type { StoryMeta } from '../story.ts';

export interface GalleryCommandCall {
  readonly name: string;
  readonly args: readonly unknown[];
}

export interface HudGalleryGlobal {
  ready: boolean;
  /** Current hash route. */
  route: string;
  stories: readonly StoryMeta[];
  errors: string[];
  /** Command calls of the current story. */
  commandLog(): readonly GalleryCommandCall[];
}

declare global {
  interface Window {
    __HUD_GALLERY__?: HudGalleryGlobal;
  }
}

let logSource: () => readonly GalleryCommandCall[] = () => [];

export function initGalleryGlobal(stories: readonly StoryMeta[], registryErrors: readonly string[]): HudGalleryGlobal {
  const g: HudGalleryGlobal = {
    ready: false,
    route: location.hash,
    stories,
    errors: [...registryErrors],
    commandLog: () => logSource(),
  };
  window.__HUD_GALLERY__ = g;
  return g;
}

function g(): HudGalleryGlobal | undefined {
  return typeof window === 'undefined' ? undefined : window.__HUD_GALLERY__;
}

export function setReady(ready: boolean): void {
  const s = g();
  if (s !== undefined) s.ready = ready;
}

export function setRoute(route: string): void {
  const s = g();
  if (s !== undefined) s.route = route;
}

export function reportError(message: string): void {
  const s = g();
  if (s !== undefined) s.errors.push(message);
  console.error(`[hud-gallery] ${message}`);
}

export function setCommandLogSource(src: () => readonly GalleryCommandCall[]): void {
  logSource = src;
}

/** Resolves after the fonts are loaded and two animation frames have been painted. */
export async function settled(): Promise<void> {
  // document.fonts is missing in some test DOMs (happy-dom).
  const fonts = (document as { fonts?: FontFaceSet }).fonts;
  if (fonts !== undefined) await fonts.ready;
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
}
