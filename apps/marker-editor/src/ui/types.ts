/**
 * Contract between the app controller (P5, main.ts) and the panels (P6). The controller implements
 * PanelIo (file IO, camera, pointer) and calls mountPanels(#ui, store, io) from src/ui/index.ts.
 */
import type { ReadonlySignal, Signal } from '@preact/signals';

export interface PanelIo {
  /** Opens the system file dialog for a .rtsmap file. */
  openFile(): void;
  /** Names (without .rtsmap) of the maps bundled with the editor (/maps/index.json). */
  listBundled(): Promise<readonly string[]>;
  /** Loads a bundled map by name. */
  openBundled(name: string): Promise<void>;
  /** Downloads the current document as .rtsmap (and marks it saved). */
  save(): void;
  /** Downloads markers.json of the current document. */
  exportMarkersJson(): void;
  /** Downloads editor.json (marker overlay of a map source directory). */
  exportEditorOverlay(): void;
  /** Centres the camera on a map point (Fx raw). */
  focus(xRaw: number, zRaw: number): void;
  /** Whole-map camera view. */
  fitView(): void;
  /** Map point under the mouse pointer in WU (null = off the map). */
  readonly cursor: ReadonlySignal<{ readonly x: number; readonly z: number } | null>;
  /** Height grid visibility (the controller applies it to the terrain view). */
  readonly gridVisible: Signal<boolean>;
}
