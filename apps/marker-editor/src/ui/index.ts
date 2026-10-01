/**
 * Editor panels (TRACK-EDITOR P6, Preact + @preact/signals). The controller (main.ts, P5) calls
 *
 *   const unmount = mountPanels(document.querySelector('#ui')!, store, io);
 *
 * #ui lies over the canvas with pointer-events: none; the panels take the pointer back and keep
 * the middle of the map free. The "?" key toggles the help overlay.
 */
import { signal } from '@preact/signals';
import { h, render } from 'preact';
import type { EditorStore } from '../app/store.ts';
import { PanelsApp } from './components/App.tsx';
import { installHelpKeys } from './components/HelpOverlay.tsx';
import './styles.css';
import type { PanelIo } from './types.ts';

export type { PanelIo } from './types.ts';

/** Renders the panels into `root`; returns the unmount function. */
export function mountPanels(root: HTMLElement, store: EditorStore, io: PanelIo): () => void {
  const helpOpen = signal(false);
  const uninstallKeys = installHelpKeys(helpOpen, root.ownerDocument.defaultView ?? window);
  render(h(PanelsApp, { store, io, helpOpen }), root);
  let mounted = true;
  return () => {
    if (!mounted) return;
    mounted = false;
    uninstallKeys();
    render(null, root);
  };
}
