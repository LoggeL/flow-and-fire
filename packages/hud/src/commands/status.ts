/** Match status commands (ui.md §5.2, §5.3). */
export interface MatchCommands {
  /** Menu button / Esc: open the in-game menu. */
  openGameMenu(): void;
  /** Sim speed − / + (A6); delta in steps (−1 / +1). */
  changeSpeed(delta: number): void;
  /** P / Pause (A5). */
  togglePause(): void;
}

export const MATCH_COMMAND_NAMES = ['openGameMenu', 'changeSpeed', 'togglePause'] as const satisfies readonly (keyof MatchCommands)[];
