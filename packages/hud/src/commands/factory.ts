/** Factory queue commands (ui.md §5.7: click +1, Shift +5, right click −1/−5, Ctrl = to the front). */
export interface FactoryCommands {
  /**
   * Adds `count` units of `typeId` to the queue of the selected factories (distributed round robin when
   * several are selected); `toFront` puts them before the rest (Ctrl+click).
   */
  queueAdd(typeId: string, count: number, toFront: boolean): void;
  /** Removes up to `count` queued units of `typeId`, starting at the end of the queue. */
  queueRemove(typeId: string, count: number): void;
  toggleRepeat(): void;
  togglePauseProduction(): void;
  /** Arm the rally mode (next ground click sets the rally point). */
  armRally(): void;
  clearQueue(): void;
}

export const FACTORY_COMMAND_NAMES = [
  'queueAdd',
  'queueRemove',
  'toggleRepeat',
  'togglePauseProduction',
  'armRally',
  'clearQueue',
] as const satisfies readonly (keyof FactoryCommands)[];
