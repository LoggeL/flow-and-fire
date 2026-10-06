/**
 * Helpers of the menu tests (hud-p6): render a menu page with demo data and recording commands that also
 * run the reference controller (createMenuController), exactly like the gallery stories do.
 */
import type { ComponentChildren } from 'preact';
import { createHudModel, createMenuController, createRecordingCommands } from '../../src/index.ts';
import type { HudModel, Locale, RecordedCall } from '../../src/index.ts';
import { fireEvent, renderWithHud } from '../support/index.tsx';
import type { HudRenderResult } from '../support/index.tsx';
import { demoUnitCatalog } from '../../src/demo/catalog.ts';

const CAT = demoUnitCatalog();

export interface MenuRenderOptions {
  /** Fills the model before the first render (demo presets). */
  readonly setup?: (model: HudModel) => void;
  /** Also apply the state-only commands to the model (tabs, settings, lobby, language). */
  readonly controller?: boolean;
  readonly locale?: Locale;
}

export interface MenuRenderResult extends HudRenderResult {
  /** Recorded calls (with the controller, the calls are recorded before they are applied). */
  readonly calls: RecordedCall[];
}

export function renderMenu(ui: ComponentChildren, options: MenuRenderOptions = {}): MenuRenderResult {
  const model = createHudModel({ units: CAT });
  options.setup?.(model);
  const rec = createRecordingCommands(options.controller ? createMenuController(model) : {});
  const result = renderWithHud(ui, { model, commands: rec.commands, ...(options.locale ? { locale: options.locale } : {}) });
  return { ...result, calls: rec.log, log: rec.log, clearLog: rec.clear };
}

/** Names of the recorded calls in order. */
export function names(log: readonly RecordedCall[]): string[] {
  return log.map((c) => c.name);
}

/** Calls of one command. */
export function callsOf(log: readonly RecordedCall[], name: RecordedCall['name']): (readonly unknown[])[] {
  return log.filter((c) => c.name === name).map((c) => c.args);
}

/** Dispatches a keydown on the element (bubbles like a real key press). */
export function key(el: Element, k: string, init: KeyboardEventInit = {}): void {
  fireEvent.keyDown(el, { key: k, bubbles: true, cancelable: true, ...init });
}

/** The currently focused element's data-testid (or its tag when it has none). */
export function focusedId(): string {
  const el = document.activeElement as HTMLElement | null;
  return el?.dataset['testid'] ?? el?.tagName ?? '';
}
