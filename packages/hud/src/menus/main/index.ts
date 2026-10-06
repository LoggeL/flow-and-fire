// Barrel of the menu "main" (hud-p6-menus): main menu, shared menu helpers (menu demo data: src/demo/menus.ts via src/demo/index.ts).
import '../../styles/menus.css';

export { MainMenu, agoText } from './MainMenu.tsx';
export { Emblem } from '../shared/Emblem.tsx';
export { MapPreview, MapThumb, MenuBackground } from '../shared/MapCanvas.tsx';
export type { MapPreviewProps, MapThumbProps, MenuBackgroundProps, StartMarker } from '../shared/MapCanvas.tsx';
export { drawTerrain, heightField, lcg, previewField, rampColor, resourceSpots, terrainPixels, WATER_LEVEL } from '../shared/terrain.ts';
export type { HeightField, HeightFieldOptions, TerrainOptions } from '../shared/terrain.ts';
export { focusables, isFieldTarget, trapTab, useInitialFocus } from '../shared/focus.ts';
export {
  aiLevelLabel,
  colorName,
  dataText,
  factorText,
  houseLabel,
  presetLabel,
  compassLabel,
  teamModeLabel,
  victoryHint,
  victoryLabel,
} from '../shared/labels.ts';
