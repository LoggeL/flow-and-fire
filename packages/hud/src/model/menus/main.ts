import { signal } from '@preact/signals';
import type { Signal } from '@preact/signals';

/** Main menu (ui.md §5.15, A3). Screens reachable from the menus. */
export type MenuScreen = 'main' | 'skirmish' | 'replays' | 'settings' | 'tutorial' | 'credits' | 'loading' | 'game' | 'score';

export interface LastMatch {
  readonly mapName: string;
  readonly verdict: 'victory' | 'defeat' | 'draw';
  readonly durationS: number;
  readonly opponent: string;
  /** A replay of the match is stored and can be watched. */
  readonly hasReplay: boolean;
}

export interface MainMenuSection {
  readonly build: Signal<string>;
  readonly simId: Signal<string>;
  readonly transport: Signal<string>;
  readonly preset: Signal<string>;
  readonly lastMatch: Signal<LastMatch | null>;
  readonly replaysAvailable: Signal<boolean>;
}

export function createMainMenuSection(): MainMenuSection {
  return {
    build: signal(''),
    simId: signal(''),
    transport: signal(''),
    preset: signal(''),
    lastMatch: signal<LastMatch | null>(null),
    replaysAvailable: signal(false),
  };
}
