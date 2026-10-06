// @vitest-environment happy-dom
import { render as preactRender } from 'preact';
import type { ComponentChild } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/app/App.tsx';
import { initGalleryGlobal } from '../src/app/global.ts';
import { REGISTRY_ERRORS, storyManifest } from '../src/registry.ts';

// @testing-library/preact is a dependency of @faf/hud only; the gallery uses preact's own test utils.
let host: HTMLElement | null = null;

function render(ui: ComponentChild): { container: HTMLElement; unmount: () => void } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  host = container;
  act(() => {
    preactRender(ui, container);
  });
  return {
    container,
    unmount: () => {
      act(() => preactRender(null, container));
      container.remove();
    },
  };
}

afterEach(() => {
  if (host !== null) {
    act(() => preactRender(null, host!));
    host.remove();
    host = null;
  }
  location.hash = '';
  document.documentElement.removeAttribute('style');
  delete document.documentElement.dataset['teams'];
  delete document.documentElement.dataset['scale'];
});

describe('gallery app', () => {
  it('publishes window.__HUD_GALLERY__ with all stories', () => {
    const g = initGalleryGlobal(storyManifest(), REGISTRY_ERRORS);
    expect(window.__HUD_GALLERY__).toBe(g);
    expect(g.ready).toBe(false);
    expect(g.stories.map((s) => s.id)).toContain('strategic-icon--normal');
    expect(g.errors).toEqual([]);
  });

  it('index lists components with state links', () => {
    initGalleryGlobal(storyManifest(), REGISTRY_ERRORS);
    location.hash = '#/';
    const { container } = render(<App />);
    const card = container.querySelector('[data-component-card="StrategicIcon"]');
    expect(card).not.toBeNull();
    expect(card!.querySelector('a[href="#/story/strategic-icon--normal"]')).not.toBeNull();
    // Components without stories are listed (greyed out) as well.
    expect(container.querySelector('[data-component-card="Hud"]')).not.toBeNull();
  });

  it('story route renders the story in a fixed viewport box and applies the query to <html>', () => {
    initGalleryGlobal(storyManifest(), REGISTRY_ERRORS);
    location.hash = '#/story/strategic-icon--teams-cvd?shot=1&scale=1.25';
    const { container } = render(<App />);
    const box = container.querySelector<HTMLElement>('[data-story-root]')!;
    expect(box.getAttribute('data-story-id')).toBe('strategic-icon--teams-cvd');
    expect(box.style.width).toBe('1440px');
    expect(box.querySelectorAll('svg.ff-sicon').length).toBeGreaterThan(50);
    // setup() switched the team mode; the query set the scale.
    expect(document.documentElement.dataset['teams']).toBe('cvd');
    expect(document.documentElement.style.fontSize).toBe('20px');
    // shot=1: no gallery chrome.
    expect(container.querySelector('.gal-bar')).toBeNull();
    expect(container.querySelector('[data-testid="gallery-command-log"]')).toBeNull();
    expect(document.body.classList.contains('is-shot')).toBe(true);
  });

  it('story page with chrome shows the command log; unknown stories are reported', () => {
    initGalleryGlobal(storyManifest(), REGISTRY_ERRORS);
    location.hash = '#/story/strategic-icon--normal';
    const { container, unmount } = render(<App />);
    expect(container.querySelector('.gal-bar')).not.toBeNull();
    expect(container.querySelector('[data-testid="gallery-command-log"]')).not.toBeNull();
    unmount();
    location.hash = '#/story/does-not-exist';
    const r = render(<App />);
    expect(r.container.textContent).toContain('nicht gefunden');
  });
});
