/**
 * Test support for @faf/hud DOM tests (files start with `// @vitest-environment happy-dom`).
 * Importing this module registers an afterEach hook that unmounts rendered trees, resets the locale
 * and restores real timers, so tests stay independent (vitest runs without globals, so the
 * testing-library auto-cleanup would not register itself).
 */
import { batch } from '@preact/signals';
import { act, cleanup, render } from '@testing-library/preact';
import type { RenderResult } from '@testing-library/preact';
import type { ComponentChildren } from 'preact';
import { afterEach, vi } from 'vitest';
import { HudProvider, createHudModel, createRecordingCommands, setLocale } from '../../src/index.ts';
import type { HudCommands, HudModel, Locale, RecordedCall } from '../../src/index.ts';
import { demoUnitCatalog } from '../../src/demo/catalog.ts';

const CAT = demoUnitCatalog();

afterEach(() => {
  cleanup();
  setLocale('de');
  vi.useRealTimers();
});

export interface RenderWithHudOptions {
  readonly model?: HudModel;
  /** Commands to use; default: recording commands (see `log`). */
  readonly commands?: HudCommands;
  readonly locale?: Locale;
}

export interface HudRenderResult extends RenderResult {
  readonly model: HudModel;
  readonly commands: HudCommands;
  /** Recorded command calls (empty when custom commands were passed). */
  readonly log: RecordedCall[];
  /** Clears the recorded calls. */
  clearLog(): void;
}

/** Renders `ui` inside a HudProvider with a fresh model and recording commands. */
export function renderWithHud(ui: ComponentChildren, options: RenderWithHudOptions = {}): HudRenderResult {
  if (options.locale) setLocale(options.locale);
  const model = options.model ?? createHudModel({ units: CAT });
  const recording = createRecordingCommands();
  const commands = options.commands ?? recording.commands;
  const result = render(
    <HudProvider model={model} commands={commands}>
      {ui}
    </HudProvider>,
  );
  return { ...result, model, commands, log: recording.log, clearLog: recording.clear };
}

/**
 * Applies signal updates in one batch and flushes Preact's scheduled re-renders and effects.
 * Direct signal bindings (text, --v) update synchronously; component re-renders need the flush.
 */
export async function flushSignals(update?: () => void): Promise<void> {
  await act(async () => {
    if (update) batch(update);
  });
}

export interface FakeClock {
  /** Current fake time in ms (performance.now / Date.now). */
  now(): number;
  /** Advances timers, animation frames and the clock by `ms`, running due callbacks. */
  advance(ms: number): Promise<void>;
  /** Runs all animation frames once (one rAF tick of 16 ms). */
  frame(): Promise<void>;
  restore(): void;
}

/** Fake timers incl. requestAnimationFrame and performance.now (restored automatically after each test). */
export function fakeClock(startMs = 0): FakeClock {
  vi.useFakeTimers({
    now: startMs,
    toFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'Date',
      'performance',
      'requestAnimationFrame',
      'cancelAnimationFrame',
    ],
  });
  return {
    now: () => Date.now(),
    advance: async (ms: number) => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    },
    frame: async () => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(16);
      });
    },
    restore: () => vi.useRealTimers(),
  };
}

/** Last recorded call of a command (undefined if never called). */
export function lastCall(log: readonly RecordedCall[], name: RecordedCall['name']): RecordedCall | undefined {
  for (let i = log.length - 1; i >= 0; i--) if (log[i]?.name === name) return log[i];
  return undefined;
}

export { act, fireEvent, screen, within } from '@testing-library/preact';
