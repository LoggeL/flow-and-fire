import type { MinimapMode } from '../model/minimap.ts';

/** Minimap commands (ui.md §5.4); coordinates in world units. */
export interface MinimapCommands {
  /** Left click / drag: move the camera. */
  setCamera(x: number, z: number): void;
  /** Right click: issue the context order at that point (Shift appends). */
  minimapOrder(x: number, z: number, shift: boolean): void;
  setMinimapMode(mode: MinimapMode): void;
  toggleResources(): void;
  /** "Ganze Karte": jump to the maximum strategic zoom (C2). */
  showWholeMap(): void;
}

export const MINIMAP_COMMAND_NAMES = [
  'setCamera',
  'minimapOrder',
  'setMinimapMode',
  'toggleResources',
  'showWholeMap',
] as const satisfies readonly (keyof MinimapCommands)[];
