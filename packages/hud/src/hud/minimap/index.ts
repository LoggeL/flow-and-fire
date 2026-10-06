// Barrel of the HUD group "minimap" (hud-p5-root): Canvas2D minimap in layers (terrain, fog, units, camera),
// its pure drawing functions (testable against a recording 2D-context mock) and the map key figures (UI-E2).
import './minimap.css';

export { MINIMAP_FALLBACK_PX, Minimap } from './Minimap.tsx';
export type { MinimapProps } from './Minimap.tsx';
export { MINIMAP_DRAW_MEASURE, MinimapRenderer } from './renderer.ts';
export type { Bitmap, DynamicInput, MinimapLayers, MinimapRendererOptions, MinimapRendererStats } from './renderer.ts';
export {
  BLIP_RADIUS_PX,
  DEFAULT_MINIMAP_PALETTE,
  FOG_RGBA,
  MINIMAP_PALETTE_TOKENS,
  OUTLINE_PX,
  PING_RADII_PX,
  SPOT_PX,
  STRUCTURE_PX,
  UNIT_PX,
  blipSpriteSize,
  buildFogPixels,
  buildTerrainPixels,
  drawCameraLayer,
  drawDynamicLayer,
  drawFogLayer,
  drawPings,
  drawSpots,
  drawTerrainLayer,
  drawUnits,
  ghostSpriteSize,
  minimapToWorld,
  paintBlipSprite,
  paintGhostSprite,
  paintFogBitmap,
  paintTerrainBitmap,
  readMinimapPalette,
  worldToMinimap,
} from './draw.ts';
export type { ClientRectLike, Ctx2D, DynamicFrame, MinimapPalette, MinimapSprites, PixelCtx2D, Sprite } from './draw.ts';
