import { signal } from '@preact/signals';
import type { Signal } from '@preact/signals';
import type { GraphicsPreset } from './settings.ts';
import type { AiDifficulty } from './skirmish.ts';

/** Main menu (ui.md §5.15, A3). Screens reachable from the menus. */
export type MenuScreen = 'main' | 'skirmish' | 'replays' | 'settings' | 'tutorial' | 'credits' | 'loading' | 'game' | 'score';

export interface LastMatch {
  readonly mapName: string;
  readonly verdict: 'victory' | 'defeat';
  readonly durationS: number;
  /** Opponent house name (without "Haus"). */
  readonly opponent: string;
  /** AI difficulty of the opponent (null = human). */
  readonly opponentAi: AiDifficulty | null;
  /** Seconds since the match ended. */
  readonly agoS: number;
  /** Size of the stored replay in bytes; null = no replay stored. */
  readonly replayBytes: number | null;
}

export interface MainMenuSection {
  /** Short build hash. */
  readonly build: Signal<string>;
  readonly simId: Signal<string>;
  /** Renderer API name (e.g. "WebGL2"). */
  readonly renderer: Signal<string>;
  /** Worker transport (e.g. "SAB", "postMessage"). */
  readonly transport: Signal<string>;
  readonly preset: Signal<GraphicsPreset>;
  readonly lastMatch: Signal<LastMatch | null>;
  /** Replays browser available (N1, MS11); before that the entry is locked with a hint. */
  readonly replaysAvailable: Signal<boolean>;
}

export function createMainMenuSection(): MainMenuSection {
  return {
    build: signal(''),
    simId: signal(''),
    renderer: signal('WebGL2'),
    transport: signal(''),
    preset: signal<GraphicsPreset>('medium'),
    lastMatch: signal<LastMatch | null>(null),
    replaysAvailable: signal(false),
  };
}

export type MainNavId = 'skirmish' | 'replays' | 'settings' | 'tutorial' | 'credits';

export interface MainNavItem {
  readonly id: MainNavId;
  readonly screen: MenuScreen;
  /** Locked entries show a tag and a reason and are skipped by ↑/↓. */
  readonly locked: boolean;
}

/** Entries of the vertical main navigation in order (ui.md §5.15). */
export function mainNavItems(replaysAvailable: boolean): readonly MainNavItem[] {
  return [
    { id: 'skirmish', screen: 'skirmish', locked: false },
    { id: 'replays', screen: 'replays', locked: !replaysAvailable },
    { id: 'settings', screen: 'settings', locked: false },
    { id: 'tutorial', screen: 'tutorial', locked: true },
    { id: 'credits', screen: 'credits', locked: false },
  ];
}

/** Next enabled index for ↑ (-1) / ↓ (+1), wrapping around; -1 if nothing is enabled. */
export function nextEnabled(locked: readonly boolean[], from: number, dir: 1 | -1): number {
  const n = locked.length;
  if (n === 0 || locked.every((l) => l)) return -1;
  let i = from;
  for (let k = 0; k < n; k++) {
    i = (((i + dir) % n) + n) % n;
    if (!locked[i]) return i;
  }
  return -1;
}

export type AgoUnit = 'minutes' | 'hours' | 'days';

/** "vor 2 Std." helper: largest whole unit (at least 1 minute). */
export function agoParts(seconds: number): { readonly unit: AgoUnit; readonly n: number } {
  const s = Math.max(0, seconds);
  if (s < 3600) return { unit: 'minutes', n: Math.max(1, Math.floor(s / 60)) };
  if (s < 86_400) return { unit: 'hours', n: Math.floor(s / 3600) };
  return { unit: 'days', n: Math.floor(s / 86_400) };
}
